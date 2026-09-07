// A returning customer's second booking must not eat their first.
//
// `findOpenLeadForCapture` layer 2 matches a lead by EMAIL OR PHONE,
// across every conversation the customer has ever had, with no time
// bound — and `MERGEABLE_STATUSES` included `booked`. The update path
// then reads whatever it finds as the appointment being discussed: an
// already-`booked` lead given a different requested time is a
// RESCHEDULE, so `rescheduleAppointmentOnCalendar` MOVES the existing
// Google event.
//
// So the ordinary case for every trade Remy serves — a customer coming
// back to book again — destroyed the booking they already had. Jane
// books Tuesday; a month later, in a NEW chat, she books Friday:
//
//   - the Tuesday Google event is dragged to Friday (PATCH, not POST)
//   - the Tuesday lead row is overwritten; one row where two belong
//   - NO confirmation email is sent, because that send tests
//     `existing.status !== "booked"`
//   - and the reply still reports "booked"
//
// A confirmed commitment destroyed while reporting success. There is no
// human safety net either: nothing is flagged, because the system
// believes it performed a routine reschedule.
//
// THE FIX, AND ITS SHAPE. Identifying the PERSON is not identifying the
// APPOINTMENT. Within ONE conversation those coincide, so layer 1 keeps
// the full status list and an in-session reschedule still moves the
// event. ACROSS conversations they do not, so layers 2 and 3 use
// `CROSS_CONVERSATION_MERGEABLE_STATUSES` — the same list minus
// `booked` — and the second booking takes the ordinary new-lead path.
//
// THESE TESTS DRIVE THE REAL `capturePartialLead`, and the leads stub
// honours the `status=in.(…)` filter the code actually sends rather than
// deciding for itself what may match. That is what makes the mutation
// checks meaningful: putting `booked` back into layer 2 changes which
// rows the stub returns, exactly as it would in Postgres.
//
// The deliberate trade is pinned too (test "a reschedule started in a
// NEW conversation"): it now creates a second lead instead of moving the
// first. That is the safe direction — two visible records an owner can
// reconcile, against an appointment silently destroyed — and
// /api/bookings/manage remains the designed reschedule path, untouched.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

// Registers the Google integration in the provider registry — without
// it every calendar lookup fails as "Unknown integration", and the
// reschedule this file exists to observe could never be reached.
import { reinitialiseIntegrations } from "@/lib/integrations/providers";
import {
  runAfterCallbacks,
  resetAfterCallbacks,
} from "./stubs/next-server.mjs";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CONNECTION_ID = "22222222-2222-4222-8222-222222222222";
const RESOURCE_ID = "33333333-3333-4333-8333-333333333333";
const CALENDAR_ID = "owner@example.com";
const OLD_LEAD_ID = "44444444-4444-4444-8444-444444444444";

/** Tuesday 10:00 — the appointment the customer ALREADY has. */
const TUESDAY_ISO = "2026-08-11T09:00:00.000Z";
/** Friday 14:00 — the second, unrelated appointment they now want. */
const FRIDAY_ISO = "2026-08-14T13:00:00.000Z";

const CUSTOMER = {
  name: "Jane Doe",
  email: "jane@example.com",
  phone: "+353861234567",
};

/** The lead their FIRST booking left behind, a month ago. */
function bookedLead(overrides = {}) {
  return {
    id: OLD_LEAD_ID,
    org_id: ORG_ID,
    conversation_id: "conv-first-visit",
    source: "web_widget",
    name: CUSTOMER.name,
    email: CUSTOMER.email,
    phone: CUSTOMER.phone,
    service_needed: "Boiler service",
    preferred_datetime: "Tuesday at 10am",
    appointment_datetime: TUESDAY_ISO,
    message: "I'd like a boiler service Tuesday at 10am",
    status: "booked",
    manage_token: "tok-1",
    created_at: "2026-07-11T09:00:00.000Z",
    metadata: null,
    ...overrides,
  };
}

/**
 * Parses `status=in.(a,b,c)` out of a PostgREST query string.
 *
 * The stub filters the store with this rather than with its own idea of
 * what is mergeable, so the assertions below are about the code's real
 * query — and a mutation that changes the filter changes the result.
 */
function statusFilter(searchParams) {
  const raw = searchParams.get("status");
  if (!raw || !raw.startsWith("in.")) return null;
  return raw
    .slice(3)
    .replace(/^\(|\)$/g, "")
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function installStubs({ store = [], allowCalendar = true, busy = [] } = {}) {
  process.env.INTEGRATIONS_ENABLED = "true";
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "client-id";
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "client-secret";
  process.env.CALENDAR_SYNC_ENABLED = "true";
  process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  if (allowCalendar) {
    process.env.CALENDAR_EVENT_CREATION_ORG_IDS = ORG_ID;
  } else {
    delete process.env.CALENDAR_EVENT_CREATION_ORG_IDS;
  }

  reinitialiseIntegrations(process.env);
  resetAfterCallbacks();

  const realFetch = globalThis.fetch;
  const leads = [...store];
  const calls = {
    leadInserts: [],
    leadUpdates: [],
    /** Google event POSTs — a NEW appointment in the diary. */
    eventCreates: [],
    /** Google event PATCHes — an EXISTING appointment being MOVED. */
    eventMoves: [],
    emails: [],
    /** Every status set the code asked the database for. */
    statusFilters: [],
  };
  let seq = 0;

  const json = (b, s = 200) =>
    new Response(JSON.stringify(b), {
      status: s,
      headers: { "content-type": "application/json" },
    });

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers ?? {});
    const wantsObject = (headers.get("accept") ?? "").includes("pgrst.object");
    const body = init.body ? JSON.parse(init.body) : {};
    const q = new URL(url, "https://stub.supabase.co").searchParams;
    const eqOf = (k) => (q.get(k) ?? "").replace(/^eq\./, "");

    if (url.includes("api.resend.com")) {
      calls.emails.push(body);
      return json({ id: "email-1" });
    }
    if (url.includes("oauth2.googleapis.com") || url.includes("/token")) {
      return json({ access_token: "fresh", expires_in: 3600, scope: "calendar" });
    }
    if (url.includes("googleapis.com/calendar/v3/freeBusy")) {
      return json({ calendars: { [CALENDAR_ID]: { busy } } });
    }
    if (url.includes("/calendar/v3/calendars/") && url.includes("/events")) {
      if (method === "PATCH") {
        calls.eventMoves.push({ url, body });
        return json({ id: "existing-event", etag: '"etag-2"' });
      }
      if (method === "DELETE") return json({});
      calls.eventCreates.push({ url, body });
      return json({ id: body.id ?? "new-event", etag: '"etag-1"' });
    }
    if (url.includes("/rest/v1/integration_resources")) {
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
        credentials_encrypted: CREDENTIALS,
      };
      return wantsObject ? json(row) : json([row]);
    }
    if (url.includes("/rest/v1/integration_links")) {
      if (method === "POST") return json([], 201);
      if (method === "PATCH") return json([]);
      // The link that points the OLD lead at its existing Google event —
      // without it a reschedule has nothing to move, and the test could
      // not tell "refused to move" from "had nothing to move".
      const linked = eqOf("subject_id") === OLD_LEAD_ID;
      const row = linked
        ? {
            id: "link-1",
            connection_id: CONNECTION_ID,
            subject_type: "lead",
            subject_id: OLD_LEAD_ID,
            capability: "calendar",
            external_id: "existing-event",
            external_etag: '"etag-1"',
            resource_id: RESOURCE_ID,
          }
        : null;
      return wantsObject ? json(row) : json(row ? [row] : []);
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
        owner_id: "55555555-5555-4555-8555-555555555555",
        business_name: "Acme Plumbing",
        notification_email: "owner@example.com",
        appointment_duration_minutes: 60,
        emergency_mode_enabled: false,
        max_concurrent_bookings: 5,
        timezone: "Europe/London",
      };
      return wantsObject ? json(row) : json([row]);
    }
    if (url.includes("/rest/v1/leads")) {
      if (method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-range": "*/0" },
        });
      }
      if (method === "POST") {
        const row = { id: `lead-new-${++seq}`, metadata: null, ...body };
        calls.leadInserts.push(row);
        leads.push(row);
        return wantsObject ? json(row) : json([row]);
      }
      if (method === "PATCH") {
        const id = eqOf("id");
        calls.leadUpdates.push({ id, patch: body });
        const row = leads.find((l) => l.id === id);
        if (row) Object.assign(row, body);
        return wantsObject ? json(row ?? {}) : json([]);
      }

      // ── A READ. Which lookup layer is asking? ──────────────────
      const statuses = statusFilter(q);
      if (statuses) calls.statusFilters.push(statuses);

      let candidates = leads.filter((l) => l.org_id === ORG_ID);
      if (statuses) candidates = candidates.filter((l) => statuses.includes(l.status));

      if (q.has("conversation_id")) {
        // Layer 1.
        candidates = candidates.filter(
          (l) => l.conversation_id === eqOf("conversation_id")
        );
      } else if (q.has("or") || q.has("email") || q.has("phone")) {
        // Layer 2 — email OR phone, across conversations.
        const or = q.get("or") ?? "";
        const wantEmail = q.has("email")
          ? eqOf("email")
          : (or.match(/email\.eq\.([^,)]+)/) ?? [])[1];
        const wantPhone = q.has("phone")
          ? eqOf("phone")
          : (or.match(/phone\.eq\.([^,)]+)/) ?? [])[1];
        candidates = candidates.filter(
          (l) =>
            (wantEmail && l.email === wantEmail) ||
            (wantPhone && l.phone === wantPhone)
        );
      } else if (q.has("created_at")) {
        // Layer 3 — same source, recent.
        const since = (q.get("created_at") ?? "").replace(/^gte\./, "");
        candidates = candidates.filter(
          (l) => l.source === eqOf("source") && l.created_at >= since
        );
      } else if (q.has("id")) {
        candidates = candidates.filter((l) => l.id === eqOf("id"));
      } else {
        candidates = [];
      }

      const row = candidates[0] ?? null;
      return wantsObject ? json(row) : json(row ? [row] : []);
    }
    if (url.includes("api.openai.com")) {
      // parseDatetimeToIso resolving the spoken time.
      const prompt = body?.messages?.[0]?.content ?? "";
      const iso = /friday/i.test(prompt) ? FRIDAY_ISO : TUESDAY_ISO;
      return json({ choices: [{ message: { content: iso } }] });
    }
    throw new Error(`Unstubbed fetch in test: ${method} ${url}`);
  };

  return {
    calls,
    leads,
    lead(id) {
      return leads.find((l) => l.id === id) ?? null;
    },
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

let CREDENTIALS;

async function prepareCredentials() {
  const { encryptCredentials, loadKeyringFromEnv } = await import(
    "@/lib/integrations/crypto"
  );
  CREDENTIALS = encryptCredentials(
    {
      strategy: "oauth2",
      accessToken: "ya29.token",
      refreshToken: "1//refresh",
      expiresAtIso: "2099-01-01T00:00:00.000Z",
      scopes: "calendar",
    },
    loadKeyringFromEnv()
  );
}

/** Drives the REAL capture engine. */
async function capture({ conversationId, message, extracted, source = "web_widget" }) {
  const { capturePartialLead } = await import("@/lib/leadCapture");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return capturePartialLead(
    createAdminClient(),
    ORG_ID,
    conversationId,
    message,
    extracted,
    source
  );
}

/** The second, unrelated booking Jane makes a month later. */
const SECOND_BOOKING = {
  intent: "new_booking",
  name: CUSTOMER.name,
  email: CUSTOMER.email,
  phone: CUSTOMER.phone,
  service: "Radiator repair",
  preferred_datetime: "Friday at 2pm",
  confidence: 0.9,
};

describe("a returning customer's second booking never eats their first", () => {
  let stubs;
  afterEach(() => stubs?.restore());

  test("matched by EMAIL — a second lead is created, the first is untouched", async () => {
    stubs = installStubs({ store: [bookedLead()] });
    await prepareCredentials();

    await capture({
      conversationId: "conv-second-visit",
      message: "Can I book a radiator repair for Friday at 2pm?",
      extracted: { ...SECOND_BOOKING, phone: null },
    });

    assert.equal(stubs.calls.leadInserts.length, 1, "a NEW lead was created");
    const first = stubs.lead(OLD_LEAD_ID);
    assert.equal(first.status, "booked", "the first lead is still booked");
    assert.equal(
      first.appointment_datetime,
      TUESDAY_ISO,
      "and still holds its own appointment"
    );
    assert.equal(
      stubs.calls.leadUpdates.filter((u) => u.id === OLD_LEAD_ID).length,
      0,
      "the first lead was never written to"
    );
  });

  test("matched by PHONE — same outcome", async () => {
    stubs = installStubs({ store: [bookedLead()] });
    await prepareCredentials();

    await capture({
      conversationId: "conv-second-visit",
      message: "Can I book a radiator repair for Friday at 2pm?",
      extracted: { ...SECOND_BOOKING, email: null },
    });

    assert.equal(stubs.calls.leadInserts.length, 1);
    assert.equal(stubs.lead(OLD_LEAD_ID).appointment_datetime, TUESDAY_ISO);
    assert.equal(
      stubs.calls.leadUpdates.filter((u) => u.id === OLD_LEAD_ID).length,
      0
    );
  });

  test("THE EXISTING CALENDAR EVENT IS NOT MOVED", async () => {
    // The sharpest consequence: a PATCH here is the customer's Tuesday
    // appointment being dragged onto Friday in the business's diary.
    stubs = installStubs({ store: [bookedLead()] });
    await prepareCredentials();

    await capture({
      conversationId: "conv-second-visit",
      message: "Can I book a radiator repair for Friday at 2pm?",
      extracted: SECOND_BOOKING,
    });

    assert.equal(
      stubs.calls.eventMoves.length,
      0,
      "rescheduleAppointmentOnCalendar was never invoked for the old booking"
    );
    assert.equal(
      stubs.calls.eventCreates.length,
      1,
      "the second appointment got its own event instead"
    );
  });

  test("the second booking takes the normal path and is confirmed to the customer", async () => {
    stubs = installStubs({ store: [bookedLead()] });
    await prepareCredentials();

    const result = await capture({
      conversationId: "conv-second-visit",
      message: "Can I book a radiator repair for Friday at 2pm?",
      extracted: SECOND_BOOKING,
    });

    assert.equal(result.booked, true, "reported as booked");
    const newLead = stubs.calls.leadInserts[0];
    assert.equal(stubs.lead(newLead.id).status, "booked");
    assert.equal(stubs.lead(newLead.id).appointment_datetime, FRIDAY_ISO);

    // The confirmation is deferred through `after()`, so it is flushed
    // deliberately here — every network call it makes is stubbed above.
    // This is the send the old path SKIPPED: `confirmedBooking` tested
    // `existing.status !== "booked"`, so merging onto the booked lead
    // meant the customer was told nothing at all.
    await runAfterCallbacks();
    assert.ok(
      stubs.calls.emails.some((e) =>
        String(e.to ?? "").includes(CUSTOMER.email)
      ),
      "the customer was actually told about their second appointment"
    );
  });

  test("two records exist afterwards, not one moved record", async () => {
    stubs = installStubs({ store: [bookedLead()] });
    await prepareCredentials();

    await capture({
      conversationId: "conv-second-visit",
      message: "Can I book a radiator repair for Friday at 2pm?",
      extracted: SECOND_BOOKING,
    });

    const booked = stubs.leads.filter((l) => l.status === "booked");
    assert.equal(booked.length, 2, "both appointments survive");
    const times = booked.map((l) => l.appointment_datetime).sort();
    assert.deepEqual(times, [TUESDAY_ISO, FRIDAY_ISO].sort());
  });

  test("the cross-conversation lookup does not ASK for booked leads", async () => {
    // Structural, and the one that fails loudest if `booked` is ever
    // put back into layer 2: the assertion is on the query the code
    // actually sent.
    stubs = installStubs({ store: [bookedLead()] });
    await prepareCredentials();

    await capture({
      conversationId: "conv-second-visit",
      message: "Can I book a radiator repair for Friday at 2pm?",
      extracted: SECOND_BOOKING,
    });

    const crossConversation = stubs.calls.statusFilters.slice(1);
    assert.ok(crossConversation.length > 0, "a cross-conversation lookup ran");
    for (const statuses of crossConversation) {
      assert.ok(
        !statuses.includes("booked"),
        `a cross-conversation layer asked for booked leads: ${statuses.join(",")}`
      );
      assert.ok(
        statuses.includes("needs_review") && statuses.includes("new"),
        "and it is still the mergeable list otherwise"
      );
    }
  });
});

describe("everything that legitimately merges still does", () => {
  let stubs;
  afterEach(() => stubs?.restore());

  test("LAYER 1 still accepts a booked lead — the in-conversation reschedule", async () => {
    // The same conversation the booking was made in. Here person and
    // appointment DO coincide, so this must still move the event.
    stubs = installStubs({ store: [bookedLead()] });
    await prepareCredentials();

    await capture({
      conversationId: "conv-first-visit",
      message: "Actually, can we move that to Friday at 2pm?",
      extracted: {
        intent: "reschedule",
        name: CUSTOMER.name,
        email: CUSTOMER.email,
        phone: CUSTOMER.phone,
        service: null,
        preferred_datetime: "Friday at 2pm",
        confidence: 0.8,
      },
    });

    assert.equal(stubs.calls.leadInserts.length, 0, "no second lead");
    assert.equal(
      stubs.calls.eventMoves.length,
      1,
      "the existing event really was moved"
    );
    assert.equal(
      stubs.lead(OLD_LEAD_ID).appointment_datetime,
      FRIDAY_ISO,
      "and the lead moved with it"
    );
  });

  test("layer 1 asks for booked leads — the full mergeable list", async () => {
    stubs = installStubs({ store: [bookedLead()] });
    await prepareCredentials();

    await capture({
      conversationId: "conv-first-visit",
      message: "Move it to Friday at 2pm please",
      extracted: {
        intent: "reschedule",
        name: CUSTOMER.name,
        email: CUSTOMER.email,
        phone: CUSTOMER.phone,
        service: null,
        preferred_datetime: "Friday at 2pm",
        confidence: 0.8,
      },
    });

    assert.ok(
      stubs.calls.statusFilters[0].includes("booked"),
      "the conversation lookup must still reach a booked lead"
    );
  });

  test("contact_update completing an in-conversation booking still works", async () => {
    // isBookingCompletedByContactUpdate: the time was settled in an
    // earlier turn, this turn supplies only the email. Layer 1 finds the
    // lead, so nothing about this depends on cross-conversation matching.
    stubs = installStubs({
      store: [
        bookedLead({
          status: "awaiting_confirmation",
          email: null,
          conversation_id: "conv-live",
        }),
      ],
    });
    await prepareCredentials();

    await capture({
      conversationId: "conv-live",
      message: "It's jane@example.com",
      extracted: {
        intent: "contact_update",
        name: null,
        email: CUSTOMER.email,
        phone: null,
        service: null,
        preferred_datetime: null,
        confidence: 0.6,
      },
    });

    assert.equal(stubs.calls.leadInserts.length, 0, "merged, not duplicated");
    const lead = stubs.lead(OLD_LEAD_ID);
    assert.equal(lead.email, CUSTOMER.email, "the contact detail landed");
    assert.equal(
      lead.appointment_datetime,
      TUESDAY_ISO,
      "and the appointment it already held is intact"
    );
  });

  test("LAYER 3 cannot reach a booked lead either — the recency fallback", async () => {
    // Layer 3 is the only path a customer who gives NO contact details
    // takes, and its 30-minute bound narrows WHICH lead can be reached,
    // never WHOSE. A booking made minutes earlier is still a confirmed
    // commitment, so the same rule applies — without this the fallback
    // would quietly reopen the hole layer 2 just closed.
    stubs = installStubs({
      store: [
        bookedLead({
          conversation_id: "conv-minutes-ago",
          created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        }),
      ],
    });
    await prepareCredentials();

    await capture({
      conversationId: "conv-brand-new",
      message: "Actually, could someone come Friday at 2pm as well?",
      extracted: {
        intent: "new_booking",
        name: null,
        email: null,
        phone: null,
        service: "Radiator repair",
        preferred_datetime: "Friday at 2pm",
        confidence: 0.7,
      },
    });

    assert.equal(stubs.calls.leadInserts.length, 1, "a separate record");
    assert.equal(
      stubs.lead(OLD_LEAD_ID).appointment_datetime,
      TUESDAY_ISO,
      "the recent booking is left exactly where it was"
    );
    assert.equal(
      stubs.calls.eventMoves.length,
      0,
      "and its calendar event was not moved"
    );
    const recency = stubs.calls.statusFilters[stubs.calls.statusFilters.length - 1];
    assert.ok(
      !recency.includes("booked"),
      "the recency fallback did not ask for booked leads"
    );
  });

  test("a non-booked lead is STILL matched across conversations", async () => {
    // The fix removes exactly one status. An open enquiry from the same
    // customer must still merge, or every returning customer would
    // fragment into duplicate leads.
    stubs = installStubs({
      store: [
        bookedLead({
          status: "needs_review",
          appointment_datetime: null,
          conversation_id: "conv-old",
        }),
      ],
    });
    await prepareCredentials();

    await capture({
      conversationId: "conv-new",
      message: "Can I book a radiator repair for Friday at 2pm?",
      extracted: SECOND_BOOKING,
    });

    assert.equal(
      stubs.calls.leadInserts.length,
      0,
      "the open enquiry was merged into, exactly as before"
    );
    assert.equal(stubs.lead(OLD_LEAD_ID).appointment_datetime, FRIDAY_ISO);
  });

  test("a reschedule started in a NEW conversation makes a second lead — the deliberate trade", async () => {
    // Recorded rather than hidden. It is the safe direction: two visible
    // records an owner can reconcile, against an appointment silently
    // destroyed. /api/bookings/manage remains the designed reschedule
    // path and is untouched by this change.
    stubs = installStubs({ store: [bookedLead()] });
    await prepareCredentials();

    await capture({
      conversationId: "conv-a-week-later",
      message: "I booked Tuesday, can we move it to Friday at 2pm?",
      extracted: {
        intent: "reschedule",
        name: CUSTOMER.name,
        email: CUSTOMER.email,
        phone: CUSTOMER.phone,
        service: null,
        preferred_datetime: "Friday at 2pm",
        confidence: 0.8,
      },
    });

    assert.equal(stubs.calls.leadInserts.length, 1, "a second, visible record");
    assert.equal(
      stubs.calls.eventMoves.length,
      0,
      "and the original appointment is left standing, not moved"
    );
    assert.equal(stubs.lead(OLD_LEAD_ID).appointment_datetime, TUESDAY_ISO);
  });

  test("VOICE is unaffected — it never reaches these layers at all", async () => {
    // findOpenLeadForCapture returns null for voice before layer 2, and
    // this change is entirely below that point.
    stubs = installStubs({ store: [bookedLead({ source: "voice" })] });
    await prepareCredentials();

    await capture({
      conversationId: "voice-call-2",
      message: "Phone call",
      extracted: SECOND_BOOKING,
      source: "voice",
    });

    assert.equal(stubs.calls.leadInserts.length, 1, "an isolated lead per call");
    assert.equal(stubs.lead(OLD_LEAD_ID).appointment_datetime, TUESDAY_ISO);
    assert.equal(stubs.calls.eventMoves.length, 0);
  });
});
