/**
 * GET /api/chat/poll?token=<conversationToken>&since=<iso>
 *
 * Visitor-side polling. The widget calls this every few seconds when the
 * conversation has been escalated to a dealer rep so it can render the
 * rep's replies as they arrive.
 *
 * Public endpoint (token is the auth credential).
 *
 * Response:
 *   {
 *     status: "active" | "handoff_requested" | "escalated" | "completed",
 *     messages: [{ id, role, body, createdAt, dealerRepName }]
 *   }
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptLeadField } from "@/lib/leadCrypto";
import { durableRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const since = url.searchParams.get("since");

  if (!token) {
    return NextResponse.json({ error: "missing_token" }, { status: 400 });
  }

  // Light per-IP throttle — visitors can poll often but not absurdly.
  const ip = getClientIp(request);
  const rl = await durableRateLimit(`chat_poll:${ip}`, 90, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const conv = await prisma.chatConversation.findUnique({
    where: { conversationToken: token },
    select: { id: true, status: true },
  });
  if (!conv) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Only return messages the visitor should see: assistant + dealer + system.
  // (Their own visitor messages are echoed back from the message endpoint already.)
  const messages = await prisma.chatMessage.findMany({
    where: {
      conversationId: conv.id,
      role: { in: ["assistant", "dealer", "system"] },
      ...(since ? { createdAt: { gt: new Date(since) } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 25,
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
