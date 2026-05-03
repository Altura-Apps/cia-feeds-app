"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { VERTICAL_LABELS, type Vertical } from "@/lib/verticals";
import Link from "next/link";

interface StatusData {
  ready: boolean;
  readiness: Record<string, boolean>;
  inventoryCount: number;
  vertical: string;
  deliveryMethod: string;
  queue: {
    jobId: string;
    status: string;
    nextRunAt: string | null;
    attemptCount: number;
    coalescedCount: number;
  } | null;
  lastRun: {
    lastRunAt: string | null;
    lastRunStatus: string | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    itemsAttempted: number;
    itemsSucceeded: number;
    itemsFailed: number;
    deleteAttempted: number;
    deleteSucceeded: number;
    deleteFailed: number;
  } | null;
  circuit: {
    blocked: boolean;
    needsReconnect?: boolean;
    reason?: string | null;
    consecutiveAuthFailures?: number;
  };
}

type ErrorState = {
  code: "session_expired" | "dealer_not_found" | "network" | "server";
  message?: string;
} | null;

interface Props {
  vertical: string;
  onReconnect: () => void | Promise<void>;
}

function pillClasses(status: string): string {
  switch (status) {
    case "success":
    case "complete":
      return "bg-green-100 text-green-800";
    case "processing":
      return "bg-blue-100 text-blue-800";
    case "queued":
    case "retry":
      return "bg-yellow-100 text-yellow-800";
    case "error":
    case "blocked":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

const READINESS_META: Record<string, { label: string; hint: string }> = {
  tokenPresent: {
    label: "Meta token present",
    hint: "Reconnect Meta in the wizard above.",
  },
  tokenValid: {
    label: "Meta token valid",
    hint: "Reconnect Meta in the wizard above.",
  },
  catalogSelected: {
    label: "Catalog selected",
    hint: "Choose or create a Meta catalog in the wizard.",
  },
  supportedVertical: {
    label: "Supported vertical",
    hint: "API delivery only supports automotive and services.",
  },
  hasInventory: {
    label: "Has pushable inventory",
    hint: "", // set dynamically
  },
  notBlocked: {
    label: "Delivery not blocked",
    hint: "Delivery is paused. Use Reconnect Meta below.",
  },
};

function getInventoryHint(vertical: string): string {
  if (vertical === "automotive") {
    return "Add at least one vehicle with image and URL.";
  }
  if (vertical === "services") {
    return "Publish at least one service with image.";
  }
  return "Add inventory items to enable delivery.";
}

export default function MetaDeliveryStatusCard({ vertical, onReconnect }: Props) {
  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState<ErrorState>(null);
  const [loading, setLoading] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [pushNotice, setPushNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const terminalRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/meta/inventory/status");
      if (res.status === 401) {
        setError({ code: "session_expired" });
        terminalRef.current = true;
        if (intervalRef.current) clearInterval(intervalRef.current);
        return;
      }
      if (res.status === 404) {
        setError({ code: "dealer_not_found" });
        terminalRef.current = true;
        if (intervalRef.current) clearInterval(intervalRef.current);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError({ code: "server", message: body.error || `HTTP ${res.status}` });
        return;
      }
      const json = await res.json();
      setData(json);
      setError(null);
    } catch {
      setError({ code: "network", message: "Could not reach the server." });
    } finally {
      setLoading(false);
    }
  }, []);

  const armPolling = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchStatus, 30_000);
  }, [fetchStatus]);

  useEffect(() => {
    fetchStatus();
    armPolling();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchStatus();
        armPolling();
      } else {
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchStatus, armPolling]);

  const handleRetry = () => {
    terminalRef.current = false;
    setError(null);
    setLoading(true);
    fetchStatus();
    armPolling();
  };

  const handlePush = async () => {
    setPushing(true);
    setPushNotice(null);
    try {
      const res = await fetch("/api/meta/inventory/push", { method: "POST" });
      const body = await res.json().catch(() => ({}));

      if (res.status === 429) {
        const secs = body.retryAfterMs ? Math.ceil(body.retryAfterMs / 1000) : 60;
        setPushNotice({ kind: "error", message: `Rate limit reached. Try again in ${secs} seconds.` });
      } else if (body.queue?.outcome === "queued") {
        setPushNotice({ kind: "success", message: "Delivery queued." });
      } else if (body.queue?.outcome === "coalesced") {
        setPushNotice({ kind: "success", message: "Merged with pending delivery." });
      } else if (body.queue?.outcome === "skipped") {
        setPushNotice({ kind: "error", message: `Skipped: ${body.reason || "unknown reason"}.` });
      } else if (body.queue?.outcome === "blocked") {
        setPushNotice({ kind: "error", message: "Delivery blocked. Reconnect required." });
      } else if (!res.ok) {
        setPushNotice({ kind: "error", message: body.error || "Push failed." });
      } else {
        setPushNotice({ kind: "success", message: "Push triggered." });
      }

      fetchStatus();
    } catch {
      setPushNotice({ kind: "error", message: "Network error." });
    } finally {
      setPushing(false);
    }
  };

  // --- Render ---

  // Session expired
  if (error?.code === "session_expired") {
    return (
      <section id="meta-delivery" className="bg-white rounded-lg shadow-sm p-6 mb-4">
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-md p-4">
          <p className="font-semibold">Your session expired.</p>
          <Link href="/login" className="text-sm text-indigo-600 hover:text-indigo-500 underline mt-1 inline-block">
            Log in again
          </Link>
        </div>
      </section>
    );
  }

  // Dealer not found
  if (error?.code === "dealer_not_found") {
    return (
      <section id="meta-delivery" className="bg-white rounded-lg shadow-sm p-6 mb-4">
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-md p-4">
          <p className="font-semibold">Dealer account not found.</p>
          <p className="text-sm mt-1">Try logging in again or contact support.</p>
        </div>
      </section>
    );
  }

  // Loading skeleton
  if (loading && !data && !error) {
    return (
      <section id="meta-delivery" className="bg-white rounded-lg shadow-sm p-6 mb-4">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 rounded w-48" />
          <div className="h-3 bg-gray-200 rounded w-64" />
          <div className="h-3 bg-gray-200 rounded w-56" />
          <div className="h-3 bg-gray-200 rounded w-40" />
        </div>
      </section>
    );
  }

  // Network/server error
  if (error && (error.code === "network" || error.code === "server")) {
    return (
      <section id="meta-delivery" className="bg-white rounded-lg shadow-sm p-6 mb-4">
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-md p-4">
          <p className="font-semibold">Unable to load delivery status.</p>
          {error.message && <p className="text-sm mt-1">{error.message}</p>}
          <button type="button" onClick={handleRetry} className="mt-2 text-sm text-indigo-600 hover:text-indigo-500 underline">
            Retry
          </button>
        </div>
      </section>
    );
  }

  // Token not present — minimal view
  if (data && !data.readiness.tokenPresent) {
    return (
      <section id="meta-delivery" className="bg-white rounded-lg shadow-sm p-6 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Meta Delivery Health</h2>
          <button type="button" onClick={handleRetry} className="text-xs text-gray-400 hover:text-gray-600" aria-label="Refresh">
            &#8635;
          </button>
        </div>
        <ReadinessChecklist readiness={data.readiness} vertical={vertical} />
        <p className="text-xs text-gray-500 mt-3">Connect Meta in the wizard above to enable API delivery.</p>
      </section>
    );
  }

  if (!data) return null;

  const pushDisabled =
    pushing ||
    data.queue?.status === "processing" ||
    data.circuit?.blocked === true ||
    !data.readiness.hasInventory;

  return (
    <section id="meta-delivery" className="bg-white rounded-lg shadow-sm p-6 mb-4">
      {/* Circuit-breaker banner */}
      {data.circuit?.blocked && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-md p-3 mb-4">
          <p className="font-semibold text-sm">Meta delivery blocked</p>
          {data.circuit.reason && <p className="text-xs mt-1">{data.circuit.reason}</p>}
          {typeof data.circuit.consecutiveAuthFailures === "number" && (
            <p className="text-xs mt-1">Consecutive auth failures: {data.circuit.consecutiveAuthFailures}</p>
          )}
          <button
            type="button"
            onClick={() => onReconnect()}
            className="mt-2 text-sm text-indigo-600 hover:text-indigo-500 underline"
          >
            Reconnect Meta
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Meta Delivery Health</h2>
        <button type="button" onClick={handleRetry} className="text-xs text-gray-400 hover:text-gray-600" aria-label="Refresh">
          &#8635;
        </button>
      </div>

      {/* Sub-section A: Readiness */}
      <ReadinessChecklist readiness={data.readiness} vertical={vertical} />

      {/* Sub-section B: Queue & last run */}
      <div className="mt-4 border-t border-gray-100 pt-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Queue</h3>
        {data.queue ? (
          <div className="text-sm text-gray-700 space-y-1">
            <p>
              Status: <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${pillClasses(data.queue.status)}`}>{data.queue.status}</span>
            </p>
            <p>Attempts: {data.queue.attemptCount} | Coalesced: {data.queue.coalescedCount}</p>
            {data.queue.nextRunAt && <p>Next run: {new Date(data.queue.nextRunAt).toLocaleString()}</p>}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No delivery currently queued.</p>
        )}
      </div>

      <div className="mt-4 border-t border-gray-100 pt-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Last Run</h3>
        {data.lastRun ? (
          <div className="text-sm text-gray-700 space-y-1">
            {data.lastRun.lastRunAt && <p>Ran: {new Date(data.lastRun.lastRunAt).toLocaleString()}</p>}
            {data.lastRun.lastRunStatus && (
              <p>
                Status: <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${pillClasses(data.lastRun.lastRunStatus)}`}>{data.lastRun.lastRunStatus}</span>
              </p>
            )}
            <p>Items: {data.lastRun.itemsSucceeded}/{data.lastRun.itemsAttempted} succeeded, {data.lastRun.itemsFailed} failed</p>
            <p>Deletes: {data.lastRun.deleteSucceeded}/{data.lastRun.deleteAttempted} succeeded, {data.lastRun.deleteFailed} failed</p>
            {(data.lastRun.lastErrorCode || data.lastRun.lastErrorMessage) && (
              <div className="text-xs text-red-600 mt-1">
                {data.lastRun.lastErrorCode && <p>Error code: {data.lastRun.lastErrorCode}</p>}
                {data.lastRun.lastErrorMessage && <p>{data.lastRun.lastErrorMessage}</p>}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No deliveries yet.</p>
        )}
      </div>

      {/* Push now */}
      <div className="mt-4 border-t border-gray-100 pt-4">
        <button
          type="button"
          disabled={pushDisabled}
          onClick={handlePush}
          className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pushing ? "Pushing..." : "Push now"}
        </button>
        {pushNotice && (
          <p className={`text-xs mt-2 ${pushNotice.kind === "success" ? "text-green-600" : "text-red-600"}`}>
            {pushNotice.message}
          </p>
        )}
      </div>
    </section>
  );
}

function ReadinessChecklist({ readiness, vertical }: { readiness: Record<string, boolean>; vertical: string }) {
  const keys = Object.keys(readiness).filter((k) => k !== "deliveryModeApi");

  return (
    <ul className="space-y-1">
      {keys.map((key) => {
        const passed = readiness[key];
        const meta = READINESS_META[key];
        if (!meta) return null;

        let label = meta.label;
        if (key === "supportedVertical") {
          label = `Supported vertical (${VERTICAL_LABELS[vertical as Vertical] ?? vertical})`;
        }

        let hint = meta.hint;
        if (key === "hasInventory" && !passed) {
          hint = getInventoryHint(vertical);
        }

        return (
          <li key={key} className="flex items-start gap-2 text-sm">
            <span className={passed ? "text-green-600" : "text-red-600"}>
              {passed ? "\u2713" : "\u2717"}
            </span>
            <span className="text-gray-700">
              {label}
              {!passed && hint && <span className="text-xs text-gray-500 ml-1">- {hint}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
