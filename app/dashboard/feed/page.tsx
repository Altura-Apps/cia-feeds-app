import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { checkSubscription } from "@/lib/checkSubscription";
import { getEffectiveDealerContext } from "@/lib/impersonation";
import { VERTICAL_LABELS, type Vertical } from "@/lib/verticals";
import FeedUrlCard from "./FeedUrlCard";
import EmbedWidgetCard from "./EmbedWidgetCard";
import UrlHealthCheckToggle from "./UrlHealthCheckToggle";
import FeedUrlModeToggle from "./FeedUrlModeToggle";

const BACK_LABEL: Record<string, string> = {
  automotive: "Vehicles",
  services: "Services",
  ecommerce: "Products",
  realestate: "Listings",
};

export default async function FeedPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/login");
  }

  const { effectiveDealerId } =
    await getEffectiveDealerContext();

  if (!effectiveDealerId) {
    redirect("/login");
  }

  const isSubscribed = await checkSubscription(effectiveDealerId);
  if (!isSubscribed) {
    redirect("/subscribe");
  }

  const dealer = await prisma.dealer.findUnique({
    where: { id: effectiveDealerId },
    select: { slug: true, vertical: true, phone: true, fbPageId: true, ctaPreference: true, address: true, urlHealthCheckEnabled: true, customDomain: true, translationLang: true, translationTone: true, metaPixelId: true, feedUrlMode: true, metaDeliveryMethod: true },
  });

  const slug = dealer?.slug ?? (session.user.slug as string | undefined) ?? "";
  const dealerVertical = dealer?.vertical ?? "automotive";

  if (!slug) {
    redirect("/login");
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  const feedUrl = `${appUrl}/feeds/${slug}.csv`;
  const catalogApiUrl = `${appUrl}/api/catalog/${slug}`;
  const urlHealthCheckEnabled = dealer?.urlHealthCheckEnabled ?? true;
  const dealerPhone = dealer?.phone ?? null;
  const dealerFbPageId = dealer?.fbPageId ?? null;
  const dealerCtaPreference = dealer?.ctaPreference ?? null;

  const userName = session.user.name ?? "";

  const publishedServicesCount =
    dealerVertical === "services"
      ? await prisma.listing.count({
          where: {
            dealerId: effectiveDealerId,
            vertical: "services",
            publishStatus: "published",
            archivedAt: null,
          },
        })
      : 0;

  const isApiMode = dealer?.metaDeliveryMethod === "api";

  const [activeQueueJob, lastRunJob] = isApiMode
    ? await Promise.all([
        prisma.metaDeliveryJob.findFirst({
          where: {
            dealerId: effectiveDealerId,
            status: { in: ["queued", "processing", "retry"] },
          },
          orderBy: { updatedAt: "desc" },
          select: { status: true },
        }),
        prisma.metaDeliveryJob.findFirst({
          where: {
            dealerId: effectiveDealerId,
            lastRunAt: { not: null },
          },
          orderBy: { lastRunAt: "desc" },
          select: { lastRunAt: true, lastRunStatus: true },
        }),
      ])
    : [null, null];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="text-sm text-indigo-600 hover:text-indigo-500"
            >
              &larr; {BACK_LABEL[dealerVertical] ?? "Dashboard"}
            </Link>
            <span className="font-bold text-lg text-gray-900">CIAfeeds</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">{userName}</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-xl mx-auto px-6 py-12">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Your Meta Catalog Feed
        </h1>
        <p className="text-sm text-gray-500 mb-8">
          Use this URL in Meta&apos;s catalog setup to power your{" "}
          {VERTICAL_LABELS[dealerVertical as Vertical] ?? dealerVertical} catalog feed.
        </p>

        {!dealer?.address?.trim() ? (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-md p-4 mt-6">
            <p>
              Please add your dealership address in your{" "}
              <Link
                href="/dashboard/profile"
                className="text-indigo-600 hover:text-indigo-500 underline font-medium"
              >
                Profile
              </Link>{" "}
              before your feed can be used.
            </p>
          </div>
        ) : dealerVertical === "services" && publishedServicesCount === 0 ? (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-md p-4 mt-6">
            <p>
              You don&apos;t have any published services yet. Validate your service URLs to publish them and enable your feed.
            </p>
          </div>
        ) : (
          <>
            {isApiMode ? (
              <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="text-sm font-bold text-gray-800">Delivery Mode: API push</h2>
                  <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">active</span>
                </div>
                <div className="text-sm text-gray-700 space-y-1">
                  <p>
                    Queue status:{" "}
                    {activeQueueJob ? (
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        activeQueueJob.status === "processing" ? "bg-blue-100 text-blue-800" :
                        activeQueueJob.status === "queued" || activeQueueJob.status === "retry" ? "bg-yellow-100 text-yellow-800" :
                        "bg-gray-100 text-gray-700"
                      }`}>{activeQueueJob.status}</span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">idle</span>
                    )}
                  </p>
                  <p>
                    Last run:{" "}
                    {lastRunJob?.lastRunAt
                      ? <>
                          {new Date(lastRunJob.lastRunAt).toLocaleString()}
                          {lastRunJob.lastRunStatus && (
                            <span className={`ml-2 inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                              lastRunJob.lastRunStatus === "success" || lastRunJob.lastRunStatus === "complete" ? "bg-green-100 text-green-800" :
                              lastRunJob.lastRunStatus === "error" || lastRunJob.lastRunStatus === "blocked" ? "bg-red-100 text-red-800" :
                              "bg-gray-100 text-gray-700"
                            }`}>{lastRunJob.lastRunStatus}</span>
                          )}
                        </>
                      : "No deliveries yet"}
                  </p>
                </div>
                <Link
                  href="/dashboard/profile#meta-delivery"
                  className="text-sm text-indigo-600 hover:text-indigo-500 mt-3 inline-block"
                >
                  View full delivery health &rarr;
                </Link>
              </div>
            ) : (
              <>
                <FeedUrlCard feedUrl={feedUrl} vertical={dealerVertical} />
                <FeedUrlModeToggle feedUrlMode={dealer?.feedUrlMode ?? "original"} />
              </>
            )}

            <div className="mt-6" />

            <EmbedWidgetCard
              slug={slug}
              phone={dealerPhone}
              fbPageId={dealerFbPageId}
              vertical={dealerVertical}
              catalogApiUrl={catalogApiUrl}
              ctaPreference={dealerCtaPreference}
              defaultLandingBaseUrl={appUrl}
              translationLang={dealer?.translationLang ?? "en"}
              translationTone={dealer?.translationTone ?? "professional"}
              metaPixelId={dealer?.metaPixelId ?? ""}
            />
          </>
        )}

        <div className="mt-6">
          <UrlHealthCheckToggle urlHealthCheckEnabled={urlHealthCheckEnabled} />
        </div>
      </div>
    </div>
  );
}
