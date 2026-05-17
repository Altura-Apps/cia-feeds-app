import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getTenantBySlug, getStorefrontCta } from "@/lib/tenant";
import { storefrontBasePath } from "@/lib/storefront";

export const revalidate = 60;

/**
 * Real-estate listing detail page.
 *
 * Mirrors the services detail UI but:
 *   - Scopes to vertical:"realestate" (not the services publishStatus filter,
 *     which real-estate listings never go through).
 *   - Surfaces property-specific fields from listing.data: beds, baths,
 *     square footage, address, year built, property type. These keys are
 *     populated by the realestate extraction schema in lib/extractionSchema.ts.
 *
 * Originally this route was a 308 redirect into /services/[listingId], but
 * that route's publishStatus filter rejected realestate listings (null
 * publishStatus) and produced 404s. Inline render avoids that mismatch.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; listingId: string }>;
}): Promise<Metadata> {
  const { slug, listingId } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { title: "Not found" };
  const l = await prisma.listing.findFirst({
    where: {
      id: listingId,
      dealerId: tenant.id,
      vertical: "realestate",
      archivedAt: null,
    },
    select: { title: true, imageUrls: true },
  });
  if (!l) return { title: "Not found" };
  return {
    title: `${l.title} — ${tenant.name}`,
    openGraph: {
      title: `${l.title} — ${tenant.name}`,
      siteName: tenant.name,
      images: l.imageUrls?.[0] ? [l.imageUrls[0]] : undefined,
    },
  };
}

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function formatBaths(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v % 1 === 0 ? String(v) : v.toFixed(1);
  }
  if (typeof v === "string" && v.trim()) return v;
  return null;
}

function formatSqft(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return v.toLocaleString();
  if (typeof v === "string" && v.trim()) return v;
  return null;
}

export default async function HomeListingDetail({
  params,
}: {
  params: Promise<{ slug: string; listingId: string }>;
}) {
  const { slug, listingId } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();

  const reqHeaders = await headers();
  const basePath = storefrontBasePath(reqHeaders.get("host"), tenant.slug);

  const l = await prisma.listing.findFirst({
    where: {
      id: listingId,
      dealerId: tenant.id,
      vertical: "realestate",
      archivedAt: null,
    },
  });
  if (!l) notFound();

  const cta = getStorefrontCta(tenant);
  const images = (l.imageUrls ?? []).filter(Boolean);
  const data = (l.data ?? {}) as Record<string, unknown>;
  const description = asString(data.description);
  const beds = asString(data.num_beds);
  const baths = formatBaths(data.num_baths);
  const sqft = formatSqft(data.area_size);
  const address = asString(data.address);
  const city = asString(data.city);
  const region = asString(data.region);
  const postal = asString(data.postal_code);
  const yearBuilt = asString(data.year_built);
  const propertyType = asString(data.property_type); // "for_sale" | "for_rent"

  const fullAddress = [address, [city, region].filter(Boolean).join(", "), postal]
    .filter(Boolean)
    .join(" • ");

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 20px 64px" }}>
      <div style={{ marginBottom: 16, fontSize: 14, opacity: 0.7 }}>
        <Link
          href={`${basePath}/homes`}
          style={{ textDecoration: "underline" }}
        >
          ← Back to listings
        </Link>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(280px, 1fr)",
          gap: 32,
          alignItems: "start",
        }}
      >
        <div>
          {images[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={images[0]}
              alt={l.title}
              style={{
                width: "100%",
                aspectRatio: "4 / 3",
                objectFit: "cover",
                borderRadius: "var(--brand-radius)",
              }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                aspectRatio: "4 / 3",
                background: "var(--brand-accent)",
                borderRadius: "var(--brand-radius)",
              }}
            />
          )}
          {images.length > 1 && (
            <div
              style={{
                marginTop: 12,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                gap: 8,
              }}
            >
              {images.slice(1, 9).map((img, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={img}
                  alt={`${l.title} image ${i + 2}`}
                  style={{
                    width: "100%",
                    aspectRatio: "4 / 3",
                    objectFit: "cover",
                    borderRadius: "var(--brand-radius)",
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <aside>
          {propertyType && (
            <div
              style={{
                display: "inline-block",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                color: "var(--brand-primary, #4F46E5)",
                background: "var(--brand-accent, #EEF2FF)",
                padding: "3px 8px",
                borderRadius: 4,
                marginBottom: 10,
              }}
            >
              {propertyType === "for_rent" ? "For Rent" : "For Sale"}
            </div>
          )}
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, lineHeight: 1.2 }}>
            {l.title}
          </h1>
          {fullAddress && (
            <div style={{ marginTop: 8, fontSize: 14, opacity: 0.75 }}>
              {fullAddress}
            </div>
          )}
          {l.price != null && (
            <div style={{ marginTop: 12, fontSize: 28, fontWeight: 700 }}>
              ${l.price.toLocaleString()}
              {propertyType === "for_rent" && (
                <span style={{ fontSize: 14, fontWeight: 500, opacity: 0.7 }}>
                  /mo
                </span>
              )}
            </div>
          )}

          {(beds || baths || sqft || yearBuilt) && (
            <dl
              style={{
                marginTop: 20,
                paddingTop: 16,
                borderTop: "1px solid var(--brand-border, rgba(0,0,0,0.08))",
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "12px 16px",
                fontSize: 14,
              }}
            >
              {beds && (
                <div>
                  <dt style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Beds
                  </dt>
                  <dd style={{ margin: 0, fontWeight: 600 }}>{beds}</dd>
                </div>
              )}
              {baths && (
                <div>
                  <dt style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Baths
                  </dt>
                  <dd style={{ margin: 0, fontWeight: 600 }}>{baths}</dd>
                </div>
              )}
              {sqft && (
                <div>
                  <dt style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Sq Ft
                  </dt>
                  <dd style={{ margin: 0, fontWeight: 600 }}>{sqft}</dd>
                </div>
              )}
              {yearBuilt && (
                <div>
                  <dt style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Year Built
                  </dt>
                  <dd style={{ margin: 0, fontWeight: 600 }}>{yearBuilt}</dd>
                </div>
              )}
            </dl>
          )}

          <div
            style={{
              marginTop: 24,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <Link
              href={`${basePath}/contact?listing=${l.id}`}
              className="sf-btn"
              style={{ width: "100%" }}
            >
              {cta.label}
            </Link>
            {l.url && (
              <a
                href={l.url}
                target="_blank"
                rel="noreferrer noopener"
                className="sf-btn-outline"
                style={{ width: "100%" }}
              >
                Source →
              </a>
            )}
          </div>
        </aside>
      </div>

      {description && (
        <section style={{ marginTop: 40, maxWidth: 800 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>About this property</h2>
          <p style={{ whiteSpace: "pre-wrap", marginTop: 8, lineHeight: 1.6 }}>
            {description}
          </p>
        </section>
      )}
    </div>
  );
}
