import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_ORG_TIMEZONE } from "@/lib/calendar/timezone";
import CalendarView, { CalendarLead } from "./CalendarView";

export default async function CalendarPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) redirect("/login");

  // timezone: every appointment time this page shows or edits is a
  // wall-clock time in the BUSINESS'S zone, never the viewing device's.
  const { data: org } = await supabase
    .from("organisations")
    .select("id, business_name, timezone")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!org) redirect("/onboarding");

  const { data: leads } = await supabase
    .from("leads")
    .select(
      "id, name, phone, email, service_needed, preferred_datetime, appointment_datetime, message, source, status, ai_confidence, notes, created_at"
    )
    .eq("org_id", org.id)
    .not("appointment_datetime", "is", null)
    .order("appointment_datetime", { ascending: true });



  return (
    <CalendarView
      leads={(leads ?? []) as CalendarLead[]}
      businessName={org.business_name}
      timezone={org.timezone ?? DEFAULT_ORG_TIMEZONE}
    />
  );
}
