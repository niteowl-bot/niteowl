// "Tuesday at 3pm" means 3pm where the business is.
//
// resolveAppointmentDatetime handed parseDatetimeToIso a hardcoded
// "Europe/London", so the customer's spoken time was interpreted on a
// London clock and then measured by isWithinBusinessHours — which since
// db94086 reads the org's real zone — against local opening hours. For a
// New York business the two disagreed by the whole offset: "10am"
// became 10:00 London, 05:00 local, before the shop opened.
//
// It now resolves the zone through getOrgTimezone(orgId), the same
// lookup availability.ts uses, with the same Europe/London fallback.
//
// These drive the REAL capturePartialLead with the HTTP layer stubbed
// (same approach as tests/support.mjs and voiceLeadIsolation), so the
// assertions are about what actually reaches the model and the database.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import — see the file
import { capturePartialLead } from "@/lib/leadCapture";
import { ORG_ID } from "./support.mjs";

const NEW_YORK = "America/New_York";
const LONDON = "Europe/London";
const TUESDAY = 2;
const SATURDAY = 6;

/** Open 09:00–17:00 in the org's own local time, every day. */
const ALWAYS_OPEN_9_TO_5 = [0, 1, 2, 3, 4, 5, 6].map((day_of_week) => ({
  day_of_week,
  is_closed: false,
  open_time: "09:00",
  close_time: "17:00",
  lunch_start: null,
  lunch_end: null,
}));

// ── Zone helpers ──────────────────────────────────────────────────────
// Deliberately generic rather than the London-only helpers in
// support.mjs: the whole point here is a non-London business.

const WEEKDAY_SHORT = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function zonedParts(date, timeZone) {
  const map = {};
  for (const part of new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)) {
    map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: WEEKDAY_SHORT[map.weekday],
  };
}

function offsetMinutes(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return (asIfUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000;
}

/** ISO instant for the next occurrence of `weekday` at a local wall clock. */
function nextZonedWeekdayIso(weekday, hour, minute, timeZone, from = new Date()) {
  const now = zonedParts(from, timeZone);
  let daysAhead = (weekday - now.weekday + 7) % 7;
  if (daysAhead === 0) daysAhead = 7; // always strictly in the future
  const naive = Date.UTC(now.year, now.month - 1, now.day + daysAhead, hour, minute);
  const firstGuess = new Date(naive - offsetMinutes(new Date(naive), timeZone) * 60000);
  return new Date(naive - offsetMinutes(firstGuess, timeZone) * 60000).toISOString();
}

const localWeekday = (iso, timeZone) => zonedParts(new Date(iso), timeZone).weekday;

function localHhMm(iso, timeZone) {
  const { hour, minute } = zonedParts(new Date(iso), timeZone);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// ── HTTP stubs ────────────────────────────────────────────────────────

/**
 * Stubs the PostgREST/OpenAI surface, recording the inserted lead rows
 * and every prompt sent to the datetime parser.
 *
 * `timezone: null` models the pre-migration database — column absent —
 * which must still behave exactly like Europe/London.
 */
function installLeadStubs({ timezone = null, modelIso = null } = {}) {
  const realFetch = globalThis.fetch;
  const inserts = [];
  const prompts = [];

  const json = (body, extraHeaders = {}) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json", ...extraHeaders },
    });

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    const wantsObject = (new Headers(init.headers ?? {}).get("accept") ?? "").includes(
      "pgrst.object"
    );

    if (url.includes("/rest/v1/business_hours")) {
      return json(ALWAYS_OPEN_9_TO_5);
    }

    if (url.includes("/rest/v1/organisations")) {
      const row = {
        appointment_duration_minutes: 60,
        emergency_mode_enabled: false,
        max_concurrent_bookings: 5,
        ...(timezone ? { timezone } : {}),
      };
      // getOrgTimezone uses maybeSingle(), which asks for a single
      // object; getOrgSettings takes the array.
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
        const row = JSON.parse(init.body);
        inserts.push({ id: `lead-${inserts.length + 1}`, ...row });
        return wantsObject
          ? json({ id: `lead-${inserts.length}` })
          : json([{ id: `lead-${inserts.length}` }]);
      }
      if (method === "PATCH") return json([]);
      // No pre-existing leads: every capture takes the insert path.
      return wantsObject ? json(null) : json([]);
    }

    if (url.includes("api.openai.com")) {
      prompts.push(JSON.parse(init.body).messages[0].content);
      return json({ choices: [{ message: { content: modelIso ?? "null" } }] });
    }

    throw new Error(`Unstubbed fetch in test: ${method} ${url}`);
  };

  return {
    inserts,
    prompts,
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

/** A service-role-shaped client pointed at the stubbed HTTP layer. */
async function adminClient() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

const CUSTOMER = {
  intent: "new_booking",
  name: "Dana Reyes",
  email: "dana@example.com",
  phone: "+12125551234",
  service: "boiler service",
  preferred_datetime: "Tuesday at 10am",
  confidence: 0.9,
};

function capture(supabase, extracted) {
  return capturePartialLead(
    supabase,
    ORG_ID,
    "eeeeeeee-5555-4555-8555-eeeeeeeeeeee",
    "Can I book Tuesday at 10am?",
    { ...CUSTOMER, ...extracted },
    "chat",
    false
  );
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("the spoken time is interpreted in the organisation's zone", () => {
  let supabase;
  let stubs;

  beforeEach(async () => {
    supabase = await adminClient();
  });
  afterEach(() => stubs?.restore());

  test("the parser is told the org's zone, not London", async () => {
    stubs = installLeadStubs({ timezone: NEW_YORK });
    await capture(supabase, {});

    assert.equal(stubs.prompts.length, 1, "expected one datetime parse");
    assert.match(stubs.prompts[0], /America\/New_York/);
    assert.doesNotMatch(
      stubs.prompts[0],
      /Europe\/London/,
      "London must not be named for a New York business"
    );
  });

  test("no timezone configured still parses as Europe/London", async () => {
    // The pre-migration database: getOrgTimezone falls back.
    stubs = installLeadStubs();
    await capture(supabase, {});

    assert.match(stubs.prompts[0], /Europe\/London/);
  });

  // End-to-end sanity for the New York path: the model answers with the
  // wrong weekday — the documented failure snapToNamedWeekday corrects —
  // and the appointment that reaches the database is the Tuesday the
  // customer asked for, at 10:00 local.
  //
  // This does NOT carry the regression, and was checked against the old
  // hardcoded-London code to confirm it: snapping moves the instant by
  // whole days, so preserving London's wall clock preserves New York's
  // too wherever the two zones' offsets hold steady across that week.
  // The zone only changes the outcome where the model does the
  // conversion — which is the prompt, pinned by the first test above.
  test("the corrected Tuesday is saved at 10:00 local", async () => {
    stubs = installLeadStubs({
      timezone: NEW_YORK,
      modelIso: nextZonedWeekdayIso(SATURDAY, 10, 0, NEW_YORK),
    });

    await capture(supabase, {});
    const iso = stubs.inserts[0].appointment_datetime;

    assert.ok(iso, "expected an appointment to be saved");
    assert.equal(localWeekday(iso, NEW_YORK), TUESDAY, `expected a Tuesday, got ${iso}`);
    assert.equal(localHhMm(iso, NEW_YORK), "10:00", "10am must mean 10am in New York");
  });

  test("a London business is unchanged", async () => {
    stubs = installLeadStubs({
      timezone: LONDON,
      modelIso: nextZonedWeekdayIso(SATURDAY, 10, 0, LONDON),
    });

    await capture(supabase, {});
    const iso = stubs.inserts[0].appointment_datetime;

    assert.equal(localWeekday(iso, LONDON), TUESDAY);
    assert.equal(localHhMm(iso, LONDON), "10:00");
  });

  test("a message with no time asks neither the model nor the org", async () => {
    stubs = installLeadStubs({ timezone: NEW_YORK });
    await capture(supabase, { preferred_datetime: null });

    assert.equal(stubs.prompts.length, 0, "nothing to parse, so no OpenAI call");
    assert.equal(stubs.inserts.length, 1, "the lead is still captured");
    assert.equal(stubs.inserts[0].appointment_datetime, null);
  });
});
