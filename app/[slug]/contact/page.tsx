import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getTenantBySlug } from "@/lib/tenant";
import { storefrontBasePath } from "@/lib/storefront";
import ContactForm from "./ContactForm";

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { title: "Not found" };
  return {
    title: `Contact — ${tenant.name}`,
    description: `Get in touch with ${tenant.name}.`,
  };
}

export default async function ContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ vehicle?: string; listing?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();

  const reqHeaders = await headers();
  const basePath = storefrontBasePath(reqHeaders.get("host"), tenant.slug);

  // If the visitor clicked through from a VDP/listing, pre-fill the context.
  let context: { kind: "vehicle" | "listing"; id: string; label: string } | null = null;
  if (sp.vehicle) {
    const v = await prisma.vehicle.findFirst({
      where: { id: sp.vehicle, dealerId: tenant.id },
      select: { id: true, year: true, make: true, model: true, trim: true },
    });
    if (v) {
      context = {
        kind: "vehicle",
        id: v.id,
        label: [v.year, v.make, v.model, v.trim].filter(Boolean).join(" "),
      };
    }
  } else if (sp.listing) {
    const l = await prisma.listing.findFirst({
      where: { id: sp.listing, dealerId: tenant.id },
      select: { id: true, title: true },
    });
    if (l) context = { kind: "listing", id: l.id, label: l.title };
  }

  // JSON-LD: LocalBusiness for SEO.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: tenant.name,
    email: tenant.email,
    telephone: tenant.phone ?? undefined,
    address: tenant.address ?? undefined,
    geo:
      tenant.latitude != null && tenant.longitude != null
        ? {
            "@type": "GeoCoordinates",
            latitude: tenant.latitude,
            longitude: tenant.longitude,
          }
        : undefined,
    url: tenant.customDomain
      ? `https://${tenant.customDomain}`
      : `https://www.ciafeed.com/${tenant.slug}`,
  };

  return (
    <div
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: "40px 20px 64px",
      }}
    >
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, margin: 0 }}>
          Contact {tenant.name}
        </h1>
        <p style={{ marginTop: 8, opacity: 0.75 }}>
          We&apos;ll get back to you as soon as we can.
        </p>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(220px, 1fr)",
          gap: 32,
          alignItems: "start",
        }}
      >
        <ContactForm
          dealerId={tenant.id}
          context={context}
          successCtaUrl={basePath || "/"}
        />

        <aside
          className="sf-card"
          style={{
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          <div>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Email</div>
            <a
              href={`mailto:${tenant.email}`}
              style={{ textDecoration: "underline", wordBreak: "break-all" }}
            >
              {tenant.email}
            </a>
          </div>
          {tenant.phone && (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Phone</div>
              <a
                href={`tel:${tenant.phone.replace(/[^0-9+]/g, "")}`}
                style={{ textDecoration: "underline" }}
              >
                {tenant.phone}
              </a>
            </div>
          )}
          {tenant.address && (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Address</div>
              <div>{tenant.address}</div>
            </div>
          )}
          {tenant.latitude != null && tenant.longitude != null && (
            <a
              href={`https://www.google.com/maps?q=${tenant.latitude},${tenant.longitude}`}
              target="_blank"
              rel="noreferrer noopener"
              className="sf-btn-outline"
              style={{ fontSize: 13, padding: "8px 12px", textAlign: "center" }}
            >
              Get directions →
            </a>
          )}
        </aside>
      </div>
    </div>
  );
}
