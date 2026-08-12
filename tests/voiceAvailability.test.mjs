// Live availability during a phone call — READ ONLY.
//
// Remy could already collect an appointment date and a clock time, but
// had no idea whether that slot was actually free: the assistant is
// built once at call start and nothing could ask our server a question
// mid-call. This wires the EXISTING engine (checkBookingSlot, which is
// business hours → internal capacity → external calendar) to the call
// through a Vapi custom tool.
//
// The two properties that matter most are pinned here:
//   1. ZERO WRITES. An availability lookup must never insert, update or
//      delete anything, and must never create a calendar event or
//      reserve a slot. Booking creation is a separate phase.
//   2. NOTHING IS INVENTED. Every time Remy speaks came out of the
//      engine. A failure of any kind produces "unknown", never a slot.
//
// The HTTP layer is stubbed the same way as voiceLeadIsolation and
// voiceAbortedCall, so these drive the real handler and the real
// lookup and assert on what actually leaves the process.

import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import — see the file
import { handleVoiceWebhookPost } from "@/lib/voice/handler";
import {
  VOICE_AVAILABILITY_TOOL_NAME,
  buildVapiAssistantResponse,
  parseVapiWebhook,
} from "@/lib/voice/vapi";
import { buildVoiceAssistantConfig } from "@/lib/voice/assistant";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const BUSINESS = "+353212345678";
const SECRET = "test-voice-secret";
const SERVER_URL = "https://app.example.com/api/voice/webhook";

// ── A controlled clock, so this file cannot rot ───────────────────
//
// `isHeldByPendingRequest` opens with "a slot that has already passed
// cannot be held by anything" (availabilityTool.ts). That production
// rule is correct and is NOT under test here — but it made this file a
// time bomb, because the fixture below is a fixed calendar date. Every
// assertion that a slot IS held expired the moment the real clock
// passed it: on 2026-08-12 they began failing one by one through the
// afternoon, 14:30 first, then 15:00, then 15:30.
//
// Worse than the failures were the silent passes. "A different time on
// the same day stays available" and both back-to-back cases assert
// AVAILABLE, so once their slot fell into the past they kept passing —
// for the wrong reason, proving nothing about overlap at all.
//
// Pinning "now" is what actually fixes that. Moving the fixture further
// into the future only postpones the same rot, because production still
// compares against Date.now(). node:test's built-in mock.timers gives a
// deterministic clock with no new dependency: only `Date` is faked, so
// timers stay real for the async stubs, `new Date(iso)` still parses
// normally, and Intl still resolves Europe/London — the three things
// this fixture's timezone semantics depend on.
//
// 09:00 London on the fixture's own morning: before every slot the file
// exercises (11:00–16:00), on the same day, and inside business hours.
const NOW = Date.UTC(2026, 7, 12, 8, 0, 0); // 2026-08-12T08:00:00Z = 09:00 BST

beforeEach(() => mock.timers.enable({ apis: ["Date"], now: NOW }));
afterEach(() => mock.timers.reset());

// Wednesday 12 August 2026, 15:00 Europe/London (BST, +01:00) — seven
// hours after NOW above, so it is unambiguously in the future whatever
// the machine's real date happens to be.
const WEDNESDAY = { date: "2026-08-12", time: "15:00" };

function assistantFor(serverUrl = SERVER_URL) {
  const config = buildVoiceAssistantConfig(
    {
      business_name: "Acme Plumbing",
      business_type: "plumber",
      primary_goal: "book jobs",
      description: null,
      website: null,
    },
    [],
    { greeting: null, voice_id: null, language: null },
    serverUrl,
    "+353861234567",
    new Date("2026-08-03T09:00:00+01:00")
  );
  return buildVapiAssistantResponse(config).assistant;
}

function toolCallBody(args = WEDNESDAY, name = VOICE_AVAILABILITY_TOOL_NAME) {
  return {
    message: {
      type: "tool-calls",
      phoneNumber: { number: BUSINESS },
      customer: { number: "+353861234567" },
      call: { id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa" },
      toolCallList: [{ id: "call_abc123", name, arguments: args }],
    },
  };
}

function request(body) {
  return new Request(SERVER_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-vapi-secret": SECRET },
    body: JSON.stringify(body),
  });
}

/**
 * Stubs the HTTP surface and records every write attempt. `bookedAt`
 * lists the appointment_datetime values already taken, so capacity can
 * genuinely refuse a slot.
 */
/**
 * A lead row as the capacity checks see it. `bookedAt` stays as a
 * shorthand for the common "someone is already booked here" case.
 */
const bookedLead = (iso) => ({
  org_id: ORG_ID,
  appointment_datetime: iso,
  status: "booked",
  metadata: {},
});

/** What a completed phone appointment request leaves behind. */
const requestLead = (iso, status = "needs_review") => ({
  org_id: ORG_ID,
  appointment_datetime: iso,
  status,
  metadata: { appointment_request: true },
});

function installStubs({
  bookedAt = [],
  leads = [],
  hoursFail = false,
  leadsFail = false,
  durationMinutes = 60,
} = {}) {
  const leadRows = [...bookedAt.map(bookedLead), ...leads];
  process.env.VOICE_ENABLED = "true";
  process.env.VAPI_WEBHOOK_SECRET = SECRET;

  const realFetch = globalThis.fetch;
  const writes = [];

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

    // ── the zero-write tripwire ──
    if (["POST", "PATCH", "PUT", "DELETE"].includes(method)) {
      writes.push({ method, url });
      return json([]);
    }
    if (url.includes("googleapis.com") || url.includes("graph.microsoft.com")) {
      writes.push({ method, url });
      return json({});
    }

    if (url.includes("/rest/v1/voice_settings")) {
      const row = { org_id: ORG_ID };
      return wantsObject ? json(row) : json([row]);
    }

    if (url.includes("/rest/v1/business_hours")) {
      if (hoursFail) {
        return new Response(JSON.stringify({ message: "boom" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      // Open 09:00–17:00 every day.
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
        appointment_duration_minutes: durationMinutes,
        emergency_mode_enabled: false,
        max_concurrent_bookings: 1,
        timezone: "Europe/London",
      };
      return wantsObject ? json(row) : json([row]);
    }

    if (url.includes("/rest/v1/leads")) {
      if (leadsFail) {
        return new Response(JSON.stringify({ message: "boom" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      // Two different counts hit this table: the shared engine's
      // capacity check (status=booked) and the voice pending-request
      // check (metadata->>appointment_request=true, status not in
      // cancelled/lost). Both are HEAD counts, so the filters are
      // applied properly rather than guessed at.
      const params = new URL(url).searchParams;
      const matching = leadRows.filter((row) => {
        for (const [key, raw] of params.entries()) {
          if (["select", "order", "limit", "offset"].includes(key)) continue;
          const value = key === "metadata->>appointment_request"
            ? row.metadata?.appointment_request === true
              ? "true"
              : undefined
            : row[key];

          // Timestamps must compare as instants, not as strings:
          // "…T14:00:00.000Z" and "…T14:00:00+00:00" are the same
          // moment but sort differently as text.
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
          const v = String(value ?? "");

          if (raw.startsWith("eq.")) {
            if (v !== raw.slice(3)) return false;
          } else if (raw.startsWith("neq.")) {
            if (v === raw.slice(4)) return false;
          } else if (raw.startsWith("not.in.")) {
            const excluded = raw
              .slice(7)
              .replace(/^\(|\)$/g, "")
              .split(",");
            if (excluded.includes(v)) return false;
          } else if (raw.startsWith("gte.")) {
            if (!(cmp(v, raw.slice(4)) >= 0)) return false;
          } else if (raw.startsWith("lte.")) {
            if (!(cmp(v, raw.slice(4)) <= 0)) return false;
            // gt/lt carry the OVERLAP window's strict bounds — without
            // them the range filter is silently dropped and every row
            // matches, which would make these tests prove nothing.
          } else if (raw.startsWith("gt.")) {
            if (!(cmp(v, raw.slice(3)) > 0)) return false;
          } else if (raw.startsWith("lt.")) {
            if (!(cmp(v, raw.slice(3)) < 0)) return false;
          } else {
            throw new Error(`Unsupported filter in test stub: ${key}=${raw}`);
          }
        }
        return true;
      });

      // HEAD is a count (both capacity checks); GET is the held-slot
      // range read the alternatives search uses.
      if (method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-range": `*/${matching.length}` },
        });
      }
      return json(
        matching.map((row) => ({
          appointment_datetime: row.appointment_datetime,
        }))
      );
    }

    if (url.includes("/rest/v1/integration_connections")) {
      return wantsObject ? json(null) : json([]);
    }

    throw new Error(`Unstubbed fetch in test: ${method} ${url}`);
  };

  return {
    writes,
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

async function callTool(body) {
  const res = await handleVoiceWebhookPost(request(body));
  return { status: res.status, json: await res.json() };
}

describe("the tool reaches Vapi", () => {
  test("it is registered alongside endCall, with our server URL", () => {
    const tools = assistantFor().model.tools;
    const availability = tools.find((t) => t.type === "function");
    assert.ok(availability, "a function tool must be present");
    assert.equal(availability.function.name, VOICE_AVAILABILITY_TOOL_NAME);
    assert.equal(availability.server.url, SERVER_URL);
    assert.deepEqual(availability.function.parameters.required, ["date", "time"]);
    // I — endCall is untouched and still present.
    assert.ok(tools.some((t) => t.type === "endCall"));
    assert.equal(tools.length, 2);
  });

  test("without a server URL only endCall is sent — a tool with nowhere to ask is worse than none", () => {
    const tools = assistantFor(null).model.tools;
    assert.deepEqual(tools, [{ type: "endCall" }]);
  });

  test("the tool-calls message is parsed, in both documented shapes", () => {
    const list = parseVapiWebhook(toolCallBody());
    assert.equal(list.kind, "tool-call");
    assert.deepEqual(list.calls[0], {
      id: "call_abc123",
      name: VOICE_AVAILABILITY_TOOL_NAME,
      args: WEDNESDAY,
    });

    // OpenAI-style nesting, with arguments as a JSON string.
    const nested = parseVapiWebhook({
      message: {
        type: "tool-calls",
        phoneNumber: { number: BUSINESS },
        toolCalls: [
          {
            id: "call_xyz",
            function: {
              name: VOICE_AVAILABILITY_TOOL_NAME,
              arguments: JSON.stringify(WEDNESDAY),
            },
          },
        ],
      },
    });
    assert.equal(nested.kind, "tool-call");
    assert.deepEqual(nested.calls[0].args, WEDNESDAY);
  });
});

describe("A — the requested slot is free", () => {
  let stubs;
  beforeEach(() => {
    stubs = installStubs();
  });
  afterEach(() => stubs.restore());

  test("it is reported available, in Vapi's results shape", async () => {
    const { status, json } = await callTool(toolCallBody());
    assert.equal(status, 200);
    assert.equal(json.results.length, 1);
    assert.equal(json.results[0].toolCallId, "call_abc123");
    assert.match(json.results[0].result, /^AVAILABLE:/);
    assert.match(json.results[0].result, /3:00 pm|3:00 PM/i);
  });

  test("H — and nothing whatsoever was written", async () => {
    await callTool(toolCallBody());
    assert.deepEqual(stubs.writes, [], "availability lookup must not write");
  });

  test("it never tells the caller the slot is booked or reserved", async () => {
    const { json } = await callTool(toolCallBody());
    const result = json.results[0].result;
    assert.match(result, /Do NOT say it is booked, confirmed or reserved/);
    assert.doesNotMatch(result, /I have reserved|is booked for you/i);
  });
});

describe("B — the requested slot is taken", () => {
  let stubs;
  // 15:00 Europe/London in August is 14:00Z.
  beforeEach(() => {
    stubs = installStubs({ bookedAt: ["2026-08-12T14:00:00.000Z"] });
  });
  afterEach(() => stubs.restore());

  test("it is refused, and only engine-supplied alternatives are offered", async () => {
    const { json } = await callTool(toolCallBody());
    const result = json.results[0].result;
    assert.match(result, /^NOT AVAILABLE:/);
    assert.match(result, /Offer ONLY these and let the caller choose/);
    // Whatever times appear came from findNextAvailableSlot, not from us.
    assert.match(result, /These ARE free: /);
  });

  test("H — still zero writes on the unavailable path", async () => {
    await callTool(toolCallBody());
    assert.deepEqual(stubs.writes, []);
  });
});

describe("D — a changed mind is a fresh lookup", () => {
  let stubs;
  beforeEach(() => {
    stubs = installStubs({ bookedAt: ["2026-08-12T14:00:00.000Z"] });
  });
  afterEach(() => stubs.restore());

  test("Thursday is checked on its own merits, not Wednesday's answer", async () => {
    const wednesday = await callTool(toolCallBody(WEDNESDAY));
    assert.match(wednesday.json.results[0].result, /^NOT AVAILABLE:/);

    // Thursday morning — a different instant, nothing booked.
    const thursday = await callTool(
      toolCallBody({ date: "2026-08-13", time: "10:00" })
    );
    assert.match(thursday.json.results[0].result, /^AVAILABLE:/);
    assert.match(thursday.json.results[0].result, /Thursday 13 August/);
  });
});

describe("F/G — failure never invents availability", () => {
  let stubs;
  afterEach(() => stubs.restore());

  test("a database failure produces UNKNOWN, not a slot", async () => {
    stubs = installStubs({ hoursFail: true });
    const { status, json } = await callTool(toolCallBody());
    assert.equal(status, 200, "the call must continue normally");
    const result = json.results[0].result;
    assert.match(result, /AVAILABILITY UNKNOWN/);
    assert.match(result, /Do NOT say the time is available and do NOT offer any time/);
    assert.match(result, /take their preferred time/);
  });

  test("a malformed date produces UNKNOWN rather than a guess", async () => {
    stubs = installStubs();
    const { json } = await callTool(
      toolCallBody({ date: "next Wednesday", time: "afternoon" })
    );
    assert.match(json.results[0].result, /AVAILABILITY UNKNOWN/);
    assert.deepEqual(stubs.writes, []);
  });

  test("missing arguments produce UNKNOWN", async () => {
    stubs = installStubs();
    const { json } = await callTool(toolCallBody({}));
    assert.match(json.results[0].result, /AVAILABILITY UNKNOWN/);
  });

  test("an unknown tool name is answered safely, never guessed at", async () => {
    stubs = installStubs();
    const { json } = await callTool(toolCallBody(WEDNESDAY, "book_appointment"));
    assert.match(json.results[0].result, /AVAILABILITY UNKNOWN/);
    assert.deepEqual(stubs.writes, [], "an unrecognised tool must never act");
  });

  test("G — no calendar configured still answers from internal availability", async () => {
    // integration_connections returns nothing, so getOrgBusyIntervals
    // reports not_connected and the engine falls back to hours+capacity
    // exactly as production does today.
    stubs = installStubs();
    const { json } = await callTool(toolCallBody());
    assert.match(json.results[0].result, /^AVAILABLE:/);
    assert.deepEqual(stubs.writes, []);
  });
});

describe("a pending appointment request holds the slot", () => {
  // The 2026-08-06 production pair: two callers, same slot, both told
  // it was available. The first call created a REQUEST awaiting the
  // business, and the shared capacity check counts confirmed bookings
  // only — so the slot still looked free.
  const WED_3PM = "2026-08-12T14:00:00.000Z"; // 15:00 Europe/London (BST)
  let stubs;
  afterEach(() => stubs.restore());

  test("the second lookup for the same slot is refused", async () => {
    stubs = installStubs({ leads: [requestLead(WED_3PM)] });
    const { json } = await callTool(toolCallBody());
    assert.match(json.results[0].result, /^NOT AVAILABLE:/);
    assert.deepEqual(stubs.writes, [], "still read-only");
  });

  test("a different time on the same day stays available", async () => {
    stubs = installStubs({ leads: [requestLead(WED_3PM)] });
    const { json } = await callTool(
      toolCallBody({ date: "2026-08-12", time: "11:00" })
    );
    assert.match(json.results[0].result, /^AVAILABLE:/);
  });

  // 2026-08-08: the held-slot check was itself an exact-timestamp match
  // (`.eq("appointment_datetime", …)`), so voice carried the very
  // double-booking hole the shared engine had. A request at 15:00 left
  // 15:30 lookable and offerable.
  test("a request at 15:00 also holds 15:30 — overlap, not equality", async () => {
    stubs = installStubs({ leads: [requestLead(WED_3PM)] });
    const { json } = await callTool(
      toolCallBody({ date: "2026-08-12", time: "15:30" })
    );
    assert.match(json.results[0].result, /^NOT AVAILABLE:/);
  });

  test("it holds 14:30 too — the overlap reaches backwards", async () => {
    stubs = installStubs({ leads: [requestLead(WED_3PM)] });
    const { json } = await callTool(
      toolCallBody({ date: "2026-08-12", time: "14:30" })
    );
    assert.match(json.results[0].result, /^NOT AVAILABLE:/);
  });

  test("back-to-back is still offerable, after and before", async () => {
    // 16:00 starts exactly as the 15:00 request ends, and 14:00 ends
    // exactly as it begins. Neither shares a minute with it.
    stubs = installStubs({ leads: [requestLead(WED_3PM)] });
    const after = await callTool(
      toolCallBody({ date: "2026-08-12", time: "16:00" })
    );
    assert.match(after.json.results[0].result, /^AVAILABLE:/);

    stubs.restore();
    stubs = installStubs({ leads: [requestLead(WED_3PM)] });
    const before = await callTool(
      toolCallBody({ date: "2026-08-12", time: "14:00" })
    );
    assert.match(before.json.results[0].result, /^AVAILABLE:/);
  });

  test("an overlapping request is never OFFERED as an alternative either", async () => {
    // The alternatives search reads held slots as a range; it must apply
    // the same overlap rule, or a refused 15:00 could be answered with
    // a 15:30 that is equally spoken for.
    stubs = installStubs({ leads: [requestLead(WED_3PM)] });
    const { json } = await callTool(toolCallBody());
    const result = json.results[0].result;
    assert.match(result, /^NOT AVAILABLE:/);
    assert.doesNotMatch(result, /3:30 pm|15:30/i);
  });

  test("an unreadable held-slot list never invents availability", async () => {
    // Fails CLOSED, matching the shared engine: the answer is UNKNOWN,
    // and the call falls back to taking a preferred time.
    stubs = installStubs({ leadsFail: true });
    const { json } = await callTool(toolCallBody());
    assert.doesNotMatch(json.results[0].result, /^AVAILABLE:/);
  });

  test("cancelled and lost requests release the slot", async () => {
    for (const status of ["cancelled", "lost"]) {
      stubs = installStubs({ leads: [requestLead(WED_3PM, status)] });
      const { json } = await callTool(toolCallBody());
      assert.match(
        json.results[0].result,
        /^AVAILABLE:/,
        `${status} must not hold capacity`
      );
      stubs.restore();
    }
    stubs = installStubs();
  });

  test("every live status still holds it", async () => {
    for (const status of [
      "new",
      "awaiting_confirmation",
      "contacted",
      "qualified",
      "needs_review",
      "booked",
    ]) {
      stubs = installStubs({ leads: [requestLead(WED_3PM, status)] });
      const { json } = await callTool(toolCallBody());
      assert.match(
        json.results[0].result,
        /^NOT AVAILABLE:/,
        `${status} must hold capacity`
      );
      stubs.restore();
    }
    stubs = installStubs();
  });

  test("a confirmed booking still blocks, exactly as before", async () => {
    stubs = installStubs({ bookedAt: [WED_3PM] });
    const { json } = await callTool(toolCallBody());
    assert.match(json.results[0].result, /^NOT AVAILABLE:/);
  });

  test("an UNMARKED lead at the same instant does not block", async () => {
    // A chat or widget lead, or any ordinary enquiry: it may carry an
    // appointment_datetime, but without the marker it is not a phone
    // appointment request and must not consume capacity.
    stubs = installStubs({
      leads: [
        {
          org_id: ORG_ID,
          appointment_datetime: WED_3PM,
          status: "new",
          metadata: {},
        },
      ],
    });
    const { json } = await callTool(toolCallBody());
    assert.match(json.results[0].result, /^AVAILABLE:/);
  });

  test("a callback lead does not block", async () => {
    // Callbacks carry callback_urgency, never appointment_request, and
    // typically no appointment_datetime at all.
    stubs = installStubs({
      leads: [
        {
          org_id: ORG_ID,
          appointment_datetime: WED_3PM,
          status: "needs_review",
          metadata: { callback_urgency: "as soon as possible" },
        },
      ],
    });
    const { json } = await callTool(toolCallBody());
    assert.match(json.results[0].result, /^AVAILABLE:/);
  });

  test("a general question lead does not block", async () => {
    stubs = installStubs({
      leads: [
        {
          org_id: ORG_ID,
          appointment_datetime: WED_3PM,
          status: "needs_review",
          metadata: { caller_id: "+353861234567" },
        },
      ],
    });
    const { json } = await callTool(toolCallBody());
    assert.match(json.results[0].result, /^AVAILABLE:/);
  });

  test("a request in the past holds nothing", async () => {
    // Same wall-clock slot, but in 2020 — long gone, so it cannot hold
    // capacity even though a marked row sits at that instant.
    const PAST = "2020-08-12T14:00:00.000Z";
    stubs = installStubs({ leads: [requestLead(PAST)] });
    const { json } = await callTool(
      toolCallBody({ date: "2020-08-12", time: "15:00" })
    );
    assert.doesNotMatch(
      json.results[0].result,
      /already held by a pending/,
      "a past slot is not held"
    );
  });
});

describe("alternatives are real slots, not minute increments", () => {
  // Live call, 2026-08-06: 3:00 PM was correctly refused, and Remy then
  // offered "3:01 PM or 3:02 PM". The cursor advanced by 60 SECONDS and
  // the resulting instant was offered whenever checkBookingSlot — which
  // evaluates any instant and knows nothing of a slot grid — accepted
  // it. Alternatives now come from findNextAvailableSlot, which steps by
  // the org's configured appointment_duration_minutes.
  const WED_3PM = "2026-08-12T14:00:00.000Z"; // 15:00 Europe/London
  const WED_4PM = "2026-08-12T15:00:00.000Z";
  let stubs;
  afterEach(() => stubs.restore());

  /** The clock times Remy would actually read out. */
  function offeredTimes(result) {
    const listed = /These ARE free: ([^.]+)\./.exec(result);
    return listed ? listed[1].split(", ").map((t) => t.trim()) : [];
  }

  test("3:01 PM and 3:02 PM are never offered", async () => {
    stubs = installStubs({ leads: [requestLead(WED_3PM)] });
    const { json } = await callTool(toolCallBody());
    const result = json.results[0].result;
    assert.match(result, /^NOT AVAILABLE:/);
    assert.doesNotMatch(result, /3:01/);
    assert.doesNotMatch(result, /3:02/);
  });

  test("they land on the configured 60-minute boundaries", async () => {
    stubs = installStubs({ leads: [requestLead(WED_3PM)] });
    const { json } = await callTool(toolCallBody());
    const times = offeredTimes(json.results[0].result);
    assert.ok(times.length > 0, "some alternative should be offered");
    for (const time of times) {
      assert.match(time, /:00 (am|pm)$/i, `${time} is not on a slot boundary`);
    }
    assert.equal(times[0], "4:00 pm", "the nearest whole slot after 3 PM");
  });

  test("a 30-minute org gets 30-minute boundaries — no rule is hardcoded", async () => {
    stubs = installStubs({
      leads: [requestLead(WED_3PM)],
      durationMinutes: 30,
    });
    const { json } = await callTool(toolCallBody());
    const times = offeredTimes(json.results[0].result);
    assert.equal(times[0], "3:30 pm", "the configured interval, not 60");
    for (const time of times) {
      assert.match(time, /:(00|30) (am|pm)$/i, `${time} is off the 30-min grid`);
    }
  });

  test("an occupied alternative is skipped, not offered", async () => {
    // 3 PM held by a request, 4 PM already booked — so neither may be
    // offered and the search has to walk past both.
    stubs = installStubs({
      leads: [requestLead(WED_3PM)],
      bookedAt: [WED_4PM],
    });
    const { json } = await callTool(toolCallBody());
    const times = offeredTimes(json.results[0].result);
    assert.ok(!times.includes("4:00 pm"), "a booked slot must not be offered");
    assert.ok(!times.includes("3:00 pm"), "the held slot must not be offered");
  });

  test("a pending request on an alternative is skipped too", async () => {
    stubs = installStubs({
      leads: [requestLead(WED_3PM), requestLead(WED_4PM)],
    });
    const { json } = await callTool(toolCallBody());
    const times = offeredTimes(json.results[0].result);
    assert.ok(
      !times.includes("4:00 pm"),
      "a slot another caller has requested must not be offered"
    );
  });

  test("alternatives stay inside business hours", async () => {
    // 4 PM held. 5 PM cannot fit a 60-minute appointment before the
    // 17:00 close, so the next real slot is the following morning.
    stubs = installStubs({ leads: [requestLead(WED_4PM)] });
    const { json } = await callTool(
      toolCallBody({ date: "2026-08-12", time: "16:00" })
    );
    const times = offeredTimes(json.results[0].result);
    assert.ok(!times.includes("5:00 pm"), "5 PM would run past closing");
    for (const time of times) {
      // Alternatives read either "4:00 pm" or "Thursday 13 August at
      // 9:00 am"; take the clock part of whichever form it is.
      const [, h, , ap] = /(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(time);
      const hour24 = (Number(h) % 12) + (/pm/i.test(ap) ? 12 : 0);
      assert.ok(hour24 >= 9 && hour24 < 17, `${time} is outside 09:00–17:00`);
    }
  });

  test("they are unique and in chronological order", async () => {
    stubs = installStubs({ leads: [requestLead(WED_3PM)] });
    const { json } = await callTool(toolCallBody());
    const times = offeredTimes(json.results[0].result);
    assert.equal(new Set(times).size, times.length, "no duplicates");
    // Ordering is asserted on the instants the engine returned, not on
    // the spoken clock times: the walk can cross midnight, where 4 pm
    // Wednesday legitimately precedes 9 am Thursday.
    const isos = json.results[0].alternativeIsos ?? [];
    if (isos.length > 1) {
      const stamps = isos.map((iso) => new Date(iso).getTime());
      assert.deepEqual(stamps, [...stamps].sort((a, b) => a - b));
    }
  });

  test("an alternative on another day says which day", async () => {
    // With 60-minute slots and a 17:00 close, the second alternative
    // after 3 PM falls on the following morning. "9:00 am" alone would
    // tell the caller nothing about which day.
    stubs = installStubs({ leads: [requestLead(WED_3PM)] });
    const { json } = await callTool(toolCallBody());
    const times = offeredTimes(json.results[0].result);
    const nextDay = times.filter((t) => !/^\d+:\d+ (am|pm)$/i.test(t));
    if (nextDay.length > 0) {
      assert.match(
        nextDay[0],
        /Thursday 13 August/,
        "a cross-day alternative must name its day"
      );
    }
    // Same-day alternatives stay as a bare clock time.
    assert.ok(times.some((t) => /^\d+:\d+ (am|pm)$/i.test(t)));
  });

  test("when nothing is free the safe fallback is used, never an invented slot", async () => {
    // Every slot in the search window is held.
    const everySlotHeld = [];
    for (let day = 12; day <= 26; day++) {
      for (let hour = 8; hour <= 16; hour++) {
        everySlotHeld.push(
          requestLead(
            `2026-08-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`
          )
        );
      }
    }
    stubs = installStubs({ leads: everySlotHeld });
    const { json } = await callTool(toolCallBody());
    const result = json.results[0].result;
    assert.match(result, /nothing else is free nearby/);
    assert.match(result, /Do NOT invent a time/);
    assert.deepEqual(stubs.writes, [], "still read-only");
  });
});

describe("E — callbacks never touch appointment availability", () => {
  test("the tool is scoped to appointments in its own description", () => {
    const availability = assistantFor().model.tools.find(
      (t) => t.type === "function"
    );
    assert.match(
      availability.function.description,
      /never for callback requests/i
    );
  });

  test("and the prompt says so too, pointing back at rule 13", () => {
    const prompt = buildVoiceAssistantConfig(
      {
        business_name: "Acme Plumbing",
        business_type: "plumber",
        primary_goal: "book jobs",
        description: null,
        website: null,
      },
      [],
      { greeting: null, voice_id: null, language: null },
      SERVER_URL,
      "+353861234567",
      new Date("2026-08-03T09:00:00+01:00")
    ).systemPrompt;
    assert.match(prompt, /Never call it for a callback \(rule 13\)/);
    // The callback window rule is untouched.
    assert.match(prompt, /enough for a CALLBACK — confirm the calendar date/);
  });
});
