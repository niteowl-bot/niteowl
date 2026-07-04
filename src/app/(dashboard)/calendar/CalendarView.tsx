"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// ── Types ─────────────────────────────────────────────────────────

export type CalendarLead = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  service_needed: string | null;
  preferred_datetime: string | null;
  appointment_datetime: string | null;
  message: string | null;
  source: string | null;
  status: string | null;
  ai_confidence: number | null;
  notes: string | null;
  created_at: string;
};

type View = "month" | "week" | "day";

type LeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "booked"
  | "lost"
  | "cancelled";

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "booked", label: "Booked" },
  { value: "lost", label: "Lost" },
  { value: "cancelled", label: "Cancelled" },
];

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-500/80 border-blue-400 text-white",
  contacted: "bg-yellow-500/80 border-yellow-400 text-white",
  qualified: "bg-purple-500/80 border-purple-400 text-white",
  booked: "bg-emerald-500/80 border-emerald-400 text-white",
  lost: "bg-slate-600/80 border-slate-500 text-slate-200",
  cancelled: "bg-red-500/80 border-red-400 text-white",
};

const STATUS_STYLES: Record<string, string> = {
  new: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  contacted: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  qualified: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  booked: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  lost: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  cancelled: "bg-red-500/15 text-red-300 border-red-500/30",
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ── Helpers ───────────────────────────────────────────────────────

function valueOrDash(value: string | null | undefined) {
  return value && value.trim() ? value : "—";
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(new Date(value));
}

// "Today" must resolve identically on the server render and the client
// hydration pass, regardless of which timezone each machine's runtime
// defaults to — otherwise the isToday highlight (and the SSR'd date
// text above) can disagree between the two, which React reports as a
// hydration mismatch. Pin it to the business's timezone, matching the
// booking logic in src/lib/availability.ts.
function getLondonToday(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  return new Date(year, month - 1, day);
}

/**
 * Try to parse preferred_datetime (a free-text string like "tomorrow at 4pm",
 * "4pm tomorrow", "2024-07-01", etc.) into a JS Date.
 * Returns null if unparseable.
 */
function parseAppointmentDate(dt: string | null): Date | null {
  if (!dt) return null;
  const parsed = new Date(dt);
  if (!isNaN(parsed.getTime())) return parsed;
  return null;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// ── EditPanel ─────────────────────────────────────────────────────

function EditPanel({
  lead,
  onClose,
  onUpdate,
}: {
  lead: CalendarLead;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<CalendarLead>) => void;
}) {
  const [status, setStatus] = useState<LeadStatus>(
    (lead.status as LeadStatus) ?? "new"
  );
  const [service, setService] = useState(lead.service_needed ?? "");
  const [datetime, setDatetime] = useState(lead.preferred_datetime ?? "");
  const [notes, setNotes] = useState(lead.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);

    const supabase = createClient();
    const updates = {
      status,
      service_needed: service.trim() || null,
      preferred_datetime: datetime.trim() || null,
      notes: notes.trim() || null,
    };

    const { error } = await supabase
      .from("leads")
      .update(updates)
      .eq("id", lead.id);

    if (error) {
      setSaveError("Failed to save. Please try again.");
      setSaving(false);
    } else {
      onUpdate(lead.id, updates);
      onClose();
    }
  }

  const statusStyle =
    STATUS_STYLES[status] ?? "bg-slate-500/15 text-slate-400 border-slate-500/30";

  const inputCls =
    "w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-blue-500 transition";

  const labelCls =
    "mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400";

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-slate-900 shadow-2xl border-l border-slate-800">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">
              {lead.name ?? "Unknown customer"}
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {formatDate(lead.created_at)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Contact</p>
            <div className="grid gap-2 rounded-xl border border-slate-800 bg-slate-800/50 p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Phone</span>
                <span className="text-slate-200">{valueOrDash(lead.phone)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Email</span>
                <span className="text-slate-200 break-all">{valueOrDash(lead.email)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Appointment</span>
                <span className="text-slate-200">{valueOrDash(lead.preferred_datetime)}</span>
              </div>
            </div>
          </section>

          {lead.message && (
            <section>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Customer message</p>
              <div className="rounded-xl border border-slate-800 bg-slate-800/50 p-4 space-y-2">
                {lead.message.split("\n").filter(Boolean).map((line, i) => (
                  <p key={i} className="text-sm leading-relaxed text-slate-300">{line}</p>
                ))}
              </div>
            </section>
          )}

          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Edit appointment</p>
            <div className="space-y-4">
              <div>
                <label className={labelCls}>Status</label>
                <div className="relative">
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as LeadStatus)}
                    className={`${inputCls} appearance-none pr-9`}
                  >
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value} className="bg-slate-900">{o.label}</option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                      <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </div>
                <div className="mt-2">
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs capitalize ${statusStyle}`}>{status}</span>
                </div>
              </div>

              <div>
                <label className={labelCls}>Service needed</label>
                <input type="text" value={service} onChange={(e) => setService(e.target.value)} placeholder="e.g. Boiler repair" className={inputCls} />
              </div>

              <div>
                <label className={labelCls}>Appointment time</label>
                <input type="text" value={datetime} onChange={(e) => setDatetime(e.target.value)} placeholder="e.g. Tomorrow at 4pm" className={inputCls} />
              </div>

              <div>
                <label className={labelCls}>Staff notes</label>
                <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes..." className={`${inputCls} resize-none`} />
              </div>
            </div>
          </section>
        </div>

        <div className="border-t border-slate-800 px-6 py-4">
          {saveError && <p className="mb-3 text-sm text-red-400">{saveError}</p>}
          <div className="flex gap-3">
            <button onClick={handleSave} disabled={saving} className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition">
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button onClick={onClose} className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800 transition">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── AppointmentChip ───────────────────────────────────────────────

function AppointmentChip({
  lead,
  onClick,
}: {
  lead: CalendarLead;
  onClick: () => void;
}) {
  const color = STATUS_COLORS[lead.status ?? ""] ?? STATUS_COLORS.new;
  return (
    <button
      onClick={onClick}
      className={`w-full rounded border px-2 py-1 text-left text-xs font-medium truncate transition hover:opacity-90 ${color}`}
    >
      {lead.name ?? "Unknown"} — {lead.service_needed ?? "Appointment"}
    </button>
  );
}

// ── Month view ────────────────────────────────────────────────────

function MonthView({
  year,
  month,
  leads,
  onSelect,
}: {
  year: number;
  month: number;
  leads: CalendarLead[];
  onSelect: (lead: CalendarLead) => void;
}) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  // Pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null);

  const today = getLondonToday();

  function leadsForDay(day: number) {
    const d = new Date(year, month, day);
    return leads.filter((l) => {
      const parsed = parseAppointmentDate(l.appointment_datetime);
      return parsed && isSameDay(parsed, d);
    });
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="grid grid-cols-7 border-b border-slate-800">
        {DAYS.map((d) => (
          <div key={d} className="py-2 text-center text-xs font-medium text-slate-400">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          const isToday = day !== null && isSameDay(new Date(year, month, day), today);
          const dayLeads = day ? leadsForDay(day) : [];
          return (
            <div
              key={i}
              className={`min-h-[90px] border-b border-r border-slate-800/60 p-1.5 ${
                day === null ? "bg-slate-900/30" : "bg-slate-900/50"
              }`}
            >
              {day !== null && (
                <>
                  <span
                    className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                      isToday
                        ? "bg-blue-600 text-white"
                        : "text-slate-400"
                    }`}
                  >
                    {day}
                  </span>
                  <div className="space-y-0.5">
                    {dayLeads.slice(0, 3).map((l) => (
                      <AppointmentChip key={l.id} lead={l} onClick={() => onSelect(l)} />
                    ))}
                    {dayLeads.length > 3 && (
                      <p className="text-[10px] text-slate-500">+{dayLeads.length - 3} more</p>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Week view ─────────────────────────────────────────────────────

function WeekView({
  weekStart,
  leads,
  onSelect,
}: {
  weekStart: Date;
  leads: CalendarLead[];
  onSelect: (lead: CalendarLead) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = getLondonToday();

  return (
    <div className="flex-1 overflow-auto">
      <div className="grid grid-cols-7 border-b border-slate-800">
        {days.map((d, i) => {
          const isToday = isSameDay(d, today);
          return (
            <div key={i} className="py-3 text-center">
              <p className="text-xs text-slate-400">{DAYS[d.getDay()]}</p>
              <span
                className={`mx-auto mt-1 flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium ${
                  isToday ? "bg-blue-600 text-white" : "text-slate-200"
                }`}
              >
                {d.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-7 divide-x divide-slate-800">
        {days.map((d, i) => {
          const dayLeads = leads.filter((l) => {
            const parsed = parseAppointmentDate(l.appointment_datetime);
            return parsed && isSameDay(parsed, d);
          });
          return (
            <div key={i} className="min-h-[400px] p-2 space-y-1.5">
              {dayLeads.map((l) => (
                <AppointmentChip key={l.id} lead={l} onClick={() => onSelect(l)} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Day view ──────────────────────────────────────────────────────

function DayView({
  date,
  leads,
  onSelect,
}: {
  date: Date;
  leads: CalendarLead[];
  onSelect: (lead: CalendarLead) => void;
}) {
  const dayLeads = leads.filter((l) => {
    const parsed = parseAppointmentDate(l.appointment_datetime);
    return parsed && isSameDay(parsed, date);
  });

  const isToday = isSameDay(date, getLondonToday());

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mb-6 flex items-center gap-3">
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-full text-lg font-semibold ${
            isToday ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-200"
          }`}
        >
          {date.getDate()}
        </span>
        <div>
          <p className="font-semibold text-white">
            {DAYS[date.getDay()]}, {MONTHS[date.getMonth()]} {date.getDate()}
          </p>
          <p className="text-sm text-slate-400">
            {dayLeads.length} appointment{dayLeads.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {dayLeads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 py-12 text-center">
          <p className="text-sm text-slate-500">No appointments this day.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {dayLeads.map((l) => {
            const color = STATUS_COLORS[l.status ?? ""] ?? STATUS_COLORS.new;
            return (
              <button
                key={l.id}
                onClick={() => onSelect(l)}
                className={`w-full rounded-xl border p-4 text-left transition hover:opacity-90 ${color}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{l.name ?? "Unknown customer"}</p>
                    <p className="mt-0.5 text-sm opacity-90">
                      {l.service_needed ?? "Appointment"}
                    </p>
{l.appointment_datetime && (
  <p className="mt-1 text-xs opacity-75">
    {new Intl.DateTimeFormat("en-IE", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/London",
    }).format(new Date(l.appointment_datetime))}
  </p>
)}
   
                  </div>
                  <span className="shrink-0 rounded-full bg-white/20 px-2.5 py-0.5 text-xs capitalize">
                    {l.status}
                  </span>
                </div>
                {l.phone && (
                  <p className="mt-2 text-xs opacity-75">📞 {l.phone}</p>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── CalendarView (main) ───────────────────────────────────────────

export default function CalendarView({
  leads: initialLeads,
  businessName,
}: {
  leads: CalendarLead[];
  businessName: string | null;
}) {
  const today = getLondonToday();
  const [view, setView] = useState<View>("month");
  const [currentDate, setCurrentDate] = useState(today);
  const [leads, setLeads] = useState<CalendarLead[]>(initialLeads);
  const [editingLead, setEditingLead] = useState<CalendarLead | null>(null);

  function handleUpdate(id: string, updates: Partial<CalendarLead>) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates } : l)));
  }

  // Parseable leads only (those with a date we can actually position)
  const parseableLeads = useMemo(
    () => leads.filter((l) => parseAppointmentDate(l.appointment_datetime) !== null),
    [leads]
  );

  // Navigation
  function prev() {
    const d = new Date(currentDate);
    if (view === "month") d.setMonth(d.getMonth() - 1);
    else if (view === "week") d.setDate(d.getDate() - 7);
    else d.setDate(d.getDate() - 1);
    setCurrentDate(d);
  }

  function next() {
    const d = new Date(currentDate);
    if (view === "month") d.setMonth(d.getMonth() + 1);
    else if (view === "week") d.setDate(d.getDate() + 7);
    else d.setDate(d.getDate() + 1);
    setCurrentDate(d);
  }

  function goToday() {
    setCurrentDate(new Date());
  }

  // Header title
  function headerTitle() {
    if (view === "month") {
      return `${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    }
    if (view === "week") {
      const ws = startOfWeek(currentDate);
      const we = addDays(ws, 6);
      return `${ws.getDate()} ${MONTHS[ws.getMonth()]} — ${we.getDate()} ${MONTHS[we.getMonth()]} ${we.getFullYear()}`;
    }
    return `${DAYS[currentDate.getDay()]}, ${MONTHS[currentDate.getMonth()]} ${currentDate.getDate()} ${currentDate.getFullYear()}`;
  }

  return (
    <>
      {editingLead && (
        <EditPanel
          lead={editingLead}
          onClose={() => setEditingLead(null)}
          onUpdate={(id, updates) => {
            handleUpdate(id, updates);
            setEditingLead(null);
          }}
        />
      )}

      <div className="flex h-screen flex-col bg-slate-950 text-white overflow-hidden">
        {/* Header */}
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-800 px-6 py-4">
          <Link href="/dashboard" className="text-sm text-slate-400 hover:text-white transition">
            ← Dashboard
          </Link>

          <div className="flex items-center gap-2 ml-2">
            <button onClick={prev} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <h1 className="min-w-[200px] text-center text-sm font-semibold text-white">
              {headerTitle()}
            </h1>
            <button onClick={next} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <button onClick={goToday} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 transition">
            Today
          </button>

          <div className="ml-auto flex rounded-lg border border-slate-700 overflow-hidden">
            {(["day", "week", "month"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs capitalize transition ${
                  view === v
                    ? "bg-blue-600 text-white"
                    : "text-slate-400 hover:bg-slate-800 hover:text-white"
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            {Object.entries(STATUS_COLORS).map(([s, cls]) => (
              <span key={s} className="flex items-center gap-1">
                <span className={`h-2 w-2 rounded-full ${cls.split(" ")[0]}`} />
                <span className="capitalize">{s}</span>
              </span>
            ))}
          </div>
        </header>

        {/* Calendar body */}
        {view === "month" && (
          <MonthView
            year={currentDate.getFullYear()}
            month={currentDate.getMonth()}
            leads={parseableLeads}
            onSelect={setEditingLead}
          />
        )}
        {view === "week" && (
          <WeekView
            weekStart={startOfWeek(currentDate)}
            leads={parseableLeads}
            onSelect={setEditingLead}
          />
        )}
        {view === "day" && (
          <DayView
            date={currentDate}
            leads={parseableLeads}
            onSelect={setEditingLead}
          />
        )}

        {/* Unscheduled appointments note */}
        {leads.length > parseableLeads.length && (
          <div className="shrink-0 border-t border-slate-800 px-6 py-3 text-xs text-slate-500">
            {leads.length - parseableLeads.length} lead(s) have free-text appointment times that cannot be placed on the calendar (e.g. &quot;tomorrow at 4pm&quot;). Update them in the{" "}
            <Link href="/leads" className="text-blue-400 hover:underline">Leads page</Link> to show here.
          </div>
        )}
      </div>
    </>
  );
}
