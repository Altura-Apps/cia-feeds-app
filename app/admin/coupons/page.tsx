import Link from "next/link";
import { redirect } from "next/navigation";
import { adminGuard } from "@/lib/auth";
import { stripeClient } from "@/lib/stripe";
import CouponMintForm from "./CouponMintForm";
import CouponList from "./CouponList";

export const dynamic = "force-dynamic";

interface BetaCouponRow {
  code: string;
  promotionCodeId: string;
  couponId: string;
  active: boolean;
  timesRedeemed: number;
  maxRedemptions: number | null;
  expiresAt: string | null;
  createdAt: string;
  percentOff: number | null;
  durationMonths: number | null;
  createdBy: string | null;
  note: string | null;
}

export default async function CouponsAdminPage() {
  const guard = await adminGuard("manage_accounts");
  if (!guard.ok) {
    redirect("/dashboard");
  }

  // Pull recent beta promo codes from Stripe.
  const result = await stripeClient.promotionCodes.list({ limit: 100 });
  const rows: BetaCouponRow[] = result.data
    .filter((p) => p.metadata?.kind === "beta_access")
    .map((p) => ({
      code: p.code,
      promotionCodeId: p.id,
      couponId: p.coupon.id,
      active: p.active,
      timesRedeemed: p.times_redeemed,
      maxRedemptions: p.max_redemptions,
      expiresAt: p.expires_at ? new Date(p.expires_at * 1000).toISOString() : null,
      createdAt: new Date(p.created * 1000).toISOString(),
      percentOff: p.coupon.percent_off,
      durationMonths: p.coupon.duration_in_months,
      createdBy: (p.metadata?.created_by as string) ?? null,
      note: (p.coupon.metadata?.note as string) ?? null,
    }));

  const activeCount = rows.filter((r) => r.active).length;
  const totalRedemptions = rows.reduce((s, r) => s + r.timesRedeemed, 0);

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="text-sm text-indigo-600 hover:text-indigo-700"
          >
            ← Admin
          </Link>
          <h1 className="text-lg font-bold text-gray-900">Beta Access Coupons</h1>
        </div>
        <div className="text-sm text-gray-500">
          {activeCount} active · {totalRedemptions} total redemptions
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
          <p className="font-semibold mb-1">How beta access works</p>
          <p className="leading-relaxed">
            Mint a 100%-off code below and share it with a beta user. When they
            sign up and enter the code on{" "}
            <Link href="/subscribe" className="underline">/subscribe</Link>,
            Stripe sees the total is $0 and{" "}
            <strong>skips the credit-card step entirely</strong>. They get
            instant access. After the free duration expires, Stripe will email
            them to add a card before the first real charge.
          </p>
        </div>

        <CouponMintForm />

        <div>
          <h2 className="text-base font-semibold text-gray-900 mb-3">
            Existing beta codes
          </h2>
          <CouponList rows={rows} />
        </div>
      </div>
    </div>
  );
}
