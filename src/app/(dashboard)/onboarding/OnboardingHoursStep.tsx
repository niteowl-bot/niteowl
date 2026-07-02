"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

interface DayFormState {
  day_of_week: number;
  is_closed: boolean;
  open_time: string;
  close_time: string;
  lunch_start: string;
  lunch_end: string;
}

function buildInitialDays(): DayFormState[] {
  return Array.from({ length: 7 }, (_, day) => ({
    day_of_week: day,
    is_closed: day === 0,
    open_time: "09:00",
    close_time: "17:00",
    lunch_start: "",
    lunch_end: "",
  }));
}

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function validateDay(d: DayFormState): string | null {
  if (d.is_closed) return null;
  if (!d.open_time || !d.close_time) return "Open and close time are required.";
  if (toMinutes(d.close_time) <= toMinutes(d.open_time)) {
    return "Close time must be after open time.";
  }
  const hasLunchStart = !!d.lunch_start;
  const hasLunchEnd = !!d.lunch_end;
  if (hasLunchStart !== hasLunchEnd) {
    return "Both lunch start and end are required if either is set.";
  }
  if (hasLunchStart && hasLunchEnd) {
    if (toMinutes(d.lunch_end) <= toMinutes(d.lunch_start)) {
      return "Lunch end must be after lunch start.";
    }
    if (
      toMinutes(d.lunch_start) < toMinutes(d.open_time) ||
      toMinutes(d.lunch_end) > toMinutes(d.close_time)
    ) {
      return "Lunch break must fall within open hours.";
    }
  }
  return null;
}

export default function OnboardingHoursStep({
  orgId,
  onNext,
}: {
  orgId: string;
  onNext: () => void;
}) {
  const [days, setDays] = useState<DayFormState[]>(buildInitialDays);
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function updateDay(index: number, updates: Partial<DayFormState>) {
    setDays((prev) =>
      prev.map((d, i) => (i === index ? { ...d, ...updates } : d))
    );
  }

  const dayErrors = emergencyMode ? days.map(() => null) : days.map(validateDay);
  const hasErrors = dayErrors.some(Boolean);

  async function handleSaveAndContinue() {
    if (hasErrors) {
      setSaveError("Please fix the errors below before continuing.");
      return;
    }

    setSaving(true);
    setSaveError(null);

    const supabase = createClient();

    const hoursPayload = days.map((d) => ({
      org_id: orgId,
      day_of_week: d.day_of_week,
      is_closed: d.is_closed,
      open_time: d.is_closed ? null : d.open_time,
      close_time: d.is_closed ? null : d.close_time,
      lunch_start: d.is_closed || !d.lunch_start ? null : d.lunch_start,
      lunch_end: d.is_closed || !d.lunch_end ? null : d.lunch_end,
    }));

    const { error: hoursError } = await supabase
      .from("business_hours")
      .upsert(hoursPayload, { onConflict: "org_id,day_of_week" });

    if (hoursError) {
      setSaveError("Failed to save business hours. Please try again.");
      setSaving(false);
      return;
    }

    const { error: orgError } = await supabase
      .from("organisations")
      .update({ emergency_mode_enabled: emergencyMode })
      .eq("id", orgId);

    if (orgError) {
      setSaveError("Failed to save emergency mode setting. Please try again.");
      setSaving(false);
      return;
    }

    setSaving(false);
    onNext();
  }

  const inputCls =
    "rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-500 transition disabled:opacity-40";

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-xl font-semibold text-white">Business Hours</h1>
      <p className="mb-8 text-sm text-slate-400">
        Set your opening hours and lunch breaks. Remy uses this to avoid
        booking outside your working hours. You can fine-tune appointment
        length and capacity later in Settings.
      </p>

      <div className="mb-6 flex items-center justify-between rounded-xl border border-slate-800 bg-slate-800/50 p-4">
        <div>
          <p className="text-sm font-medium text-white">24/7 Emergency Mode</p>
          <p className="mt-0.5 text-xs text-slate-400">
            When enabled, Remy will accept bookings at any time, ignoring
            the hours below.
          </p>
        </div>
        <button
          onClick={() => setEmergencyMode((v) => !v)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${
            emergencyMode ? "bg-blue-600" : "bg-slate-700"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
              emergencyMode ? "left-5" : "left-0.5"
            }`}
          />
        </button>
      </div>

      <div className="space-y-2">
        {days.map((day, index) => (
          <div
            key={day.day_of_week}
            className="rounded-xl border border-slate-800 bg-slate-800/50 p-4"
          >
            <div className="flex flex-wrap items-center gap-4">
              <span className="w-28 shrink-0 text-sm font-medium text-white">
                {DAY_LABELS[day.day_of_week]}
              </span>

              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={day.is_closed}
                  onChange={(e) =>
                    updateDay(index, { is_closed: e.target.checked })
                  }
                />
                Closed
              </label>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Open</span>
                <input
                  type="time"
                  value={day.open_time}
                  disabled={day.is_closed || emergencyMode}
                  onChange={(e) =>
                    updateDay(index, { open_time: e.target.value })
                  }
                  className={inputCls}
                />
                <span className="text-xs text-slate-500">Close</span>
                <input
                  type="time"
                  value={day.close_time}
                  disabled={day.is_closed || emergencyMode}
                  onChange={(e) =>
                    updateDay(index, { close_time: e.target.value })
                  }
                  className={inputCls}
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Lunch</span>
                <input
                  type="time"
                  value={day.lunch_start}
                  disabled={day.is_closed || emergencyMode}
                  onChange={(e) =>
                    updateDay(index, { lunch_start: e.target.value })
                  }
                  className={inputCls}
                />
                <span className="text-xs text-slate-500">to</span>
                <input
                  type="time"
                  value={day.lunch_end}
                  disabled={day.is_closed || emergencyMode}
                  onChange={(e) =>
                    updateDay(index, { lunch_end: e.target.value })
                  }
                  className={inputCls}
                />
              </div>
            </div>
            {dayErrors[index] && (
              <p className="mt-2 text-xs text-red-400">{dayErrors[index]}</p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-8 flex items-center gap-4">
        <button
          onClick={handleSaveAndContinue}
          disabled={saving || hasErrors}
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition"
        >
          {saving ? "Saving…" : "Save & Continue"}
        </button>
        {saveError && <p className="text-sm text-red-400">{saveError}</p>}
      </div>
    </div>
  );
}
