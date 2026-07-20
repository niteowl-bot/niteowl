import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadConnection } from "@/lib/calendar/connection";
import CalendarSettings from "./CalendarSettings";

export default async function CalendarSettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) redirect("/login");

  const { data: org, error: orgError } = await supabase
    .from("organisations")
    .select("id")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (orgError || !org) redirect("/onboarding");

  const connection = await loadConnection(org.id);

  return (
    <CalendarSettings
      connected={connection?.connected ?? false}
      accountEmail={connection?.accountEmail ?? null}
    />
  );
}
