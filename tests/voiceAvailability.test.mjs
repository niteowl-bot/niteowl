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

import { test, describe, beforeEach, afterEach } from "node:test";
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

// Wednesday 12 August 2026, 15:00 Europe/London (BST, +01:00).
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

function installStubs({ bookedAt = [], leads = [], hoursFail = false } = {}) {
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
        appointment_duration_minutes: 60,
        emergency_mode_enabled: false,
        max_concurrent_bookings: 1,
        timezone: "Europe/London",
      };
      return wantsObject ? json(row) : json([row]);
    }

    if (url.includes("/rest/v1/leads")) {
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

          if (raw.startsWith("eq.")) {
            if (String(value ?? "") !== raw.slice(3)) return false;
          } else if (raw.startsWith("not.in.")) {
            const excluded = raw
              .slice(7)
              .replace(/^\(|\)$/g, "")
              .split(",");
            if (excluded.includes(String(value ?? ""))) return false;
          }
        }
        return true;
      });
      return new Response(null, {
        status: 200,
        headers: { "content-range": `*/${matching.length}` },
      });
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
