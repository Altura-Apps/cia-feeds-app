/**
 * POST /api/chat/message
 *
 * Send a visitor turn into a conversation, run the agent, return its reply.
 *
 * Body:
 *   {
 *     conversationToken: string;
 *     body: string;
 *     detectedLocale?: "en" | "es";  // browser locale of the message (for analytics only)
 *   }
 *
 * Response:
 *   {
 *     reply: string;
 *     captured: { name?: bool, email?: bool, phone?: bool, intent?: bool };
 *     handoffRequested: boolean;
 *     conversationStatus: "active" | "handoff_requested" | "completed";
 *   }
 *
 * Side effects (handled here, not by the agent):
 *   - If we just captured enough to make a Lead, promote + notify dealer
 *   - Update conversation.updatedAt so dashboard inbox sorts correctly
 *   - Rate-limit per conversation + per IP
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptLeadField } from "@/lib/leadCrypto";
import { durableRateLimit } from "@/lib/rateLimit";
import { loadChatContext, runChatAgentTurn } from "@/lib/chatAgent";
import {
  notifyDealerOfNewChatLead,
  promoteConversationToLead,
} from "@/lib/chatNotification";

export const dynamic = "force-dynamic";
// Allow up to 30s for the agent loop (Gemini + tool hops).
export const maxDuration = 30;

const MAX_MESSAGE_BODY_LEN = 2000;
const MAX_MESSAGES_PER_CONVERSATION = 100;

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  let body: {
    conversationToken?: unknown;
    body?: unknown;
    detectedLocale?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const token =
    typeof body.conversationToken === "string" ? body.conversationToken : "";
  const messageBody =
    typeof body.body === "string" ? body.body.trim() : "";
  const detectedLocale =
    body.detectedLocale === "es" || body.detectedLocale === "en"
      ? body.detectedLocale
      : null;

  if (!token) {
    return NextResponse.json(
      { error: "missing_conversation_token" },
      { status: 400 }
    );
  }
  if (!messageBody) {
    return NextResponse.json({ error: "empty_message" }, { status: 400 });
  }
  if (messageBody.length > MAX_MESSAGE_BODY_LEN) {
    return NextResponse.json(
      { error: "message_too_long" },
      { status: 400 }
    );
  }

  // Per-IP throttle (defends against bots).
  const ipRl = await durableRateLimit(`chat_msg_ip:${ip}`, 20, 60_000);
  if (!ipRl.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(ipRl.retryAfterMs / 1000)),
        },
      }
    );
  }
  // Per-conversation throttle (defends against a chatty single visitor).
  const convRl = await durableRateLimit(`chat_msg_conv:${token}`, 10, 60_000);
  if (!convRl.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(convRl.retryAfterMs / 1000)),
        },
      }
    );
  }

  const loaded = await loadChatContext(token);
  if (!loaded) {
    return NextResponse.json(
      { error: "conversation_not_found" },
      { status: 404 }
    );
  }

  // Hard cap so a runaway visitor (or bot) can't generate infinite turns.
  const msgCount = await prisma.chatMessage.count({
    where: { conversationId: loaded.ctx.conversationId },
  });
  if (msgCount >= MAX_MESSAGES_PER_CONVERSATION) {
    return NextResponse.json(
      {
        reply:
          loaded.ctx.locale === "es"
            ? "Hemos hablado bastante — déjame conectarte con un humano que pueda ayudarte mejor."
            : "We've been chatting a while — let me get a human to help you better.",
        captured: {},
        handoffRequested: true,
        conversationStatus: "handoff_requested",
      },
      { status: 200 }
    );
  }

  // Persist the visitor's turn FIRST so it's in the transcript even if the
  // agent call below fails.
  await prisma.chatMessage.create({
    data: {
      conversationId: loaded.ctx.conversationId,
      role: "visitor",
      body: encryptLeadField(messageBody),
      detectedLocale,
    },
  });

  // If a dealer rep has taken over (status='escalated'), we skip the agent
  // entirely. The visitor's message is persisted; the rep will see it on
  // their next poll and reply themselves.
  const convCheck = await prisma.chatConversation.findUnique({
    where: { id: loaded.ctx.conversationId },
    select: { status: true },
  });
  if (convCheck?.status === "escalated") {
    await prisma.chatConversation.update({
      where: { id: loaded.ctx.conversationId },
      data: { updatedAt: new Date() },
    });
    return NextResponse.json({
      reply: "",  // Empty reply tells the widget to just show "waiting for human reply..."
      captured: {},
      handoffRequested: false,
      conversationStatus: "escalated",
    });
  }

  // Run the agent.
  const result = await runChatAgentTurn(
    loaded.ctx,
    { body: messageBody, detectedLocale },
    loaded.history
  );

  // Persist the assistant's reply.
  await prisma.chatMessage.create({
    data: {
      conversationId: loaded.ctx.conversationId,
      role: "assistant",
      body: encryptLeadField(result.reply),
      toolCalls:
        result.toolCalls.length > 0
          ? (result.toolCalls as unknown as object)
          : undefined,
    },
  });

  // Promote → Lead and notify dealer IF we just got enough info.
  const becameEligibleNow =
    Object.keys(result.newlyCaptured).length > 0 ||
    result.handoffRequested;

  if (becameEligibleNow) {
    const leadId = await promoteConversationToLead(
      loaded.ctx.conversationId
    );
    if (leadId) {
      // Fire-and-forget: don't make the visitor wait on Resend/Twilio.
      void notifyDealerOfNewChatLead({
        conversationId: loaded.ctx.conversationId,
      });
    }
  }

  // Touch updatedAt so the dashboard inbox sorts correctly.
  await prisma.chatConversation.update({
    where: { id: loaded.ctx.conversationId },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json({
    reply: result.reply,
    captured: {
      name: !!result.newlyCaptured.name,
      email: !!result.newlyCaptured.email,
      phone: !!result.newlyCaptured.phone,
      intent: !!result.newlyCaptured.intent,
    },
    handoffRequested: result.handoffRequested,
    conversationStatus: result.handoffRequested
      ? "handoff_requested"
      : "active",
  });
}
