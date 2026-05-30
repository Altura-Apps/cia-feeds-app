/**
 * Tenant resolution for storefront pages.
 *
 * A "tenant" is a Dealer rendered as a public-facing mini-website. Tenants
 * are reached three ways:
 *
 *   1. Path:        ciafeed.com/{slug}                 — fallback, always works
 *   2. Subdomain:   {slug}.ciafeed.com                 — default white-label
 *   3. Custom:      inventory.dealerwebsite.com         — premium white-label
 *
 * middleware.ts rewrites (2) and (3) to (1) so the [slug] page tree handles
 * all three the same way.
 *
 * Tenant lookup goes through verifyDealer-style checks: deleted, soft-deleted,
 * or inactive dealers 404 their storefronts immediately.
 */
import { prisma } from "@/lib/prisma";
import { withDbRetry } from "@/lib/dbResilience";
import { getBrandPreset, type BrandPreset } from "@/lib/brandPresets";

/** Slugs that collide with our own top-level routes \u2014 dealers may never use these. */
export const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "components",
  "dashboard",
  "feeds",
  "forgot-password",
  "login",
  "privacy",
  "reset-password",
  "services",
  "signup",
  "subscribe",
  "team",
  "terms",
  "w",
  "static",
  "_next",
  "vercel",
  "robots.txt",
  "sitemap.xml",
  "favicon.ico",
  "security",
  // Marketing pages — blog, landing pages, and pillar pages
  "blog",
  "es",
  "lp",
  "whatsapp-marketing-dealerships",
  "marketing-whatsapp-concesionarios",
  "hispanic-auto-marketing",
  "marketing-automotriz-hispanos",
]);

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  vertical: string;
  email: string;
  phone: string | null;
  fbPageId: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  profileImageUrl: string | null;
  customDomain: string | null;
  ctaPreference: "sms" | "whatsapp" | "messenger" | null;
  theme: BrandPreset;
  /** True if the dealer has an active or trialing Stripe subscription. */
  hasActiveSubscription: boolean;
  /** Meta Pixel ID for Pixel injection on storefront pages. Null if not yet set. */
  metaPixelId: string | null;
}

/**
 * Look up a tenant by its slug. Returns null if the slug is reserved,
 * the dealer doesn't exist, is soft-deleted, or is inactive.
 *
 * Pages and middleware should treat null as a hard 404.
 */
export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  if (!slug || typeof slug !== "string") return null;
  const lower = slug.toLowerCase();
  if (RESERVED_SLUGS.has(lower)) return null;

  // F-7.7: retry transient DB failures so a brief Supabase blip doesn't 500
  // the entire storefront. ISR (`revalidate = 60`) covers longer outages by
  // serving stale cached HTML.
  const dealer = await withDbRetry(
    async () =>
      await prisma.dealer.findFirst({
        where: {
          slug: lower,
          active: true,
          deletedAt: null,
        },
        select: dealerSelectShape,
      }),
    { label: "tenant.by_slug" }
  );

  return dealer ? toTenant(dealer) : null;
}

/**
 * Look up a tenant by host (custom domain). Returns null if not found
 * or the dealer is inactive/deleted.
 */
export async function getTenantByCustomDomain(
  host: string
): Promise<Tenant | null> {
  if (!host) return null;
  const normalized = host.toLowerCase().replace(/^www\./, "");

  const dealer = await prisma.dealer.findFirst({
    where: {
      customDomain: normalized,
      active: true,
      deletedAt: null,
    },
    select: dealerSelectShape,
  });

  return dealer ? toTenant(dealer) : null;
}

const dealerSelectShape = {
  id: true,
  name: true,
  slug: true,
  vertical: true,
  email: true,
  phone: true,
  fbPageId: true,
  address: true,
  latitude: true,
  longitude: true,
  websiteUrl: true,
  logoUrl: true,
  profileImageUrl: true,
  customDomain: true,
  ctaPreference: true,
  themePreset: true,
  themeOverrides: true,
  subscriptionStatus: true,
  metaPixelId: true,
} as const;

type DealerRow = {
  id: string;
  name: string;
  slug: string;
  vertical: string;
  email: string;
  phone: string | null;
  fbPageId: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  profileImageUrl: string | null;
  customDomain: string | null;
  ctaPreference: "sms" | "whatsapp" | "messenger" | null;
  themePreset: string | null;
  themeOverrides: unknown;
  subscriptionStatus: string | null;
  metaPixelId: string | null;
};

function toTenant(d: DealerRow): Tenant {
  return {
    id: d.id,
    name: d.name,
    slug: d.slug,
    vertical: d.vertical,
    email: d.email,
    phone: d.phone,
    fbPageId: d.fbPageId,
    address: d.address,
    latitude: d.latitude,
    longitude: d.longitude,
    websiteUrl: d.websiteUrl,
    logoUrl: d.logoUrl,
    profileImageUrl: d.profileImageUrl,
    customDomain: d.customDomain,
    ctaPreference: d.ctaPreference,
    theme: getBrandPreset(
      d.themePreset,
      d.themeOverrides as Parameters<typeof getBrandPreset>[1]
    ),
    hasActiveSubscription:
      d.subscriptionStatus === "active" || d.subscriptionStatus === "trialing",
    metaPixelId: d.metaPixelId,
  };
}

export interface StorefrontCta {
  /** Button label, e.g. "Message on WhatsApp". */
  label: string;
  /** Which channel was resolved. "form" means no direct-message channel
   *  is available, so callers should fall back to the contact form. */
  intent: "sms" | "whatsapp" | "messenger" | "form";
  /**
   * Helper that returns the right href for the CTA. Pass an optional
   * `contactFormHref` (e.g. "/contact?vehicle=abc") used when intent is
   * "form" or when the resolved channel is missing required data
   * (e.g. "whatsapp" but the dealer has no phone). Pass an optional
   * pre-filled `message` for SMS/WhatsApp.
   */
  buildHref: (opts?: { contactFormHref?: string; message?: string }) => string;
}

/**
 * Resolve the CTA label + intent + href the storefront uses on listings and VDPs.
 * Honors the dealer's ctaPreference enum, with sensible defaults per vertical.
 *
 * If the dealer's preferred channel is missing the data it needs (e.g.
 * "whatsapp" but no phone, or "messenger" but no fbPageId), the helper
 * gracefully degrades to the contact form so the button never opens a
 * broken link.
 */
export function getStorefrontCta(tenant: Tenant): StorefrontCta {
  const phoneDigits = (tenant.phone ?? "").replace(/\D/g, "");
  const fbPageId = tenant.fbPageId ?? "";

  const pref = tenant.ctaPreference;

  let intent: StorefrontCta["intent"] = "form";
  let label =
    tenant.vertical === "automotive" ? "Get a Quote" : "Contact Us";

  if (pref === "sms" && phoneDigits) {
    intent = "sms";
    label = "Text Us";
  } else if (pref === "whatsapp" && phoneDigits) {
    intent = "whatsapp";
    label = "Message on WhatsApp";
  } else if (pref === "messenger" && fbPageId) {
    intent = "messenger";
    label = "Message on Messenger";
  } else if (!pref) {
    // No preference set: pick the first channel that has data.
    // WhatsApp wins because it's the highest-intent destination for
    // automotive shoppers; SMS next; Messenger last; form fallback.
    if (phoneDigits) {
      intent = "whatsapp";
      label = "Message on WhatsApp";
    } else if (fbPageId) {
      intent = "messenger";
      label = "Message on Messenger";
    }
  }

  const buildHref: StorefrontCta["buildHref"] = (opts = {}) => {
    const fallback = opts.contactFormHref ?? "/contact";
    const msg = opts.message ?? "Hi, I'm interested in your inventory";
    switch (intent) {
      case "sms":
        return `sms:${tenant.phone ?? ""}?body=${encodeURIComponent(msg)}`;
      case "whatsapp":
        return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(msg)}`;
      case "messenger":
        return `https://m.me/${fbPageId}`;
      default:
        return fallback;
    }
  };

  return { label, intent, buildHref };
}
