import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ChatShell from "@/components/chat/ChatShell";
import { loadComponents } from "next/dist/server/load-components";

export default async function ChatPage() {
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

  return <ChatShell orgId={org.id} orgName={org.business_name} />;
  }
