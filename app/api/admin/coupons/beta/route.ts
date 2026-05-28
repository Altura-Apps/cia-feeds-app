// POST /api/admin/coupons/beta
//
// Mint a 100%-off Stripe coupon + promotion code for beta users so they can
// sign up without a credit card.
//
// Body (all optional):
//   {
//     code?: string;          // explicit promotion-code string the beta user types; auto-generated if omitted
//     durationMonths?: number; // 1..36. Default: 12 (one year of free service).
//                              // Use a finite duration so the coupon eventually expires
//                              // and the user is prompted to add a card before paid renewal.
//     maxRedemptions?: number; // 1..1000. Default: 1 (single-use, hand to one user).
//     expiresInDays?: number;  // 1..365. Default: 30. Promotion-code stops accepting new uses after this.
//     note?: string;           // free-text label, stored on the coupon for your bookkeeping
//   }
//
// Response:
//   {
//     ok: true,
//     code: "BETA-ABC123",                     // share this with the user
//     promotionCodeId: "promo_...",
//     couponId: "...",
//     subscribeUrl: "https://www.ciafeed.com/subscribe?promo=BETA-ABC123",
//     durationMonths: 12,
//     maxRedemptions: 1,
//     expiresAt: "2026-06-27T..."
//   }
//
// Security:
//   - Requires manage_accounts capability (super_admin only).
//   - All mints are written to the admin audit log so you can see who handed
//     out which beta code.

import { NextRequest, NextResponse } from "next/server";
import { adminGuard } from "@/lib/auth";
import { stripeClient } from "@/lib/stripe";
import { writeAuditLog } from "@/lib/adminAudit";
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";

function generateCode(): string {
  // 5 bytes -> 8 base32-ish chars; avoid ambiguous chars (0/O, 1/I/L)
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(5);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `BETA-${out}`;
}

function clampInt(
  raw: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw === undefined || raw === null) return fallback;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export async function POST(request: NextRequest) {
  const guard = await adminGuard("manage_accounts");
  if (!guard.ok) return guard.response!;

  let body: {
    code?: unknown;
    durationMonths?: unknown;
    maxRedemptions?: unknown;
    expiresInDays?: unknown;
    note?: unknown;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // empty body is fine
  }

  const durationMonths = clampInt(body.durationMonths, 12, 1, 36);
  const maxRedemptions = clampInt(body.maxRedemptions, 1, 1, 1000);
  const expiresInDays = clampInt(body.expiresInDays, 30, 1, 365);
  const note =
    typeof body.note === "string" ? body.note.slice(0, 200) : null;

  // Normalize the user-supplied code or auto-generate.
  let code: string;
  if (typeof body.code === "string" && body.code.trim()) {
    const trimmed = body.code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,40}$/.test(trimmed)) {
      return NextResponse.json(
        { error: "code must be 3-40 chars, A-Z 0-9 _ - only" },
        { status: 400 }
      );
    }
    code = trimmed;
  } else {
    code = generateCode();
  }

  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  const expiresAtUnix = Math.floor(expiresAt.getTime() / 1000);

  try {
    // 1. Create the underlying 100%-off coupon.
    //    'repeating' duration with duration_in_months means it discounts each
    //    of the first N invoices. After that, the subscription renews at full
    //    price -- and since payment_method_collection='if_required' was used
    //    at checkout, Stripe will email the customer to add a card before
    //    the first non-zero invoice.
    const coupon = await stripeClient.coupons.create({
      percent_off: 100,
      duration: "repeating",
      duration_in_months: durationMonths,
      name: note ?? `Beta access (${durationMonths}mo)`,
      metadata: {
        kind: "beta_access",
        created_by: guard.email,
        note: note ?? "",
      },
    });

    // 2. Create a customer-facing promotion code that wraps the coupon.
    const promotionCode = await stripeClient.promotionCodes.create({
      coupon: coupon.id,
      code,
      max_redemptions: maxRedemptions,
      expires_at: expiresAtUnix,
      metadata: {
        kind: "beta_access",
        created_by: guard.email,
      },
    });

    // 3. Audit log so we know who handed out which code.
    await writeAuditLog({
      action: "beta_coupon_created",
      actorEmail: guard.email,
      actorRole: guard.role,
      metadata: {
        code: promotionCode.code,
        promotionCodeId: promotionCode.id,
        couponId: coupon.id,
        durationMonths,
        maxRedemptions,
        expiresAt: expiresAt.toISOString(),
        note,
      },
    });

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
    const subscribeUrl = `${appUrl}/subscribe?promo=${encodeURIComponent(
      promotionCode.code
    )}`;

    return NextResponse.json({
      ok: true,
      code: promotionCode.code,
      promotionCodeId: promotionCode.id,
      couponId: coupon.id,
      subscribeUrl,
      durationMonths,
      maxRedemptions,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    const stripeError = err as { code?: string; message?: string };
    if (stripeError?.code === "resource_already_exists") {
      return NextResponse.json(
        { error: "A promotion code with that exact string already exists." },
        { status: 409 }
      );
    }
    console.error({
      event: "beta_coupon_create_failed",
      message: stripeError?.message,
    });
    return NextResponse.json(
      { error: "Failed to create beta coupon." },
      { status: 500 }
    );
  }
}
