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
  params: Promise<{ slug: string; vehicleId: string }>;
}): Promise<Metadata> {
  const { slug, vehicleId } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { title: "Not found" };
  const v = await prisma.vehicle.findFirst({
    where: { id: vehicleId, dealerId: tenant.id, archivedAt: null },
    select: {
      year: true,
      make: true,
      model: true,
      trim: true,
      imageUrl: true,
      spotlightImageUrl: true,
      images: true,
      description: true,
    },
  });
  if (!v) return { title: "Not found" };
  const title = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
  const img = v.spotlightImageUrl || v.imageUrl || v.images?.[0];
  return {
    title: `${title} — ${tenant.name}`,
    description: v.description?.slice(0, 160) ?? `${title} at ${tenant.name}.`,
    openGraph: {
      title: `${title} — ${tenant.name}`,
      siteName: tenant.name,
      images: img ? [img] : undefined,
    },
  };
}

export default async function VehicleDetail({
  params,
}: {
  params: Promise<{ slug: string; vehicleId: string }>;
}) {
  const { slug, vehicleId } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();
  if (tenant.vertical !== "automotive") notFound();

  const reqHeaders = await headers();
  const basePath = storefrontBasePath(reqHeaders.get("host"), tenant.slug);

  const v = await prisma.vehicle.findFirst({
    where: {
      id: vehicleId,
      dealerId: tenant.id,
      archivedAt: null,
      urlStatus: "active",
    },
  });
  if (!v) notFound();

  const title = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
  const allImages = [
    v.spotlightImageUrl,
    v.imageUrl,
    ...(v.images ?? []),
  ].filter(Boolean) as string[];
  const uniqueImages = Array.from(new Set(allImages));

  const cta = getStorefrontCta(tenant);

  // JSON-LD structured data for Google rich results.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Vehicle",
    name: title,
    brand: v.make ?? undefined,
    model: v.model ?? undefined,
    modelDate: v.year ?? undefined,
    vehicleIdentificationNumber: v.vin ?? undefined,
    vehicleTransmission: v.transmission ?? undefined,
    fuelType: v.fuelType ?? undefined,
    bodyType: v.bodyStyle ?? undefined,
    color: v.exteriorColor ?? undefined,
    mileageFromOdometer: v.mileageValue
      ? { "@type": "QuantitativeValue", value: v.mileageValue, unitCode: "SMI" }
      : undefined,
    image: uniqueImages.length > 0 ? uniqueImages : undefined,
    offers:
      v.price != null
        ? {
            "@type": "Offer",
            price: v.price,
            priceCurrency: "USD",
            availability: "https://schema.org/InStock",
            seller: { "@type": "AutoDealer", name: tenant.name },
          }
        : undefined,
    description: v.description ?? undefined,
  };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 20px 64px" }}>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div style={{ marginBottom: 16, fontSize: 14, opacity: 0.7 }}>
        <Link href={`${basePath}/vehicles`} style={{ textDecoration: "underline" }}>
          ← Back to inventory
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
        {/* Gallery */}
        <div>
          {uniqueImages[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={uniqueImages[0]}
              alt={title}
              style={{
                width: "100%",
                aspectRatio: "4 / 3",
                objectFit: "cover",
                borderRadius: "var(--brand-radius)",
                display: "block",
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
          {uniqueImages.length > 1 && (
            <div
              style={{
                marginTop: 12,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                gap: 8,
              }}
            >
              {uniqueImages.slice(1, 9).map((img, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={img}
                  alt={`${title} image ${i + 2}`}
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

        {/* Details + CTA */}
        <aside>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>{title}</h1>
          {v.price != null && (
            <div style={{ marginTop: 8, fontSize: 24, fontWeight: 700 }}>
              ${v.price.toLocaleString()}
            </div>
          )}
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              marginTop: 20,
              fontSize: 14,
              display: "grid",
              gap: 8,
            }}
          >
            {v.mileageValue != null && (
              <SpecRow label="Mileage" value={`${v.mileageValue.toLocaleString()} mi`} />
            )}
            {v.exteriorColor && <SpecRow label="Color" value={v.exteriorColor} />}
            {v.transmission && <SpecRow label="Transmission" value={v.transmission} />}
            {v.drivetrain && <SpecRow label="Drivetrain" value={v.drivetrain} />}
            {v.fuelType && <SpecRow label="Fuel" value={v.fuelType} />}
            {v.bodyStyle && <SpecRow label="Body" value={v.bodyStyle} />}
            {v.vin && <SpecRow label="VIN" value={v.vin} />}
          </ul>

          <div
            style={{
              marginTop: 24,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <Link
              href={`${basePath}/contact?vehicle=${v.id}`}
              className="sf-btn"
              style={{ width: "100%" }}
            >
              {cta.label}
            </Link>
            {v.url && (
              <a
                href={v.url}
                target="_blank"
                rel="noreferrer noopener"
                className="sf-btn-outline"
                style={{ width: "100%" }}
              >
                See on dealer site →
              </a>
            )}
          </div>
        </aside>
      </div>

      {/* Description */}
      {v.description && (
        <section style={{ marginTop: 40, maxWidth: 800 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>About this vehicle</h2>
          <p style={{ whiteSpace: "pre-wrap", marginTop: 8, lineHeight: 1.6 }}>
            {v.description}
          </p>
        </section>
      )}
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <li
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        paddingBottom: 8,
        borderBottom: "1px solid var(--brand-border)",
      }}
    >
      <span style={{ opacity: 0.65 }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </li>
  );
}
