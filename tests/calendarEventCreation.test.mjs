// Milestone 5 — a validated appointment creates the Google Calendar event.
//
// The first thing Remy does that changes something in someone else's
// Google account. Everything before this was a question; this is a
// consequence, so these tests are built around one rule:
//
//   AN APPOINTMENT IS "BOOKED" ONLY IF GOOGLE SAYS SO.
//
// A conflicted, unverifiable or failed write must leave a truthful
// pending request — never a confirmation nobody can honour.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  confirmAppointmentOnCalendar,
  buildAppointmentIdempotencyKey,
  mayConfirmBooking,
  isCalendarConfirmed,
} from "@/lib/calendarSync";
import { encryptCredentials, loadKeyringFromEnv } from "@/lib/integrations/crypto";
import { toGoogleEventId } from "@/lib/integrations/providers/google";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
const CONNECTION_ID = "22222222-2222-4222-8222-222222222222";
const RESOURCE_ID = "33333333-3333-4333-8333-333333333333";
const CALENDAR_ID = "owner@example.com";
const LEAD_ID = "44444444-4444-4444-8444-444444444444";

// Tuesday 11 August 2026, 10:00 Europe/London (BST, UTC+1) = 09:00Z.
const START_ISO = "2026-08-11T09:00:00.000Z";

const APPOINTMENT = {
  orgId: ORG_ID,
  leadId: LEAD_ID,
  startIso: START_ISO,
  durationMinutes: 60,
  serviceNeeded: "Boiler service",
  customerName: "Brian Murphy",
  customerEmail: "brian@example.com",
  location: "14 Mill Road",
};

/**
 * @param busy            free/busy windows Google reports
 * @param createStatus    HTTP status the event create returns
 * @param existingLinks   rows already in integration_links
 * @param eventCreation   value of CALENDAR_EVENT_CREATION_ENABLED
 * @param syncEnabled     integration_resources.sync_enabled
 * @param linkInsertFails make the integration_links insert fail
 */
function installStubs({
  busy = [],
  createStatus = 200,
  existingLinks = [],
  eventCreation = "true",
  syncEnabled = true,
  connected = true,
  linkInsertFails = false,
  hoursFail = false,
} = {}) {
  process.env.INTEGRATIONS_ENABLED = "true";
  process.env.CALENDAR_SYNC_ENABLED = "true";
  process.env.CALENDAR_AVAILABILITY_BLOCKING = "true";
  process.env.CALENDAR_EVENT_CREATION_ENABLED = eventCreation;
  process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "client-id";
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "client-secret";

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
  const calls = { freeBusy: 0, creates: [], linkInserts: [], orgIds: [], leadInserts: [], leadUpdates: [] };

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

    // Record every org_id a query is scoped by, so tenant isolation is
    // observed rather than assumed.
    try {
      const p = new URL(url).searchParams.get("org_id");
      if (p) calls.orgIds.push(p.replace("eq.", ""));
    } catch {}

    if (url.includes("oauth2.googleapis.com") || url.includes("/token")) {
      return json({ access_token: "fresh", expires_in: 3600, scope: "calendar" });
    }

    if (url.includes("googleapis.com/calendar/v3/freeBusy")) {
      calls.freeBusy++;
      return json({ calendars: { [CALENDAR_ID]: { busy } } });
    }

    // The event create.
    if (url.includes("/calendar/v3/calendars/") && url.includes("/events")) {
      const body = init.body ? JSON.parse(init.body) : {};
      calls.creates.push({ method, url, body });
      if (createStatus === 409) {
        return json({ error: { errors: [{ reason: "duplicate" }] } }, 409);
      }
      if (createStatus !== 200) {
        return json({ error: { message: "boom" } }, createStatus);
      }
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
        sync_enabled: syncEnabled,
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
        calls.linkInserts.push(init.body ? JSON.parse(init.body) : {});
        if (linkInsertFails) {
          return json({ message: "boom", code: "23505" }, 409);
        }
        return json([], 201);
      }
      const row = existingLinks[0] ?? null;
      return wantsObject ? json(row) : json(existingLinks);
    }

    if (url.includes("/rest/v1/business_hours")) {
      if (hoursFail) return json({ message: "boom" }, 500);
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
        appointment_duration_minutes: 60,
        emergency_mode_enabled: false,
        max_concurrent_bookings: 1,
        timezone: "Europe/London",
      };
      return wantsObject ? json(row) : json([row]);
    }

    if (url.includes("/rest/v1/leads")) {
      if (method === "POST") {
        const row = init.body ? JSON.parse(init.body) : {};
        calls.leadInserts.push(row);
        // .select("id").single() asks for a bare object, not an array —
        // returning the array leaves `inserted` null and the insert
        // looks like it failed.
        const saved = { ...row, id: LEAD_ID };
        return wantsObject ? json(saved) : json([saved]);
      }
      if (method === "PATCH") {
        calls.leadUpdates.push(init.body ? JSON.parse(init.body) : {});
        return json([]);
      }
      // No competing bookings unless a test says otherwise.
      return method === "HEAD"
        ? new Response(null, { status: 200, headers: { "content-range": "*/0" } })
        : json([]);
    }

    // parseDatetimeToIso asks the model to resolve the spoken time.
    if (url.includes("api.openai.com")) {
      return json({ choices: [{ message: { content: START_ISO } }] });
    }

    throw new Error(`Unstubbed fetch in test: ${method} ${url}`);
  };

  return {
    calls,
    restore() {
      globalThis.fetch = realFetch;
      delete process.env.CALENDAR_EVENT_CREATION_ENABLED;
    },
  };
}

let stubs;
afterEach(() => stubs?.restore());

describe("the idempotency key", () => {
  test("it identifies THIS VERSION of the appointment, not just the lead", () => {
    const a = buildAppointmentIdempotencyKey(LEAD_ID, START_ISO);
    const b = buildAppointmentIdempotencyKey(LEAD_ID, "2026-08-11T10:00:00.000Z");
    assert.notEqual(a, b, "a rescheduled appointment must not reuse its old key");
  });

  test("it is stable for the same lead and instant — so a retry repeats it", () => {
    assert.equal(
      buildAppointmentIdempotencyKey(LEAD_ID, START_ISO),
      buildAppointmentIdempotencyKey(LEAD_ID, START_ISO)
    );
  });

  test("different leads never collide at the same instant", () => {
    const other = "55555555-5555-4555-8555-555555555555";
    assert.notEqual(
      buildAppointmentIdempotencyKey(LEAD_ID, START_ISO),
      buildAppointmentIdempotencyKey(other, START_ISO)
    );
  });

  test("it survives Google's base32hex alphabet", () => {
    // toGoogleEventId strips anything outside 0-9a-v; if the key were
    // mangled to fewer than 2 usable characters it would throw, and if
    // two different keys mangled to the SAME id the whole guard fails.
    const idA = toGoogleEventId(buildAppointmentIdempotencyKey(LEAD_ID, START_ISO));
    const idB = toGoogleEventId(
      buildAppointmentIdempotencyKey(LEAD_ID, "2026-08-11T10:00:00.000Z")
    );
    assert.match(idA, /^rem[0-9a-v]+$/);
    assert.notEqual(idA, idB);
  });
});

describe("the happy path — a real event is created", () => {
  test("the outcome is 'created' and may be confirmed to the customer", async () => {
    stubs = installStubs();
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(result.outcome, "created");
    assert.ok(isCalendarConfirmed(result.outcome));
    assert.ok(mayConfirmBooking(result.outcome));
    assert.ok(result.externalEventId);
  });

  test("exactly ONE event is created", async () => {
    stubs = installStubs();
    await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(stubs.calls.creates.length, 1);
    assert.equal(stubs.calls.creates[0].method, "POST");
  });

  test("it is written to the connected calendar, not a guessed one", async () => {
    stubs = installStubs();
    await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.match(
      stubs.calls.creates[0].url,
      new RegExp(encodeURIComponent(CALENDAR_ID))
    );
  });

  test("availability is RE-VERIFIED at the write, not trusted from earlier", async () => {
    stubs = installStubs();
    await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.ok(stubs.calls.freeBusy >= 1, "a freeBusy check must precede the write");
  });

  test("the link is recorded as an APPOINTMENT, with the event id and etag", async () => {
    stubs = installStubs();
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(stubs.calls.linkInserts.length, 1);
    const link = stubs.calls.linkInserts[0];
    assert.equal(link.subject_type, "appointment", "not 'lead' — see ARCHITECTURE §P1");
    assert.equal(link.subject_id, LEAD_ID);
    assert.equal(link.org_id, ORG_ID);
    assert.equal(link.connection_id, CONNECTION_ID);
    assert.equal(link.resource_id, RESOURCE_ID);
    assert.equal(link.capability, "calendar");
    assert.equal(link.sync_status, "synced");
    assert.equal(link.external_id, result.externalEventId);
    assert.equal(link.external_etag, '"etag-1"');
  });
});

describe("timezone and duration reach the provider correctly", () => {
  test("local wall time plus an IANA zone — never a UTC offset", async () => {
    stubs = installStubs();
    await confirmAppointmentOnCalendar(APPOINTMENT);
    const { start, end } = stubs.calls.creates[0].body;
    // 09:00Z in BST is 10:00 local; the event must say 10:00, not 09:00.
    assert.equal(start.dateTime, "2026-08-11T10:00:00");
    assert.equal(start.timeZone, "Europe/London");
    assert.equal(end.timeZone, "Europe/London");
    assert.doesNotMatch(start.dateTime, /[+Z]/, "an offset would break at a DST change");
  });

  test("the end time honours the org's appointment duration", async () => {
    stubs = installStubs();
    await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(stubs.calls.creates[0].body.end.dateTime, "2026-08-11T11:00:00");
  });

  test("a 30-minute org gets a 30-minute event — nothing is hardcoded", async () => {
    stubs = installStubs();
    await confirmAppointmentOnCalendar({ ...APPOINTMENT, durationMinutes: 30 });
    assert.equal(stubs.calls.creates[0].body.end.dateTime, "2026-08-11T10:30:00");
  });

  test("the customer is attached, and the job details carried", async () => {
    stubs = installStubs();
    await confirmAppointmentOnCalendar(APPOINTMENT);
    const body = stubs.calls.creates[0].body;
    assert.match(body.summary, /Boiler service/);
    assert.equal(body.location, "14 Mill Road");
    assert.equal(body.attendees[0].email, "brian@example.com");
  });
});

describe("nothing is written when the slot is not free", () => {
  test("a calendar conflict refuses the write and is NOT bookable", async () => {
    stubs = installStubs({
      busy: [{ start: START_ISO, end: "2026-08-11T10:00:00.000Z" }],
    });
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(result.outcome, "conflict");
    assert.equal(mayConfirmBooking(result.outcome), false);
    assert.equal(stubs.calls.creates.length, 0, "no event may be written");
    assert.equal(stubs.calls.linkInserts.length, 0);
  });

  test("a PARTIAL overlap also refuses — the slot moved under us", async () => {
    // Busy 09:30–10:30 against a 09:00–10:00 appointment.
    stubs = installStubs({
      busy: [{ start: "2026-08-11T09:30:00.000Z", end: "2026-08-11T10:30:00.000Z" }],
    });
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(result.outcome, "conflict");
    assert.equal(stubs.calls.creates.length, 0);
  });

  test("an unreadable business-hours table refuses the write", async () => {
    stubs = installStubs({ hoursFail: true });
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(mayConfirmBooking(result.outcome), false);
    assert.equal(stubs.calls.creates.length, 0);
  });
});

describe("a failed write is never reported as a booking", () => {
  test("a 500 from Google leaves the appointment unconfirmed", async () => {
    stubs = installStubs({ createStatus: 500 });
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(result.outcome, "failed");
    assert.equal(mayConfirmBooking(result.outcome), false);
    assert.equal(result.externalEventId, null);
    assert.equal(stubs.calls.linkInserts.length, 0, "no link for an event that failed");
  });

  test("an expired token leaves it unconfirmed too", async () => {
    stubs = installStubs({ createStatus: 401 });
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(mayConfirmBooking(result.outcome), false);
  });

  test("a lost link does NOT un-book a real event", async () => {
    // The event exists in the customer's calendar; only our record of
    // it failed. Denying the booking would be the lie this prevents.
    stubs = installStubs({ linkInsertFails: true });
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(result.outcome, "created");
    assert.ok(mayConfirmBooking(result.outcome));
  });
});

describe("duplicate protection", () => {
  test("an existing link for the SAME instant creates no second event", async () => {
    const eventId = toGoogleEventId(
      buildAppointmentIdempotencyKey(LEAD_ID, START_ISO)
    );
    stubs = installStubs({
      existingLinks: [
        {
          id: "link-1",
          external_id: eventId,
          external_etag: '"etag-1"',
          sync_status: "synced",
          resource_id: RESOURCE_ID,
        },
      ],
    });
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(result.outcome, "already_linked");
    assert.ok(mayConfirmBooking(result.outcome), "the event is genuinely there");
    assert.equal(stubs.calls.creates.length, 0, "no duplicate event");
    assert.equal(stubs.calls.linkInserts.length, 0, "no duplicate link");
  });

  test("a 409 from Google is success, not failure — the retry already landed", async () => {
    stubs = installStubs({ createStatus: 409 });
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(result.outcome, "already_linked");
    assert.ok(mayConfirmBooking(result.outcome));
  });

  test("the event id is DERIVED, so a retry asks for the same id", async () => {
    stubs = installStubs();
    await confirmAppointmentOnCalendar(APPOINTMENT);
    const expected = toGoogleEventId(
      buildAppointmentIdempotencyKey(LEAD_ID, START_ISO)
    );
    assert.equal(stubs.calls.creates[0].body.id, expected);
  });

  test("a link pointing at a DIFFERENT time is never silently confirmed", async () => {
    // The appointment was rescheduled after the event was created.
    // Moving it is milestone 6; until then a human decides.
    const staleEventId = toGoogleEventId(
      buildAppointmentIdempotencyKey(LEAD_ID, "2026-08-11T13:00:00.000Z")
    );
    stubs = installStubs({
      existingLinks: [
        {
          id: "link-1",
          external_id: staleEventId,
          external_etag: null,
          sync_status: "synced",
          resource_id: RESOURCE_ID,
        },
      ],
    });
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(result.outcome, "stale_link");
    assert.equal(mayConfirmBooking(result.outcome), false);
    assert.equal(stubs.calls.creates.length, 0);
  });
});

describe("no calendar connected — the ordinary case, unchanged", () => {
  test("the flag off means no queries and no write", async () => {
    stubs = installStubs({ eventCreation: "false" });
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(result.outcome, "no_calendar");
    assert.ok(mayConfirmBooking(result.outcome), "booking must proceed as before");
    assert.equal(stubs.calls.creates.length, 0);
    assert.equal(stubs.calls.freeBusy, 0, "not one provider call for an unconnected org");
  });

  test("an unset flag is off — a deploy alone changes nothing", async () => {
    stubs = installStubs({ eventCreation: "" });
    delete process.env.CALENDAR_EVENT_CREATION_ENABLED;
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(result.outcome, "no_calendar");
  });

  test("nothing connected still books", async () => {
    stubs = installStubs({ connected: false });
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(result.outcome, "no_calendar");
    assert.ok(mayConfirmBooking(result.outcome));
    assert.equal(stubs.calls.creates.length, 0);
  });

  test("sync disabled on the resource is respected — read-only calendar", async () => {
    stubs = installStubs({ syncEnabled: false });
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(result.outcome, "no_calendar");
    assert.equal(stubs.calls.creates.length, 0, "the owner said do not write here");
  });
});

describe("tenant isolation", () => {
  test("every database read is scoped by the caller's org", async () => {
    stubs = installStubs();
    await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.ok(stubs.calls.orgIds.length > 0, "queries must carry an org_id");
    assert.ok(
      stubs.calls.orgIds.every((id) => id === ORG_ID),
      `every query must be scoped to the caller's org, saw: ${[...new Set(stubs.calls.orgIds)].join(", ")}`
    );
  });

  test("the link is written against the calling org, never another", async () => {
    stubs = installStubs();
    await confirmAppointmentOnCalendar({ ...APPOINTMENT, orgId: ORG_ID });
    assert.equal(stubs.calls.linkInserts[0].org_id, ORG_ID);
    assert.notEqual(stubs.calls.linkInserts[0].org_id, OTHER_ORG);
  });

  test("an org with no calendar of its own writes nothing", async () => {
    stubs = installStubs({ connected: false });
    const result = await confirmAppointmentOnCalendar({
      ...APPOINTMENT,
      orgId: OTHER_ORG,
    });
    assert.equal(result.outcome, "no_calendar");
    assert.equal(stubs.calls.creates.length, 0);
  });
});

describe("the module never throws into a booking flow", () => {
  test("an unparseable instant resolves rather than crashing", async () => {
    stubs = installStubs();
    const result = await confirmAppointmentOnCalendar({
      ...APPOINTMENT,
      startIso: "not-a-date",
    });
    assert.equal(mayConfirmBooking(result.outcome), false);
  });

  test("a hard provider failure resolves to an outcome, not an exception", async () => {
    stubs = installStubs();
    const broken = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes("googleapis.com/calendar/v3/freeBusy")) {
        throw new TypeError("network down");
      }
      return broken(url, init);
    };
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(mayConfirmBooking(result.outcome), false);
  });
});

// ── End to end through the real booking engine ────────────────────
//
// The outcomes above are only meaningful if capturePartialLead acts on
// them. These drive the REAL engine and assert on the two things a
// customer actually experiences: the status the lead is left in, and
// the reason handed to the assistant that writes the reply.

const BOOKING_LEAD = {
  intent: "new_booking",
  name: "Brian Murphy",
  email: "brian@example.com",
  phone: "+353861234567",
  service: "Boiler service",
  preferred_datetime: "Tuesday at 10am",
  confidence: 0.9,
};

async function captureBooking() {
  const { capturePartialLead } = await import("@/lib/leadCapture");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return capturePartialLead(
    createAdminClient(),
    ORG_ID,
    "conv-1",
    "I'd like a boiler service Tuesday at 10am",
    BOOKING_LEAD,
    "web_widget"
  );
}

/** The status the lead was left in, after every write. */
function finalStatus(calls) {
  const last = calls.leadUpdates[calls.leadUpdates.length - 1];
  return last?.status ?? calls.leadInserts[calls.leadInserts.length - 1]?.status;
}

describe("end to end — the customer is only told what is true", () => {
  test("a successful Google write books the lead", async () => {
    stubs = installStubs();
    const result = await captureBooking();
    assert.equal(finalStatus(stubs.calls), "booked");
    assert.equal(result.unavailableReason, null);
    assert.equal(stubs.calls.creates.length, 1, "the event really was created");
  });

  test("the lead is claimed PENDING before anything is written to Google", async () => {
    stubs = installStubs();
    await captureBooking();
    // The insert lands first and must NOT already say "booked" —
    // otherwise a crash mid-write leaves a confirmed booking with no
    // event behind it.
    assert.equal(stubs.calls.leadInserts[0].status, "awaiting_confirmation");
    assert.equal(finalStatus(stubs.calls), "booked");
  });

  test("a Google CONFLICT leaves it unbooked and says the slot has gone", async () => {
    stubs = installStubs({
      busy: [{ start: START_ISO, end: "2026-08-11T10:00:00.000Z" }],
    });
    const result = await captureBooking();
    assert.notEqual(finalStatus(stubs.calls), "booked");
    assert.equal(finalStatus(stubs.calls), "needs_review");
    assert.equal(result.unavailableReason, "capacity");
    assert.equal(stubs.calls.creates.length, 0);
  });

  test("a Google FAILURE leaves it unbooked and admits it could not confirm", async () => {
    stubs = installStubs({ createStatus: 500 });
    const result = await captureBooking();
    assert.notEqual(finalStatus(stubs.calls), "booked");
    assert.equal(result.unavailableReason, "lookup_failed");
    // Never dressed up as "that slot is fully booked" — nothing is known.
    assert.notEqual(result.unavailableReason, "capacity");
  });

  test("with the flag OFF the engine behaves exactly as it did before", async () => {
    stubs = installStubs({ eventCreation: "false" });
    const result = await captureBooking();
    // One write, straight to booked — no pending phase, no extra update.
    assert.equal(stubs.calls.leadInserts[0].status, "booked");
    assert.equal(stubs.calls.leadUpdates.length, 0, "no second write for an unconnected org");
    assert.equal(result.unavailableReason, null);
    assert.equal(stubs.calls.creates.length, 0);
    assert.equal(stubs.calls.freeBusy, 0);
  });
});
