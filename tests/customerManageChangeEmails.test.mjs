// The customer hears about their OWN change.
//
// Booking an appointment emailed the customer. Changing it did not: a
// self-service cancel or reschedule through the manage link produced an
// on-screen message, an email to the business owner, and nothing at all
// to the person who made the change. After a reschedule that was worse
// than silence — the only email the customer held still stated the OLD
// time, and the manage link in it was the only way back.
//
// The rule these pin is the same one the whole booking design rests on:
// A NOTIFICATION MAY ONLY DESCRIBE WHAT HAS ALREADY SETTLED.
//
//   - cancel is LOCAL-FIRST, so the email follows the persisted
//     status='cancelled' write and says nothing about Google
//   - reschedule is CALENDAR-FIRST, so a conflict (409) or a failed move
//     (503) must produce NO customer email at all — the appointment did
//     not move, and telling the customer it did is the exact desync the
//     calendar layer exists to prevent
//
// Scope: the manage-link flow only. /api/leads is deliberately untouched.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { sendBookingSelfServiceChangeNotification } from "@/lib/email";
import {
  runAfterCallbacks,
  resetAfterCallbacks,
  afterCallbackCount,
} from "./stubs/next-server.mjs";
import { encryptCredentials, loadKeyringFromEnv } from "@/lib/integrations/crypto";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CONNECTION_ID = "22222222-2222-4222-8222-222222222222";
const RESOURCE_ID = "33333333-3333-4333-8333-333333333333";
const CALENDAR_ID = "owner@example.com";
const LEAD_ID = "44444444-4444-4444-8444-444444444444";
const OWNER_ID = "55555555-5555-4555-8555-555555555555";

const OWNER_EMAIL = "owner@example.com";
const CUSTOMER_EMAIL = "brian@example.com";

// Tuesday 11 August 2026. Business hours 09:00–17:00 in the stub.
const START_ISO = "2026-08-11T09:00:00.000Z"; // 10:00 London
const MOVED_ISO = "2026-08-11T13:00:00.000Z"; // 14:00 London

const BOOKED_LEAD = {
  id: LEAD_ID,
  org_id: ORG_ID,
  status: "booked",
  appointment_datetime: START_ISO,
  name: "Brian Murphy",
  email: CUSTOMER_EMAIL,
  phone: null,
  service_needed: "Boiler service",
};

// ── Email capture ───────────────────────────────────────────────────

/**
 * Intercepts Resend. `failFor` makes the send to that address throw, so
 * one recipient's failure can be proven not to suppress the other's.
 */
function captureEmails({ failFor = null } = {}) {
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(typeof input === "string" ? input : input.url);
    if (url.includes("api.resend.com")) {
      const body = init.body ? JSON.parse(init.body) : {};
      if (failFor && body.to === failFor) {
        return new Response(JSON.stringify({ message: "rejected" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        });
      }
      sent.push(body);
      return new Response(JSON.stringify({ id: `email-${sent.length}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input, init);
  };
  sent.restore = () => {
    globalThis.fetch = realFetch;
  };
  return sent;
}

const toCustomer = (sent) => sent.find((m) => m.to === CUSTOMER_EMAIL);
const toOwner = (sent) => sent.find((m) => m.to === OWNER_EMAIL);

let captured = null;
afterEach(() => {
  captured?.restore?.();
  captured = null;
  resetAfterCallbacks();
});

// ── A. The email itself ─────────────────────────────────────────────

describe("the customer's copy of a self-service change", () => {
  const base = {
    businessOwnerEmail: OWNER_EMAIL,
    businessName: "Acme Plumbing",
    customerName: "Brian Murphy",
    customerEmail: CUSTOMER_EMAIL,
    customerPhone: null,
    serviceNeeded: "Boiler service",
    bookingReference: "ABC12345",
    timezone: "Europe/London",
  };

  test("a cancellation reaches the customer AND the owner", async () => {
    captured = captureEmails();
    const result = await sendBookingSelfServiceChangeNotification({
      ...base,
      action: "cancelled",
      previousDatetime: START_ISO,
    });

    assert.equal(captured.length, 2);
    assert.deepEqual(result, { customer: true, owner: true });

    const customer = toCustomer(captured);
    assert.ok(customer, "the customer must be told");
    assert.match(customer.subject, /Booking cancelled — Acme Plumbing/);
    assert.match(customer.html, /has been cancelled/);
    assert.match(customer.html, /Boiler service/);
    assert.match(customer.html, /ABC12345/);
    // 10:00 London, the time that was cancelled.
    assert.match(customer.html, /Tuesday, 11 August 2026 at 10:00/);
  });

  test("a cancellation offers NO manage link — that booking is gone", async () => {
    captured = captureEmails();
    await sendBookingSelfServiceChangeNotification({
      ...base,
      action: "cancelled",
      previousDatetime: START_ISO,
      // Even when a token is supplied, cancelling must not advertise it:
      // the route refuses any lead whose status is not "booked".
      manageToken: "tok-should-not-appear",
    });

    const customer = toCustomer(captured);
    assert.doesNotMatch(customer.html, /booking\/manage\?token=/);
    assert.doesNotMatch(customer.html, /tok-should-not-appear/);
  });

  test("a reschedule states the NEW time and supersedes the old email", async () => {
    captured = captureEmails();
    await sendBookingSelfServiceChangeNotification({
      ...base,
      action: "rescheduled",
      previousDatetime: START_ISO,
      newDatetime: MOVED_ISO,
      manageToken: "tok-abc",
    });

    const customer = toCustomer(captured);
    assert.ok(customer);
    // The NEW time leads, in the subject and the body.
    assert.match(customer.subject, /Tuesday, 11 August 2026 at 14:00/);
    assert.match(customer.html, /New date &amp; time|New date & time/);
    assert.match(customer.html, /Tuesday, 11 August 2026 at 14:00/);
    // The old one is shown as context, explicitly superseded.
    assert.match(customer.html, /Tuesday, 11 August 2026 at 10:00/);
    assert.match(customer.html, /replaces the time we sent you previously/);
  });

  test("a reschedule carries a WORKING manage link, in the canonical format", async () => {
    captured = captureEmails();
    await sendBookingSelfServiceChangeNotification({
      ...base,
      action: "rescheduled",
      previousDatetime: START_ISO,
      newDatetime: MOVED_ISO,
      manageToken: "tok-abc",
    });

    const customer = toCustomer(captured);
    // Same shape the booking confirmation uses — one URL format only.
    assert.match(customer.html, /\/booking\/manage\?token=tok-abc/);
  });

  test("times render in the ORGANISATION's zone, not the server's", async () => {
    captured = captureEmails();
    await sendBookingSelfServiceChangeNotification({
      ...base,
      timezone: "America/New_York",
      action: "rescheduled",
      previousDatetime: START_ISO, // 05:00 New York
      newDatetime: MOVED_ISO, // 09:00 New York
      manageToken: "tok-abc",
    });

    const customer = toCustomer(captured);
    assert.match(customer.html, /Tuesday, 11 August 2026 at 09:00/);
    assert.match(customer.html, /Tuesday, 11 August 2026 at 05:00/);
    // The London renderings must be absent.
    assert.doesNotMatch(customer.html, /at 14:00|at 10:00/);
  });

  test("no customer address — the send is skipped, the owner is not", async () => {
    captured = captureEmails();
    const result = await sendBookingSelfServiceChangeNotification({
      ...base,
      customerEmail: null,
      action: "cancelled",
      previousDatetime: START_ISO,
    });

    assert.equal(captured.length, 1);
    assert.ok(toOwner(captured), "the owner is still notified");
    assert.deepEqual(result, { customer: false, owner: true });
  });

  test("an unresolvable OWNER address still sends the customer's copy", async () => {
    // The inverse of the test above, and the behaviour that changed when
    // this function gained a second recipient: it used to return before
    // sending anything if the owner could not be resolved. A customer's
    // confirmation must not depend on the business's address being
    // readable — they made the change, and they are owed the receipt.
    captured = captureEmails();
    const result = await sendBookingSelfServiceChangeNotification({
      ...base,
      businessOwnerEmail: null,
      action: "cancelled",
      previousDatetime: START_ISO,
    });

    assert.equal(captured.length, 1, "exactly one email — the customer's");
    const customer = toCustomer(captured);
    assert.ok(customer, "the customer is still told");
    assert.match(customer.subject, /Booking cancelled/);
    assert.equal(toOwner(captured), undefined, "no owner email was sent");
    // No invented fallback recipient.
    assert.equal(captured[0].to, CUSTOMER_EMAIL);
    assert.deepEqual(result, { customer: true, owner: false });
  });

  test("an unresolvable OWNER address still sends a reschedule copy", async () => {
    captured = captureEmails();
    const result = await sendBookingSelfServiceChangeNotification({
      ...base,
      businessOwnerEmail: null,
      action: "rescheduled",
      previousDatetime: START_ISO,
      newDatetime: MOVED_ISO,
      manageToken: "tok-abc",
    });

    assert.equal(captured.length, 1);
    const customer = toCustomer(captured);
    assert.ok(customer);
    assert.match(customer.html, /Tuesday, 11 August 2026 at 14:00/);
    assert.match(customer.html, /\/booking\/manage\?token=tok-abc/);
    assert.deepEqual(result, { customer: true, owner: false });
  });

  test("a customer-send failure does NOT suppress the owner", async () => {
    captured = captureEmails({ failFor: CUSTOMER_EMAIL });
    const result = await sendBookingSelfServiceChangeNotification({
      ...base,
      action: "cancelled",
      previousDatetime: START_ISO,
    });

    assert.equal(result.customer, false);
    assert.equal(result.owner, true);
    assert.ok(toOwner(captured), "the owner notification still went out");
  });

  test("an owner-send failure does NOT suppress the customer", async () => {
    captured = captureEmails({ failFor: OWNER_EMAIL });
    const result = await sendBookingSelfServiceChangeNotification({
      ...base,
      action: "rescheduled",
      previousDatetime: START_ISO,
      newDatetime: MOVED_ISO,
      manageToken: "tok-abc",
    });

    assert.equal(result.customer, true);
    assert.equal(result.owner, false);
    assert.ok(toCustomer(captured), "the customer was still told");
  });

  test("an unresolvable business name still produces a truthful email", async () => {
    captured = captureEmails();
    await sendBookingSelfServiceChangeNotification({
      ...base,
      businessName: null,
      action: "cancelled",
      previousDatetime: START_ISO,
    });

    const customer = toCustomer(captured);
    assert.ok(customer, "a missing name must not withhold the email");
    assert.match(customer.html, /Your booking has been cancelled/);
    assert.doesNotMatch(customer.subject, /—\s*$/);
  });
});

// ── B. The route: only settled changes are announced ────────────────

function installStubs({ freeBusyFail = false, busy = [], leadWriteFail = false } = {}) {
  process.env.INTEGRATIONS_ENABLED = "true";
  process.env.CALENDAR_SYNC_ENABLED = "true";
  process.env.CALENDAR_AVAILABILITY_BLOCKING = "true";
  process.env.CALENDAR_EVENT_CREATION_ORG_IDS = ORG_ID;
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
  const calls = { leadUpdates: [], emails: [] };

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

    if (url.includes("api.resend.com")) {
      calls.emails.push(init.body ? JSON.parse(init.body) : {});
      return json({ id: `email-${calls.emails.length}` });
    }
    if (url.includes("/auth/v1/user")) {
      return json({ id: OWNER_ID, aud: "authenticated", role: "authenticated" });
    }
    if (url.includes("/auth/v1/admin/users/")) {
      return json({ user: { id: OWNER_ID, email: OWNER_EMAIL } });
    }
    if (url.includes("oauth2.googleapis.com") || url.includes("/token")) {
      return json({ access_token: "fresh", expires_in: 3600, scope: "calendar" });
    }
    if (url.includes("googleapis.com/calendar/v3/freeBusy")) {
      if (freeBusyFail) return json({ error: { message: "boom" } }, 500);
      return json({ calendars: { [CALENDAR_ID]: { busy } } });
    }
    if (url.includes("/calendar/v3/calendars/") && url.includes("/events")) {
      if (method === "PATCH") {
        if (freeBusyFail) return json({ error: { message: "boom" } }, 500);
        return json({ id: "existing-event", etag: '"etag-2"' });
      }
      if (method === "DELETE") return new Response(null, { status: 204 });
      return json({ id: "created-event", etag: '"etag-1"' });
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
        credentials_encrypted: credentials,
      };
      return wantsObject ? json(row) : json([row]);
    }
    if (url.includes("/rest/v1/integration_links")) {
      if (method === "PATCH" || method === "POST") return json([]);
      const row = {
        id: "link-1",
        external_id: "rem-existing-event",
        external_etag: '"etag-1"',
        sync_status: "synced",
        resource_id: RESOURCE_ID,
      };
      return wantsObject ? json(row) : json([row]);
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
      let ownershipProbe = false;
      try {
        ownershipProbe = new URL(url).searchParams.has("owner_id");
      } catch {}
      if (ownershipProbe) {
        const owned = { id: ORG_ID, appointment_duration_minutes: 60 };
        return wantsObject ? json(owned) : json([owned]);
      }
      const row = {
        owner_id: OWNER_ID,
        business_name: "Acme Plumbing",
        notification_email: OWNER_EMAIL,
        appointment_duration_minutes: 60,
        emergency_mode_enabled: false,
        max_concurrent_bookings: 1,
        timezone: "Europe/London",
      };
      return wantsObject ? json(row) : json([row]);
    }
    if (url.includes("/rest/v1/leads")) {
      if (method === "PATCH") {
        const patch = init.body ? JSON.parse(init.body) : {};
        calls.leadUpdates.push(patch);
        // The authoritative local write fails. Everything upstream of it
        // has already happened — for a reschedule that includes the
        // Google move — so this is precisely the state in which an email
        // would be a lie.
        if (leadWriteFail) return json({ message: "boom" }, 500);
        return wantsObject ? json({ ...BOOKED_LEAD, ...patch }) : json([]);
      }
      if (method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-range": "*/0" },
        });
      }
      if (wantsObject) return json(BOOKED_LEAD);
      return json([BOOKED_LEAD]);
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

// The manage route rate-limits per IP (20/min) and per token (10/min),
// in-memory for the life of the process, so every request needs unique
// keys or a later test asserts against a 429.
let callSeq = 0;
const nextCall = () => {
  const n = ++callSeq;
  return {
    ip: `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`,
    token: `mt-${n}`,
  };
};

async function post(body, ip) {
  const { POST } = await import("@/app/api/bookings/manage/route");
  const { NextRequest } = await import("./stubs/next-server.mjs");
  return POST(
    new NextRequest("https://example.test/api/bookings/manage", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    })
  );
}

let stubs = null;
afterEach(() => {
  stubs?.restore();
  stubs = null;
});

describe("the manage route announces only what settled", () => {
  test("a successful cancel schedules the customer email AFTER the write", async () => {
    stubs = installStubs();
    resetAfterCallbacks();
    const { ip, token } = nextCall();

    const res = await post({ token, action: "cancel" }, ip);
    assert.equal(res.status, 200);

    // The local status write is what makes the cancellation true, and it
    // happened before anything was queued to tell anyone.
    assert.deepEqual(stubs.calls.leadUpdates, [{ status: "cancelled" }]);
    assert.equal(afterCallbackCount(), 1, "one notification was scheduled");

    await runAfterCallbacks();
    const customer = stubs.calls.emails.find((m) => m.to === CUSTOMER_EMAIL);
    const owner = stubs.calls.emails.find((m) => m.to === OWNER_EMAIL);
    assert.ok(customer, "the customer is told their booking is cancelled");
    assert.ok(owner, "the owner is still notified");
    assert.match(customer.subject, /Booking cancelled/);
  });

  test("a successful reschedule tells the customer the NEW time", async () => {
    stubs = installStubs();
    resetAfterCallbacks();
    const { ip, token } = nextCall();

    const res = await post(
      { token, action: "reschedule", date: "2026-08-11", time: "14:00" },
      ip
    );
    assert.equal(res.status, 200);
    assert.deepEqual(stubs.calls.leadUpdates, [
      { appointment_datetime: MOVED_ISO },
    ]);

    await runAfterCallbacks();
    const customer = stubs.calls.emails.find((m) => m.to === CUSTOMER_EMAIL);
    assert.ok(customer);
    assert.match(customer.html, /Tuesday, 11 August 2026 at 14:00/);
    assert.match(customer.html, new RegExp(`/booking/manage\\?token=${token}`));
  });

  test("a CONFLICT (409) tells the customer nothing", async () => {
    // The slot is busy on the real calendar, so the move is refused.
    stubs = installStubs({
      busy: [{ start: "2026-08-11T13:00:00Z", end: "2026-08-11T14:00:00Z" }],
    });
    resetAfterCallbacks();
    const { ip, token } = nextCall();

    const res = await post(
      { token, action: "reschedule", date: "2026-08-11", time: "14:00" },
      ip
    );

    assert.equal(res.status, 409);
    assert.equal(stubs.calls.leadUpdates.length, 0, "the time did not move");
    assert.equal(
      afterCallbackCount(),
      0,
      "no notification may be scheduled for a move that did not happen"
    );
  });

  test("a FAILED calendar move (503) tells the customer nothing", async () => {
    stubs = installStubs({ freeBusyFail: true });
    resetAfterCallbacks();
    const { ip, token } = nextCall();

    const res = await post(
      { token, action: "reschedule", date: "2026-08-11", time: "14:00" },
      ip
    );

    assert.equal(res.status, 503);
    assert.equal(stubs.calls.leadUpdates.length, 0, "the original time stands");
    assert.equal(afterCallbackCount(), 0, "nothing was announced");
  });

  test("a cancel whose local write FAILS emails nobody", async () => {
    // status='cancelled' is what makes the cancellation true. If it does
    // not persist, nothing has been cancelled and there is nothing to
    // confirm — to either party.
    stubs = installStubs({ leadWriteFail: true });
    resetAfterCallbacks();
    const { ip, token } = nextCall();

    const res = await post({ token, action: "cancel" }, ip);

    assert.equal(res.status, 500);
    assert.equal(
      afterCallbackCount(),
      0,
      "no notification may be scheduled for a cancellation that did not persist"
    );
    assert.equal(stubs.calls.emails.length, 0, "nothing was sent to anyone");
  });

  test("a reschedule whose local write FAILS emails nobody", async () => {
    // The calendar move succeeds here — the flow gets all the way to the
    // local appointment_datetime write, and THAT fails. The customer must
    // not be told a new time the database never accepted.
    stubs = installStubs({ leadWriteFail: true });
    resetAfterCallbacks();
    const { ip, token } = nextCall();

    const res = await post(
      { token, action: "reschedule", date: "2026-08-11", time: "14:00" },
      ip
    );

    assert.equal(res.status, 500);
    assert.deepEqual(
      stubs.calls.leadUpdates,
      [{ appointment_datetime: MOVED_ISO }],
      "the write was attempted, and refused"
    );
    assert.equal(
      afterCallbackCount(),
      0,
      "no notification may be scheduled for a move the database rejected"
    );
    assert.equal(stubs.calls.emails.length, 0, "nothing was sent to anyone");
  });

  test("a second cancellation is refused and emails nobody again", async () => {
    stubs = installStubs();
    // The route refuses any lead whose status is not "booked", which is
    // what stops a duplicate cancellation email.
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input.url;
      const headers = new Headers(init.headers ?? {});
      if (url.includes("/rest/v1/leads") && (init.method ?? "GET") === "GET") {
        const cancelled = { ...BOOKED_LEAD, status: "cancelled" };
        return new Response(
          JSON.stringify(
            (headers.get("accept") ?? "").includes("pgrst.object")
              ? cancelled
              : [cancelled]
          ),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return realFetch(input, init);
    };

    resetAfterCallbacks();
    const { ip, token } = nextCall();
    const res = await post({ token, action: "cancel" }, ip);

    assert.equal(res.status, 400);
    assert.equal(afterCallbackCount(), 0, "no second cancellation email");
    globalThis.fetch = realFetch;
  });
});

// ── C. Scope protection ─────────────────────────────────────────────

describe("scope — the owner dashboard path is untouched", () => {
  test("/api/leads still sends no email of its own", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("src/app/api/leads/route.ts", "utf8");
    // This PR deliberately did not give the owner dashboard customer
    // emails; that is a separate product decision.
    assert.doesNotMatch(source, /sendBookingSelfServiceChangeNotification/);
    assert.doesNotMatch(source, /sendBookingConfirmationEmails/);
  });

  test("the calendar ordering either side of the change is unchanged", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("src/app/api/bookings/manage/route.ts", "utf8");

    // Cancel stays LOCAL-FIRST: the status write precedes the Google call.
    const statusWrite = source.indexOf('.update({ status: "cancelled" })');
    const cancelCall = source.indexOf("cancelAppointmentOnCalendar(");
    assert.ok(statusWrite !== -1 && cancelCall !== -1);
    assert.ok(statusWrite < cancelCall, "cancel must remain local-first");

    // Reschedule stays CALENDAR-FIRST: the move precedes the local write.
    const moveCall = source.indexOf("rescheduleAppointmentOnCalendar(");
    const timeWrite = source.indexOf(".update({ appointment_datetime: newIso })");
    assert.ok(moveCall !== -1 && timeWrite !== -1);
    assert.ok(moveCall < timeWrite, "reschedule must remain calendar-first");
  });
});
