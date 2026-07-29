import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { getCalendarProvider } from "@/lib/calendar/provider";

// ── GET /api/calendar/google/connect ─────────────────────────────
// Owner-initiated from Settings → Calendar. Verifies the session, then
// redirects the owner to Google's consent screen. A random state nonce
// is both embedded in the OAuth state param and stored in an httpOnly
// cookie; the callback requires the two to match (CSRF protection). The
// org is re-resolved from the session on callback, so nothing about which
// org is being connected is ever trusted from the redirect round-trip.

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_APP_URL));
  }

  const { data: org, error: orgError } = await supabase
    .from("organisations")
    .select("id")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (orgError || !org) {
    return NextResponse.redirect(new URL("/onboarding", process.env.NEXT_PUBLIC_APP_URL));
  }

  const state = randomBytes(32).toString("base64url");
  const authUrl = getCalendarProvider("google").getAuthUrl(state);

  const response = NextResponse.redirect(authUrl);
  response.cookies.set("gcal_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes to complete the consent round-trip
  });
  return response;
}
