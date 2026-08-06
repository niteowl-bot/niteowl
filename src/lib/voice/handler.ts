import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  VOICE_AVAILABILITY_TOOL_NAME,
  isVoiceEnabled,
  parseVapiWebhook,
  verifyVoiceWebhookSecret,
} from "@/lib/voice/vapi";
import { buildAssistantRequestResponse } from "@/lib/voice/incoming";
import { checkVoiceAvailability } from "@/lib/voice/availabilityTool";
import {
  markVoiceEventProcessed,
  processCallEnded,
  processStatusUpdate,
  resolveVoiceOrgId,
  storeVoiceEvent,
} from "@/lib/voice/calls";

// ── Shared voice webhook handler ───────────────────────────────────
// Both /api/voice/webhook and /api/voice/incoming delegate here, so
// either URL accepts any provider message type — the Vapi dashboard
// can point a phone number's server URL at /incoming and the
// assistant's at /webhook, or everything at one of them; a
// misconfiguration never silently drops events.
//
// Trust model (same as the Stripe webhook): the endpoints are public,
// authenticity comes solely from the verified shared secret. Ingestion
// is durable: raw events are stored synchronously and idempotently,
// the 200 ack goes out fast, and processing runs in after() — a
// processing failure leaves the stored event replayable, and a
// provider retry of an acked event is deduplicated by dedupe_key.

export async function handleVoiceWebhookPost(
  req: NextRequest
): Promise<Response> {
  // Global kill switch: the entire voice surface stays dark (404, as
  // if the routes don't exist) until VOICE_ENABLED=true is set.
  if (!isVoiceEnabled()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Rate limit before any work — caps both secret brute-forcing and
  // junk-payload floods per warm instance (same limiter as the widget).
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (!checkRateLimit(`voice:${ip}`, 300, 60_000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  if (!verifyVoiceWebhookSecret(req)) {
    return NextResponse.json({ error: "Invalid secret." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const event = parseVapiWebhook(body);
  if (!event) {
    return NextResponse.json(
      { error: "Unrecognised payload." },
      { status: 400 }
    );
  }

  // Message types we deliberately don't act on must still be acked
  // with 200, or the provider retries them forever.
  if (event.kind === "ignored") {
    return NextResponse.json({ received: true, ignored: event.eventType });
  }

  const admin = createAdminClient();

  if (event.kind === "assistant-request") {
    const { status, body: responseBody } = await buildAssistantRequestResponse(
      admin,
      event
    );
    return NextResponse.json(responseBody, { status });
  }

  // ── tool-call: answered inline, never stored ─────────────────────
  // The caller is waiting on the line, so this is the one event that
  // must be resolved in the response body rather than in after().
  // checkVoiceAvailability never throws — every failure resolves to an
  // "unknown" result — so a lookup problem becomes Remy saying it
  // cannot check right now, never a dropped call.
  if (event.kind === "tool-call") {
    const orgId = await resolveVoiceOrgId(admin, event.businessPhone);
    const results = await Promise.all(
      event.calls.map(async (call) => {
        if (!orgId || call.name !== VOICE_AVAILABILITY_TOOL_NAME) {
          if (!orgId) {
            console.error(
              "[voice] tool call for an unmatched number:",
              event.businessPhone
            );
          }
          return {
            toolCallId: call.id,
            result:
              "AVAILABILITY UNKNOWN. The live calendar could not be checked. Do NOT say the time is available and do NOT offer any time. Say you cannot confirm availability right now, take their preferred time, and tell them the team will confirm it.",
          };
        }
        const outcome = await checkVoiceAvailability(orgId, call.args);
        return { toolCallId: call.id, result: outcome.result };
      })
    );
    return NextResponse.json({ results });
  }

  // ── call-ended / status-update: store raw first, process async ───
  const orgId = await resolveVoiceOrgId(admin, event.businessPhone);

  // Stored even when the number matches no org (org_id NULL) — an
  // unmatched call is a configuration problem to investigate, not
  // data to drop.
  const stored = await storeVoiceEvent(admin, event, orgId, body);

  if (stored.duplicate) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  if (!stored.id) {
    // Storage itself failed — tell the provider to retry rather than
    // acking an event we don't have.
    return NextResponse.json({ error: "Storage failed." }, { status: 500 });
  }

  if (!orgId) {
    console.error(
      "[voice] event stored but no org matches number:",
      event.businessPhone
    );
    return NextResponse.json({ received: true, unmatched: true });
  }

  const eventRowId = stored.id;
  // after() (not a bare promise) — Vercel can freeze the function the
  // moment the response is sent; this is the same guarantee the
  // booking-confirmation emails already rely on in leadCapture.
  after(async () => {
    try {
      if (event.kind === "call-ended") {
        await processCallEnded(admin, orgId, event);
      } else {
        await processStatusUpdate(admin, orgId, event);
      }
      await markVoiceEventProcessed(admin, eventRowId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[voice] event processing failed:", message);
      await markVoiceEventProcessed(admin, eventRowId, message);
    }
  });

  return NextResponse.json({ received: true });
}
