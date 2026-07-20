import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCalendarProvider } from "@/lib/calendar/provider";
import { saveConnection } from "@/lib/calendar/connection";

// ── GET /api/calendar/google/callback ────────────────────────────
// Google redirects here after consent. Validates the CSRF state against
// the httpOnly cookie set in /connect, re-resolves the org from the
// session (never trusting anything from the redirect), exchanges the
// code for tokens, and stores the (encrypted) connection. Structurally
// mirrors src/app/auth/callback/route.ts.

function settingsRedirect(status: string): NextResponse {
  const url = new URL("/settings/calendar", process.env.NEXT_PUBLIC_APP_URL);
  url.searchParams.set("calendar", status);
  const response = NextResponse.redirect(url);
  response.cookies.delete("gcal_oauth_state");
  return response;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error"); // e.g. access_denied

  if (oauthError) {
    return settingsRedirect("cancelled");
  }

  const cookieState = request.cookies.get("gcal_oauth_state")?.value;
  if (!code || !state || !cookieState || state !== cookieState) {
    return settingsRedirect("error");
  }

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

  try {
    const provider = getCalendarProvider("google");
    const tokens = await provider.exchangeCode(code);

    if (!tokens.refreshToken) {
      // No refresh token means Google treated this as a re-consent without
      // prompt=consent, or offline access wasn't granted — we couldn't
      // refresh later. Ask the owner to reconnect (revoking prior access
      // in their Google account forces a fresh refresh token next time).
      console.error("[calendar/google] no refresh token returned on connect");
      return settingsRedirect("error");
    }

    const accountEmail = await provider.getAccountEmail(tokens.accessToken);

    await saveConnection({
      orgId: org.id,
      provider: "google",
      accountEmail,
      tokens,
    });

    return settingsRedirect("connected");
  } catch (err) {
    console.error("[calendar/google] callback failed:", err);
    return settingsRedirect("error");
  }
}
