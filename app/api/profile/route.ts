import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { checkSubscription } from "@/lib/checkSubscription";
import { getEffectiveDealerContext } from "@/lib/impersonation";
import { authOptions } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { VERTICAL_META_TYPE, VALID_VERTICALS, type Vertical } from "@/lib/verticals";
import { API_SUPPORTED_VERTICALS } from "@/lib/metaDelivery";
import { loadDealerToken } from "@/lib/meta";
import { writeAuditLog } from "@/lib/adminAudit";
import { normalizePhoneE164 } from "@/lib/twilio";

const VALID_CTA_PREFERENCES = ["sms", "whatsapp", "messenger", "ai_chat"];
const VALID_TRANSLATION_LANGS = ["en", "es-MX", "es-PR", "pt-BR", "ko-KR", "fr", "de"];
const VALID_TRANSLATION_TONES = ["professional", "funny", "luxury"];

const SAFE_SELECT = {
  id: true,
  name: true,
  email: true,
  slug: true,
  profileImageUrl: true,
  vertical: true,
  websiteUrl: true,
  autoCrawlEnabled: true,
  urlHealthCheckEnabled: true,
  address: true,
  phone: true,
  ctaPreference: true,
  aiChatEnabled: true,
  aiChatDefaultLocale: true,
  bdcEmail: true,
  bdcPhone: true,
  translationLang: true,
  translationTone: true,
  latitude: true,
  longitude: true,
  metaPixelId: true,
  metaTokenType: true,
  metaTokenExpiresAt: true,
  metaCatalogOwnership: true,
  metaAdAccountId: true,
  metaConnectedAt: true,
  metaDeliveryMethod: true,
  feedUrlMode: true,
} as const;

export async function GET() {
  const { effectiveDealerId } = await getEffectiveDealerContext();
  if (!effectiveDealerId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const dealer = await prisma.dealer.findUnique({
    where: { id: effectiveDealerId },
    select: SAFE_SELECT,
  });

  if (!dealer) {
    return NextResponse.json({ error: "dealer_not_found" }, { status: 404 });
  }

  return NextResponse.json({ dealer });
}

export async function PATCH(request: NextRequest) {
  const { effectiveDealerId } = await getEffectiveDealerContext();
  if (!effectiveDealerId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const isSubscribed = await checkSubscription(effectiveDealerId);
  if (!isSubscribed) {
    return NextResponse.json({ error: "subscription_required" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;

  try {
  // Collect simple field updates into a single batch
  const batchData: Record<string, unknown> = {};
  let pendingDeliveryChange: { previousMethod: string | null; newMethod: string } | null = null;

  // Handle profile image removal
  if ("profileImageUrl" in b && b.profileImageUrl === null) {
    batchData.profileImageUrl = null;
  }

  // Handle websiteUrl update
  if ("websiteUrl" in b) {
    const websiteUrl = b.websiteUrl;
    if (websiteUrl !== null && typeof websiteUrl !== "string") {
      return NextResponse.json({ error: "invalid_websiteUrl" }, { status: 400 });
    }
    const urlToSave = typeof websiteUrl === "string" && websiteUrl.trim() ? websiteUrl.trim() : null;
    if (urlToSave) {
      try {
        const parsed = new URL(urlToSave);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return NextResponse.json({ error: "invalid_websiteUrl" }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ error: "invalid_websiteUrl" }, { status: 400 });
      }
    }
    batchData.websiteUrl = urlToSave;
  }

  // Handle address update (+ geocoding) — kept separate due to side effects
  if ("address" in b) {
    const rawAddress = b.address;
    if (rawAddress !== null && typeof rawAddress !== "string") {
      return NextResponse.json({ error: "invalid_address" }, { status: 400 });
    }
    const addressToSave =
      typeof rawAddress === "string" && rawAddress.trim() ? rawAddress.trim() : null;

    if (addressToSave === null) {
      await prisma.dealer.update({
        where: { id: effectiveDealerId },
        data: { address: null, latitude: null, longitude: null },
      });
    } else {
      try {
        const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
          addressToSave
        )}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
        const res = await fetch(geocodeUrl);
        if (!res.ok) {
          return NextResponse.json({ error: "geocoding_failed" }, { status: 400 });
        }
        const data = (await res.json()) as {
          status?: string;
          results?: Array<{
            geometry?: { location?: { lat?: number; lng?: number } };
          }>;
        };
        const location = data?.results?.[0]?.geometry?.location;
        const lat = location?.lat;
        const lng = location?.lng;
        if (
          data?.status !== "OK" ||
          typeof lat !== "number" ||
          typeof lng !== "number"
        ) {
          return NextResponse.json({ error: "geocoding_failed" }, { status: 400 });
        }
        await prisma.dealer.update({
          where: { id: effectiveDealerId },
          data: { address: addressToSave, latitude: lat, longitude: lng },
        });
      } catch {
        return NextResponse.json({ error: "geocoding_failed" }, { status: 400 });
      }
    }
  }

  // Handle phone update. We normalize to E.164 on write so SMS inbound
  // matching (lib/twilio.ts:normalizePhoneE164) can do a clean equality
  // lookup against this column. Accepting any format from the UI (parens,
  // hyphens, spaces, leading +) and emitting canonical E.164.
  if ("phone" in b) {
    const rawPhone = b.phone;
    if (rawPhone !== null && typeof rawPhone !== "string") {
      return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
    }
    const trimmed = typeof rawPhone === "string" ? rawPhone.trim() : null;

    if (!trimmed) {
      batchData.phone = null;
    } else {
      const normalized = normalizePhoneE164(trimmed);
      if (!normalized) {
        return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
      }
      batchData.phone = normalized;
    }
  }

  // Handle aiChatDefaultLocale update
  if ("aiChatDefaultLocale" in b) {
    const v = b.aiChatDefaultLocale;
    if (typeof v === "string" && ["auto", "en", "es"].includes(v)) {
      batchData.aiChatDefaultLocale = v;
    } else {
      return NextResponse.json({ error: "invalid_ai_chat_locale" }, { status: 400 });
    }
  }

  // Handle aiChatEnabled toggle (independent of ctaPreference; lets a dealer
  // turn AI chat on as a secondary feature without forcing it as their primary CTA)
  if ("aiChatEnabled" in b) {
    batchData.aiChatEnabled = Boolean(b.aiChatEnabled);
  }

  // BDC contact for AI Chat lead alerts
  if ("bdcEmail" in b) {
    const v = b.bdcEmail;
    if (v === null || v === "") {
      batchData.bdcEmail = null;
    } else if (typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())) {
      batchData.bdcEmail = v.trim().toLowerCase();
    } else {
      return NextResponse.json({ error: "invalid_bdc_email" }, { status: 400 });
    }
  }
  if ("bdcPhone" in b) {
    const v = b.bdcPhone;
    if (v === null || v === "") {
      batchData.bdcPhone = null;
    } else {
      const normalized = normalizePhoneE164(typeof v === "string" ? v : null);
      if (!normalized) {
        return NextResponse.json({ error: "invalid_bdc_phone" }, { status: 400 });
      }
      batchData.bdcPhone = normalized;
    }
  }

  // Handle ctaPreference update
  if ("ctaPreference" in b) {
    const rawCta = b.ctaPreference;
    if (rawCta === null) {
      batchData.ctaPreference = null;
    } else if (typeof rawCta !== "string" || !VALID_CTA_PREFERENCES.includes(rawCta)) {
      return NextResponse.json({ error: "invalid_cta_preference" }, { status: 400 });
    } else {
      batchData.ctaPreference = rawCta as "sms" | "whatsapp" | "messenger" | "ai_chat";
    }
  }

  // Handle translationLang update
  if ("translationLang" in b) {
    const rawLang = b.translationLang;
    if (rawLang === null) {
      batchData.translationLang = null;
    } else if (typeof rawLang !== "string" || !VALID_TRANSLATION_LANGS.includes(rawLang)) {
      return NextResponse.json({ error: "invalid_translationLang" }, { status: 400 });
    } else {
      batchData.translationLang = rawLang;
    }
  }

  // Handle translationTone update
  if ("translationTone" in b) {
    const rawTone = b.translationTone;
    if (rawTone === null) {
      batchData.translationTone = null;
    } else if (typeof rawTone !== "string" || !VALID_TRANSLATION_TONES.includes(rawTone)) {
      return NextResponse.json({ error: "invalid_translationTone" }, { status: 400 });
    } else {
      batchData.translationTone = rawTone;
    }
  }

  // Handle autoCrawlEnabled toggle
  if ("autoCrawlEnabled" in b) {
    if (typeof b.autoCrawlEnabled !== "boolean") {
      return NextResponse.json({ error: "invalid_autoCrawlEnabled" }, { status: 400 });
    }
    batchData.autoCrawlEnabled = b.autoCrawlEnabled;
  }

  // Handle urlHealthCheckEnabled toggle
  if ("urlHealthCheckEnabled" in b) {
    if (typeof b.urlHealthCheckEnabled !== "boolean") {
      return NextResponse.json({ error: "invalid_urlHealthCheckEnabled" }, { status: 400 });
    }
    batchData.urlHealthCheckEnabled = b.urlHealthCheckEnabled;
  }

  // Handle feedUrlMode update
  if ("feedUrlMode" in b) {
    if (typeof b.feedUrlMode !== "string" || (b.feedUrlMode !== "original" && b.feedUrlMode !== "landing")) {
      return NextResponse.json({ error: "invalid_feedUrlMode" }, { status: 400 });
    }
    batchData.feedUrlMode = b.feedUrlMode;
  }

  // Handle metaDeliveryMethod update
  if ("metaDeliveryMethod" in b) {
    const raw = b.metaDeliveryMethod;
    if (typeof raw !== "string" || (raw !== "csv" && raw !== "api")) {
      return NextResponse.json({ error: "invalid_metaDeliveryMethod" }, { status: 400 });
    }

    // Fetch current value for audit before/after state
    const dealerForDelivery = await prisma.dealer.findUnique({
      where: { id: effectiveDealerId },
      select: { vertical: true, metaCatalogId: true, metaAccessToken: true, metaTokenExpiresAt: true, metaDeliveryMethod: true },
    });
    if (!dealerForDelivery) {
      return NextResponse.json({ error: "dealer_not_found" }, { status: 404 });
    }

    if (raw === "api") {
      const issues: string[] = [];
      if (!API_SUPPORTED_VERTICALS.has(dealerForDelivery.vertical)) {
        issues.push("api_delivery_unsupported_vertical");
      }
      if (!dealerForDelivery.metaCatalogId) {
        issues.push("catalog_not_selected");
      }
      if (!dealerForDelivery.metaAccessToken) {
        issues.push("meta_token_missing");
      } else {
        try {
          await loadDealerToken(effectiveDealerId);
        } catch {
          issues.push("meta_token_decrypt_failed");
        }
      }
      if (dealerForDelivery.metaTokenExpiresAt && dealerForDelivery.metaTokenExpiresAt <= new Date()) {
        issues.push("meta_token_expired");
      }
      if (issues.length > 0) {
        return NextResponse.json(
          { error: "api_delivery_not_ready", issues },
          { status: 400 }
        );
      }
    }
    // Only include in batch if value is unchanged; otherwise handle in transaction below
    const previousMethod = dealerForDelivery.metaDeliveryMethod;
    if (previousMethod === raw) {
      // No change — skip audit and transactional write
      batchData.metaDeliveryMethod = raw;
    } else {
      // Track for post-batch transactional update + audit
      pendingDeliveryChange = { previousMethod, newMethod: raw };
    }
  }

  // Handle metaPixelId update
  if ("metaPixelId" in b) {
    const rawPixelId = b.metaPixelId;
    if (rawPixelId !== null && typeof rawPixelId !== "string") {
      return NextResponse.json({ error: "invalid_metaPixelId" }, { status: 400 });
    }
    const pixelToSave = typeof rawPixelId === "string" && rawPixelId.trim() ? rawPixelId.trim() : null;
    batchData.metaPixelId = pixelToSave;
  }

  // Perform a single DB write for all simple field updates
  if (Object.keys(batchData).length > 0) {
    await prisma.dealer.update({
      where: { id: effectiveDealerId },
      data: batchData,
    });
  }

  // Transactional delivery method update + audit (only when value actually changed)
  if (pendingDeliveryChange) {
    const session = await getServerSession(authOptions);
    const actorEmail = session?.user?.email ?? "unknown";
    await prisma.$transaction(async (tx) => {
      await tx.dealer.update({
        where: { id: effectiveDealerId },
        data: { metaDeliveryMethod: pendingDeliveryChange!.newMethod },
      });
      await writeAuditLog({
        action: "profile.meta_delivery_method.update",
        actorEmail,
        actorRole: "dealer",
        actorDealerId: effectiveDealerId,
        targetDealerId: effectiveDealerId,
        beforeState: { metaDeliveryMethod: pendingDeliveryChange!.previousMethod },
        afterState: { metaDeliveryMethod: pendingDeliveryChange!.newMethod },
      }, tx);
    });
  }

  // Handle vertical switch — kept separate due to Meta API side effects
  if ("vertical" in b) {
    if (typeof b.vertical !== "string" || !(VALID_VERTICALS as readonly string[]).includes(b.vertical)) {
      return NextResponse.json({ error: "invalid_vertical" }, { status: 400 });
    }

    const newVertical = b.vertical as Vertical;

    const dealer = await prisma.dealer.findUnique({
      where: { id: effectiveDealerId },
      select: {
        vertical: true,
        metaAccessToken: true,
        metaFeedId: true,
        metaCatalogId: true,
        metaBusinessId: true,
        metaTokenType: true,
        metaTokenExpiresAt: true,
        metaCatalogOwnership: true,
        metaAdAccountId: true,
        metaConnectedAt: true,
        metaDeliveryMethod: true,
      },
    });

    if (!dealer) {
      return NextResponse.json({ error: "dealer_not_found" }, { status: 404 });
    }

    const oldVertical = dealer.vertical;

    if (oldVertical !== newVertical) {
      let accessToken: string | null = null;

      // Step 3: Delete old Meta feed (non-blocking)
      if (dealer.metaAccessToken && dealer.metaFeedId) {
        try {
          accessToken = decrypt(dealer.metaAccessToken);
          const metaFeedId = dealer.metaFeedId;
          const delRes = await fetch(
            `https://graph.facebook.com/v19.0/${metaFeedId}`,
            { method: "DELETE", headers: { 'Authorization': 'Bearer ' + accessToken } }
          );
          const delData = await delRes.json();
          console.log("fb_feed_delete_on_vertical_switch", { metaFeedId, ok: delRes.ok, delData });
        } catch (err) {
          console.error("fb_feed_delete_on_vertical_switch", err);
        }
      }

      // Step 3b: Delete old Meta catalog (non-blocking)
      if (dealer.metaAccessToken && dealer.metaCatalogId) {
        try {
          if (!accessToken) {
            accessToken = decrypt(dealer.metaAccessToken);
          }
          const oldCatalogId = dealer.metaCatalogId;
          const delCatRes = await fetch(
            `https://graph.facebook.com/v19.0/${oldCatalogId}`,
            { method: "DELETE", headers: { 'Authorization': 'Bearer ' + accessToken } }
          );
          const delCatData = await delCatRes.json();
          console.log("fb_catalog_delete_on_vertical_switch", { oldCatalogId, ok: delCatRes.ok, delCatData });
        } catch (err) {
          console.error("fb_catalog_delete_on_vertical_switch", err);
        }
      }

      // Step 4: Create new Meta catalog for new vertical (non-blocking)
      let newCatalogId: string | null = null;
      if (dealer.metaAccessToken && dealer.metaBusinessId) {
        try {
          if (!accessToken) {
            accessToken = decrypt(dealer.metaAccessToken);
          }
          const metaVertical = VERTICAL_META_TYPE[newVertical as Vertical] ?? "automotive_models";
          const catRes = await fetch(
            `https://graph.facebook.com/v19.0/${dealer.metaBusinessId}/owned_product_catalogs`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + accessToken,
              },
              body: JSON.stringify({
                name: "CIA Feed",
                vertical: metaVertical,
              }),
            }
          );
          const catData = (await catRes.json()) as { id?: string };
          if (catRes.ok && catData.id) {
            newCatalogId = catData.id;
            console.log("fb_catalog_recreate_on_vertical_switch", { newCatalogId });
          } else {
            console.error("fb_catalog_recreate_failed", catData);
          }
        } catch (err) {
          console.error("fb_catalog_recreate_failed", err);
        }
      }

      // Step 5: Hard-delete all dealer data and update vertical
      let updatedDealer;

      await prisma.$transaction(async (tx) => {
        await tx.crawlSnapshot.deleteMany({ where: { dealerId: effectiveDealerId } });
        await tx.crawlJob.deleteMany({ where: { dealerId: effectiveDealerId } });
        await tx.vehicle.deleteMany({ where: { dealerId: effectiveDealerId } });
        await tx.listing.deleteMany({ where: { dealerId: effectiveDealerId } });

        updatedDealer = await tx.dealer.update({
          where: { id: effectiveDealerId },
          data: {
            vertical: newVertical,
            metaFeedId: null,
            metaCatalogId: newCatalogId ?? null,
            // Auto-reset to CSV if new vertical doesn't support API delivery
            ...(!API_SUPPORTED_VERTICALS.has(newVertical) ? { metaDeliveryMethod: "csv" } : {}),
          },
          select: SAFE_SELECT,
        });
      });

      return NextResponse.json({ ok: true, dealer: updatedDealer });
    }
  }

  const currentDealer = await prisma.dealer.findUnique({
    where: { id: effectiveDealerId },
    select: SAFE_SELECT,
  });
  return NextResponse.json({ ok: true, dealer: currentDealer });

  } catch (err) {
    console.error("profile_patch_error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
