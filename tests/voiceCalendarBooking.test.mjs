// Phase 2 — a phone appointment may become a calendar-backed booking.
//
// Every voice appointment used to have its intent rewritten to
// "question" before it reached the shared engine, so it could never
// become "booked" and no calendar event was ever created from a call.
// That was deliberate: Remy tells every caller the team will confirm,
// and the lead must not silently disagree with what the caller heard.
//
// It now takes the same route chat does WHEN, and only when, a gate is
// open. The rule the whole design rests on is unchanged:
//
//   AN APPOINTMENT IS "BOOKED" ONLY IF GOOGLE SAYS SO.
//
// Nothing here is claimed to the caller. This all runs AFTER the call
// has ended, so a successful write over-delivers on what Remy promised
// and every failure leaves exactly the request the caller was told about.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { encryptCredentials, loadKeyringFromEnv } from "@/lib/integrations/crypto";
import { isVoiceCalendarBookingEnabled } from "@/lib/integrations/flags";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CONNECTION_ID = "22222222-2222-4222-8222-222222222222";
const RESOURCE_ID = "33333333-3333-4333-8333-333333333333";
const CALENDAR_ID = "owner@example.com";
const LEAD_ID = "44444444-4444-4444-8444-444444444444";
const CALL_ROW_ID = "77777777-7777-4777-8777-777777777777";

// Thursday 20 August 2026, 15:00 Europe/London (BST) = 14:00Z — the
// 3 PM the caller corrected to, from the production call this came from.
const THREE_PM_ISO = "2026-08-20T14:00:00.000Z";
const FOUR_PM_ISO = "2026-08-20T15:00:00.000Z";
const SERVICE_ADDRESS = "711 Maple Avenue";

const BASE_EVENT = {
  kind: "call-ended",
  provider: "vapi",
  dedupeKey: "vapi:booking:end-of-call-report",
  providerCallId: "eeeeeeee-5555-4555-8555-eeeeeeeeeeee",
  businessPhone: "+353212345678",
  callerPhone: "+353871465274",
  direction: "inbound",
  startedAt: "2026-08-18T17:59:54.000Z",
  endedAt: "2026-08-18T18:02:30.000Z",
  durationSeconds: 156,
  endedReason: "assistant-ended-call",
  summary: "Jason called to book a boiler service.",
  transcript: "AI: Hello. User: I'd like a boiler service Thursday at 3 PM.",
  recordingUrl: null,
  costUsd: null,
  costBreakdown: null,
};

/** What extraction hands the capture path for a completed booking call. */
function extractedDetails(overrides = {}) {
  return {
    intent: "new_booking",
    name: "Jason",
    email: "jason@example.com",
    phone: null,
    service: "Boiler service",
    preferred_datetime: "Thursday 20 August at 3 PM",
    service_address: SERVICE_ADDRESS,
    urgent: false,
    confidence: 0.9,
    ...overrides,
  };
}

/**
 * @param voiceBooking   VOICE_CALENDAR_BOOKING_ENABLED
 * @param allowlisted    whether the org is in CALENDAR_EVENT_CREATION_ORG_IDS
 * @param createStatus   HTTP status Google returns for the event create
 * @param busy           free/busy windows Google reports
 * @param connected      whether a calendar connection/resource exists
 * @param freeBusyFail   make the free/busy lookup fail
 * @param knowledgeHit   whether the service matches the Knowledge Base
 * @param existingLinks  rows already in integration_links
 * @param existingLead   a lead the capture path should resolve to (replay)
 */
function installStubs({
  voiceBooking = "true",
  allowlisted = true,
  createStatus = 200,
  busy = [],
  connected = true,
  freeBusyFail = false,
  knowledgeHit = true,
  existingLinks = [],
  existingLead = null,
} = {}) {
  process.env.INTEGRATIONS_ENABLED = "true";
  process.env.CALENDAR_SYNC_ENABLED = "true";
  process.env.CALENDAR_AVAILABILITY_BLOCKING = "true";
  process.env.CALENDAR_EVENT_CREATION_ORG_IDS = allowlisted ? ORG_ID : "";
  // `null` means UNSET — not `undefined`, which a default parameter
  // silently replaces with "true" and would have tested the opposite of
  // what the test name claims.
  if (voiceBooking === null) delete process.env.VOICE_CALENDAR_BOOKING_ENABLED;
  else process.env.VOICE_CALENDAR_BOOKING_ENABLED = voiceBooking;
  process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "client-id";
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "client-secret";
  process.env.RESEND_API_KEY = "re_test";

  const credentials = encryptCredentials(
    {
      strategy: "oauth2",
      accessToken: "ya29.token",
      refreshToken: "1//refresh",
      expiresAtIso: "2099-01-01T00:00:00.000Z",
      scopes: "calendar",
    },
    loadKeyringFromEnv()
  );

  const realFetch = globalThis.fetch;
  const calls = {
    creates: [],
    updates: [],
    freeBusy: 0,
    leadInserts: [],
    leadUpdates: [],
    linkInserts: [],
    emails: [],
    openai: 0,
  };

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers ?? {});
    const wantsObject = (headers.get("accept") ?? "").includes("pgrst.object");
    const body = init.body ? JSON.parse(init.body) : {};

    if (url.includes("api.resend.com")) {
      calls.emails.push(body);
      return json({ id: "email-1" });
    }

    if (url.includes("oauth2.googleapis.com") || url.includes("/token")) {
      return json({ access_token: "fresh", expires_in: 3600, scope: "calendar" });
    }

    if (url.includes("googleapis.com/calendar/v3/freeBusy")) {
      calls.freeBusy++;
      if (freeBusyFail) return json({ error: { message: "boom" } }, 500);
      return json({ calendars: { [CALENDAR_ID]: { busy } } });
    }

    if (url.includes("/calendar/v3/calendars/") && url.includes("/events")) {
      if (method === "PATCH") {
        calls.updates.push({ url, body });
        return json({ id: "existing-event", etag: '"etag-2"' });
      }
      calls.creates.push({ method, url, body });
      if (createStatus === 409) {
        return json({ error: { errors: [{ reason: "duplicate" }] } }, 409);
      }
      if (createStatus !== 200) return json({ error: { message: "boom" } }, createStatus);
      return json({ id: body.id, etag: '"etag-1"' });
    }

    if (url.includes("/rest/v1/integration_resources")) {
      if (!connected) return wantsObject ? json(null) : json([]);
      const row = {
        id: RESOURCE_ID,
        connection_id: CONNECTION_ID,
        resource_type: "calendar",
        external_id: CALENDAR_ID,
        name: CALENDAR_ID,
        is_primary: true,
        sync_enabled: true,
        availability_enabled: true,
      };
      return wantsObject ? json(row) : json([row]);
    }

    if (url.includes("/rest/v1/integration_connections")) {
      if (!connected) return wantsObject ? json(null) : json([]);
      const row = {
        id: CONNECTION_ID,
        org_id: ORG_ID,
        provider: "google",
        capabilities: ["calendar"],
        auth_strategy: "oauth2",
        account_id: "acct",
        account_email: CALENDAR_ID,
        account_name: "Owner",
        status: "connected",
        last_error: null,
        token_expires_at: "2099-01-01T00:00:00.000Z",
        last_verified_at: null,
        created_at: "2026-08-01T00:00:00.000Z",
        credentials_encrypted: credentials,
      };
      return wantsObject ? json(row) : json([row]);
    }

    if (url.includes("/rest/v1/integration_links")) {
      if (method === "POST") {
        calls.linkInserts.push(body);
        return json([], 201);
      }
      if (method === "PATCH") return json([]);
      const row = existingLinks[0] ?? null;
      return wantsObject ? json(row) : json(existingLinks);
    }

    if (url.includes("/rest/v1/business_hours")) {
      return json(
        [0, 1, 2, 3, 4, 5, 6].map((day_of_week) => ({
          day_of_week,
          is_closed: false,
          open_time: "09:00",
          close_time: "18:00",
          lunch_start: null,
          lunch_end: null,
        }))
      );
    }

    if (url.includes("/rest/v1/business_knowledge")) {
      // isServiceConfirmedByKnowledge — the rule 9 check.
      return json(
        knowledgeHit
          ? [{ category: "services", title: "Boiler service", content: "Boiler service" }]
          : []
      );
    }

    if (url.includes("/rest/v1/organisations")) {
      const row = {
        id: ORG_ID,
        business_name: "Verification Plumbing Co",
        appointment_duration_minutes: 60,
        emergency_mode_enabled: false,
        max_concurrent_bookings: 1,
        timezone: "Europe/London",
        notification_email: "owner@example.com",
        owner_id: "owner-1",
      };
      return wantsObject ? json(row) : json([row]);
    }

    if (url.includes("/rest/v1/voice_calls")) {
      if (method === "POST" || method === "PATCH") {
        const row = { id: CALL_ROW_ID, ...body };
        return wantsObject ? json(row) : json([row]);
      }
      const row = { id: CALL_ROW_ID, org_id: ORG_ID, status: "completed" };
      return wantsObject ? json(row) : json([row]);
    }

    if (url.includes("/rest/v1/conversations")) {
      const row = { id: "conv-1", org_id: ORG_ID };
      return wantsObject ? json(row) : json([row]);
    }

    if (url.includes("/rest/v1/messages")) return json([], 201);

    if (url.includes("/rest/v1/leads")) {
      if (method === "POST") {
        calls.leadInserts.push(body);
        const saved = { ...body, id: LEAD_ID };
        return wantsObject ? json(saved) : json([saved]);
      }
      if (method === "PATCH") {
        calls.leadUpdates.push(body);
        return wantsObject ? json({ id: LEAD_ID, ...body }) : json([]);
      }
      if (method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-range": "*/0" },
        });
      }
      if (existingLead) {
        return wantsObject ? json(existingLead) : json([existingLead]);
      }
      return wantsObject ? json(null) : json([]);
    }

    if (url.includes("api.openai.com")) {
      calls.openai++;
      return json({ choices: [{ message: { content: THREE_PM_ISO } }] });
    }

    if (url.includes("/auth/v1/")) return json({ id: "owner-1", email: "owner@example.com" });

    throw new Error(`Unstubbed fetch in test: ${method} ${url}`);
  };

  return {
    calls,
    restore() {
      globalThis.fetch = realFetch;
      delete process.env.CALENDAR_EVENT_CREATION_ORG_IDS;
      delete process.env.VOICE_CALENDAR_BOOKING_ENABLED;
    },
  };
}

let stubs;
afterEach(() => stubs?.restore());

async function adminClient() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/** Drive the end-of-call report exactly as the webhook handler does. */
async function endOfCall(overrides = {}) {
  const { processCallEnded } = await import("@/lib/voice/calls");
  return processCallEnded(await adminClient(), ORG_ID, {
    ...BASE_EVENT,
    extracted: extractedDetails(overrides.extracted ?? {}),
    ...overrides.event,
  });
}

const insertedLead = () => stubs.calls.leadInserts.at(-1) ?? {};

// ══════════════════════════════════════════════════════════════════
//  1. The gate itself
// ══════════════════════════════════════════════════════════════════

describe("the voice booking gate", () => {
  const env = (extra) => ({
    INTEGRATIONS_ENABLED: "true",
    CALENDAR_SYNC_ENABLED: "true",
    CALENDAR_EVENT_CREATION_ORG_IDS: ORG_ID,
    ...extra,
  });

  test("open only with the org allowlisted AND the channel switch on", () => {
    assert.equal(
      isVoiceCalendarBookingEnabled(ORG_ID, env({ VOICE_CALENDAR_BOOKING_ENABLED: "true" })),
      true
    );
  });

  test("the org allowlist stays the single organisation gate", () => {
    assert.equal(
      isVoiceCalendarBookingEnabled(
        ORG_ID,
        env({ CALENDAR_EVENT_CREATION_ORG_IDS: "", VOICE_CALENDAR_BOOKING_ENABLED: "true" })
      ),
      false,
      "the channel switch must never widen the allowlist"
    );
  });

  test("unset means off", () => {
    assert.equal(isVoiceCalendarBookingEnabled(ORG_ID, env()), false);
  });

  for (const value of ["", "1", "yes", "TRUE", "True", " true ", "false"]) {
    test(`a malformed value (${JSON.stringify(value)}) reads as off`, () => {
      assert.equal(
        isVoiceCalendarBookingEnabled(ORG_ID, env({ VOICE_CALENDAR_BOOKING_ENABLED: value })),
        false
      );
    });
  }

  test("it is nested under calendar sync", () => {
    assert.equal(
      isVoiceCalendarBookingEnabled(
        ORG_ID,
        env({ CALENDAR_SYNC_ENABLED: "false", VOICE_CALENDAR_BOOKING_ENABLED: "true" })
      ),
      false
    );
  });
});

// ══════════════════════════════════════════════════════════════════
//  2. The happy path
// ══════════════════════════════════════════════════════════════════

describe("a confirmed phone appointment creates the event", () => {
  test("exactly one event is created and the lead is booked", async () => {
    stubs = installStubs();
    await endOfCall();

    assert.equal(stubs.calls.creates.length, 1, "one event, not two");
    const settled = stubs.calls.leadUpdates.find((u) => u.status);
    assert.equal(settled?.status, "booked", "booked only because Google said so");
    assert.equal(stubs.calls.linkInserts.length, 1, "the event is linked to the appointment");
  });

  test("the lead is written PENDING before Google is touched", async () => {
    stubs = installStubs();
    await endOfCall();
    assert.equal(
      insertedLead().status,
      "awaiting_confirmation",
      "the internal claim precedes the external write, so a crash is recoverable"
    );
  });

  test("the event carries the service address the caller gave", async () => {
    stubs = installStubs();
    await endOfCall();
    const created = stubs.calls.creates[0].body;
    assert.equal(
      created.location,
      SERVICE_ADDRESS,
      "an engineer's diary entry needs somewhere to go"
    );
  });

  test("the appointment is linked as an APPOINTMENT, not a lead", async () => {
    stubs = installStubs();
    await endOfCall();
    assert.equal(stubs.calls.linkInserts[0].subject_type, "appointment");
  });
});

// ══════════════════════════════════════════════════════════════════
//  3. The 4 PM → 3 PM correction
// ══════════════════════════════════════════════════════════════════

describe("the caller's final corrected time is the time written", () => {
  test("3 PM London is written as 14:00Z, and 4 PM appears nowhere", async () => {
    stubs = installStubs();
    await endOfCall();

    assert.equal(insertedLead().appointment_datetime, THREE_PM_ISO);
    assert.notEqual(insertedLead().appointment_datetime, FOUR_PM_ISO);

    // The event's START is the assertion that matters. The payload's END
    // is legitimately 16:00 local — 15:00 plus the org's 60 minutes —
    // so a blanket search for "16:00" would fail on correct output.
    const created = stubs.calls.creates[0].body;
    assert.equal(created.start.dateTime, "2026-08-20T15:00:00", "3 PM BST");
    assert.equal(created.start.timeZone, "Europe/London");
    assert.notEqual(
      created.start.dateTime,
      "2026-08-20T16:00:00",
      "the superseded 4 PM must not reach the calendar"
    );
  });
});

// ══════════════════════════════════════════════════════════════════
//  4. Every failure stays a truthful request
// ══════════════════════════════════════════════════════════════════

describe("nothing short of a confirmed write becomes 'booked'", () => {
  const notBooked = (label) => {
    const settled = stubs.calls.leadUpdates.find((u) => u.status);
    const status = settled?.status ?? insertedLead().status;
    assert.notEqual(status, "booked", label);
  };

  test("a FAILED create leaves needs_review", async () => {
    stubs = installStubs({ createStatus: 500 });
    await endOfCall();
    notBooked("a failed write must never read as booked");
    assert.equal(
      stubs.calls.leadUpdates.find((u) => u.status)?.status,
      "needs_review"
    );
  });

  // NOTE ON WHAT THESE TWO ACTUALLY PROVE.
  //
  // Both are refused EARLIER than the calendar write — checkBookingSlot
  // inside capturePartialLead sees the busy interval (or the failed
  // lookup) and never reaches settleCalendarBacking. Verified: mutating
  // mayConfirmBooking to return true does NOT break them, because the
  // outcome they depend on is the availability decision, not the write.
  //
  // They are kept because the guarantee they state is the one that
  // matters to a caller — a taken or unknowable slot never becomes a
  // phone booking — but the settle path's own conflict/unverified
  // handling is covered directly in calendarEventCreation.test.mjs, not
  // here. Naming them accurately so nobody reads this file as proof of
  // coverage it does not provide.
  test("a busy slot is refused before any write is attempted", async () => {
    stubs = installStubs({
      busy: [{ start: THREE_PM_ISO, end: "2026-08-20T15:00:00.000Z" }],
    });
    await endOfCall();
    notBooked("a taken slot is not a booking");
    assert.equal(stubs.calls.creates.length, 0);
  });

  test("an UNREADABLE calendar is refused before any write is attempted", async () => {
    stubs = installStubs({ freeBusyFail: true });
    await endOfCall();
    notBooked("'cannot check' is never 'free'");
    assert.equal(stubs.calls.creates.length, 0);
  });

  test("NO calendar connected leaves needs_review — never a bare 'booked'", async () => {
    // The trap this closes: no_calendar used to confirm. With the gate
    // open and nothing connected, a phone call must not produce a
    // confirmation nobody can honour.
    stubs = installStubs({ connected: false });
    await endOfCall();
    notBooked("no event means no booking");
    assert.equal(stubs.calls.creates.length, 0);
  });
});

// ══════════════════════════════════════════════════════════════════
//  5. Everything the gate must keep refusing
// ══════════════════════════════════════════════════════════════════

describe("with the gate closed, the call behaves exactly as before", () => {
  const assertRequestOnly = () => {
    assert.equal(stubs.calls.creates.length, 0, "no event is created");
    assert.equal(stubs.calls.linkInserts.length, 0, "nothing is linked");
    assert.notEqual(insertedLead().status, "booked", "the lead stays a request");
    // NOTE: free/busy IS still consulted, and must be. Availability
    // READS are a separate concern from writes — every channel has
    // checked the calendar before offering a time since 2026-08-12.
    // What the gate governs is whether an event is ever WRITTEN.
  };

  test("VOICE_CALENDAR_BOOKING_ENABLED unset", async () => {
    stubs = installStubs({ voiceBooking: null });
    await endOfCall();
    assertRequestOnly();
  });

  test("a malformed switch value", async () => {
    stubs = installStubs({ voiceBooking: "1" });
    await endOfCall();
    assertRequestOnly();
  });

  test("the org is not on the write allowlist", async () => {
    stubs = installStubs({ allowlisted: false });
    await endOfCall();
    assertRequestOnly();
  });

  test("the service is not in the Knowledge Base — rule 9 preserved", async () => {
    stubs = installStubs({ knowledgeHit: false });
    await endOfCall();
    assertRequestOnly();
  });

  test("no service was named at all", async () => {
    stubs = installStubs();
    await endOfCall({ extracted: { service: null } });
    assertRequestOnly();
  });

  test("a RESCHEDULE stays a request — voice has no appointment to move", async () => {
    stubs = installStubs();
    await endOfCall({ extracted: { intent: "reschedule" } });
    assertRequestOnly();
  });
});

// ══════════════════════════════════════════════════════════════════
//  6. Replay must not double-book
// ══════════════════════════════════════════════════════════════════

describe("a duplicated end-of-call report", () => {
  test("a replay against an already-booked lead writes no second event", async () => {
    stubs = installStubs({
      existingLead: {
        id: LEAD_ID,
        org_id: ORG_ID,
        status: "booked",
        appointment_datetime: THREE_PM_ISO,
        name: "Jason",
        email: "jason@example.com",
        phone: null,
        service_needed: "Boiler service",
        conversation_id: "conv-1",
        metadata: { service_address: SERVICE_ADDRESS },
      },
      existingLinks: [
        {
          id: "link-1",
          external_id: "rem-existing",
          external_etag: '"etag-1"',
          sync_status: "synced",
          resource_id: RESOURCE_ID,
        },
      ],
    });
    await endOfCall();
    assert.equal(stubs.calls.creates.length, 0, "the second report creates nothing");
  });

  test("Google's 409 is honoured rather than duplicated", async () => {
    stubs = installStubs({ createStatus: 409 });
    await endOfCall();
    assert.equal(stubs.calls.creates.length, 1, "one attempt, and the 409 settles it");
  });
});

// ══════════════════════════════════════════════════════════════════
//  7. Chat and the widget are untouched
// ══════════════════════════════════════════════════════════════════

describe("the shared engine's other callers are unchanged", () => {
  test("capturePartialLead's new parameter is optional and defaults to null", async () => {
    const { capturePartialLead } = await import("@/lib/leadCapture");
    assert.ok(
      capturePartialLead.length <= 8,
      "the address parameter must be defaulted, so no chat call site changes"
    );
  });

  test("a chat booking still sends no location to the calendar", async () => {
    stubs = installStubs();
    const { capturePartialLead } = await import("@/lib/leadCapture");
    const { createAdminClient } = await import("@/lib/supabase/admin");

    await capturePartialLead(
      createAdminClient(),
      ORG_ID,
      "conv-chat",
      "I'd like a boiler service Thursday at 3 PM",
      {
        intent: "new_booking",
        name: "Jason",
        email: "jason@example.com",
        phone: "0871234567",
        service: "Boiler service",
        preferred_datetime: "Thursday 20 August at 3 PM",
        confidence: 0.9,
      },
      "chat"
    );

    assert.equal(stubs.calls.creates.length, 1, "chat still books");
    assert.equal(
      stubs.calls.creates[0].body.location ?? null,
      null,
      "chat has no address to give, exactly as before"
    );
  });
});

// ══════════════════════════════════════════════════════════════════
//  8. Structural fences
// ══════════════════════════════════════════════════════════════════

describe("the gate cannot quietly widen", () => {
  const read = async (rel) => {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    return readFile(path.resolve(import.meta.dirname, "..", "src", rel), "utf8");
  };

  test("voice never imports a calendar write function directly", async () => {
    const src = await read("lib/voice/calls.ts");
    assert.doesNotMatch(src, /createOrgEvent|confirmAppointmentOnCalendar/);
  });

  test("the gate requires all four conditions", async () => {
    const src = await read("lib/voice/calls.ts");
    assert.match(src, /extracted\.intent === "new_booking"/);
    assert.match(src, /Boolean\(extracted\.service\)/);
    assert.match(src, /serviceConfirmed/);
    assert.match(src, /isVoiceCalendarBookingEnabled\(orgId\)/);
  });

  test("the channel switch is nested under the org allowlist", async () => {
    const src = await read("lib/integrations/flags.ts");
    assert.match(
      src,
      /isVoiceCalendarBookingEnabled[\s\S]{0,600}isCalendarEventCreationEnabled\(orgId, env\)/
    );
  });
});
