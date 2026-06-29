import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import KnowledgeClient from "./KnowledgeClient";

export default async function KnowledgePage() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) redirect("/login");

  const { data: org } = await supabase
    .from("organisations")
    .select("id, business_name")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!org) redirect("/onboarding");

  const { data: records } = await supabase
    .from("business_knowledge")
    .select("id, category, title, content, display_order, is_active, created_at")
    .eq("org_id", org.id)
    .eq("is_active", true)
    .order("category", { ascending: true })
    .order("display_order", { ascending: true });

  return (
    <KnowledgeClient
      orgId={org.id}
      orgName={org.business_name}
      initialRecords={(records ?? []) as any}
    />
  );
}

