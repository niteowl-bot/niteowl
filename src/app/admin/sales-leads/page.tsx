import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ── Admin sales leads ──────────────────────────────────────────────
// Prospects captured by the NiteOwl sales chat (src/app/api/sales/chat),
// not tenant customer leads — deliberately separate from /leads, which
// is per-organisation and RLS-scoped to a business owner's own data.
// This table has no org_id and no RLS policies at all, so it can only
// ever be read via the service-role admin client, gated here by
// checking the logged-in user's email against ADMIN_EMAIL first.

interface SalesLead {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  industry: string | null;
  preferred_demo_time: string | null;
  status: string;
  created_at: string;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(new Date(value));
}

function valueOrDash(value: string | null) {
  return value && value.trim() ? value : "—";
}

const STATUS_STYLES: Record<string, string> = {
  new: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  complete: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  contacted: "bg-purple-500/15 text-purple-300 border-purple-500/30",
};

export default async function SalesLeadsPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login");
  }

  const adminEmail = process.env.ADMIN_EMAIL;

  if (!adminEmail || user.email !== adminEmail) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();

  const { data: leads, error: leadsError } = await admin
    .from("sales_leads")
    .select("id, name, email, phone, company, industry, preferred_demo_time, status, created_at")
    .order("created_at", { ascending: false });

  const safeLeads = (leads ?? []) as SalesLead[];

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <Link href="/dashboard" className="text-sm text-slate-400 hover:text-white">
          ← Back to dashboard
        </Link>

        <div className="mt-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Sales leads</h1>
          <span className="text-sm text-slate-500">{safeLeads.length} total</span>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          Prospects captured by the sales chat on the marketing site.
        </p>

        {leadsError && (
          <div className="mt-6 rounded-xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-300">
            Could not load sales leads.
          </div>
        )}

        {!leadsError && safeLeads.length === 0 && (
          <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-slate-400">
            No sales leads captured yet.
          </div>
        )}

        {!leadsError && safeLeads.length > 0 && (
          <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/60 text-left text-slate-400">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Industry</th>
                  <th className="px-4 py-3 font-medium">Preferred demo time</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Captured</th>
                </tr>
              </thead>
              <tbody>
                {safeLeads.map((lead) => (
                  <tr key={lead.id} className="border-b border-slate-800/60 last:border-0">
                    <td className="px-4 py-3">{valueOrDash(lead.name)}</td>
                    <td className="px-4 py-3">{valueOrDash(lead.email)}</td>
                    <td className="px-4 py-3">{valueOrDash(lead.phone)}</td>
                    <td className="px-4 py-3">{valueOrDash(lead.company)}</td>
                    <td className="px-4 py-3">{valueOrDash(lead.industry)}</td>
                    <td className="px-4 py-3">{valueOrDash(lead.preferred_demo_time)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-xs ${
                          STATUS_STYLES[lead.status] ?? "bg-slate-500/15 text-slate-400 border-slate-500/30"
                        }`}
                      >
                        {lead.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{formatDate(lead.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
