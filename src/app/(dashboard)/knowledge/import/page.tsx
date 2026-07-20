import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ImportClient from "./ImportClient";

export default async function KnowledgeImportPage() {
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

  // Resume an in-flight or unreviewed batch instead of always starting at
  // the upload step — otherwise a reload/tab-close while a multi-page PDF
  // is still processing (the case this can easily take a minute for)
  // strands a real ready_for_review batch with no way back to it from the UI.
  const { data: resumableImport } = await supabase
    .from("knowledge_imports")
    .select("id, status")
    .eq("org_id", org.id)
    .in("status", ["uploaded", "processing", "ready_for_review"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <ImportClient
      orgId={org.id}
      orgName={org.business_name}
      initialImportId={resumableImport?.id ?? null}
      initialImportStatus={resumableImport?.status ?? null}
    />
  );
}
