import { ReactNode } from "react";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { getTenantBySlug } from "@/lib/tenant";
import { brandPresetToCssVars } from "@/lib/brandPresets";
import { storefrontBasePath } from "@/lib/storefront";

/**
 * Storefront shell. Wraps every public dealer page with:
 *   - Brand-aware CSS custom properties (--brand-primary etc.)
 *   - A simple header (logo + nav)
 *   - "Powered by CIA Feeds" footer
 *
 * Theming is applied via an inline <style> emitted server-side so the page's
 * very first paint already uses the correct colors (no FOUC).
 *
 * Caching: dealer rows change rarely, so we lean on Next's RSC cache and a
 * short CDN s-maxage for the page itself. Layout simply reads tenant once
 * per request; child pages re-read as needed.
 */
export default async function StorefrontLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();

  // Host-aware link base path so the header nav doesn't double-prefix the
  // dealer slug when rendered under a subdomain or custom domain. See
  // lib/storefront.storefrontBasePath().
  const reqHeaders = await headers();
  const basePath = storefrontBasePath(reqHeaders.get("host"), tenant.slug);
  const homeHref = basePath || "/";

  const cssVars = brandPresetToCssVars(tenant.theme);
  const logo = tenant.logoUrl || tenant.profileImageUrl;
  const inventoryLabel =
    tenant.vertical === "automotive" ? "Inventory" : "Services";
  const inventorySegment =
    tenant.vertical === "automotive" ? "vehicles" : "services";

  // CSP-friendly inline style: scoped to a single class.
  return (
    <div className="storefront-root" style={{ minHeight: "100vh" }}>
      <style
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: `
.storefront-root {
  ${cssVars};
  background: var(--brand-bg);
  color: var(--brand-fg);
  font-family: ${
    tenant.theme.fontFamily
      ? `'${tenant.theme.fontFamily}', `
      : ""
  }-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}
.storefront-root a { color: inherit; text-decoration: none; }
.storefront-root .sf-btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 12px 24px;
  background: var(--brand-primary); color: var(--brand-primary-fg);
  border-radius: var(--brand-radius);
  font-weight: 600; transition: opacity 120ms;
}
.storefront-root .sf-btn:hover { opacity: 0.9; }
.storefront-root .sf-btn-outline {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 11px 23px;
  background: transparent; color: var(--brand-fg);
  border: 1px solid var(--brand-border);
  border-radius: var(--brand-radius);
  font-weight: 500;
}
.storefront-root .sf-btn-outline:hover { background: var(--brand-accent); }
.storefront-root .sf-card {
  background: var(--brand-surface); color: var(--brand-surface-fg);
  border: 1px solid var(--brand-border);
  border-radius: var(--brand-radius);
  overflow: hidden;
  transition: transform 120ms, box-shadow 120ms;
}
.storefront-root .sf-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0,0,0,0.08);
}
.storefront-root header.sf-header {
  border-bottom: 1px solid var(--brand-border);
  background: var(--brand-bg);
  position: sticky; top: 0; z-index: 10;
  backdrop-filter: blur(8px);
}
.storefront-root footer.sf-footer {
  border-top: 1px solid var(--brand-border);
  margin-top: 64px; padding: 32px 20px;
  color: var(--brand-fg); opacity: 0.7;
  font-size: 14px; text-align: center;
}
@media (max-width: 640px) {
  .storefront-root .sf-btn, .storefront-root .sf-btn-outline { padding: 10px 18px; }
}
          `.trim(),
        }}
      />

      <header className="sf-header">
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "14px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <Link
            href={homeHref}
            style={{ display: "flex", alignItems: "center", gap: 12 }}
          >
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logo}
                alt={`${tenant.name} logo`}
                style={{
                  height: 40,
                  width: "auto",
                  maxWidth: 160,
                  objectFit: "contain",
                }}
              />
            ) : null}
            <span style={{ fontWeight: 700, fontSize: 18 }}>{tenant.name}</span>
          </Link>
          <nav
            style={{ display: "flex", gap: 12, alignItems: "center" }}
            aria-label="Primary"
          >
            <Link
              href={`${basePath}/${inventorySegment}`}
              style={{ fontWeight: 500, fontSize: 14 }}
            >
              {inventoryLabel}
            </Link>
            <Link
              href={`${basePath}/contact`}
              className="sf-btn"
              style={{ fontSize: 14, padding: "8px 16px" }}
            >
              Contact
            </Link>
          </nav>
        </div>
      </header>

      <main>{children}</main>

      <footer className="sf-footer">
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ marginBottom: 6 }}>
            &copy; {new Date().getFullYear()} {tenant.name}
            {tenant.phone ? <> &middot; {tenant.phone}</> : null}
            {tenant.address ? <> &middot; {tenant.address}</> : null}
          </div>
          <div style={{ fontSize: 12 }}>
            Powered by{" "}
            <a
              href="https://www.ciafeed.com"
              target="_blank"
              rel="noreferrer noopener"
              style={{ textDecoration: "underline" }}
            >
              CIA Feeds
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
