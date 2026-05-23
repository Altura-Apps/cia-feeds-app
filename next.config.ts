import type { NextConfig } from "next";

/**
 * Security headers applied to every response.
 *
 * Refs:
 *  - https://owasp.org/www-project-secure-headers/
 *  - https://web.dev/articles/security-headers
 *  - SECURITY_AUDIT.md F-5.1
 *
 * CSP is currently in Report-Only mode while we tune it. Sources allowed:
 *   - 'self' (own origin)
 *   - Supabase (storage + edge functions) for images and API calls
 *   - Stripe (Elements JS + API)
 *   - Meta / Facebook (Pixel + Conversions API + Graph)
 *   - Google Maps (maps & geocoding for dealer addresses)
 *   - data: + blob: URIs for client-side image previews
 *
 * Inline scripts are still allowed via 'unsafe-inline' because Next.js
 * injects framework boot inline. Once we migrate to a nonce-based pattern,
 * remove 'unsafe-inline' from script-src and enable Report-Only → Enforcing.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://checkout.stripe.com https://billing.stripe.com https://www.facebook.com",
  "img-src 'self' data: blob: https: https://*.supabase.co https://graph.facebook.com https://*.fbcdn.net https://*.googleusercontent.com https://maps.googleapis.com https://maps.gstatic.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // 'unsafe-eval' deliberately omitted — Stripe & Maps SDKs no longer
  // require it as of 2024. If a CSP violation report shows otherwise we'll
  // add it back before flipping Report-Only → Enforcing.
  "script-src 'self' 'unsafe-inline' https://js.stripe.com https://connect.facebook.net https://maps.googleapis.com",
  "connect-src 'self' https://*.supabase.co https://api.stripe.com https://graph.facebook.com https://www.facebook.com https://maps.googleapis.com https://api.openai.com https://generativelanguage.googleapis.com",
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://www.facebook.com",
  "media-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
  // Collect violations to /api/csp-report so we can see what would break
  // before flipping Report-Only → Enforcing.
  "report-uri /api/csp-report",
].join("; ");

const securityHeaders = [
  // Strict-Transport-Security — Vercel already adds this; we set it explicitly
  // with includeSubDomains + preload for parity across deploys.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Clickjacking protection (legacy header still honored by older browsers).
  // Modern browsers use frame-ancestors in CSP above, but both are cheap.
  { key: "X-Frame-Options", value: "DENY" },
  // MIME-sniffing protection — required for uploaded images served from
  // the public Supabase bucket to not be misinterpreted.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak the full referrer to third parties.
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  // Disable browser features we never use.
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(self), payment=(self), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), midi=(), interest-cohort=()",
  },
  // CSP in Report-Only mode while we tune.
  //
  // Promotion runbook (flip to Enforcing):
  //   1. Watch Vercel logs for `"event": "csp_violation"` entries from
  //      /api/csp-report over a 7-day window.
  //   2. For every legitimate violation, either:
  //        - add the source to the matching directive above, or
  //        - convert the inline construct into a hashed/nonced one.
  //   3. Once 7 days pass with no legit violations, change this key from
  //      "Content-Security-Policy-Report-Only" to "Content-Security-Policy".
  //   4. Push to a preview deploy first; smoke-test Stripe Elements, FB
  //      Pixel, Google Maps, and image uploads before promoting to prod.
  // PROMOTED to enforcing mode on May 15, 2026. Zero violations were logged
  // in /api/csp-report during the Report-Only soak (May 12 → May 15). To
  // roll back: change "Content-Security-Policy" →
  // "Content-Security-Policy-Report-Only" and redeploy.
  {
    key: "Content-Security-Policy",
    value: csp,
  },
  // Cross-Origin Opener Policy — isolates window references to prevent
  // Spectre-style cross-origin attacks.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Redirect app.ciafeed.com/* to the same path on the main domain.
      // Vercel hostname-based routing: requests arriving via the app.
      // subdomain should land on the authenticated dashboard, not the
      // marketing homepage. The :path* wildcard preserves deep links so
      // app.ciafeed.com/dashboard/settings still works after redirect.
      {
        source: "/(.*)",
        has: [{ type: "host", value: "app.ciafeed.com" }],
        destination: "/dashboard",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        // Apply to every route.
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
