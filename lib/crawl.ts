import { prisma } from "@/lib/prisma";
import { firecrawlClient } from "@/lib/firecrawl";
import {
  isListingUrl,
  filterDiscoveredUrls,
  VERTICAL_CRAWL_TARGETS,
  type Vertical,
} from "@/lib/crawlFilters";
import { getPlanLimits, type Plan } from "@/lib/planLimits";

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

/** Normalize a URL: force https, strip trailing slashes, query params, and hash */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.protocol = "https:";
    parsed.search = "";
    parsed.hash = "";
    let pathname = parsed.pathname;
    // Strip trailing slashes (but keep root "/")
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.replace(/\/+$/, "");
    }
    parsed.pathname = pathname;
    return parsed.toString();
  } catch {
    return url;
  }
}

const METADATA_BATCH_SIZE = 5;
const METADATA_BATCH_DELAY_MS = 500;

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
 * Enrich snapshot metadata by scraping each URL in batches.
 *
 * @param concurrency overrides METADATA_BATCH_SIZE (the historical default).
 *                    Driven by plan tier so smaller plans don't burn through
 *                    Firecrawl credits as fast.
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

/**
 * Core crawl logic shared by POST /api/crawl and the weekly cron.
 *
 * Assumes the caller has already:
 *   - Validated the dealer's monthly bulk-crawl quota (planLimits.bulkCrawlsPerMonth)
 *   - Created a CrawlJob row
 *
 * Uses per-vertical URL filtering (lib/crawlFilters.ts) so a real-estate or
 * services dealer doesn't get auto-inventory patterns, and so paths like
 * /promotions/used/ are excluded even though they contain the word 'used'.
 *
 * Caps Firecrawl spend at every layer:
 *   - map(): limited to planLimits.maxMapUrls per target
 *   - enrichment: capped at planLimits.maxPagesPerCrawl pages
 *   - enrichment concurrency: planLimits.enrichmentConcurrency at-a-time
 */
export async function runCrawlForDealer(
  dealerId: string,
  websiteUrl: string,
  crawlJobId: string,
  opts: {
    plan: Plan;
    vertical: Vertical;
    customExcludeSegments?: string[];
  }
): Promise<{ urlsFound: number; urlsDiscoveredBeforeFilter: number; cappedAt: number }> {
  const limits = getPlanLimits(opts.plan);
  if (limits.bulkCrawlsPerMonth === 0) {
    throw new Error(
      "Bulk crawl is not available on the trial plan. Upgrade or add vehicles by URL individually."
    );
  }

  const parsedUrl = new URL(websiteUrl);
  const origin = parsedUrl.origin;
  const verticalTargets = VERTICAL_CRAWL_TARGETS[opts.vertical] ?? [];
  const crawlTargets = [
    origin,
    ...verticalTargets.map((path) => `${origin}${path}`),
  ];
  const uniqueTargets = [...new Set(crawlTargets)];

  const mapResults = await Promise.allSettled(
    uniqueTargets.map((target) =>
      firecrawlClient.map(target, { limit: limits.maxMapUrls })
    )
  );

  for (let i = 0; i < mapResults.length; i++) {
    const result = mapResults[i];
    if (result.status === "rejected") {
      console.error({
        event: "map_target_failed",
        crawlJobId,
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

  const urlsDiscoveredBeforeFilter = new Set(allUrls.map(normalizeUrl)).size;
  const filteredUrls = filterDiscoveredUrls(
    allUrls.map(normalizeUrl),
    opts.vertical,
    opts.customExcludeSegments ?? []
  );

  // Enrichment cap: never spend more Firecrawl scrape credits than the plan allows
  const cappedUrls = filteredUrls.slice(0, limits.maxPagesPerCrawl);
  const cappedAt = filteredUrls.length > limits.maxPagesPerCrawl
    ? limits.maxPagesPerCrawl
    : filteredUrls.length;

  console.log({
    event: "crawl_filter_summary",
    crawlJobId,
    dealerId,
    vertical: opts.vertical,
    plan: opts.plan,
    discovered: urlsDiscoveredBeforeFilter,
    afterFilter: filteredUrls.length,
    cappedTo: cappedAt,
  });

  const now = new Date();
  for (const url of cappedUrls) {
    await prisma.crawlSnapshot.upsert({
      where: { dealerId_url: { dealerId, url } },
      create: {
        crawlJobId,
        dealerId,
        url,
        firstSeenAt: now,
        lastSeenAt: now,
        weeksActive: 1,
      },
      update: {
        crawlJobId,
        lastSeenAt: now,
        weeksActive: { increment: 1 },
      },
    });
  }

  try {
    await enrichMetadataInBackground(
      cappedUrls,
      dealerId,
      crawlJobId,
      limits.enrichmentConcurrency
    );
  } catch (err) {
    console.error({
      event: "metadata_enrichment_error",
      crawlJobId,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    urlsFound: cappedUrls.length,
    urlsDiscoveredBeforeFilter,
    cappedAt,
  };
}

// Re-export the new filter so existing callers that just want to check a URL
// can use it without importing crawlFilters directly.
export { isListingUrl };
