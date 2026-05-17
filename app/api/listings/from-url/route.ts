import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkSubscription } from "@/lib/checkSubscription";
import { rateLimit } from "@/lib/rateLimit";
import { getEffectiveDealerId } from "@/lib/impersonation";
import { firecrawlClient } from "@/lib/firecrawl";
import { dispatchFeedDeliveryInBackground } from "@/lib/metaDelivery";
import {
  ECOMMERCE_JSON_SCHEMA,
  SERVICES_JSON_SCHEMA,
  SERVICES_EXTRACTION_PROMPT,
  REALESTATE_JSON_SCHEMA,
  REALESTATE_EXTRACTION_PROMPT,
} from "@/lib/extractionSchema";
import {
  canonicalizeUrl,
  isDuplicateCanonicalUrl,
  applyServicesFallbacks,
  buildFieldSources,
  checkServicesCompleteness,
  computeIsHighQuality,
} from "@/lib/serviceUrlValidator";
import { getRequiredFields } from "@/lib/verticals";
import { validateAndRehostServiceImage } from "@/lib/imageValidator";
import { logServiceImageValidation } from "@/lib/logger";
import type { Prisma } from "@prisma/client";

const EXTRACTION_PROMPT = `
Extract the following product information from this e-commerce product page:
- title: the product title/name
- description: a brief product description
- price: the listed price as a string (e.g., "$29.99")
- brand: the brand or manufacturer name
- condition: one of "new", "used", or "refurbished"
- availability: one of "in stock" or "out of stock"
- retailer_id: the SKU, item number, or retailer product ID
- image_url: URL of the main product image
- image_url_2: URL of the second product image (if available)
- google_product_category: the product category (if available)

Return null for any field you cannot find.
`;

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const dealerId = await getEffectiveDealerId();
  if (!dealerId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const isSubscribed = await checkSubscription(dealerId);
  if (!isSubscribed) {
    return NextResponse.json({ error: "subscription_required" }, { status: 403 });
  }

  // Pre-parse body so we can look at an optional `subAccountId` before the
  // vertical check. Multi-vertical accounts use sub-accounts to host inventory
  // for verticals other than the parent dealer's primary vertical, so we must
  // honour the active sub-account when deciding which vertical to use.
  let parsedBody: Record<string, unknown> = {};
  try {
    parsedBody = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const requestedSubAccountId =
    typeof parsedBody.subAccountId === "string" && parsedBody.subAccountId.length > 0
      ? parsedBody.subAccountId
      : null;

  const dealer = await prisma.dealer.findUnique({
    where: { id: dealerId },
    select: {
      vertical: true,
      name: true,
      address: true,
      defaultSubAccountId: true,
      subAccounts: {
        select: { id: true, vertical: true, name: true },
      },
    },
  });

  if (!dealer) {
    return NextResponse.json({ error: "dealer_not_found" }, { status: 404 });
  }

  // Resolve effective vertical: prefer the active sub-account if one is
  // provided (and owned by this dealer), then default sub-account, then the
  // parent dealer's vertical as a last resort.
  let resolvedSubAccountId: string | null = null;
  let vertical = dealer.vertical as string;

  if (requestedSubAccountId) {
    const sub = dealer.subAccounts.find((s) => s.id === requestedSubAccountId);
    if (!sub) {
      return NextResponse.json({ error: "sub_account_not_found" }, { status: 404 });
    }
    resolvedSubAccountId = sub.id;
    vertical = sub.vertical;
  } else if (dealer.defaultSubAccountId) {
    const sub = dealer.subAccounts.find((s) => s.id === dealer.defaultSubAccountId);
    if (sub) {
      resolvedSubAccountId = sub.id;
      vertical = sub.vertical;
    }
  }

  if (
    vertical !== "ecommerce" &&
    vertical !== "services" &&
    vertical !== "realestate"
  ) {
    return NextResponse.json(
      { error: "URL scraping is only available for the E-commerce, Services, and Real Estate verticals" },
      { status: 400 }
    );
  }

  const rl = rateLimit(`scrape-listing:${dealerId}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate_limited", retryAfterMs: rl.retryAfterMs }, { status: 429 });
  }

  const { url } = parsedBody;

  if (!url || typeof url !== "string" || !isValidUrl(url)) {
    return NextResponse.json({ error: "invalid_url" }, { status: 400 });
  }

  // Canonicalize + dedupe for services vertical
  let canonicalUrl: string | null = null;
  if (vertical === "services") {
    try {
      canonicalUrl = canonicalizeUrl(url);
    } catch {
      return NextResponse.json({ error: "invalid_url" }, { status: 400 });
    }
    const isDuplicate = await isDuplicateCanonicalUrl(dealerId, canonicalUrl);
    if (isDuplicate) {
      return NextResponse.json({ error: "duplicate_canonical_url" }, { status: 409 });
    }
  }

  // Create a stub listing row with pending status in data
  const listing = await prisma.listing.create({
    data: {
      dealerId,
      subAccountId: resolvedSubAccountId,
      vertical,
      title: url,
      url,
      isComplete: false,
      missingFields: [],
      data: { scrapeStatus: "pending", url },
      ...(vertical === "services"
        ? { publishStatus: "draft", canonicalUrl }
        : {}),
    },
  });

  // Track inline scrape completion so we can return the full payload to the client.
  let inlineScrapeCompleted = false;
  let inlineTitle: string = url;
  let inlineData: Record<string, unknown> = {};
  let inlineImageUrls: string[] = [];
  let inlineMissingFields: string[] = [];

  // Dispatch scraping: use fire-and-forget if SYNC_SECRET is set, otherwise inline fallback
  if (process.env.SYNC_SECRET) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    fetch(`${appUrl}/api/listings/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sync-secret": process.env.SYNC_SECRET,
      },
      body: JSON.stringify({
        listingId: listing.id,
        url,
        dealerId,
        vertical,
        dealerName: dealer.name,
        dealerAddress: dealer.address,
      }),
    }).catch((err) => {
      console.error({
        event: "listing_scrape_dispatch_error",
        listingId: listing.id,
        url,
        message: err instanceof Error ? err.message : String(err),
      });
    });
  } else {
    console.warn({ event: "sync_secret_missing", hint: "Falling back to inline listing scrape" });
    try {
      const schema =
        vertical === "services"
          ? SERVICES_JSON_SCHEMA
          : vertical === "realestate"
          ? REALESTATE_JSON_SCHEMA
          : ECOMMERCE_JSON_SCHEMA;
      const prompt =
        vertical === "services"
          ? SERVICES_EXTRACTION_PROMPT
          : vertical === "realestate"
          ? REALESTATE_EXTRACTION_PROMPT
          : EXTRACTION_PROMPT;
      // See app/api/listings/scrape/route.ts for the rationale on these
      // Firecrawl options. The inline path (no SYNC_SECRET) mirrors the
      // async path's hardening so both branches behave the same on hard
      // pages like Zillow, Realtor, and Redfin.
      const isHardPage = vertical === "realestate" || vertical === "services";
      const response = await firecrawlClient.scrape(url, {
        formats: [{ type: "json", prompt, schema: schema as Record<string, unknown> }],
        ...(isHardPage
          ? {
              proxy: "auto" as const,
              waitFor: 2500,
              mobile: true,
              onlyMainContent: true,
              timeout: 60_000,
            }
          : {}),
      });

      const extractionPayload = (response as { json?: unknown })?.json;
      const rawData = (extractionPayload !== null && typeof extractionPayload === "object"
        ? extractionPayload
        : {}) as Record<string, unknown>;

      const populatedFieldCount = Object.values(rawData).filter(
        (v) => v !== null && v !== undefined && v !== "" &&
          !(Array.isArray(v) && v.length === 0)
      ).length;
      if (populatedFieldCount === 0) {
        console.warn({
          event: "scrape_extraction_empty",
          listingId: listing.id,
          url,
          dealerId,
          vertical,
          hint: "Firecrawl returned 200 but the LLM extractor found no fields—likely anti-bot wall, login gate, or post-load render.",
        });
      }

      // Real estate uses `name` as title source; other verticals use `title`.
      const titleSource =
        vertical === "realestate" && typeof rawData.name === "string" && rawData.name
          ? rawData.name
          : typeof rawData.title === "string" && rawData.title
          ? rawData.title
          : null;
      const title = titleSource ?? url;

      let price: number | null = null;
      const priceRaw = rawData.price;
      if (priceRaw != null) {
        if (vertical === "services") {
          const numericOnly = String(priceRaw).trim().replace(/^\$/, "").replace(/,/g, "");
          if (/^\d+(\.\d+)?$/.test(numericOnly)) {
            price = parseFloat(numericOnly);
          }
        } else {
          // ecommerce + realestate: strip currency symbols/commas, take the number.
          const parsed = parseFloat(String(priceRaw).replace(/[^0-9.]/g, ""));
          price = Number.isFinite(parsed) ? parsed : null;
        }
      }

      const imageUrls: string[] = [];
      if (vertical === "services" || vertical === "realestate") {
        // Both use `images: string[]` from the extraction schema (full gallery).
        if (Array.isArray(rawData.images)) {
          for (const img of rawData.images) {
            if (typeof img === "string" && img.trim().length > 0) {
              imageUrls.push(img);
            }
          }
        }
      } else {
        if (typeof rawData.image_url === "string" && rawData.image_url) {
          imageUrls.push(rawData.image_url);
        }
        if (typeof rawData.image_url_2 === "string" && rawData.image_url_2) {
          imageUrls.push(rawData.image_url_2);
        }
      }

      // Validate and re-host services images
      if (vertical === "services" && imageUrls.length > 0) {
        for (let i = imageUrls.length - 1; i >= 0; i--) {
          try {
            const originalUrl = imageUrls[i];
            const { finalUrl, validation } = await validateAndRehostServiceImage(originalUrl, dealerId, listing.id);
            logServiceImageValidation({
              listingId: listing.id,
              imageLink: originalUrl,
              httpStatus: validation.httpStatus,
              contentType: validation.contentType,
              redirectChain: validation.redirectChain,
              isCrawlerSafe: validation.isCrawlerSafe,
              failureReason: validation.failureReason,
              rehosted: finalUrl !== originalUrl,
              rehostedUrl: finalUrl !== originalUrl ? finalUrl : null,
            });
            if (validation.isCrawlerSafe) {
              imageUrls[i] = finalUrl;
            } else {
              imageUrls.splice(i, 1);
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.log({ event: "image_validation_error", listingId: listing.id, imageUrl: imageUrls[i], message });
            imageUrls.splice(i, 1);
            continue;
          }
        }
      }

      const data: Record<string, unknown> = {
        ...rawData,
        scrapeStatus: "complete",
        url,
      };

      let isComplete: boolean;
      let missingFields: string[];

      if (vertical === "services") {
        // Mirror `name` into `data` so completeness/fallback logic can read it.
        if (!data.name && typeof rawData.title === "string") {
          data.name = rawData.title;
        }
        const { fallbackKeys } = applyServicesFallbacks(data, {
          name: dealer.name,
          address: dealer.address,
        });
        // Bridge images → image_url so buildFieldSources sees scraped images
        if (imageUrls.length > 0) {
          data.image_url = imageUrls[0];
        }
        if (imageUrls.length === 0) {
          imageUrls.push("https://placehold.co/600x400?text=No+Image");
          fallbackKeys.add("image_url");
        }
        const fieldSources = buildFieldSources(data, fallbackKeys);
        data.fieldSources = fieldSources;
        data.isHighQuality = computeIsHighQuality(fieldSources);
        const completeness = checkServicesCompleteness(data, imageUrls, title);
        isComplete = completeness.isComplete;
        missingFields = completeness.missingFields;
      } else {
        const requiredFields = getRequiredFields(vertical);
        missingFields = requiredFields.filter((f) => {
          if (f === "image_url") return false;
          if (f === "title" || f === "name") {
            return !title || title.trim() === "";
          }
          const val = data[f];
          return val === undefined || val === null || val === "";
        });
        if (requiredFields.includes("image_url") && imageUrls.length === 0) {
          missingFields.push("image_url");
        }
        isComplete = missingFields.length === 0;
      }

      await prisma.listing.update({
        where: { id: listing.id },
        data: {
          title,
          price: price != null && Number.isFinite(price) ? price : null,
          imageUrls,
          url,
          isComplete,
          missingFields,
          data: data as Prisma.InputJsonValue,
          ...(vertical === "services"
            ? { publishStatus: "draft", canonicalUrl }
            : {}),
        },
      });

      // Inline fallback branch: dispatch Meta delivery after successful scrape
      dispatchFeedDeliveryInBackground(dealerId, "listings/from-url/inline", after);

      inlineScrapeCompleted = true;
      inlineTitle = title;
      inlineData = data;
      inlineImageUrls = imageUrls;
      inlineMissingFields = missingFields;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error({ event: "inline_listing_scrape_error", listingId: listing.id, url, dealerId, message });
      try {
        await prisma.listing.update({
          where: { id: listing.id },
          data: {
            data: { scrapeStatus: "failed", url, error: message } as Prisma.InputJsonValue,
          },
        });
      } catch (fallbackErr) {
        console.error({
          event: "inline_listing_scrape_fallback_error",
          listingId: listing.id,
          message: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        });
      }
    }
  }

  // Mark CrawlSnapshot as added to feed (if it exists) — best-effort but awaited
  try {
    await prisma.crawlSnapshot.updateMany({
      where: { dealerId, url },
      data: { addedToFeed: true },
    });
  } catch (err: unknown) {
    console.error({
      event: "snapshot_mark_feed_error",
      dealerId,
      url,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  if (inlineScrapeCompleted) {
    return NextResponse.json(
      {
        listing: {
          id: listing.id,
          scrapeStatus: "complete",
          url,
          title: inlineTitle,
          data: inlineData,
          imageUrls: inlineImageUrls,
          missingFields: inlineMissingFields,
        },
      },
      { status: 200 }
    );
  }

  return NextResponse.json(
    { listing: { id: listing.id, scrapeStatus: "pending", url } },
    { status: 202 }
  );
}
