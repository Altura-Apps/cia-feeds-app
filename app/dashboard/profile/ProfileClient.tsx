"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { API_SUPPORTED_VERTICALS } from "@/lib/verticals";
import MetaDeliveryStatusCard from "./MetaDeliveryStatusCard";

const CTA_OPTIONS = [
  { value: "", label: "Auto", icon: "🔄", desc: "Show all available contact options" },
  { value: "sms", label: "SMS", icon: "💬", desc: "Text message link" },
  { value: "whatsapp", label: "WhatsApp", icon: "📱", desc: "Opens WhatsApp chat" },
  { value: "messenger", label: "Messenger", icon: "💙", desc: "Opens Facebook Messenger" },
  { value: "ai_chat", label: "AI Chat (recommended)", icon: "🤖", desc: "Bilingual AI assistant captures leads on your storefront" },
] as const;

const AI_CHAT_LOCALE_OPTIONS = [
  { value: "auto", label: "Auto-detect", desc: "Use the visitor's browser language or storefront path" },
  { value: "en", label: "English", desc: "Always start in English" },
  { value: "es", label: "Spanish", desc: "Always start in Spanish" },
] as const;

const LANG_OPTIONS = [
  { value: "en", label: "English" },
  { value: "es-MX", label: "Mexican Spanish" },
  { value: "es-PR", label: "Puerto Rican Spanish" },
  { value: "pt-BR", label: "Brazilian Portuguese" },
  { value: "ko-KR", label: "Korean" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
] as const;

const TONE_OPTIONS = [
  { value: "professional", label: "Professional" },
  { value: "funny", label: "Funny" },
  { value: "luxury", label: "Luxury" },
] as const;

const VERTICALS = [
  { id: "automotive", icon: "\u{1F697}", title: "Automotive", desc: "Vehicle listings" },
  { id: "services", icon: "\u{1F527}", title: "Services", desc: "Local service businesses" },
  { id: "realestate", icon: "\u{1F3E0}", title: "Real Estate", desc: "Property listings for sale or rent" },
] as const;

interface TeamMember {
  id: string;
  email: string;
  name: string | null;
  role: string;
  subAccountId: string | null;
  invitedAt: string;
  acceptedAt: string | null;
  subAccount: { name: string } | null;
  passwordSet: boolean;
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  subAccountId: string | null;
  createdAt: string;
  expiresAt: string;
}

interface SubAccountItem {
  id: string;
  name: string;
  vertical: string;
  createdAt: string;
}

interface Props {
  slug: string;
  profileImageUrl: string | null;
  currentVertical: string;
  websiteUrl: string | null;
  address: string | null;
  phone: string | null;
  ctaPreference: string | null;
  translationLang: string;
  translationTone: string;
  fbPageId: string | null;
  isMetaConnected: boolean;
  metaCatalogId: string | null;
  metaFeedId: string | null;
  metaPixelId: string | null;
  metaDeliveryMethod: string;
  subAccounts?: SubAccountItem[];
  isImpersonating?: boolean;
  isEditor?: boolean;
  /** Server-rendered Storefront Bundle manager. Slotted under Sub-Accounts. */
  bundleManager?: ReactNode;
}

type MetaStep =
  | "idle"
  | "pages"
  | "businesses"
  | "catalogs"
  | "feed"
  | "done";

export default function ProfileClient({
  slug,
  profileImageUrl: initialPhotoUrl,
  currentVertical: initialVertical,
  websiteUrl: initialWebsiteUrl,
  address: initialAddress,
  phone: initialPhone,
  ctaPreference: initialCtaPreference,
  translationLang: initialTranslationLang,
  translationTone: initialTranslationTone,
  fbPageId: initialFbPageId,
  isMetaConnected: initialIsMetaConnected,
  metaCatalogId: initialMetaCatalogId,
  metaFeedId: initialMetaFeedId,
  metaPixelId: initialMetaPixelId,
  metaDeliveryMethod: initialDeliveryMethod,
  subAccounts: initialSubAccounts = [],
  isImpersonating = false,
  isEditor = false,
  bundleManager,
}: Props) {
  const router = useRouter();
  const [photoUrl, setPhotoUrl] = useState<string | null>(initialPhotoUrl);
  const vertical = initialVertical;
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [siteUrl, setSiteUrl] = useState(initialWebsiteUrl ?? "");
  const [savingSiteUrl, setSavingSiteUrl] = useState(false);
  const [siteUrlSaved, setSiteUrlSaved] = useState(false);

  const [dealerAddress, setDealerAddress] = useState(initialAddress ?? "");
  const [savingAddress, setSavingAddress] = useState(false);
  const [addressSaved, setAddressSaved] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [addressLat, setAddressLat] = useState<number | null>(null);
  const [addressLng, setAddressLng] = useState<number | null>(null);

  const [phone, setPhone] = useState(initialPhone ?? "");
  const [savingPhone, setSavingPhone] = useState(false);
  const [phoneSaved, setPhoneSaved] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const [ctaPref, setCtaPref] = useState(initialCtaPreference ?? "");
  const [savingCta, setSavingCta] = useState(false);
  const [ctaSaved, setCtaSaved] = useState(false);
  const [ctaError, setCtaError] = useState<string | null>(null);

  const [translationLang, setTranslationLang] = useState(initialTranslationLang);
  const [translationTone, setTranslationTone] = useState(initialTranslationTone);
  const [savingTranslation, setSavingTranslation] = useState(false);
  const [translationSaved, setTranslationSaved] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);

  // Meta Business Integration wizard state
  const [isMetaConnected, setIsMetaConnected] = useState(initialIsMetaConnected);
  const [metaFeedId, setMetaFeedId] = useState<string | null>(initialMetaFeedId);
  const [metaCatalogId, setMetaCatalogId] = useState<string | null>(initialMetaCatalogId);
  const [fbPageId, setFbPageId] = useState<string | null>(initialFbPageId);
  const [metaStep, setMetaStep] = useState<MetaStep>(
    initialMetaFeedId ? "done" : "idle"
  );
  const [pages, setPages] = useState<{ id: string; name: string }[]>([]);
  const [selectedPageId, setSelectedPageId] = useState(initialFbPageId ?? "");
  const [businesses, setBusinesses] = useState<{ id: string; name: string }[]>([]);
  const [selectedBmId, setSelectedBmId] = useState("");
  const [catalogs, setCatalogs] = useState<{ id: string; name: string }[]>([]);
  const [selectedCatalogId, setSelectedCatalogId] = useState("");
  const [newCatalogName, setNewCatalogName] = useState("");
  const [metaError, setMetaError] = useState<string | null>(null);
  const [metaTosRequired, setMetaTosRequired] = useState(false);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaMode, setMetaMode] = useState<"existing" | "new">("existing");
  const [disconnecting, setDisconnecting] = useState(false);
  const [businessSkipped, setBusinessSkipped] = useState(false);

  const [pixelId, setPixelId] = useState(initialMetaPixelId ?? "");
  const [savingPixelId, setSavingPixelId] = useState(false);
  const [pixelIdSaved, setPixelIdSaved] = useState(false);
  const [pixelIdError, setPixelIdError] = useState<string | null>(null);

  const [deliveryMethod, setDeliveryMethod] = useState(initialDeliveryMethod);
  const [savingDelivery, setSavingDelivery] = useState(false);
  const [deliverySaved, setDeliverySaved] = useState(false);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);

  // SubAccounts state
  const [subAccountsList, setSubAccountsList] = useState<SubAccountItem[]>(initialSubAccounts);
  const [newSubName, setNewSubName] = useState("");
  const [newSubVertical, setNewSubVertical] = useState("automotive");
  const [creatingSub, setCreatingSub] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);
  const [showCreateSub, setShowCreateSub] = useState(false);
  const [editingSubAccountId, setEditingSubAccountId] = useState<string | null>(null);
  const [editNewVertical, setEditNewVertical] = useState("automotive");
  const [resettingSub, setResettingSub] = useState(false);

  // Billing state
  const [billingStatus, setBillingStatus] = useState<string | null>(null);
  const [billingPriceLabel, setBillingPriceLabel] = useState<string | null>(null);
  const [billingPeriodEnd, setBillingPeriodEnd] = useState<string | null>(null);
  const [billingHasCustomer, setBillingHasCustomer] = useState(false);
  const [billingIsImpersonating, setBillingIsImpersonating] = useState(false);
  const [billingLoading, setBillingLoading] = useState(true);
  const [billingPortalLoading, setBillingPortalLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);

  // Team Members state
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("editor");
  const [inviteSubAccountId, setInviteSubAccountId] = useState("");
  const [inviting, setInviting] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamSuccess, setTeamSuccess] = useState<string | null>(null);

  async function loadTeamMembers() {
    setTeamLoading(true);
    try {
      const res = await fetch("/api/team/members");
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTeamMembers(data.members || []);
        setPendingInvites(data.pendingInvites || []);
      }
    } catch {
      // silent
    } finally {
      setTeamLoading(false);
    }
  }

  async function handleInvite() {
    if (!inviteEmail.trim()) {
      setTeamError("Email is required.");
      return;
    }
    setInviting(true);
    setTeamError(null);
    setTeamSuccess(null);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
          subAccountId: inviteSubAccountId || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const messages: Record<string, string> = {
          cannot_invite_self: "You cannot invite yourself.",
          already_team_member: "This person is already a team member.",
          invalid_email: "Please enter a valid email address.",
          invalid_role: "Please select a valid role.",
          invalid_sub_account: "Invalid sub-account selected.",
        };
        setTeamError(messages[data.error] || data.error || "Failed to send invite.");
        return;
      }
      setTeamSuccess(`Invite sent to ${inviteEmail.trim()}`);
      setInviteEmail("");
      setInviteRole("editor");
      setInviteSubAccountId("");
      setShowInviteForm(false);
      await loadTeamMembers();
    } catch {
      setTeamError("Network error. Please try again.");
    } finally {
      setInviting(false);
    }
  }

  async function handleRemoveMember(memberId: string) {
    setTeamError(null);
    try {
      const res = await fetch(`/api/team/members?id=${memberId}`, { method: "DELETE" });
      if (res.ok) {
        setTeamMembers((prev) => prev.filter((m) => m.id !== memberId));
      }
    } catch {
      setTeamError("Failed to remove member.");
    }
  }

  async function handleCancelInvite(inviteId: string) {
    setTeamError(null);
    try {
      const res = await fetch(`/api/team/members?inviteId=${inviteId}`, { method: "DELETE" });
      if (res.ok) {
        setPendingInvites((prev) => prev.filter((i) => i.id !== inviteId));
      }
    } catch {
      setTeamError("Failed to cancel invite.");
    }
  }

  async function handleResendInvite(payload: { memberId?: string; inviteId?: string }, email: string) {
    setTeamError(null);
    setTeamSuccess(null);
    try {
      const res = await fetch("/api/team/invite/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setTeamSuccess(`New invite sent to ${email}`);
        await loadTeamMembers();
      } else {
        const data = await res.json().catch(() => ({}));
        setTeamError(data.error === "already_active" ? "This member already has an active account." : "Failed to resend invite.");
      }
    } catch {
      setTeamError("Network error. Please try again.");
    }
  }

  async function loadSubAccounts() {
    try {
      const res = await fetch("/api/subaccounts");
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSubAccountsList(data.subAccounts || []);
      }
    } catch {
      // silent
    }
  }

  async function resetSubAccount(id: string, newVertical: string) {
    setResettingSub(true);
    setSubError(null);
    try {
      const res = await fetch(`/api/subaccounts/${id}/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vertical: newVertical }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSubError(data.error || "Failed to reset sub-account.");
        return;
      }
      setEditingSubAccountId(null);
      await loadSubAccounts();
    } catch {
      setSubError("Network error. Please try again.");
    } finally {
      setResettingSub(false);
    }
  }

  async function loadBilling() {
    setBillingLoading(true);
    try {
      const res = await fetch("/api/subscription/me");
      if (res.ok) {
        const data = await res.json();
        setBillingStatus(data.status);
        setBillingPriceLabel(data.priceLabel);
        setBillingPeriodEnd(data.currentPeriodEnd);
        setBillingHasCustomer(data.hasCustomer);
        setBillingIsImpersonating(data.isImpersonating ?? false);
      }
    } catch {
      // silent
    } finally {
      setBillingLoading(false);
    }
  }

  async function handleBillingPortal() {
    setBillingPortalLoading(true);
    setBillingError(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        setBillingError(data.error || "Could not open billing portal.");
      }
    } catch {
      setBillingError("Network error. Please try again.");
    } finally {
      setBillingPortalLoading(false);
    }
  }

  // Load team members and billing on mount
  useEffect(() => {
    loadTeamMembers();
    loadBilling();
  }, []);

  async function handleDisconnect(): Promise<boolean> {
    setDisconnecting(true);
    setMetaError(null);
    try {
      const res = await fetch("/api/fb/disconnect", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMetaError(data.error || "Failed to disconnect Meta.");
        return false;
      }
      // Reset all Meta UI state on success
      setIsMetaConnected(false);
      setMetaFeedId(null);
      setMetaCatalogId(null);
      setFbPageId(null);
      setMetaStep("idle");
      setPages([]);
      setBusinesses([]);
      setCatalogs([]);
      setSelectedPageId("");
      setSelectedBmId("");
      setSelectedCatalogId("");
      setNewCatalogName("");
      setMetaError(null);
      setMetaTosRequired(false);
      setBusinessSkipped(false);
      return true;
    } catch {
      setMetaError("Network error. Please try again.");
      return false;
    } finally {
      setDisconnecting(false);
    }
  }

  async function loadPages() {
    console.log("[Meta Wizard] loadPages — starting");
    setMetaLoading(true);
    setMetaError(null);
    try {
      const res = await fetch("/api/fb/pages");
      const data = await res.json().catch(() => ({}));
      console.log("[Meta Wizard] loadPages — response status:", res.status, "pages count:", (data.pages || []).length);
      if (!res.ok) {
        setMetaError(data.error || "Failed to load Facebook Pages.");
        return;
      }
      setPages(data.pages || []);
      setMetaStep("pages");
      console.log("[Meta Wizard] metaStep -> pages");
    } catch {
      setMetaError("Network error. Please try again.");
    } finally {
      setMetaLoading(false);
    }
  }

  async function submitPage() {
    if (!selectedPageId) {
      setMetaError("Please pick a Facebook Page.");
      return;
    }
    setMetaLoading(true);
    setMetaError(null);
    try {
      const res = await fetch("/api/fb/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId: selectedPageId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMetaError(data.error || "Failed to save Facebook Page.");
        return;
      }
      setFbPageId(data.pageId);
      await loadBusinesses();
    } catch {
      setMetaError("Network error. Please try again.");
    } finally {
      setMetaLoading(false);
    }
  }

  async function loadBusinesses() {
    setMetaLoading(true);
    setMetaError(null);
    try {
      const res = await fetch("/api/fb/businesses");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMetaError(data.error || "Failed to load businesses.");
        return;
      }
      setBusinesses(data.businesses || []);
      setMetaStep("businesses");
    } catch {
      setMetaError("Network error. Please try again.");
    } finally {
      setMetaLoading(false);
    }
  }

  async function loadCatalogs(businessId: string) {
    setMetaLoading(true);
    setMetaError(null);
    try {
      const res = await fetch(`/api/fb/catalogs?businessId=${encodeURIComponent(businessId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMetaError(data.error || "Failed to load catalogs.");
        return;
      }
      setCatalogs(data.catalogs || []);
      setMetaStep("catalogs");
    } catch {
      setMetaError("Network error. Please try again.");
    } finally {
      setMetaLoading(false);
    }
  }

  async function submitCatalog() {
    setMetaLoading(true);
    setMetaError(null);
    setMetaTosRequired(false);
    try {
      const body: Record<string, string> = { businessId: selectedBmId };
      if (metaMode === "existing") {
        if (!selectedCatalogId) {
          setMetaError("Please pick a catalog.");
          return;
        }
        body.catalogId = selectedCatalogId;
      } else {
        if (!newCatalogName.trim()) {
          setMetaError("Please enter a catalog name.");
          return;
        }
        body.catalogName = newCatalogName.trim();
      }
      const res = await fetch("/api/fb/catalogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "catalog_tos_required") {
          setMetaTosRequired(true);
          setMetaError(
            "Meta requires you to accept the Commerce terms before a catalog can be created."
          );
          return;
        }
        setMetaError(
          data.detail ? `Meta error: ${data.detail}` : (data.error || "Failed to save catalog.")
        );
        return;
      }
      setMetaCatalogId(data.catalogId);
      setMetaStep("feed");
    } catch {
      setMetaError("Network error. Please try again.");
    } finally {
      setMetaLoading(false);
    }
  }

  async function publishFeed() {
    setMetaLoading(true);
    setMetaError(null);
    try {
      const res = await fetch("/api/fb/feed", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const feedErrorMessages: Record<string, string> = {
          add_items_first: "Please add at least one item to your inventory before registering a feed.",
          meta_not_connected: "Please connect your Meta account first.",
          catalog_not_selected: "Please select a catalog before registering a feed.",
        };
        setMetaError(
          feedErrorMessages[data.error]
            || (data.detail ? `Meta error: ${data.detail}` : (data.error || "Failed to register feed."))
        );
        return;
      }
      setMetaFeedId(data.feedId);
      setMetaStep("done");
    } catch {
      setMetaError("Network error. Please try again.");
    } finally {
      setMetaLoading(false);
    }
  }

  function resetWizard() {
    setMetaStep("idle");
    setMetaError(null);
    setMetaTosRequired(false);
    setBusinessSkipped(false);
    setPages([]);
    setBusinesses([]);
    setCatalogs([]);
    setSelectedPageId(initialFbPageId ?? "");
    setSelectedBmId("");
    setSelectedCatalogId("");
    setNewCatalogName("");
  }

  // On mount — if the query param says we just connected, auto-load Pages so
  // the user can explicitly select which Facebook Page to bind to fb_page_id.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fbParam = params.get("fb");
    console.log("[Meta Wizard] mount effect — fb param:", fbParam, "initialMetaFeedId:", initialMetaFeedId);
    if (fbParam === "connected") {
      console.log("[Meta Wizard] fb=connected detected — resetting wizard and loading pages unconditionally");
      setIsMetaConnected(true);
      // Always restart the wizard from pages step — regardless of whether a
      // feed already exists. This lets `?fb=connected` act as a forced
      // recovery/restart mechanism for already-connected users too.
      resetWizard();
      loadPages();
      // Clean the URL so a refresh doesn't re-trigger the wizard.
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, "", cleanUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup on unmount/backout — reset wizard state so re-entry always lands
  // on idle/Continue Setup for incomplete setups (prevents frozen-button UX).
  useEffect(() => {
    return () => {
      console.log("[Meta Wizard] unmount — resetting wizard state");
      setMetaStep("idle");
      setMetaError(null);
      setMetaTosRequired(false);
      setMetaLoading(false);
      setPages([]);
      setBusinesses([]);
      setCatalogs([]);
      setSelectedPageId(initialFbPageId ?? "");
      setSelectedBmId("");
      setSelectedCatalogId("");
      setNewCatalogName("");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showWebsiteUrl = vertical === "automotive";

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setUploading(true);
    setError(null);

    const fd = new FormData();
    fd.append("file", file);

    try {
      const res = await fetch("/api/profile/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Upload failed.");
        return;
      }
      const data = await res.json();
      setPhotoUrl(data.profileImageUrl);
    } catch {
      setError("Network error during upload. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileImageUrl: null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Remove failed.");
        return;
      }
      setPhotoUrl(null);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-screen-xl mx-auto px-6 py-3 flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-indigo-500 hover:text-indigo-600">
            &larr; Dashboard
          </Link>
          <span className="font-bold text-lg text-gray-900">CIAfeeds</span>
        </div>
      </div>

      <div className="max-w-[560px] mx-auto px-6 py-8">
        <h1 className="text-xl font-bold text-gray-900 mb-6">Profile &amp; Settings</h1>

        {billingStatus && ["past_due", "unpaid", "canceled"].includes(billingStatus) && (
          <div className="rounded-md bg-red-50 p-3 mb-4">
            <p className="text-sm text-red-600 font-medium">
              {billingStatus === "past_due" && "Your last payment failed."}
              {billingStatus === "unpaid" && "Your subscription payment is overdue."}
              {billingStatus === "canceled" && "Your subscription was canceled."}
            </p>
            {!isImpersonating && (
              <button
                type="button"
                onClick={handleBillingPortal}
                disabled={billingPortalLoading}
                className="mt-1 text-sm font-medium text-indigo-600 hover:text-indigo-700 underline disabled:opacity-50"
              >
                Update payment method
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-md bg-red-50 p-3 mb-4">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Profile Photo */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">
            Profile Photo
          </h2>

          <div className="mb-4">
            {photoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={photoUrl}
                alt="Sales manager profile"
                style={{ width: 100, height: 140, objectFit: "cover", borderRadius: 8, display: "block" }}
              />
            ) : (
              <div
                style={{
                  width: 100, height: 140, borderRadius: 8,
                  border: "2px dashed #d1d5db",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  backgroundColor: "#f9fafb",
                }}
              >
                <span className="text-xs text-gray-400 text-center px-2">Full-body photo here</span>
              </div>
            )}
          </div>

          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full border-2 border-dashed border-indigo-400 text-indigo-600 rounded-md py-2 text-sm cursor-pointer hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed mb-2"
          >
            {uploading ? "Uploading\u2026" : "Upload Photo"}
          </button>

          {photoUrl && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={removing}
              className="w-full border border-red-300 text-red-600 bg-white rounded-md py-2 text-sm cursor-pointer hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed mb-2"
            >
              {removing ? "Removing\u2026" : "Remove Photo"}
            </button>
          )}

          <p className="text-xs text-gray-400 mt-2">
            Best results: standing pose, plain background, good lighting. Max 5 MB.
          </p>
        </div>

        {/* Billing */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">
            Billing
          </h2>
          {billingLoading ? (
            <p className="text-xs text-gray-400">Loading billing info...</p>
          ) : !billingHasCustomer ? (
            <div>
              <p className="text-sm text-gray-500 mb-2">No billing account set up yet.</p>
              <a
                href="/subscribe"
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700 underline"
              >
                Set up billing
              </a>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-500">Status:</span>
                <span
                  className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                    billingStatus === "active"
                      ? "bg-green-100 text-green-800"
                      : billingStatus === "past_due" || billingStatus === "unpaid"
                        ? "bg-red-100 text-red-800"
                        : billingStatus === "canceled"
                          ? "bg-gray-100 text-gray-600"
                          : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {billingStatus === "active" && "Active"}
                  {billingStatus === "past_due" && "Past Due"}
                  {billingStatus === "unpaid" && "Unpaid"}
                  {billingStatus === "canceled" && "Canceled"}
                  {!billingStatus && "Unknown"}
                  {billingStatus && !["active", "past_due", "unpaid", "canceled"].includes(billingStatus) && billingStatus}
                </span>
              </div>
              {billingPriceLabel && (
                <div>
                  <span className="text-xs font-medium text-gray-500">Plan:</span>{" "}
                  <span className="text-sm text-gray-900">{billingPriceLabel}</span>
                </div>
              )}
              {billingPeriodEnd && (
                <div>
                  <span className="text-xs font-medium text-gray-500">Renews on:</span>{" "}
                  <span className="text-sm text-gray-900">
                    {new Date(billingPeriodEnd).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
              )}
              {isImpersonating || billingIsImpersonating ? (
                <p className="text-xs text-gray-400">
                  Billing actions disabled while impersonating.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={handleBillingPortal}
                  disabled={billingPortalLoading}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
                >
                  {billingPortalLoading ? "Loading..." : "Manage Billing"}
                </button>
              )}
              {billingError && (
                <p className="text-xs text-red-600">{billingError}</p>
              )}
            </div>
          )}
        </div>

        {/* Business Address — visible for all verticals */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
            Business Address
          </h2>
          <p className="text-xs text-gray-400 mb-4">
            Your address is geocoded and used in your Meta feed.
          </p>
          <div className="flex gap-2.5">
            <input
              data-element-id="business-address-input"
              type="text"
              className="flex-1 border border-gray-400 bg-white rounded-md px-3 py-2 text-sm placeholder:text-gray-500 placeholder:font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="1875 Buford Highway, Cumming, GA 30041"
              value={dealerAddress}
              onChange={(e) => {
                setDealerAddress(e.target.value);
                setAddressSaved(false);
                setAddressError(null);
              }}
            />
            <button
              type="button"
              disabled={savingAddress}
              onClick={async () => {
                setSavingAddress(true);
                setAddressError(null);
                setAddressSaved(false);
                setAddressLat(null);
                setAddressLng(null);
                try {
                  const res = await fetch("/api/profile", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ address: dealerAddress.trim() || null }),
                  });
                  if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    setAddressError(
                      data.error === "geocoding_failed"
                        ? "Could not geocode that address. Please try a more specific address."
                        : data.error || "Failed to save address."
                    );
                    return;
                  }
                  const data = await res.json().catch(() => ({}));
                  setAddressSaved(true);
                  if (data?.dealer?.latitude != null && data?.dealer?.longitude != null) {
                    setAddressLat(data.dealer.latitude);
                    setAddressLng(data.dealer.longitude);
                  }
                } catch {
                  setAddressError("Network error. Please try again.");
                } finally {
                  setSavingAddress(false);
                }
              }}
              className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
            >
              {savingAddress ? "Saving\u2026" : "Save"}
            </button>
          </div>
          {addressSaved && (
            <p className="text-xs text-green-600 mt-2">Address saved &amp; geocoded.</p>
          )}
          {addressSaved && addressLat != null && addressLng != null && (
            <p className="text-xs text-gray-400 mt-1">
              {"\u{1F4CD}"} {addressLat.toFixed(3)}, {addressLng.toFixed(3)}
            </p>
          )}
          {addressError && (
            <p className="text-xs text-red-600 mt-2">{addressError}</p>
          )}
        </div>

        {/* Business Phone */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
            Business Phone
          </h2>
          <p className="text-xs text-gray-400 mb-3">
            Your phone number is used for SMS contact in your catalog widget.
          </p>
          <div className="flex gap-2.5">
            <input
              type="tel"
              data-element-id="business-phone-input"
              placeholder="(770) 555-1234"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setPhoneSaved(false);
                setPhoneError(null);
              }}
              className="flex-1 border border-gray-400 bg-white rounded-md px-3 py-2 text-sm placeholder:text-gray-500 placeholder:font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <button
              type="button"
              disabled={savingPhone}
              onClick={async () => {
                setSavingPhone(true);
                setPhoneSaved(false);
                setPhoneError(null);
                try {
                  const res = await fetch("/api/profile", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ phone: phone.trim() || null }),
                  });
                  if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    setPhoneError(
                      data.error === "invalid_phone"
                        ? "Please enter a valid phone number."
                        : data.error || "Failed to save phone number."
                    );
                    return;
                  }
                  setPhoneSaved(true);
                } catch {
                  setPhoneError("Network error. Please try again.");
                } finally {
                  setSavingPhone(false);
                }
              }}
              className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
            >
              {savingPhone ? "Saving\u2026" : "Save"}
            </button>
          </div>
          {phoneSaved && (
            <p className="text-xs text-green-600 mt-2">Phone number saved.</p>
          )}
          {phoneError && (
            <p className="text-xs text-red-600 mt-2">{phoneError}</p>
          )}
        </div>

        {/* Contact Button Preference */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
            Contact Button Preference
          </h2>
          <p className="text-xs text-gray-400 mb-4">
            Choose how customers contact you from the catalog embed widget.
          </p>
          <div className="space-y-2">
            {CTA_OPTIONS.map((opt) => {
              const selected = ctaPref === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={savingCta}
                  onClick={async () => {
                    if (ctaPref === opt.value) return;
                    const prev = ctaPref;
                    setCtaPref(opt.value);
                    setCtaSaved(false);
                    setCtaError(null);
                    setSavingCta(true);
                    try {
                      const res = await fetch("/api/profile", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ ctaPreference: opt.value || null }),
                      });
                      if (!res.ok) {
                        const data = await res.json().catch(() => ({}));
                        setCtaError(data.error ?? "Failed to save preference.");
                        setCtaPref(prev);
                        return;
                      }
                      setCtaSaved(true);
                    } catch {
                      setCtaError("Network error. Please try again.");
                      setCtaPref(prev);
                    } finally {
                      setSavingCta(false);
                    }
                  }}
                  className={`w-full flex items-center gap-3 border rounded-lg px-4 py-3 text-left transition-colors ${
                    selected
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-gray-200 hover:border-indigo-300"
                  } disabled:opacity-50`}
                >
                  <span className="text-xl">{opt.icon}</span>
                  <div className="flex-1">
                    <span className="text-sm font-semibold text-gray-800">{opt.label}</span>
                    <p className="text-xs text-gray-500">{opt.desc}</p>
                  </div>
                  {selected && (
                    <span className="text-indigo-600 text-sm font-medium">✓</span>
                  )}
                </button>
              );
            })}
          </div>
          {(ctaPref === "sms" || ctaPref === "whatsapp") && !phone && (
            <p className="text-xs text-amber-600 mt-3">
              Add a phone number above for this option to work.
            </p>
          )}
          {ctaPref === "messenger" && !fbPageId && (
            <p className="text-xs text-amber-600 mt-3">
              Connect Meta below for Messenger to work.
            </p>
          )}
          {ctaSaved && (
            <p className="text-xs text-green-600 mt-2">Preference saved.</p>
          )}
          {ctaError && (
            <p className="text-xs text-red-600 mt-2">{ctaError}</p>
          )}
        </div>

        {/* Translation Settings */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
            Translation Settings
          </h2>
          <p className="text-xs text-gray-400 mb-4">
            Choose the language and tone for AI-generated listing descriptions.
          </p>
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">Language</label>
            <select
              data-element-id="translation-lang-select"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 font-medium bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              value={translationLang}
              onChange={(e) => {
                setTranslationLang(e.target.value);
                setTranslationSaved(false);
                setTranslationError(null);
              }}
            >
              {LANG_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">Tone</label>
            <select
              data-element-id="translation-tone-select"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 font-medium bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              value={translationTone}
              onChange={(e) => {
                setTranslationTone(e.target.value);
                setTranslationSaved(false);
                setTranslationError(null);
              }}
            >
              {TONE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={savingTranslation}
            onClick={async () => {
              setSavingTranslation(true);
              setTranslationSaved(false);
              setTranslationError(null);
              try {
                const res = await fetch("/api/profile", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ translationLang, translationTone }),
                });
                if (!res.ok) {
                  const data = await res.json().catch(() => ({}));
                  setTranslationError(data.error || "Failed to save translation settings.");
                  return;
                }
                setTranslationSaved(true);
              } catch {
                setTranslationError("Network error. Please try again.");
              } finally {
                setSavingTranslation(false);
              }
            }}
            className="w-full bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
          >
            {savingTranslation ? "Saving\u2026" : "Save"}
          </button>
          {translationSaved && (
            <p className="text-xs text-green-600 mt-2">Translation settings saved.</p>
          )}
          {translationError && (
            <p className="text-xs text-red-600 mt-2">{translationError}</p>
          )}
        </div>

        {/* Meta Business Integration */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
            Meta Business Integration
          </h2>
          <p className="text-xs text-gray-400 mb-4">
            Connect your Meta Business Manager so your CIA feed publishes directly to a product catalog.
          </p>

          {metaError && (
            <div className="rounded-md bg-red-50 p-3 mb-3">
              <p className="text-sm text-red-600">{metaError}</p>
              {metaTosRequired && (
                <a
                  href={
                    selectedBmId
                      ? `https://business.facebook.com/${selectedBmId}/commerce_manager/catalogs/`
                      : "https://business.facebook.com/commerce_manager/catalogs/"
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-600 hover:text-indigo-700 underline mt-1 inline-block"
                >
                  Open Meta Commerce Manager to accept terms &rarr;
                </a>
              )}
            </div>
          )}

          {(isMetaConnected || metaFeedId || fbPageId || metaCatalogId) && (
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="w-full border border-red-300 text-red-600 bg-white rounded-md py-2 text-sm font-medium hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed mb-3"
            >
              {disconnecting ? "Disconnecting\u2026" : "Disconnect Meta"}
            </button>
          )}

          {metaStep === "done" && metaFeedId && (
            <div>
              <div className="rounded-md bg-green-50 border border-green-200 p-3">
                <p className="text-sm text-green-700 font-medium">
                  {"\u2705"} Feed connected to Meta
                </p>
                {fbPageId && (
                  <p className="text-xs text-green-600 mt-1 break-all">
                    Page ID: {fbPageId}
                  </p>
                )}
                <p className="text-xs text-green-600 mt-1 break-all">
                  Feed ID: {metaFeedId}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { resetWizard(); loadPages(); }}
                disabled={metaLoading}
                className="mt-2 text-xs text-indigo-600 hover:text-indigo-700 underline disabled:opacity-50"
              >
                Reconnect / Change Setup
              </button>
            </div>
          )}

          {metaStep === "idle" && !isMetaConnected && (
            <div>
              <div className="text-xs text-gray-500 mb-2">Step 1 of 5</div>
              <button
                type="button"
                data-element-id="meta-connect"
                onClick={() => { window.location.href = "/api/fb/oauth"; }}
                className="w-full bg-indigo-600 text-white rounded-md py-2 text-sm font-semibold hover:bg-indigo-700"
              >
                Connect Meta Business &rarr;
              </button>
            </div>
          )}

          {metaStep === "idle" && isMetaConnected && (
            <div>
              <p className="text-xs text-gray-500 mb-2">Meta account connected.</p>
              <button
                type="button"
                onClick={loadPages}
                disabled={metaLoading}
                className="w-full bg-indigo-600 text-white rounded-md py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
              >
                {metaLoading ? "Loading\u2026" : "Continue Setup"}
              </button>
            </div>
          )}

          {metaStep === "pages" && (
            <div>
              <div className="text-xs text-gray-500 mb-2">
                Step 2 of 5 — Select Facebook Page
              </div>
              <p className="text-xs text-gray-500 mb-2">
                This Page&apos;s id will be written to every row of your Meta
                feed CSV as <code className="font-mono">fb_page_id</code>.
              </p>
              {pages.length === 0 ? (
                <p className="text-sm text-gray-500 mb-2">
                  No Facebook Pages found for your account.
                </p>
              ) : (
                <select
                  data-element-id="meta-page-select"
                  className="w-full border border-gray-400 bg-white rounded-md px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={selectedPageId}
                  onChange={(e) => setSelectedPageId(e.target.value)}
                >
                  <option value="">-- Choose a Facebook Page --</option>
                  {pages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                disabled={!selectedPageId || metaLoading}
                onClick={submitPage}
                className="w-full bg-indigo-600 text-white rounded-md py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
              >
                {metaLoading ? "Saving\u2026" : "Next \u2192"}
              </button>
              <button type="button" onClick={resetWizard} className="mt-2 text-xs text-gray-500 hover:text-gray-700 underline">
                Start Over
              </button>
            </div>
          )}

          {metaStep === "businesses" && (
            <div>
              <div className="text-xs text-gray-500 mb-2">Step 3 of 5 — Select Business Manager</div>
              {businesses.length === 0 ? (
                <div className="mb-3">
                  {(() => { console.log("[Meta Wizard] businesses.length === 0 — no Business Managers found"); return null; })()}
                  <p className="text-sm text-gray-500 mb-2">
                    No Business Managers found for your account.
                  </p>
                  <p className="text-xs text-gray-500 mb-3">
                    No Business Managers?{" "}
                    <a
                      href="https://business.facebook.com/overview"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 hover:text-indigo-700 underline"
                    >
                      Create one
                    </a>
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={metaLoading}
                      onClick={loadBusinesses}
                      className="flex-1 border border-gray-300 text-gray-700 bg-white rounded-md py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                    >
                      {metaLoading ? "Loading\u2026" : "Retry"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        console.log("[Meta Wizard] User skipped business selection — falling back to pages step");
                        setBusinessSkipped(true);
                        setMetaStep("pages");
                      }}
                      className="flex-1 border border-gray-300 text-gray-700 bg-white rounded-md py-2 text-sm font-medium hover:bg-gray-50"
                    >
                      Skip
                    </button>
                  </div>
                </div>
              ) : (
                <select
                  data-element-id="meta-business-select"
                  className="w-full border border-gray-400 bg-white rounded-md px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={selectedBmId}
                  onChange={(e) => setSelectedBmId(e.target.value)}
                >
                  <option value="">-- Choose a business --</option>
                  {businesses.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              )}
              {businesses.length > 0 && (
                <button
                  type="button"
                  disabled={!selectedBmId || metaLoading}
                  onClick={() => loadCatalogs(selectedBmId)}
                  className="w-full bg-indigo-600 text-white rounded-md py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
                >
                  {metaLoading ? "Loading\u2026" : "Next \u2192"}
                </button>
              )}
              <button type="button" onClick={resetWizard} className="mt-2 text-xs text-gray-500 hover:text-gray-700 underline">
                Start Over
              </button>
            </div>
          )}

          {metaStep === "catalogs" && (
            <div>
              <div className="text-xs text-gray-500 mb-2">Step 4 of 5 — Select or Create Catalog</div>

              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setMetaMode("existing")}
                  className={`flex-1 py-1.5 rounded-md text-xs font-medium border ${
                    metaMode === "existing"
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                      : "border-gray-300 bg-white text-gray-600"
                  }`}
                >
                  Use Existing
                </button>
                <button
                  type="button"
                  onClick={() => setMetaMode("new")}
                  className={`flex-1 py-1.5 rounded-md text-xs font-medium border ${
                    metaMode === "new"
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                      : "border-gray-300 bg-white text-gray-600"
                  }`}
                >
                  + Create New
                </button>
              </div>

              {metaMode === "existing" ? (
                catalogs.length === 0 ? (
                  <p className="text-xs text-gray-500 mb-3">
                    No existing catalogs in this business. Switch to &quot;Create New&quot;.
                  </p>
                ) : (
                  <select
                    data-element-id="meta-catalog-select"
                    className="w-full border border-gray-400 bg-white rounded-md px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    value={selectedCatalogId}
                    onChange={(e) => setSelectedCatalogId(e.target.value)}
                  >
                    <option value="">-- Choose a catalog --</option>
                    {catalogs.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )
              ) : (
                <input
                  data-element-id="meta-catalog-name"
                  type="text"
                  placeholder="e.g. CIA Automotive Catalog"
                  value={newCatalogName}
                  onChange={(e) => setNewCatalogName(e.target.value)}
                  className="w-full border border-gray-400 bg-white rounded-md px-3 py-2 text-sm mb-3 placeholder:text-gray-500 placeholder:font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              )}

              <button
                type="button"
                disabled={metaLoading}
                onClick={submitCatalog}
                className="w-full bg-indigo-600 text-white rounded-md py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
              >
                {metaLoading ? "Saving\u2026" : metaTosRequired ? "Retry" : "Next \u2192"}
              </button>
              <button type="button" onClick={resetWizard} className="mt-2 text-xs text-gray-500 hover:text-gray-700 underline">
                Start Over
              </button>
            </div>
          )}

          {metaStep === "feed" && (
            <div>
              <div className="text-xs text-gray-500 mb-2">Step 5 of 5 — Register Feed</div>
              <div className="rounded-md bg-gray-50 border border-gray-200 p-3 mb-3">
                <p className="text-xs text-gray-500 mb-1">Feed URL</p>
                {slug ? (
                  <p className="text-xs text-gray-700 break-all font-mono">
                    {`https://www.ciafeed.com/feeds/${slug}.csv`}
                  </p>
                ) : (
                  <p className="text-xs text-gray-400">Slug not set</p>
                )}
                {metaCatalogId && (
                  <p className="text-xs text-gray-400 mt-2">Catalog: {metaCatalogId}</p>
                )}
              </div>
              <button
                type="button"
                disabled={metaLoading}
                onClick={publishFeed}
                className="w-full bg-indigo-600 text-white rounded-md py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
              >
                {metaLoading ? "Publishing\u2026" : "Publish Feed to Meta \u2192"}
              </button>
              <button type="button" onClick={resetWizard} className="mt-2 text-xs text-gray-500 hover:text-gray-700 underline">
                Start Over
              </button>
            </div>
          )}
        </div>

        {/* Meta Pixel ID */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
            Meta Pixel ID
          </h2>
          <p className="text-xs text-gray-400 mb-3">
            Add your Meta Pixel ID to enable conversion tracking on your catalog widget.
          </p>
          <div className="flex gap-2.5">
            <input
              type="text"
              data-element-id="meta-pixel-id-input"
              placeholder="123456789012345"
              value={pixelId}
              onChange={(e) => {
                setPixelId(e.target.value);
                setPixelIdSaved(false);
                setPixelIdError(null);
              }}
              className="flex-1 border border-gray-400 bg-white rounded-md px-3 py-2 text-sm placeholder:text-gray-500 placeholder:font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <button
              type="button"
              disabled={savingPixelId}
              onClick={async () => {
                setSavingPixelId(true);
                setPixelIdSaved(false);
                setPixelIdError(null);
                try {
                  const res = await fetch("/api/profile", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ metaPixelId: pixelId.trim() || null }),
                  });
                  if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    setPixelIdError(data.error || "Failed to save Meta Pixel ID.");
                    return;
                  }
                  setPixelIdSaved(true);
                } catch {
                  setPixelIdError("Network error. Please try again.");
                } finally {
                  setSavingPixelId(false);
                }
              }}
              className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
            >
              {savingPixelId ? "Saving\u2026" : "Save"}
            </button>
          </div>
          {pixelIdSaved && (
            <p className="text-xs text-green-600 mt-2">Meta Pixel ID saved.</p>
          )}
          {pixelIdError && (
            <p className="text-xs text-red-600 mt-2">{pixelIdError}</p>
          )}
        </div>

        {/* Meta Delivery Method */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
            Meta Delivery Method
          </h2>
          <p className="text-xs text-gray-400 mb-4">
            Choose how inventory is delivered to your Meta catalog. CSV uses the scheduled feed URL.
            API pushes changes directly via the Graph API.
          </p>
          {!API_SUPPORTED_VERTICALS.has(vertical) && (
            <p className="text-xs text-amber-600 mb-3">
              CSV only for this vertical. API delivery is available for automotive and services verticals.
            </p>
          )}
          <div className="space-y-2">
            {([
              { value: "csv", label: "CSV Feed", desc: "Meta pulls your feed CSV on a schedule (default)" },
              { value: "api", label: "API Push", desc: "Changes are pushed to Meta in real-time via Graph API" },
            ] as const).map((opt) => {
              const selected = deliveryMethod === opt.value;
              const apiDisabled = opt.value === "api" && !API_SUPPORTED_VERTICALS.has(vertical);
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={savingDelivery || apiDisabled}
                  onClick={async () => {
                    if (deliveryMethod === opt.value) return;
                    const prev = deliveryMethod;
                    setDeliveryMethod(opt.value);
                    setDeliverySaved(false);
                    setDeliveryError(null);
                    setSavingDelivery(true);
                    try {
                      const res = await fetch("/api/profile", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ metaDeliveryMethod: opt.value }),
                      });
                      if (!res.ok) {
                        const data = await res.json().catch(() => ({}));
                        if (data.error === "api_delivery_not_ready" && Array.isArray(data.issues)) {
                          const issueMessages: Record<string, string> = {
                            api_delivery_unsupported_vertical: "API delivery is not supported for your vertical.",
                            catalog_not_selected: "Please select a Meta catalog first.",
                            meta_token_missing: "Please connect your Meta account first.",
                            meta_token_decrypt_failed: "Your Meta token could not be verified. Please reconnect.",
                            meta_token_expired: "Your Meta token has expired. Please reconnect.",
                          };
                          const msgs = (data.issues as string[])
                            .map((i: string) => issueMessages[i] || i)
                            .join(" ");
                          setDeliveryError(msgs);
                        } else {
                          setDeliveryError(data.error ?? "Failed to save delivery method.");
                        }
                        setDeliveryMethod(prev);
                        return;
                      }
                      setDeliverySaved(true);
                    } catch {
                      setDeliveryError("Network error. Please try again.");
                      setDeliveryMethod(prev);
                    } finally {
                      setSavingDelivery(false);
                    }
                  }}
                  className={`w-full flex items-center gap-3 border rounded-lg px-4 py-3 text-left transition-colors ${
                    selected
                      ? "border-indigo-500 bg-indigo-50"
                      : apiDisabled
                        ? "border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed"
                        : "border-gray-200 hover:border-indigo-300"
                  } disabled:opacity-50`}
                >
                  <div className="flex-1">
                    <span className="text-sm font-semibold text-gray-800">{opt.label}</span>
                    <p className="text-xs text-gray-500">{opt.desc}</p>
                  </div>
                  {selected && (
                    <span className="text-indigo-600 text-sm font-medium">&#10003;</span>
                  )}
                </button>
              );
            })}
          </div>
          {deliverySaved && (
            <p className="text-xs text-green-600 mt-2">Delivery method saved.</p>
          )}
          {deliveryError && (
            <p className="text-xs text-red-600 mt-2">{deliveryError}</p>
          )}
        </div>

        {deliveryMethod === "api" && (
          <MetaDeliveryStatusCard
            vertical={vertical}
            onReconnect={async () => {
              const ok = await handleDisconnect();
              if (!ok) return;
              resetWizard();
              window.location.href = "/api/fb/oauth";
            }}
          />
        )}

        {/* Website URL — only for automotive/ecommerce */}
        {showWebsiteUrl && (
          <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
              Website URL
            </h2>
            <p className="text-xs text-gray-400 mb-4">
              Your website URL is used to crawl and discover inventory listings.
            </p>
            <div className="flex gap-2.5">
              <input
                data-element-id="website-url-input"
                type="url"
                className="flex-1 border border-gray-400 bg-white rounded-md px-3 py-2 text-sm placeholder:text-gray-500 placeholder:font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="https://yourwebsite.com"
                value={siteUrl}
                onChange={(e) => {
                  setSiteUrl(e.target.value);
                  setSiteUrlSaved(false);
                }}
              />
              <button
                type="button"
                disabled={savingSiteUrl}
                onClick={async () => {
                  setSavingSiteUrl(true);
                  setError(null);
                  setSiteUrlSaved(false);
                  try {
                    const res = await fetch("/api/profile", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ websiteUrl: siteUrl.trim() || null }),
                    });
                    if (!res.ok) {
                      const data = await res.json().catch(() => ({}));
                      setError(data.error || "Failed to save website URL.");
                      return;
                    }
                    setSiteUrlSaved(true);
                  } catch {
                    setError("Network error. Please try again.");
                  } finally {
                    setSavingSiteUrl(false);
                  }
                }}
                className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
              >
                {savingSiteUrl ? "Saving\u2026" : "Save"}
              </button>
            </div>
            {siteUrlSaved && (
              <p className="text-xs text-green-600 mt-2">Website URL saved.</p>
            )}
          </div>
        )}

        {/* Sub-Accounts */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Sub-Accounts</h2>
          <p className="text-xs text-gray-400 mb-4">
            Manage multiple verticals under one account. Each sub-account has its own inventory and feed.
          </p>

          {subAccountsList.length > 0 && (
            <div className="space-y-2 mb-4">
              {subAccountsList.map((sa) => {
                const vInfo = VERTICALS.find((v) => v.id === sa.vertical);
                return (
                  <div
                    key={sa.id}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-gray-200"
                  >
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {vInfo?.icon ?? ""} {sa.name}
                      </div>
                      <div className="text-xs text-gray-500">
                        {vInfo?.title ?? sa.vertical}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSubAccountId(sa.id);
                          setEditNewVertical(sa.vertical);
                          setSubError(null);
                        }}
                        className="text-xs text-gray-500 hover:text-gray-700 font-medium"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push(`/dashboard?subAccountId=${sa.id}`)}
                        className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                      >
                        Switch
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Edit Vertical Modal */}
          {editingSubAccountId && (() => {
            const editSa = subAccountsList.find((s) => s.id === editingSubAccountId);
            if (!editSa) return null;
            return (
              <div className="border border-amber-300 bg-amber-50 rounded-lg p-4 mb-4">
                <h3 className="text-sm font-semibold text-gray-800 mb-1">
                  Change Vertical for &ldquo;{editSa.name}&rdquo;
                </h3>
                <p className="text-xs text-amber-700 mb-3">
                  Changing the vertical will permanently delete all vehicles, listings, crawl jobs, and snapshots for this sub-account.
                </p>
                <div className="mb-3">
                  <label className="block text-xs font-medium text-gray-700 mb-1">New Vertical</label>
                  <select
                    value={editNewVertical}
                    onChange={(e) => setEditNewVertical(e.target.value)}
                    className="w-full border border-gray-400 bg-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {VERTICALS.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.icon} {v.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={resettingSub || editNewVertical === editSa.vertical}
                    onClick={() => resetSubAccount(editingSubAccountId, editNewVertical)}
                    className="flex-1 bg-red-600 text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
                  >
                    {resettingSub ? "Resetting\u2026" : "Confirm & Reset Data"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditingSubAccountId(null); setSubError(null); }}
                    className="flex-1 border border-gray-300 text-gray-700 px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            );
          })()}

          {subError && (
            <div className="rounded-md bg-red-50 p-3 mb-3">
              <p className="text-sm text-red-600">{subError}</p>
            </div>
          )}

          {showCreateSub ? (
            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Create Sub-Account</h3>
              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  placeholder="e.g. My Real Estate"
                  value={newSubName}
                  onChange={(e) => setNewSubName(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 font-medium placeholder:text-gray-500 placeholder:font-normal bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-700 mb-1">Vertical</label>
                <select
                  value={newSubVertical}
                  onChange={(e) => setNewSubVertical(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 font-medium bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="" disabled hidden className="text-gray-500 font-normal">— Select Vertical —</option>
                  {VERTICALS.map((v) => (
                    <option key={v.id} value={v.id} className="text-gray-900 font-medium">
                      {v.icon} {v.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={creatingSub}
                  onClick={async () => {
                    if (!newSubName.trim()) {
                      setSubError("Name is required.");
                      return;
                    }
                    setCreatingSub(true);
                    setSubError(null);
                    try {
                      const res = await fetch("/api/subaccounts", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name: newSubName.trim(), vertical: newSubVertical }),
                      });
                      if (!res.ok) {
                        const data = await res.json().catch(() => ({}));
                        setSubError(data.error || "Failed to create sub-account.");
                        return;
                      }
                      const data = await res.json();
                      setSubAccountsList((prev) => [...prev, {
                        id: data.subAccount.id,
                        name: data.subAccount.name,
                        vertical: data.subAccount.vertical,
                        createdAt: data.subAccount.createdAt,
                      }]);
                      setNewSubName("");
                      setNewSubVertical("automotive");
                      setShowCreateSub(false);
                    } catch {
                      setSubError("Network error. Please try again.");
                    } finally {
                      setCreatingSub(false);
                    }
                  }}
                  className="flex-1 bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
                >
                  {creatingSub ? "Creating\u2026" : "Create"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowCreateSub(false); setSubError(null); }}
                  className="flex-1 border border-gray-300 text-gray-700 px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowCreateSub(true)}
              className="w-full border-2 border-dashed border-indigo-400 text-indigo-600 rounded-md py-2 text-sm cursor-pointer hover:bg-indigo-50"
            >
              + Add Sub-Account
            </button>
          )}
        </div>

        {/* Storefront Bundles — lets the dealer group sub-accounts under a
            single mini-site page. Server-rendered manager component passed
            in as a slot so this client component doesn't need direct DB
            access. */}
        {bundleManager && (
          <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
            {bundleManager}
          </div>
        )}

        {/* Team Members */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
            Team Members
          </h2>
          <p className="text-xs text-gray-400 mb-4">
            Invite team members to manage inventory under your account.
          </p>

          {teamError && (
            <div className="rounded-md bg-red-50 p-3 mb-3">
              <p className="text-sm text-red-600">{teamError}</p>
            </div>
          )}
          {teamSuccess && (
            <div className="rounded-md bg-green-50 p-3 mb-3">
              <p className="text-sm text-green-600">{teamSuccess}</p>
            </div>
          )}

          {teamLoading && teamMembers.length === 0 && (
            <p className="text-xs text-gray-400 mb-3">Loading team...</p>
          )}

          {/* Active Members */}
          {teamMembers.length > 0 && (
            <div className="space-y-2 mb-4">
              {teamMembers.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-gray-200"
                >
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {m.name ?? m.email}
                    </div>
                    <div className="text-xs text-gray-500">
                      {m.name && m.email}
                      {m.name && " \u00b7 "}
                      {m.role === "admin" ? "Admin" : "Editor"}
                      {m.subAccount ? ` \u00b7 ${m.subAccount.name}` : " \u00b7 All sub-accounts"}
                    </div>
                    {m.acceptedAt && !m.passwordSet && (
                      <span className="inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
                        Pending password setup
                      </span>
                    )}
                  </div>
                  {!isEditor && (
                    <div className="flex items-center gap-2">
                      {m.acceptedAt && !m.passwordSet && (
                        <button
                          type="button"
                          onClick={() => handleResendInvite({ memberId: m.id }, m.email)}
                          className="text-xs text-indigo-500 hover:text-indigo-600 font-medium"
                        >
                          Resend invite
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(m.id)}
                        className="text-xs text-red-500 hover:text-red-600 font-medium"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Pending Invites */}
          {pendingInvites.length > 0 && (
            <div className="mb-4">
              <h3 className="text-xs font-semibold text-gray-500 mb-2">Pending Invites</h3>
              <div className="space-y-2">
                {pendingInvites.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg border border-dashed border-gray-300 bg-gray-50"
                  >
                    <div>
                      <div className="text-sm text-gray-700">{inv.email}</div>
                      <div className="text-xs text-gray-400">
                        {inv.role === "admin" ? "Admin" : "Editor"} &middot; Expires{" "}
                        {new Date(inv.expiresAt).toLocaleDateString()}
                      </div>
                    </div>
                    {!isEditor && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleResendInvite({ inviteId: inv.id }, inv.email)}
                          className="text-xs text-indigo-500 hover:text-indigo-600 font-medium"
                        >
                          Resend
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancelInvite(inv.id)}
                          className="text-xs text-gray-500 hover:text-red-500 font-medium"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Invite Form */}
          {isEditor ? null : showInviteForm ? (
            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Invite Team Member</h3>
              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  placeholder="teammate@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 font-medium placeholder:text-gray-500 placeholder:font-normal bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 font-medium bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="editor" className="text-gray-900 font-medium">Editor (scoped to sub-account)</option>
                  <option value="admin" className="text-gray-900 font-medium">Admin (full access)</option>
                </select>
              </div>
              {inviteRole === "editor" && subAccountsList.length > 0 && (
                <div className="mb-3">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Sub-Account</label>
                  <select
                    value={inviteSubAccountId}
                    onChange={(e) => setInviteSubAccountId(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 font-medium bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="" className="text-gray-500 font-normal">All sub-accounts</option>
                    {subAccountsList.map((sa) => (
                      <option key={sa.id} value={sa.id}>{sa.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={inviting}
                  onClick={handleInvite}
                  className="flex-1 bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
                >
                  {inviting ? "Sending\u2026" : "Send Invite"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowInviteForm(false); setTeamError(null); }}
                  className="flex-1 border border-gray-300 text-gray-700 px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowInviteForm(true)}
              className="w-full border-2 border-dashed border-indigo-400 text-indigo-600 rounded-md py-2 text-sm cursor-pointer hover:bg-indigo-50"
            >
              + Invite Team Member
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
