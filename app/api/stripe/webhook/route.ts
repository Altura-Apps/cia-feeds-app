export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { stripeClient } from "@/lib/stripe";
import type Stripe from "stripe";
import {
  logStripeWebhookReceived,
  logStripeWebhookProcessed,
  logStripeWebhookError,
} from "@/lib/logger";
import { planFromStripePriceId, type Plan } from "@/lib/planLimits";

async function applySubscriptionStatus(
  eventId: string,
  eventType: string,
  stripeCustomerId: string,
  status: string,
  subscriptionId?: string,
  priceId?: string,
) {
  const dealer = await prisma.dealer.findFirst({
    where: { stripeCustomerId },
    select: { id: true, metaDeliveryMethod: true, plan: true },
  });

  if (!dealer) {
    console.log({ event: "stripe_webhook_dealer_not_found", stripeCustomerId, eventId });
    return;
  }

  const updateData: Record<string, unknown> = { subscriptionStatus: status };
  if (subscriptionId) {
    updateData.stripeSubscriptionId = subscriptionId;
  }
  if (status === "canceled" || status === "unpaid") {
    updateData.metaDeliveryMethod = "csv";
    // Lapsed customer drops back to trial-tier limits until they re-subscribe.
    updateData.plan = "trial";
  } else if (status === "active" || status === "trialing") {
    // Sync Dealer.plan to whatever Stripe price the dealer is currently on.
    // priceId is supplied by the customer.subscription.* events; for invoice
    // events we can't be 100% sure, so we keep the current plan.
    if (priceId) {
      const nextPlan: Plan = planFromStripePriceId(priceId);
      updateData.plan = nextPlan;
      // On any upgrade from trial → paid, reset the URL-add counter so the
      // dealer starts fresh.
      if (dealer.plan === "trial" && nextPlan !== "trial") {
        updateData.trialUrlAddsUsed = 0;
      }
    }
  }

  await prisma.$transaction([
    prisma.dealer.update({
      where: { id: dealer.id },
      data: updateData,
    }),
    prisma.stripeWebhookEvent.create({
      data: { id: eventId, type: eventType },
    }),
  ]);
}

export async function POST(request: Request) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = stripeClient.webhooks.constructEvent(
      body,
      sig!,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch {
    return new Response("Webhook signature verification failed", { status: 400 });
  }

  logStripeWebhookReceived({ eventId: event.id, type: event.type });

  // Idempotency check
  const existing = await prisma.stripeWebhookEvent.findUnique({
    where: { id: event.id },
  });
  if (existing) {
    return NextResponse.json({ received: true, idempotent: true });
  }

  const start = Date.now();

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.resumed": {
        const subscription = event.data.object as Stripe.Subscription;
        // Pull the active recurring price id so we can map it to a Plan tier.
        // For subscriptions with a single price (our case), items.data[0]
        // is the recurring line.
        const priceId = subscription.items.data[0]?.price?.id;
        await applySubscriptionStatus(
          event.id,
          event.type,
          subscription.customer as string,
          subscription.status,
          subscription.id,
          priceId,
        );
        break;
      }
      case "customer.subscription.paused": {
        const subscription = event.data.object as Stripe.Subscription;
        const priceId = subscription.items.data[0]?.price?.id;
        await applySubscriptionStatus(
          event.id,
          event.type,
          subscription.customer as string,
          subscription.status,
          subscription.id,
          priceId,
        );
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await applySubscriptionStatus(
          event.id,
          event.type,
          subscription.customer as string,
          "canceled",
        );
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await applySubscriptionStatus(
          event.id,
          event.type,
          invoice.customer as string,
          "past_due",
        );
        break;
      }
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.subscription) {
          const subscription = await stripeClient.subscriptions.retrieve(
            invoice.subscription as string
          );
          const priceId = subscription.items.data[0]?.price?.id;
          await applySubscriptionStatus(
            event.id,
            event.type,
            invoice.customer as string,
            subscription.status,
            subscription.id,
            priceId,
          );
        } else {
          // One-off invoice, just record idempotency
          await prisma.stripeWebhookEvent.create({
            data: { id: event.id, type: event.type },
          });
        }
        break;
      }
      case "customer.subscription.trial_will_end": {
        const subscription = event.data.object as Stripe.Subscription;
        // F-4.2: notify the dealer so the trial doesn't end silently.
        // Dedupe via Dealer.trialEndingNotifiedAt so we never send twice.
        const dealer = await prisma.dealer.findFirst({
          where: {
            stripeCustomerId: subscription.customer as string,
            trialEndingNotifiedAt: null,
            deletedAt: null,
          },
          select: { id: true, email: true, name: true },
        });
        if (dealer && subscription.trial_end) {
          const { sendTrialEndingEmail } = await import("@/lib/email");
          await sendTrialEndingEmail(
            dealer.email,
            dealer.name,
            new Date(subscription.trial_end * 1000)
          );
          // SMS reminder for dealers who opted into trialAlerts.
          const { sendProactiveSms } = await import("@/lib/smsNotifications");
          const endDate = new Date(subscription.trial_end * 1000).toLocaleDateString(
            "en-US",
            { month: "short", day: "numeric" }
          );
          await sendProactiveSms(
            dealer.id,
            "trialAlerts",
            `⏰ Your CIA Feeds trial ends on ${endDate}. Your saved card will be charged automatically. Manage at https://www.ciafeed.com/billing.`
          ).catch((err) =>
            console.error("[stripe webhook] trial sms failed:", err)
          );
          await prisma.dealer.update({
            where: { id: dealer.id },
            data: { trialEndingNotifiedAt: new Date() },
          });
        }
        await prisma.stripeWebhookEvent.create({
          data: { id: event.id, type: event.type },
        });
        logStripeWebhookProcessed({
          eventId: event.id,
          type: event.type,
          durationMs: Date.now() - start,
          trialEnd: subscription.trial_end,
        });
        return NextResponse.json({ received: true });
      }
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && session.customer && session.subscription) {
          const subscription = await stripeClient.subscriptions.retrieve(
            session.subscription as string
          );
          await applySubscriptionStatus(
            event.id,
            event.type,
            session.customer as string,
            subscription.status,
            subscription.id,
          );
        } else {
          await prisma.stripeWebhookEvent.create({
            data: { id: event.id, type: event.type },
          });
        }
        break;
      }
      default: {
        // Unhandled event type — record for idempotency but take no action
        await prisma.stripeWebhookEvent.create({
          data: { id: event.id, type: event.type },
        });
        break;
      }
    }

    logStripeWebhookProcessed({
      eventId: event.id,
      type: event.type,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    logStripeWebhookError({
      eventId: event.id,
      type: event.type,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({ received: true });
}
