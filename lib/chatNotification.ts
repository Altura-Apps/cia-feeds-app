/**
 * Notify the dealer when the AI chat agent captures a real lead.
 *
 * Sent the moment we have at least name + (phone OR email).
 * Deduped via ChatConversation.dealerNotifiedAt so we don't spam on every
 * follow-up message after capture.
 */

import { prisma } from "@/lib/prisma";
import { Resend } from "resend";
import { sendSms, normalizePhoneE164 } from "@/lib/twilio";

interface NotifyArgs {
  conversationId: string;
}

const RESEND_FROM = "CIA Feeds <hello@ciafeed.com>";

function chooseDealerContacts(dealer: {
  email: string;
  phone: string | null;
  bdcEmail: string | null;
  bdcPhone: string | null;
}): { emailTo: string; smsTo: string | null } {
  return {
    emailTo: dealer.bdcEmail || dealer.email,
    smsTo: dealer.bdcPhone || dealer.phone,
  };
}

export async function notifyDealerOfNewChatLead(
  args: NotifyArgs
): Promise<{ notified: boolean; reason?: string }> {
  const conv = await prisma.chatConversation.findUnique({
    where: { id: args.conversationId },
    include: {
      dealer: {
        select: {
          name: true,
          email: true,
          phone: true,
          bdcEmail: true,
          bdcPhone: true,
          slug: true,
        },
      },
      vehicle: { select: { id: true, year: true, make: true, model: true } },
      listing: { select: { id: true, title: true } },
    },
  });
  if (!conv) return { notified: false, reason: "conversation_not_found" };
  if (conv.dealerNotifiedAt) {
    return { notified: false, reason: "already_notified" };
  }

  // Decrypt captured fields (the body of the alert references them).
  const { decryptLeadFieldNullable } = await import("@/lib/leadCrypto");
  const name = decryptLeadFieldNullable(conv.capturedName);
  const email = decryptLeadFieldNullable(conv.capturedEmail);
  const phone = decryptLeadFieldNullable(conv.capturedPhone);

  // Need at least name + (phone or email) before alerting.
  if (!name || (!phone && !email)) {
    return { notified: false, reason: "insufficient_data" };
  }

  const { emailTo, smsTo } = chooseDealerContacts(conv.dealer);

  // What was the visitor looking at?
  let viewing = "";
  if (conv.vehicle) {
    const v = conv.vehicle;
    viewing = [v.year, v.make, v.model].filter(Boolean).join(" ") || "a vehicle";
  } else if (conv.listing) {
    viewing = conv.listing.title;
  }
  const localeBadge = conv.locale === "es" ? " 🇪🇸 (Spanish)" : "";
  const intentStr = conv.capturedIntent ? ` · ${conv.capturedIntent}` : "";

  const subject = `New AI Chat lead${localeBadge}: ${name}${
    viewing ? ` — ${viewing}` : ""
  }`;
  const inboxUrl = `https://www.ciafeed.com/dashboard/inbox?conversation=${conv.id}`;

  // === Resend email ===
  let emailOk = false;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const text =
      `${name} just chatted with your AI assistant.\n\n` +
      `Contact:\n` +
      (phone ? `  Phone: ${phone}\n` : "") +
      (email ? `  Email: ${email}\n` : "") +
      (conv.capturedIntent
        ? `  Intent: ${conv.capturedIntent}\n`
        : "") +
      `  Language: ${conv.locale}\n` +
      (viewing ? `  Viewing: ${viewing}\n` : "") +
      `\nOpen the conversation: ${inboxUrl}\n`;

    const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.5;color:#111;">
<h2 style="margin:0 0 8px 0;">New AI Chat lead${localeBadge}</h2>
<p style="margin:0 0 16px 0;color:#555;">${name} just chatted with your AI assistant.</p>
<table cellpadding="6" style="border-collapse:collapse;font-size:14px;">
  ${phone ? `<tr><td style="color:#777;">Phone</td><td><a href="tel:${phone}">${phone}</a></td></tr>` : ""}
  ${email ? `<tr><td style="color:#777;">Email</td><td><a href="mailto:${email}">${email}</a></td></tr>` : ""}
  ${conv.capturedIntent ? `<tr><td style="color:#777;">Intent</td><td>${conv.capturedIntent}</td></tr>` : ""}
  <tr><td style="color:#777;">Language</td><td>${conv.locale === "es" ? "Spanish" : "English"}</td></tr>
  ${viewing ? `<tr><td style="color:#777;">Viewing</td><td>${viewing}</td></tr>` : ""}
</table>
<p style="margin-top:24px;">
  <a href="${inboxUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">
    Open conversation →
  </a>
</p>
<p style="color:#999;font-size:12px;margin-top:24px;">
  Reply or take over the chat from your CIA Feeds inbox.
</p>
</body></html>`;

    const res = await resend.emails.send({
      from: RESEND_FROM,
      to: emailTo,
      subject,
      text,
      html,
    });
    emailOk = !!res.data?.id;
  } catch (err) {
    console.error({
      event: "chat_lead_email_failed",
      conversationId: conv.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // === Twilio SMS via shared helper (circuit-breaker wrapped) ===
  let smsOk = false;
  const smsToE164 = normalizePhoneE164(smsTo);
  if (smsToE164) {
    const smsBody =
      `New AI Chat lead${localeBadge}\n` +
      `${name}${intentStr}\n` +
      (phone ? `${phone}\n` : "") +
      (email ? `${email}\n` : "") +
      (viewing ? `Viewing: ${viewing}\n` : "") +
      inboxUrl;
    const result = await sendSms({
      to: smsToE164,
      body: smsBody.slice(0, 1500),
    });
    if (result.ok) {
      smsOk = true;
    } else {
      console.error({
        event: "chat_lead_sms_failed",
        conversationId: conv.id,
        to: smsToE164,
        error: result.error,
      });
    }
  }

  // Mark notified even if both channels failed — better to under-notify than
  // spam on every subsequent message. Operators can debug via logs.
  await prisma.chatConversation.update({
    where: { id: conv.id },
    data: { dealerNotifiedAt: new Date() },
  });

  return { notified: emailOk || smsOk };
}

/**
 * Promote the conversation's captured fields to a Lead row (idempotent).
 * Called the moment we have name + (phone OR email) for the first time.
 */
export async function promoteConversationToLead(
  conversationId: string
): Promise<string | null> {
  const conv = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      dealerId: true,
      vehicleId: true,
      listingId: true,
      leadId: true,
      locale: true,
      capturedName: true,
      capturedEmail: true,
      capturedPhone: true,
    },
  });
  if (!conv) return null;
  if (conv.leadId) return conv.leadId;

  const { decryptLeadFieldNullable } = await import("@/lib/leadCrypto");
  const name = decryptLeadFieldNullable(conv.capturedName);
  const phone = decryptLeadFieldNullable(conv.capturedPhone);
  const email = decryptLeadFieldNullable(conv.capturedEmail);

  if (!name || (!phone && !email)) return null;

  // The Lead model expects PII fields already encrypted (we re-encrypt to
  // match the at-rest format).
  const { encryptLeadField, encryptLeadFieldNullable } = await import(
    "@/lib/leadCrypto"
  );

  const lead = await prisma.lead.create({
    data: {
      dealerId: conv.dealerId,
      vehicleId: conv.vehicleId,
      listingId: conv.listingId,
      name: encryptLeadField(name),
      email: encryptLeadFieldNullable(email),
      phone: encryptLeadFieldNullable(phone),
      locale: conv.locale,
      source: "ai_chat",
    },
  });

  await prisma.chatConversation.update({
    where: { id: conv.id },
    data: { leadId: lead.id },
  });

  return lead.id;
}
