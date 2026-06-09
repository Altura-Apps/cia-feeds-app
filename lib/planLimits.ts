/**
 * Single source of truth for plan-tier limits. Every place that needs to
 * gate features by plan (crawl quotas, URL-add caps, Stripe sync) reads
 * from here so the limits stay in lockstep.
 *
 * Tier strategy (chosen 2026-06-09):
 *   trial     ($1 / 10 days) — no bulk crawl, 25 URL-by-URL adds total
 *   starter   ($99 / mo)     — 2 bulk crawls/mo × 250 pages each
 *   pro       ($299 / mo)    — 4 bulk crawls/mo × 1,000 pages each
 *   enterprise($599 / mo)    — 8 bulk crawls/mo × 5,000 pages each
 *
 * Numbers chosen so that worst-case monthly Firecrawl spend per dealer is:
 *   starter:    2 × 250  × $0.005 = $2.50   (vs $99   ARPU → 97% gross margin)
 *   pro:        4 × 1000 × $0.005 = $20.00  (vs $299  ARPU → 93%)
 *   enterprise: 8 × 5000 × $0.005 = $200.00 (vs $599  ARPU → 67%)
 *
 * Notes:
 *   - 'trial' explicitly has 0 bulk crawls — they're URL-by-URL only.
 *   - URL-by-URL adds remain unlimited on paid tiers; the cap is just a
 *     trial-period safety net so we don't get abused.
 */

export type Plan = "trial" | "starter" | "pro" | "enterprise";

export interface PlanLimits {
  /** Display name for the dashboard / pricing page. */
  displayName: string;
  /** Bulk crawls allowed per calendar month. 0 = bulk crawl disabled. */
  bulkCrawlsPerMonth: number;
  /** Maximum enrichment scrapes per single bulk crawl. */
  maxPagesPerCrawl: number;
  /** Maximum URLs returned by Firecrawl map() per target subpath. */
  maxMapUrls: number;
  /** Concurrency cap for the enrichment phase. */
  enrichmentConcurrency: number;
  /** Lifetime URL-by-URL adds during trial. Ignored on paid tiers. */
  trialUrlAddLimit: number;
  /** Price string for marketing copy. */
  priceLabel: string;
  /** Monthly recurring price in cents (excl. $1 trial setup fee). */
  monthlyPriceCents: number;
}

const LIMITS: Record<Plan, PlanLimits> = {
  trial: {
    displayName: "Trial",
    bulkCrawlsPerMonth: 0,
    maxPagesPerCrawl: 0,
    maxMapUrls: 0,
    enrichmentConcurrency: 0,
    trialUrlAddLimit: 25,
    priceLabel: "$1 / 10-day trial",
    monthlyPriceCents: 100,
  },
  starter: {
    displayName: "Starter",
    bulkCrawlsPerMonth: 2,
    maxPagesPerCrawl: 250,
    maxMapUrls: 500,
    enrichmentConcurrency: 4,
    trialUrlAddLimit: Number.POSITIVE_INFINITY,
    priceLabel: "$99 / month",
    monthlyPriceCents: 9900,
  },
  pro: {
    displayName: "Pro",
    bulkCrawlsPerMonth: 4,
    maxPagesPerCrawl: 1000,
    maxMapUrls: 2000,
    enrichmentConcurrency: 6,
    trialUrlAddLimit: Number.POSITIVE_INFINITY,
    priceLabel: "$299 / month",
    monthlyPriceCents: 29900,
  },
  enterprise: {
    displayName: "Enterprise",
    bulkCrawlsPerMonth: 8,
    maxPagesPerCrawl: 5000,
    maxMapUrls: 8000,
    enrichmentConcurrency: 8,
    trialUrlAddLimit: Number.POSITIVE_INFINITY,
    priceLabel: "$599 / month",
    monthlyPriceCents: 59900,
  },
};

export function getPlanLimits(plan: Plan): PlanLimits {
  return LIMITS[plan];
}

export function isBulkCrawlAllowed(plan: Plan): boolean {
  return LIMITS[plan].bulkCrawlsPerMonth > 0;
}

/**
 * Map a Stripe price ID to a Plan. Used by the Stripe webhook to keep
 * Dealer.plan in sync with the dealer's active subscription.
 *
 * env vars:
 *   STRIPE_PRICE_ID            — current Pro $299 price (the new default)
 *   STRIPE_LEGACY_PRICE_ID     — old $99 price (set on env when needed)
 *   STRIPE_ENTERPRISE_PRICE_ID — new $599 price
 */
export function planFromStripePriceId(priceId: string | null | undefined): Plan {
  if (!priceId) return "trial";
  if (priceId === process.env.STRIPE_PRICE_ID) return "pro";
  if (priceId === process.env.STRIPE_LEGACY_PRICE_ID) return "starter";
  if (priceId === process.env.STRIPE_ENTERPRISE_PRICE_ID) return "enterprise";
  // Unknown price — default to trial so we don't accidentally over-grant features.
  return "trial";
}

export const ALL_PLANS: Plan[] = ["trial", "starter", "pro", "enterprise"];
