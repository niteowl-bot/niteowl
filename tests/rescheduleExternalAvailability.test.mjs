// Phase 1 — the two reschedule routes consult the EXTERNAL calendar.
//
// Chat and the widget have gone through checkBookingSlot since
// 2026-08-12. The two reschedule paths had not: they called
// isWithinBusinessHours + isSlotAvailable, which are INTERNAL checks
// only, so a slot already taken on the business's real Google calendar
// was reported free and the move went straight on top of it.
//
// Both now make the SAME decision every other booking path makes —
// hours, then capacity, then the external calendar — and the rule the
// whole design rests on applies to them too:
//
//   "CANNOT CHECK" IS NEVER "THAT TIME HAS GONE".
//
// A failed hours read, a failed capacity count or an unreadable calendar
// must leave the appointment untouched and ask for a retry, never claim
// the diary is full.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { encryptCredentials, loadKeyringFromEnv } from "@/lib/integrations/crypto";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CONNECTION_ID = "22222222-2222-4222-8222-222222222222";
const RESOURCE_ID = "33333333-3333-4333-8333-333333333333";
const CALENDAR_ID = "owner@example.com";
const LEAD_ID = "44444444-4444-4444-8444-444444444444";
const OWNER_ID = "55555555-5555-4555-8555-555555555555";

// Tuesday 11 August 2026, Europe/London (BST, UTC+1). Business hours in
// the stub are 09:00–17:00 every day.
const START_ISO = "2026-08-11T09:00:00.000Z"; // 10:00 — where the lead is
const MOVED_ISO = "2026-08-11T13:00:00.000Z"; // 14:00 — where it is going
const SHORT_MOVE_ISO = "2026-08-11T09:30:00.000Z"; // 10:30 — overlaps itself
const OUTSIDE_HOURS_ISO = "2026-08-11T06:00:00.000Z"; // 07:00 — before opening

/** The wall-clock date/time the manage link posts, in the org's zone. */
const WALL = {
  [MOVED_ISO]: { date: "2026-08-11", time: "14:00" },
  [SHORT_MOVE_ISO]: { date: "2026-08-11", time: "10:30" },
  [OUTSIDE_HOURS_ISO]: { date: "2026-08-11", time: "07:00" },
};

const BOOKED_LEAD = {
  id: LEAD_ID,
  org_id: ORG_ID,
  status: "booked",
  appointment_datetime: START_ISO,
  name: "Brian Murphy",
  email: "brian@example.com",
  phone: null,
  service_needed: "Boiler service",
};

const LINKED = [
  {
    id: "link-1",
    external_id: "rem-existing-event",
    external_etag: '"etag-1"',
    sync_status: "synced",
    resource_id: RESOURCE_ID,
  },
];

/**
 * @param busy         free/busy windows Google reports
 * @param connected    whether a calendar connection/resource exists
 * @param hoursFail    make the business_hours read fail (500)
 * @param capacityFail make the capacity count fail (500)
 * @param freeBusyFail make the free/busy lookup fail (500)
 * @param bookedCount  other booked leads overlapping the window
 * @param allowlisted  whether the org may have events WRITTEN
 */
function installStubs({
  busy = [],
  connected = true,
  hoursFail = false,
  capacityFail = false,
  freeBusyFail = false,
  bookedCount = 0,
  allowlisted = true,
  orgTimezone = "Europe/London",
} = {}) {
  process.env.INTEGRATIONS_ENABLED = "true";
  process.env.CALENDAR_SYNC_ENABLED = "true";
  process.env.CALENDAR_AVAILABILITY_BLOCKING = "true";
  process.env.CALENDAR_EVENT_CREATION_ORG_IDS = allowlisted ? ORG_ID : "";
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
    freeBusy: 0,
    hoursReads: 0,
    capacityQueries: [],
    updates: [],
    leadUpdates: [],
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

    if (url.includes("/auth/v1/user")) {
      return json({ id: OWNER_ID, aud: "authenticated", role: "authenticated" });
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
        calls.updates.push({ url, body: init.body ? JSON.parse(init.body) : {} });
        return json({ id: "existing-event", etag: '"etag-2"' });
      }
      return json({ id: "created-event", etag: '"etag-1"' });
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
      if (method === "PATCH" || method === "POST") return json([]);
      const row = LINKED[0];
      return wantsObject ? json(row) : json(LINKED);
    }

    if (url.includes("/rest/v1/business_hours")) {
      calls.hoursReads++;
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
      let ownershipProbe = false;
      try {
        ownershipProbe = new URL(url).searchParams.has("owner_id");
      } catch {}
      if (ownershipProbe) {
        const owned = { id: ORG_ID, appointment_duration_minutes: 60 };
        return wantsObject ? json(owned) : json([owned]);
      }
      const row = {
        appointment_duration_minutes: 60,
        emergency_mode_enabled: false,
        max_concurrent_bookings: 1,
        timezone: orgTimezone,
      };
      return wantsObject ? json(row) : json([row]);
    }

    if (url.includes("/rest/v1/leads")) {
      if (method === "PATCH") {
        const patch = init.body ? JSON.parse(init.body) : {};
        calls.leadUpdates.push(patch);
        return wantsObject ? json({ ...BOOKED_LEAD, ...patch }) : json([]);
      }
      // The capacity probe — a HEAD with an exact count.
      if (method === "HEAD") {
        calls.capacityQueries.push(url);
        if (capacityFail) return json({ message: "boom" }, 500);
        return new Response(null, {
          status: 200,
          headers: { "content-range": `*/${bookedCount}` },
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

let stubs;
afterEach(() => stubs?.restore());

// ── The two routes under test ──────────────────────────────────────

// The manage route rate-limits on TWO keys — the caller's IP (20/min)
// and the manage token (10/min) — and the buckets are in-memory for the
// life of the process. Both must therefore be unique per request, or the
// eleventh test in this file starts asserting against a 429 instead of
// the answer under test. A counter, not a random number: random collides.
let callSeq = 0;
const nextCall = () => {
  const n = ++callSeq;
  return {
    ip: `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`,
    token: `mt-${n}`,
  };
};

/** The customer's self-service manage link. */
async function customerReschedule(targetIso = MOVED_ISO) {
  const { POST } = await import("@/app/api/bookings/manage/route");
  const { NextRequest } = await import("next/server");
  const { date, time } = WALL[targetIso];
  const { ip, token } = nextCall();
  return POST(
    new NextRequest("https://app.test/api/bookings/manage", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ token, action: "reschedule", date, time }),
    })
  );
}

/** The owner's dashboard. */
async function ownerReschedule(targetIso = MOVED_ISO) {
  const { PATCH } = await import("@/app/api/leads/route");
  const { NextRequest } = await import("next/server");
  return PATCH(
    new NextRequest("https://app.test/api/leads", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: LEAD_ID,
        status: "booked",
        appointment_datetime: targetIso,
      }),
    })
  );
}

const ROUTES = [
  { name: "customer manage link", run: customerReschedule, hoursStatus: 400 },
  { name: "owner dashboard", run: ownerReschedule, hoursStatus: 422 },
];

// ══════════════════════════════════════════════════════════════════
//  1. The gap this closes
// ══════════════════════════════════════════════════════════════════

describe("an appointment on the business's real calendar blocks the move", () => {
  const BUSY = [{ start: MOVED_ISO, end: "2026-08-11T14:00:00.000Z" }];

  for (const route of ROUTES) {
    // THE CASE THAT WAS ACTUALLY BROKEN.
    //
    // rescheduleAppointmentOnCalendar re-verifies before it writes, so
    // for an ALLOWLISTED org it would already have caught this conflict
    // and returned the same 409. An org that is not allowlisted for
    // calendar WRITES gets no such protection: the sync layer returns
    // "no_calendar" and does nothing, so before this change the move
    // went through and landed on top of a real appointment.
    //
    // Availability READS are gated separately (CALENDAR_SYNC_ENABLED and
    // the resource's availability_enabled), which is why the calendar
    // can still be consulted here at all.
    test(`${route.name} — a write-disabled org is REFUSED, not booked over`, async () => {
      stubs = installStubs({ busy: BUSY, allowlisted: false });
      const res = await route.run();
      const body = await res.json();

      assert.equal(res.status, 409);
      assert.match(body.error, /no longer available/);
      assert.equal(
        stubs.calls.leadUpdates.length,
        0,
        "the stored time must not move onto a busy slot"
      );
      assert.equal(stubs.calls.updates.length, 0, "and no Google event is touched");
    });

    test(`${route.name} — an allowlisted org is refused BEFORE the write is attempted`, async () => {
      stubs = installStubs({ busy: BUSY });
      const res = await route.run();

      assert.equal(res.status, 409);
      // One free/busy call, not two: the route's own decision refused it,
      // so the calendar-sync layer's pre-write re-check never ran. This
      // is what distinguishes the new behaviour from the old — the old
      // code reached the write layer and was refused there instead.
      assert.equal(
        stubs.calls.freeBusy,
        1,
        "the route must refuse before calendarSync re-checks"
      );
      assert.equal(stubs.calls.updates.length, 0);
    });

    test(`${route.name} — the external calendar is actually consulted`, async () => {
      stubs = installStubs();
      await route.run();
      assert.ok(
        stubs.calls.freeBusy >= 1,
        "a reschedule must ask the calendar before accepting"
      );
    });
  }
});

// ══════════════════════════════════════════════════════════════════
//  2. "Cannot check" is never "that time has gone"
// ══════════════════════════════════════════════════════════════════

describe("a failed lookup refuses truthfully and changes nothing", () => {
  for (const route of ROUTES) {
    test(`${route.name} — an unreadable CALENDAR is 503, not "fully booked"`, async () => {
      stubs = installStubs({ freeBusyFail: true });
      const res = await route.run();
      const body = await res.json();

      assert.equal(res.status, 503);
      assert.doesNotMatch(body.error, /fully booked/i);
      assert.match(body.error, /couldn't confirm/i);
      assert.equal(stubs.calls.leadUpdates.length, 0);
      assert.equal(stubs.calls.updates.length, 0);
    });

    test(`${route.name} — a failed HOURS read is 503, not "outside business hours"`, async () => {
      stubs = installStubs({ hoursFail: true });
      const res = await route.run();
      const body = await res.json();

      assert.equal(res.status, 503);
      assert.doesNotMatch(body.error, /outside business hours/i);
      assert.equal(stubs.calls.leadUpdates.length, 0);
    });

    test(`${route.name} — a failed CAPACITY count is 503`, async () => {
      stubs = installStubs({ capacityFail: true });
      const res = await route.run();
      const body = await res.json();

      assert.equal(res.status, 503);
      assert.doesNotMatch(body.error, /fully booked/i);
      assert.equal(stubs.calls.leadUpdates.length, 0);
    });
  }
});

// ══════════════════════════════════════════════════════════════════
//  3. Everything that must NOT have changed
// ══════════════════════════════════════════════════════════════════

describe("the responses that already existed are preserved", () => {
  for (const route of ROUTES) {
    test(`${route.name} — outside business hours keeps its status and wording`, async () => {
      stubs = installStubs();
      const res = await route.run(OUTSIDE_HOURS_ISO);
      const body = await res.json();

      assert.equal(res.status, route.hoursStatus);
      assert.match(body.error, /outside business hours/i);
      assert.ok(body.reason, "the reason is still returned");
      assert.equal(stubs.calls.leadUpdates.length, 0);
    });

    test(`${route.name} — an internally full slot still says "fully booked"`, async () => {
      stubs = installStubs({ bookedCount: 1 });
      const res = await route.run();
      const body = await res.json();

      assert.equal(res.status, 409);
      assert.match(body.error, /fully booked/i);
      assert.equal(stubs.calls.leadUpdates.length, 0);
    });
  }

  test("customer manage link — a free slot still moves the appointment", async () => {
    stubs = installStubs();
    const res = await customerReschedule();
    assert.equal(res.status, 200);
    assert.equal(
      stubs.calls.leadUpdates.at(-1).appointment_datetime,
      MOVED_ISO,
      "the new time is stored"
    );
    assert.equal(stubs.calls.updates.length, 1, "and the Google event moves with it");
  });

  test("owner dashboard — a free slot still moves the appointment", async () => {
    stubs = installStubs();
    const res = await ownerReschedule();
    assert.equal(res.status, 200);
    assert.equal(stubs.calls.leadUpdates.at(-1).appointment_datetime, MOVED_ISO);
    assert.equal(stubs.calls.updates.length, 1);
  });
});

describe("with NO calendar connected, behaviour is exactly as before", () => {
  for (const route of ROUTES) {
    test(`${route.name} — the move succeeds and nothing external is called`, async () => {
      stubs = installStubs({ connected: false });
      const res = await route.run();

      assert.equal(res.status, 200);
      assert.equal(stubs.calls.leadUpdates.at(-1).appointment_datetime, MOVED_ISO);
      assert.equal(stubs.calls.freeBusy, 0, "an org with no calendar pays nothing");
      assert.equal(stubs.calls.updates.length, 0);
    });
  }
});

describe("excludeLeadId — a short move must not clash with itself", () => {
  for (const route of ROUTES) {
    test(`${route.name} — 10:00 → 10:30 is still allowed`, async () => {
      // Capacity is an OVERLAP test and max_concurrent_bookings is 1, so
      // without the exemption the lead meets its own existing row and
      // every short reschedule is refused.
      stubs = installStubs();
      const res = await route.run(SHORT_MOVE_ISO);

      assert.equal(res.status, 200, "the appointment may move within its own hour");
      assert.equal(
        stubs.calls.leadUpdates.at(-1).appointment_datetime,
        SHORT_MOVE_ISO
      );
      assert.ok(
        stubs.calls.capacityQueries.some((u) => u.includes(LEAD_ID)),
        "the capacity query must exclude the lead being moved"
      );
    });
  }
});

describe("the same-time short-circuit", () => {
  test("customer manage link — resubmitting the current time checks nothing", async () => {
    stubs = installStubs();
    const { POST } = await import("@/app/api/bookings/manage/route");
    const { NextRequest } = await import("next/server");
    // 10:00 London on 11 Aug 2026 IS the lead's current instant.
    const { ip, token } = nextCall();
    const res = await POST(
      new NextRequest("https://app.test/api/bookings/manage", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({
          token,
          action: "reschedule",
          date: "2026-08-11",
          time: "10:00",
        }),
      })
    );

    assert.equal(res.status, 200);
    assert.equal(stubs.calls.hoursReads, 0, "no availability decision is made");
    assert.equal(stubs.calls.freeBusy, 0);
  });

  test("owner dashboard — saving without moving the time checks nothing", async () => {
    stubs = installStubs();
    const res = await ownerReschedule(START_ISO);

    assert.equal(res.status, 200);
    assert.equal(stubs.calls.hoursReads, 0);
    assert.equal(stubs.calls.freeBusy, 0);
  });
});

describe("the timezone stays the organisation's, and fails closed", () => {
  test("customer manage link — an unusable org timezone refuses the move", async () => {
    stubs = installStubs({ orgTimezone: "BST" }); // Intl resolves this to Asia/Dhaka
    const res = await customerReschedule();
    const body = await res.json();

    assert.equal(res.status, 503);
    assert.match(body.error, /original time is unchanged/i);
    assert.equal(stubs.calls.leadUpdates.length, 0);
  });

  test("the wall-clock time is read in the BUSINESS's zone", async () => {
    stubs = installStubs();
    await customerReschedule(); // posts 14:00 wall clock
    assert.equal(
      stubs.calls.leadUpdates.at(-1).appointment_datetime,
      MOVED_ISO,
      "14:00 London must store 13:00Z, never 14:00Z"
    );
  });
});

// ══════════════════════════════════════════════════════════════════
//  4. Structural fences
// ══════════════════════════════════════════════════════════════════

describe("neither route may go back to the internal-only checks", () => {
  const read = async (p) => {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    return readFile(
      path.resolve(import.meta.dirname, "..", "src", "app", "api", p),
      "utf8"
    );
  };

  test("the manage route imports checkBookingSlot and not isSlotAvailable", async () => {
    const src = await read("bookings/manage/route.ts");
    assert.match(src, /import \{ checkBookingSlot \}/);
    assert.doesNotMatch(src, /^\s*isSlotAvailable,?$/m);
    assert.doesNotMatch(src, /await isSlotAvailable\(/);
    assert.doesNotMatch(src, /await isWithinBusinessHours\(/);
  });

  test("the leads route imports checkBookingSlot and not isSlotAvailable", async () => {
    const src = await read("leads/route.ts");
    assert.match(src, /import \{ checkBookingSlot \}/);
    assert.doesNotMatch(src, /await isSlotAvailable\(/);
    assert.doesNotMatch(src, /await isWithinBusinessHours\(/);
  });

  test("both routes still pass excludeLeadId", async () => {
    assert.match(await read("bookings/manage/route.ts"), /excludeLeadId/);
    assert.match(await read("leads/route.ts"), /excludeLeadId/);
  });
});
