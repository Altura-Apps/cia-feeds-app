// GET /api/admin/coupons
//
// Lists all beta promotion codes (those minted via /api/admin/coupons/beta).
// Used by /admin/coupons UI.
//
// Security: requires manage_accounts capability (super_admin only).

import { NextResponse } from "next/server";
import { adminGuard } from "@/lib/auth";
import { stripeClient } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await adminGuard("manage_accounts");
  if (!guard.ok) return guard.response!;

  // Pull a reasonable page of recent promo codes. Stripe doesn't support
  // filtering by metadata server-side, so we filter client-side.
  const result = await stripeClient.promotionCodes.list({ limit: 100 });

  const rows = result.data
    .filter((p) => p.metadata?.kind === "beta_access")
    .map((p) => {
      const coupon = p.coupon;
      return {
        code: p.code,
        promotionCodeId: p.id,
        couponId: coupon.id,
        active: p.active,
        timesRedeemed: p.times_redeemed,
        maxRedemptions: p.max_redemptions,
        expiresAt: p.expires_at
          ? new Date(p.expires_at * 1000).toISOString()
          : null,
        createdAt: new Date(p.created * 1000).toISOString(),
        percentOff: coupon.percent_off,
        durationMonths: coupon.duration_in_months,
        createdBy: (p.metadata?.created_by as string) ?? null,
        note: (coupon.metadata?.note as string) ?? null,
      };
    });

  return NextResponse.json({ rows });
}
