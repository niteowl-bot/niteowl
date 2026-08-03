"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// ── Types ────────────────────────────────────────────────────────

export type Lead = {
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
  // Voice calls record phone provenance here: caller_id is the number
  // the call came from, alternate_phone a different number the caller
  // asked to be reached on. Absent on chat/widget leads.
  metadata: Record<string, unknown> | null;
  created_at: string;
};

// Reads a string field out of the lead's metadata JSONB, or null.
function metadataString(lead: Lead, key: string): string | null {
  const value = lead.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Must list every status the lead engine can write (see LeadStatus in
// leadCapture.ts). A status missing here has no <option> to select, so
// the dropdown falls back to showing the first one ("New") while the
// badge beside it shows the real value — the row and the editor
// disagreeing about the same lead. awaiting_confirmation (a voice
// appointment request the business still has to confirm) and
// needs_review were both missing.
type LeadStatus =
  | "new"
  | "awaiting_confirmation"
  | "contacted"
  | "qualified"
  | "booked"
  | "needs_review"
  | "lost"
  | "cancelled";

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "awaiting_confirmation", label: "Awaiting confirmation" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "booked", label: "Booked" },
  { value: "needs_review", label: "Needs review" },
  { value: "lost", label: "Lost" },
  { value: "cancelled", label: "Cancelled" },
];

const STATUS_STYLES: Record<string, string> = {
  new: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  awaiting_confirmation: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  contacted: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  qualified: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  booked: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  needs_review: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  lost: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  cancelled: "bg-red-500/15 text-red-300 border-red-500/30",
};

/** The label the dropdown uses, so a row and the editor read the same. */
function statusLabel(value: string | null): string | null {
  if (!value) return null;
  return STATUS_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

// ── Helpers ──────────────────────────────────────────────────────

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

function valueOrDash(value: string | null | undefined) {
  return value && value.trim() ? value : "—";
}

// Converts an ISO timestamp to the local "YYYY-MM-DDTHH:mm" value a
// <input type="datetime-local"> expects, in the browser's own timezone.
function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Shows the confirmed appointment once one exists; falls back to the
// customer's originally stated preference for leads not yet booked.
function displayAppointment(lead: Lead) {
  return lead.appointment_datetime
    ? formatDate(lead.appointment_datetime)
    : valueOrDash(lead.preferred_datetime);
}

// ── SummaryPreview ───────────────────────────────────────────────
// Compact, height-safe preview of the service / enquiry summary. Clamps
// to at most two lines with an ellipsis so a long voice-call summary can
// never stretch the row; the full text is shown in the details drawer.

function SummaryPreview({ text }: { text: string | null | undefined }) {
  if (!text || !text.trim())
    return <span className="text-slate-600">—</span>;
  return (
    <p className="line-clamp-2 break-words leading-snug text-slate-300">{text}</p>
  );
}

// ── EditPanel (slide-out) ────────────────────────────────────────

function EditPanel({
  lead,
  onClose,
  onUpdate,
}: {
  lead: Lead;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<Lead>) => void;
}) {
  const [status, setStatus] = useState<LeadStatus>(
    (lead.status as LeadStatus) ?? "new"
  );
  const [service, setService] = useState(lead.service_needed ?? "");
  // Once a booking is confirmed, the calendar reads appointment_datetime
  // exclusively — editing must target that field, not preferred_datetime,
  // or the change silently never shows up on the calendar.
  const hasConfirmedAppointment = Boolean(lead.appointment_datetime);
  const [datetime, setDatetime] = useState(
    hasConfirmedAppointment
      ? toDatetimeLocalValue(lead.appointment_datetime)
      : lead.preferred_datetime ?? ""
  );
  const [notes, setNotes] = useState(lead.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);

    // When Booked, the appointment field is a datetime-local picker; parse it
    // to an ISO timestamp. A lead may only be Booked with a valid appointment
    // date/time (the calendar reads appointment_datetime), so refuse to save
    // otherwise — the DB CHECK constraint is the final backstop.
    const usesDatetimePicker = hasConfirmedAppointment || status === "booked";
    const appointmentIso =
      usesDatetimePicker && datetime.trim()
        ? new Date(datetime).toISOString()
        : null;

    if (status === "booked" && (!appointmentIso || Number.isNaN(Date.parse(appointmentIso)))) {
      setSaveError("Add an appointment date and time before marking this lead as Booked.");
      setSaving(false);
      return;
    }

    const supabase = createClient();
    const updates = usesDatetimePicker
      ? {
          status,
          service_needed: service.trim() || null,
          appointment_datetime: appointmentIso,
          notes: notes.trim() || null,
        }
      : {
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
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-slate-900 shadow-2xl border-l border-slate-800">
        {/* Header */}
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
            aria-label="Close panel"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Contact info */}
          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Contact
            </p>
            <div className="grid gap-2 rounded-xl border border-slate-800 bg-slate-800/50 p-4 text-sm">
              <div className="flex justify-between">
                {/* For a phone lead this is the network caller ID — the
                    number the call actually came from, not one spoken
                    during it. */}
                <span className="text-slate-400">
                  {metadataString(lead, "caller_id") ? "Caller ID" : "Phone"}
                </span>
                <span className="text-slate-200">{valueOrDash(lead.phone)}</span>
              </div>
              {metadataString(lead, "alternate_phone") && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Alternate number</span>
                  <span className="text-slate-200">
                    {metadataString(lead, "alternate_phone")}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-400">Email</span>
                <span className="text-slate-200 break-all">{valueOrDash(lead.email)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Source</span>
                <span className="capitalize text-slate-200">{valueOrDash(lead.source)}</span>
              </div>
            </div>
          </section>

          {/* Full enquiry / call summary */}
          {lead.message && (
            <section>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Enquiry summary
              </p>
              <div className="rounded-xl border border-slate-800 bg-slate-800/50 p-4 space-y-2">
  {(lead.message ?? "").split("\n").filter(Boolean).map((line, i) => (
    <p key={i} className="text-sm leading-relaxed text-slate-300">
      {line}
    </p>
  ))}
</div>

            </section>
          )}

          {/* Editable fields */}
          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Edit lead
            </p>
            <div className="space-y-4">
              {/* Status */}
              <div>
                <label className={labelCls}>Status</label>
                <div className="relative">
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as LeadStatus)}
                    className={`${inputCls} appearance-none pr-9`}
                  >
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value} className="bg-slate-900">
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                      <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </div>
                <div className="mt-2">
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs ${statusStyle}`}>
                    {statusLabel(status)}
                  </span>
                </div>
              </div>

              {/* Service */}
              <div>
                <label className={labelCls}>Service needed</label>
                <input
                  type="text"
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                  placeholder="e.g. Boiler repair"
                  className={inputCls}
                />
              </div>

              {/* Appointment */}
              <div>
                <label className={labelCls}>
                  {hasConfirmedAppointment || status === "booked"
                    ? "Appointment time"
                    : "Preferred time"}
                </label>
                <input
                  type={hasConfirmedAppointment || status === "booked" ? "datetime-local" : "text"}
                  value={datetime}
                  onChange={(e) => setDatetime(e.target.value)}
                  placeholder={
                    hasConfirmedAppointment || status === "booked"
                      ? undefined
                      : "e.g. Tomorrow at 4pm"
                  }
                  className={inputCls}
                />
                {status === "booked" && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    Required to mark this lead as Booked — this is what appears on your calendar.
                  </p>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className={labelCls}>Staff notes</label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Internal notes visible only to staff..."
                  className={`${inputCls} resize-none leading-relaxed`}
                />
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-800 px-6 py-4">
          {saveError && (
            <p className="mb-3 text-sm text-red-400">{saveError}</p>
          )}
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-300 transition hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── LeadsTable ───────────────────────────────────────────────────

export default function LeadsTable({
  leads: initialLeads,
  businessName,
  leadsError,
}: {
  leads: Lead[];
  businessName: string | null;
  leadsError: boolean;
}) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);

  function handleUpdate(id: string, updates: Partial<Lead>) {
    setLeads((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...updates } : l))
    );
  }

  const newCount = leads.filter((l) => l.status === "new").length;
  const contactedCount = leads.filter((l) => l.status === "contacted").length;
  const bookedCount = leads.filter((l) => l.status === "booked").length;

  return (
    <>
      {/* Slide-out panel */}
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

      <main className="min-h-screen bg-slate-950 text-white">
        <div className="mx-auto max-w-7xl px-6 py-8">
          {/* Header */}
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Link href="/dashboard" className="text-sm text-slate-400 hover:text-white">
                ← Back to dashboard
              </Link>
              <h1 className="mt-4 text-3xl font-bold tracking-tight">Leads</h1>
              <p className="mt-2 text-slate-400">
                Captured by Remy for {businessName ?? "your business"}.
              </p>
            </div>
            <div className="rounded-full border border-slate-800 bg-slate-900 px-4 py-2 text-sm text-slate-300">
              {leads.length} total lead{leads.length === 1 ? "" : "s"}
            </div>
          </div>

          {/* Stat cards */}
          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            {[
              { label: "New", count: newCount },
              { label: "Contacted", count: contactedCount },
              { label: "Booked", count: bookedCount },
            ].map(({ label, count }) => (
              <div key={label} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
                <p className="text-sm text-slate-400">{label}</p>
                <p className="mt-2 text-3xl font-semibold">{count}</p>
              </div>
            ))}
          </div>

          {/* Error */}
          {leadsError && (
            <div className="rounded-2xl border border-red-900/60 bg-red-950/40 p-6 text-red-200">
              Failed to load leads. Please try again.
            </div>
          )}

          {/* Empty */}
          {!leadsError && leads.length === 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-10 text-center">
              <h2 className="text-xl font-semibold">No leads yet</h2>
              <p className="mx-auto mt-2 max-w-md text-slate-400">
                When customers ask about bookings, pricing, availability, or
                contact details, Remy will capture them here.
              </p>
            </div>
          )}

          {/* Desktop table */}
          {!leadsError && leads.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70">
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[1100px] text-left text-sm">
                  <thead className="border-b border-slate-800 bg-slate-900 text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-5 py-4">Created</th>
                      <th className="px-5 py-4">Name</th>
                      <th className="px-5 py-4">Phone</th>
                      <th className="px-5 py-4">Email</th>
                      <th className="px-5 py-4">Service</th>
                      <th className="px-5 py-4">Appointment time</th>
                      <th className="px-5 py-4">Status</th>
                      <th className="px-5 py-4">Source</th>
                      <th className="px-5 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {leads.map((lead) => {
                      const statusStyle =
                        STATUS_STYLES[lead.status ?? ""] ??
                        "bg-slate-500/15 text-slate-400 border-slate-500/30";
                      return (
                        <tr
                          key={lead.id}
                          onClick={() => setEditingLead(lead)}
                          className="cursor-pointer align-middle hover:bg-slate-800/40"
                        >
                          <td className="whitespace-nowrap px-5 py-4 text-slate-300">
                            {formatDate(lead.created_at)}
                          </td>
                          <td className="px-5 py-4">{valueOrDash(lead.name)}</td>
                          <td className="whitespace-nowrap px-5 py-4">{valueOrDash(lead.phone)}</td>
                          <td className="px-5 py-4">{valueOrDash(lead.email)}</td>
                          <td className="max-w-xs px-5 py-4">
                            <SummaryPreview text={lead.service_needed || lead.message} />
                          </td>
                          <td className="whitespace-nowrap px-5 py-4">{displayAppointment(lead)}</td>
                          <td className="px-5 py-4">
                            <span className={`rounded-full border px-3 py-1 text-xs ${statusStyle}`}>
                              {valueOrDash(statusLabel(lead.status))}
                            </span>
                          </td>
                          <td className="px-5 py-4 capitalize">{valueOrDash(lead.source)}</td>
                          <td className="px-5 py-4 text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingLead(lead);
                              }}
                              className="whitespace-nowrap rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-700 hover:text-white"
                            >
                              View details
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="grid gap-4 p-4 lg:hidden">
                {leads.map((lead) => {
                  const statusStyle =
                    STATUS_STYLES[lead.status ?? ""] ??
                    "bg-slate-500/15 text-slate-400 border-slate-500/30";
                  return (
                    <article
                      key={lead.id}
                      onClick={() => setEditingLead(lead)}
                      className="cursor-pointer rounded-xl border border-slate-800 bg-slate-950/60 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">{valueOrDash(lead.name)}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {formatDate(lead.created_at)}
                          </p>
                        </div>
                        <span className={`rounded-full border px-3 py-1 text-xs ${statusStyle}`}>
                          {valueOrDash(statusLabel(lead.status))}
                        </span>
                      </div>

                      <div className="mt-4 grid gap-3 text-sm">
                        <div>
                          <p className="text-slate-500">Service</p>
                          <SummaryPreview text={lead.service_needed || lead.message} />
                        </div>
                        <div>
                          <p className="text-slate-500">Contact</p>
                          <p className="text-slate-200 break-words">
                            {valueOrDash(lead.phone)} / {valueOrDash(lead.email)}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500">Appointment time</p>
                          <p className="text-slate-200">{displayAppointment(lead)}</p>
                        </div>
                        {lead.notes && (
                          <div>
                            <p className="text-slate-500">Notes</p>
                            <p className="text-slate-200 line-clamp-2 break-words">{lead.notes}</p>
                          </div>
                        )}
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingLead(lead);
                        }}
                        className="mt-4 w-full rounded-lg border border-slate-700 bg-slate-800 py-2 text-sm text-slate-300 transition hover:bg-slate-700"
                      >
                        View details
                      </button>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
