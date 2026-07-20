import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { disconnect } from "@/lib/calendar/connection";

// ── POST /api/calendar/google/disconnect ─────────────────────────
// Owner-initiated from Settings → Calendar. Revokes the tokens at Google
// (best-effort) and removes the stored connection row for the owner's org.

export async function POST() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { data: org, error: orgError } = await supabase
    .from("organisations")
    .select("id")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (orgError || !org) {
    return NextResponse.json({ error: "No organisation found." }, { status: 404 });
  }

  try {
    await disconnect(org.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[calendar/google] disconnect failed:", err);
    return NextResponse.json(
      { error: "Could not disconnect. Please try again." },
      { status: 500 }
    );
  }
}
