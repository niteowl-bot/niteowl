import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rateLimit";
import { validateScanContact } from "@/lib/freetools/scanContact";
import { recordScanContact } from "@/lib/salesLeadCapture";

// ── Scan contact intake (Phase B, BC-2) ─────────────────────────────
//
// The optional "contact us" that Phase B places beneath a complete
// Business Opportunity Scan report (docs/ARCHITECTURE.md §26.1). It is
// a public, unauthenticated POST that accepts exactly the five BC-1
// fields and nothing else.
//
// THIS ROUTE READS NOTHING BUT THE BODY, AND VALIDATES NONE OF IT
// ITSELF. validateScanContact is the sole refusal authority: an unknown
// key — a Scan answer, a report, a version stamp, a run / session /
// visitor / organisation id, or a client-supplied `source` — is refused
// there with 400 before anything here looks at it. No cookie is read or
// set, no query string is consulted, and no header is copied into the
// stored row: the client address is the rate-limit key and nothing
// else, exactly as on every other public route.
//
// THE RESPONSE ECHOES NOTHING. A 201 carries no id and none of the
// contact, so there is nothing a page could carry forward or join to.
//
// Rate limits are deliberately tighter than the chat route's: one
// submission is the whole interaction, and every success sends the
// team an email. Both keys are per warm instance (src/lib/rateLimit.ts).

const MAX_BODY_BYTES = 8 * 1024;
const PER_IP_LIMIT = 5;
const GLOBAL_LIMIT = 30;
const WINDOW_MS = 60 * 60_000;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  if (!checkRateLimit(`scan-contact-ip:${ip}`, PER_IP_LIMIT, WINDOW_MS)) {
    return new Response("Too many requests", { status: 429, headers: NO_STORE });
  }
  if (!checkRateLimit("scan-contact-global", GLOBAL_LIMIT, WINDOW_MS)) {
    return new Response("Too many requests", { status: 429, headers: NO_STORE });
  }

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return new Response("Payload too large", { status: 413, headers: NO_STORE });
  }

  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return new Response("Payload too large", { status: 413, headers: NO_STORE });
    }
    body = JSON.parse(raw);
  } catch {
    body = undefined;
  }

  const validation = validateScanContact(body);
  if (!validation.valid || validation.contact === null) {
    return NextResponse.json({ errors: validation.errors }, { status: 400, headers: NO_STORE });
  }

  const result = await recordScanContact(createAdminClient(), validation.contact);
  if (result.leadId === null) {
    return NextResponse.json(
      { error: "Could not record your details. Please try again." },
      { status: 500, headers: NO_STORE }
    );
  }

  return NextResponse.json({ ok: true }, { status: 201, headers: NO_STORE });
}
