/**
 * POST /api/dealer/kb/scan
 *
 * Trigger the auto-extraction worker for the current dealer. Returns once
 * done (typically 10-25s). UI shows a spinner.
 */
import { NextResponse } from "next/server";
import { getEffectiveDealerContext } from "@/lib/impersonation";
import { autoExtractKnowledgeBase } from "@/lib/kbAutoExtract";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const { effectiveDealerId } = await getEffectiveDealerContext();
  if (!effectiveDealerId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await autoExtractKnowledgeBase({
    dealerId: effectiveDealerId,
    replaceExisting: true,
  });

  return NextResponse.json(result);
}
