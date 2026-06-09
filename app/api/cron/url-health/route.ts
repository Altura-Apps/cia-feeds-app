export const maxDuration = 300;
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { dispatchFeedDeliveryInBackground } from "@/lib/metaDelivery";
import { isSafeUrl } from "@/lib/safeUrl";
import { isListingUrl, type Vertical } from "@/lib/crawlFilters";

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns true if `url` looks like a listing detail page for the given
 * vertical. Used here only to sanity-check redirect targets — if a VDP
 * redirects to another VDP we treat the vehicle as "active" rather than
 * "redirect". Sourced from lib/crawlFilters so the rules stay in lockstep
 * with the bulk crawl + on-demand crawl routes.
 */
function isVdpUrl(url: string, vertical: Vertical): boolean {
  return isListingUrl(url, vertical);
}

type CheckResult = {
  status: "active" | "sold_or_removed" | "redirect" | "error";
};

async function checkUrl(url: string, vertical: Vertical): Promise<CheckResult> {
  // SSRF defense: reject URLs that resolve to internal services, cloud
  // metadata endpoints, or private IP space before issuing the fetch
  // (SECURITY_AUDIT.md F-5.5). Dealer websiteUrl is user-controlled.
  const safe = await isSafeUrl(url);
  if (!safe.ok) {
    return { status: "error" };
  }

  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });

    const statusCode = response.status;

    if (statusCode >= 200 && statusCode < 300) {
      return { status: "active" };
    }

    if (statusCode === 404 || statusCode === 410) {
      return { status: "sold_or_removed" };
    }

    if (statusCode >= 300 && statusCode < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return { status: "redirect" };
      }

      // Resolve relative redirects
      const resolvedUrl = new URL(location, url).href;

      if (!isVdpUrl(resolvedUrl, vertical)) {
        return { status: "redirect" };
      }

      // Re-validate redirect target against SSRF rules (F-5.5).
      const redirectSafe = await isSafeUrl(resolvedUrl);
      if (!redirectSafe.ok) {
        return { status: "error" };
      }

      // Follow the redirect to check the final destination
      try {
        const followUp = await fetch(resolvedUrl, {
          method: "HEAD",
          redirect: "manual",
          signal: AbortSignal.timeout(8000),
        });
        if (followUp.status >= 200 && followUp.status < 300) {
          return { status: "active" };
        }
        if (followUp.status === 404 || followUp.status === 410) {
          return { status: "sold_or_removed" };
        }
        return { status: "redirect" };
      } catch {
        return { status: "error" };
      }
    }

    // GET fallback for 403, 405, and other unexpected status codes
    try {
      const getResponse = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
      });

      if (getResponse.status >= 200 && getResponse.status < 300) {
        if (isVdpUrl(getResponse.url, vertical)) {
          return { status: "active" };
        }
        return { status: "redirect" };
      }

      if (getResponse.status === 404 || getResponse.status === 410) {
        return { status: "sold_or_removed" };
      }

      return { status: "error" };
    } catch {
      return { status: "error" };
    }
  } catch {
    return { status: "error" };
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const vehicles = await prisma.vehicle.findMany({
    where: {
      archivedAt: null,
      dealer: { urlHealthCheckEnabled: true },
    },
    select: {
      id: true,
      url: true,
      dealerId: true,
      dealer: { select: { vertical: true } },
    },
  });

  let checked = 0;
  let archived = 0;
  let errors = 0;
  const changedDealerIds = new Set<string>();

  for (let i = 0; i < vehicles.length; i += BATCH_SIZE) {
    const batch = vehicles.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (vehicle) => {
        const vertical = (vehicle.dealer?.vertical ?? "automotive") as Vertical;
        const result = await checkUrl(vehicle.url, vertical);
        checked++;

        try {
          if (result.status === "active") {
            await prisma.vehicle.update({
              where: { id: vehicle.id },
              data: {
                urlStatus: "active",
                urlLastCheckedAt: new Date(),
                urlCheckFailed: false,
              },
            });
          } else if (result.status === "sold_or_removed" || result.status === "redirect") {
            await prisma.vehicle.update({
              where: { id: vehicle.id },
              data: {
                urlStatus: result.status,
                urlLastCheckedAt: new Date(),
                urlCheckFailed: true,
                archivedAt: new Date(),
              },
            });
            changedDealerIds.add(vehicle.dealerId);
            archived++;
          } else {
            await prisma.vehicle.update({
              where: { id: vehicle.id },
              data: {
                urlStatus: "error",
                urlLastCheckedAt: new Date(),
                urlCheckFailed: false,
              },
            });
            errors++;
          }
        } catch (err) {
          console.error({
            event: "url_health_check_error",
            vehicleId: vehicle.id,
            url: vehicle.url,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      })
    );

    if (i + BATCH_SIZE < vehicles.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  for (const dId of changedDealerIds) {
    dispatchFeedDeliveryInBackground(dId, "cron/url-health/GET", after);
  }

  return NextResponse.json({ checked, archived, errors });
}
