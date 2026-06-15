/**
 * POST /api/admin/dealers/[id]/grant-plan
 *
 * Super-admin tool to grant a dealer a paid plan WITHOUT charging them
 * (used for comps, beta partners, post-coupon manual fixes).
 *
 * Body: { plan: "starter" | "pro" | "enterprise", freeMonths?: number }
 *
 * What it does:
 *   1. Validates the dealer exists.
 *   2. Creates a one-off 100%-off coupon in Stripe valid for `freeMonths`
 *      months (default 12), then creates a recurring subscription on the
 *      dealer's Stripe customer for the requested plan's price, with the
 *      coupon applied. payment_behavior is "default_incomplete" so no
 *      card is required — Stripe will dunning-email her if/when the comp
 *      period ends.
 *   3. Sets Dealer.plan to the requested tier.
 *   4. Resets trialUrlAddsUsed to 0 (matches what the Stripe webhook does
 *      on a normal upgrade).
 *   5. Records the grant in the AdminAudit log.
 *
 * Security: requires manage_accounts capability (super_admin only).
 */
import { NextResponse } from "next/server";
import { adminGuard } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stripeClient } from "@/lib/stripe";
import { writeAuditLog } from "@/lib/adminAudit";

export const dynamic = "force-dynamic";

const PLAN_TO_PRICE_ENV: Record<string, string> = {
  starter: "STRIPE_LEGACY_PRICE_ID",
  pro: "STRIPE_PRICE_ID",
  enterprise: "STRIPE_ENTERPRISE_PRICE_ID",
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await adminGuard("manage_accounts");
  if (!guard.ok) return guard.response!;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    plan?: string;
    freeMonths?: number;
  };

  const plan = (body.plan ?? "").toLowerCase();
  if (!["starter", "pro", "enterprise"].includes(plan)) {
    return NextResponse.json(
      { error: "plan must be one of: starter, pro, enterprise" },
      { status: 400 }
    );
  }

  const freeMonths = Math.max(1, Math.min(36, Math.floor(body.freeMonths ?? 12)));

  const priceEnv = PLAN_TO_PRICE_ENV[plan];
  const priceId = process.env[priceEnv];
  if (!priceId) {
    return NextResponse.json(
      { error: `Price env var ${priceEnv} not configured.` },
      { status: 500 }
    );
  }

  const dealer = await prisma.dealer.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      plan: true,
      stripeCustomerId: true,
    },
  });
  if (!dealer) {
    return NextResponse.json({ error: "dealer not found" }, { status: 404 });
  }

  // Ensure a Stripe customer exists for this dealer.
  let stripeCustomerId = dealer.stripeCustomerId;
  if (!stripeCustomerId) {
    const customer = await stripeClient.customers.create({
      email: dealer.email,
      name: dealer.name,
      metadata: { dealerId: dealer.id, source: "admin_grant" },
    });
    stripeCustomerId = customer.id;
    await prisma.dealer.update({
      where: { id: dealer.id },
      data: { stripeCustomerId },
    });
  }

  // Mint a fresh 100%-off coupon valid for freeMonths months. Single-use
  // (max_redemptions=1) so it can't be reused if leaked.
  let coupon;
  try {
    coupon = await stripeClient.coupons.create({
      percent_off: 100,
      duration: "repeating",
      duration_in_months: freeMonths,
      max_redemptions: 1,
      name: `Comp grant for ${dealer.name ?? dealer.email}`,
      metadata: {
        dealerId: dealer.id,
        grantedBy: guard.email,
        kind: "admin_grant",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to create comp coupon.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }

  // Cancel any existing active subscription on this customer first so the
  // new comped sub is the canonical one.
  try {
    const existing = await stripeClient.subscriptions.list({
      customer: stripeCustomerId,
      status: "all",
      limit: 10,
    });
    for (const sub of existing.data) {
      if (
        sub.status === "active" ||
        sub.status === "trialing" ||
        sub.status === "past_due" ||
        sub.status === "incomplete"
      ) {
        await stripeClient.subscriptions.cancel(sub.id, {
          invoice_now: false,
          prorate: false,
        });
      }
    }
  } catch (err) {
    // Log but don't fail — we'll still try to create the new sub.
    console.error({
      event: "grant_plan_cancel_existing_failed",
      dealerId: dealer.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Create the comped subscription. No card required because the discount
  // zeroes out every invoice in the comp window. After the comp period,
  // Stripe will attempt to charge — she'll get a dunning email and can
  // add a card then if she wants to continue.
  let subscription;
  try {
    subscription = await stripeClient.subscriptions.create({
      customer: stripeCustomerId,
      items: [{ price: priceId, quantity: 1 }],
      discounts: [{ coupon: coupon.id }],
      payment_behavior: "default_incomplete",
      collection_method: "send_invoice",
      days_until_due: 30,
      metadata: {
        dealerId: dealer.id,
        kind: "admin_grant",
        grantedBy: guard.email,
        freeMonths: String(freeMonths),
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to create comped subscription.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }

  // Set the dealer's plan + reset trialUrlAddsUsed to mirror what the
  // webhook would do on a normal upgrade.
  await prisma.dealer.update({
    where: { id: dealer.id },
    data: {
      plan: plan as "starter" | "pro" | "enterprise",
      trialUrlAddsUsed: 0,
    },
  });

  await writeAuditLog({
    action: "grant_plan",
    actorEmail: guard.email,
    actorRole: guard.role,
    targetDealerId: dealer.id,
    metadata: {
      plan,
      freeMonths,
      couponId: coupon.id,
      subscriptionId: subscription.id,
    },
  });

  return NextResponse.json({
    ok: true,
    dealerId: dealer.id,
    plan,
    freeMonths,
    couponId: coupon.id,
    subscriptionId: subscription.id,
  });
}
