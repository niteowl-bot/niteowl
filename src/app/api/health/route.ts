import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Public, unauthenticated — meant to be pinged by an external uptime
// monitor. Checks real DB connectivity rather than just "the process is
// running," since a Supabase outage or misconfigured env var wouldn't
// show up in a plain 200 from Next.js itself.
export async function GET() {
  const supabase = createAdminClient();

  const { error } = await supabase.from("organisations").select("id").limit(1);

  if (error) {
    console.error("[health] database check failed:", error.message);
    return NextResponse.json(
      { status: "error", database: "unreachable" },
      { status: 503 }
    );
  }

  return NextResponse.json({ status: "ok", database: "ok" });
}
