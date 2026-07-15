import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import BusinessForm from "./BusinessForm";

export default async function BusinessSettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: org } = await supabase
    .from("organisations")
    .select("id, business_name")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!org) redirect("/onboarding");

  return (
    <BusinessForm orgId={org.id} initialBusinessName={org.business_name ?? ""} />
  );
}
