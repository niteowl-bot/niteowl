// A phone appointment is a REQUEST, never a confirmed booking.
//
// From the 2026-08-06 production pair. Two callers asked for the same
// slot and both were told it was available. The diagnosis had two
// halves; this file covers the lead-side one.
//
// A voice appointment used to become status='booked' whenever the
// service happened to match the Knowledge Base — which also fired the
// booking-confirmation email, while Remy was on the phone telling the
// caller the team still had to confirm. And when it did NOT match, the
// lead was left in a status the capacity check ignores, so the slot
// stayed "free" for the next caller.
//
// Now every phone appointment is recorded as a request awaiting the
// business, carrying an explicit metadata.appointment_request marker
// that the voice availability check counts. These drive the REAL
// processCallEnded with the HTTP layer stubbed, so the assertions are
// about what actually reaches the database and what actually leaves
// the process.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import — see the file
import { processCallEnded } from "@/lib/voice/calls";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CALLER = "+353861234567";

const baseEvent = {
  kind: "call-ended",
  provider: "vapi",
  dedupeKey: "vapi:appt:end-of-call-report",
  providerCallId: "eeeeeeee-5555-4555-8555-eeeeeeeeeeee",
  businessPhone: "+353212345678",
  callerPhone: CALLER,
  direction: "inbound",
  startedAt: "2026-08-06T15:00:00.000Z",
  endedAt: "2026-08-06T15:06:00.000Z",
  durationSeconds: 360,
  endedReason: "customer-ended-call",
  summary: "Caller asked for a burst pipe appointment.",
  transcript: "AI: ... User: burst pipe, Wednesday at 3pm.",
  recordingUrl: null,
  costUsd: null,
  costBreakdown: null,
};

/** A caller who asked to BOOK — the case that used to become 'booked'. */
const APPOINTMENT = {
  ...baseEvent,
  extracted: {
    intent: "new_booking",
    name: "Mike O'Brien",
    email: "mike@example.com",
    phone: null,
    service: "burst pipe",
    preferred_datetime: "Wednesday 12 August at 3pm",
    service_address: "14 Mill Road",
    urgent: false,
  },
};

/** A caller who wanted a call back — must never hold a slot. */
const CALLBACK = {
  ...baseEvent,
  dedupeKey: "vapi:cb:end-of-call-report",
  providerCallId: "ffffffff-6666-4666-8666-ffffffffffff",
  extracted: {
    intent: "question",
    name: "Mike O'Brien",
    email: null,
    phone: null,
    service: null,
    preferred_datetime: "Wednesday afternoon",
    service_address: null,
    urgent: true,
  },
};

/**
 * Stubs the HTTP surface, recording every lead insert, every metadata
 * update and every email. The Knowledge Base deliberately CONTAINS
 * "burst pipe", so the service matches — the exact condition that used
 * to produce a confirmed booking.
 */
function installStubs() {
  const realFetch = globalThis.fetch;
  const inserts = [];
  const updates = [];
  const emails = [];

  const json = (body) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers ?? {});
    const wantsObject = (headers.get("accept") ?? "").includes("pgrst.object");
    const body = init.body ? JSON.parse(init.body) : null;

    if (url.includes("api.resend.com")) {
      emails.push(body);
      return json({ id: `email-${emails.length}` });
    }

    if (url.includes("api.openai.com")) {
      // parseDatetimeToIso — 3pm on Wednesday 12 August, BST.
      return json({
        choices: [{ message: { content: "2026-08-12T14:00:00.000Z" } }],
      });
    }

    if (url.includes("/rest/v1/voice_calls")) {
      const row = { id: "call-row-1" };
      return wantsObject ? json(row) : json([row]);
    }

    if (url.includes("/rest/v1/business_knowledge")) {
      // The service DOES match — this is the condition that used to
      // turn a phone request into a confirmed booking.
      return json([
        { title: "Burst pipe repair", content: "We repair burst pipes." },
      ]);
    }

    if (url.includes("/rest/v1/business_hours")) {
      return json(
        [0, 1, 2, 3, 4, 5, 6].map((day_of_week) => ({
          day_of_week,
          is_closed: false,
          open_time: "09:00",
          close_time: "17:00",
          lunch_start: null,
          lunch_end: null,
        }))
      );
    }

    if (url.includes("/rest/v1/organisations")) {
      const row = {
        id: ORG_ID,
        owner_id: "22222222-2222-4222-8222-222222222222",
        business_name: "Acme Plumbing",
        notification_email: "owner@example.com",
        appointment_duration_minutes: 60,
        emergency_mode_enabled: false,
        max_concurrent_bookings: 1,
        timezone: "Europe/London",
      };
      return wantsObject ? json(row) : json([row]);
    }

    if (url.includes("/rest/v1/conversations")) {
      return wantsObject ? json(null) : json([]);
    }

    if (url.includes("/rest/v1/leads")) {
      if (method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-range": "*/0" },
        });
      }
      if (method === "POST") {
        const stored = { id: "lead-1", ...body };
        inserts.push(stored);
        return wantsObject ? json({ id: stored.id }) : json([{ id: stored.id }]);
      }
      if (method === "PATCH") {
        updates.push(body);
        return json([]);
      }
      // Only the voice metadata read-back returns a row; every other
      // SELECT finds nothing, so lead capture takes the insert path
      // rather than merging into a pre-existing lead.
      if (url.includes("select=metadata")) {
        const row = {
          metadata: {},
          appointment_datetime: inserts[0]?.appointment_datetime ?? null,
        };
        return wantsObject ? json(row) : json([row]);
      }
      return wantsObject ? json(null) : json([]);
    }

    if (url.includes("/rest/v1/voice_events")) return json([{ id: "evt-1" }]);
    if (url.includes("/rest/v1/integration_connections")) {
      return wantsObject ? json(null) : json([]);
    }

    throw new Error(`Unstubbed fetch in test: ${method} ${url}`);
  };

  return {
    inserts,
    updates,
    emails,
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

async function adminClient() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/** The metadata written by the final read-merge, if any. */
const metadataUpdate = (stubs) =>
  stubs.updates.find((u) => u.metadata)?.metadata ?? null;

describe("a phone appointment never becomes a confirmed booking", () => {
  let stubs;
  beforeEach(() => {
    stubs = installStubs();
  });
  afterEach(() => stubs.restore());

  test("the lead is not inserted as booked, even though the service matches the KB", async () => {
    await processCallEnded(await adminClient(), ORG_ID, APPOINTMENT);
    assert.equal(stubs.inserts.length, 1, "one lead");
    assert.notEqual(
      stubs.inserts[0].status,
      "booked",
      "a phone request must never be a confirmed booking"
    );
  });

  test("the confirmation email's trigger condition is never reached", async () => {
    // NOTE ON WHAT THIS PROVES. leadCapture fires
    // sendBookingConfirmationEmails inside after(), and this suite's
    // next/server stub deliberately does not run after() callbacks — so
    // "no confirmation email in stubs.emails" would hold even with the
    // bug present. What actually rules the email out is its gate:
    // `if (safeInsertStatus === "booked")`. This asserts the gate stays
    // shut, which is the real guarantee; the email list is checked too,
    // for the day that stub changes.
    await processCallEnded(await adminClient(), ORG_ID, APPOINTMENT);
    assert.notEqual(stubs.inserts[0].status, "booked", "the email gate");
    // Matched on the CUSTOMER confirmation's own subject ("Booking
    // confirmed with …"), not on the word "confirmed" appearing
    // anywhere. The owner's call summary now reports the settled
    // booking status, so its body truthfully contains "has not been
    // confirmed in the calendar yet" — scanning every email's html for
    // "confirmed" matched that and reported a customer confirmation
    // that was never sent.
    const confirmations = stubs.emails.filter((e) =>
      /booking confirmed|booking confirmation/i.test(e.subject ?? "")
    );
    assert.equal(confirmations.length, 0);
  });

  test("the owner still gets the call summary", async () => {
    await processCallEnded(await adminClient(), ORG_ID, APPOINTMENT);
    assert.equal(stubs.emails.length, 1, "exactly the call summary");
    assert.match(stubs.emails[0].subject, /Remy answered a call/);
  });

  test("the requested time is still recorded on the lead", async () => {
    await processCallEnded(await adminClient(), ORG_ID, APPOINTMENT);
    const lead = stubs.inserts[0];
    assert.equal(lead.appointment_datetime, "2026-08-12T14:00:00.000Z");
    assert.equal(lead.preferred_datetime, "Wednesday 12 August at 3pm");
  });
});

describe("the capacity marker", () => {
  let stubs;
  beforeEach(() => {
    stubs = installStubs();
  });
  afterEach(() => stubs.restore());

  test("an appointment request is marked, so it holds its slot", async () => {
    await processCallEnded(await adminClient(), ORG_ID, APPOINTMENT);
    const metadata = metadataUpdate(stubs);
    assert.ok(metadata, "metadata should have been written");
    assert.equal(metadata.appointment_request, true);
    // The existing call details are still there alongside it.
    assert.equal(metadata.caller_id, CALLER);
    assert.equal(metadata.service_address, "14 Mill Road");
  });

  test("a callback is NOT marked and cannot hold a slot", async () => {
    await processCallEnded(await adminClient(), ORG_ID, CALLBACK);
    const metadata = metadataUpdate(stubs);
    assert.ok(metadata, "callbacks still record their call details");
    assert.equal(
      metadata.appointment_request,
      undefined,
      "a callback must never consume appointment capacity"
    );
    // Callback behaviour itself is untouched.
    assert.equal(metadata.caller_id, CALLER);
  });
});
