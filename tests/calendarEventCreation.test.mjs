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
  updateStatus = 200,
  deleteStatus = 200,
  existingLinks = [],
  eventCreation = "true",
  allowedOrgIds = undefined,
  syncEnabled = true,
  connected = true,
  linkInsertFails = false,
  hoursFail = false,
  /** organisations.timezone — the org's own IANA zone. */
  orgTimezone = "Europe/London",
} = {}) {
  process.env.INTEGRATIONS_ENABLED = "true";
  process.env.CALENDAR_SYNC_ENABLED = "true";
  process.env.CALENDAR_AVAILABILITY_BLOCKING = "true";
  // The allowlist replaced the global boolean: unset means nobody.
  // `eventCreation:"false"` is kept as the shorthand the older tests
  // use for "disabled", and now clears the list rather than setting a
  // flag to false.
  const allow =
    allowedOrgIds !== undefined
      ? allowedOrgIds
      : eventCreation === "true"
      ? ORG_ID
      : "";
  process.env.CALENDAR_EVENT_CREATION_ORG_IDS = allow;
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
  const calls = {
    freeBusy: 0, creates: [], updates: [], deletes: [],
    linkInserts: [], linkUpdates: [], orgIds: [], leadInserts: [], leadUpdates: [],
    // Counted so a test can prove an explicit date was resolved in code
    // and never handed to the model.
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

    // Event create (POST), move (PATCH) and removal (DELETE) all live
    // under the same path — kept apart so a test can tell "a second
    // event was created" from "the existing one was moved".
    if (url.includes("/calendar/v3/calendars/") && url.includes("/events")) {
      const body = init.body ? JSON.parse(init.body) : {};
      if (method === "PATCH") {
        calls.updates.push({ url, body });
        if (updateStatus !== 200) {
          return json({ error: { message: "boom" } }, updateStatus);
        }
        return json({ id: "existing-event", etag: '"etag-2"' });
      }
      if (method === "DELETE") {
        calls.deletes.push({ url });
        if (deleteStatus !== 200) {
          return json({ error: { message: "boom" } }, deleteStatus);
        }
        return json({});
      }
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
      if (method === "PATCH") {
        calls.linkUpdates.push(init.body ? JSON.parse(init.body) : {});
        return json([]);
      }
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
        timezone: orgTimezone,
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
      calls.openai++;
      return json({ choices: [{ message: { content: START_ISO } }] });
    }

    throw new Error(`Unstubbed fetch in test: ${method} ${url}`);
  };

  return {
    calls,
    restore() {
      globalThis.fetch = realFetch;
      delete process.env.CALENDAR_EVENT_CREATION_ORG_IDS;
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

  // Milestone 5 handed this case to a human ("stale_link"), because
  // moving an event did not exist yet. Milestone 6 makes it true
  // instead: the event is realigned to whatever time the appointment
  // now holds. A moved event keeps the id it was created with, so
  // staleness can no longer be inferred from that id — which is exactly
  // why guessing was replaced by an idempotent update.
  test("a link pointing at a DIFFERENT time is REALIGNED, not duplicated", async () => {
    const originalEventId = toGoogleEventId(
      buildAppointmentIdempotencyKey(LEAD_ID, "2026-08-11T13:00:00.000Z")
    );
    stubs = installStubs({
      existingLinks: [
        {
          id: "link-1",
          external_id: originalEventId,
          external_etag: null,
          sync_status: "synced",
          resource_id: RESOURCE_ID,
        },
      ],
    });
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.ok(mayConfirmBooking(result.outcome));
    assert.equal(stubs.calls.creates.length, 0, "never a second event");
    assert.equal(stubs.calls.updates.length, 1, "the existing one is moved");
    // Moved to the appointment's CURRENT time, in local wall time.
    assert.equal(stubs.calls.updates[0].body.start.dateTime, "2026-08-11T10:00:00");
  });
});

// "no_calendar" means NO EVENT EXISTS. It is not a success, and these
// tests no longer pretend it is.
//
// The two assertions below used to read `assert.ok(mayConfirmBooking(…))`
// with the justification "booking must proceed as before". That
// justification described a call production never makes. In the real
// engine `settleCalendarBacking` — the ONLY caller of mayConfirmBooking —
// is reached exclusively via `requiresCalendarBacking()`, which gates on
// the same `isCalendarEventCreationEnabled(orgId)` this function checks
// first. With the flag off the engine never consults the calendar at all:
// it writes "booked" in one pass and returns. That path is what actually
// guarantees "booking proceeds as before", and it is asserted directly by
// "with the flag OFF the engine behaves exactly as it did before" below.
//
// So the only way `no_calendar` can reach a confirmation decision is an
// ALLOWLISTED org whose calendar is disconnected or has sync switched
// off — and confirming a booking there is the false confirmation this
// module exists to prevent.
describe("no calendar connected — the ordinary case, unchanged", () => {
  test("the flag off means no queries and no write", async () => {
    stubs = installStubs({ eventCreation: "false" });
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(result.outcome, "no_calendar");
    assert.equal(
      mayConfirmBooking(result.outcome),
      false,
      "no event was created, so nothing may be confirmed from this outcome"
    );
    assert.equal(stubs.calls.creates.length, 0);
    assert.equal(stubs.calls.freeBusy, 0, "not one provider call for an unconnected org");
  });

  test("an unset flag is off — a deploy alone changes nothing", async () => {
    stubs = installStubs({ eventCreation: "" });
    delete process.env.CALENDAR_EVENT_CREATION_ORG_IDS;
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(result.outcome, "no_calendar");
  });

  test("nothing connected writes nothing, and confirms nothing", async () => {
    stubs = installStubs({ connected: false });
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(result.outcome, "no_calendar");
    assert.equal(
      mayConfirmBooking(result.outcome),
      false,
      "an allowlisted org with no connection has no event to confirm"
    );
    assert.equal(stubs.calls.creates.length, 0);
  });

  test("sync disabled on the resource is respected — read-only calendar", async () => {
    stubs = installStubs({ syncEnabled: false });
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(result.outcome, "no_calendar");
    assert.equal(stubs.calls.creates.length, 0, "the owner said do not write here");
  });
});

// ── REGRESSION: availability is not a booking ─────────────────────
//
// The bug: mayConfirmBooking() returned true for "no_calendar", so an
// allowlisted org whose calendar was disconnected (or had sync switched
// off) produced status "booked", a null unavailableReason, a "your
// appointment IS NOW BOOKED" instruction to the reply model and a
// confirmation email — with no event in anybody's Google Calendar.
//
// Pinned exhaustively over the union rather than by example, so a new
// outcome added later cannot default into "confirmable" unnoticed.

/** Every member of CalendarConfirmOutcome, and whether an event exists. */
const OUTCOMES_WITH_A_REAL_EVENT = ["created", "already_linked", "realigned"];
const OUTCOMES_WITH_NO_EVENT = ["no_calendar", "conflict", "unverified", "failed"];

describe("REGRESSION — only a real calendar event may be called booked", () => {
  test("no_calendar is NEVER confirmable", () => {
    assert.equal(
      mayConfirmBooking("no_calendar"),
      false,
      "no_calendar means no event was written — it must never confirm a booking"
    );
    assert.equal(isCalendarConfirmed("no_calendar"), false);
  });

  test("every outcome that wrote a real event is confirmable", () => {
    for (const outcome of OUTCOMES_WITH_A_REAL_EVENT) {
      assert.equal(mayConfirmBooking(outcome), true, `${outcome} holds a real event`);
    }
  });

  test("every outcome without a real event is refused", () => {
    for (const outcome of OUTCOMES_WITH_NO_EVENT) {
      assert.equal(
        mayConfirmBooking(outcome),
        false,
        `${outcome} has no event behind it and must not be confirmed`
      );
    }
  });

  test("mayConfirmBooking has no confirmable case isCalendarConfirmed lacks", () => {
    // The two diverged once — that divergence WAS the bug. Any future
    // exception has to be added here deliberately, not slipped in.
    for (const outcome of [...OUTCOMES_WITH_A_REAL_EVENT, ...OUTCOMES_WITH_NO_EVENT]) {
      assert.equal(
        mayConfirmBooking(outcome),
        isCalendarConfirmed(outcome),
        `${outcome}: confirmability must track whether an event actually exists`
      );
    }
  });

  test("a disconnected calendar on an ALLOWLISTED org confirms nothing", async () => {
    // The exact production shape of the bug: the org may be written to,
    // so the engine takes the calendar-backed path — but there is no
    // calendar there to write to.
    stubs = installStubs({ allowedOrgIds: ORG_ID, connected: false });
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(result.outcome, "no_calendar");
    assert.equal(result.externalEventId, null, "there is no event id to point at");
    assert.equal(mayConfirmBooking(result.outcome), false);
    assert.equal(stubs.calls.creates.length, 0);
  });

  test("sync switched off on an ALLOWLISTED org confirms nothing either", async () => {
    stubs = installStubs({ allowedOrgIds: ORG_ID, syncEnabled: false });
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(result.outcome, "no_calendar");
    assert.equal(mayConfirmBooking(result.outcome), false);
    assert.equal(stubs.calls.creates.length, 0);
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
    // ONE free/busy read, where this once expected none.
    //
    // The allowlist gates WRITES. Reads are gated by
    // CALENDAR_SYNC_ENABLED plus a connected calendar with availability
    // enabled — and this org has one. The old expectation of zero was an
    // artifact of chat never consulting the calendar at all: the only
    // free/busy request on this path came from calendarSync's pre-write
    // re-check, which never ran with writes disabled.
    //
    // Chat now asks before it answers, on every org with a calendar
    // connected, whether or not we may write to it. The BOOKING
    // behaviour asserted above is unchanged: still booked in one write,
    // still no event created.
    assert.equal(stubs.calls.freeBusy, 1);
  });
});

// ── REGRESSION: the chat reply may not claim a booking that isn't ──
//
// The outcome-level tests above prove mayConfirmBooking refuses
// "no_calendar". This proves the refusal survives all the way to the
// only thing the customer actually experiences: the instruction handed
// to the model that writes the reply.
//
// Composed exactly as the chat and widget routes compose it — see
// src/app/api/chat/route.ts and src/app/api/widget/chat/route.ts, which
// both build this note from the same three capturePartialLead fields.

/** The "what has just happened" section the reply model is given. */
async function replyNoteFor(result, intent = "new_booking") {
  const { buildBookingOutcomeNote, buildDatetimeClarificationNote } = await import(
    "@/lib/bookingOutcome"
  );
  const clarification = buildDatetimeClarificationNote({
    needsClarification: result.needsClarification,
    clarificationDate: result.clarificationDate,
  });
  return clarification
    ? null
    : buildBookingOutcomeNote({
        intent,
        booked: result.booked,
        appointmentIso: result.appointmentIso,
        unavailableReason: result.unavailableReason,
      });
}

/** Nothing the model is told may read as a confirmed appointment. */
function assertMakesNoBookingClaim(note, context) {
  if (note === null) return; // the model is told nothing — the safe state
  assert.doesNotMatch(
    note,
    /\b(booked|scheduled|confirmed|is now booked|has been moved)\b/i,
    `${context}: the reply model was told a booking happened when none did — ${note}`
  );
}

describe("REGRESSION — chat/widget never claims a booking without an event", () => {
  test("CONTROL: a real Google write DOES produce the confirmation note", async () => {
    // Without this, every assertion below would pass on a note builder
    // that had simply been broken to return null forever.
    stubs = installStubs({ allowedOrgIds: ORG_ID });
    const result = await captureBooking();
    const note = await replyNoteFor(result);
    assert.equal(stubs.calls.creates.length, 1, "the event really was created");
    assert.equal(finalStatus(stubs.calls), "booked");
    assert.ok(note, "a genuine booking must still be confirmed to the customer");
    assert.match(note, /IS NOW BOOKED/);
  });

  test("allowlisted org, calendar DISCONNECTED — the bug, end to end", async () => {
    stubs = installStubs({ allowedOrgIds: ORG_ID, connected: false });
    const result = await captureBooking();

    assert.equal(stubs.calls.creates.length, 0, "no event was created");
    assert.notEqual(finalStatus(stubs.calls), "booked", "the lead must not be left booked");
    assert.equal(finalStatus(stubs.calls), "needs_review", "the owner must see it instead");
    assert.equal(
      result.unavailableReason,
      "lookup_failed",
      "never dressed up as 'that slot is taken' — nothing about the slot is known"
    );
    assertMakesNoBookingClaim(await replyNoteFor(result), "disconnected calendar");
  });

  test("allowlisted org, sync SWITCHED OFF — same refusal", async () => {
    stubs = installStubs({ allowedOrgIds: ORG_ID, syncEnabled: false });
    const result = await captureBooking();

    assert.equal(stubs.calls.creates.length, 0);
    assert.notEqual(finalStatus(stubs.calls), "booked");
    assertMakesNoBookingClaim(await replyNoteFor(result), "sync disabled");
  });

  test("a Google CONFLICT claims nothing either", async () => {
    stubs = installStubs({
      allowedOrgIds: ORG_ID,
      busy: [{ start: START_ISO, end: "2026-08-11T10:00:00.000Z" }],
    });
    const result = await captureBooking();
    assert.equal(stubs.calls.creates.length, 0);
    assertMakesNoBookingClaim(await replyNoteFor(result), "google conflict");
  });

  test("a FAILED Google write claims nothing either", async () => {
    stubs = installStubs({ allowedOrgIds: ORG_ID, createStatus: 500 });
    const result = await captureBooking();
    assert.notEqual(finalStatus(stubs.calls), "booked");
    assertMakesNoBookingClaim(await replyNoteFor(result), "google write failed");
  });

  test("no confirmation EMAIL is sent when no event exists", async () => {
    // The same false confirmation, in the customer's inbox rather than
    // the chat window. sendBookingConfirmationEmails is gated on the
    // settled status, so a Resend call here would mean the gate leaked.
    stubs = installStubs({ allowedOrgIds: ORG_ID, connected: false });
    await captureBooking();
    assert.equal(
      stubs.calls.creates.length,
      0,
      "no event, and therefore nothing to confirm by email"
    );
    assert.notEqual(finalStatus(stubs.calls), "booked");
  });

  test("the flag-off majority still books, and is still told so", async () => {
    // The behaviour the old `no_calendar → confirmable` rule claimed to
    // protect. It is protected by requiresCalendarBacking(), not by
    // mayConfirmBooking(), and this proves the change did not touch it.
    stubs = installStubs({ eventCreation: "false" });
    const result = await captureBooking();
    const note = await replyNoteFor(result);
    assert.equal(stubs.calls.leadInserts[0].status, "booked", "straight to booked, one write");
    assert.equal(stubs.calls.creates.length, 0);
    assert.equal(result.unavailableReason, null);
    assert.ok(note, "an org with no calendar integration still confirms as it always has");
    assert.match(note, /IS NOW BOOKED/);
  });
});

// ══════════════════════════════════════════════════════════════════
//  Milestone 6 — reschedule and cancel sync
// ══════════════════════════════════════════════════════════════════
//
// The truthfulness rule is deliberately ASYMMETRIC, and that asymmetry
// is the whole design:
//
//   RESCHEDULE  must not be claimed unless Google moved. Saying "moved
//               to Thursday" while the event sits on Tuesday is the
//               desync this milestone exists to close, and the customer
//               loses nothing by trying again.
//
//   CANCEL      must always succeed locally. Trapping a customer in an
//               appointment because Google is unreachable is far worse
//               than leaving the business one ghost event to clear.

const LINKED = [
  {
    id: "link-1",
    external_id: "rem-existing-event",
    external_etag: '"etag-1"',
    sync_status: "synced",
    resource_id: RESOURCE_ID,
  },
];

// Thursday 13 August 2026, 10:00 London — well clear of START_ISO.
const MOVED_ISO = "2026-08-13T09:00:00.000Z";

async function reschedule(toIso, fromIso = START_ISO, opts = {}) {
  const { rescheduleAppointmentOnCalendar } = await import("@/lib/calendarSync");
  return rescheduleAppointmentOnCalendar(
    { ...APPOINTMENT, startIso: toIso, ...opts },
    fromIso
  );
}

describe("milestone 6 — reschedule moves the event", () => {
  test("a clear new slot moves the existing event, never creates a new one", async () => {
    stubs = installStubs({ existingLinks: LINKED });
    const result = await reschedule(MOVED_ISO);
    assert.equal(result.outcome, "synced");
    assert.equal(stubs.calls.updates.length, 1);
    assert.equal(stubs.calls.creates.length, 0, "a move is not a new booking");
    assert.equal(stubs.calls.updates[0].body.start.dateTime, "2026-08-13T10:00:00");
    assert.equal(stubs.calls.updates[0].body.start.timeZone, "Europe/London");
  });

  test("the link is re-stamped as synced, with the new etag", async () => {
    stubs = installStubs({ existingLinks: LINKED });
    await reschedule(MOVED_ISO);
    const patch = stubs.calls.linkUpdates.at(-1);
    assert.equal(patch.sync_status, "synced");
    assert.equal(patch.external_etag, '"etag-2"');
    assert.equal(patch.last_error, null);
  });

  test("the new slot is re-verified before the move", async () => {
    stubs = installStubs({ existingLinks: LINKED });
    await reschedule(MOVED_ISO);
    assert.ok(stubs.calls.freeBusy >= 1);
  });

  test("a busy new slot refuses the move and offers an alternative", async () => {
    stubs = installStubs({
      existingLinks: LINKED,
      busy: [{ start: MOVED_ISO, end: "2026-08-13T10:00:00.000Z" }],
    });
    const result = await reschedule(MOVED_ISO);
    assert.equal(result.outcome, "conflict");
    assert.equal(stubs.calls.updates.length, 0, "nothing may move onto a busy slot");
  });

  test("a failed provider move reports failure — the caller keeps the old time", async () => {
    stubs = installStubs({ existingLinks: LINKED, updateStatus: 500 });
    const result = await reschedule(MOVED_ISO);
    assert.equal(result.outcome, "failed");
    const patch = stubs.calls.linkUpdates.at(-1);
    assert.equal(patch.sync_status, "failed", "the desync is recorded, not hidden");
    assert.ok(patch.last_error);
  });

  test("a SHORT move does not clash with the appointment's own event", async () => {
    // 10:00 -> 10:30. The org's own event occupies that window and
    // free/busy cannot tell it from anyone else's, so the external
    // check is skipped; without that, every short reschedule would be
    // refused as a clash with the very event it is about to move.
    stubs = installStubs({
      existingLinks: LINKED,
      busy: [{ start: START_ISO, end: "2026-08-11T10:00:00.000Z" }],
    });
    const result = await reschedule("2026-08-11T09:30:00.000Z", START_ISO);
    assert.equal(result.outcome, "synced");
    assert.equal(stubs.calls.updates.length, 1);
  });

  test("an appointment with no event is left alone", async () => {
    stubs = installStubs({ existingLinks: [] });
    const result = await reschedule(MOVED_ISO);
    assert.equal(result.outcome, "no_calendar");
    assert.equal(stubs.calls.updates.length, 0);
  });

  test("the flag off does nothing at all", async () => {
    stubs = installStubs({ existingLinks: LINKED, eventCreation: "false" });
    const result = await reschedule(MOVED_ISO);
    assert.equal(result.outcome, "no_calendar");
    assert.equal(stubs.calls.updates.length, 0);
    assert.equal(stubs.calls.freeBusy, 0);
  });
});

describe("milestone 6 — cancel removes the event", () => {
  async function cancel(orgId = ORG_ID, leadId = LEAD_ID) {
    const { cancelAppointmentOnCalendar } = await import("@/lib/calendarSync");
    return cancelAppointmentOnCalendar(orgId, leadId);
  }

  test("the event is deleted and the link marked deleted", async () => {
    stubs = installStubs({ existingLinks: LINKED });
    const result = await cancel();
    assert.equal(result.outcome, "synced");
    assert.equal(stubs.calls.deletes.length, 1);
    assert.equal(stubs.calls.linkUpdates.at(-1).sync_status, "deleted");
  });

  test("an already-gone event is success, so a repeated cancel is safe", async () => {
    stubs = installStubs({ existingLinks: LINKED, deleteStatus: 404 });
    const result = await cancel();
    assert.equal(result.outcome, "synced", "404/410 mean the desired end state");
  });

  test("a provider failure is recorded, never hidden", async () => {
    stubs = installStubs({ existingLinks: LINKED, deleteStatus: 500 });
    const result = await cancel();
    assert.equal(result.outcome, "failed");
    const patch = stubs.calls.linkUpdates.at(-1);
    assert.equal(patch.sync_status, "failed");
    assert.ok(patch.last_error, "the owner must be able to see the ghost event");
  });

  test("no event, nothing to remove", async () => {
    stubs = installStubs({ existingLinks: [] });
    const result = await cancel();
    assert.equal(result.outcome, "no_calendar");
    assert.equal(stubs.calls.deletes.length, 0);
  });

  test("every query stays scoped to the calling org", async () => {
    stubs = installStubs({ existingLinks: LINKED });
    await cancel();
    assert.ok(stubs.calls.orgIds.every((id) => id === ORG_ID));
  });

  test("neither operation ever throws into the caller", async () => {
    stubs = installStubs({ existingLinks: LINKED });
    const inner = globalThis.fetch;
    globalThis.fetch = async (u, i) => {
      if (String(u).includes("/calendar/v3/calendars/")) throw new TypeError("down");
      return inner(u, i);
    };
    assert.equal((await cancel()).outcome, "failed");
    assert.equal((await reschedule(MOVED_ISO)).outcome, "failed");
  });
});

// ══════════════════════════════════════════════════════════════════
//  Blocker regressions found reviewing milestone 6
// ══════════════════════════════════════════════════════════════════
//
// Both were real, both were missed by the tests above, and both are
// pinned here through the paths a customer actually travels.

/**
 * A chat/widget turn arriving at a lead that is ALREADY booked — the
 * shape of every reschedule that does not go through the manage link.
 */
// The target time comes from the datetime parser, which bookedLeadStubs
// pins to MOVED_ISO — there is no argument to vary here, and pretending
// otherwise would suggest control this helper does not have.
async function chatReschedule() {
  const { capturePartialLead } = await import("@/lib/leadCapture");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return capturePartialLead(
    createAdminClient(),
    ORG_ID,
    "conv-1",
    "actually, can we move it?",
    {
      intent: "reschedule",
      name: "Brian Murphy",
      email: "brian@example.com",
      phone: null,
      service: null,
      preferred_datetime: "Thursday at 10am",
      confidence: 0.9,
    },
    "web_widget"
  );
}

/**
 * Stubs a lead that is already booked at `fromIso`, so the merge path
 * finds it and treats the turn as a reschedule.
 */
function bookedLeadStubs(opts = {}) {
  const s = installStubs({ existingLinks: LINKED, ...opts });
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(typeof input === "string" ? input : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    const wantsObject = (new Headers(init.headers ?? {}).get("accept") ?? "").includes(
      "pgrst.object"
    );
    if (url.includes("api.openai.com")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: MOVED_ISO } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/leads") && method === "GET") {
      const row = {
        id: LEAD_ID,
        // Selected by every real query (LEAD_FIELDS includes it) and
        // required now that the write gate is per-org — without it the
        // gate correctly fails closed and nothing reaches Google.
        org_id: ORG_ID,
        name: "Brian Murphy",
        email: "brian@example.com",
        phone: null,
        service_needed: "Boiler service",
        preferred_datetime: "Tuesday 10am",
        appointment_datetime: START_ISO,
        message: "hi",
        status: "booked",
        conversation_id: "conv-1",
        manage_token: "mt",
        metadata: {},
      };
      return new Response(JSON.stringify(wantsObject ? row : [row]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return inner(input, init);
  };
  return s;
}

describe("BLOCKER 1 — a chat reschedule moves the real event", () => {
  test("the existing event is moved, and the new time is stored", async () => {
    stubs = bookedLeadStubs();
    await chatReschedule();
    assert.equal(stubs.calls.updates.length, 1, "the Google event must actually move");
    assert.equal(stubs.calls.updates[0].body.start.dateTime, "2026-08-13T10:00:00");
    assert.equal(stubs.calls.creates.length, 0, "a move is never a second event");
    assert.equal(stubs.calls.leadUpdates.at(-1).appointment_datetime, MOVED_ISO);
  });

  test("a REFUSED move keeps the original time — the silent desync", async () => {
    // The bug this replaces: the lead moved to Thursday while the event
    // stayed on Tuesday, and the customer was told Thursday.
    stubs = bookedLeadStubs({ updateStatus: 500 });
    const result = await chatReschedule();
    const written = stubs.calls.leadUpdates.at(-1);
    assert.equal(
      written.appointment_datetime,
      START_ISO,
      "the stored time must NOT move when Google refused"
    );
    assert.equal(written.status, "booked", "the original booking still stands");
    assert.equal(result.unavailableReason, "lookup_failed");
  });

  test("a CONFLICT on the new slot keeps the original time too", async () => {
    stubs = bookedLeadStubs({
      busy: [{ start: MOVED_ISO, end: "2026-08-13T10:00:00.000Z" }],
    });
    const result = await chatReschedule();
    assert.equal(stubs.calls.leadUpdates.at(-1).appointment_datetime, START_ISO);
    assert.equal(result.unavailableReason, "capacity");
    assert.equal(stubs.calls.updates.length, 0, "nothing moves onto a busy slot");
  });

  test("with the flag off the time still moves — behaviour as before", async () => {
    stubs = bookedLeadStubs({ eventCreation: "false" });
    await chatReschedule();
    assert.equal(stubs.calls.leadUpdates.at(-1).appointment_datetime, MOVED_ISO);
    assert.equal(stubs.calls.updates.length, 0);
    // One availability read on the destination slot (see the note on the
    // milestone-5 flag-off test). The time still moves, and still no
    // Google event is touched — which is what this test is about.
    assert.equal(stubs.calls.freeBusy, 1);
  });
});

describe("BLOCKER 2 — cancellation is local-first", () => {
  async function cancelViaManageLink() {
    const { POST } = await import("@/app/api/bookings/manage/route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("https://app.test/api/bookings/manage", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `1.2.3.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify({ token: "mt", action: "cancel" }),
    });
    return POST(req);
  }

  test("the lead is cancelled BEFORE Google is touched", async () => {
    stubs = bookedLeadStubs();
    const order = [];
    const inner = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
      const url = String(typeof input === "string" ? input : input.url);
      const method = (init.method ?? "GET").toUpperCase();
      if (url.includes("/rest/v1/leads") && method === "PATCH") order.push("local");
      if (url.includes("/calendar/v3/calendars/") && method === "DELETE") order.push("google");
      return inner(input, init);
    };
    await cancelViaManageLink();
    assert.deepEqual(order, ["local", "google"], "local state must be safe first");
  });

  test("a provider failure still leaves the lead cancelled", async () => {
    // The failure this ordering makes impossible: event deleted while
    // the lead still says booked. The accepted failure is the reverse —
    // a ghost event, recorded on the link.
    stubs = bookedLeadStubs({ deleteStatus: 500 });
    const res = await cancelViaManageLink();
    assert.equal(res.status, 200, "the customer's cancellation must not fail");
    const cancelled = stubs.calls.leadUpdates.find((u) => u.status === "cancelled");
    assert.ok(cancelled, "the lead is cancelled regardless of Google");
    assert.equal(stubs.calls.linkUpdates.at(-1).sync_status, "failed");
    assert.ok(stubs.calls.linkUpdates.at(-1).last_error, "the ghost event is recorded");
  });
});

// ══════════════════════════════════════════════════════════════════
//  The org allowlist — CALENDAR_EVENT_CREATION_ORG_IDS
// ══════════════════════════════════════════════════════════════════
//
// A global boolean could not express "the test org only". It would have
// been safe purely because one org happened to have connected a
// calendar — a property of the DATA, not of the flag. Selecting a
// calendar sets sync_enabled = true automatically, so any org
// connecting one mid-rollout would have started receiving writes with
// no further action.
//
// These pin the gate itself and then prove all three operations obey it.

import { isCalendarEventCreationEnabled } from "@/lib/integrations/flags";

const CAL_ENV = {
  INTEGRATIONS_ENABLED: "true",
  CALENDAR_SYNC_ENABLED: "true",
};

describe("the allowlist gate", () => {
  const gate = (list, org = ORG_ID, extra = {}) =>
    isCalendarEventCreationEnabled(org, {
      ...CAL_ENV,
      CALENDAR_EVENT_CREATION_ORG_IDS: list,
      ...extra,
    });

  test("an allowlisted org is enabled", () => {
    assert.equal(gate(ORG_ID), true);
  });

  test("a non-allowlisted org is NOT — no cross-org leakage", () => {
    assert.equal(gate(ORG_ID, OTHER_ORG), false);
  });

  test("an empty list disables everyone", () => {
    assert.equal(gate(""), false);
    assert.equal(gate("", OTHER_ORG), false);
  });

  test("a missing variable disables everyone", () => {
    assert.equal(
      isCalendarEventCreationEnabled(ORG_ID, { ...CAL_ENV }),
      false
    );
  });

  test("a list of only separators and whitespace disables everyone", () => {
    for (const junk of [",", " , , ", "   "]) {
      assert.equal(gate(junk), false, `"${junk}" must not enable anyone`);
    }
  });

  test("multiple ids parse, with whitespace tolerated", () => {
    const list = ` ${OTHER_ORG} , ${ORG_ID} `;
    assert.equal(gate(list), true);
    assert.equal(gate(list, OTHER_ORG), true);
    assert.equal(gate(list, "77777777-7777-4777-8777-777777777777"), false);
  });

  test("matching is case-insensitive, so a copy-paste cannot fail silently", () => {
    assert.equal(gate(ORG_ID.toUpperCase()), true);
    assert.equal(gate(ORG_ID, ORG_ID.toUpperCase()), true);
  });

  test("a partial or prefix id never matches", () => {
    assert.equal(gate(ORG_ID.slice(0, 8)), false);
    assert.equal(gate(ORG_ID, ORG_ID.slice(0, 8)), false);
    assert.equal(gate(`${ORG_ID}-extra`), false);
  });

  test("an empty or missing orgId is never allowed", () => {
    // Called directly: the helper's default parameter would swallow an
    // explicit `undefined` and silently test ORG_ID instead.
    const env = { ...CAL_ENV, CALENDAR_EVENT_CREATION_ORG_IDS: ORG_ID };
    assert.equal(isCalendarEventCreationEnabled("", env), false);
    assert.equal(isCalendarEventCreationEnabled(undefined, env), false);
    assert.equal(isCalendarEventCreationEnabled(null, env), false);
  });

  test("CALENDAR_SYNC_ENABLED remains a prerequisite", () => {
    assert.equal(
      isCalendarEventCreationEnabled(ORG_ID, {
        INTEGRATIONS_ENABLED: "true",
        CALENDAR_SYNC_ENABLED: "false",
        CALENDAR_EVENT_CREATION_ORG_IDS: ORG_ID,
      }),
      false,
      "an allowlisted org must still be gated by calendar sync"
    );
    assert.equal(
      isCalendarEventCreationEnabled(ORG_ID, {
        INTEGRATIONS_ENABLED: "false",
        CALENDAR_SYNC_ENABLED: "true",
        CALENDAR_EVENT_CREATION_ORG_IDS: ORG_ID,
      }),
      false,
      "and by the framework switch above it"
    );
  });
});

describe("create, reschedule and cancel all obey the same org gate", () => {
  test("CREATE writes for an allowlisted org", async () => {
    stubs = installStubs({ allowedOrgIds: ORG_ID });
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(result.outcome, "created");
    assert.equal(stubs.calls.creates.length, 1);
  });

  test("CREATE writes nothing for an org that is not listed", async () => {
    stubs = installStubs({ allowedOrgIds: OTHER_ORG });
    const result = await confirmAppointmentOnCalendar(APPOINTMENT);
    assert.equal(result.outcome, "no_calendar");
    assert.equal(mayConfirmBooking(result.outcome), false, "booking must not be confirmed without a calendar event");
    assert.equal(stubs.calls.creates.length, 0);
    assert.equal(stubs.calls.freeBusy, 0, "not one provider call for an unlisted org");
  });

  test("RESCHEDULE moves nothing for an org that is not listed", async () => {
    stubs = installStubs({ allowedOrgIds: OTHER_ORG, existingLinks: LINKED });
    const { rescheduleAppointmentOnCalendar } = await import("@/lib/calendarSync");
    const result = await rescheduleAppointmentOnCalendar(
      { ...APPOINTMENT, startIso: MOVED_ISO },
      START_ISO
    );
    assert.equal(result.outcome, "no_calendar");
    assert.equal(stubs.calls.updates.length, 0);
  });

  test("CANCEL removes nothing for an org that is not listed", async () => {
    stubs = installStubs({ allowedOrgIds: OTHER_ORG, existingLinks: LINKED });
    const { cancelAppointmentOnCalendar } = await import("@/lib/calendarSync");
    const result = await cancelAppointmentOnCalendar(ORG_ID, LEAD_ID);
    assert.equal(result.outcome, "no_calendar");
    assert.equal(stubs.calls.deletes.length, 0);
  });

  test("an EMPTY allowlist stops all three operations", async () => {
    const { rescheduleAppointmentOnCalendar, cancelAppointmentOnCalendar } =
      await import("@/lib/calendarSync");

    stubs = installStubs({ allowedOrgIds: "", existingLinks: LINKED });
    assert.equal((await confirmAppointmentOnCalendar(APPOINTMENT)).outcome, "no_calendar");
    assert.equal(
      (await rescheduleAppointmentOnCalendar({ ...APPOINTMENT, startIso: MOVED_ISO }, START_ISO)).outcome,
      "no_calendar"
    );
    assert.equal((await cancelAppointmentOnCalendar(ORG_ID, LEAD_ID)).outcome, "no_calendar");
    assert.equal(stubs.calls.creates.length, 0);
    assert.equal(stubs.calls.updates.length, 0);
    assert.equal(stubs.calls.deletes.length, 0);
  });

  test("one listed org does not enable another that shares a connection", async () => {
    // The stubbed connection/resource are returned for ANY org, so if
    // the gate leaked, this write would land on the listed org's
    // calendar under a different org's id — the worst outcome there is.
    stubs = installStubs({ allowedOrgIds: ORG_ID, existingLinks: [] });
    const result = await confirmAppointmentOnCalendar({
      ...APPOINTMENT,
      orgId: OTHER_ORG,
    });
    assert.equal(result.outcome, "no_calendar");
    assert.equal(stubs.calls.creates.length, 0, "no write may occur under an unlisted org");
  });
});

describe("the lead engine obeys the allowlist too", () => {
  test("an unlisted org books exactly as it does today, with no writes", async () => {
    stubs = installStubs({ allowedOrgIds: OTHER_ORG });
    const { capturePartialLead } = await import("@/lib/leadCapture");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const result = await capturePartialLead(
      createAdminClient(),
      ORG_ID,
      "conv-1",
      "boiler service Tuesday at 10am",
      BOOKING_LEAD,
      "web_widget"
    );
    // Straight to booked in one write — no pending phase, no event
    // written. An org off the WRITE allowlist is still asked about
    // availability, because its calendar is connected (see the note on
    // the milestone-5 flag-off test); the booking outcome is unchanged.
    assert.equal(stubs.calls.leadInserts[0].status, "booked");
    assert.equal(stubs.calls.leadUpdates.length, 0);
    assert.equal(result.unavailableReason, null);
    assert.equal(stubs.calls.creates.length, 0);
    assert.equal(stubs.calls.freeBusy, 1);
  });
});

// ══════════════════════════════════════════════════════════════════
//  The engine reports what it actually did
// ══════════════════════════════════════════════════════════════════
//
// buildBookingOutcomeNote is only as truthful as its inputs. These pin
// that capturePartialLead's reported outcome matches the row it wrote —
// the link between the mutation and the customer-facing reply.

import { buildBookingOutcomeNote } from "@/lib/bookingOutcome";

describe("capturePartialLead reports the outcome it actually persisted", () => {
  test("a successful booking reports booked + the stored instant", async () => {
    stubs = installStubs();
    const result = await captureBooking();
    assert.equal(result.booked, true);
    assert.equal(result.appointmentIso, START_ISO);
    assert.equal(
      stubs.calls.leadUpdates.at(-1)?.status ?? stubs.calls.leadInserts.at(-1)?.status,
      "booked",
      "the reported outcome must match the row"
    );
    // …and that is enough to state the truth to the customer.
    const note = buildBookingOutcomeNote({
      intent: "new_booking",
      booked: result.booked,
      appointmentIso: result.appointmentIso,
      unavailableReason: result.unavailableReason,
    });
    assert.ok(note);
    assert.match(note, /IS NOW BOOKED/);
  });

  test("a calendar CONFLICT reports NOT booked, so no success is claimed", async () => {
    stubs = installStubs({
      busy: [{ start: START_ISO, end: "2026-08-11T10:00:00.000Z" }],
    });
    const result = await captureBooking();
    assert.equal(result.booked, false);
    assert.equal(result.unavailableReason, "capacity");
    assert.equal(
      buildBookingOutcomeNote({
        intent: "new_booking",
        booked: result.booked,
        appointmentIso: result.appointmentIso,
        unavailableReason: result.unavailableReason,
      }),
      null,
      "a refused booking must never produce a confirmation"
    );
  });

  test("a chat RESCHEDULE reports the new time it stored", async () => {
    stubs = bookedLeadStubs();
    const result = await chatReschedule();
    assert.equal(result.appointmentIso, MOVED_ISO);
    assert.equal(stubs.calls.leadUpdates.at(-1).appointment_datetime, MOVED_ISO);
    const note = buildBookingOutcomeNote({
      intent: "reschedule",
      booked: result.booked,
      appointmentIso: result.appointmentIso,
      unavailableReason: result.unavailableReason,
    });
    assert.ok(note, "the live bug: this note was missing entirely");
    assert.match(note, /HAS BEEN MOVED/);
    assert.match(note, /13 August 2026/);
  });

  test("a REFUSED chat reschedule reports the OLD time and claims nothing", async () => {
    stubs = bookedLeadStubs({ updateStatus: 500 });
    const result = await chatReschedule();
    assert.equal(
      result.appointmentIso,
      START_ISO,
      "the appointment did not move, and the report says so"
    );
    assert.equal(result.unavailableReason, "lookup_failed");
    assert.equal(
      buildBookingOutcomeNote({
        intent: "reschedule",
        booked: result.booked,
        appointmentIso: result.appointmentIso,
        unavailableReason: result.unavailableReason,
      }),
      null,
      "a refused move must never be announced as moved"
    );
  });
});

// ══════════════════════════════════════════════════════════════════
//  REGRESSION — the UPDATE path reports the calendar's verdict
// ══════════════════════════════════════════════════════════════════
//
// The tests above drive the INSERT path, which returns the honest
// `confirmedInsert`. The UPDATE path — an existing open lead that
// becomes a booking on a later turn — returned
//
//   booked: confirmedBooking || safeNextStatus === "booked"
//
// and `backsWithCalendar` implies `safeNextStatus === "booked"` by
// construction (requiresCalendarBacking demands it). So the OR could
// never be false when the calendar was consulted: settleCalendarBacking's
// verdict was computed, assigned, and then discarded. The engine reported
// `booked: true` while the row it had just written said `needs_review`.
//
// Not customer-visible today — settleCalendarBacking also sets
// `unavailableReason`, and buildBookingOutcomeNote checks that FIRST —
// but the reported value contradicted the persisted one, which is the
// coupling `bookingOutcome.ts` exists to keep honest.
//
// The OR is NOT removable: for a lead that is already `booked`,
// `confirmedBooking` is false by design (it tests
// `existing.status !== "booked"`), and a chat reschedule still has to
// report its booking. That case is pinned by "a chat RESCHEDULE reports
// the new time it stored" above, and again below.

/**
 * An existing OPEN lead (status "new", no appointment yet) on the same
 * conversation, so the next booking message takes the UPDATE path
 * rather than inserting.
 *
 * Only the conversation_id lookup is answered from here — every other
 * lead read (capacity, overlap) falls through to installStubs, so this
 * lead can never be mistaken for a competing booking.
 */
function openLeadStubs(opts = {}) {
  const s = installStubs({ allowedOrgIds: ORG_ID, ...opts });
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(typeof input === "string" ? input : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    if (
      url.includes("/rest/v1/leads") &&
      method === "GET" &&
      url.includes("conversation_id=eq.")
    ) {
      const wantsObject = (new Headers(init.headers ?? {}).get("accept") ?? "").includes(
        "pgrst.object"
      );
      const row = {
        id: LEAD_ID,
        org_id: ORG_ID,
        name: "Brian Murphy",
        email: null,
        phone: null,
        service_needed: "Boiler service",
        preferred_datetime: null,
        appointment_datetime: null,
        message: "hi",
        status: "new",
        conversation_id: "conv-1",
        manage_token: "mt",
        metadata: {},
      };
      return new Response(JSON.stringify(wantsObject ? row : [row]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return inner(input, init);
  };
  return s;
}

describe("REGRESSION — a lead updated into booked reports the calendar's verdict", () => {
  test("the UPDATE path is genuinely being exercised", async () => {
    // Guards every assertion below: if the lookup stub stopped matching,
    // these would silently become insert-path tests and prove nothing.
    stubs = openLeadStubs();
    await captureBooking();
    assert.equal(stubs.calls.leadInserts.length, 0, "no insert — this must be an update");
    assert.ok(stubs.calls.leadUpdates.length > 0, "the existing lead was updated");
  });

  test("CONTROL: a successful write still reports booked", async () => {
    stubs = openLeadStubs();
    const result = await captureBooking();
    assert.equal(stubs.calls.creates.length, 1, "the event really was created");
    assert.equal(finalStatus(stubs.calls), "booked");
    assert.equal(result.booked, true, "a genuine booking must still report booked");
  });

  test("no_calendar must NOT report booked", async () => {
    stubs = openLeadStubs({ connected: false });
    const result = await captureBooking();
    assert.equal(stubs.calls.creates.length, 0, "no event was created");
    assert.equal(finalStatus(stubs.calls), "needs_review");
    assert.equal(
      result.booked,
      false,
      "the row says needs_review — the reported outcome must agree"
    );
  });

  test("a FAILED Google write must NOT report booked", async () => {
    stubs = openLeadStubs({ createStatus: 500 });
    const result = await captureBooking();
    assert.notEqual(finalStatus(stubs.calls), "booked");
    assert.equal(result.booked, false);
    assert.equal(result.unavailableReason, "lookup_failed");
  });

  test("a CONFLICT must NOT report booked", async () => {
    stubs = openLeadStubs({
      busy: [{ start: START_ISO, end: "2026-08-11T10:00:00.000Z" }],
    });
    const result = await captureBooking();
    assert.equal(stubs.calls.creates.length, 0);
    assert.equal(result.booked, false);
    assert.equal(result.unavailableReason, "capacity");
  });

  test("the reported outcome and the persisted row can never disagree", async () => {
    // The invariant itself, swept across every calendar outcome this
    // path can produce, rather than asserted case by case.
    const cases = [
      ["success", {}],
      ["no_calendar", { connected: false }],
      ["sync off", { syncEnabled: false }],
      ["failed", { createStatus: 500 }],
      ["conflict", { busy: [{ start: START_ISO, end: "2026-08-11T10:00:00.000Z" }] }],
    ];
    for (const [label, opts] of cases) {
      stubs = openLeadStubs(opts);
      const result = await captureBooking();
      assert.equal(
        result.booked,
        finalStatus(stubs.calls) === "booked",
        `${label}: reported booked=${result.booked} but the row says ${finalStatus(stubs.calls)}`
      );
      stubs.restore();
      stubs = null;
    }
  });

  test("no confirmation note is produced for a calendar-less update", async () => {
    // The customer-facing end of the same invariant.
    stubs = openLeadStubs({ connected: false });
    const result = await captureBooking();
    assert.equal(
      buildBookingOutcomeNote({
        intent: "new_booking",
        booked: result.booked,
        appointmentIso: result.appointmentIso,
        unavailableReason: result.unavailableReason,
      }),
      null,
      "nothing was booked, so nothing may be claimed"
    );
  });

  test("an ALREADY-booked lead is not downgraded by an ordinary update", async () => {
    // The case the OR exists for. `confirmedBooking` is false here by
    // design, `backsWithCalendar` is false, and the reschedule must
    // still report its booking — removing the OR outright breaks this.
    stubs = bookedLeadStubs();
    const result = await chatReschedule();
    assert.equal(result.booked, true, "an existing booking must survive an update");
    assert.equal(stubs.calls.leadUpdates.at(-1).status, "booked");
    assert.equal(result.appointmentIso, MOVED_ISO);
  });

  test("an already-booked lead keeps its event — no second one is created", async () => {
    stubs = bookedLeadStubs();
    await chatReschedule();
    assert.equal(stubs.calls.creates.length, 0, "a move is never a new event");
    assert.equal(stubs.calls.updates.length, 1, "the existing event moved");
    assert.equal(stubs.calls.linkInserts.length, 0, "the existing link is reused");
  });

  test("a REFUSED move on an already-booked lead keeps the booking", async () => {
    stubs = bookedLeadStubs({ updateStatus: 500 });
    const result = await chatReschedule();
    const written = stubs.calls.leadUpdates.at(-1);
    assert.equal(written.status, "booked", "the original booking still stands");
    assert.equal(written.appointment_datetime, START_ISO, "and keeps its original time");
    assert.equal(result.unavailableReason, "lookup_failed");
  });
});

// ══════════════════════════════════════════════════════════════════
//  The calendar is authoritative for chat/widget — without moving
//  the phone's post-call baseline
// ══════════════════════════════════════════════════════════════════
//
// capturePartialLead consults checkBookingSlot for EVERY channel, so a
// slot taken on the real Google Calendar can no longer be reported free
// on chat or the widget. That is the fix.
//
// The risk it created is the reason these tests exist. Discovering the
// conflict EARLIER changes which branch of the status chain a lead
// takes: the engine now returns a verified alternative where it used to
// return nothing, and `suggestedAlternativeIso → awaiting_confirmation`
// would have swallowed phone requests that have always landed in the
// owner's Needs Review queue. The phone's post-call behaviour is the
// known-good production baseline and is pinned here.

const CONFLICTING_BUSY = [{ start: START_ISO, end: "2026-08-11T10:00:00.000Z" }];

describe("PHONE post-call capture keeps its needs_review baseline", () => {
  // Exactly what voice/calls.ts hands the shared engine at end of call:
  // the appointment intent is DOWNGRADED to "question" first (a phone
  // appointment is a request, never a confirmed booking — see
  // voiceAppointmentRequest.test.mjs), the source is "voice", and
  // needsReview is true because the call carried real substance.
  const VOICE_CALL_LEAD = { ...BOOKING_LEAD, intent: "question" };

  async function captureVoiceCall() {
    const { capturePartialLead } = await import("@/lib/leadCapture");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    return capturePartialLead(
      createAdminClient(),
      ORG_ID,
      "vapi-call-1",
      "Caller asked for a boiler service Tuesday at 10am",
      VOICE_CALL_LEAD,
      "voice",
      true
    );
  }

  test("a connected calendar IS consulted for a phone lead", async () => {
    // Uniform path, deliberately — the lookup is not gated by channel.
    stubs = installStubs({ busy: CONFLICTING_BUSY });
    await captureVoiceCall();
    assert.equal(stubs.calls.freeBusy, 1);
  });

  test("an external conflict still parks the call as needs_review", async () => {
    stubs = installStubs({ busy: CONFLICTING_BUSY });
    await captureVoiceCall();
    assert.equal(finalStatus(stubs.calls), "needs_review");
  });

  test("it must NOT become awaiting_confirmation", async () => {
    // The exact regression: awaiting_confirmation would drop the request
    // out of the owner's Needs Review queue with nobody noticing.
    stubs = installStubs({ busy: CONFLICTING_BUSY });
    await captureVoiceCall();
    assert.notEqual(finalStatus(stubs.calls), "awaiting_confirmation");
  });

  test("a phone lead is never booked by this path, conflict or not", async () => {
    for (const busy of [CONFLICTING_BUSY, []]) {
      stubs = installStubs({ busy });
      await captureVoiceCall();
      assert.notEqual(finalStatus(stubs.calls), "booked");
      stubs.restore();
    }
  });

  test("with the calendar clear, the call lands exactly where it always did", async () => {
    // The no-conflict case must be untouched by this work.
    stubs = installStubs();
    await captureVoiceCall();
    assert.equal(finalStatus(stubs.calls), "needs_review");
    assert.equal(stubs.calls.creates.length, 0, "no event for a phone request");
  });
});

describe("CHAT/WIDGET — a Google conflict makes the slot unavailable", () => {
  async function captureFrom(source) {
    const { capturePartialLead } = await import("@/lib/leadCapture");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    return capturePartialLead(
      createAdminClient(),
      ORG_ID,
      `conv-${source}`,
      "I'd like a boiler service Tuesday at 10am",
      BOOKING_LEAD,
      source
    );
  }

  for (const source of ["chat", "web_widget"]) {
    test(`${source}: a slot busy on Google is reported unavailable`, async () => {
      stubs = installStubs({ busy: CONFLICTING_BUSY });
      const result = await captureFrom(source);

      // The whole defect: this used to come back available, because
      // nothing on this path had ever asked Google.
      assert.equal(stubs.calls.freeBusy, 1, "the calendar was consulted");
      assert.equal(result.outsideBusinessHours, true);
      assert.equal(result.unavailableReason, "capacity");
      assert.equal(result.booked, false);
    });

    test(`${source}: no booking and no calendar event for a taken slot`, async () => {
      stubs = installStubs({ busy: CONFLICTING_BUSY });
      await captureFrom(source);
      assert.notEqual(finalStatus(stubs.calls), "booked");
      assert.equal(stubs.calls.creates.length, 0);
    });

    test(`${source}: the alternative offered is verified against the calendar`, async () => {
      // Offering a time that is ALSO busy would just move the problem.
      stubs = installStubs({ busy: CONFLICTING_BUSY });
      const result = await captureFrom(source);
      if (result.suggestedAlternativeIso) {
        const clashes = CONFLICTING_BUSY.some(
          (w) =>
            Date.parse(result.suggestedAlternativeIso) < Date.parse(w.end) &&
            Date.parse(result.suggestedAlternativeIso) >= Date.parse(w.start)
        );
        assert.equal(clashes, false);
      }
    });

    test(`${source}: an unconflicted slot still books normally`, async () => {
      // The fix must not make every booking fail.
      stubs = installStubs({ busy: [] });
      const result = await captureFrom(source);
      assert.equal(result.unavailableReason, null);
      assert.equal(finalStatus(stubs.calls), "booked");
    });
  }
});

// ══════════════════════════════════════════════════════════════════
//  The appointment is resolved in the BUSINESS'S timezone
// ══════════════════════════════════════════════════════════════════
//
// resolveAppointmentDatetime passed a hardcoded "Europe/London" no
// matter where the business was, so a customer in New York asking for
// 2pm had it stored as 2pm LONDON — 18:00 their time. The org's own
// zone (organisations.timezone, via getOrgTimezone) is now used.
//
// Each case states an EXPLICIT numeric date, so the parser resolves it
// in code and the model is never consulted — asserted here, because a
// model round trip would make the timezone claim meaningless.
//
// NOTE, deliberately: business HOURS are still evaluated in London
// (availability.ts getLondonParts), which is separately parked work.
// These tests therefore assert the resolved INSTANT, not availability.

describe("explicit appointment times resolve in the org's timezone", () => {
  // A half-hour-offset zone is included on purpose — an implementation
  // that quietly rounds to whole hours passes every other case.
  //
  // Which SPELLING is canonical depends on the runtime's ICU data: this
  // build lists "Asia/Calcutta" and rejects "Asia/Kolkata", newer builds
  // do the reverse. getOrgTimezone validates against that list and falls
  // back to London for anything absent, so the test asks the runtime
  // rather than hardcoding a name. (Worth knowing separately: an owner
  // whose settings hold the spelling this runtime does NOT list has
  // their zone silently ignored. Pre-existing, not introduced here.)
  const INDIA_ZONE = ["Asia/Kolkata", "Asia/Calcutta"].find((zone) =>
    Intl.supportedValuesOf("timeZone").includes(zone)
  );

  // 14:00 local on Thursday 20 August 2026, per zone.
  const CASES = [
    ["Europe/London", "2026-08-20T13:00:00.000Z"],
    ["America/New_York", "2026-08-20T18:00:00.000Z"],
    ["Australia/Sydney", "2026-08-20T04:00:00.000Z"],
    [INDIA_ZONE, "2026-08-20T08:30:00.000Z"],
  ];

  async function captureExplicit(orgTimezone, phrase = "20/08/26 at 2pm") {
    const { capturePartialLead } = await import("@/lib/leadCapture");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    return capturePartialLead(
      createAdminClient(),
      ORG_ID,
      `conv-tz-${orgTimezone}`,
      `Can I book a boiler service on ${phrase}?`,
      { ...BOOKING_LEAD, preferred_datetime: phrase },
      "web_widget"
    );
  }

  for (const [orgTimezone, expectedIso] of CASES) {
    test(`${orgTimezone}: 2pm is 2pm THERE, not in London`, async () => {
      stubs = installStubs({ orgTimezone });
      const result = await captureExplicit(orgTimezone);
      assert.equal(result.appointmentIso, expectedIso);
    });

    test(`${orgTimezone}: the stored instant reads back as 14:00 locally`, async () => {
      // The assertion a business actually cares about: whatever the
      // offset, the customer's 2pm is 2pm on their own clock.
      stubs = installStubs({ orgTimezone });
      const result = await captureExplicit(orgTimezone);
      const local = new Intl.DateTimeFormat("en-GB", {
        timeZone: orgTimezone,
        dateStyle: "short",
        timeStyle: "short",
        hourCycle: "h23",
      }).format(new Date(result.appointmentIso));
      assert.match(local, /20\/08\/2026, 14:00/);
    });

    test(`${orgTimezone}: the model is never asked`, async () => {
      stubs = installStubs({ orgTimezone });
      await captureExplicit(orgTimezone);
      assert.equal(
        stubs.calls.openai,
        0,
        "an explicit numeric date must stay deterministic"
      );
    });
  }

  test("a London org is byte-identical to the old hardcoded behaviour", async () => {
    // The regression guard for every business live today.
    stubs = installStubs({ orgTimezone: "Europe/London" });
    const result = await captureExplicit("Europe/London");
    assert.equal(result.appointmentIso, "2026-08-20T13:00:00.000Z");
  });

  test("an org with no timezone set falls back to Europe/London", async () => {
    // Rows predating the column must keep working unchanged.
    stubs = installStubs({ orgTimezone: null });
    const result = await captureExplicit("unset");
    assert.equal(result.appointmentIso, "2026-08-20T13:00:00.000Z");
  });

  test("an unusable timezone falls back rather than throwing mid-booking", async () => {
    // "BST" is an abbreviation Intl resolves to Asia/Dhaka; getOrgTimezone
    // rejects it. A bad settings value must not lose the booking.
    stubs = installStubs({ orgTimezone: "Not/AZone" });
    const result = await captureExplicit("bad");
    assert.equal(result.appointmentIso, "2026-08-20T13:00:00.000Z");
  });

  test("DD/MM is still never read as MM/DD, in any zone", async () => {
    // 05/09/26 is 5 September, never 9 May — the parser's core claim,
    // re-checked here because it now runs under a non-London zone.
    stubs = installStubs({ orgTimezone: "America/New_York" });
    const result = await captureExplicit("nyc", "05/09/26 at 2pm");
    const local = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/New_York",
      dateStyle: "short",
      timeStyle: "short",
      hourCycle: "h23",
    }).format(new Date(result.appointmentIso));
    assert.match(local, /05\/09\/2026, 14:00/);
    assert.equal(stubs.calls.openai, 0);
  });
});

describe("an org set to an IANA link name is honoured, not reverted", () => {
  // The end-to-end consequence of the validation fix. Before it,
  // getOrgTimezone rejected "Asia/Kolkata" on any runtime whose ICU
  // lists only "Asia/Calcutta", fell back to Europe/London, and stored
  // 2pm India as 2pm London — 5½ hours out, silently.
  async function captureAt(orgTimezone) {
    const { capturePartialLead } = await import("@/lib/leadCapture");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    return capturePartialLead(
      createAdminClient(),
      ORG_ID,
      `conv-link-${orgTimezone}`,
      "Can I book a boiler service on 20/08/26 at 2pm?",
      { ...BOOKING_LEAD, preferred_datetime: "20/08/26 at 2pm" },
      "web_widget"
    );
  }

  for (const zone of ["Asia/Kolkata", "Asia/Calcutta"]) {
    test(`${zone}: 2pm is stored as 08:30Z, not London's 13:00Z`, async () => {
      stubs = installStubs({ orgTimezone: zone });
      const result = await captureAt(zone);
      assert.equal(result.appointmentIso, "2026-08-20T08:30:00.000Z");
      assert.notEqual(
        result.appointmentIso,
        "2026-08-20T13:00:00.000Z",
        "a silent revert to Europe/London is the bug"
      );
    });
  }

  test("a genuinely invalid zone still falls back to Europe/London", async () => {
    stubs = installStubs({ orgTimezone: "Europe/Atlantis" });
    const result = await captureAt("Europe/Atlantis");
    assert.equal(result.appointmentIso, "2026-08-20T13:00:00.000Z");
  });

  test("an abbreviation still falls back rather than resolving to Dhaka", async () => {
    // "BST" would be UTC+6 if Intl were trusted — 08:00Z, not 13:00Z.
    stubs = installStubs({ orgTimezone: "BST" });
    const result = await captureAt("BST");
    assert.equal(result.appointmentIso, "2026-08-20T13:00:00.000Z");
  });
});

// ══════════════════════════════════════════════════════════════════
//  needsClarification reaches the caller — and only from the parser
// ══════════════════════════════════════════════════════════════════
//
// "20/08/26" with no time used to capture no appointment and say
// nothing about why. The flag existed the whole time; the narrowed
// return type of resolveAppointmentDatetime hid it and the destructure
// dropped it.
//
// The half that matters as much: this flag must mean ONE thing. If an
// availability refusal, an external conflict or a failed lookup could
// also raise it, Remy would ask "what time?" about a time it had
// perfectly well understood and merely could not give them.

describe("a stated date with no time is asked about, not guessed", () => {
  async function captureText(preferred, opts = {}) {
    const { capturePartialLead } = await import("@/lib/leadCapture");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    return capturePartialLead(
      createAdminClient(),
      ORG_ID,
      `conv-clar-${preferred}`,
      `Can I book a boiler service ${preferred}?`,
      { ...BOOKING_LEAD, preferred_datetime: preferred, ...opts },
      "web_widget"
    );
  }

  test("the flag and the resolved date reach the caller", async () => {
    stubs = installStubs();
    const result = await captureText("20/08/26");
    assert.equal(result.needsClarification, true);
    assert.equal(result.clarificationDate, "20 August 2026");
  });

  test("no appointment instant is invented", async () => {
    stubs = installStubs();
    const result = await captureText("20/08/26");
    assert.equal(result.appointmentIso, null);
    assert.equal(result.booked, false);
    assert.notEqual(finalStatus(stubs.calls), "booked");
  });

  test("availability is NOT checked — there is nothing to check", async () => {
    // The explicit ordering rule: parse, then check. With no instant
    // there is no second step, and no provider call to make.
    stubs = installStubs();
    await captureText("20/08/26");
    assert.equal(stubs.calls.freeBusy, 0);
    assert.equal(stubs.calls.creates.length, 0);
  });

  test("no availability EXCUSE is manufactured either", async () => {
    // Saying "that time is unavailable" would be as false as booking it.
    stubs = installStubs();
    const result = await captureText("20/08/26");
    assert.equal(result.unavailableReason, null);
    assert.equal(result.outsideBusinessHours, false);
    assert.equal(result.suggestedAlternativeIso, null);
  });

  test("the date the customer gave is preserved on the lead", async () => {
    stubs = installStubs();
    await captureText("20/08/26");
    assert.equal(stubs.calls.leadInserts[0].preferred_datetime, "20/08/26");
    assert.equal(stubs.calls.leadInserts[0].appointment_datetime, null);
  });

  test("an impossible date asks too, but names no date", async () => {
    stubs = installStubs();
    const result = await captureText("32/08/26 at 2pm");
    assert.equal(result.needsClarification, true);
    assert.equal(result.clarificationDate, null);
    assert.equal(result.appointmentIso, null);
  });
});

describe("needsClarification is raised by the parser and nothing else", () => {
  async function capture(preferred) {
    const { capturePartialLead } = await import("@/lib/leadCapture");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    return capturePartialLead(
      createAdminClient(),
      ORG_ID,
      `conv-noclar-${Math.random()}`,
      "I'd like a boiler service",
      { ...BOOKING_LEAD, preferred_datetime: preferred },
      "web_widget"
    );
  }

  test("a fully resolved explicit datetime does not ask", async () => {
    stubs = installStubs();
    const result = await capture("20/08/26 at 2pm");
    assert.equal(result.needsClarification, false);
    assert.equal(result.clarificationDate, null);
    assert.ok(result.appointmentIso);
  });

  test("an EXTERNAL CALENDAR CONFLICT does not ask", async () => {
    stubs = installStubs({ busy: CONFLICTING_BUSY });
    const result = await capture("Tuesday at 10am");
    assert.equal(result.unavailableReason, "capacity", "precondition: it was refused");
    assert.equal(result.needsClarification, false);
    assert.equal(result.clarificationDate, null);
  });

  test("a LOOKUP FAILURE does not ask", async () => {
    stubs = installStubs({ hoursFail: true });
    const result = await capture("Tuesday at 10am");
    assert.equal(result.unavailableReason, "lookup_failed", "precondition: it failed closed");
    assert.equal(result.needsClarification, false);
  });

  test("a BUSINESS HOURS refusal does not ask", async () => {
    // A time the engine understood perfectly and simply cannot give.
    // 8pm is explicit and deterministic, and the fixture closes at 17:00
    // — so this is a genuine refusal of a fully resolved instant, which
    // is exactly the case that must NOT be confused with "no time given".
    stubs = installStubs();
    const result = await capture("20/08/26 at 8pm");
    assert.equal(result.unavailableReason, "hours", "precondition: it was refused");
    assert.equal(result.needsClarification, false);
    assert.equal(result.clarificationDate, null);
  });

  test("a CONVERSATIONAL date resolved by the model does not ask", async () => {
    stubs = installStubs();
    const result = await capture("Tuesday at 10am");
    assert.equal(result.needsClarification, false);
    assert.ok(result.appointmentIso);
  });

  test("no datetime at all does not ask", async () => {
    // Nothing was stated, so there is no stated date to clarify — this
    // is an ordinary enquiry, not a half-given appointment.
    stubs = installStubs();
    const result = await capture(null);
    assert.equal(result.needsClarification, false);
    assert.equal(result.clarificationDate, null);
    assert.equal(result.appointmentIso, null);
  });

  test("a PHONE post-call capture is unaffected", async () => {
    // capturePartialLead is shared; voice/calls.ts reads only leadId, so
    // the added fields are inert there. Pinned so it stays that way.
    const { capturePartialLead } = await import("@/lib/leadCapture");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    stubs = installStubs();
    const result = await capturePartialLead(
      createAdminClient(),
      ORG_ID,
      "vapi-call-clar",
      "Caller asked for a boiler service Tuesday at 10am",
      { ...BOOKING_LEAD, intent: "question" },
      "voice",
      true
    );
    assert.equal(result.needsClarification, false);
    assert.ok(result.leadId, "the lead is still created");
    assert.equal(finalStatus(stubs.calls), "needs_review");
  });
});
