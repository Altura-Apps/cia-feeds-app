"use client";

import { useState } from "react";

interface Row {
  code: string;
  promotionCodeId: string;
  active: boolean;
  timesRedeemed: number;
  maxRedemptions: number | null;
  expiresAt: string | null;
  createdAt: string;
  durationMonths: number | null;
  createdBy: string | null;
  note: string | null;
}

export default function CouponList({ rows }: { rows: Row[] }) {
  const [deactivating, setDeactivating] = useState<string | null>(null);
  const [deactivated, setDeactivated] = useState<Set<string>>(new Set());

  async function deactivate(promoId: string) {
    if (
      !confirm(
        "Deactivate this code? It will stop accepting new redemptions immediately. Existing users keep their free months."
      )
    ) {
      return;
    }
    setDeactivating(promoId);
    try {
      const res = await fetch(`/api/admin/coupons/${promoId}/deactivate`, {
        method: "POST",
      });
      if (res.ok) {
        setDeactivated((prev) => new Set(prev).add(promoId));
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data?.error ?? "Failed to deactivate.");
      }
    } finally {
      setDeactivating(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-500 text-center">
        No beta codes yet. Mint your first above.
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="px-4 py-2.5">Code</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">Used</th>
            <th className="px-4 py-2.5">Free months</th>
            <th className="px-4 py-2.5">Expires</th>
            <th className="px-4 py-2.5">Note</th>
            <th className="px-4 py-2.5"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isDeactivated = deactivated.has(r.promotionCodeId) || !r.active;
            return (
              <tr
                key={r.promotionCodeId}
                className="border-b border-gray-100 last:border-b-0"
              >
                <td className="px-4 py-2.5">
                  <code className="font-mono text-gray-900">{r.code}</code>
                </td>
                <td className="px-4 py-2.5">
                  {isDeactivated ? (
                    <span className="inline-block bg-gray-100 text-gray-600 text-xs font-semibold rounded px-2 py-0.5">
                      inactive
                    </span>
                  ) : (
                    <span className="inline-block bg-green-100 text-green-800 text-xs font-semibold rounded px-2 py-0.5">
                      active
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-gray-700">
                  {r.timesRedeemed}
                  {r.maxRedemptions ? ` / ${r.maxRedemptions}` : ""}
                </td>
                <td className="px-4 py-2.5 text-gray-700">
                  {r.durationMonths ?? "—"}
                </td>
                <td className="px-4 py-2.5 text-gray-700">
                  {r.expiresAt
                    ? new Date(r.expiresAt).toLocaleDateString()
                    : "—"}
                </td>
                <td className="px-4 py-2.5 text-gray-600 max-w-[200px] truncate">
                  {r.note ?? ""}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {!isDeactivated && (
                    <button
                      type="button"
                      onClick={() => deactivate(r.promotionCodeId)}
                      disabled={deactivating === r.promotionCodeId}
                      className="text-xs font-semibold text-red-700 hover:text-red-900 disabled:opacity-50"
                    >
                      {deactivating === r.promotionCodeId
                        ? "..."
                        : "Deactivate"}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
