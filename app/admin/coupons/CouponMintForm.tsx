"use client";

import { useState } from "react";

interface MintResult {
  code: string;
  subscribeUrl: string;
  durationMonths: number;
  maxRedemptions: number;
  expiresAt: string;
}

export default function CouponMintForm() {
  const [code, setCode] = useState("");
  const [durationMonths, setDurationMonths] = useState(12);
  const [maxRedemptions, setMaxRedemptions] = useState(1);
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<MintResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"code" | "url" | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/coupons/beta", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: code.trim() || undefined,
          durationMonths,
          maxRedemptions,
          expiresInDays,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Failed to create coupon.");
      } else {
        setResult({
          code: data.code,
          subscribeUrl: data.subscribeUrl,
          durationMonths: data.durationMonths,
          maxRedemptions: data.maxRedemptions,
          expiresAt: data.expiresAt,
        });
        // Refresh server-rendered list on next nav. Quickest path: refresh page.
        // We delay this so the user can copy the code first.
      }
    } catch {
      setError("Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copy(value: string, which: "code" | "url") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // ignore
    }
  }

  function reset() {
    setResult(null);
    setCode("");
    setNote("");
    // Reload the list so the new code appears below.
    if (typeof window !== "undefined") window.location.reload();
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <h2 className="text-base font-semibold text-gray-900 mb-4">
        Mint a new beta access code
      </h2>

      {result ? (
        <div className="bg-green-50 border border-green-300 rounded-lg p-4">
          <p className="text-sm font-semibold text-green-900 mb-3">
            ✓ Coupon created. Share with your beta user:
          </p>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase text-gray-500 w-16">Code</span>
              <code className="flex-1 bg-white border border-gray-300 rounded px-2 py-1.5 text-sm font-mono text-gray-900">
                {result.code}
              </code>
              <button
                type="button"
                onClick={() => copy(result.code, "code")}
                className="text-xs font-semibold bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded px-2 py-1.5 text-gray-700"
              >
                {copied === "code" ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase text-gray-500 w-16">Link</span>
              <code className="flex-1 bg-white border border-gray-300 rounded px-2 py-1.5 text-xs font-mono text-gray-900 truncate">
                {result.subscribeUrl}
              </code>
              <button
                type="button"
                onClick={() => copy(result.subscribeUrl, "url")}
                className="text-xs font-semibold bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded px-2 py-1.5 text-gray-700"
              >
                {copied === "url" ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-600 mt-3">
            {result.durationMonths} months free · {result.maxRedemptions} use(s)
            · expires {new Date(result.expiresAt).toLocaleDateString()}
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-4 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
          >
            Mint another →
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Code (optional)
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Auto-generated (e.g. BETA-7K2QXJ4P)"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900"
                maxLength={40}
              />
              <p className="text-[11px] text-gray-500 mt-1">
                3-40 chars, A-Z 0-9 _ - only. Leave blank to auto-generate.
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Note (optional)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Beaver Toyota beta"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900"
                maxLength={200}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Free months
              </label>
              <input
                type="number"
                min={1}
                max={36}
                value={durationMonths}
                onChange={(e) => setDurationMonths(parseInt(e.target.value) || 1)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900"
              />
              <p className="text-[11px] text-gray-500 mt-1">
                How long the discount applies. After this, Stripe asks for a card.
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Max redemptions
              </label>
              <input
                type="number"
                min={1}
                max={1000}
                value={maxRedemptions}
                onChange={(e) => setMaxRedemptions(parseInt(e.target.value) || 1)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900"
              />
              <p className="text-[11px] text-gray-500 mt-1">
                1 = single-use (recommended). Higher for shared beta links.
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Code expires in (days)
              </label>
              <input
                type="number"
                min={1}
                max={365}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(parseInt(e.target.value) || 30)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900"
              />
              <p className="text-[11px] text-gray-500 mt-1">
                When the code stops accepting new sign-ups (existing redeemers
                keep their free months).
              </p>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded px-4 py-2"
          >
            {submitting ? "Creating..." : "Create beta code"}
          </button>
        </form>
      )}
    </div>
  );
}
