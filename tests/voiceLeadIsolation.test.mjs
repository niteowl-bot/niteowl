// Regression: one voice call, one lead.
//
// The bug (observed 2026-08): a call from Jason O'Dwyer produced a lead
// carrying Brian Murphy's data — Brian's service ("a leak coming from my
// ceiling") instead of Jason's boiler repair, and Jason's summary
// appended to a stack of Brian's. Both had rung the same handset, so
// the lead engine's contact-detail layer matched the caller ID to
// Brian's still-open lead and took the UPDATE path, where
// shouldUpdateService keeps the old service and deduplicateMessage
// concatenates summaries.
//
// These drive the REAL capturePartialLead with the HTTP layer stubbed
// (same approach as tests/support.mjs), so the assertions are about
// what actually reaches the database: two calls, two independent rows,
// no PATCH of the earlier lead.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import — see the file
import { capturePartialLead } from "@/lib/leadCapture";
import { REPORTED_HOURS, ORG_ID, nextLondonWeekdayIso } from "./support.mjs";

const CALLER_ID = "+353871111111";

// The two calls in the bug report: same handset, different people.
const BRIAN = {
  conversationId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  summary: "Brian Murphy reported a leak coming from his ceiling.",
  extracted: {
    intent: "question",
    name: "Brian Murphy",
    email: null,
    phone: CALLER_ID,
    service: "a leak coming from my ceiling",
    preferred_datetime: "Tuesday at 10am",
    confidence: 0.4,
  },
};

const JASON = {
  conversationId: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
  summary: "Jason O'Dwyer asked for a boiler repair.",
  extracted: {
    intent: "question",
    name: "Jason O'Dwyer",
    email: null,
    phone: CALLER_ID,
    service: "boiler repair",
    preferred_datetime: "Friday at 3pm",
    confidence: 0.4,
  },
};

/**
 * Applies the subset of PostgREST filter syntax the lead engine uses,
 * so a stubbed SELECT returns what the real database would. Without
 * this the stub answers every query with every row, and a lookup keyed
 * on the call id would "match" an unrelated call.
 *
 * Supports `col=eq.v`, `col=in.(a,b)` and `or=(a.eq.x,b.eq.y)`.
 * Anything else (select, order, limit, created_at bounds) is ignored —
 * none of it changes which fixture row matches.
 */
function applyFilters(url, rows) {
  const params = new URL(url).searchParams;
  let result = rows;

  for (const [key, raw] of params.entries()) {
    if (["select", "order", "limit", "offset", "created_at"].includes(key)) continue;

    if (key === "or") {
      const clauses = raw.replace(/^\(|\)$/g, "").split(",");
      result = result.filter((row) =>
        clauses.some((clause) => {
          const [col, op, value] = clause.split(".");
          return op === "eq" && String(row[col] ?? "") === value;
        })
      );
      continue;
    }

    // Timestamps compare as instants, not text — the overlap window
    // uses strict gt/lt bounds, and dropping them would make every row
    // match.
    const cmp = (a, b) => {
      const x = Date.parse(a);
      const y = Date.parse(b);
      return Number.isFinite(x) && Number.isFinite(y)
        ? x - y
        : String(a) < String(b)
        ? -1
        : String(a) > String(b)
        ? 1
        : 0;
    };

    if (raw.startsWith("eq.")) {
      const value = raw.slice(3);
      result = result.filter((row) => String(row[key] ?? "") === value);
    } else if (raw.startsWith("neq.")) {
      const value = raw.slice(4);
      result = result.filter((row) => String(row[key] ?? "") !== value);
    } else if (raw.startsWith("gt.")) {
      const value = raw.slice(3);
      result = result.filter((row) => cmp(String(row[key] ?? ""), value) > 0);
    } else if (raw.startsWith("lt.")) {
      const value = raw.slice(3);
      result = result.filter((row) => cmp(String(row[key] ?? ""), value) < 0);
    } else if (raw.startsWith("gte.")) {
      const value = raw.slice(4);
      result = result.filter((row) => cmp(String(row[key] ?? ""), value) >= 0);
    } else if (raw.startsWith("lte.")) {
      const value = raw.slice(4);
      result = result.filter((row) => cmp(String(row[key] ?? ""), value) <= 0);
    } else if (raw.startsWith("in.")) {
      const allowed = raw.slice(3).replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, ""));
      result = result.filter((row) => allowed.includes(String(row[key] ?? "")));
    }
  }

  return result;
}

/**
 * Stubs the PostgREST/OpenAI HTTP surface and records every write.
 *
 * The leads table is modelled just far enough to reproduce the bug: a
 * SELECT returns previously inserted rows, so the contact-detail lookup
 * genuinely CAN find the earlier caller's lead. The fix has to decline
 * it, not merely fail to find it.
 */
function installLeadStubs({ appointmentIsos = [] } = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-service-role-key";
  process.env.OPENAI_API_KEY = "stub-openai-key";

  const realFetch = globalThis.fetch;
  const inserts = [];
  const updates = [];
  const selects = [];
  let isoIndex = 0;

  const json = (body, extraHeaders = {}) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json", ...extraHeaders },
    });

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers ?? {});
    const wantsObject = (headers.get("accept") ?? "").includes("pgrst.object");

    if (url.includes("/rest/v1/business_hours")) {
      return json(
        REPORTED_HOURS.map((h) => ({
          day_of_week: h.day_of_week,
          is_closed: h.is_closed,
          open_time: h.open_time,
          close_time: h.close_time,
          lunch_start: null,
          lunch_end: null,
        }))
      );
    }

    if (url.includes("/rest/v1/organisations")) {
      return json([
        {
          appointment_duration_minutes: 60,
          emergency_mode_enabled: false,
          max_concurrent_bookings: 5,
        },
      ]);
    }

    if (url.includes("/rest/v1/leads")) {
      const countHeaders = { "content-range": "*/0" };

      if (method === "HEAD") {
        return new Response(null, { status: 200, headers: countHeaders });
      }

      if (method === "POST") {
        const row = JSON.parse(init.body);
        const stored = { id: `lead-${inserts.length + 1}`, ...row };
        inserts.push(stored);
        return wantsObject ? json({ id: stored.id }) : json([{ id: stored.id }]);
      }

      if (method === "PATCH") {
        updates.push({ url, payload: JSON.parse(init.body) });
        return json([]);
      }

      // SELECT — hand back the leads already inserted that match the
      // query, so the contact-detail layer genuinely CAN find the
      // earlier caller's lead by its caller ID.
      selects.push(url);
      const rows = applyFilters(url, inserts).map((row) => ({
        id: row.id,
        name: row.name ?? null,
        email: row.email ?? null,
        phone: row.phone ?? null,
        service_needed: row.service_needed ?? null,
        preferred_datetime: row.preferred_datetime ?? null,
        appointment_datetime: row.appointment_datetime ?? null,
        message: row.message ?? null,
        status: row.status ?? "new",
        conversation_id: row.conversation_id ?? null,
        manage_token: row.manage_token ?? null,
      }));
      return wantsObject ? json(rows[0] ?? null) : json(rows);
    }

    if (url.includes("api.openai.com")) {
      const iso = appointmentIsos[isoIndex] ?? "null";
      isoIndex += 1;
      return json({ choices: [{ message: { content: iso } }] });
    }

    throw new Error(`Unstubbed fetch in test: ${method} ${url}`);
  };

  return {
    inserts,
    updates,
    selects,
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

function captureCall(supabase, call) {
  return capturePartialLead(
    supabase,
    ORG_ID,
    call.conversationId,
    call.summary,
    { ...call.extracted },
    "voice",
    true
  );
}

describe("two voice calls from the same caller ID stay isolated", () => {
  let stubs;
  let supabase;

  beforeEach(async () => {
    stubs = installLeadStubs({
      appointmentIsos: [
        nextLondonWeekdayIso(2, 10, 0), // Brian — Tuesday 10:00
        nextLondonWeekdayIso(5, 15, 0), // Jason — Friday 15:00
      ],
    });
    supabase = await adminClient();
  });

  afterEach(() => stubs.restore());

  test("each call inserts its own lead instead of updating the previous one", async () => {
    await captureCall(supabase, BRIAN);
    await captureCall(supabase, JASON);

    assert.equal(stubs.inserts.length, 2, "each call should create its own lead");
    assert.equal(
      stubs.updates.length,
      0,
      "the earlier caller's lead must never be updated by a later call"
    );
  });

  test("the second lead carries none of the first caller's data", async () => {
    await captureCall(supabase, BRIAN);
    await captureCall(supabase, JASON);

    const [brian, jason] = stubs.inserts;

    assert.equal(brian.name, "Brian Murphy");
    assert.equal(jason.name, "Jason O'Dwyer");

    // The reported symptom: Jason's Service Needed showed Brian's leak.
    assert.equal(jason.service_needed, "boiler repair");
    assert.doesNotMatch(jason.service_needed, /ceiling/i);

    // The other reported symptom: Brian's summaries stacked up on Jason's
    // lead. Each enquiry summary must describe only its own call.
    assert.equal(jason.message, JASON.summary);
    assert.doesNotMatch(jason.message, /Brian/);
    assert.equal(brian.message, BRIAN.summary);
    assert.doesNotMatch(brian.message, /Jason/);
  });

  test("each lead keeps its own appointment time", async () => {
    await captureCall(supabase, BRIAN);
    await captureCall(supabase, JASON);

    const [brian, jason] = stubs.inserts;

    assert.equal(brian.preferred_datetime, "Tuesday at 10am");
    assert.equal(jason.preferred_datetime, "Friday at 3pm");
    assert.notEqual(jason.appointment_datetime, brian.appointment_datetime);
    assert.equal(
      jason.appointment_datetime,
      nextLondonWeekdayIso(5, 15, 0),
      "Jason's lead should hold Friday 15:00, not Brian's Tuesday slot"
    );
  });

  test("both leads still record the shared caller ID as the phone", async () => {
    await captureCall(supabase, BRIAN);
    await captureCall(supabase, JASON);

    // Isolation must not come at the cost of the caller ID: it stays the
    // lead's phone on BOTH rows (the alternate number is stored
    // separately in metadata by the voice layer, untouched here).
    for (const row of stubs.inserts) {
      assert.equal(row.phone, CALLER_ID);
    }
  });

  test("each lead is linked to its own call", async () => {
    await captureCall(supabase, BRIAN);
    await captureCall(supabase, JASON);

    const [brian, jason] = stubs.inserts;
    assert.equal(brian.conversation_id, BRIAN.conversationId);
    assert.equal(jason.conversation_id, JASON.conversationId);
    assert.notEqual(jason.conversation_id, brian.conversation_id);
  });

  test("a third call from the same handset is isolated too", async () => {
    await captureCall(supabase, BRIAN);
    await captureCall(supabase, JASON);
    await captureCall(supabase, {
      conversationId: "cccccccc-3333-4333-8333-cccccccccccc",
      summary: "Same handset, third caller, drain unblocking.",
      extracted: { ...JASON.extracted, name: "Marie Kelly", service: "drain unblocking" },
    });

    assert.equal(stubs.inserts.length, 3);
    assert.equal(stubs.updates.length, 0);
    assert.equal(stubs.inserts[2].name, "Marie Kelly");
    assert.equal(stubs.inserts[2].service_needed, "drain unblocking");
    assert.doesNotMatch(stubs.inserts[2].message, /Brian|Jason/);
  });
});

describe("chat leads still merge — the fix is voice-only", () => {
  let stubs;
  let supabase;

  beforeEach(async () => {
    stubs = installLeadStubs();
    supabase = await adminClient();
  });

  afterEach(() => stubs.restore());

  test("a follow-up chat message updates the open lead rather than duplicating it", async () => {
    const conversationId = "dddddddd-4444-4444-8444-dddddddddddd";
    const extracted = {
      intent: "question",
      name: "Chat Customer",
      email: "chat@example.com",
      phone: null,
      service: "shower not draining",
      preferred_datetime: null,
      confidence: 0.4,
    };

    await capturePartialLead(
      supabase, ORG_ID, conversationId, "First message", { ...extracted }, "chat", true
    );
    await capturePartialLead(
      supabase, ORG_ID, conversationId, "Second message", { ...extracted }, "chat", true
    );

    assert.equal(stubs.inserts.length, 1, "chat must not start a second lead");
    assert.equal(stubs.updates.length, 1, "the follow-up must merge into it");
  });
});
