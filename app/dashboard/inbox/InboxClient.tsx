"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

interface Row {
  id: string;
  status: string;
  locale: string;
  createdAt: string;
  updatedAt: string;
  dealerReadAt: string | null;
  capturedName: string | null;
  capturedPhone: string | null;
  capturedEmail: string | null;
  capturedIntent: string | null;
  vehicleLabel: string | null;
  listingLabel: string | null;
  lastVisitorPreview: string | null;
}

interface Message {
  id: string;
  role: string;
  body: string;
  createdAt: string;
  dealerRepName: string | null;
}

interface Detail {
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
  messages: Message[];
}

type Filter = "all" | "unread" | "lead_captured" | "handoff" | "spanish";

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export default function InboxClient({
  rows,
  selected,
}: {
  rows: Row[];
  selected: Detail | null;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    let out = rows;
    if (filter === "unread") out = out.filter((r) => !r.dealerReadAt);
    else if (filter === "lead_captured")
      out = out.filter((r) => r.capturedName && (r.capturedPhone || r.capturedEmail));
    else if (filter === "handoff")
      out = out.filter((r) => r.status === "handoff_requested");
    else if (filter === "spanish") out = out.filter((r) => r.locale === "es");

    if (query.trim()) {
      const q = query.toLowerCase();
      out = out.filter((r) => {
        return (
          (r.capturedName ?? "").toLowerCase().includes(q) ||
          (r.capturedPhone ?? "").includes(q) ||
          (r.capturedEmail ?? "").toLowerCase().includes(q) ||
          (r.vehicleLabel ?? "").toLowerCase().includes(q) ||
          (r.listingLabel ?? "").toLowerCase().includes(q) ||
          (r.lastVisitorPreview ?? "").toLowerCase().includes(q)
        );
      });
    }
    return out;
  }, [rows, filter, query]);

  return (
    <div className="flex" style={{ height: "calc(100vh - 65px)" }}>
      {/* Left rail */}
      <aside className="w-96 border-r border-gray-200 bg-white flex flex-col">
        <div className="p-3 border-b border-gray-100 space-y-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, phone, email…"
            className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <div className="flex gap-1 flex-wrap">
            {(
              [
                ["all", "All"],
                ["unread", "Unread"],
                ["lead_captured", "Lead captured"],
                ["handoff", "Needs attention"],
                ["spanish", "🇪🇸 Spanish"],
              ] as Array<[Filter, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`text-xs font-semibold rounded-full px-2.5 py-1 ${
                  filter === key
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="text-sm text-gray-400 text-center mt-8 px-6">
              {rows.length === 0
                ? "No conversations yet. Enable AI Chat in Profile and visitors will show up here."
                : "No conversations match this filter."}
            </p>
          )}
          {filtered.map((r) => {
            const isSelected = selected?.id === r.id;
            const isUnread = !r.dealerReadAt;
            const displayName = r.capturedName ?? "Anonymous visitor";
            const subline = r.vehicleLabel ?? r.listingLabel ?? "Storefront homepage";
            return (
              <Link
                key={r.id}
                href={`/dashboard/inbox?conversation=${r.id}`}
                className={`block px-3 py-3 border-b border-gray-100 ${
                  isSelected ? "bg-indigo-50" : "hover:bg-gray-50"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {isUnread && (
                        <span
                          className="inline-block w-2 h-2 rounded-full bg-indigo-600 flex-shrink-0"
                          aria-label="Unread"
                        />
                      )}
                      <span
                        className={`text-sm truncate ${
                          isUnread
                            ? "font-bold text-gray-900"
                            : "font-medium text-gray-700"
                        }`}
                      >
                        {displayName}
                      </span>
                      {r.locale === "es" && (
                        <span className="text-xs" aria-label="Spanish">
                          🇪🇸
                        </span>
                      )}
                      {r.status === "handoff_requested" && (
                        <span
                          className="text-xs bg-amber-100 text-amber-800 font-semibold rounded px-1.5 py-0.5"
                          aria-label="Needs attention"
                        >
                          !
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate mt-0.5">{subline}</p>
                    {r.lastVisitorPreview && (
                      <p className="text-xs text-gray-600 truncate mt-1">
                        {r.lastVisitorPreview}
                      </p>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-400 whitespace-nowrap mt-0.5">
                    {timeAgo(r.updatedAt)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </aside>

      {/* Right detail */}
      <main className="flex-1 flex flex-col bg-gray-50">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            Select a conversation to view.
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-base font-bold text-gray-900">
                    {selected.capturedName ?? "Anonymous visitor"}
                  </h2>
                  {selected.locale === "es" && (
                    <span className="text-xs bg-gray-100 text-gray-700 font-semibold rounded px-2 py-0.5">
                      🇪🇸 Spanish
                    </span>
                  )}
                  <span
                    className={`text-xs font-semibold rounded px-2 py-0.5 ${
                      selected.status === "handoff_requested"
                        ? "bg-amber-100 text-amber-800"
                        : selected.status === "active"
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {selected.status === "handoff_requested"
                      ? "needs attention"
                      : selected.status}
                  </span>
                </div>
                <span className="text-xs text-gray-400">
                  Started {new Date(selected.createdAt).toLocaleString()}
                </span>
              </div>
              {/* Lead card */}
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs mt-2 text-gray-600">
                {selected.capturedPhone && (
                  <a
                    href={`tel:${selected.capturedPhone}`}
                    className="hover:text-indigo-700"
                  >
                    📞 {selected.capturedPhone}
                  </a>
                )}
                {selected.capturedEmail && (
                  <a
                    href={`mailto:${selected.capturedEmail}`}
                    className="hover:text-indigo-700"
                  >
                    ✉ {selected.capturedEmail}
                  </a>
                )}
                {selected.capturedIntent && (
                  <span>🎯 {selected.capturedIntent}</span>
                )}
                {(selected.vehicleLabel || selected.listingLabel) && (
                  <span>👀 {selected.vehicleLabel ?? selected.listingLabel}</span>
                )}
              </div>
            </div>

            {/* Transcript */}
            <div
              className="flex-1 overflow-y-auto p-6 space-y-3"
              style={{ maxWidth: 800 }}
            >
              {selected.messages.map((m) => {
                if (m.role === "visitor") {
                  return (
                    <div key={m.id} className="flex flex-col items-start max-w-[80%]">
                      <div className="bg-white border border-gray-200 rounded-lg rounded-bl-sm px-3 py-2 text-sm text-gray-900 whitespace-pre-wrap">
                        {m.body}
                      </div>
                      <span className="text-[10px] text-gray-400 mt-0.5 ml-1">
                        Visitor · {new Date(m.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  );
                }
                if (m.role === "assistant") {
                  return (
                    <div key={m.id} className="flex flex-col items-end ml-auto max-w-[80%]">
                      <div className="bg-indigo-600 text-white rounded-lg rounded-br-sm px-3 py-2 text-sm whitespace-pre-wrap">
                        {m.body}
                      </div>
                      <span className="text-[10px] text-gray-400 mt-0.5 mr-1">
                        AI · {new Date(m.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  );
                }
                // dealer rep or system
                return (
                  <div key={m.id} className="text-center">
                    <span className="text-xs text-gray-500 bg-gray-100 rounded px-2 py-1">
                      {m.dealerRepName ? `${m.dealerRepName} · ` : ""}
                      {m.body}
                    </span>
                  </div>
                );
              })}
            </div>

            <LiveDealerComposer
              conversationId={selected.id}
              initialMessages={selected.messages}
            />
          </>
        )}
      </main>
    </div>
  );
}

/**
 * Composer + live polling for the selected conversation. Sends dealer
 * messages and polls for new visitor turns every 3.5s while the inbox
 * is open on this conversation.
 */
function LiveDealerComposer({
  conversationId,
  initialMessages,
}: {
  conversationId: string;
  initialMessages: Message[];
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extraMessages, setExtraMessages] = useState<Message[]>([]);
  const sinceRef = useRef<string>(
    initialMessages[initialMessages.length - 1]?.createdAt ?? new Date(0).toISOString()
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll for new visitor messages every 3.5s while mounted.
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/dealer/chat/${conversationId}/messages?since=${encodeURIComponent(sinceRef.current)}`
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          status: string;
          messages: Message[];
        };
        if (data.messages.length > 0) {
          setExtraMessages((prev) => {
            const knownIds = new Set(
              prev.map((m) => m.id).concat(initialMessages.map((m) => m.id))
            );
            const fresh = data.messages.filter(
              (m) => !knownIds.has(m.id)
            );
            return prev.concat(fresh);
          });
          sinceRef.current = data.messages[data.messages.length - 1].createdAt;
        }
      } catch {
        // ignore
      }
    }, 3500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [conversationId, initialMessages]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/dealer/chat/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        setError("Failed to send.");
        return;
      }
      const data = (await res.json()) as Message;
      setExtraMessages((prev) => prev.concat(data));
      sinceRef.current = data.createdAt;
      setText("");
    } catch {
      setError("Network error.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="bg-white border-t border-gray-200">
      {extraMessages.length > 0 && (
        <div className="px-6 pt-3 space-y-2 max-h-48 overflow-y-auto">
          {extraMessages.map((m) => {
            if (m.role === "visitor") {
              return (
                <div key={m.id} className="flex flex-col items-start max-w-[80%]">
                  <div className="bg-gray-100 rounded-lg rounded-bl-sm px-3 py-2 text-sm text-gray-900 whitespace-pre-wrap">
                    {m.body}
                  </div>
                  <span className="text-[10px] text-gray-400 mt-0.5 ml-1">
                    Visitor · {new Date(m.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              );
            }
            return (
              <div key={m.id} className="flex flex-col items-end ml-auto max-w-[80%]">
                <div className="bg-indigo-600 text-white rounded-lg rounded-br-sm px-3 py-2 text-sm whitespace-pre-wrap">
                  {m.body}
                </div>
                <span className="text-[10px] text-gray-400 mt-0.5 mr-1">
                  {m.role === "dealer" ? "You" : "AI"} · {new Date(m.createdAt).toLocaleTimeString()}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className="px-6 py-3 flex gap-2 items-end">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Type a message — sending it will take over from the AI"
          className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[40px] max-h-[120px] resize-y"
        />
        <button
          type="button"
          onClick={send}
          disabled={!text.trim() || sending}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-md px-4 py-2 whitespace-nowrap"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-600 px-6 pb-3">{error}</p>
      )}
    </div>
  );
}
