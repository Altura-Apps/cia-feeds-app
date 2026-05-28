// POST /api/admin/coupons/[id]/deactivate
//
// Deactivate a beta promotion code so it can no longer be redeemed by new
// users. Existing subscriptions that already redeemed the code keep their
// discount (Stripe behavior — deactivating a promotion code does not revoke
// active discounts; for that you'd need to update the subscription).
//
// [id] is the Stripe promotion_code id (promo_...).
//
// Security: requires manage_accounts capability (super_admin only).

import { NextResponse } from "next/server";
import { adminGuard } from "@/lib/auth";
import { stripeClient } from "@/lib/stripe";
import { writeAuditLog } from "@/lib/adminAudit";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await adminGuard("manage_accounts");
  if (!guard.ok) return guard.response!;

  const { id } = await params;
  if (!/^promo_[a-zA-Z0-9]+$/.test(id)) {
    return NextResponse.json({ error: "invalid_promo_id" }, { status: 400 });
  }

  try {
    const updated = await stripeClient.promotionCodes.update(id, {
      active: false,
    });

    await writeAuditLog({
      action: "beta_coupon_deactivated",
      actorEmail: guard.email,
      actorRole: guard.role,
      metadata: {
        promotionCodeId: id,
        code: updated.code,
      },
    });

    return NextResponse.json({ ok: true, code: updated.code });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e?.code === "resource_missing") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    console.error({ event: "beta_coupon_deactivate_failed", id, message: e?.message });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
