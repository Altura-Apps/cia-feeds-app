import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEffectiveDealerId } from "@/lib/impersonation";
import { normalizeUrl } from "../route";
import { getPlanLimits, type Plan } from "@/lib/planLimits";

/**
 * GET /api/crawl/snapshots — Returns all CrawlSnapshot records for the dealer
 * Ordered by firstSeenAt desc, includes weeksActive and addedToFeed rate
 */
export async function GET() {
  const dealerId = await getEffectiveDealerId();
  if (!dealerId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const dealer = await prisma.dealer.findUnique({
    where: { id: dealerId },
    select: { plan: true },
  });
  const plan = (dealer?.plan ?? "trial") as Plan;
  const planLimits = getPlanLimits(plan);

  const crawlsUsedThisMonth = await prisma.crawlJob.count({
    where: {
      dealerId,
      startedAt: { gte: monthStart },
      status: { not: "failed" },
    },
  });

  const snapshotsRaw = await prisma.crawlSnapshot.findMany({
    where: { dealerId },
    orderBy: { lastSeenAt: "desc" },
    select: {
      id: true,
      url: true,
      firstSeenAt: true,
      lastSeenAt: true,
      weeksActive: true,
      addedToFeed: true,
      make: true,
      model: true,
      year: true,
      price: true,
      title: true,
      thumbnailUrl: true,
    },
  });

  // Deduplicate by normalized URL, keeping the newest row (by lastSeenAt)
  const seenUrls = new Map<string, (typeof snapshotsRaw)[number]>();
  for (const snap of snapshotsRaw) {
    const key = normalizeUrl(snap.url);
    if (!seenUrls.has(key)) {
      seenUrls.set(key, snap);
    }
  }
  const snapshots = [...seenUrls.values()];

  const total = snapshots.length;
  const addedCount = snapshots.filter((s) => s.addedToFeed).length;
  const addedToFeedRate = total > 0 ? addedCount / total : 0;

  return NextResponse.json({
    snapshots,
    addedToFeedRate,
    quota: {
      used: crawlsUsedThisMonth,
      remaining: Math.max(0, planLimits.bulkCrawlsPerMonth - crawlsUsedThisMonth),
      limit: planLimits.bulkCrawlsPerMonth,
      plan,
      bulkCrawlEnabled: planLimits.bulkCrawlsPerMonth > 0,
      pagesPerCrawl: planLimits.maxPagesPerCrawl,
      resetsAt: resetsAt.toISOString(),
    },
  });
}

/**
 * PATCH /api/crawl/snapshots — Mark a snapshot as added to feed
 */
export async function PATCH(request: NextRequest) {
  const dealerId = await getEffectiveDealerId();
  if (!dealerId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { snapshotId } = body as Record<string, unknown>;
  if (!snapshotId || typeof snapshotId !== "string") {
    return NextResponse.json({ error: "snapshotId is required" }, { status: 400 });
  }

  // Verify snapshot belongs to this dealer
  const snapshot = await prisma.crawlSnapshot.findFirst({
    where: { id: snapshotId, dealerId },
  });

  if (!snapshot) {
    return NextResponse.json({ error: "snapshot_not_found" }, { status: 404 });
  }

  await prisma.crawlSnapshot.update({
    where: { id: snapshotId },
    data: { addedToFeed: true },
  });

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/crawl/snapshots — Remove all crawl snapshots for the dealer
 */
export async function DELETE() {
  const dealerId = await getEffectiveDealerId();
  if (!dealerId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await prisma.crawlSnapshot.deleteMany({
    where: { dealerId },
  });

  return NextResponse.json({ ok: true, deleted: result.count });
}
