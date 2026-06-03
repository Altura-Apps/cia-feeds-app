import Link from "next/link";

interface Props {
  monthlyPrice?: number;
  /** Number of trial days. If > 0, surfaces a paid-trial CTA. */
  trialDays?: number;
  /** Trial setup fee in cents (e.g. 100 = $1). Only used when trialDays > 0. */
  trialPriceCents?: number;
}

function formatDollars(cents: number): string {
  if (cents % 100 === 0) return `$${cents / 100}`;
  return `$${(cents / 100).toFixed(2)}`;
}

export default function PricingToggle({
  monthlyPrice = 299,
  trialDays = 0,
  trialPriceCents = 0,
}: Props) {
  const hasTrial = trialDays > 0 && trialPriceCents > 0;

  return (
    <div className="text-center">
      {hasTrial && (
        <div className="inline-block bg-indigo-50 text-indigo-700 text-xs font-semibold uppercase tracking-wider px-3 py-1 rounded-full mb-4">
          {trialDays}-day trial for {formatDollars(trialPriceCents)}
        </div>
      )}

      <div className="text-5xl font-extrabold text-indigo-600">
        ${monthlyPrice}
        <span className="text-lg font-normal text-gray-500">/mo</span>
      </div>

      <p className="text-sm text-gray-500 mt-2 mb-6">
        {hasTrial
          ? `${formatDollars(trialPriceCents)} today, then $${monthlyPrice}/mo after ${trialDays} days. Cancel anytime.`
          : "Per account. Unlimited listings."}
      </p>

      <Link
        href="/signup"
        data-element-id="cta-pricing"
        className="block bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-lg mb-3"
      >
        {hasTrial
          ? `Start ${trialDays}-day trial for ${formatDollars(trialPriceCents)} \u2192`
          : "Get Started \u2192"}
      </Link>
      <p className="text-xs text-gray-400">
        Cancel anytime. No contracts.{" "}
        {hasTrial ? "You can cancel before the trial ends to avoid the monthly charge." : ""}
      </p>
    </div>
  );
}
