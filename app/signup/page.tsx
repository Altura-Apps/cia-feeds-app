"use client";

import { useState, FormEvent, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

const VERTICALS = [
  {
    id: "automotive",
    icon: "\u{1F697}",
    title: "Automotive",
    desc: "New & used vehicle listings with VIN, mileage, and pricing",
  },
  {
    id: "services",
    icon: "\u{1F527}",
    title: "Services",
    desc: "Plumbing, cleaning, consulting, and other local services",
  },
  {
    id: "realestate",
    icon: "\u{1F3E0}",
    title: "Real Estate",
    desc: "Property listings for sale or rent with beds, baths, and location",
  },
] as const;

export default function SignupPage() {
  const searchParams = useSearchParams();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [vertical, setVertical] = useState("automotive");
  const [coupon, setCoupon] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Capture ?coupon=XXX from the URL so we can carry it through to /subscribe
  // after signup completes. Without this, coupon-link landings (e.g.
  // /signup?coupon=CELENIA) drop the coupon and the user has to type it
  // manually on the subscribe page.
  useEffect(() => {
    const c = searchParams?.get("coupon");
    if (c && c.trim()) setCoupon(c.trim().toUpperCase());
  }, [searchParams]);

  function handleStepOne(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setStep(2);
  }

  async function handleSubmit() {
    setError("");
    setLoading(true);

    let response: Response;
    try {
      response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, vertical }),
      });
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
      return;
    }

    if (response.status === 409) {
      setError("Email already in use. Please use a different email or sign in.");
      setLoading(false);
      setStep(1);
      return;
    }

    if (response.status === 429) {
      setError(
        "Too many signup attempts from this network. Please wait a minute and try again."
      );
      setLoading(false);
      return;
    }

    if (!response.ok) {
      // Try to surface the specific server error (e.g. password too weak,
      // breached password, validation failure) instead of a generic toast.
      let detail: string | null = null;
      let fieldIssues: Record<string, string[]> | null = null;
      try {
        const payload = (await response.json()) as {
          error?: string;
          detail?: string;
          issues?: Record<string, string[]>;
        };
        if (payload.issues && typeof payload.issues === "object") {
          fieldIssues = payload.issues;
        }
        if (payload.detail) {
          detail = payload.detail;
        } else if (payload.error) {
          detail = payload.error;
        }
      } catch {
        // body wasn't JSON
      }

      if (fieldIssues) {
        // Surface the first field error in plain English.
        if (fieldIssues.password?.length) {
          setError(`Password issue: ${fieldIssues.password[0]}`);
          setStep(1);
        } else if (fieldIssues.email?.length) {
          setError(`Email issue: ${fieldIssues.email[0]}`);
          setStep(1);
        } else if (fieldIssues.name?.length) {
          setError(`Name issue: ${fieldIssues.name[0]}`);
          setStep(1);
        } else {
          const firstKey = Object.keys(fieldIssues)[0];
          setError(`${firstKey}: ${fieldIssues[firstKey][0]}`);
          setStep(1);
        }
      } else if (detail) {
        setError(`Couldn't create account: ${detail}`);
      } else {
        setError(
          "Something went wrong creating your account. Please try again, or contact support@ciafeed.com if it persists."
        );
      }
      setLoading(false);
      return;
    }

    // Preserve any ?coupon= from the original signup URL through to the
    // post-signup /subscribe redirect so the coupon auto-applies.
    const subscribePath = coupon
      ? `/subscribe?coupon=${encodeURIComponent(coupon)}`
      : "/subscribe";
    const result = await signIn("credentials", {
      email,
      password,
      callbackUrl: `${window.location.origin}${subscribePath}`,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Account created but sign-in failed. Please sign in manually.");
    } else if (result?.url) {
      window.location.href = result.url;
    }
  }

  if (step === 2) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-[560px] w-full">
          <p className="text-xs text-gray-400 text-center mb-4">Step 2 of 2</p>
          <h2 className="text-center text-2xl font-bold text-gray-900 mb-1">
            What are you selling?
          </h2>
          <p className="text-center text-sm text-gray-500 mb-6">
            Choose your business type. This determines how your Meta feed is formatted.
          </p>

          {error && (
            <div className="rounded-md bg-red-50 p-4 mb-4">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 mb-6">
            {VERTICALS.map((v) => (
              <button
                key={v.id}
                type="button"
                data-element-id={`vertical-${v.id}`}
                onClick={() => setVertical(v.id)}
                className={`text-left border-2 rounded-xl p-4 transition-colors cursor-pointer bg-white ${
                  vertical === v.id
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="text-2xl mb-2">{v.icon}</div>
                <div className="text-sm font-semibold text-gray-900 mb-1">{v.title}</div>
                <div className="text-xs text-gray-500 leading-snug">{v.desc}</div>
              </button>
            ))}
          </div>

          <button
            data-element-id="continue-btn"
            type="button"
            disabled={loading}
            onClick={handleSubmit}
            className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Creating account\u2026" : "Create Account \u2192"}
          </button>
          <button
            data-element-id="back-btn"
            type="button"
            onClick={() => setStep(1)}
            className="block mx-auto mt-3 text-sm text-indigo-600 hover:text-indigo-500"
          >
            &larr; Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <p className="text-xs text-gray-400 text-center mb-2">Step 1 of 2</p>
          <h2 className="text-center text-3xl font-extrabold text-gray-900">
            Create your account
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-indigo-600 hover:text-indigo-500"
            >
              Sign in
            </Link>
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleStepOne}>
          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="rounded-md shadow-sm space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                Business name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                autoComplete="organization"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-400 bg-white placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="Your business name"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-400 bg-white placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <div className="relative mt-1">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="appearance-none relative block w-full px-3 py-2 pr-10 border border-gray-400 bg-white placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  placeholder="Minimum 8 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 rounded"
                >
                  {showPassword ? (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>

          <div>
            <button
              type="submit"
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Continue &rarr;
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
