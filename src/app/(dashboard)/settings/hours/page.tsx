import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import HoursForm from "./HoursForm";

export interface BusinessHoursRow {
  day_of_week: number;
  is_closed: boolean;
  open_time: string | null;
  close_time: string | null;
  lunch_start: string | null;
  lunch_end: string | null;
}

export default async function BusinessHoursPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: org } = await supabase
    .from("organisations")
    .select("id, appointment_duration_minutes, emergency_mode_enabled")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!org) redirect("/onboarding");

  const { data: hours } = await supabase
    .from("business_hours")
    .select("day_of_week, is_closed, open_time, close_time, lunch_start, lunch_end")
    .eq("org_id", org.id)
    .order("day_of_week", { ascending: true });

  return (
    <HoursForm
      orgId={org.id}
      initialHours={(hours ?? []) as BusinessHoursRow[]}
      initialDuration={org.appointment_duration_minutes ?? 60}
      initialEmergencyMode={org.emergency_mode_enabled ?? false}
    />
  );
}
