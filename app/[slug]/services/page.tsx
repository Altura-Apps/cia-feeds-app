import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getTenantBySlug } from "@/lib/tenant";
import { storefrontBasePath } from "@/lib/storefront";
import PixelInitializer from "@/app/components/PixelInitializer";

export const revalidate = 60;
const PAGE_SIZE = 24;

function labelForVertical(vertical: string): { plural: string; cta: string } {
  if (vertical === "realestate") return { plural: "Listings", cta: "Explore properties" };
  if (vertical === "ecommerce") return { plural: "Products", cta: "Browse products" };
  return { plural: "Services", cta: "Explore services" };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { title: "Not found" };
  const label = labelForVertical(tenant.vertical);
  return {
    title: `${label.plural} — ${tenant.name}`,
    description: `${label.cta} at ${tenant.name}.`,
  };
}

export default async function ServicesIndex({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();

  const reqHeaders = await headers();
  const basePath = storefrontBasePath(reqHeaders.get("host"), tenant.slug);

  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const q = sp.q?.trim() || undefined;

  const where = {
    dealerId: tenant.id,
    archivedAt: null,
    publishStatus: {
      in: ["published", "ready_to_publish", "validated"],
    },
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { vertical: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [listings, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      select: {
        id: true,
        title: true,
        price: true,
        imageUrls: true,
        vertical: true,
      },
    }),
    prisma.listing.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 20px 64px" }}>
      {/* Meta Pixel — fires PageView on the listings index. Detail pages
          fire their own ViewContent events separately. */}
      {tenant.metaPixelId && (
        <PixelInitializer pixelId={tenant.metaPixelId} />
      )}
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, margin: 0 }}>
          {labelForVertical(tenant.vertical).plural}
        </h1>
        <p style={{ marginTop: 6, opacity: 0.7, fontSize: 15 }}>
          {total.toLocaleString()} listing{total === 1 ? "" : "s"}
        </p>
      </header>

      <form
        method="get"
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          padding: 16,
          background: "var(--brand-surface)",
          borderRadius: "var(--brand-radius)",
          marginBottom: 24,
        }}
      >
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search..."
          style={{
            flex: "1 1 240px",
            padding: "10px 14px",
            borderRadius: "var(--brand-radius)",
            border: "1px solid var(--brand-border)",
            background: "var(--brand-bg)",
            color: "var(--brand-fg)",
            fontSize: 14,
          }}
        />
        <button type="submit" className="sf-btn" style={{ fontSize: 14 }}>
          Search
        </button>
        {q && (
          <Link
            href={`${basePath}/services`}
            style={{ fontSize: 14, textDecoration: "underline", opacity: 0.7 }}
          >
            Clear
          </Link>
        )}
      </form>

      {listings.length === 0 ? (
        <div
          className="sf-card"
          style={{ padding: 48, textAlign: "center", opacity: 0.7 }}
        >
          No listings yet.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 20,
          }}
        >
          {listings.map((l) => {
            const img = l.imageUrls?.[0] ?? null;
            return (
              <Link
                key={l.id}
                href={`${basePath}/services/${l.id}`}
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

      {totalPages > 1 && (
        <nav style={{ marginTop: 32, display: "flex", justifyContent: "center", gap: 8 }}>
          {page > 1 && (
            <Link
              href={`/${slug}/services?page=${page - 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className="sf-btn-outline"
              style={{ fontSize: 14, padding: "8px 14px" }}
            >
              ← Prev
            </Link>
          )}
          <span style={{ padding: "8px 14px", opacity: 0.7, fontSize: 14 }}>
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/${slug}/services?page=${page + 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className="sf-btn-outline"
              style={{ fontSize: 14, padding: "8px 14px" }}
            >
              Next →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
