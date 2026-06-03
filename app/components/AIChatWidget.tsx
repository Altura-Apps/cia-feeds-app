"use client";

/**
 * AIChatWidget
 *
 * Floating chat bubble + slide-up panel for storefront pages. Talks to
 * /api/chat/start (on first open) and /api/chat/message (on each turn).
 *
 * Props:
 *   - dealerSlug: required for /api/chat/start to find the dealer
 *   - vehicleId / listingId: optional context the agent uses for greeting
 *   - initialLocale: "en" | "es" — initial language, visitor can toggle
 *   - accentColor: optional CSS color string for the bubble + send button
 *
 * No external dependencies. Pure React + minimal CSS-in-JS.
 */

import { useEffect, useRef, useState } from "react";

const STORAGE_ANON_ID = "cia_chat_anon_id";

interface Props {
  dealerSlug: string;
  vehicleId?: string;
  listingId?: string;
  initialLocale?: "en" | "es";
  accentColor?: string;
  /** Internal: lets a wrapper component (StorefrontChatMount) grab a
   *  reference to the open() function so other elements on the page can
   *  programmatically expand the widget. Don't pass directly. */
  __registerOpener?: (openFn: () => void) => void;
}

interface UIMessage {
  role: "visitor" | "assistant" | "system";
  body: string;
  ts: number;
}

const STRINGS: Record<"en" | "es", Record<string, string>> = {
  en: {
    bubble: "Chat with us",
    title: "Chat",
    poweredBy: "AI assistant",
    placeholder: "Type a message…",
    send: "Send",
    closing: "Close",
    handoff: "A real person will reach out shortly.",
    error: "Couldn't send. Try again.",
    typing: "Thinking…",
  },
  es: {
    bubble: "Chatea con nosotros",
    title: "Chat",
    poweredBy: "Asistente con IA",
    placeholder: "Escribe un mensaje…",
    send: "Enviar",
    closing: "Cerrar",
    handoff: "Una persona real te contactará pronto.",
    error: "No se pudo enviar. Intenta de nuevo.",
    typing: "Pensando…",
  },
};

function getOrCreateAnonId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem(STORAGE_ANON_ID);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(STORAGE_ANON_ID, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export default function AIChatWidget({
  dealerSlug,
  vehicleId,
  listingId,
  initialLocale,
  accentColor = "#4f46e5",
  __registerOpener,
}: Props) {
  const [open, setOpen] = useState(false);

  // Register an opener function so external page elements can pop the
  // widget without prop-drilling.
  useEffect(() => {
    __registerOpener?.(() => setOpen(true));
  }, [__registerOpener]);
  const [locale, setLocale] = useState<"en" | "es">(initialLocale ?? "en");
  const [token, setToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoffShown, setHandoffShown] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const t = STRINGS[locale];

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  // Open: start the conversation if we haven't yet.
  useEffect(() => {
    if (!open || token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/chat/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dealerSlug,
            anonymousId: getOrCreateAnonId(),
            locale,
            vehicleId,
            listingId,
            referer:
              typeof window !== "undefined" ? window.location.href : null,
          }),
        });
        if (!res.ok) {
          if (!cancelled) {
            setError(t.error);
          }
          return;
        }
        const data = (await res.json()) as {
          conversationToken: string;
          greeting: string;
          locale: "en" | "es";
        };
        if (cancelled) return;
        setToken(data.conversationToken);
        setLocale(data.locale);
        setMessages([
          { role: "assistant", body: data.greeting, ts: Date.now() },
        ]);
        setTimeout(() => inputRef.current?.focus(), 50);
      } catch {
        if (!cancelled) setError(t.error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, token, dealerSlug, locale, vehicleId, listingId, t.error]);

  async function send() {
    const body = draft.trim();
    if (!body || !token || sending) return;
    setDraft("");
    setError(null);
    setMessages((prev) => [
      ...prev,
      { role: "visitor", body, ts: Date.now() },
    ]);
    setSending(true);
    try {
      const res = await fetch("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationToken: token,
          body,
          detectedLocale: locale,
        }),
      });
      if (!res.ok) {
        setError(t.error);
        setSending(false);
        return;
      }
      const data = (await res.json()) as {
        reply: string;
        handoffRequested: boolean;
        conversationStatus: string;
      };
      setMessages((prev) => [
        ...prev,
        { role: "assistant", body: data.reply, ts: Date.now() },
      ]);
      if (data.handoffRequested && !handoffShown) {
        setHandoffShown(true);
        setMessages((prev) => [
          ...prev,
          { role: "system", body: t.handoff, ts: Date.now() },
        ]);
      }
    } catch {
      setError(t.error);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      {/* Bubble */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t.bubble}
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            zIndex: 999999,
            background: accentColor,
            color: "white",
            border: "none",
            borderRadius: 999,
            padding: "14px 22px",
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          }}
        >
          <span aria-hidden style={{ fontSize: 18 }}>💬</span>
          {t.bubble}
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          role="dialog"
          aria-label={t.title}
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            width: "min(380px, calc(100vw - 24px))",
            height: "min(560px, calc(100vh - 40px))",
            background: "white",
            borderRadius: 16,
            boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
            zIndex: 999999,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          }}
        >
          {/* Header */}
          <div
            style={{
              background: accentColor,
              color: "white",
              padding: "12px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{t.title}</span>
              <span
                style={{
                  fontSize: 11,
                  opacity: 0.85,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: "#10b981",
                    display: "inline-block",
                  }}
                  aria-hidden
                />
                {t.poweredBy}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {/* Locale toggle */}
              <button
                type="button"
                onClick={() => {
                  const next = locale === "en" ? "es" : "en";
                  setLocale(next);
                  // Don't re-start the conversation mid-flight; the agent
                  // honors the new locale on the next message via the
                  // detectedLocale field. (We could push a system message
                  // here but it's noisy; the next reply will be in the new
                  // language automatically because we send detectedLocale.)
                }}
                aria-label="Toggle language"
                style={{
                  background: "rgba(255,255,255,0.18)",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  letterSpacing: 0.4,
                }}
              >
                {locale === "en" ? "EN · ES" : "ES · EN"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t.closing}
                style={{
                  background: "transparent",
                  color: "white",
                  border: "none",
                  fontSize: 22,
                  lineHeight: 1,
                  cursor: "pointer",
                  padding: "0 4px",
                }}
              >
                ×
              </button>
            </div>
          </div>

          {/* Transcript */}
          <div
            ref={scrollRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: 12,
              background: "#fafafa",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {messages.map((m, i) => {
              if (m.role === "system") {
                return (
                  <div
                    key={i}
                    style={{
                      alignSelf: "center",
                      background: "#fef3c7",
                      color: "#92400e",
                      padding: "6px 10px",
                      borderRadius: 8,
                      fontSize: 12,
                      maxWidth: "85%",
                      textAlign: "center",
                    }}
                  >
                    {m.body}
                  </div>
                );
              }
              const visitor = m.role === "visitor";
              return (
                <div
                  key={i}
                  style={{
                    alignSelf: visitor ? "flex-end" : "flex-start",
                    background: visitor ? accentColor : "white",
                    color: visitor ? "white" : "#111",
                    padding: "8px 12px",
                    borderRadius: 14,
                    borderBottomRightRadius: visitor ? 4 : 14,
                    borderBottomLeftRadius: visitor ? 14 : 4,
                    fontSize: 14,
                    lineHeight: 1.4,
                    maxWidth: "85%",
                    whiteSpace: "pre-wrap",
                    boxShadow: visitor
                      ? "none"
                      : "0 1px 2px rgba(0,0,0,0.06)",
                  }}
                >
                  {m.body}
                </div>
              );
            })}
            {sending && (
              <div
                style={{
                  alignSelf: "flex-start",
                  background: "white",
                  color: "#888",
                  padding: "8px 12px",
                  borderRadius: 14,
                  borderBottomLeftRadius: 4,
                  fontSize: 14,
                  fontStyle: "italic",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                }}
              >
                {t.typing}
              </div>
            )}
            {error && (
              <div
                style={{
                  alignSelf: "center",
                  color: "#b91c1c",
                  fontSize: 12,
                  padding: "4px 8px",
                }}
              >
                {error}
              </div>
            )}
          </div>

          {/* Composer */}
          <div
            style={{
              borderTop: "1px solid #e5e7eb",
              padding: 10,
              display: "flex",
              gap: 8,
              background: "white",
              flexShrink: 0,
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t.placeholder}
              disabled={!token || sending}
              style={{
                flex: 1,
                border: "1px solid #d1d5db",
                borderRadius: 999,
                padding: "10px 14px",
                fontSize: 14,
                outline: "none",
                color: "#111",
                background: "white",
              }}
            />
            <button
              type="button"
              onClick={send}
              disabled={!token || sending || draft.trim().length === 0}
              style={{
                background: accentColor,
                color: "white",
                border: "none",
                borderRadius: 999,
                padding: "10px 16px",
                fontSize: 14,
                fontWeight: 600,
                cursor:
                  !token || sending || draft.trim().length === 0
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  !token || sending || draft.trim().length === 0 ? 0.5 : 1,
              }}
            >
              {t.send}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
