"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { BusinessHoursRow } from "./page";

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

function buildInitialDays(initialHours: BusinessHoursRow[]): DayFormState[] {
  return Array.from({ length: 7 }, (_, day) => {
    const existing = initialHours.find((h) => h.day_of_week === day);
    return {
      day_of_week: day,
      is_closed: existing?.is_closed ?? day === 0,
      open_time: existing?.open_time?.slice(0, 5) ?? "09:00",
      close_time: existing?.close_time?.slice(0, 5) ?? "17:00",
      lunch_start: existing?.lunch_start?.slice(0, 5) ?? "",
      lunch_end: existing?.lunch_end?.slice(0, 5) ?? "",
    };
  });
}

export default function HoursForm({
  orgId,
  initialHours,
  initialDuration,
  initialEmergencyMode,
}: {
  orgId: string;
  initialHours: BusinessHoursRow[];
  initialDuration: number;
  initialEmergencyMode: boolean;
}) {
  const [days, setDays] = useState<DayFormState[]>(() =>
    buildInitialDays(initialHours)
  );
  const [duration, setDuration] = useState(initialDuration);
  const [emergencyMode, setEmergencyMode] = useState(initialEmergencyMode);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function updateDay(index: number, updates: Partial<DayFormState>) {
    setDays((prev) =>
      prev.map((d, i) => (i === index ? { ...d, ...updates } : d))
    );
  }

  async function handleSave() {
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
      .update({
        appointment_duration_minutes: duration,
        emergency_mode_enabled: emergencyMode,
      })
      .eq("id", orgId);

    if (orgError) {
      setSaveError("Failed to save appointment settings. Please try again.");
      setSaving(false);
      return;
    }

    setSaving(false);
    setSavedAt(Date.now());
  }

  const inputCls =
    "rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-500 transition disabled:opacity-40";

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-xl font-semibold text-white">
        Business Hours
      </h1>
      <p className="mb-8 text-sm text-slate-400">
        Set your opening hours, lunch breaks, and appointment length. Remy
        uses this to avoid booking outside your working hours.
      </p>

      {/* Emergency mode toggle */}
      <div className="mb-6 flex items-center justify-between rounded-xl border border-slate-800 bg-slate-800/50 p-4">
        <div>
          <p className="text-sm font-medium text-white">
            24/7 Emergency Mode
          </p>
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

      {/* Appointment duration */}
      <div className="mb-6 rounded-xl border border-slate-800 bg-slate-800/50 p-4">
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">
          Appointment Duration (minutes)
        </label>
        <input
          type="number"
          min={5}
          step={5}
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          className={`${inputCls} w-32`}
        />
      </div>

      {/* Weekday rows */}
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
          </div>
        ))}
      </div>

      {/* Save */}
      <div className="mt-8 flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {saveError && <p className="text-sm text-red-400">{saveError}</p>}
        {savedAt && !saveError && (
          <p className="text-sm text-emerald-400">Saved ✓</p>
        )}
      </div>
    </div>
  );
}
