"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface BusinessHoursRow {
  day_of_week: number;
  is_closed: boolean;
  open_time: string | null;
  close_time: string | null;
  lunch_start: string | null;
  lunch_end: string | null;
}

interface BookingData {
  status: string;
  appointmentDatetime: string | null;
  serviceNeeded: string | null;
  customerName: string | null;
  businessName: string;
  appointmentDurationMinutes: number;
  emergencyModeEnabled: boolean;
  businessHours: BusinessHoursRow[];
}

function formatDisplayDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(new Date(iso));
}

// Splits an ISO instant into the "YYYY-MM-DD" / "HH:MM" wall-clock
// values it represents in Europe/London, for prefilling the picker.
function isoToLondonParts(iso: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return { date: `${map.year}-${map.month}-${map.day}`, time: `${map.hour}:${map.minute}` };
}

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function ManageBookingClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(Boolean(token));
  const [notFound, setNotFound] = useState(!token);
  const [data, setData] = useState<BookingData | null>(null);

  const [mode, setMode] = useState<"view" | "reschedule" | "confirmCancel">("view");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [suggestedAlternative, setSuggestedAlternative] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");

  useEffect(() => {
    if (!token) return;

    fetch(`/api/bookings/manage?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const json: BookingData = await res.json();
        setData(json);
        if (json.appointmentDatetime) {
          const parts = isoToLondonParts(json.appointmentDatetime);
          setRescheduleDate(parts.date);
          setRescheduleTime(parts.time);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleCancel() {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch("/api/bookings/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: "cancel" }),
      });
      const json = await res.json();
      if (!res.ok) {
        setActionError(json.error ?? "Failed to cancel booking.");
        return;
      }
      setData((prev) => (prev ? { ...prev, status: "cancelled" } : prev));
      setSuccessMessage("Your booking has been cancelled.");
      setMode("view");
    } catch {
      setActionError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitReschedule(date: string, time: string) {
    setBusy(true);
    setActionError(null);
    setSuggestedAlternative(null);
    try {
      const res = await fetch("/api/bookings/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: "reschedule", date, time }),
      });
      const json = await res.json();
      if (!res.ok) {
        setActionError(json.error ?? "Failed to reschedule booking.");
        if (json.suggestedAlternative) setSuggestedAlternative(json.suggestedAlternative);
        return;
      }
      setData((prev) =>
        prev ? { ...prev, appointmentDatetime: json.appointmentDatetime } : prev
      );
      setSuccessMessage("Your booking has been rescheduled.");
      setMode("view");
    } catch {
      setActionError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function acceptSuggestedAlternative() {
    if (!suggestedAlternative) return;
    const parts = isoToLondonParts(suggestedAlternative);
    setRescheduleDate(parts.date);
    setRescheduleTime(parts.time);
    submitReschedule(parts.date, parts.time);
  }

  const cardCls =
    "w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-8 text-center";

  if (loading) {
    return (
      <Shell>
        <div className={cardCls}>
          <p className="text-slate-400 text-sm">Loading your booking…</p>
        </div>
      </Shell>
    );
  }

  if (notFound || !data) {
    return (
      <Shell>
        <div className={cardCls}>
          <h2 className="text-white font-bold text-xl mb-2">Booking not found</h2>
          <p className="text-slate-400 text-sm leading-relaxed">
            This link is invalid or has expired. If you need help with your booking,
            please contact the business directly.
          </p>
        </div>
      </Shell>
    );
  }

  if (data.status !== "booked") {
    return (
      <Shell>
        <div className={cardCls}>
          <h2 className="text-white font-bold text-xl mb-2">
            {data.status === "cancelled" ? "Booking cancelled" : "This booking can no longer be managed"}
          </h2>
          <p className="text-slate-400 text-sm leading-relaxed">
            {data.status === "cancelled"
              ? "This booking has already been cancelled."
              : `Please contact ${data.businessName} directly for help with this booking.`}
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-8">
        <h1 className="text-white font-bold text-xl mb-1">Manage your booking</h1>
        <p className="text-slate-400 text-sm mb-6">with {data.businessName}</p>

        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 mb-6 text-sm">
          <p className="text-white font-medium">{formatDisplayDate(data.appointmentDatetime)}</p>
          {data.serviceNeeded && <p className="text-slate-400 mt-1">{data.serviceNeeded}</p>}
        </div>

        {successMessage && (
          <div className="bg-emerald-950 border border-emerald-800 text-emerald-300 text-sm rounded-lg px-3.5 py-2.5 mb-4">
            {successMessage}
          </div>
        )}

        {actionError && (
          <div className="bg-red-950 border border-red-800 text-red-300 text-sm rounded-lg px-3.5 py-2.5 mb-4">
            {actionError}
            {suggestedAlternative && (
              <div className="mt-2">
                <button
                  onClick={acceptSuggestedAlternative}
                  disabled={busy}
                  className="text-indigo-400 hover:text-indigo-300 font-medium underline disabled:opacity-50"
                >
                  Use {formatDisplayDate(suggestedAlternative)} instead
                </button>
              </div>
            )}
          </div>
        )}

        {mode === "view" && (
          <div className="flex gap-3">
            <button
              onClick={() => setMode("reschedule")}
              className="flex-1 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              Reschedule
            </button>
            <button
              onClick={() => setMode("confirmCancel")}
              className="flex-1 bg-red-950 hover:bg-red-900 border border-red-800 text-red-300 font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              Cancel booking
            </button>
          </div>
        )}

        {mode === "confirmCancel" && (
          <div>
            <p className="text-slate-300 text-sm mb-4">
              Are you sure you want to cancel this booking? This can&apos;t be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setMode("view")}
                disabled={busy}
                className="flex-1 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-medium py-2.5 rounded-lg transition-colors text-sm disabled:opacity-50"
              >
                Keep booking
              </button>
              <button
                onClick={handleCancel}
                disabled={busy}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm disabled:opacity-50"
              >
                {busy ? "Cancelling…" : "Yes, cancel"}
              </button>
            </div>
          </div>
        )}

        {mode === "reschedule" && (
          <div>
            {!data.emergencyModeEnabled && (
              <p className="text-slate-500 text-xs mb-3">
                {openDaysSummary(data.businessHours)}
              </p>
            )}
            <div className="flex gap-3 mb-4">
              <div className="flex-1">
                <label className="block text-slate-300 text-xs font-medium mb-1.5 uppercase tracking-wide">
                  Date
                </label>
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex-1">
                <label className="block text-slate-300 text-xs font-medium mb-1.5 uppercase tracking-wide">
                  Time
                </label>
                <input
                  type="time"
                  value={rescheduleTime}
                  onChange={(e) => setRescheduleTime(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setMode("view")}
                disabled={busy}
                className="flex-1 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-medium py-2.5 rounded-lg transition-colors text-sm disabled:opacity-50"
              >
                Back
              </button>
              <button
                onClick={() => submitReschedule(rescheduleDate, rescheduleTime)}
                disabled={busy || !rescheduleDate || !rescheduleTime}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? "Saving…" : "Confirm new time"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}

function openDaysSummary(hours: BusinessHoursRow[]): string {
  const open = hours
    .filter((h) => !h.is_closed && h.open_time && h.close_time)
    .sort((a, b) => a.day_of_week - b.day_of_week);

  if (open.length === 0) return "";

  return (
    "Open " +
    open
      .map((h) => `${DAY_LABELS[h.day_of_week]} ${h.open_time?.slice(0, 5)}–${h.close_time?.slice(0, 5)}`)
      .join(", ")
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0d0f14] flex items-center justify-center px-4 py-12">
      <div className="w-full flex flex-col items-center">
        <div className="mb-6 text-sm font-semibold tracking-tight text-white">
          niteowl<span className="text-white/40">.</span>
        </div>
        {children}
      </div>
    </div>
  );
}
