export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stripeClient, formatPriceLabel } from "@/lib/stripe";
import { getEffectiveDealerContext } from "@/lib/impersonation";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { effectiveDealerId, isImpersonating } = await getEffectiveDealerContext();
  const dealerId = effectiveDealerId ?? session.user.id;

  const dealer = await prisma.dealer.findUnique({
    where: { id: dealerId },
    select: {
      subscriptionStatus: true,
      stripeSubscriptionId: true,
      stripeCustomerId: true,
    },
  });

  if (!dealer) {
    return NextResponse.json({ error: "dealer not found" }, { status: 404 });
  }

  let status = dealer.subscriptionStatus;
  let currentPeriodEnd: string | null = null;
  let priceLabel: string | null = null;
  let backfilledFromStripe = false;

  // If we have a customer but the DB says inactive/null, ask Stripe directly.
  // This makes the /subscribe activation poll resilient to webhook delivery
  // delays or outright failures (e.g. webhook endpoint disabled in dashboard).
  // We backfill the DB so the next request is fast.
  const needsStripeCheck =
    dealer.stripeCustomerId &&
    (status === null ||
      status === "incomplete" ||
      status === "incomplete_expired");

  if (needsStripeCheck) {
    try {
      const subs = await stripeClient.subscriptions.list({
        customer: dealer.stripeCustomerId!,
        status: "all",
        limit: 5,
      });
      // Prefer the most recent active/trialing subscription.
      const ranked = subs.data.slice().sort((a, b) => b.created - a.created);
      const live =
        ranked.find((s) => s.status === "active" || s.status === "trialing") ??
        ranked[0];
      if (live) {
        status = live.status;
        if (live.current_period_end) {
          currentPeriodEnd = new Date(live.current_period_end * 1000).toISOString();
        }
        const price = live.items.data[0]?.price;
        if (price) {
          priceLabel = formatPriceLabel(price);
        }
        // Backfill so future reads are cheap and so the rest of the app
        // (auth, tenant gates, cron jobs) sees the right state.
        await prisma.dealer.update({
          where: { id: dealerId },
          data: {
            subscriptionStatus: live.status,
            stripeSubscriptionId: live.id,
          },
        });
        backfilledFromStripe = true;
      }
    } catch (err) {
      console.error({
        event: "subscription_me_stripe_backfill_failed",
        dealerId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // For dealers with a healthy DB record, still hit Stripe to get period_end + label.
  if (!backfilledFromStripe && dealer.stripeSubscriptionId) {
    try {
      const subscription = await stripeClient.subscriptions.retrieve(
        dealer.stripeSubscriptionId
      );
      if (subscription.current_period_end) {
        currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();
      }
      const price = subscription.items.data[0]?.price;
      if (price) {
        priceLabel = formatPriceLabel(price);
      }
    } catch {
      // Stripe call failed — return DB-only fields
    }
  }

  return NextResponse.json({
    status,
    currentPeriodEnd,
    priceLabel,
    hasCustomer: !!dealer.stripeCustomerId,
    isImpersonating,
    backfilledFromStripe,
  });
}
