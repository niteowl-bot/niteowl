"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function CalendarSettings({
  connected,
  accountEmail,
}: {
  connected: boolean;
  accountEmail: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One-time status from the OAuth callback redirect (?calendar=...).
  const callbackStatus = searchParams.get("calendar");

  async function handleDisconnect() {
    setDisconnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar/google/disconnect", { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Could not disconnect.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect.");
      setDisconnecting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-white">Calendar</h1>
      <p className="mt-2 text-slate-400">
        Connect your Google Calendar so Remy can check your real availability
        and add appointments directly to it.
      </p>

      {callbackStatus === "error" && (
        <div className="mt-6 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Something went wrong connecting your calendar. Please try again.
        </div>
      )}
      {callbackStatus === "cancelled" && (
        <div className="mt-6 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          Calendar connection was cancelled.
        </div>
      )}

      <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        {connected ? (
          <>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-sm font-medium text-white">
                Google Calendar connected
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              {accountEmail
                ? `Connected as ${accountEmail}.`
                : "Your Google Calendar is connected."}
            </p>
            <div className="mt-5">
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="rounded-lg border border-slate-700 px-5 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
              >
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-slate-500" />
              <span className="text-sm font-medium text-white">Not connected</span>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              Connect your Google Calendar to enable real-time availability and
              automatic calendar bookings.
            </p>
            <div className="mt-5">
              {/* A plain link, not a fetch — /connect issues a redirect to
                  Google's consent screen, so the browser must navigate to it. */}
              <a
                href="/api/calendar/google/connect"
                className="inline-block rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500"
              >
                Connect Google Calendar
              </a>
            </div>
          </>
        )}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
