import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { API_SUPPORTED_VERTICALS } from "@/lib/metaDelivery";
import { loadDealerToken } from "@/lib/meta";
import { adminGuard } from "@/lib/auth";
import { criticalDurableRateLimit } from "@/lib/rateLimit";
import { adminMetaDeliverySchema, adminMetaDeliveryParamSchema } from "@/lib/requestSchemas";
import { writeAuditLog } from "@/lib/adminAudit";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limit (critical: fail-closed, keyed on IP + route for unauthenticated phase)
  const ip = (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const rl = await criticalDurableRateLimit(`admin-meta-delivery:${ip}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate_limited", retryAfterMs: rl.retryAfterMs }, { status: 429 });
  }

  // Admin authorization (allowlist + legacy fallback)
  const auth = await adminGuard("manage_delivery");
  if (!auth.ok) return auth.response!;

  // Post-auth actor-scoped rate limit (identity-aware abuse control)
  const actorRl = await criticalDurableRateLimit(
    `admin-meta-delivery:actor:${auth.email}:${ip}`,
    20,
    60_000
  );
  if (!actorRl.allowed) {
    return NextResponse.json({ error: "rate_limited", retryAfterMs: actorRl.retryAfterMs }, { status: 429 });
  }

  // Validate path param
  const rawParams = await params;
  const paramParsed = adminMetaDeliveryParamSchema.safeParse(rawParams);
  if (!paramParsed.success) {
    return NextResponse.json(
      { error: "validation_error", issues: paramParsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const { id } = paramParsed.data;

  // Validate request body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const bodyParsed = adminMetaDeliverySchema.safeParse(rawBody);
  if (!bodyParsed.success) {
    return NextResponse.json(
      { error: "validation_error", issues: bodyParsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const { metaDeliveryMethod } = bodyParsed.data;

  const dealer = await prisma.dealer.findUnique({
    where: { id },
    select: { id: true, vertical: true, metaCatalogId: true, metaAccessToken: true, metaTokenExpiresAt: true, metaDeliveryMethod: true },
  });
  if (!dealer) {
    return NextResponse.json({ error: "dealer_not_found" }, { status: 404 });
  }

  if (metaDeliveryMethod === "api") {
    const issues: string[] = [];
    if (!API_SUPPORTED_VERTICALS.has(dealer.vertical)) {
      issues.push("api_delivery_unsupported_vertical");
    }
    if (!dealer.metaCatalogId) {
      issues.push("catalog_not_selected");
    }
    if (!dealer.metaAccessToken) {
      issues.push("meta_token_missing");
    } else {
      try {
        await loadDealerToken(id);
      } catch {
        issues.push("meta_token_decrypt_failed");
      }
    }
    if (dealer.metaTokenExpiresAt && dealer.metaTokenExpiresAt <= new Date()) {
      issues.push("meta_token_expired");
    }
    if (issues.length > 0) {
      return NextResponse.json(
        { error: "api_delivery_not_ready", issues },
        { status: 400 }
      );
    }
  }

  // Transactional update + audit write
  const previousMethod = dealer.metaDeliveryMethod;
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.dealer.update({
      where: { id },
      data: { metaDeliveryMethod },
      select: { id: true, metaDeliveryMethod: true },
    });

    await writeAuditLog({
      action: "admin.meta_delivery.update",
      actorEmail: auth.email,
      actorRole: auth.role,
      targetDealerId: id,
      beforeState: { metaDeliveryMethod: previousMethod },
      afterState: { metaDeliveryMethod },
    }, tx);

    return result;
  });

  return NextResponse.json({ ok: true, dealer: updated });
}
