import Link from "next/link";
import { getServerSession, Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkSubscription } from "@/lib/checkSubscription";
import { VALID_VERTICALS, VERTICAL_LABELS, Vertical } from "@/lib/verticals";
import LandingCarousel from "@/app/components/LandingCarousel";
import Testimonials from "@/app/components/Testimonials";
import HowItWorksSteps from "@/app/components/HowItWorksSteps";
import PricingToggle from "@/app/components/PricingToggle";
import LandingAnalytics from "@/app/components/LandingAnalytics";

/* ── Static data ──────────────────────────────────────────────────────────── */

const LANDING_CAROUSEL_IMAGES: string[] = [
  "/landing/dashboard.png",
  "/landing/feed-url.png",
  "/landing/vehicle-detail.png",
  "/landing/listings-table.png",
  "/landing/meta-status.png",
];

const HOW_IT_WORKS_STEPS = [
  {
    emoji: "\u{1F517}",
    title: "Paste a Listing URL",
    description: "Drop in any product, vehicle, property, or service page URL",
    screenshot: "/landing/step-1-paste.png",
  },
  {
    emoji: "\u26A1",
    title: "We Scrape It Instantly",
    description: "CIAfeeds extracts title, price, images, and all relevant fields automatically",
    screenshot: "/landing/step-2-scrape.png",
  },
  {
    emoji: "\u{1F4CB}",
    title: "Get Your Meta Feed URL",
    description: "Share one URL with Meta Catalog Manager \u2014 it auto-refreshes on schedule",
    screenshot: "/landing/step-3-feed.png",
  },
];

const VERTICAL_ICONS: Record<Vertical, string> = {
  automotive: "\u{1F697}",
  services: "\u{1F6E0}\uFE0F",
  realestate: "\u{1F3E0}",
  ecommerce: "\u{1F6D2}",
};

const TRUSTED_DEALER_COUNT = 100;

const VERTICAL_TAGLINES: Record<Vertical, string> = {
  automotive: "Vehicle listings to Meta Catalog Ads in minutes",
  services: "Promote local services with dynamic catalog feeds",
  realestate: "Turn property listings into home listing ads",
  ecommerce: "Sync your product pages to Meta product catalogs",
};

/* ── Sub-components (server) ──────────────────────────────────────────────── */

function Nav({ session, isSubscribed }: { session: Session | null; isSubscribed: boolean }) {
  return (
    <nav className="sticky top-0 z-50 bg-white border-b border-gray-200">
      <div className="flex items-center justify-between px-6 md:px-12 py-4 max-w-6xl mx-auto">
        <span className="font-extrabold text-xl text-indigo-600">CIAfeeds</span>
        <div className="hidden md:flex gap-6">
          <Link href="#features" className="text-sm text-gray-600 hover:text-gray-900">Features</Link>
          <Link href="#pricing" className="text-sm text-gray-600 hover:text-gray-900">Pricing</Link>
          <Link href="#faq" className="text-sm text-gray-600 hover:text-gray-900">FAQ</Link>
        </div>
        {session && isSubscribed ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">Welcome back, {session.user?.name || "there"}</span>
            <Link href="/dashboard" data-element-id="cta-nav-dashboard" className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-md">
              Go to Dashboard &rarr;
            </Link>
          </div>
        ) : session && !isSubscribed ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">Complete your signup</span>
            <Link href="/subscribe" data-element-id="cta-nav-subscribe" className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-md">
              Complete Signup &rarr;
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Link href="/login" data-element-id="cta-nav-login" className="border border-indigo-600 text-indigo-600 bg-white hover:bg-indigo-50 text-sm font-semibold px-4 py-2 rounded-md">
              Log In
            </Link>
            <Link href="/signup" data-element-id="cta-nav-signup" className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-md">
              Get Started &rarr;
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section className="bg-gray-50 py-20 px-6 text-center">
      <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 max-w-3xl mx-auto leading-tight mb-4">
        Turn Any Website Into a Meta Catalog Feed &mdash; In Minutes
      </h1>
      <p className="text-lg text-gray-500 max-w-xl mx-auto mb-2">
        CIAfeeds scrapes your product, vehicle, property, or service pages and generates a Meta-compatible CSV feed automatically. No dev work. No manual exports.
      </p>
      <p className="text-sm text-gray-400 mb-8">
        Trusted by {TRUSTED_DEALER_COUNT}+ dealers across automotive, real estate, services &amp; ecommerce.
      </p>
      <Link href="/signup" data-element-id="cta-hero" className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-base px-8 py-4 rounded-lg">
        Try 10 days for $1 &rarr;
      </Link>
      <p className="mt-4 text-sm text-gray-400">$299/mo after trial &middot; Cancel anytime &middot; Works with any website</p>
    </section>
  );
}

function SeeItInAction() {
  return (
    <section className="py-16 px-6">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-center text-gray-900 mb-10">See It in Action</h2>
        <LandingCarousel images={LANDING_CAROUSEL_IMAGES} />
      </div>
    </section>
  );
}

function VerticalShowcase() {
  return (
    <section className="bg-gray-50 py-16 px-6">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-center text-gray-900 mb-10">Built for Every Vertical</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {VALID_VERTICALS.map((v) => (
            <div key={v} className="border border-gray-200 bg-white rounded-xl p-6 text-center">
              <div className="text-3xl mb-2">{VERTICAL_ICONS[v]}</div>
              <h3 className="font-bold text-sm text-gray-900 mb-1">{VERTICAL_LABELS[v]}</h3>
              <p className="text-xs text-gray-500">{VERTICAL_TAGLINES[v]}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  const items = [
    "\u2705 Works with any website \u2014 no API needed",
    "\u2705 Meta Catalog Ads compatible CSV \u2014 for all supported verticals",
    "\u2705 Auto-extracts: title, price, images, condition, location, and more",
    "\u2705 Edit & fill in missing fields from the dashboard",
    "\u2705 Live feed URL \u2014 Meta pulls fresh data on schedule",
    "\u2705 One feed URL per account, forever",
    "\u2705 Supports Automotive, E-commerce, Real Estate & Services verticals",
  ];

  return (
    <section id="features" className="py-16 px-6">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-center text-gray-900 mb-10">
          Everything You Need to Run Meta Catalog Ads
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl mx-auto">
          {items.map((item) => (
            <div key={item} className="text-sm text-gray-700 py-1">{item}</div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="py-16 px-6 max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold text-center text-gray-900 mb-10">Simple, Transparent Pricing</h2>
      <div className="border-2 border-indigo-600 rounded-xl p-10 max-w-sm mx-auto">
        <PricingToggle monthlyPrice={299} trialDays={10} trialPriceCents={100} />
      </div>
    </section>
  );
}

function FAQ() {
  const items = [
    {
      question: "What websites does it work with?",
      answer: "Any publicly accessible listing page \u2014 product pages, vehicle detail pages, property listings, or service pages.",
    },
    {
      question: "How does Meta get the feed?",
      answer: "You paste your unique feed URL into Meta Catalog Manager. Meta fetches it on a schedule you set.",
    },
    {
      question: "What if a field doesn\u2019t scrape correctly?",
      answer: "You can manually edit any field from your dashboard before it appears in the feed.",
    },
    {
      question: "How many listings can I add?",
      answer: "Unlimited.",
    },
    {
      question: "Can I cancel anytime?",
      answer: "Yes. There are no contracts or cancellation fees. You can cancel your subscription at any time from your account settings.",
    },
    {
      question: "Do you support multiple sub-accounts or locations?",
      answer: "Each subscription covers one account. If you manage multiple locations, you can create separate accounts for each.",
    },
    {
      question: "Does the feed auto-refresh?",
      answer: "Yes. Your feed URL always serves the latest data. Meta re-fetches it on the schedule you configure in Catalog Manager.",
    },
    {
      question: "What about Meta API delivery?",
      answer: "For supported verticals (Automotive, Services), CIAfeeds can push listings directly via Meta\u2019s Catalog API in addition to the CSV feed.",
    },
  ];

  return (
    <section id="faq" className="bg-gray-50 py-16 px-6">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-center text-gray-900 mb-10">Frequently Asked Questions</h2>
        {items.map((item) => (
          <details key={item.question} className="border-b border-gray-200 py-5 group">
            <summary className="font-semibold text-sm text-gray-900 cursor-pointer list-none flex items-center justify-between">
              {item.question}
              <span className="ml-2 text-gray-400 group-open:rotate-45 transition-transform text-lg leading-none">+</span>
            </summary>
            <p className="text-sm text-gray-500 mt-2">{item.answer}</p>
          </details>
        ))}
        <div className="text-center mt-8">
          <Link href="/signup" data-element-id="cta-faq" className="text-indigo-600 hover:text-indigo-700 font-semibold text-sm">
            Still have questions? Get started &rarr;
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-gray-50 border-t border-gray-200 py-6 px-6 md:px-12">
      <div className="flex flex-col md:flex-row items-center justify-between max-w-6xl mx-auto gap-4 text-sm text-gray-400">
        <span>&copy; {new Date().getFullYear()} CIAfeeds</span>
        <div className="flex flex-wrap gap-4 justify-center">
          <Link href="/privacy" className="text-gray-500 hover:text-gray-700">Privacy Policy</Link>
          <Link href="/terms" className="text-gray-500 hover:text-gray-700">Terms of Service</Link>
          <a href="mailto:hello@ciafeeds.com" className="text-gray-500 hover:text-gray-700">Contact</a>
        </div>
        <div className="flex gap-4">
          <a href="https://x.com/ciafeeds" className="text-gray-500 hover:text-gray-700">X / Twitter</a>
          <a href="https://www.linkedin.com/company/ciafeeds" className="text-gray-500 hover:text-gray-700">LinkedIn</a>
        </div>
      </div>
    </footer>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────────── */

export default async function Home() {
  const session = await getServerSession(authOptions);
  const isSubscribed = session?.user?.id ? await checkSubscription(session.user.id) : false;
  return (
    <>
      <Nav session={session} isSubscribed={isSubscribed} />
      <Hero />
      <SeeItInAction />
      <VerticalShowcase />
      <Features />
      <Testimonials />
      <section className="py-16 px-6 max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-center text-gray-900 mb-10">How It Works</h2>
        <HowItWorksSteps steps={HOW_IT_WORKS_STEPS} />
      </section>
      <Pricing />
      <FAQ />
      <Footer />
      <LandingAnalytics />
    </>
  );
}
