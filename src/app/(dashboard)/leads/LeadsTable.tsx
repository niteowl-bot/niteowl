"use client";

import { useState } from "react";
import Link from "next/link";

export type Lead = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  service_needed: string | null;
  preferred_datetime: string | null;
  message: string | null;
  source: string | null;
  status: string | null;
  ai_confidence: number | null;
  created_at: string;
};

function formatDate(value: string | null) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("en-IE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function valueOrDash(value: string | null | undefined) {
  return value && value.trim() ? value : "—";
}

function MessageCell({ message }: { message: string | null | undefined }) {
  const [expanded, setExpanded] = useState(false);

  if (!message || !message.trim()) {
    return <span className="text-slate-600">—</span>;
  }

  const isLong = message.length > 100;
  const preview = isLong ? message.slice(0, 100).trim() + "…" : message;

  return (
    <div>
      <p
        className={
          expanded ? "whitespace-pre-wrap break-words" : "line-clamp-3"
        }
      >
        {expanded ? message : preview}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 text-xs font-medium text-blue-400 hover:text-blue-300 transition"
        >
          {expanded ? "Show less" : "View full message"}
        </button>
      )}
    </div>
  );
}

export default function LeadsTable({
  leads,
  businessName,
  leadsError,
}: {
  leads: Lead[];
  businessName: string | null;
  leadsError: boolean;
}) {
  const newCount = leads.filter((lead) => lead.status === "new").length;
  const contactedCount = leads.filter(
    (lead) => lead.status === "contacted"
  ).length;
  const bookedCount = leads.filter((lead) => lead.status === "booked").length;

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link
              href="/dashboard"
              className="text-sm text-slate-400 hover:text-white"
            >
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

        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <p className="text-sm text-slate-400">New</p>
            <p className="mt-2 text-3xl font-semibold">{newCount}</p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <p className="text-sm text-slate-400">Contacted</p>
            <p className="mt-2 text-3xl font-semibold">{contactedCount}</p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <p className="text-sm text-slate-400">Booked</p>
            <p className="mt-2 text-3xl font-semibold">{bookedCount}</p>
          </div>
        </div>

        {leadsError ? (
          <div className="rounded-2xl border border-red-900/60 bg-red-950/40 p-6 text-red-200">
            Failed to load leads. Please try again.
          </div>
        ) : leads.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-10 text-center">
            <h2 className="text-xl font-semibold">No leads yet</h2>
            <p className="mx-auto mt-2 max-w-md text-slate-400">
              When customers ask about bookings, pricing, availability, or
              contact details, Remy will capture them here.
            </p>
          </div>
        ) : (
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
                    <th className="px-5 py-4">Message</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-800">
                  {leads.map((lead) => (
                    <tr key={lead.id} className="hover:bg-slate-800/40">
                      <td className="whitespace-nowrap px-5 py-4 text-slate-300">
                        {formatDate(lead.created_at)}
                      </td>
                      <td className="px-5 py-4">{valueOrDash(lead.name)}</td>
                      <td className="px-5 py-4">{valueOrDash(lead.phone)}</td>
                      <td className="px-5 py-4">{valueOrDash(lead.email)}</td>
                      <td className="px-5 py-4">
                        {valueOrDash(lead.service_needed)}
                      </td>
                      <td className="px-5 py-4">
                        {valueOrDash(lead.preferred_datetime)}
                      </td>
                      <td className="px-5 py-4">
                        <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs capitalize text-slate-200">
                          {valueOrDash(lead.status)}
                        </span>
                      </td>
                      <td className="px-5 py-4 capitalize">
                        {valueOrDash(lead.source)}
                      </td>
                      <td className="max-w-xs px-5 py-4 text-slate-300 align-top">
                        <MessageCell message={lead.message} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-4 p-4 lg:hidden">
              {leads.map((lead) => (
                <article
                  key={lead.id}
                  className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{valueOrDash(lead.name)}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatDate(lead.created_at)}
                      </p>
                    </div>

                    <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs capitalize text-slate-200">
                      {valueOrDash(lead.status)}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 text-sm">
                    <div>
                      <p className="text-slate-500">Service</p>
                      <p className="text-slate-200">
                        {valueOrDash(lead.service_needed)}
                      </p>
                    </div>

                    <div>
                      <p className="text-slate-500">Contact</p>
                      <p className="text-slate-200">
                        {valueOrDash(lead.phone)} / {valueOrDash(lead.email)}
                      </p>
                    </div>

                    <div>
                      <p className="text-slate-500">Appointment time</p>
                      <p className="text-slate-200">
                        {valueOrDash(lead.preferred_datetime)}
                      </p>
                    </div>

                    <div>
                      <p className="text-slate-500">Message</p>
                      <MessageCell message={lead.message} />
                    </div>

                    <div>
                      <p className="text-slate-500">Source</p>
                      <p className="text-slate-200 capitalize">
                        {valueOrDash(lead.source)}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
