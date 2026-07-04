import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export default async function WidgetSettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) redirect("/login");

  const { data: org, error: orgError } = await supabase
    .from("organisations")
    .select("id, business_name, widget_key")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (orgError || !org) redirect("/onboarding");

  const snippet = org.widget_key
    ? `<script src="${APP_URL}/widget.js" data-widget-key="${org.widget_key}"></script>`
    : null;

  return (
    <div className="min-h-screen bg-[#0d0f14] px-4 py-10 md:px-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-1 flex items-center gap-2">
          <a href="/dashboard" className="text-xs text-white/30 transition hover:text-white/60">
            Dashboard
          </a>
          <span className="text-white/15">/</span>
          <span className="text-xs text-white/50">Widget</span>
        </div>

        <h1 className="mb-1 text-xl font-semibold text-white">Website Widget</h1>
        <p className="mb-8 text-sm text-white/40">
          Widget settings coming soon — configuration options like colors,
          position, and greeting message will live here. For now, here&apos;s
          your embed code.
        </p>

        <div className="rounded-2xl border border-white/[0.07] bg-[#13151c] p-6">
          {snippet ? (
            <pre className="overflow-x-auto rounded-lg bg-black/40 p-4 text-xs text-white/70">
              {snippet}
            </pre>
          ) : (
            <p className="text-sm text-white/40">
              No widget key found for your organisation yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
