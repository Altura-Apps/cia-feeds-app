import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getTenantBySlug, getStorefrontCta } from "@/lib/tenant";
import { storefrontBasePath } from "@/lib/storefront";

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; listingId: string }>;
}): Promise<Metadata> {
  const { slug, listingId } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { title: "Not found" };
  const l = await prisma.listing.findFirst({
    where: { id: listingId, dealerId: tenant.id, archivedAt: null },
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

export default async function ListingDetail({
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
      archivedAt: null,
      publishStatus: { in: ["published", "ready_to_publish", "validated"] },
    },
  });
  if (!l) notFound();

  const cta = getStorefrontCta(tenant);
  const images = (l.imageUrls ?? []).filter(Boolean);
  const description =
    typeof (l.data as Record<string, unknown>)?.description === "string"
      ? ((l.data as Record<string, string>).description as string)
      : null;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 20px 64px" }}>
      <div style={{ marginBottom: 16, fontSize: 14, opacity: 0.7 }}>
        <Link
          href={`${basePath}/services`}
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
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>{l.title}</h1>
          {l.price != null && (
            <div style={{ marginTop: 8, fontSize: 24, fontWeight: 700 }}>
              ${l.price.toLocaleString()}
            </div>
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
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Description</h2>
          <p style={{ whiteSpace: "pre-wrap", marginTop: 8, lineHeight: 1.6 }}>
            {description}
          </p>
        </section>
      )}
    </div>
  );
}
