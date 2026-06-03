/**
 * Dealer-side messaging on a chat conversation.
 *
 *   GET   /api/dealer/chat/[id]/messages?since=<iso>
 *     Poll for new messages since the given timestamp. Returns all messages
 *     with createdAt > since (or all if no since). Used by inbox client for
 *     live polling once the dealer has the conversation open.
 *
 *   POST  /api/dealer/chat/[id]/messages
 *     Body: { body: string }
 *     Dealer sends a message into the visitor's conversation. This flips the
 *     conversation status to "escalated" so the AI agent stops auto-replying.
 *     The visitor's widget will see this on its next poll.
 *
 * Auth: dealer-scoped via getEffectiveDealerContext.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEffectiveDealerContext } from "@/lib/impersonation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { encryptLeadField, decryptLeadField } from "@/lib/leadCrypto";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { effectiveDealerId } = await getEffectiveDealerContext();
  if (!effectiveDealerId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const since = request.nextUrl.searchParams.get("since");

  const conv = await prisma.chatConversation.findFirst({
    where: { id, dealerId: effectiveDealerId },
    select: { id: true, status: true },
  });
  if (!conv) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const messages = await prisma.chatMessage.findMany({
    where: {
      conversationId: conv.id,
      ...(since ? { createdAt: { gt: new Date(since) } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  return NextResponse.json({
    status: conv.status,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      body: decryptLeadField(m.body),
      createdAt: m.createdAt.toISOString(),
      dealerRepName: m.dealerRepName,
    })),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { effectiveDealerId } = await getEffectiveDealerContext();
  if (!effectiveDealerId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  let body: { body?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (text.length < 1 || text.length > 2000) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const conv = await prisma.chatConversation.findFirst({
    where: { id, dealerId: effectiveDealerId },
    select: { id: true, status: true },
  });
  if (!conv) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Use the rep's display name if available
  const session = await getServerSession(authOptions);
  const repName = session?.user?.email?.split("@")[0] ?? "Team";

  const msg = await prisma.chatMessage.create({
    data: {
      conversationId: conv.id,
      role: "dealer",
      body: encryptLeadField(text),
      dealerRepName: repName,
    },
  });

  // Flip conversation to escalated so the AI stops auto-replying.
  await prisma.chatConversation.update({
    where: { id: conv.id },
    data: {
      status: "escalated",
      updatedAt: new Date(),
    },
  });

  return NextResponse.json({
    id: msg.id,
    role: msg.role,
    body: text,
    createdAt: msg.createdAt.toISOString(),
    dealerRepName: msg.dealerRepName,
  });
}
