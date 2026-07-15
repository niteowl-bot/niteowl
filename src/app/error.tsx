"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Sentry's captureConsoleIntegration already turns every console.error
    // call in the codebase into an event (see src/instrumentation.ts) —
    // this is what makes an uncaught render error actually reach Sentry
    // instead of only showing this page.
    console.error("[error boundary]", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#0d0f14] flex flex-col items-center justify-center px-4 py-12 text-center">
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-red-600/10 blur-3xl" />
      </div>

      <div className="relative">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white shadow-lg shadow-blue-600/30">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M8 1.5C4.41 1.5 1.5 4.41 1.5 8c0 1.74.65 3.33 1.72 4.54L1.5 14.5l2.04-1.69A6.48 6.48 0 0 0 8 14.5c3.59 0 6.5-2.91 6.5-6.5S11.59 1.5 8 1.5Z"
                fill="currentColor"
                opacity=".3"
              />
              <circle cx="5.5" cy="8.5" r="1" fill="currentColor" />
              <circle cx="8" cy="8.5" r="1" fill="currentColor" />
              <circle cx="10.5" cy="8.5" r="1" fill="currentColor" />
            </svg>
          </span>
          <span className="text-sm font-semibold tracking-tight text-white">
            Niteowl <span className="text-white/40">AI</span>
          </span>
        </div>

        <p className="text-sm font-medium uppercase tracking-wide text-red-400">
          Something went wrong
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-white">
          We hit a snag on our end
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-white/40">
          This has been reported to our team automatically. Try again, or
          head back to your dashboard.
        </p>

        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 transition hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0f14]"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="rounded-xl border border-white/10 px-5 py-2.5 text-sm font-medium text-white/70 transition hover:border-white/20 hover:text-white"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
