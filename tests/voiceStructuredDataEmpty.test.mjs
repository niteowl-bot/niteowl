// An EMPTY provider envelope is not an answer.
//
// `parseStructuredDetails` used to return a fully-formed all-null object
// for any non-array object, `{}` included. `calls.ts` selects the
// transcript fallback with `if (!details)` — object EXISTENCE, not
// usefulness — so a syntactically valid but semantically empty payload
// suppressed the fallback entirely. On a call whose transcript held the
// caller's email, service, requested time and urgency, all four were
// recorded as absent, and `extracted.service` being null also closed the
// booking gate.
//
// `{}` is not an exotic shape. The schema we send declares no `required`
// fields and types every field as a plain string, so a model with
// nothing to report must omit each one — `{}` is that schema's own
// correct way to say "nothing".
//
// Only `name` and `service_address` survived, because `resolveCallerName`
// and `resolveServiceAddress` read the transcript as evidence in their
// own right. `normaliseSpokenEmail`, `resolveRequestedService` and
// `sanitisePreferredDatetime` are null-in/null-out and cannot.
//
// WHAT THIS FIX IS, AND IS NOT. It decides only WHETHER the fallback
// producer runs. It does NOT merge the two producers: a partially
// populated object stays substantive, stays authoritative, and still
// skips the fallback. Field-by-field completion is a separate
// architectural question, and test D below pins that boundary so a
// later change cannot drift across it by accident.
//
// F5 is untouched. When the corrected behaviour lets the fallback run,
// its service still passes `resolveRequestedService` at the same
// convergence point — test E proves an ungrounded paraphrase still
// cannot book.
//
// THESE TESTS DRIVE THE REAL BOUNDARY. The investigation found 15 test
// files that set `extracted:` directly on a hand-built event, starting
// AFTER the parser has run — which is exactly why this defect survived
// F5 and PR #56 invisibly. Everything here goes through the real
// `parseVapiWebhook`.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { parseVapiWebhook } from "@/lib/voice/vapi";
import { processCallEnded } from "@/lib/voice/calls";

const T = (...turns) => turns.join("\n");

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const APPOINTMENT_ISO = "2026-08-20T14:00:00.000Z";

// Everything a caller can supply, said plainly by the caller.
const RICH_TRANSCRIPT = T(
  "AI: How can I help?",
  "User: My radiator is leaking, and it's urgent.",
  "AI: Can I take your name?",
  "User: Jason Test.",
  "AI: And your email?",
  "User: jason test at gmail dot com.",
  "AI: What's the address?",
  "User: 81 Oakland Drive.",
  "AI: When suits?",
  "User: Thursday 20 August at 3 PM."
);

/** What a compliant fallback extractor returns from that transcript. */
const FALLBACK_JSON = JSON.stringify({
  intent: "new_booking",
  name: "Jason Test",
  email: "jasontest@gmail.com",
  phone: null,
  service: "leaking radiator",
  preferred_datetime: "Thursday 20 August at 3 PM",
  service_address: "81 Oakland Drive",
  urgent: true,
});

/** Builds a REAL Vapi end-of-call payload and parses it for real. */
function parsedEvent(id, { transcript = RICH_TRANSCRIPT, analysis } = {}) {
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
      transcript,
      analysis: { summary: "Caller rang about a radiator.", ...analysis },
    },
  });
  assert.ok(event, "the webhook parsed");
  return event;
}

// ── The parser boundary ────────────────────────────────────────────

describe("an empty provider envelope parses as no structured data", () => {
  const extractedFor = (analysis) => parsedEvent("p1", { analysis }).extracted;

  test("1. the structuredData property is absent", () => {
    assert.equal(extractedFor({}), null);
  });

  test("2. structuredData is null", () => {
    assert.equal(extractedFor({ structuredData: null }), null);
  });

  test("3. structuredData is {} — the shape this fix exists for", () => {
    assert.equal(extractedFor({ structuredData: {} }), null);
  });

  test("4. every supported field explicitly null", () => {
    assert.equal(
      extractedFor({
        structuredData: {
          intent: null,
          name: null,
          email: null,
          phone: null,
          service: null,
          preferred_datetime: null,
          service_address: null,
          urgent: null,
        },
      }),
      null
    );
  });

  test("5. empty and whitespace strings normalise away to nothing", () => {
    assert.equal(
      extractedFor({
        structuredData: {
          intent: "",
          name: "   ",
          email: "",
          phone: "\t",
          service: "",
          preferred_datetime: " ",
          service_address: "",
          urgent: false,
        },
      }),
      null
    );
  });

  test("B. all-null and all-empty collapse to the SAME result", () => {
    const allNull = extractedFor({
      structuredData: { name: null, service: null, urgent: false },
    });
    const allEmpty = extractedFor({
      structuredData: { name: "", service: "   ", urgent: false },
    });
    const empty = extractedFor({ structuredData: {} });
    assert.equal(allNull, null);
    assert.equal(allEmpty, allNull);
    assert.equal(empty, allNull);
  });

  test("6. urgent:true ALONE is substantive and is never collapsed", () => {
    // Losing this would be the PR #35 failure again: the caller told us
    // how urgent they are, and that is a real fact on its own.
    const e = extractedFor({ structuredData: { urgent: true } });
    assert.ok(e, "urgent:true alone must NOT parse as empty");
    assert.equal(e.urgent, true, "and the urgency itself survives");
    assert.equal(e.name, null, "with nothing invented alongside it");
    assert.equal(e.service, null);
  });

  test("7. a genuinely partial object stays substantive, values intact", () => {
    const e = extractedFor({
      structuredData: { name: "Jason Test", service: "leaking radiator" },
    });
    assert.ok(e);
    assert.equal(e.name, "Jason Test");
    assert.equal(e.service, "leaking radiator");
    assert.equal(e.email, null, "absent fields stay absent — nothing is filled in");
    assert.equal(e.preferred_datetime, null);
  });

  test("8. a fully populated object is unchanged", () => {
    const e = extractedFor({
      structuredData: {
        intent: "new_booking",
        name: "Jason Test",
        email: "jasontest@gmail.com",
        phone: null,
        service: "leaking radiator",
        preferred_datetime: "Thursday 20 August at 3 PM",
        service_address: "81 Oakland Drive",
        urgent: true,
      },
    });
    assert.deepEqual(e, {
      intent: "new_booking",
      name: "Jason Test",
      email: "jasontest@gmail.com",
      phone: null,
      service: "leaking radiator",
      preferred_datetime: "Thursday 20 August at 3 PM",
      service_address: "81 Oakland Drive",
      urgent: true,
    });
  });

  test("9. malformed non-object shapes keep their existing safe behaviour", () => {
    for (const structuredData of ["not an object", 42, ["a"], true]) {
      assert.equal(extractedFor({ structuredData }), null, String(structuredData));
    }
  });
});

// ── The real pipeline ──────────────────────────────────────────────

function installStubs({ extractionJson = FALLBACK_JSON, knowledge } = {}) {
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
    // The transcript fallback extractor and the datetime parser both go
    // to OpenAI. Discriminate on the prompt and refuse anything else, so
    // a third caller cannot be served the wrong answer silently.
    if (url.includes("api.openai.com")) {
      const prompt = body?.messages?.[0]?.content ?? "";
      if (prompt.includes("## Required JSON shape")) {
        extractionPrompts.push(prompt);
        return json({ choices: [{ message: { content: extractionJson } }] });
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
      return json(
        knowledge ?? [
          {
            id: "k1",
            category: "services",
            title: "Radiator repair",
            content: "We repair leaking radiators and boilers.",
          },
        ]
      );
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
        return new Response(null, { status: 200, headers: { "content-range": "*/0" } });
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
    emails,
    extractionPrompts,
    all() {
      return [...leads.values()];
    },
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

describe("an empty envelope no longer costs the caller's information", () => {
  let stubs;
  afterEach(() => stubs?.restore());

  test("A. structuredData {} — the fallback runs and the facts survive", async () => {
    stubs = installStubs();
    await processCallEnded(
      await admin(),
      ORG_ID,
      parsedEvent("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", {
        analysis: { structuredData: {} },
      })
    );

    assert.equal(
      stubs.extractionPrompts.length,
      1,
      "the transcript fallback ran exactly once"
    );

    const lead = stubs.only();
    // The four fields that were silently lost before this fix.
    assert.equal(lead.email, "jasontest@gmail.com", "email recovered");
    assert.equal(lead.service_needed, "leaking radiator", "service recovered");
    assert.equal(
      lead.preferred_datetime,
      "Thursday 20 August at 3 PM",
      "requested time recovered"
    );
    assert.equal(lead.metadata?.callback_urgency ?? null, null);
    // The two that already survived, unchanged.
    assert.equal(lead.name, "Jason Test");
    assert.equal(lead.metadata?.service_address, "81 Oakland Drive");
  });

  test("A2. the owner reads the recovered service from the canonical row", async () => {
    stubs = installStubs();
    await processCallEnded(
      await admin(),
      ORG_ID,
      parsedEvent("bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", {
        analysis: { structuredData: {} },
      })
    );

    const stored = stubs.only().service_needed;
    assert.equal(stored, "leaking radiator");
    assert.equal(
      detailsRow(stubs.ownerHtml(), "Service needed"),
      stored,
      "the owner reads exactly what the lead carries"
    );
    assert.equal(detailsRow(stubs.ownerHtml(), "Email"), "jasontest@gmail.com");
  });

  test("A3. urgency reaches the owner instead of being lost with the envelope", async () => {
    // The caller said "it's urgent" and gave no usable time. Before the
    // fix the empty envelope meant urgent:false and no urgency at all.
    stubs = installStubs({
      extractionJson: JSON.stringify({
        intent: "question",
        name: "Jason Test",
        email: null,
        phone: null,
        service: null,
        preferred_datetime: null,
        service_address: null,
        urgent: true,
      }),
    });
    await processCallEnded(
      await admin(),
      ORG_ID,
      parsedEvent("cccccccc-3333-4333-8333-cccccccccccc", {
        analysis: { structuredData: {} },
      })
    );

    assert.equal(stubs.extractionPrompts.length, 1);
    assert.ok(
      stubs.only().metadata?.callback_urgency,
      "the caller's urgency survived the corrected path"
    );
  });

  test("C. fully populated structuredData — the fallback is NOT consulted", async () => {
    stubs = installStubs();
    await processCallEnded(
      await admin(),
      ORG_ID,
      parsedEvent("dddddddd-4444-4444-8444-dddddddddddd", {
        analysis: {
          structuredData: {
            intent: "new_booking",
            name: "Jason Test",
            email: "jasontest@gmail.com",
            phone: null,
            service: "leaking radiator",
            preferred_datetime: "Thursday 20 August at 3 PM",
            service_address: "81 Oakland Drive",
            urgent: false,
          },
        },
      })
    );

    assert.equal(
      stubs.extractionPrompts.length,
      0,
      "structuredData was substantive, so the extractor never ran"
    );
    assert.equal(stubs.only().service_needed, "leaking radiator");
    assert.equal(stubs.only().email, "jasontest@gmail.com");
  });

  test("D. PARTIAL structuredData does not RE-RUN THE EXTRACTOR to fill gaps", async () => {
    // The scope boundary of PR #58, still pinned — but its email
    // expectation is superseded and updated rather than deleted.
    //
    // What PR #58 forbids is a SECOND INDEPENDENT READING of the call:
    // running the fallback extractor to complete fields would put two
    // model outputs in play and merge them, which is the pattern the
    // canonical-information architecture exists to remove. That rule is
    // unchanged and is what the first assertion below pins — the
    // extractor is still never invoked for a substantive payload.
    //
    // `email` is now recovered by a DETERMINISTIC guard reading the
    // caller's own turns (emailIntegrity.ts), which is the same
    // mechanism resolveCallerName and resolveServiceAddress have always
    // used on this very path — neither of those was ever considered a
    // breach of this boundary. No model runs, and nothing is merged.
    //
    // The transcript here carries "AI: And your email?" answered by
    // "User: jason test at gmail dot com", so the recovered value is
    // the caller's own — and it is exactly what the fallback extractor
    // would have produced, which is corroboration rather than a second
    // opinion.
    //
    // `preferred_datetime` is still NOT completed: that field has no
    // deterministic guard, and giving it one is a separate task.
    stubs = installStubs();
    await processCallEnded(
      await admin(),
      ORG_ID,
      parsedEvent("eeeeeeee-5555-4555-8555-eeeeeeeeeeee", {
        analysis: {
          structuredData: { name: "Jason Test", service: "leaking radiator" },
        },
      })
    );

    assert.equal(
      stubs.extractionPrompts.length,
      0,
      "a partial object is substantive, so the fallback stays out of it"
    );
    const lead = stubs.only();
    assert.equal(lead.service_needed, "leaking radiator", "what it gave is kept");
    assert.equal(
      lead.email,
      "jasontest@gmail.com",
      "the omitted email is recovered from the caller's own turn — deterministically, with no extractor"
    );
    assert.equal(
      lead.preferred_datetime,
      null,
      "a field with no deterministic guard is still NOT completed"
    );
  });

  test("E. F5 still refuses an ungrounded fallback service — no booking", async () => {
    // The corrected path restores lost evidence. It must not become a
    // way in for wording the caller never used.
    stubs = installStubs({
      extractionJson: JSON.stringify({
        intent: "new_booking",
        name: "Jason Test",
        email: "jasontest@gmail.com",
        phone: null,
        service: "Boiler repair",
        preferred_datetime: "Thursday 20 August at 3 PM",
        service_address: "81 Oakland Drive",
        urgent: false,
      }),
    });
    await processCallEnded(
      await admin(),
      ORG_ID,
      parsedEvent("ffffffff-6666-4666-8666-ffffffffffff", {
        analysis: { structuredData: {} },
      })
    );

    assert.equal(stubs.extractionPrompts.length, 1, "the fallback did run");
    const lead = stubs.only();
    assert.equal(
      lead.service_needed,
      null,
      "the caller said radiator, never boiler or repair"
    );
    assert.notEqual(lead.status, "booked", "an ungrounded service cannot book");
    assert.equal(
      detailsRow(stubs.ownerHtml(), "Service needed"),
      null,
      "and absence is rendered as absence, never as the refused label"
    );
  });

  test("F. a failing fallback still invents nothing", async () => {
    stubs = installStubs({ extractionJson: "NONE" });
    await processCallEnded(
      await admin(),
      ORG_ID,
      parsedEvent("99999999-7777-4777-8777-999999999999", {
        analysis: { structuredData: {} },
      })
    );

    assert.equal(stubs.extractionPrompts.length, 1);
    const lead = stubs.all()[0] ?? null;
    if (lead) {
      assert.equal(lead.service_needed, null);
      assert.equal(lead.email, null);
      assert.equal(lead.preferred_datetime, null);
    }
  });
});
