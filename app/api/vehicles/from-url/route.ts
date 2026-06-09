import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkSubscription } from "@/lib/checkSubscription";
import { criticalDurableRateLimit } from "@/lib/rateLimit";
import { getEffectiveDealerId } from "@/lib/impersonation";
import { scrapeVehicleUrl } from "@/lib/scrape";
import { dispatchFeedDeliveryInBackground } from "@/lib/metaDelivery";
import { consumeTrialUrlAdd } from "@/lib/trialQuota";

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const dealerId = await getEffectiveDealerId();
  if (!dealerId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const isSubscribed = await checkSubscription(dealerId);
  if (!isSubscribed) {
    return NextResponse.json({ error: "subscription_required" }, { status: 403 });
  }

  const rl = await criticalDurableRateLimit(`scrape:${dealerId}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate_limited", retryAfterMs: rl.retryAfterMs }, { status: 429 });
  }

  // Trial-period URL-add cap (no-op on paid tiers). Decremented atomically.
  const trialCheck = await consumeTrialUrlAdd(dealerId);
  if (!trialCheck.allowed) {
    return NextResponse.json(
      {
        error: "trial_url_limit_reached",
        used: trialCheck.used,
        limit: trialCheck.limit,
        message:
          "You've used all of your trial URL-by-URL adds. Upgrade to a paid plan to keep adding inventory.",
      },
      { status: 402 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { url } = body as Record<string, unknown>;

  if (!url || typeof url !== "string" || !isValidUrl(url)) {
    return NextResponse.json({ error: "invalid_url" }, { status: 400 });
  }

  // Phase 1: write a stub row immediately and respond 202
  const vehicle = await prisma.vehicle.upsert({
    where: { dealerId_url: { dealerId, url } },
    create: { url, dealerId, scrapeStatus: "pending", missingFields: [], isComplete: false },
    update: { scrapeStatus: "pending", missingFields: [], isComplete: false },
    select: { id: true },
  });

  const vehicleId = vehicle.id;

  // Dispatch scraping: use fire-and-forget if SYNC_SECRET is set, otherwise inline fallback
  if (process.env.SYNC_SECRET) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    if (!process.env.NEXT_PUBLIC_APP_URL) {
      console.warn({ event: "scrape_dispatch_url_fallback", resolvedOrigin: appUrl, hint: "NEXT_PUBLIC_APP_URL is not set; falling back to request origin" });
    }
    fetch(`${appUrl}/api/vehicles/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sync-secret": process.env.SYNC_SECRET,
      },
      body: JSON.stringify({ vehicleId, url, dealerId }),
    }).catch((err) => {
      console.error({
        event: "scrape_dispatch_error",
        vehicleId,
        url,
        message: err instanceof Error ? err.message : String(err),
      });
    });
  } else {
    console.warn({ event: "sync_secret_missing", hint: "Falling back to inline scrape" });
    try {
      const result = await scrapeVehicleUrl(url, dealerId);
      const v = result.vehicle;

      // VIN dedup: remove duplicate vehicle for same dealer+VIN (matches /api/vehicles/scrape behaviour)
      if (v.vin) {
        const byVin = await prisma.vehicle.findFirst({
          where: { dealerId, vin: v.vin, NOT: { id: vehicleId } },
          select: { id: true },
        });
        if (byVin) {
          try {
            await prisma.vehicle.delete({ where: { id: byVin.id } });
          } catch (dedupErr) {
            console.error({ event: "vin_dedup_delete_error", byVinId: byVin.id, message: dedupErr instanceof Error ? dedupErr.message : String(dedupErr) });
          }
        }
      }

      await prisma.vehicle.update({
        where: { id: vehicleId },
        data: {
          vin: v.vin,
          make: v.make,
          model: v.model,
          year: v.year,
          bodyStyle: v.bodyStyle,
          price: v.price,
          mileageValue: v.mileageValue,
          stateOfVehicle: v.stateOfVehicle,
          exteriorColor: v.exteriorColor,
          imageUrl: v.imageUrl,
          ...(v.imageUrl ? { images: [v.imageUrl] } : {}),
          description: v.description,
          address: v.address,
          latitude: v.latitude,
          longitude: v.longitude,
          isComplete: v.isComplete,
          missingFields: v.missingFields,
          scrapeStatus: "complete",
        },
      });

      // Inline fallback branch: dispatch Meta delivery after successful scrape
      dispatchFeedDeliveryInBackground(dealerId, "vehicles/from-url/inline", after);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error({ event: "inline_scrape_error", vehicleId, url, message });
      await prisma.vehicle.update({
        where: { id: vehicleId },
        data: { scrapeStatus: "failed" },
      });
    }
  }

  // Mark CrawlSnapshot as added to feed (if it exists) — best-effort but awaited
  try {
    await prisma.crawlSnapshot.updateMany({
      where: { dealerId, url },
      data: { addedToFeed: true },
    });
  } catch (err: unknown) {
    console.error({
      event: "snapshot_mark_feed_error",
      dealerId,
      url,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({ vehicle: { id: vehicleId, scrapeStatus: "pending", url } }, { status: 202 });
}
