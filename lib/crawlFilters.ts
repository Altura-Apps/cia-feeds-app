/**
 * URL filtering for bulk crawls.
 *
 * Replaces the prior naive regex list in lib/crawl.ts that false-positived
 * on URLs like /promotions/used/index.htm (matched /used/ even though
 * /promotions/ should have excluded it).
 *
 * Design:
 *   1. Path-segment matching instead of substring regex
 *   2. Per-vertical include/exclude sets (auto / real estate / services)
 *   3. Exclusions evaluated BEFORE inclusions
 *   4. Detail-page heuristics: URL must look like a single-item page
 *      (numeric ID, VIN-like token, or a slug-with-words segment after the
 *      vertical-specific listing path), not a category/promo/blog index
 *
 * Examples (automotive):
 *   PASS  /inventory/new/2024-toyota-rav4-xle/12345
 *   PASS  /vehicles/used/2019-honda-civic-vin-2HGFC2F58KH123456
 *   PASS  /vdp/JTMRWRFV3MD123456
 *   FAIL  /promotions/used/index.htm        (promotions in segments)
 *   FAIL  /blog/used-car-buying-tips        (blog in segments)
 *   FAIL  /service/oil-change-coupons       (service in segments)
 *   FAIL  /inventory                        (index page, no detail token)
 */

export type Vertical = "automotive" | "realestate" | "services" | "ecommerce";

// --- Path-segment helpers ---

function segments(pathname: string): string[] {
  // Strip leading/trailing slashes, then split on /
  return pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
}

// Match a single path segment against a lowercase needle
function hasSegment(segs: string[], needle: string): boolean {
  return segs.some((s) => s.toLowerCase() === needle);
}

// Detect a "detail-page" terminal: a numeric ID (>=4 digits), a VIN-like
// token, or a slug with at least N words. N varies by vertical because
// automotive detail slugs are typically long ("2024-toyota-rav4-xle")
// while service / property slugs can be short ("teeth-whitening").
function looksLikeDetailToken(seg: string, minSlugWords: number): boolean {
  // Numeric ID
  if (/^\d{4,}$/.test(seg)) return true;
  // VIN-like (10–17 chars, contains both a letter and a digit)
  if (/^[A-HJ-NPR-Z0-9]{10,17}$/i.test(seg) && /[A-Z]/i.test(seg) && /\d/.test(seg)) return true;
  // Slug with N+ hyphenated words (e.g. minSlugWords=3 → "2024-toyota-rav4")
  const wordCount = seg.split("-").filter((w) => /[a-z0-9]/i.test(w)).length;
  if (wordCount >= minSlugWords) return true;
  return false;
}

const MIN_SLUG_WORDS_BY_VERTICAL: Record<Vertical, number> = {
  automotive: 3,  // detail slugs always have year/make/model
  realestate: 2,  // "123-main-st", "2br-condo-downtown"
  services:   2,  // "teeth-whitening", "oil-change"
  ecommerce:  2,  // "red-cotton-tshirt"
};

// --- Common excludes applied to all verticals ---

const GLOBAL_EXCLUDE_SEGMENTS = [
  "about", "about-us",
  "contact", "contact-us",
  "blog", "blogs", "news", "press",
  "careers", "jobs",
  "privacy", "terms", "legal", "disclaimer", "accessibility",
  "faq", "faqs", "help", "support",
  "login", "sign-in", "signin", "signup", "register",
  "account", "my-account", "profile",
  "cart", "checkout",
  "sitemap", "sitemaps",
  "feed", "rss", "atom",
  "search", "results",
  "promotions", "promos", "specials", "deals", "coupons", "offers",
  "events",
  "team", "staff", "agents",
  "testimonials", "reviews",
];

// File extensions that should never be enrichment targets
const EXTENSION_DENY = /\.(pdf|xml|json|jpg|jpeg|png|gif|webp|svg|ico|css|js|woff2?|ttf|mp4|mp3|zip)$/i;

// --- Per-vertical includes ---

const VERTICAL_INCLUDE_SEGMENTS: Record<Vertical, string[]> = {
  automotive: [
    "inventory", "new-inventory", "used-inventory", "certified-inventory",
    "vehicle", "vehicles",
    "new", "used", "certified", "pre-owned", "preowned", "cpo",
    "vdp", "detail", "vehicle-details",
    "cars", "trucks", "suvs", "vans", "crossovers",
  ],
  realestate: [
    "property", "properties",
    "listing", "listings",
    "home", "homes", "homes-for-sale",
    "house", "houses",
    "condo", "condos",
    "rental", "rentals", "rent",
    "for-sale", "for-rent",
    "mls",
    "p", // common short URL pattern, e.g. /p/12345
  ],
  services: [
    "service", "services",
    "treatment", "treatments",
    "product", "products",
    "menu", "items",
    "package", "packages",
    "course", "courses",
  ],
  ecommerce: [
    "product", "products",
    "p", "item", "items",
    "shop", "store", "collection", "collections",
  ],
};

// Sub-paths the crawl map() will explore (entry points for Firecrawl map)
export const VERTICAL_CRAWL_TARGETS: Record<Vertical, string[]> = {
  automotive: ["/inventory", "/new-inventory", "/used-inventory"],
  realestate: ["/listings", "/properties", "/homes-for-sale"],
  services: ["/services", "/menu", "/products"],
  ecommerce: ["/shop", "/products", "/collections"],
};

// --- Public filter ---

/**
 * Returns true if `url` looks like a listing-detail page for the given
 * vertical. Exclusions are evaluated first so a path containing
 * /promotions/used/ is rejected even though `used` is in the auto includes.
 */
export function isListingUrl(
  url: string,
  vertical: Vertical,
  customExcludeSegments: string[] = []
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (EXTENSION_DENY.test(parsed.pathname)) return false;

  const segs = segments(parsed.pathname);
  if (segs.length === 0) return false; // root pages aren't listings

  const lowerSegs = segs.map((s) => s.toLowerCase());

  // Reject if ANY segment is in the global exclude list
  for (const ex of GLOBAL_EXCLUDE_SEGMENTS) {
    if (lowerSegs.includes(ex)) return false;
  }
  // Or in the dealer-specific custom exclude list
  for (const ex of customExcludeSegments) {
    if (ex && lowerSegs.includes(ex.toLowerCase())) return false;
  }

  const includes = VERTICAL_INCLUDE_SEGMENTS[vertical];
  // Must include at least one vertical-include segment
  const hasInclude = includes.some((inc) => lowerSegs.includes(inc));
  if (!hasInclude) return false;

  // Must have a detail-token segment AFTER the include segment (to weed out
  // /inventory index pages while keeping /inventory/used/2024-rav4-12345)
  const lastSeg = segs[segs.length - 1];
  // Strip any trailing file extension like .htm/.html (these don't trip
  // EXTENSION_DENY but shouldn't disqualify a detail token)
  const lastSegBare = lastSeg.replace(/\.html?$/i, "");
  const minWords = MIN_SLUG_WORDS_BY_VERTICAL[vertical];
  if (!looksLikeDetailToken(lastSegBare, minWords)) {
    // Fallback: also accept if the second-to-last segment is a detail token
    // (some sites have /vehicles/12345/details/ patterns)
    const prevSeg = segs.length >= 2 ? segs[segs.length - 2] : "";
    if (!looksLikeDetailToken(prevSeg, minWords)) return false;
  }

  return true;
}

/**
 * Filter an array of discovered URLs down to the ones we'll spend Firecrawl
 * credits enriching. Deduplicates by normalized URL.
 */
export function filterDiscoveredUrls(
  urls: string[],
  vertical: Vertical,
  customExcludeSegments: string[] = []
): string[] {
  const out = new Set<string>();
  for (const u of urls) {
    if (isListingUrl(u, vertical, customExcludeSegments)) out.add(u);
  }
  return [...out];
}
