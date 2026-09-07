// "Not urgent" and "we were not told" are different facts.
//
// `parseStructuredDetails` used to write `urgent: data.urgent === true`,
// which collapsed FOUR different situations into a single `false`:
//
//   an explicit `false`         the provider said the caller was not urgent
//   an omitted field            a partial payload simply did not mention it
//   a blank value               nothing usable arrived
//   a malformed value           "true", 1, "yes" — the schema asks for a
//                               boolean, but nothing enforces what comes back
//
// Nothing downstream could tell them apart, so nothing downstream could
// ever act on the difference. `VoiceExtractedDetails.urgent` is now
// `boolean | null` and the parser preserves all three states.
//
// THIS IS REPRESENTATION ONLY, AND DELIBERATELY BEHAVIOUR-NEUTRAL.
// Every consumer tests `=== true`, so `null` behaves exactly as the old
// `false` did — the second half of this file exists to prove that on the
// real path rather than assert it in a comment. Nothing here infers
// urgency from absence, reads the transcript, or recovers anything:
// recovering a caller's urgency from their own speech is a separate,
// deliberately DEFERRED piece of work and is NOT implemented.
//
// A malformed value is null rather than coerced, on purpose. Reading the
// string "true" as urgency would invent a provider statement that was
// never made — the same reason `asString` refuses blank text instead of
// treating it as content.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { parseVapiWebhook } from "@/lib/voice/vapi";
import { processCallEnded } from "@/lib/voice/calls";

const T = (...turns) => turns.join("\n");

/** Builds a REAL Vapi end-of-call payload and parses it for real. */
function parsedEvent(id, { transcript, structuredData } = {}) {
  const event = parseVapiWebhook({
    message: {
      type: "end-of-call-report",
      call: { id },
      customer: { number: "+353861234567" },
      phoneNumber: { number: "+353212345678" },
      startedAt: "2026-08-17T10:00:00.000Z",
      endedAt: "2026-08-17T10:05:00.000Z",
      durationSeconds: 300,
      endedReason: "customer-ended-call",
      transcript: transcript ?? URGENT_TRANSCRIPT,
      analysis: { summary: "Caller rang about a radiator.", structuredData },
    },
  });
  assert.ok(event, "the webhook parsed");
  return event;
}

/** An urgent caller who gave no day or time — the PR #35 shape. */
const URGENT_TRANSCRIPT = T(
  "AI: How can I help?",
  "User: My radiator is leaking and it's urgent.",
  "AI: When suits you best?",
  "User: I don't have a specific time. Just as soon as possible, please."
);

/** The same call, but the caller named a day — the PR #66 shape. */
const TIMED_TRANSCRIPT = T(
  "AI: How can I help?",
  "User: My radiator is leaking.",
  "AI: When suits you best?",
  "User: Thursday 20 August at 3 PM."
);

/** Enough sibling fields that the payload is substantive without urgency. */
const SIBLINGS = {
  intent: "new_booking",
  name: "Jason Test",
  service: "leaking radiator",
  service_address: "81 Oakland Drive",
};

// ── 1. The parser boundary — three states, preserved ───────────────

describe("the provider's urgency answer keeps its own identity", () => {
  const urgentFor = (structuredData) =>
    parsedEvent("p1", { structuredData }).extracted?.urgent;

  test("explicit true stays true", () => {
    assert.equal(urgentFor({ ...SIBLINGS, urgent: true }), true);
  });

  test("explicit false stays FALSE — the provider did answer", () => {
    assert.equal(urgentFor({ ...SIBLINGS, urgent: false }), false);
  });

  test("omitted is null — a partial payload said nothing", () => {
    assert.equal(urgentFor(SIBLINGS), null);
  });

  test("blank is null", () => {
    for (const blank of ["", "   "]) {
      assert.equal(urgentFor({ ...SIBLINGS, urgent: blank }), null, JSON.stringify(blank));
    }
  });

  test("an explicit JSON null is null", () => {
    assert.equal(urgentFor({ ...SIBLINGS, urgent: null }), null);
  });

  test("malformed values are null, never coerced", () => {
    // "true" and 1 are the dangerous ones: coercing either would invent
    // a provider statement that was never made.
    for (const malformed of ["true", "TRUE", "false", "yes", "no", 1, 0, {}, []]) {
      assert.equal(
        urgentFor({ ...SIBLINGS, urgent: malformed }),
        null,
        JSON.stringify(malformed)
      );
    }
  });

  test("false and null are now DISTINGUISHABLE, which is the whole point", () => {
    const stated = urgentFor({ ...SIBLINGS, urgent: false });
    const untold = urgentFor(SIBLINGS);
    assert.equal(stated, false);
    assert.equal(untold, null);
    assert.notEqual(stated, untold, "these were the same value before this change");
  });

  test("no other field's parsing is disturbed", () => {
    const e = parsedEvent("p2", { structuredData: { ...SIBLINGS, urgent: "yes" } })
      .extracted;
    assert.equal(e.intent, "new_booking");
    assert.equal(e.name, "Jason Test");
    assert.equal(e.service, "leaking radiator");
    assert.equal(e.service_address, "81 Oakland Drive");
  });
});

// ── 2. Emptiness — PR #58, unchanged ───────────────────────────────

describe("the empty-envelope rule is untouched (PR #58)", () => {
  const extractedFor = (structuredData) =>
    parsedEvent("p3", { structuredData }).extracted;

  test("urgent:true alone is still SUBSTANCE — the payload is not empty", () => {
    const e = extractedFor({ urgent: true });
    assert.ok(e, "a payload saying the caller is urgent is not nothing");
    assert.equal(e.urgent, true);
  });

  test("urgent:false alone is still empty, so the fallback still runs", () => {
    assert.equal(extractedFor({ urgent: false }), null);
  });

  test("urgent:null alone is empty", () => {
    assert.equal(extractedFor({ urgent: null }), null);
  });

  test("a malformed urgency alone is empty — it is not a supported field value", () => {
    assert.equal(extractedFor({ urgent: "true" }), null);
  });

  test("{} and an all-null payload are still empty", () => {
    assert.equal(extractedFor({}), null);
    assert.equal(
      extractedFor({
        intent: null,
        name: null,
        email: null,
        phone: null,
        service: null,
        preferred_datetime: null,
        service_address: null,
        urgent: null,
      }),
      null
    );
  });

  test("a substantive sibling still carries a payload whose urgency is null", () => {
    const e = extractedFor({ name: "Jason Test" });
    assert.ok(e, "a name is substance");
    assert.equal(e.urgent, null, "and the untold urgency is recorded as untold");
  });
});

// ── 3. The real path — null behaves exactly as false always did ────

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const APPOINTMENT_ISO = "2026-08-20T14:00:00.000Z";

function installStubs() {
  process.env.VOICE_CALENDAR_BOOKING_ENABLED = "true";

  const realFetch = globalThis.fetch;
  const leads = new Map();
  const emails = [];
  const extractionPrompts = [];
  let seq = 0;

  const json = (b, s = 200) =>
    new Response(JSON.stringify(b), {
      status: s,
      headers: { "content-type": "application/json" },
    });

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    const h = new Headers(init.headers ?? {});
    const obj = (h.get("accept") ?? "").includes("pgrst.object");
    const body = init.body ? JSON.parse(init.body) : {};
    const q = new URL(url, "https://stub.supabase.co").searchParams;
    const eqOf = (k) => (q.get(k) ?? "").replace(/^eq\./, "");

    if (url.includes("api.resend.com")) {
      emails.push(body);
      return json({ id: "e1" });
    }
    if (url.includes("api.openai.com")) {
      const prompt = body?.messages?.[0]?.content ?? "";
      if (prompt.includes("## Required JSON shape")) {
        extractionPrompts.push(prompt);
        throw new Error("the fallback extractor must not run for a partial payload");
      }
      if (/ISO|datetime|date and time/i.test(prompt)) {
        return json({ choices: [{ message: { content: APPOINTMENT_ISO } }] });
      }
      throw new Error("Unexpected OpenAI prompt in test");
    }
    if (url.includes("/rest/v1/voice_calls")) {
      const r = { id: "call-row-1" };
      return obj ? json(r) : json([r]);
    }
    if (url.includes("/rest/v1/business_knowledge")) {
      return json([
        {
          id: "k1",
          category: "services",
          title: "Radiator repair",
          content: "We repair leaking radiators and boilers.",
        },
      ]);
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
      const r = {
        id: ORG_ID,
        owner_id: "22222222-2222-4222-8222-222222222222",
        business_name: "Acme Plumbing",
        notification_email: "owner@example.com",
        appointment_duration_minutes: 60,
        emergency_mode_enabled: false,
        max_concurrent_bookings: 5,
        timezone: "Europe/London",
      };
      return obj ? json(r) : json([r]);
    }
    if (url.includes("/rest/v1/conversations")) return obj ? json(null) : json([]);
    if (url.includes("/rest/v1/integration_connections")) {
      return obj ? json(null) : json([]);
    }
    if (url.includes("/rest/v1/leads")) {
      if (method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-range": "*/0" },
        });
      }
      if (method === "POST") {
        const id = `lead-${++seq}`;
        leads.set(id, { id, metadata: null, appointment_datetime: null, ...body });
        return obj ? json({ id }) : json([{ id }]);
      }
      if (method === "PATCH") {
        const row = leads.get(eqOf("id"));
        if (row) Object.assign(row, body);
        return json([]);
      }
      if (q.has("id")) {
        const row = leads.get(eqOf("id")) ?? null;
        return obj ? json(row) : json(row ? [row] : []);
      }
      return obj ? json(null) : json([]);
    }
    if (url.includes("/rest/v1/voice_events")) return json([{ id: "evt-1" }]);
    throw new Error(`Unstubbed fetch in test: ${method} ${url}`);
  };

  return {
    leads,
    extractionPrompts,
    only() {
      const rows = [...leads.values()];
      assert.equal(rows.length, 1, "expected exactly one lead row");
      return rows[0];
    },
    ownerHtml() {
      const sent = emails.find((e) => String(e.html ?? "").includes("Caller ID"));
      return String(sent?.html ?? "");
    },
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

function detailsRow(html, label) {
  const m = html.match(new RegExp(`<td[^>]*>${label}</td><td[^>]*>([^<]*)</td>`));
  return m ? m[1] : null;
}

async function admin() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

describe("only `=== true` produces urgency behaviour, exactly as before", () => {
  let stubs;
  afterEach(() => stubs?.restore());

  async function run(id, structuredData, transcript = URGENT_TRANSCRIPT) {
    stubs = installStubs();
    await processCallEnded(
      await admin(),
      ORG_ID,
      parsedEvent(id, { structuredData, transcript })
    );
    const lead = stubs.only();
    return {
      lead,
      urgencyRow: detailsRow(stubs.ownerHtml(), "Callback urgency"),
      storedUrgency: lead.metadata?.callback_urgency ?? null,
      restore: stubs.restore,
    };
  }

  test("true still produces the urgency row and the stored value", async () => {
    const { urgencyRow, storedUrgency } = await run(
      "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      { ...SIBLINGS, urgent: true }
    );
    assert.equal(urgencyRow, "Urgent — no specific day or time given");
    assert.equal(storedUrgency, "Urgent — no specific day or time given");
  });

  test("false produces none", async () => {
    const { urgencyRow, storedUrgency } = await run(
      "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
      { ...SIBLINGS, urgent: false }
    );
    assert.equal(urgencyRow, null);
    assert.equal(storedUrgency, null);
  });

  test("NULL produces none — identical to the old false, no inference", async () => {
    // The transcript plainly says "it's urgent". Nothing reads it, and
    // nothing should: transcript recovery is deferred and NOT part of
    // this change.
    const { urgencyRow, storedUrgency } = await run(
      "cccccccc-3333-4333-8333-cccccccccccc",
      SIBLINGS
    );
    assert.equal(urgencyRow, null, "absence is not urgency");
    assert.equal(storedUrgency, null);
  });

  test("a malformed value produces none, and is not coerced to urgent", async () => {
    const { urgencyRow } = await run("dddddddd-4444-4444-8444-dddddddddddd", {
      ...SIBLINGS,
      urgent: "true",
    });
    assert.equal(urgencyRow, null, "the string \"true\" is not a provider statement");
  });

  test("false and null are indistinguishable to CONSUMERS, which is the neutrality claim", async () => {
    const stated = await run("eeeeeeee-5555-4555-8555-eeeeeeeeeeee", {
      ...SIBLINGS,
      urgent: false,
    });
    stated.restore();
    const untold = await run("ffffffff-6666-4666-8666-ffffffffffff", SIBLINGS);

    assert.equal(untold.urgencyRow, stated.urgencyRow);
    assert.equal(untold.storedUrgency, stated.storedUrgency);
    assert.equal(untold.lead.status, stated.lead.status, "same status");
    assert.equal(
      untold.lead.appointment_datetime,
      stated.lead.appointment_datetime,
      "same booking outcome"
    );
  });

  test("a real timing still suppresses the urgency row (PR #35), for every state", async () => {
    for (const [i, urgent] of [true, false, undefined].entries()) {
      const payload = { ...SIBLINGS };
      if (urgent !== undefined) payload.urgent = urgent;
      const r = await run(
        `1111111${i}-7777-4777-8777-11111111111${i}`,
        payload,
        TIMED_TRANSCRIPT
      );
      assert.equal(
        r.lead.preferred_datetime,
        "Thursday 20 August at 3 PM",
        "PR #66 recovery still works"
      );
      assert.equal(r.urgencyRow, null, `no urgency row when a time was given (${urgent})`);
      r.restore();
    }
  });

  test("no lead is lost: a substantive payload still creates one in every state", async () => {
    for (const [i, urgent] of [true, false, null, "yes"].entries()) {
      const r = await run(
        `2222222${i}-8888-4888-8888-22222222222${i}`,
        { ...SIBLINGS, urgent },
        URGENT_TRANSCRIPT
      );
      assert.ok(r.lead.id, `a lead exists (${JSON.stringify(urgent)})`);
      assert.equal(r.lead.service_needed, "leaking radiator");
      r.restore();
    }
  });
});
