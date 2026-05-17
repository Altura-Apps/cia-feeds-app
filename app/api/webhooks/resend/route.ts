// Resend webhook receiver.
//
// Resend ships delivery events through Svix-format webhooks. We care about
// three of them for newsletter hygiene:
//
//   - email.bounced     -> hard bounce. Suppress the address (set
//                          unsubscribedAt) so we never email it again.
//   - email.complained  -> recipient hit "this is spam". Suppress.
//   - email.failed      -> general failure. Suppress only when reason
//                          indicates a permanent issue.
//
// Everything else (sent / delivered / opened / clicked / delayed) is logged
// for observability but doesn't change subscriber state.
//
// Signature verification:
//   Svix signs payloads with HMAC-SHA256. Headers:
//     svix-id         <unique message id>
//     svix-timestamp  <unix seconds>
//     svix-signature  v1,<base64(sig)>[ v1,<base64(sig2)>...]
//   Signed-content = `${svix_id}.${svix_timestamp}.${raw_body}`
//   The signing secret comes from Resend's webhook config (starts with
//   "whsec_") and is base64 of the actual HMAC key after the prefix.
//
// We implement verification ourselves (no svix dep) since the protocol is
// small and the existing app avoids adding packages where a few lines do.

import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Hard-suppress: any of these event types unsubscribes the matching row.
const SUPPRESS_EVENTS = new Set([
  "email.bounced",
  "email.complained",
]);

// Failure reasons we treat as permanent enough to suppress (not bounce-soft).
const PERMANENT_FAILURE_REASONS = new Set([
  "invalid_recipient",
  "recipient_blocked",
  "spam_filter",
]);

interface ResendWebhookEvent {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    subject?: string;
    bounce?: { type?: string; subType?: string; message?: string };
    failed?: { reason?: string };
  };
}

function emailHash(email: string): string {
  return crypto
    .createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex");
}

/**
 * Verify a Svix-format webhook signature against the raw request body.
 *
 * The signing secret in Resend's UI is shown as `whsec_<base64>`. The actual
 * HMAC key is the base64-decoded portion AFTER the `whsec_` prefix.
 */
function verifySignature(
  rawBody: string,
  svixId: string | null,
  svixTimestamp: string | null,
  svixSignature: string | null,
  secret: string
): boolean {
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Reject events more than 5 minutes old to avoid replays.
  const tsSec = parseInt(svixTimestamp, 10);
  if (!Number.isFinite(tsSec)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsSec) > 5 * 60) return false;

  const keyB64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  let keyBytes: Buffer;
  try {
    keyBytes = Buffer.from(keyB64, "base64");
  } catch {
    return false;
  }

  const signedPayload = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", keyBytes)
    .update(signedPayload)
    .digest("base64");

  // svix-signature is space-separated list of versioned signatures.
  // Format: "v1,<sig> v1,<sig2>". We accept any v1 match.
  const candidates = svixSignature
    .split(" ")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("v1,"))
    .map((entry) => entry.slice("v1,".length));

  for (const candidate of candidates) {
    if (candidate.length !== expected.length) continue;
    try {
      if (
        crypto.timingSafeEqual(
          Buffer.from(candidate, "utf8"),
          Buffer.from(expected, "utf8")
        )
      ) {
        return true;
      }
    } catch {
      // Length mismatch; keep trying.
    }
  }
  return false;
}

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    // If the secret isn't set yet (initial deploy before you finish setting
    // up the webhook in Resend), accept the request but log loudly. Once
    // you add the env var we'll enforce signature verification.
    console.warn({
      event: "resend_webhook_unverified",
      reason: "no_secret_configured",
    });
  }

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");

  // Read raw body BEFORE JSON parse (signature is over the byte-exact body).
  const rawBody = await request.text();

  if (secret) {
    const ok = verifySignature(
      rawBody,
      svixId,
      svixTimestamp,
      svixSignature,
      secret
    );
    if (!ok) {
      console.warn({
        event: "resend_webhook_signature_invalid",
        svixId,
      });
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }
  }

  let payload: ResendWebhookEvent;
  try {
    payload = JSON.parse(rawBody) as ResendWebhookEvent;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const type = typeof payload.type === "string" ? payload.type : "";
  const data = payload.data ?? {};

  // Best-effort observability log for every event type so you can debug
  // deliverability in Vercel logs without going to Resend UI.
  console.log({
    event: "resend_webhook",
    type,
    emailId: data.email_id,
    to: data.to,
    bounceType: data.bounce?.type,
    failedReason: data.failed?.reason,
  });

  // Decide whether to suppress.
  let shouldSuppress = false;
  if (SUPPRESS_EVENTS.has(type)) shouldSuppress = true;
  if (
    type === "email.failed" &&
    data.failed?.reason &&
    PERMANENT_FAILURE_REASONS.has(data.failed.reason)
  ) {
    shouldSuppress = true;
  }
  if (
    type === "email.bounced" &&
    data.bounce?.type &&
    data.bounce.type.toLowerCase() === "permanent"
  ) {
    shouldSuppress = true;
  }

  if (shouldSuppress && Array.isArray(data.to)) {
    for (const addr of data.to) {
      if (typeof addr !== "string" || !addr.includes("@")) continue;
      const hash = emailHash(addr);
      try {
        const result = await prisma.newsletterSubscriber.updateMany({
          where: { emailHash: hash, unsubscribedAt: null },
          data: { unsubscribedAt: new Date() },
        });
        if (result.count > 0) {
          console.log({
            event: "resend_webhook_suppressed",
            type,
            hashedAddress: hash.slice(0, 12),
            rowsAffected: result.count,
          });
        }
      } catch (err) {
        console.warn({
          event: "resend_webhook_suppress_failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
