import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// ── Fetches the business's own site and checks whether the widget
// snippet is actually present, so a business owner doesn't have to
// guess after following the install guide. Authenticated + org-scoped
// via the session (never a client-supplied org id), and restricted to
// public http(s) hosts to avoid this becoming an open-ended fetch
// proxy for whatever URL is passed in. ─────────────────────────────

function isDisallowedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "::1") return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

export async function POST(req: NextRequest) {
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
    .select("widget_key")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (orgError || !org) {
    return NextResponse.json({ error: "No organisation found." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const rawUrl = body && typeof body.url === "string" ? body.url.trim() : "";

  if (!rawUrl) {
    return NextResponse.json({ error: "A website URL is required." }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    return NextResponse.json({ error: "That doesn't look like a valid URL." }, { status: 400 });
  }

  if (!["http:", "https:"].includes(target.protocol) || isDisallowedHost(target.hostname)) {
    return NextResponse.json({ error: "That URL can't be checked." }, { status: 400 });
  }

  try {
    const res = await fetch(target.toString(), {
      headers: { "User-Agent": "NiteOwlWidgetVerifier/1.0 (+https://niteowlhq.com)" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return NextResponse.json({
        installed: false,
        reason: `That page responded with an error (HTTP ${res.status}). Double-check the URL is correct and publicly reachable.`,
      });
    }

    const html = await res.text();
    const scriptFound = /widget\.js/i.test(html);
    const keyFound = html.includes(org.widget_key);

    return NextResponse.json({
      installed: scriptFound && keyFound,
      scriptFound,
      keyFound,
      reason: !scriptFound
        ? "No Remy widget script was found on that page."
        : !keyFound
          ? "A widget script was found, but it doesn't have your widget key — it may be a leftover snippet from a different site or an outdated copy."
          : null,
    });
  } catch {
    return NextResponse.json({
      installed: false,
      reason: "Couldn't load that page. Check the URL is correct, publicly accessible, and not blocking automated requests.",
    });
  }
}
