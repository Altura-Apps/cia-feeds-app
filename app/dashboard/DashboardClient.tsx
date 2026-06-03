"use client";

import { useState, useEffect, useRef, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import type { Vehicle } from "@prisma/client";
import { AddVehicleForm } from "./components/AddVehicleForm";
import { VehiclesTable } from "./components/VehiclesTable";
import { AddListingPanel } from "./components/AddListingPanel";
import { ListingsTable } from "./components/ListingsTable";
import { SuccessBanner } from "./components/SuccessBanner";
import { ErrorBanner } from "./components/ErrorBanner";
import { VERTICAL_LABELS, type Vertical } from "@/lib/verticals";
import { SmsCtaCard } from "./components/SmsCtaCard";

type VehicleRow = Vehicle & { scrapeStatus: string };

interface ListingRow {
  id: string;
  title: string;
  price: number | null;
  imageUrls: string[];
  url: string | null;
  isComplete: boolean;
  missingFields: string[];
  data: Record<string, unknown>;
  createdAt: string;
  publishStatus: string;
  urlValidationScore: number | null;
}

// Vehicle data fields (excludes system/metadata fields) used to detect auto-filled values
const VEHICLE_DATA_FIELDS: Array<{ key: keyof Vehicle; label: string }> = [
  { key: "vin", label: "VIN" },
  { key: "make", label: "Make" },
  { key: "model", label: "Model" },
  { key: "year", label: "Year" },
  { key: "bodyStyle", label: "Body Style" },
  { key: "price", label: "Price" },
  { key: "mileageValue", label: "Mileage" },
  { key: "stateOfVehicle", label: "Condition" },
  { key: "exteriorColor", label: "Exterior Color" },
  { key: "imageUrl", label: "Image" },
  { key: "description", label: "Description" },
];

interface SubAccountInfo {
  id: string;
  name: string;
  vertical: string;
  /** Bundle slug when this sub-account is part of a storefront bundle, else null. */
  bundleSlug?: string | null;
}

/**
 * Mirror of lib/storefront.VERTICAL_SEGMENT_SLUGS for client-side use.
 * Keep these two in sync; the lib is server-only.
 */
const SEGMENT_FOR_VERTICAL: Record<string, string> = {
  automotive: "vehicles",
  realestate: "homes",
  services: "services",
  ecommerce: "shop",
};

interface Props {
  vehicles: VehicleRow[];
  listings: ListingRow[];
  dealerName: string;
  dealerSlug: string;
  customDomain: string | null;
  vertical: string;
  isImpersonating?: boolean;
  impersonatedDealerName?: string;
  impersonatedDealerSlug?: string;
  subAccounts?: SubAccountInfo[];
  currentSubAccountId?: string | null;
}

export function DashboardClient({
  vehicles: initialVehicles,
  listings: initialListings,
  dealerName,
  dealerSlug,
  customDomain,
  vertical,
  isImpersonating = false,
  impersonatedDealerName = "",
  impersonatedDealerSlug = "",
  subAccounts = [],
  currentSubAccountId = null,
}: Props) {
  // Resolve the live storefront origin. Prefer the dealer's custom domain
  // when configured, otherwise fall back to the slug-based subdomain.
  const liveSiteOrigin = customDomain
    ? `https://${customDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`
    : dealerSlug
    ? `https://${dealerSlug}.ciafeed.com`
    : null;

  // Resolve the segment for the currently-active sub-account so "View live
  // site" deep-links into the right vertical/bundle page. Multi-vertical
  // dealers were landing on the parent vertical's page regardless of which
  // sub-account they were in — confusing when the parent is automotive but
  // they're working in real estate.
  const currentSubAccount =
    subAccounts.find((s) => s.id === currentSubAccountId) ?? null;
  const segmentForCurrent = currentSubAccount
    ? currentSubAccount.bundleSlug ??
      SEGMENT_FOR_VERTICAL[currentSubAccount.vertical] ??
      null
    : null;
  const liveSiteUrl = liveSiteOrigin
    ? segmentForCurrent
      ? `${liveSiteOrigin}/${segmentForCurrent}`
      : liveSiteOrigin
    : null;
  const liveSiteHomeUrl = liveSiteOrigin;
  const router = useRouter();
  const [vehicles, setVehicles] = useState<VehicleRow[]>(initialVehicles);
  const [listings, setListings] = useState<ListingRow[]>(initialListings);
  const [vdpUrl, setVdpUrl] = useState("");
  const [billingLoading, setBillingLoading] = useState(false);
  const [successInfo, setSuccessInfo] = useState<{
    autoFilledFields: string[];
    missingFields: string[];
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showCreateSubAccount, setShowCreateSubAccount] = useState(false);
  const [newSubName, setNewSubName] = useState("");
  const [newSubVertical, setNewSubVertical] = useState("automotive");
  const [creatingSub, setCreatingSub] = useState(false);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusMapRef = useRef<Map<string, string>>(new Map());

  const isAutomotive = vertical === "automotive";
  const verticalLabel = VERTICAL_LABELS[vertical as Vertical] ?? vertical;

  const VERTICAL_PAGE_TITLES: Record<string, string> = {
    automotive: "Your Vehicles",
    services: "Your Services",
    ecommerce: "Your Products",
    realestate: "Your Listings",
  };

  const VERTICAL_EMPTY_STATES: Record<string, string> = {
    automotive: "No vehicles yet. Paste a VDP URL above to get started.",
    services: "No services yet. Add your first service above.",
    ecommerce: "No products yet. Add your first product above.",
    realestate: "No listings yet. Add your first listing above.",
  };

  // Initialize status map from initial vehicles
  useEffect(() => {
    for (const v of initialVehicles) {
      statusMapRef.current.set(v.id, v.scrapeStatus);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling effect: start/stop interval based on whether pending rows exist
  useEffect(() => {
    if (!isAutomotive) return;

    const hasPending = vehicles.some((v) => v.scrapeStatus === "pending");

    if (hasPending && pollIntervalRef.current === null) {
      pollIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch("/api/vehicles");
          if (!res.ok) return;
          const data = await res.json();
          const fresh: VehicleRow[] = data.vehicles ?? [];

          // Detect transitions
          for (const v of fresh) {
            const prev = statusMapRef.current.get(v.id);
            if (prev === "pending" && v.scrapeStatus === "complete") {
              const autoFilledFields = VEHICLE_DATA_FIELDS
                .filter(({ key }) => {
                  const val = v[key];
                  return val !== null && val !== undefined && val !== "";
                })
                .map(({ label }) => label);
              setSuccessInfo({ autoFilledFields, missingFields: v.missingFields ?? [] });
            } else if (prev === "pending" && v.scrapeStatus === "failed") {
              setErrorMsg(`Scrape failed for ${v.url}. Please try again.`);
            }
            statusMapRef.current.set(v.id, v.scrapeStatus);
          }

          setVehicles(fresh);

          // Stop polling if no pending rows remain
          const stillPending = fresh.some((v) => v.scrapeStatus === "pending");
          if (!stillPending && pollIntervalRef.current !== null) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        } catch {
          // silently ignore poll errors
        }
      }, 3000);
    } else if (!hasPending && pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    return () => {
      // Cleanup on unmount only — don't clear on every render
    };
  }, [vehicles, isAutomotive]);

  // Final cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current !== null) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  async function handleAddVehicle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSuccessInfo(null);
    setErrorMsg(null);

    const tempId = "pending-" + Date.now();
    const submittedUrl = vdpUrl;

    // Immediately append optimistic pending row and clear the input
    const tempRow: VehicleRow = {
      id: tempId,
      url: submittedUrl,
      scrapeStatus: "pending",
      dealerId: "",
      subAccountId: currentSubAccountId ?? null,
      description: null,
      vin: null,
      make: null,
      model: null,
      year: null,
      bodyStyle: null,
      price: null,
      mileageValue: null,
      stateOfVehicle: null,
      exteriorColor: null,
      imageUrl: null,
      images: [],
      spotlightImageUrl: null,
      address: null,
      latitude: null,
      longitude: null,
      msrp: null,
      trim: null,
      drivetrain: null,
      transmission: null,
      fuelType: null,
      isComplete: false,
      missingFields: [],
      archivedAt: null,
      urlStatus: "active",
      urlLastCheckedAt: null,
      urlCheckFailed: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    setVehicles((prev) => [tempRow, ...prev]);
    setVdpUrl("");

    try {
      const res = await fetch("/api/vehicles/from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: submittedUrl }),
      });

      const data = await res.json();

      if (!res.ok) {
        setVehicles((prev) => prev.filter((v) => v.id !== tempId));
        setErrorMsg(data.message || data.error || "Failed to add vehicle.");
        return;
      }

      const { vehicle: returned } = data as { vehicle: { id: string; scrapeStatus: string; url: string } };

      // Replace temp row with real id, keeping pending status.
      statusMapRef.current.set(returned.id, "pending");
      setVehicles((prev) =>
        prev
          .filter((v) => v.id !== returned.id || v.id === tempId)
          .map((v) => (v.id === tempId ? { ...tempRow, id: returned.id, url: returned.url } : v))
      );
    } catch {
      setVehicles((prev) => prev.filter((v) => v.id !== tempId));
      setErrorMsg("Network error. Please try again.");
    }
  }

  async function refreshListings() {
    try {
      // Pass through the active sub-account so /api/listings returns the
      // right inventory for multi-vertical accounts (parent vertical may
      // differ from the active sub-account's vertical).
      const qs = currentSubAccountId
        ? `?subAccountId=${encodeURIComponent(currentSubAccountId)}`
        : "";
      const res = await fetch(`/api/listings${qs}`);
      if (res.ok) {
        const data = await res.json();
        setListings(data.listings ?? []);
      }
    } catch {
      // ignore
    }
  }

  async function handleExitImpersonation() {
    await fetch("/api/admin/impersonate", { method: "DELETE" });
    window.location.href = "/admin";
  }

  async function handleCreateSubAccount() {
    if (!newSubName.trim()) return;
    setCreatingSub(true);
    try {
      const res = await fetch("/api/subaccounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newSubName.trim(), vertical: newSubVertical }),
      });
      if (res.ok) {
        const data = await res.json();
        setShowCreateSubAccount(false);
        setNewSubName("");
        setNewSubVertical("automotive");
        router.push(`/dashboard?subAccountId=${data.subAccount.id}`);
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error || "Failed to create sub-account.");
      }
    } catch {
      setErrorMsg("Network error. Please try again.");
    } finally {
      setCreatingSub(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Impersonation banner */}
      {isImpersonating && (
        <div className="bg-amber-100 border-b-2 border-amber-400 px-6 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="bg-amber-400 text-white text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full">
              Impersonating
            </span>
            <span className="text-amber-900 text-sm font-medium">
              You are viewing the dashboard as{" "}
              <strong>{impersonatedDealerName}</strong>
              {impersonatedDealerSlug && ` (${impersonatedDealerSlug})`}
            </span>
          </div>
          <button
            onClick={handleExitImpersonation}
            className="bg-amber-900 text-white text-[13px] font-semibold px-3.5 py-1.5 rounded-md hover:bg-amber-800"
          >
            Exit Impersonation &rarr; Back to Admin
          </button>
        </div>
      )}

      {/* Top bar */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-bold text-lg text-gray-900">CIAfeeds</span>
            <span className="bg-indigo-50 text-indigo-600 text-xs font-semibold px-2 py-0.5 rounded-full">
              {verticalLabel}
            </span>
            {subAccounts.length > 1 && (
              <select
                value={currentSubAccountId ?? ""}
                onChange={(e) => router.push(`/dashboard?subAccountId=${e.target.value}`)}
                className="border border-gray-300 bg-white rounded-md px-2 py-1 text-sm text-gray-900 font-medium placeholder:text-gray-500 placeholder:font-normal focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                {subAccounts.map((sa) => (
                  <option key={sa.id} value={sa.id} className="text-gray-900 font-medium">
                    {sa.name} ({sa.vertical})
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => setShowCreateSubAccount(true)}
              className="text-xs text-indigo-600 hover:text-indigo-500 font-medium"
            >
              + Sub-Account
            </button>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">{dealerName}</span>
            {liveSiteUrl && (
              <div className="inline-flex items-stretch gap-px rounded-md overflow-hidden border border-emerald-200 bg-emerald-50">
                <a
                  href={liveSiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Open ${liveSiteUrl} in a new tab`}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 px-2.5 py-1"
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 rounded-full bg-emerald-500"
                  />
                  View live site
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-3.5 w-3.5 opacity-70"
                    aria-hidden="true"
                  >
                    <path d="M11 3a1 1 0 100 2h2.586L8.293 10.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                    <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                  </svg>
                </a>
                {liveSiteHomeUrl && liveSiteUrl !== liveSiteHomeUrl && (
                  <a
                    href={liveSiteHomeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Open the catalog landing page (${liveSiteHomeUrl})`}
                    className="inline-flex items-center text-xs font-medium text-emerald-700 hover:bg-emerald-100 px-2 border-l border-emerald-200"
                  >
                    Home
                  </a>
                )}
              </div>
            )}
            <Link href="/dashboard/inbox" className="text-sm text-indigo-600 hover:text-indigo-500">
              Inbox
            </Link>
            <Link href="/dashboard/retargeting" className="text-sm text-indigo-600 hover:text-indigo-500">
              Retargeting
            </Link>
            <Link href="/dashboard/profile" className="text-sm text-indigo-600 hover:text-indigo-500">
              Profile
            </Link>
            {!isImpersonating && (
              <button
                onClick={async () => {
                  setBillingLoading(true);
                  const res = await fetch("/api/stripe/portal", { method: "POST" });
                  const data = await res.json();
                  if (res.ok && data.url) {
                    window.location.href = data.url;
                  } else {
                    setBillingLoading(false);
                  }
                }}
                disabled={billingLoading}
                className="text-sm text-indigo-600 hover:text-indigo-500"
              >
                {billingLoading ? "Loading\u2026" : "Manage Billing"}
              </button>
            )}
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-sm text-indigo-600 hover:text-indigo-500"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Click-to-SMS CTA — only renders when SMS is configured in env. */}
        {process.env.NEXT_PUBLIC_SMS_NUMBER && (
          <div className="mb-6">
            <SmsCtaCard
              smsNumber={process.env.NEXT_PUBLIC_SMS_NUMBER}
              dealerVertical={vertical}
            />
          </div>
        )}

        {/* Page header */}
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-2xl font-bold text-gray-900">
            {VERTICAL_PAGE_TITLES[vertical] ?? "Your Listings"}
          </h1>
          <div className="flex items-center gap-4">
            {(vertical === "automotive" || vertical === "ecommerce") && (
              <Link
                href="/dashboard/crawl"
                className="text-sm text-indigo-600 hover:text-indigo-500"
              >
                Crawl Website
              </Link>
            )}
            <Link
              href="/dashboard/feed"
              className="text-sm text-indigo-600 hover:text-indigo-500"
            >
              View Feed URL
            </Link>
          </div>
        </div>

        {/* Add form — vertical-aware */}
        <div className="mb-6">
          {isAutomotive ? (
            <AddVehicleForm
              url={vdpUrl}
              onChange={setVdpUrl}
              onSubmit={handleAddVehicle}
              isLoading={false}
            />
          ) : (
            <AddListingPanel
              vertical={vertical as Vertical}
              subAccountId={currentSubAccountId ?? null}
              onListingAdded={refreshListings}
            />
          )}
        </div>

        {/* Status banners */}
        {successInfo && (
          <div className="mb-4">
            <SuccessBanner
              autoFilledFields={successInfo.autoFilledFields}
              missingFields={successInfo.missingFields}
            />
          </div>
        )}
        {errorMsg && (
          <div className="mb-4">
            <ErrorBanner message={errorMsg} />
          </div>
        )}

        {/* Inventory table — vertical-aware */}
        {isAutomotive ? (
          vehicles.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-8 text-center">
              <p className="text-gray-500 text-sm">
                No vehicles yet. Paste a VDP URL above to get started.
              </p>
            </div>
          ) : (
            <VehiclesTable vehicles={vehicles} />
          )
        ) : (
          listings.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-8 text-center">
              <p className="text-gray-500 text-sm">
                {VERTICAL_EMPTY_STATES[vertical] ?? `No listings yet. Add your first ${verticalLabel.toLowerCase()} listing above.`}
              </p>
            </div>
          ) : (
            <ListingsTable listings={listings} vertical={vertical} onDelete={refreshListings} />
          )
        )}
      </div>

      {/* Create SubAccount modal */}
      {showCreateSubAccount && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-[400px] w-full mx-4">
            <h3 className="text-base font-bold text-gray-900 mb-4">Create Sub-Account</h3>
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={newSubName}
                onChange={(e) => setNewSubName(e.target.value)}
                placeholder="e.g. My Auto Shop (automotive)"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-700 mb-1">Vertical</label>
              <select
                value={newSubVertical}
                onChange={(e) => setNewSubVertical(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="automotive">Automotive</option>
                <option value="services">Services</option>
                <option value="ecommerce">E-Commerce</option>
                <option value="realestate">Real Estate</option>
              </select>
            </div>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => { setShowCreateSubAccount(false); setNewSubName(""); }}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateSubAccount}
                disabled={creatingSub || !newSubName.trim()}
                className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
              >
                {creatingSub ? "Creating\u2026" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
