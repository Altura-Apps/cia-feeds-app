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

  let checkoutSession;
  try {
    checkoutSession = await stripeClient.checkout.sessions.create({
      mode: "subscription",
      customer: dealer.stripeCustomerId!,
      line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
      success_url: `${appUrl}/subscribe?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/subscribe?canceled=true`,
      // 'if_required' lets Stripe skip the card-entry step entirely when the
      // amount due today is $0 (e.g. a 100%-off beta coupon covering the full
      // period). If the subscription later renews to a non-zero amount, Stripe
      // will email the customer to add a payment method before that charge.
      payment_method_collection: "if_required",
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
