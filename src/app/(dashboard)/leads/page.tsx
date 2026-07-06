import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LeadsTable, { Lead } from "./LeadsTable";

export default async function LeadsPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login");
  }

  const { data: org, error: orgError } = await supabase
    .from("organisations")
    .select("id, business_name")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (orgError || !org) {
    return (
      <main className="min-h-screen bg-slate-950 text-white">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <Link
            href="/dashboard"
            className="text-sm text-slate-400 hover:text-white"
          >
            ← Back to dashboard
          </Link>

          <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/60 p-8">
            <h1 className="text-2xl font-semibold">No organisation found</h1>
            <p className="mt-2 text-slate-400">
              Create or complete your organisation profile before viewing leads.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const { data: leads, error: leadsError } = await supabase
    .from("leads")
   .select(
      "id, name, phone, email, service_needed, preferred_datetime, appointment_datetime, message, source, status, ai_confidence, notes, created_at"
    )

    .eq("org_id", org.id)
    .order("created_at", { ascending: false });

  const safeLeads = (leads ?? []) as Lead[];

  return (
    <LeadsTable
      leads={safeLeads}
      businessName={org.business_name}
      leadsError={Boolean(leadsError)}
    />
  );
}
