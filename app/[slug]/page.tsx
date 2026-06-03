import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import type { Metadata } from "next";
import { getTenantBySlug, getStorefrontCta } from "@/lib/tenant";
import { getStorefrontLayout, storefrontBasePath } from "@/lib/storefront";
import { getSegmentInventory } from "@/lib/storefrontQueries";
import type { Vertical } from "@/lib/verticals";
import PixelInitializer from "@/app/components/PixelInitializer";
import StorefrontChatMount from "@/app/components/StorefrontChatMount";
import AIChatOpenerButton from "@/app/components/AIChatOpenerButton";

export const revalidate = 60;

function storefrontLabel(vertical: string): string {
  if (vertical === "automotive") return "Vehicle Inventory";
  if (vertical === "realestate") return "Property Listings";
  if (vertical === "ecommerce") return "Products";
  return "Services";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { title: "Not found" };
  const titleSuffix = storefrontLabel(tenant.vertical);
  return {
    title: `${tenant.name} — ${titleSuffix}`,
    description: `Browse the latest offerings from ${tenant.name}.`,
    openGraph: {
      title: `${tenant.name} — ${titleSuffix}`,
      siteName: tenant.name,
      images:
        tenant.logoUrl || tenant.profileImageUrl
          ? [tenant.logoUrl || tenant.profileImageUrl!]
          : undefined,
    },
  };
}

export default async function StorefrontHome({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();

  const layout = await getStorefrontLayout(tenant.id);
  const cta = getStorefrontCta(tenant);

  // Compute the link base path. On the apex (www.ciafeed.com/<slug>) links
  // need the /<slug> prefix; on the subdomain or custom domain the proxy
  // adds it server-side, so emit root-relative links to avoid a double
  // prefix (which produced 404s on every internal nav).
  const reqHeaders = await headers();
  const basePath = storefrontBasePath(reqHeaders.get("host"), tenant.slug);

  // Multi-segment dealers see the catalog landing page. Single-segment dealers
  // keep the original hero-plus-inventory layout (so legacy single-vertical
  // dealers see no visual change).
  if (layout.segments.length > 1) {
    return (
      <>
        <MultiSegmentHome
          tenantId={tenant.id}
          tenantName={tenant.name}
          basePath={basePath}
          metaPixelId={tenant.metaPixelId}
          segments={layout.segments}
          ctaLabel={cta.label}
          ctaHref={cta.buildHref({
            contactFormHref: `${basePath}/contact`,
            message: `Hi, I'm interested in ${tenant.name}`,
          })}
          ctaExternal={cta.intent === "whatsapp" || cta.intent === "messenger"}
          ctaIsAiChat={cta.intent === "ai_chat"}
        />
        {cta.intent === "ai_chat" && (
          <StorefrontChatMount
            dealerSlug={tenant.slug}
            initialLocale={tenant.aiChatDefaultLocale === "es" ? "es" : "en"}
          />
        )}
      </>
    );
  }

  // Single-segment path. Use the layout's segment if we have one (it carries
  // the correct subAccountIds for tenants that have a sub-account in the
  // matching vertical); otherwise fall back to filtering by the parent
  // dealer's vertical for legacy dealers without sub-accounts.
  const segment = layout.segments[0];
  const verticals: Vertical[] = segment
    ? segment.verticals
    : [tenant.vertical as Vertical];
  const subAccountIds = segment ? segment.subAccountIds : [];
  const isAutomotive = verticals.includes("automotive");
  const primaryVertical = verticals[0];

  const inventory = await getSegmentInventory({
    dealerId: tenant.id,
    verticals,
    subAccountIds,
    take: 6,
  });

  const segmentPath = segment ? segment.slug : isAutomotive ? "vehicles" : "services";

  return (
    <div>
      {tenant.metaPixelId && <PixelInitializer pixelId={tenant.metaPixelId} />}
      {/* Hero */}
      <section
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "64px 20px 40px",
          textAlign: "center",
        }}
      >
        <h1
          style={{
            fontSize: "clamp(32px, 5vw, 56px)",
            fontWeight: 800,
            margin: 0,
            lineHeight: 1.1,
          }}
        >
          {isAutomotive
            ? `Find your next vehicle at ${tenant.name}`
            : primaryVertical === "realestate"
            ? `Find your next home with ${tenant.name}`
            : `${tenant.name}`}
        </h1>
        <p
          style={{
            fontSize: 18,
            marginTop: 16,
            opacity: 0.75,
            maxWidth: 640,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {isAutomotive
            ? "Browse our current inventory below or get in touch and we'll help you find the right one."
            : primaryVertical === "realestate"
            ? "Browse the latest property listings below or get in touch to schedule a tour."
            : "Explore our services and reach out anytime."}
        </p>
        <div
          style={{
            marginTop: 28,
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <Link href={`${basePath}/${segmentPath}`} className="sf-btn">
            View {isAutomotive ? "Inventory" : primaryVertical === "realestate" ? "Listings" : "Services"}
          </Link>
          {cta.intent === "ai_chat" ? (
            <AIChatOpenerButton label={cta.label} className="sf-btn-outline" />
          ) : (
            <a
              href={cta.buildHref({
                contactFormHref: `${basePath}/contact`,
                message: `Hi, I'm interested in your ${
                  isAutomotive ? "inventory" : primaryVertical === "realestate" ? "listings" : "services"
                }`,
              })}
              {...(cta.intent === "whatsapp" || cta.intent === "messenger"
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
              className="sf-btn-outline"
            >
              {cta.label}
            </a>
          )}
        </div>
      </section>

      {/* Featured grid */}
      <section
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "24px 20px 64px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 20,
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>
            {isAutomotive
              ? "Latest vehicles"
              : primaryVertical === "realestate"
              ? "Latest listings"
              : "Featured"}
          </h2>
          <Link
            href={`${basePath}/${segmentPath}`}
            style={{
              fontSize: 14,
              fontWeight: 500,
              textDecoration: "underline",
              opacity: 0.8,
            }}
          >
            See all →
          </Link>
        </div>

        {isAutomotive ? (
          inventory.vehicles.length === 0 ? (
            <EmptyState message="No vehicles in inventory yet — check back soon." />
          ) : (
            <div className="sf-grid">
              {inventory.vehicles.map((v) => {
                const title = [v.year, v.make, v.model, v.trim]
                  .filter(Boolean)
                  .join(" ");
                const img =
                  v.spotlightImageUrl ||
                  v.imageUrl ||
                  (v.images && v.images[0]) ||
                  null;
                return (
                  <Link
                    key={v.id}
                    href={`${basePath}/vehicles/${v.id}`}
                    className="sf-card"
                    style={{ display: "block" }}
                  >
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={img}
                        alt={title}
                        style={{
                          width: "100%",
                          aspectRatio: "4 / 3",
                          objectFit: "cover",
                          display: "block",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          aspectRatio: "4 / 3",
                          background: "var(--brand-accent)",
                        }}
                      />
                    )}
                    <div style={{ padding: 16 }}>
                      <div style={{ fontWeight: 600, fontSize: 16 }}>
                        {title || "Vehicle"}
                      </div>
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 14,
                          opacity: 0.7,
                          display: "flex",
                          gap: 10,
                        }}
                      >
                        {v.price != null && <span>${v.price.toLocaleString()}</span>}
                        {v.mileageValue != null && (
                          <span>{v.mileageValue.toLocaleString()} mi</span>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )
        ) : inventory.listings.length === 0 ? (
          <EmptyState
            message={
              primaryVertical === "realestate"
                ? "No listings yet — check back soon."
                : "No services listed yet — check back soon."
            }
          />
        ) : (
          <div className="sf-grid">
            {inventory.listings.map((l) => {
              const img = l.imageUrls?.[0] ?? null;
              const detailKind = l.vertical === "realestate" ? "homes" : "services";
              return (
                <Link
                  key={l.id}
                  href={`${basePath}/${detailKind}/${l.id}`}
                  className="sf-card"
                  style={{ display: "block" }}
                >
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={img}
                      alt={l.title}
                      style={{
                        width: "100%",
                        aspectRatio: "4 / 3",
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        aspectRatio: "4 / 3",
                        background: "var(--brand-accent)",
                      }}
                    />
                  )}
                  <div style={{ padding: 16 }}>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>{l.title}</div>
                    {l.price != null && (
                      <div style={{ marginTop: 6, fontSize: 14, opacity: 0.7 }}>
                        ${l.price.toLocaleString()}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <style
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: `
.sf-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 20px;
}
            `.trim(),
          }}
        />
      </section>
      {cta.intent === "ai_chat" && (
        <StorefrontChatMount
          dealerSlug={tenant.slug}
          initialLocale={tenant.aiChatDefaultLocale === "es" ? "es" : "en"}
        />
      )}
    </div>
  );
}

/**
 * Catalog landing page rendered when a dealer has 2+ storefront segments
 * (e.g. multiple unbundled verticals, or a mix of bundles and verticals).
 * Each segment shows up as a card with a "Browse" call-to-action.
 */
async function MultiSegmentHome({
  tenantId,
  tenantName,
  basePath,
  metaPixelId,
  segments,
  ctaLabel,
  ctaHref,
  ctaExternal,
  ctaIsAiChat,
}: {
  tenantId: string;
  tenantName: string;
  basePath: string;
  metaPixelId: string | null;
  segments: Awaited<ReturnType<typeof getStorefrontLayout>>["segments"];
  ctaLabel: string;
  ctaHref: string;
  ctaExternal: boolean;
  ctaIsAiChat: boolean;
}) {
  // Pull a 3-up preview for each segment in parallel.
  const previews = await Promise.all(
    segments.map((s) =>
      getSegmentInventory({
        dealerId: tenantId,
        verticals: s.verticals,
        subAccountIds: s.subAccountIds,
        take: 3,
      })
    )
  );

  return (
    <div>
      {metaPixelId && <PixelInitializer pixelId={metaPixelId} />}
      <section
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "64px 20px 24px",
          textAlign: "center",
        }}
      >
        <h1
          style={{
            fontSize: "clamp(32px, 5vw, 56px)",
            fontWeight: 800,
            margin: 0,
            lineHeight: 1.1,
          }}
        >
          Welcome to {tenantName}
        </h1>
        <p
          style={{
            fontSize: 18,
            marginTop: 16,
            opacity: 0.75,
            maxWidth: 640,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          Browse our catalogs below. Each one is a curated selection — tap any
          card to dive in.
        </p>
        <div style={{ marginTop: 24 }}>
          {ctaIsAiChat ? (
            <AIChatOpenerButton label={ctaLabel} className="sf-btn-outline" />
          ) : (
            <a
              href={ctaHref}
              {...(ctaExternal
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
              className="sf-btn-outline"
            >
              {ctaLabel}
            </a>
          )}
        </div>
      </section>

      <section
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "16px 20px 80px",
        }}
      >
        <div className="sf-catalog-grid">
          {segments.map((seg, i) => {
            const preview = previews[i];
            const firstImage =
              preview.vehicles[0]?.spotlightImageUrl ||
              preview.vehicles[0]?.imageUrl ||
              preview.vehicles[0]?.images?.[0] ||
              preview.listings[0]?.imageUrls?.[0] ||
              null;
            const itemCount = preview.vehicles.length + preview.listings.length;
            return (
              <Link
                key={seg.slug}
                href={`${basePath}/${seg.slug}`}
                className="sf-card"
                style={{ display: "block" }}
              >
                {firstImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={firstImage}
                    alt={seg.name}
                    style={{
                      width: "100%",
                      aspectRatio: "16 / 9",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      aspectRatio: "16 / 9",
                      background: "var(--brand-accent)",
                    }}
                  />
                )}
                <div style={{ padding: 20 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: 0.5,
                      textTransform: "uppercase",
                      opacity: 0.6,
                      marginBottom: 6,
                    }}
                  >
                    {seg.kind === "bundle" ? "Collection" : "Catalog"}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 22 }}>{seg.name}</div>
                  {seg.description && (
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: 14,
                        opacity: 0.75,
                        lineHeight: 1.5,
                      }}
                    >
                      {seg.description}
                    </div>
                  )}
                  <div
                    style={{
                      marginTop: 14,
                      fontSize: 13,
                      opacity: 0.65,
                    }}
                  >
                    {itemCount > 0
                      ? `${itemCount} ${itemCount === 1 ? "item" : "items"} shown`
                      : "Coming soon"}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
        <style
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: `
.sf-catalog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 24px;
}
            `.trim(),
          }}
        />
      </section>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      className="sf-card"
      style={{
        padding: 48,
        textAlign: "center",
        opacity: 0.7,
        fontSize: 16,
      }}
    >
      {message}
    </div>
  );
}
