/**
 * Knowledge Base editor.
 *
 * Lets dealers add/edit/disable Q&A entries the AI agent uses to answer
 * customer questions. Supports bulk auto-scan of their website + per-entry
 * auto-translation EN <-> ES.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getEffectiveDealerContext } from "@/lib/impersonation";
import KbEditorClient from "./KbEditorClient";

export const dynamic = "force-dynamic";

export default async function KbPage() {
  const { effectiveDealerId } = await getEffectiveDealerContext();
  if (!effectiveDealerId) redirect("/login");

  const dealer = await prisma.dealer.findUnique({
    where: { id: effectiveDealerId },
    select: { name: true, websiteUrl: true, aiChatEnabled: true, ctaPreference: true },
  });
  const entries = await prisma.kbEntry.findMany({
    where: { dealerId: effectiveDealerId },
    orderBy: [{ category: "asc" }, { createdAt: "asc" }],
  });

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-indigo-600 hover:text-indigo-700">
            ← Dashboard
          </Link>
          <h1 className="text-lg font-bold text-gray-900">Knowledge Base</h1>
        </div>
        <div className="text-xs text-gray-500">
          {entries.length} entries
        </div>
      </div>

      <KbEditorClient
        initialEntries={entries.map((e) => ({
          id: e.id,
          locale: e.locale,
          question: e.question,
          answer: e.answer,
          category: e.category,
          active: e.active,
          sourceEntryId: e.sourceEntryId,
        }))}
        hasWebsite={!!dealer?.websiteUrl}
        aiChatEnabled={
          (dealer?.aiChatEnabled ?? false) ||
          dealer?.ctaPreference === "ai_chat"
        }
      />
    </div>
  );
}
