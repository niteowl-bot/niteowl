import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WidgetInstallGuide from "./WidgetInstallGuide";

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
    .select("id, business_name, widget_key, website")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (orgError || !org) redirect("/onboarding");

  const snippet = org.widget_key
    ? `<script src="${APP_URL}/widget.js" data-widget-key="${org.widget_key}"></script>`
    : null;

  return (
    <WidgetInstallGuide
      snippet={snippet}
      website={org.website}
    />
  );
}
