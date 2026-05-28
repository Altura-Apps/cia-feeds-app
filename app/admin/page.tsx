import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { DealerSearch } from "./DealerSearch";

export default async function AdminPage() {
  const dealers = await prisma.dealer.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { vehicles: true } },
    },
  });

  const dealerIds = dealers.map((d) => d.id);

  const [completeCounts, listingCounts, deliveryHealthRows] = await Promise.all([
    prisma.vehicle.groupBy({
      by: ['dealerId'],
      where: { isComplete: true },
      _count: true,
    }),
    prisma.listing.groupBy({
      by: ['dealerId'],
      where: { archivedAt: null },
      _count: true,
    }),
    dealerIds.length > 0
      ? prisma.$queryRaw<
          {
            dealerId: string;
            status: string | null;
            lastRunStatus: string | null;
            blockedReason: string | null;
            blockedAt: Date | null;
            lastRunAt: Date | null;
            attemptCount: number | null;
            nextRunAt: Date | null;
            lastErrorCode: string | null;
            hasBlocked: boolean;
          }[]
        >`
          SELECT
            latest."dealerId",
            latest."status",
            latest."lastRunStatus",
            latest."blockedReason",
            latest."blockedAt",
            latest."lastRunAt",
            latest."attemptCount",
            latest."nextRunAt",
            latest."lastErrorCode",
            COALESCE(blocked."hasBlocked", false) AS "hasBlocked"
          FROM (
            SELECT DISTINCT ON ("dealerId")
              "dealerId", "status", "lastRunStatus", "blockedReason",
              "blockedAt", "lastRunAt", "attemptCount", "nextRunAt", "lastErrorCode"
            FROM "MetaDeliveryJob"
            WHERE "dealerId" = ANY(${dealerIds})
            ORDER BY "dealerId", "updatedAt" DESC
          ) latest
          LEFT JOIN (
            SELECT "dealerId", true AS "hasBlocked"
            FROM "MetaDeliveryJob"
            WHERE "dealerId" = ANY(${dealerIds}) AND "status" = 'blocked'
            GROUP BY "dealerId"
          ) blocked USING ("dealerId")
        `
      : Promise.resolve([]),
  ]);

  const completeMap = new Map<string, number>(
    completeCounts.map((row) => [row.dealerId, row._count])
  );
  const listingMap = new Map<string, number>(
    listingCounts.map((row) => [row.dealerId, row._count])
  );
  const blockedDealerIds = new Set(
    deliveryHealthRows.filter((r) => r.hasBlocked).map((r) => r.dealerId)
  );
  const latestJobByDealer = new Map(
    deliveryHealthRows.map((r) => [r.dealerId, r])
  );

  const totalDealers = dealers.length;
  const activeCount = dealers.filter(
    (d) => d.subscriptionStatus === "active"
  ).length;
  const pastDueCount = dealers.filter(
    (d) => d.subscriptionStatus === "past_due"
  ).length;
  const noSubCount = dealers.filter((d) => !d.subscriptionStatus).length;

  type Row = {
    id: string;
    name: string;
    email: string;
    slug: string;
    vertical: string;
    subscriptionStatus: string | null;
    totalVehicles: number;
    completeCount: number;
    listingCount: number;
    metaDeliveryMethod: string;
    deliveryHealth: "green" | "amber" | "red";
    deliveryHealthTitle: string;
    joinedISO: string;
    feedUrl: string;
  };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  const rows: Row[] = dealers.map((dealer) => {
    const latestJob = latestJobByDealer.get(dealer.id);
    let deliveryHealth: "green" | "amber" | "red" = "green";
    let deliveryHealthTitle = "ok";

    if (blockedDealerIds.has(dealer.id)) {
      deliveryHealth = "red";
      deliveryHealthTitle = latestJob?.lastErrorCode ?? "blocked";
    } else if (dealer.metaDeliveryMethod === "csv" || latestJob?.lastRunStatus === "success") {
      deliveryHealth = "green";
      deliveryHealthTitle = latestJob?.lastRunStatus ?? "ok";
    } else if (latestJob?.status === "retry" || latestJob?.lastRunStatus === "error") {
      deliveryHealth = "amber";
      deliveryHealthTitle = latestJob?.lastErrorCode ?? latestJob?.lastRunStatus ?? "retry";
    }

    return {
      id: dealer.id,
      name: dealer.name,
      email: dealer.email,
      slug: dealer.slug,
      vertical: dealer.vertical,
      subscriptionStatus: dealer.subscriptionStatus,
      totalVehicles: dealer._count.vehicles,
      completeCount: completeMap.get(dealer.id) ?? 0,
      listingCount: listingMap.get(dealer.id) ?? 0,
      metaDeliveryMethod: dealer.metaDeliveryMethod,
      deliveryHealth,
      deliveryHealthTitle,
      joinedISO: dealer.createdAt.toISOString(),
      feedUrl: `${appUrl}/feeds/${dealer.slug}.csv`,
    };
  });

  return (
    <main className="max-w-6xl mx-auto px-6 py-8">
      {/* Quick links */}
      <div className="flex items-center gap-3 mb-6 text-sm">
        <Link
          href="/admin/coupons"
          className="text-indigo-600 hover:text-indigo-700 font-medium"
        >
          Beta Coupons →
        </Link>
        <span className="text-gray-300">·</span>
        <Link
          href="/admin/newsletter"
          className="text-indigo-600 hover:text-indigo-700 font-medium"
        >
          Newsletter →
        </Link>
        <span className="text-gray-300">·</span>
        <Link
          href="/admin/audit"
          className="text-indigo-600 hover:text-indigo-700 font-medium"
        >
          Audit Log →
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          {
            label: "Total Dealers",
            value: totalDealers,
            sub: "all time",
          },
          {
            label: "Active Subscribers",
            value: activeCount,
            sub: "paying now",
          },
          {
            label: "Past Due / At Risk",
            value: pastDueCount,
            sub: "needs attention",
          },
          {
            label: "No Subscription",
            value: noSubCount,
            sub: "never subscribed",
          },
        ].map((card) => (
          <div
            key={card.label}
            className="bg-white border border-gray-200 rounded-lg px-5 py-4"
          >
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
              {card.label}
            </p>
            <p className="text-3xl font-bold text-gray-900">{card.value}</p>
            <p className="text-xs text-gray-400 mt-1">{card.sub}</p>
          </div>
        ))}
      </div>

      <DealerSearch rows={rows} />
    </main>
  );
}
