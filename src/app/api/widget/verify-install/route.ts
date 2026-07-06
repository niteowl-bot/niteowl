import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import dns from "node:dns/promises";
import net from "node:net";

// ── Fetches the business's own site and checks whether the widget
// snippet is actually present, so a business owner doesn't have to
// guess after following the install guide. Authenticated + org-scoped
// via the session (never a client-supplied org id), and restricted to
// public http(s) hosts to avoid this becoming an open-ended fetch
// proxy for whatever URL is passed in. ─────────────────────────────
//
// The hostname-string check alone isn't enough: a hostname can resolve
// via DNS to a private/internal address (DNS rebinding), and a page can
// 302 to an internal URL after the initial check passes. Both the
// initial host and every redirect hop are resolved and checked against
// disallowed IP ranges before being fetched.

function isDisallowedIp(ip: string): boolean {
  const type = net.isIP(ip);

  if (type === 4) {
    if (/^127\./.test(ip)) return true;
    if (/^10\./.test(ip)) return true;
    if (/^192\.168\./.test(ip)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
    if (/^169\.254\./.test(ip)) return true; // link-local, incl. cloud metadata (169.254.169.254)
    if (ip === "0.0.0.0") return true;
    return false;
  }

  if (type === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("::ffff:")) {
      const embedded = lower.split(":").pop()!;
      if (net.isIP(embedded) === 4) return isDisallowedIp(embedded);
    }
    if (/^fe80:/.test(lower)) return true; // link-local
    if (/^f[cd]00:/.test(lower)) return true; // unique local
    return false;
  }

  return true; // not a valid IP — treat as disallowed rather than guess
}

function isDisallowedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || isDisallowedIp(h);
}

async function resolvesToDisallowedIp(hostname: string): Promise<boolean> {
  if (net.isIP(hostname)) return isDisallowedIp(hostname);

  try {
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    return addresses.some((a) => isDisallowedIp(a.address));
  } catch {
    // Unresolvable — let the actual fetch fail naturally with its own error.
    return false;
  }
}

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 2_000_000;

async function fetchVerifiedPage(initialUrl: URL): Promise<Response> {
  let current = initialUrl;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    if (isDisallowedHost(current.hostname) || (await resolvesToDisallowedIp(current.hostname))) {
      throw new Error("Target host not allowed");
    }

    const res = await fetch(current.toString(), {
      headers: { "User-Agent": "NiteOwlWidgetVerifier/1.0 (+https://niteowlhq.com)" },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      if (!location) throw new Error("Redirect with no location");

      const next = new URL(location, current);
      if (!["http:", "https:"].includes(next.protocol)) {
        throw new Error("Disallowed redirect protocol");
      }
      current = next;
      continue;
    }

    return res;
  }

  throw new Error("Too many redirects");
}

async function readBodyCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let result = "";
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      break;
    }
    result += decoder.decode(value, { stream: true });
  }

  return result;
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

  if (await resolvesToDisallowedIp(target.hostname)) {
    return NextResponse.json({ error: "That URL can't be checked." }, { status: 400 });
  }

  try {
    const res = await fetchVerifiedPage(target);

    if (!res.ok) {
      return NextResponse.json({
        installed: false,
        reason: `That page responded with an error (HTTP ${res.status}). Double-check the URL is correct and publicly reachable.`,
      });
    }

    const html = await readBodyCapped(res, MAX_RESPONSE_BYTES);
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
