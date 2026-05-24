import { NextRequest, NextResponse } from "next/server";

/**
 * Edge proxy (Next 16's renamed middleware).
 *
 * Two responsibilities:
 *   1. Pass-through for /dashboard, /subscribe — auth is handled server-side
 *      by getServerSession in layouts/pages.
 *   2. Rewrite storefront subdomains and custom domains to the /[slug] tree:
 *        - dealer.ciafeed.com/*       -> /dealer/*
 *        - inventory.dealer.com/*     -> /<slug>/*  (custom domain lookup)
 *
 * The custom-domain rewrite needs a Dealer.customDomain DB lookup. Prisma's
 * default client doesn't run on the Edge runtime, so we force this proxy to
 * Node by NOT exporting a `runtime: "edge"` config. Vercel will run it on
 * a Node lambda, which adds a few ms per request but lets us use Prisma.
 */

const APEX_DOMAINS = new Set([
  "ciafeed.com",
  "www.ciafeed.com",
  // Treat localhost as apex during local dev so /dashboard etc keep working
  "localhost",
  "localhost:3000",
]);

const RESERVED_SUBDOMAINS = new Set([
  "www",
  "api",
  "admin",
  "app",
  "dashboard",
  "mail",
  "email",
  "ftp",
  "static",
  "cdn",
  "assets",
  "vercel",
  "supabase",
]);

export async function proxy(request: NextRequest) {
    // Fire-and-forget LogWatch traffic capture (non-blocking)
  try {
    const logwatchUrl = process.env.LOGWATCH_INGEST_URL;
    if (logwatchUrl) {
      fetch(logwatchUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ts: Date.now(),
          method: request.method,
          url: request.nextUrl.toString(),
          host: request.nextUrl.host,
          path: request.nextUrl.pathname,
          ua: request.headers.get("user-agent") ?? null,
          ref: request.headers.get("referer") ?? null,
          ip: request.headers.get("x-forwarded-for") ?? null,
        }),
        keepalive: true,
      }).catch(() => {});
    }
  } catch {}

  const url = request.nextUrl;
  const pathname = url.pathname;

  // Skip static/internal paths so we never touch /_next, /api/*, etc.
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/static/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname.endsWith(".xml") ||
    pathname.endsWith(".txt") ||
    pathname.endsWith(".json") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".ico")
  ) {
    return NextResponse.next();
  }

  const hostHeader = request.headers.get("host") ?? "";
  const host = hostHeader.toLowerCase();

  // Apex / www / localhost — let the normal app render.
  if (APEX_DOMAINS.has(host)) {
    return NextResponse.next();
  }

  // Subdomain pattern: anything.ciafeed.com
  if (host.endsWith(".ciafeed.com")) {
    const sub = host.replace(/\.ciafeed\.com$/, "");
    if (RESERVED_SUBDOMAINS.has(sub) || sub.includes(".")) {
      // www.ciafeed.com is handled above; anything else reserved we just let
      // through (will 404 or render the apex app).
      return NextResponse.next();
    }
    // Rewrite to /[slug]/<original path>
    const target = new URL(url);
    target.pathname = `/${sub}${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(target);
  }

  // Custom domain: anything that isn't us. Look up the slug via Prisma.
  //
  // We do this lookup on every storefront request \u2014 acceptable in scale
  // terms because (a) custom-domain customers are a paid feature, low
  // cardinality; (b) the query hits a unique index on customDomain.
  //
  // For higher scale we could move this lookup behind an Upstash/Redis cache
  // keyed on host, but the simple path is fine until ~1k custom domains.
  try {
    const slug = await lookupCustomDomain(host);
    if (slug) {
      const target = new URL(url);
      target.pathname = `/${slug}${pathname === "/" ? "" : pathname}`;
      // Annotate the request so pages can tell this came from a custom domain
      // (useful for canonical URL generation).
      const res = NextResponse.rewrite(target);
      res.headers.set("x-storefront-custom-domain", host);
      return res;
    }
  } catch (err) {
    console.error({
      event: "proxy_custom_domain_lookup_failed",
      host,
      message: err instanceof Error ? err.message : String(err),
    });
    // Fall through to default behavior on lookup failure \u2014 better to
    // serve the apex app than a 500.
  }

  return NextResponse.next();
}

/**
 * Dynamic import of Prisma so this module loads quickly on cold start.
 * Prisma is excluded from the proxy bundle by default in Next 16 because
 * it has Node-only dependencies; the dynamic import keeps the bundle small.
 */
async function lookupCustomDomain(host: string): Promise<string | null> {
  const { prisma } = await import("@/lib/prisma");
  const normalized = host.replace(/^www\./, "");
  const dealer = await prisma.dealer.findFirst({
    where: {
      customDomain: normalized,
      active: true,
      deletedAt: null,
    },
    select: { slug: true },
  });
  return dealer?.slug ?? null;
}

export const config = {
  // Match everything except Next.js internals + static assets. The proxy
  // function itself short-circuits on those paths too, but the matcher
  // keeps Vercel's filter cheap.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|map|woff2?|ttf|eot)).*)",
  ],
};
