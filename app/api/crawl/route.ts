import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkSubscription } from "@/lib/checkSubscription";
import { getEffectiveDealerId } from "@/lib/impersonation";
import { firecrawlClient } from "@/lib/firecrawl";
import {
  filterDiscoveredUrls,
  VERTICAL_CRAWL_TARGETS,
  type Vertical,
} from "@/lib/crawlFilters";
import { getPlanLimits, type Plan } from "@/lib/planLimits";

// All four verticals can now be crawled — lib/crawlFilters.ts provides
// per-vertical patterns so each one sees only its own listing-detail pages.
const ALLOWED_CRAWL_VERTICALS: Vertical[] = [
  "automotive",
  "realestate",
  "services",
  "ecommerce",
];

/** URL patterns that indicate inventory/listing pages */
const INVENTORY_PATTERNS = [
  /\/inventory\//i,
  /\/vehicles?\//i,
  /\/used\//i,
  /\/new\//i,
  /\/products?\//i,
  /\/shop\//i,
  /\/listing\//i,
  /\/cars?\//i,
  /\/trucks?\//i,
  /\/suvs?\//i,
  /\/vdp\//i,
  /\/detail\//i,
  /\/vehicle-details\//i,
  /\/certified\//i,
];

/** Sub-paths to crawl in parallel for better inventory coverage */
const INVENTORY_SUBPATHS = [
  "/inventory",
  "/new-inventory",
  "/used-inventory",
];

/** URL patterns to exclude (non-listing pages) */
const EXCLUDE_PATTERNS = [
  /\/about/i,
  /\/contact/i,
  /\/blog/i,
  /\/careers/i,
  /\/privacy/i,
  /\/terms/i,
  /\/faq/i,
  /\/login/i,
  /\/signup/i,
  /\/account/i,
  /\/cart/i,
  /\/checkout/i,
  /\/sitemap/i,
  /\/feed/i,
  /\/rss/i,
  /\.pdf$/i,
  /\.xml$/i,
  /\.jpg$/i,
  /\.png$/i,
];

function isInventoryUrl(url: string): boolean {
  if (EXCLUDE_PATTERNS.some((p) => p.test(url))) return false;
  return INVENTORY_PATTERNS.some((p) => p.test(url));
}

/** Normalize a URL for deduplication: force https, strip trailing slashes, query params, fragments */
export function normalizeUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    parsed.protocol = "https:";
    parsed.search = "";
    parsed.hash = "";
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname.toLowerCase();
    return parsed.toString();
  } catch {
    return raw;
  }
}

const METADATA_BATCH_SIZE = 5;
const METADATA_BATCH_DELAY_MS = 500;

/** Parse make/model/year from a title string or URL slug */
function parseVehicleInfo(text: string): {
  make: string | null;
  model: string | null;
  year: number | null;
} {
  const normalized = text.replace(/[-_]/g, " ");
  const yearFirst = normalized.match(/\b(19\d{2}|20[0-3]\d)\b\s+(\w+)\s+(\w+)/i);
  if (yearFirst) {
    return {
      year: parseInt(yearFirst[1], 10),
      make: yearFirst[2],
      model: yearFirst[3],
    };
  }
  const yearLast = normalized.match(/\b(\w+)\s+(\w+)\s+(19\d{2}|20[0-3]\d)\b/i);
  if (yearLast) {
    return {
      year: parseInt(yearLast[3], 10),
      make: yearLast[1],
      model: yearLast[2],
    };
  }
  return { make: null, model: null, year: null };
}

function parsePrice(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) || num <= 0 ? null : num;
}

/** JSON Schema for Firecrawl structured extraction */
const VEHICLE_EXTRACT_SCHEMA = {
  type: "object" as const,
  properties: {
    title: {
      type: "string",
      description:
        "The full vehicle listing title exactly as displayed on the page. Search in order: 1) The first <h1> element on the page, 2) og:title meta tag, 3) JSON-LD 'name' field, 4) <title> tag. Example: '2023 Toyota Camry SE'. Return null if no title is found.",
    },
    price: {
      type: "string",
      description:
        "The listed sale price of the vehicle as a raw string (e.g. '$29,995' or '29995'). Search in order: 1) JSON-LD offers.price, offers.lowPrice, offers.highPrice, or offers.priceCurrency amount, 2) HTML elements whose class or id contains: 'price', 'sale-price', 'final-price', 'vehicle-price', 'internet-price', 'our-price', 'msrp', 'asking-price', 3) data-price, data-vehicle-price, data-sale-price, or data-msrp attributes on any element, 4) og:price:amount or product:price:amount meta tags. Exclude placeholder values such as 'Call for price', 'Contact us', 'Request a quote', '$0', or empty strings. Return null if no valid price is found.",
    },
    make: {
      type: "string",
      description:
        "Vehicle manufacturer/make (e.g. 'Toyota', 'Ford', 'Honda', 'Chevrolet'). Search in order: 1) JSON-LD 'brand.name' or 'manufacturer', 2) data-make or data-vehicle-make attributes, 3) breadcrumb navigation links, 4) parse from the listing title or <h1>. Return null if not determinable.",
    },
    model: {
      type: "string",
      description:
        "Vehicle model name (e.g. 'Camry', 'F-150', 'Civic', 'Silverado'). Search in order: 1) JSON-LD 'model' field, 2) data-model or data-vehicle-model attributes, 3) breadcrumb navigation links, 4) parse from the listing title or <h1>. Return null if not determinable.",
    },
    year: {
      type: "number",
      description:
        "Vehicle model year as a 4-digit integer between 1980 and 2030. Search in order: 1) JSON-LD 'vehicleModelDate' or 'modelDate', 2) data-year or data-vehicle-year attributes, 3) parse the first 4-digit year from the listing title or <h1>. Return null if not determinable.",
    },
    imageUrl: {
      type: "string",
      description:
        "Absolute http(s) URL of the primary vehicle photo. Search in order: 1) JSON-LD 'image' field, 2) og:image or og:image:secure_url meta tag, 3) twitter:image meta tag, 4) the first <img> inside a gallery, carousel, or hero container. Must start with 'http://' or 'https://'. Exclude placeholder images, 'no-image' defaults, spinner/loading GIFs, and dealer logo images. Return null if no valid vehicle photo is found.",
    },
  },
};

/** Fetch metadata for a single URL using Firecrawl structured extraction with OG fallback (non-fatal) */
async function fetchUrlMetadata(url: string): Promise<{
  title: string | null;
  thumbnailUrl: string | null;
  price: number | null;
  make: string | null;
  model: string | null;
  year: number | null;
}> {
  const empty = { title: null, thumbnailUrl: null, price: null, make: null, model: null, year: null };
  try {
    const result = await firecrawlClient.scrape(url, {
      formats: [
        "markdown",
        {
          type: "json",
          prompt: `You are extracting structured vehicle listing data from a dealer Vehicle Detail Page (VDP). Extract all six fields below.

TITLE – return the full listing title exactly as displayed:
1. The first <h1> element on the page
2. og:title meta tag
3. JSON-LD "name" field
4. <title> tag
Return null if no title is found.

PRICE – search these sources in order and return the first non-empty numeric value:
1. JSON-LD: "offers.price", "offers.lowPrice", "offers.highPrice", or "offers.priceCurrency" amount
2. HTML elements whose class or id contains: price, sale-price, final-price, vehicle-price, internet-price, our-price, msrp, asking-price
3. data-price, data-vehicle-price, data-sale-price, or data-msrp attributes on any element
4. og:price:amount or product:price:amount meta tags
Ignore "Call for price", "Contact us", "Request a quote", "$0", or empty values. Return null if no valid price is found.

IMAGE URL – return the first absolute http(s) URL found in this order:
1. JSON-LD "image" field
2. og:image or og:image:secure_url meta tag
3. twitter:image meta tag
4. The first <img> inside a gallery, carousel, or hero container
Exclude placeholder images, "no-image" defaults, spinner/loading GIFs, and dealer logo images. Return null if no valid vehicle photo is found.

MAKE – return the vehicle manufacturer:
1. JSON-LD "brand.name" or "manufacturer"
2. data-make or data-vehicle-make attributes
3. Breadcrumb navigation links
4. Parse from the listing title or <h1>
Return null if not determinable.

MODEL – return the vehicle model name:
1. JSON-LD "model" field
2. data-model or data-vehicle-model attributes
3. Breadcrumb navigation links
4. Parse from the listing title or <h1>
Return null if not determinable.

YEAR – return the model year as a 4-digit integer (1980–2030):
1. JSON-LD "vehicleModelDate" or "modelDate"
2. data-year or data-vehicle-year attributes
3. Parse the first 4-digit year from the listing title or <h1>
Return null if not determinable.

Return all values according to the provided schema.`,
          schema: VEHICLE_EXTRACT_SCHEMA,
        },
      ],
    });

    const extracted = result.json as {
      title?: string;
      price?: string | number;
      make?: string;
      model?: string;
      year?: number;
      imageUrl?: string;
    } | undefined;

    const meta = result.metadata;

    const extractedTitle = extracted?.title || null;
    const extractedImage = extracted?.imageUrl || null;
    const extractedPrice = extracted?.price != null ? parsePrice(String(extracted.price)) : null;
    const extractedMake = extracted?.make || null;
    const extractedModel = extracted?.model || null;
    const extractedYear = extracted?.year != null && !isNaN(extracted.year) ? extracted.year : null;

    const ogTitle = meta?.ogTitle || meta?.title || null;
    const metaRecord = meta as Record<string, string> | undefined;
    const ogImage = meta?.ogImage || metaRecord?.["og:image:secure_url"] || metaRecord?.["twitter:image"] || null;
    const ogPrice = metaRecord?.["og:price:amount"] ?? metaRecord?.["product:price:amount"] ?? null;

    const title = extractedTitle || ogTitle;
    const thumbnailUrl = extractedImage || ogImage;
    const price = extractedPrice ?? parsePrice(ogPrice);
    const make = extractedMake;
    const model = extractedModel;
    const year = extractedYear;

    if (!make && !model && !year) {
      const parsed = parseVehicleInfo(title || url);
      return { title, thumbnailUrl, price, make: parsed.make, model: parsed.model, year: parsed.year };
    }

    return { title, thumbnailUrl, price, make, model, year };
  } catch (err) {
    console.error({
      event: "metadata_fetch_error",
      url,
      message: err instanceof Error ? err.message : String(err),
    });
    return empty;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Geocode a dealer's address via OpenStreetMap Nominatim (no API key required).
 * Writes latitude/longitude back to the Dealer record. Never throws — failures
 * are logged but must not block the crawl.
 */
async function geocodeDealerAddressIfNeeded(dealerId: string): Promise<void> {
  try {
    const dealer = (await prisma.dealer.findUnique({
      where: { id: dealerId },
      select: {
        // These fields may not exist in the schema yet — the schema migration
        // phase adds them. Cast the select so TS accepts pre-migration builds.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        address: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        latitude: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        longitude: true,
      } as unknown as never,
    })) as unknown as {
      address?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    } | null;

    if (!dealer) return;
    if (!dealer.address || dealer.latitude != null) return;

    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      dealer.address
    )}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "cia-feeds-app/1.0 (dealer geocoding)",
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      console.error({
        event: "geocode_http_error",
        dealerId,
        status: res.status,
      });
      return;
    }
    const data = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    const first = data?.[0];
    const lat = first?.lat != null ? parseFloat(first.lat) : NaN;
    const lon = first?.lon != null ? parseFloat(first.lon) : NaN;
    if (isNaN(lat) || isNaN(lon)) {
      console.error({ event: "geocode_no_results", dealerId });
      return;
    }

    await prisma.dealer.update({
      where: { id: dealerId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { latitude: lat, longitude: lon } as unknown as any,
    });
  } catch (err) {
    console.error({
      event: "geocode_error",
      dealerId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Enrich snapshot metadata by scraping each URL in batches.
 *
 * @param concurrency overrides METADATA_BATCH_SIZE so the per-tier plan
 *   limit (planLimits.enrichmentConcurrency) flows through here too.
 */
async function enrichMetadataInBackground(
  urls: string[],
  dealerId: string,
  crawlJobId: string,
  concurrency: number = METADATA_BATCH_SIZE
): Promise<void> {
  const batchSize = Math.max(1, concurrency);
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const metadataResults = await Promise.all(
      batch.map((url) => fetchUrlMetadata(url))
    );
    for (let j = 0; j < batch.length; j++) {
      const meta = metadataResults[j];
      const hasData =
        meta.title || meta.thumbnailUrl || meta.price || meta.make || meta.model || meta.year;
      if (hasData) {
        try {
          await prisma.crawlSnapshot.update({
            where: { dealerId_url: { dealerId, url: batch[j] } },
            data: {
              title: meta.title,
              thumbnailUrl: meta.thumbnailUrl,
              price: meta.price,
              make: meta.make,
              model: meta.model,
              year: meta.year,
            },
          });
        } catch (err) {
          console.error({
            event: "metadata_write_error",
            url: batch[j],
            dealerId,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    // Increment urlsEnriched after each batch
    await prisma.crawlJob.update({
      where: { id: crawlJobId },
      data: { urlsEnriched: { increment: batch.length } },
    });
    if (i + batchSize < urls.length) {
      await sleep(METADATA_BATCH_DELAY_MS);
    }
  }
  // Mark job as complete when all batches are done
  await prisma.crawlJob.update({
    where: { id: crawlJobId },
    data: { status: "complete", phase: "complete", completedAt: new Date() },
  });
}

/** Get the start of the current calendar month (UTC) */
function getStartOfMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Get the start of next month for display (UTC) */
function getStartOfNextMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

class QuotaError extends Error {
  used: number;
  constructor(used: number) {
    super("monthly_limit_reached");
    this.used = used;
  }
}

/**
 * POST /api/crawl — Trigger a website crawl for the dealer
 */
export async function POST(request: NextRequest) {
  // Suppress unused-var — request is required by Next.js route signature
  void request;

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

  const dealer = await prisma.dealer.findUnique({
    where: { id: dealerId },
    select: {
      vertical: true,
      websiteUrl: true,
      plan: true,
      customCrawlExcludePatterns: true,
    },
  });
  if (!dealer || !ALLOWED_CRAWL_VERTICALS.includes(dealer.vertical as Vertical)) {
    return NextResponse.json(
      { error: "crawl_not_supported_for_vertical" },
      { status: 400 }
    );
  }

  // Always use the dealer's profile websiteUrl — no custom URL input
  const websiteUrl = dealer.websiteUrl;
  if (!websiteUrl || !isValidUrl(websiteUrl)) {
    return NextResponse.json({ error: "no_website_url" }, { status: 400 });
  }

  // Plan-based quota check. Trial accounts (bulkCrawlsPerMonth=0) are blocked
  // here with a friendly upgrade prompt; paying plans get their respective cap.
  const plan = dealer.plan as Plan;
  const planLimits = getPlanLimits(plan);
  if (planLimits.bulkCrawlsPerMonth === 0) {
    return NextResponse.json(
      {
        error: "bulk_crawl_not_in_plan",
        plan,
        message:
          "Bulk website crawl unlocks on a paid plan. During trial you can still add vehicles individually by URL.",
      },
      { status: 403 }
    );
  }

  const monthStart = getStartOfMonth();
  const crawlsThisMonth = await prisma.crawlJob.count({
    where: {
      dealerId,
      startedAt: { gte: monthStart },
      status: { not: "failed" },
    },
  });

  if (crawlsThisMonth >= planLimits.bulkCrawlsPerMonth) {
    return NextResponse.json(
      {
        error: "monthly_limit_reached",
        used: crawlsThisMonth,
        limit: planLimits.bulkCrawlsPerMonth,
        plan,
        resetsAt: getStartOfNextMonth().toISOString(),
      },
      { status: 429 }
    );
  }

  // Create crawl job inside a transaction to prevent races
  let crawlJob: { id: string };
  try {
    crawlJob = await prisma.$transaction(
      async (tx) => {
        const txCount = await tx.crawlJob.count({
          where: {
            dealerId,
            startedAt: { gte: monthStart },
            status: { not: "failed" },
          },
        });
        if (txCount >= planLimits.bulkCrawlsPerMonth) {
          throw new QuotaError(txCount);
        }
        return tx.crawlJob.create({
          data: { dealerId, status: "running", phase: "mapping" },
        });
      },
      { isolationLevel: "Serializable" }
    );
  } catch (err) {
    if (err instanceof QuotaError) {
      return NextResponse.json(
        {
          error: "monthly_limit_reached",
          used: err.used,
          limit: planLimits.bulkCrawlsPerMonth,
          plan,
          resetsAt: getStartOfNextMonth().toISOString(),
        },
        { status: 429 }
      );
    }
    throw err;
  }

  try {
    // Phase 1: Map — vertical-aware URL discovery, capped by plan.
    const parsedUrl = new URL(websiteUrl);
    const origin = parsedUrl.origin;
    const verticalSubpaths =
      VERTICAL_CRAWL_TARGETS[dealer.vertical as Vertical] ?? [];
    const crawlTargets = [
      origin,
      ...verticalSubpaths.map((path) => `${origin}${path}`),
    ];
    const uniqueTargets = [...new Set(crawlTargets)];

    const mapResults = await Promise.allSettled(
      uniqueTargets.map((target) =>
        firecrawlClient.map(target, { limit: planLimits.maxMapUrls })
      )
    );

    for (let i = 0; i < mapResults.length; i++) {
      const result = mapResults[i];
      if (result.status === "rejected") {
        console.error({
          event: "map_target_failed",
          crawlJobId: crawlJob.id,
          target: uniqueTargets[i],
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }

    const fulfilledCount = mapResults.filter((r) => r.status === "fulfilled").length;
    if (fulfilledCount === 0) {
      throw new Error("All Firecrawl map targets failed — no URLs discovered");
    }

    const allUrls: string[] = [];
    for (const result of mapResults) {
      if (result.status === "fulfilled") {
        const links = result.value.links ?? [];
        for (const link of links) {
          allUrls.push((link as { url: string }).url);
        }
      }
    }

    // Normalize URLs, then filter to the dealer's vertical-listing pages,
    // then cap by plan max-pages-per-crawl (so Firecrawl spend is bounded).
    const normalizedUrls = allUrls.map(normalizeUrl);
    const filteredUrls = filterDiscoveredUrls(
      normalizedUrls,
      dealer.vertical as Vertical,
      dealer.customCrawlExcludePatterns ?? []
    );
    const inventoryUrls = filteredUrls.slice(0, planLimits.maxPagesPerCrawl);
    if (filteredUrls.length > planLimits.maxPagesPerCrawl) {
      console.log({
        event: "crawl_capped_by_plan",
        crawlJobId: crawlJob.id,
        dealerId,
        plan,
        filtered: filteredUrls.length,
        cappedTo: planLimits.maxPagesPerCrawl,
      });
    }

    const now = new Date();
    for (const url of inventoryUrls) {
      await prisma.crawlSnapshot.upsert({
        where: { dealerId_url: { dealerId, url } },
        create: {
          crawlJobId: crawlJob.id,
          dealerId,
          url,
          firstSeenAt: now,
          lastSeenAt: now,
          weeksActive: 1,
        },
        update: {
          crawlJobId: crawlJob.id,
          lastSeenAt: now,
          weeksActive: { increment: 1 },
        },
      });
    }

    // Transition to enriching phase
    await prisma.crawlJob.update({
      where: { id: crawlJob.id },
      data: {
        status: "mapping_complete",
        phase: "enriching",
        urlsFound: inventoryUrls.length,
      },
    });

    // Fire geocoding as a background task — never blocks the crawl response.
    // No-op until the schema migration adds address/latitude/longitude fields.
    after(() => geocodeDealerAddressIfNeeded(dealerId));

    // Fire enrichment as a background task — returns immediately
    after(() =>
      enrichMetadataInBackground(
        inventoryUrls,
        dealerId,
        crawlJob.id,
        planLimits.enrichmentConcurrency
      ).catch(
        (err) => {
          console.error({
            event: "metadata_enrichment_error",
            crawlJobId: crawlJob.id,
            message: err instanceof Error ? err.message : String(err),
          });
          // Mark failed so the client knows enrichment broke
          prisma.crawlJob
            .update({
              where: { id: crawlJob.id },
              data: { status: "failed", phase: "enriching" },
            })
            .catch(() => {});
        }
      )
    );

    return NextResponse.json({
      crawlJobId: crawlJob.id,
      urlsFound: inventoryUrls.length,
      urlsDiscoveredBeforeFilter: normalizedUrls.length,
      phase: "enriching",
      quota: {
        used: crawlsThisMonth + 1,
        limit: planLimits.bulkCrawlsPerMonth,
        plan,
        resetsAt: getStartOfNextMonth().toISOString(),
      },
    });
  } catch (err) {
    await prisma.crawlJob.update({
      where: { id: crawlJob.id },
      data: { status: "failed", phase: "mapping", completedAt: new Date() },
    });
    console.error({
      event: "crawl_error",
      crawlJobId: crawlJob.id,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "crawl_failed" }, { status: 502 });
  }
}

/**
 * GET /api/crawl — Returns the dealer's last 10 crawl jobs + monthly quota info
 */
export async function GET() {
  const dealerId = await getEffectiveDealerId();
  if (!dealerId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const dealer = await prisma.dealer.findUnique({
    where: { id: dealerId },
    select: { plan: true, trialUrlAddsUsed: true },
  });
  const plan = (dealer?.plan ?? "trial") as Plan;
  const planLimits = getPlanLimits(plan);

  const jobs = await prisma.crawlJob.findMany({
    where: { dealerId },
    orderBy: { startedAt: "desc" },
    take: 10,
    select: {
      id: true,
      status: true,
      startedAt: true,
      completedAt: true,
      urlsFound: true,
    },
  });

  const monthStart = getStartOfMonth();
  const crawlsThisMonth = await prisma.crawlJob.count({
    where: {
      dealerId,
      startedAt: { gte: monthStart },
      status: { not: "failed" },
    },
  });

  return NextResponse.json({
    jobs,
    quota: {
      used: crawlsThisMonth,
      limit: planLimits.bulkCrawlsPerMonth,
      plan,
      pagesPerCrawl: planLimits.maxPagesPerCrawl,
      bulkCrawlEnabled: planLimits.bulkCrawlsPerMonth > 0,
      resetsAt: getStartOfNextMonth().toISOString(),
    },
    trial:
      plan === "trial"
        ? {
            urlAddsUsed: dealer?.trialUrlAddsUsed ?? 0,
            urlAddsLimit: planLimits.trialUrlAddLimit,
          }
        : null,
  });
}
