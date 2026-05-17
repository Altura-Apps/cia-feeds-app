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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { title: "Not found" };
  return {
    title: `Vehicles — ${tenant.name}`,
    description: `Browse the full vehicle inventory at ${tenant.name}.`,
  };
}

export default async function VehiclesIndex({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string; make?: string; q?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const tenant = await getTenantBySlug(slug);
  if (!tenant || tenant.vertical !== "automotive") notFound();

  const reqHeaders = await headers();
  const basePath = storefrontBasePath(reqHeaders.get("host"), tenant.slug);

  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const make = sp.make?.trim() || undefined;
  const q = sp.q?.trim() || undefined;

  const where = {
    dealerId: tenant.id,
    archivedAt: null,
    urlStatus: "active",
    scrapeStatus: { not: "failed" },
    ...(make ? { make: { equals: make, mode: "insensitive" as const } } : {}),
    ...(q
      ? {
          OR: [
            { make: { contains: q, mode: "insensitive" as const } },
            { model: { contains: q, mode: "insensitive" as const } },
            { trim: { contains: q, mode: "insensitive" as const } },
            { year: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [vehicles, total, allMakes] = await Promise.all([
    prisma.vehicle.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      select: {
        id: true,
        year: true,
        make: true,
        model: true,
        trim: true,
        price: true,
        mileageValue: true,
        imageUrl: true,
        spotlightImageUrl: true,
        images: true,
      },
    }),
    prisma.vehicle.count({ where }),
    prisma.vehicle.findMany({
      where: { dealerId: tenant.id, archivedAt: null, make: { not: null } },
      distinct: ["make"],
      select: { make: true },
      orderBy: { make: "asc" },
      take: 100,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const makes = Array.from(
    new Set(allMakes.map((m) => m.make).filter(Boolean))
  ) as string[];

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 20px 64px" }}>
      {/* Meta Pixel — fires PageView on the vehicles index. Detail pages
          fire their own ViewContent events separately. */}
      {tenant.metaPixelId && (
        <PixelInitializer pixelId={tenant.metaPixelId} />
      )}
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, margin: 0 }}>Inventory</h1>
        <p style={{ marginTop: 6, opacity: 0.7, fontSize: 15 }}>
          {total.toLocaleString()} vehicle{total === 1 ? "" : "s"} available
        </p>
      </header>

      {/* Filters */}
      <form
        method="get"
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
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
          placeholder="Search by make, model, year..."
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
        <select
          name="make"
          defaultValue={make ?? ""}
          style={{
            padding: "10px 14px",
            borderRadius: "var(--brand-radius)",
            border: "1px solid var(--brand-border)",
            background: "var(--brand-bg)",
            color: "var(--brand-fg)",
            fontSize: 14,
            minWidth: 140,
          }}
        >
          <option value="">All makes</option>
          {makes.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button type="submit" className="sf-btn" style={{ fontSize: 14 }}>
          Filter
        </button>
        {(q || make) && (
          <Link
            href={`${basePath}/vehicles`}
            style={{ fontSize: 14, textDecoration: "underline", opacity: 0.7 }}
          >
            Clear
          </Link>
        )}
      </form>

      {/* Results grid */}
      {vehicles.length === 0 ? (
        <div
          className="sf-card"
          style={{
            padding: 48,
            textAlign: "center",
            opacity: 0.7,
            fontSize: 16,
          }}
        >
          No matches. Try a different search.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 20,
          }}
        >
          {vehicles.map((v) => {
            const title = [v.year, v.make, v.model, v.trim]
              .filter(Boolean)
              .join(" ");
            const img =
              v.spotlightImageUrl || v.imageUrl || v.images?.[0] || null;
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
                  <div style={{ fontWeight: 600, fontSize: 16 }}>{title}</div>
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
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <nav
          aria-label="Pagination"
          style={{
            marginTop: 32,
            display: "flex",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {page > 1 && (
            <Link
              href={buildPageHref(slug, page - 1, sp)}
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
              href={buildPageHref(slug, page + 1, sp)}
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

function buildPageHref(
  slug: string,
  page: number,
  sp: { make?: string; q?: string }
): string {
  const params = new URLSearchParams();
  if (sp.q) params.set("q", sp.q);
  if (sp.make) params.set("make", sp.make);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `/${slug}/vehicles${qs ? `?${qs}` : ""}`;
}
