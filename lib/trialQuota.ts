/**
 * Trial-quota helpers.
 *
 * The 10-day $1 paid trial gives users a taste of the product but blocks
 * the expensive bulk crawl. To prevent abuse, we also cap the cheaper
 * URL-by-URL add path at planLimits.trialUrlAddLimit (default 25 lifetime).
 *
 * Paid tiers are unlimited \u2014 the caller short-circuits.
 */
import { prisma } from "@/lib/prisma";
import { getPlanLimits, type Plan } from "@/lib/planLimits";

export interface TrialQuotaCheck {
  allowed: boolean;
  /** Only set when allowed=false. */
  reason?: "trial_url_limit_reached";
  /** Always set; the count used (post-increment if allowed). */
  used: number;
  /** Always set; the limit for this plan. */
  limit: number;
}

/**
 * Atomically check + increment the trial URL-add counter. Returns
 * `allowed=true` and the new count when within the limit, or
 * `allowed=false` when the limit is already met.
 *
 * Implemented as a single conditional UPDATE so concurrent requests can't
 * race past the limit.
 */
export async function consumeTrialUrlAdd(
  dealerId: string
): Promise<TrialQuotaCheck> {
  const dealer = await prisma.dealer.findUnique({
    where: { id: dealerId },
    select: { plan: true, trialUrlAddsUsed: true },
  });
  if (!dealer) {
    return { allowed: false, used: 0, limit: 0 };
  }

  const plan = dealer.plan as Plan;
  const limits = getPlanLimits(plan);

  // Paid plans are unlimited \u2014 nothing to consume.
  if (plan !== "trial") {
    return { allowed: true, used: 0, limit: Number.POSITIVE_INFINITY };
  }

  const limit = limits.trialUrlAddLimit;

  // Conditional update: only increment when currently below the limit.
  const result = await prisma.dealer.updateMany({
    where: {
      id: dealerId,
      trialUrlAddsUsed: { lt: limit },
    },
    data: {
      trialUrlAddsUsed: { increment: 1 },
    },
  });

  if (result.count === 0) {
    // Already at or above the limit
    return {
      allowed: false,
      reason: "trial_url_limit_reached",
      used: dealer.trialUrlAddsUsed,
      limit,
    };
  }

  return {
    allowed: true,
    used: dealer.trialUrlAddsUsed + 1,
    limit,
  };
}
