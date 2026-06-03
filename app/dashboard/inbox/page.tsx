/**
 * Dashboard Inbox — all chat conversations for the dealer.
 *
 * Server-renders the list of conversations + the selected one's transcript.
 * Selected via ?conversation=<id> query param.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getEffectiveDealerContext } from "@/lib/impersonation";
import { decryptLeadFieldNullable, decryptLeadField } from "@/lib/leadCrypto";
import InboxClient from "./InboxClient";

export const dynamic = "force-dynamic";

interface RowSummary {
  id: string;
  status: string;
  locale: string;
  createdAt: string;
  updatedAt: string;
  dealerNotifiedAt: string | null;
  dealerReadAt: string | null;
  capturedName: string | null;
  capturedPhone: string | null;
  capturedEmail: string | null;
  capturedIntent: string | null;
  vehicleLabel: string | null;
  listingLabel: string | null;
  lastVisitorPreview: string | null;
}

interface DetailMessage {
  id: string;
  role: string;
  body: string;
  createdAt: string;
  dealerRepName: string | null;
}

interface DetailPayload {
  id: string;
  status: string;
  locale: string;
  capturedName: string | null;
  capturedPhone: string | null;
  capturedEmail: string | null;
  capturedIntent: string | null;
  vehicleLabel: string | null;
  listingLabel: string | null;
  createdAt: string;
  messages: DetailMessage[];
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string }>;
}) {
  const { effectiveDealerId } = await getEffectiveDealerContext();
  if (!effectiveDealerId) redirect("/login");

  const conversations = await prisma.chatConversation.findMany({
    where: { dealerId: effectiveDealerId },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      vehicle: { select: { year: true, make: true, model: true } },
      listing: { select: { title: true } },
      messages: {
        where: { role: "visitor" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true },
      },
    },
  });

  const rows: RowSummary[] = conversations.map((c) => {
    const vehicleLabel = c.vehicle
      ? [c.vehicle.year, c.vehicle.make, c.vehicle.model]
          .filter(Boolean)
          .join(" ") || null
      : null;
    const lastPreviewRaw = c.messages[0]?.body ?? null;
    return {
      id: c.id,
      status: c.status,
      locale: c.locale,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      dealerNotifiedAt: c.dealerNotifiedAt?.toISOString() ?? null,
      dealerReadAt: c.dealerReadAt?.toISOString() ?? null,
      capturedName: decryptLeadFieldNullable(c.capturedName),
      capturedPhone: decryptLeadFieldNullable(c.capturedPhone),
      capturedEmail: decryptLeadFieldNullable(c.capturedEmail),
      capturedIntent: c.capturedIntent,
      vehicleLabel,
      listingLabel: c.listing?.title ?? null,
      lastVisitorPreview: lastPreviewRaw ? decryptLeadField(lastPreviewRaw).slice(0, 140) : null,
    };
  });

  const params = await searchParams;
  const selectedId = params.conversation ?? rows[0]?.id ?? null;

  let detail: DetailPayload | null = null;
  if (selectedId) {
    const conv = await prisma.chatConversation.findFirst({
      where: { id: selectedId, dealerId: effectiveDealerId },
      include: {
        vehicle: { select: { year: true, make: true, model: true } },
        listing: { select: { title: true } },
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
    if (conv) {
      // Mark read
      if (!conv.dealerReadAt) {
        await prisma.chatConversation.update({
          where: { id: conv.id },
          data: { dealerReadAt: new Date() },
        });
      }
      const vehicleLabel = conv.vehicle
        ? [conv.vehicle.year, conv.vehicle.make, conv.vehicle.model]
            .filter(Boolean)
            .join(" ") || null
        : null;
      detail = {
        id: conv.id,
        status: conv.status,
        locale: conv.locale,
        capturedName: decryptLeadFieldNullable(conv.capturedName),
        capturedPhone: decryptLeadFieldNullable(conv.capturedPhone),
        capturedEmail: decryptLeadFieldNullable(conv.capturedEmail),
        capturedIntent: conv.capturedIntent,
        vehicleLabel,
        listingLabel: conv.listing?.title ?? null,
        createdAt: conv.createdAt.toISOString(),
        messages: conv.messages.map((m) => ({
          id: m.id,
          role: m.role,
          body: decryptLeadField(m.body),
          createdAt: m.createdAt.toISOString(),
          dealerRepName: m.dealerRepName,
        })),
      };
    }
  }

  const unreadCount = rows.filter((r) => !r.dealerReadAt).length;
  const activeCount = rows.filter((r) => r.status === "active").length;
  const handoffCount = rows.filter((r) => r.status === "handoff_requested").length;

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-indigo-600 hover:text-indigo-700">
            ← Dashboard
          </Link>
          <h1 className="text-lg font-bold text-gray-900">Inbox</h1>
          {unreadCount > 0 && (
            <span className="bg-indigo-600 text-white text-xs font-semibold rounded-full px-2 py-0.5">
              {unreadCount} unread
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500">
          {rows.length} total · {activeCount} active · {handoffCount} needs attention
        </div>
      </div>

      <InboxClient rows={rows} selected={detail} />
    </div>
  );
}
