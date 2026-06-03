import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { cookies } from "next/headers";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stripeClient } from "@/lib/stripe";
import { getEffectiveDealerContext, IMPERSONATION_COOKIE } from "@/lib/impersonation";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Block billing only when admin is actively impersonating
  const { isImpersonating, hasStaleImpersonationCookie } =
    await getEffectiveDealerContext();

  if (isImpersonating) {
    return NextResponse.json(
      { error: "Billing actions are disabled while impersonating a user." },
      { status: 403 }
    );
  }

  // Clear stale impersonation cookie for non-admin sessions
  if (hasStaleImpersonationCookie) {
    const cookieStore = await cookies();
    cookieStore.delete(IMPERSONATION_COOKIE);
  }

  const { promoCodeId } = await request.json().catch(() => ({})) as { promoCodeId?: string };

  let dealer = await prisma.dealer.findUnique({
    where: { id: session.user.id },
    select: { stripeCustomerId: true, name: true, email: true },
  });

  if (!dealer) {
    return NextResponse.json({ error: "dealer not found" }, { status: 404 });
  }

  if (!dealer.stripeCustomerId) {
    const customer = await stripeClient.customers.create({
      email: dealer.email,
      name: dealer.name,
    });
    await prisma.dealer.update({
      where: { id: session.user.id },
      data: { stripeCustomerId: customer.id },
    });
    dealer = { ...dealer, stripeCustomerId: customer.id };
  }

  if (promoCodeId && !/^promo_[a-zA-Z0-9]+$/.test(promoCodeId)) {
    return NextResponse.json({ error: "Invalid promo code." }, { status: 400 });
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '');

  // Paid-trial flow: charge $1 today, 10-day trial, then $299/mo recurring.
  //
  // Stripe has no single "paid trial" primitive, so we combine:
  //   - subscription_data.trial_period_days: 10
  //     The recurring $299 doesn't bill until the trial ends.
  //   - add_invoice_items: a one-time $1 line on the first invoice, which is
  //     generated immediately at checkout completion and charged to the card
  //     the customer enters in Checkout. This is the canonical paid-trial
  //     pattern (https://stripe.com/docs/billing/subscriptions/trials).
  //
  // Card collection is always required so the $299 post-trial charge succeeds
  // without an interruption.
  //
  // Beta coupons (100% off) still work: they discount the recurring $299, but
  // the $1 setup fee is a separate non-recurring line item that promotion
  // codes don't apply to. Beta users still pay $1 today, then $0/mo for the
  // coupon's duration.
  const TRIAL_DAYS = 10;
  const TRIAL_SETUP_FEE_CENTS = 100; // $1

  // Look up the product id (needed for add_invoice_items) and detect whether
  // an attached promotion code is a 100%-off coupon. When it is, today's
  // total will be $0, and we should skip card collection so beta users can
  // sign up without entering a card.
  let productId: string;
  let couponIsFullDiscount = false;
  try {
    const recurringPrice = await stripeClient.prices.retrieve(
      process.env.STRIPE_PRICE_ID!
    );
    productId =
      typeof recurringPrice.product === "string"
        ? recurringPrice.product
        : recurringPrice.product.id;

    if (promoCodeId) {
      try {
        const promo = await stripeClient.promotionCodes.retrieve(promoCodeId, {
          expand: ["coupon"],
        });
        if (promo.coupon.percent_off === 100) {
          couponIsFullDiscount = true;
        }
      } catch {
        // If we can't read the promo, fall through; Stripe Checkout will
        // validate it again and reject if invalid.
      }
    }
  } catch {
    return NextResponse.json(
      { error: "Misconfigured subscription price." },
      { status: 500 }
    );
  }

  let checkoutSession;
  try {
    checkoutSession = await stripeClient.checkout.sessions.create({
      mode: "subscription",
      customer: dealer.stripeCustomerId!,
      line_items: [
        // Recurring $299/mo, with a 10-day trial set via subscription_data
        // below. The first invoice's recurring portion is $0 during the trial.
        { price: process.env.STRIPE_PRICE_ID!, quantity: 1 },
        // One-time $1 setup fee on the same first invoice. Stripe Checkout
        // accepts mixed recurring + one-time line items in subscription
        // mode — the one-time line is billed once on the first invoice
        // (today, at checkout completion) and never again.
        {
          price_data: {
            currency: "usd",
            product: productId,
            unit_amount: TRIAL_SETUP_FEE_CENTS,
            tax_behavior: "unspecified",
            // No `recurring` field → one-time price.
          },
          quantity: 1,
        },
      ],
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
      },
      success_url: `${appUrl}/subscribe?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/subscribe?canceled=true`,
      // Card collection: required when today's total is non-zero (the normal
      // paid-trial path). Skipped when a 100%-off coupon zeroes out the bill
      // (the beta-access path), so beta users can sign up without a card.
      // Stripe will email them to add a card before the first non-zero
      // renewal at the end of the discount period.
      payment_method_collection: couponIsFullDiscount ? "if_required" : "always",
      ...(promoCodeId
        ? { discounts: [{ promotion_code: promoCodeId }] }
        : { allow_promotion_codes: true }),
    });
  } catch (err: unknown) {
    const stripeError = err as { type?: string; code?: string; message?: string };
    if (
      stripeError?.type === "StripeInvalidRequestError" ||
      stripeError?.code === "resource_missing" ||
      stripeError?.code === "promotion_code_invalid"
    ) {
      return NextResponse.json({ error: "Invalid or expired promo code." }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create checkout session." }, { status: 500 });
  }

  return NextResponse.json({ url: checkoutSession.url });
}
