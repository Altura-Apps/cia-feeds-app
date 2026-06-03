"use client";

import { useState } from "react";

interface Entry {
  id: string;
  locale: string;
  question: string;
  answer: string;
  category: string;
  active: boolean;
  sourceEntryId: string | null;
}

const CATEGORIES = [
  { value: "hours", label: "Hours" },
  { value: "location", label: "Location" },
  { value: "financing", label: "Financing" },
  { value: "services", label: "Services" },
  { value: "promos", label: "Promotions" },
  { value: "custom", label: "Custom" },
] as const;

export default function KbEditorClient({
  initialEntries,
  hasWebsite,
  aiChatEnabled,
}: {
  initialEntries: Entry[];
  hasWebsite: boolean;
  aiChatEnabled: boolean;
}) {
  const [entries, setEntries] = useState<Entry[]>(initialEntries);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newQ, setNewQ] = useState("");
  const [newA, setNewA] = useState("");
  const [newCategory, setNewCategory] = useState<string>("custom");

  // Group EN entries with their ES siblings for display.
  const enEntries = entries
    .filter((e) => e.locale === "en")
    .sort((a, b) => a.category.localeCompare(b.category));
  const esBySourceId = new Map<string, Entry>();
  for (const e of entries) {
    if (e.locale === "es" && e.sourceEntryId) {
      esBySourceId.set(e.sourceEntryId, e);
    }
  }
  // Orphaned ES entries (no EN parent)
  const orphanEs = entries.filter(
    (e) => e.locale === "es" && !e.sourceEntryId
  );

  async function runScan() {
    if (!hasWebsite) {
      setScanResult("Add a website URL on your Profile page first.");
      return;
    }
    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch("/api/dealer/kb/scan", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setScanResult(
          `Scan complete: ${data.englishEntries} English + ${data.spanishEntries} Spanish entries added.`
        );
        // Refresh list
        const listRes = await fetch("/api/dealer/kb");
        if (listRes.ok) {
          const list = await listRes.json();
          setEntries(list.entries);
        }
      } else {
        setScanResult(`Scan failed: ${data.reason ?? "unknown"}`);
      }
    } catch {
      setScanResult("Scan failed: network error.");
    } finally {
      setScanning(false);
    }
  }

  async function createEntry() {
    if (newQ.trim().length < 5 || newA.trim().length < 5) return;
    setCreating(true);
    try {
      const res = await fetch("/api/dealer/kb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: newQ.trim(),
          answer: newA.trim(),
          category: newCategory,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setEntries((prev) => [
          ...prev,
          data.en,
          ...(data.es ? [data.es] : []),
        ]);
        setNewQ("");
        setNewA("");
        setNewCategory("custom");
      }
    } finally {
      setCreating(false);
    }
  }

  async function patchEntry(id: string, patch: Partial<Entry>) {
    const res = await fetch(`/api/dealer/kb?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data = await res.json();
      setEntries((prev) => prev.map((e) => (e.id === id ? data.entry : e)));
    }
  }

  async function deleteEntry(id: string) {
    if (!confirm("Delete this Q&A and its translation?")) return;
    const res = await fetch(`/api/dealer/kb?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      // Remove the EN row and any ES rows pointing at it.
      setEntries((prev) =>
        prev.filter((e) => e.id !== id && e.sourceEntryId !== id)
      );
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {!aiChatEnabled && (
        <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-800">
          AI Chat isn&apos;t enabled yet. The knowledge base will only matter once
          you turn it on from your{" "}
          <a href="/dashboard/profile" className="underline font-medium">
            Profile
          </a>{" "}
          → Contact Button Preference → AI Chat.
        </div>
      )}

      {/* Auto-scan card */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              Auto-scan your website
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              We&apos;ll read your homepage and a few common pages (about, contact,
              FAQ, hours) and propose 5-12 Q&As. Existing custom entries are
              preserved.
            </p>
          </div>
          <button
            type="button"
            onClick={runScan}
            disabled={scanning || !hasWebsite}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-md px-4 py-2 whitespace-nowrap"
          >
            {scanning ? "Scanning…" : "Scan website"}
          </button>
        </div>
        {scanResult && (
          <p className="text-xs text-gray-700 mt-3 bg-gray-50 border border-gray-200 rounded px-3 py-2">
            {scanResult}
          </p>
        )}
        {!hasWebsite && (
          <p className="text-xs text-amber-700 mt-2">
            Add your website URL on Profile first.
          </p>
        )}
      </div>

      {/* New entry form */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-3">
          Add a custom Q&A
        </h2>
        <p className="text-xs text-gray-500 mb-3">
          We&apos;ll auto-translate this to Spanish so your bilingual visitors
          get the same answer.
        </p>
        <div className="space-y-2">
          <input
            type="text"
            value={newQ}
            onChange={(e) => setNewQ(e.target.value)}
            placeholder="Question (e.g. Do you take trade-ins?)"
            className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            maxLength={200}
          />
          <textarea
            value={newA}
            onChange={(e) => setNewA(e.target.value)}
            placeholder="Answer the AI should give."
            className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[80px]"
            maxLength={800}
          />
          <div className="flex items-center justify-between gap-2">
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm text-gray-900"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={createEntry}
              disabled={
                creating || newQ.trim().length < 5 || newA.trim().length < 5
              }
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-md px-4 py-2"
            >
              {creating ? "Saving…" : "Add Q&A"}
            </button>
          </div>
        </div>
      </div>

      {/* Existing entries */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-3">
          Existing entries
        </h2>
        {enEntries.length === 0 && orphanEs.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-500 text-center">
            No entries yet. Run the website scan above or add one manually.
          </div>
        )}
        <div className="space-y-3">
          {enEntries.map((en) => {
            const es = esBySourceId.get(en.id);
            const categoryLabel =
              CATEGORIES.find((c) => c.value === en.category)?.label ?? en.category;
            return (
              <div
                key={en.id}
                className={`bg-white border rounded-lg p-4 ${
                  en.active ? "border-gray-200" : "border-gray-200 opacity-60"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-semibold text-gray-500 bg-gray-100 rounded px-2 py-0.5">
                      {categoryLabel}
                    </span>
                    {!en.active && (
                      <span className="text-[10px] uppercase font-semibold text-amber-700 bg-amber-100 rounded px-2 py-0.5">
                        Disabled
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => patchEntry(en.id, { active: !en.active })}
                      className="text-xs text-gray-600 hover:text-gray-900"
                    >
                      {en.active ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteEntry(en.id)}
                      className="text-xs text-red-600 hover:text-red-800"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] uppercase font-semibold text-gray-400 mb-1">
                      🇺🇸 English
                    </p>
                    <input
                      type="text"
                      defaultValue={en.question}
                      onBlur={(e) => {
                        if (e.target.value.trim() !== en.question) {
                          patchEntry(en.id, { question: e.target.value.trim() });
                        }
                      }}
                      className="w-full text-sm font-semibold text-gray-900 border-b border-transparent hover:border-gray-300 focus:border-indigo-500 focus:outline-none py-1 bg-transparent"
                    />
                    <textarea
                      defaultValue={en.answer}
                      onBlur={(e) => {
                        if (e.target.value.trim() !== en.answer) {
                          patchEntry(en.id, { answer: e.target.value.trim() });
                        }
                      }}
                      className="w-full text-sm text-gray-700 border border-transparent hover:border-gray-200 focus:border-indigo-500 focus:outline-none py-1 mt-1 bg-transparent rounded min-h-[60px]"
                    />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-semibold text-gray-400 mb-1">
                      🇪🇸 Español
                    </p>
                    {es ? (
                      <>
                        <input
                          type="text"
                          defaultValue={es.question}
                          onBlur={(e) => {
                            if (e.target.value.trim() !== es.question) {
                              patchEntry(es.id, {
                                question: e.target.value.trim(),
                              });
                            }
                          }}
                          className="w-full text-sm font-semibold text-gray-900 border-b border-transparent hover:border-gray-300 focus:border-indigo-500 focus:outline-none py-1 bg-transparent"
                        />
                        <textarea
                          defaultValue={es.answer}
                          onBlur={(e) => {
                            if (e.target.value.trim() !== es.answer) {
                              patchEntry(es.id, { answer: e.target.value.trim() });
                            }
                          }}
                          className="w-full text-sm text-gray-700 border border-transparent hover:border-gray-200 focus:border-indigo-500 focus:outline-none py-1 mt-1 bg-transparent rounded min-h-[60px]"
                        />
                      </>
                    ) : (
                      <p className="text-xs text-gray-400 italic">
                        No Spanish translation yet.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {orphanEs.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                Spanish-only entries
              </h3>
              {orphanEs.map((es) => (
                <div key={es.id} className="mb-2 last:mb-0">
                  <p className="text-sm font-semibold text-gray-900">
                    {es.question}
                  </p>
                  <p className="text-sm text-gray-700">{es.answer}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
