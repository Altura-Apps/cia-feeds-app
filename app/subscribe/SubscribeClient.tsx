"use client";

import { useState, useEffect, useRef } from "react";

interface Props {
  canceled: boolean;
  priceLabel: string | null;
  success: boolean;
  sessionId: string | null;
  currentStatus: string | null;
  initialPromo?: string | null;
}

export function SubscribeClient({ canceled, priceLabel, success, sessionId, currentStatus, initialPromo }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState(initialPromo ?? "");
  const [promoStatus, setPromoStatus] = useState<"idle" | "loading" | "valid" | "invalid">("idle");
  const [promoLabel, setPromoLabel] = useState<string | null>(null);
  const [promotionCodeId, setPromotionCodeId] = useState<string | null>(null);
  const autoAppliedRef = useRef(false);

  const [activating, setActivating] = useState(success);
  const [activationTimedOut, setActivationTimedOut] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-validate the promo code when arriving via /subscribe?promo=...
  // so the beta user can just click "Subscribe".
  useEffect(() => {
    if (autoAppliedRef.current) return;
    if (!initialPromo) return;
    autoAppliedRef.current = true;
    (async () => {
      setPromoStatus("loading");
      try {
        const res = await fetch("/api/stripe/validate-promo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: initialPromo }),
        });
        const data = await res.json();
        if (res.ok) {
          setPromoStatus("valid");
          setPromoLabel(data.label);
          setPromotionCodeId(data.promotionCodeId);
        } else {
          setPromoStatus("invalid");
        }
      } catch {
        setPromoStatus("invalid");
      }
    })();
  }, [initialPromo]);

  useEffect(() => {
    if (!activating) return;

    const startTime = Date.now();

    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/subscription/me");
        if (res.ok) {
          const data = await res.json();
          // Treat both 'active' (paying) and 'trialing' (in free period) as
          // activated. Both grant full feature access; the dashboard handles
          // the trial banner if needed.
          if (data.status === "active" || data.status === "trialing") {
            if (intervalRef.current) clearInterval(intervalRef.current);
            window.location.href = "/dashboard";
            return;
          }
        }
      } catch {
        // Retry on next interval
      }

      if (Date.now() - startTime > 30000) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setActivationTimedOut(true);
        setActivating(false);
      }
    }, 2000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [activating]);

  async function handlePortalRedirect() {
    setError(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || "Could not open billing portal.");
      }
    } catch {
      setError("Network error. Please try again.");
    }
  }

  async function handleApplyPromo() {
    if (!promoCode.trim()) return;
    setPromoStatus("loading");
    try {
      const res = await fetch("/api/stripe/validate-promo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: promoCode.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setPromoStatus("valid");
        setPromoLabel(data.label);
        setPromotionCodeId(data.promotionCodeId);
      } else {
        setPromoStatus("invalid");
        setPromoLabel(null);
        setPromotionCodeId(null);
      }
    } catch {
      setPromoStatus("invalid");
      setPromoLabel(null);
      setPromotionCodeId(null);
    }
  }

  async function handleSubscribe() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promoCodeId: promotionCodeId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  // Activating state
  if (activating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full bg-white rounded-xl shadow-md p-8 space-y-6 text-center">
          <span className="font-bold text-2xl text-indigo-600">CIAfeeds</span>
          <h1 className="mt-4 text-2xl font-bold text-gray-900">
            Activating your subscription...
          </h1>
          <div className="flex justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
          </div>
          {sessionId && (
            <p className="text-xs text-gray-400">
              Session: {sessionId.slice(0, 20)}...
            </p>
          )}
        </div>
      </div>
    );
  }

  const showStatusBanner =
    !success &&
    currentStatus &&
    ["past_due", "unpaid", "canceled"].includes(currentStatus);

  const statusMessages: Record<string, string> = {
    past_due: "Your last payment failed.",
    unpaid: "Your subscription payment is overdue.",
    canceled: "Your subscription was canceled.",
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full bg-white rounded-xl shadow-md p-8 space-y-6">
        <div className="text-center">
          <span className="font-bold text-2xl text-indigo-600">CIAfeeds</span>
          <h1 className="mt-4 text-2xl font-bold text-gray-900">
            One last step — activate your account
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Subscribe to get full access to your catalog feed and all CIAfeeds features.
          </p>
        </div>

        {showStatusBanner && (
          <div className="rounded-md bg-red-50 border border-red-200 p-4">
            <p className="text-sm text-red-700 font-medium">
              {statusMessages[currentStatus!] ?? "There is an issue with your subscription."}
            </p>
            <button
              type="button"
              onClick={handlePortalRedirect}
              className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-700 underline"
            >
              Update payment method
            </button>
          </div>
        )}

        {canceled && !showStatusBanner && (
          <div className="rounded-md bg-yellow-50 border border-yellow-200 p-4">
            <p className="text-sm text-yellow-800">
              Payment was canceled. You can try again below.
            </p>
          </div>
        )}

        {activationTimedOut && (
          <div className="rounded-md bg-yellow-50 border border-yellow-200 p-4">
            <p className="text-sm text-yellow-800">
              This is taking longer than expected. Refresh or check your inbox for confirmation.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-700 underline"
            >
              Refresh
            </button>
          </div>
        )}

        <div className="flex justify-center">
          <div className="bg-indigo-50 text-indigo-600 font-semibold text-lg px-6 py-3 rounded-lg">
            {priceLabel ?? "Contact us for pricing"}
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex">
            <input
              type="text"
              value={promoCode}
              onChange={(e) => {
                setPromoCode(e.target.value);
                if (promoStatus === "valid") {
                  setPromoStatus("idle");
                  setPromoLabel(null);
                  setPromotionCodeId(null);
                }
              }}
              placeholder="Promo code"
              className="border border-gray-400 bg-white rounded-md px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 flex-1"
            />
            <button
              onClick={handleApplyPromo}
              disabled={promoStatus === "loading" || loading}
              className="ml-2 px-4 py-2 text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Apply
            </button>
          </div>
          {promoStatus === "valid" && (
            <p className="text-sm text-green-600">&#10003; {promoLabel} applied!</p>
          )}
          {promoStatus === "invalid" && (
            <p className="text-sm text-red-600">Invalid or expired promo code.</p>
          )}
          {promoStatus === "loading" && (
            <p className="text-sm text-gray-500">Checking...</p>
          )}
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <button
          onClick={handleSubscribe}
          disabled={loading}
          className="w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Loading..." : "Subscribe with Stripe \u2192"}
        </button>

        <p className="text-center text-xs text-gray-400">
          Secure payment via Stripe. Cancel anytime.
        </p>
      </div>
    </div>
  );
}
