// Test support for the booking date + availability logic.
//
// These tests exercise the real src/lib/availability.ts and
// src/lib/parseDatetime.ts. Rather than injecting fakes into that code
// (which would mean refactoring working application code), the HTTP layer
// underneath it is stubbed: Supabase-js and the OpenAI call both go
// through global fetch, so replacing fetch is enough.
//
// Consequences, deliberately: no Supabase project is contacted, no dev
// record is mutated, no OpenAI budget is spent, and the results do not
// depend on what any org's hours happen to be set to today.

const TZ = "Europe/London";
const WEEKDAY_SHORT = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// ── Fixture: the exact configuration from the bug report ──────────────
// Monday open until 19:00, Tuesday until 17:00, Sunday closed.
export const REPORTED_HOURS = [
  { day_of_week: 0, is_closed: true, open_time: null, close_time: null },
  { day_of_week: 1, is_closed: false, open_time: "09:00:00", close_time: "19:00:00" },
  { day_of_week: 2, is_closed: false, open_time: "09:00:00", close_time: "17:00:00" },
  { day_of_week: 3, is_closed: false, open_time: "09:00:00", close_time: "17:00:00" },
  { day_of_week: 4, is_closed: false, open_time: "09:00:00", close_time: "17:00:00" },
  { day_of_week: 5, is_closed: false, open_time: "09:00:00", close_time: "17:00:00" },
  { day_of_week: 6, is_closed: true, open_time: null, close_time: null },
];

export const ORG_ID = "00000000-0000-4000-8000-000000000001";

// Fixed dates with an explicit +01:00 (BST) offset, so the wall-clock time
// under test is unambiguous and independent of the machine's timezone.
// 2 Aug 2026 = Sunday, 3 Aug = Monday, 4 Aug = Tuesday (asserted in the tests).
export const SUNDAY_1400 = "2026-08-02T14:00:00+01:00";
export const MONDAY_0830 = "2026-08-03T08:30:00+01:00";
export const MONDAY_1600 = "2026-08-03T16:00:00+01:00";
export const MONDAY_1800 = "2026-08-03T18:00:00+01:00";
export const MONDAY_1830 = "2026-08-03T18:30:00+01:00";
export const MONDAY_1845 = "2026-08-03T18:45:00+01:00";
export const MONDAY_1900 = "2026-08-03T19:00:00+01:00";
export const TUESDAY_1845 = "2026-08-04T18:45:00+01:00";

// ── Europe/London helpers ─────────────────────────────────────────────
export function londonParts(date) {
  const map = {};
  for (const part of new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
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

export const londonWeekday = (iso) => londonParts(new Date(iso)).weekday;

export function londonHhMm(iso) {
  const { hour, minute } = londonParts(new Date(iso));
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function londonOffsetMinutes(date) {
  const p = londonParts(date);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return (asIfUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000;
}

/** ISO instant for the next occurrence of `weekday` at a London wall-clock time. */
export function nextLondonWeekdayIso(weekday, hour, minute, from = new Date()) {
  const now = londonParts(from);
  let daysAhead = (weekday - now.weekday + 7) % 7;
  if (daysAhead === 0) daysAhead = 7; // always strictly in the future
  const naive = Date.UTC(now.year, now.month - 1, now.day + daysAhead, hour, minute);
  const firstGuess = new Date(naive - londonOffsetMinutes(new Date(naive)) * 60000);
  return new Date(naive - londonOffsetMinutes(firstGuess) * 60000).toISOString();
}

// ── fetch stub ────────────────────────────────────────────────────────
const realFetch = globalThis.fetch;

/**
 * Replaces global fetch for the duration of a test. Returns a handle with
 * a `calls` counter so a test can assert which table was actually read.
 */
export function installStubs({
  hours = REPORTED_HOURS,
  appointmentDurationMinutes = 60,
  emergencyModeEnabled = false,
  maxConcurrentBookings = 1,
  bookedCount = 0,
  /**
   * Real lead rows for the capacity check, so the OVERLAP window is
   * actually exercised. `bookedCount` remains for the older tests that
   * only care about the count; when `bookedLeads` is given it wins and
   * the stub filters properly.
   */
  bookedLeads = null,
  /** Make the business_hours read fail, for fail-closed tests. */
  hoursFail = false,
  /** Make the leads read fail, for fail-closed tests. */
  leadsFail = false,
  /**
   * organisations.timezone — the org's own IANA zone.
   *
   * Defaults to Europe/London because the real column is defaulted to it,
   * so every existing test keeps the exact behaviour it was written for.
   * Set it to another zone to prove business hours are judged on the
   * BUSINESS's clock, or to null/"" to model an org whose zone cannot be
   * established, which availability must now refuse rather than guess at.
   */
  orgTimezone = "Europe/London",
  modelIso = null,
  modelStatus = 200,
} = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-service-role-key";
  process.env.OPENAI_API_KEY = "stub-openai-key";

  const calls = { business_hours: 0, organisations: 0, leads: 0, openai: 0 };

  const json = (body, extraHeaders = {}) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json", ...extraHeaders },
    });

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method ?? "GET").toUpperCase();

    if (url.includes("/rest/v1/business_hours")) {
      calls.business_hours += 1;
      if (hoursFail) {
        return new Response(JSON.stringify({ message: "boom" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      // Mirror the columns availability.ts selects.
      return json(
        hours.map((h) => ({
          day_of_week: h.day_of_week,
          is_closed: h.is_closed,
          open_time: h.open_time,
          close_time: h.close_time,
          lunch_start: h.lunch_start ?? null,
          lunch_end: h.lunch_end ?? null,
        }))
      );
    }

    if (url.includes("/rest/v1/organisations")) {
      calls.organisations += 1;
      return json([
        {
          appointment_duration_minutes: appointmentDurationMinutes,
          emergency_mode_enabled: emergencyModeEnabled,
          max_concurrent_bookings: maxConcurrentBookings,
          // Mirrors the real column, which is defaulted to Europe/London.
          // Availability now REFUSES to decide without it, so a stub that
          // omitted it would fail closed and look like a code bug.
          ...(orgTimezone ? { timezone: orgTimezone } : {}),
        },
      ]);
    }

    if (url.includes("/rest/v1/leads")) {
      calls.leads += 1;
      if (leadsFail) {
        return new Response(JSON.stringify({ message: "boom" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }

      // When real rows are supplied, apply the query's own filters —
      // otherwise the overlap window would be silently ignored and a
      // capacity test would prove nothing.
      let count = bookedCount;
      if (bookedLeads) {
        const params = new URL(url).searchParams;
        const cmp = (a, b) => {
          const x = Date.parse(a);
          const y = Date.parse(b);
          return Number.isFinite(x) && Number.isFinite(y) ? x - y : 0;
        };
        count = bookedLeads.filter((row) => {
          for (const [key, raw] of params.entries()) {
            if (["select", "order", "limit", "offset"].includes(key)) continue;
            const v = String(row[key] ?? "");
            if (raw.startsWith("eq.")) {
              if (v !== raw.slice(3)) return false;
            } else if (raw.startsWith("neq.")) {
              if (v === raw.slice(4)) return false;
            } else if (raw.startsWith("gt.")) {
              if (!(cmp(v, raw.slice(3)) > 0)) return false;
            } else if (raw.startsWith("lt.")) {
              if (!(cmp(v, raw.slice(3)) < 0)) return false;
            } else if (raw.startsWith("gte.")) {
              if (!(cmp(v, raw.slice(4)) >= 0)) return false;
            } else if (raw.startsWith("lte.")) {
              if (!(cmp(v, raw.slice(4)) <= 0)) return false;
            } else {
              throw new Error(`Unsupported filter in test stub: ${key}=${raw}`);
            }
          }
          return true;
        }).length;
      }

      // Capacity check uses head:true + exact count, read from Content-Range.
      const headers = {
        "content-type": "application/json",
        "content-range": `*/${count}`,
      };
      return method === "HEAD"
        ? new Response(null, { status: 200, headers })
        : json([], headers);
    }

    if (url.includes("api.openai.com")) {
      calls.openai += 1;
      if (modelStatus !== 200) {
        return new Response("stubbed failure", { status: modelStatus });
      }
      // Shape of a chat-completions reply; content is the datetime the model
      // "returned" — tests use this to pin the weekday-correction behaviour.
      return json({ choices: [{ message: { content: modelIso ?? "null" } }] });
    }

    throw new Error(`Unstubbed fetch in test: ${method} ${url}`);
  };

  return {
    calls,
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}
