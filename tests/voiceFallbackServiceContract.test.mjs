// The transcript-fallback PRODUCER contract for `service`.
//
// F5 (PR #54) made the canonical service caller-grounded: every word of
// it must have been spoken by the caller on this call. That is enforced
// deterministically by resolveRequestedService at the toExtractedLead
// convergence point, and it is not weakened here.
//
// But there are TWO producers of `service`, and they disagreed. The
// structuredData schema (assistant.ts) already asked for the caller's
// words "EXACTLY in their own words — never expand, rename, relabel, or
// infer a more specific service than they actually said". The transcript
// fallback asked for a "short summary of what the caller wants, e.g.
// 'Boiler repair', 'Product demo'" — a SUMMARY, with two canonical
// labels as its examples.
//
// So the fallback was instructed to produce exactly the shape F5 is
// built to refuse. A model OBEYING that instruction — no hallucination
// required — turns "my radiator is leaking" into "Boiler repair", F5
// correctly refuses it, and a legitimate booking is withheld. That is an
// avoidable FALSE NEGATIVE, and the defect is in the producer, not the
// guard. This is the PR #34 lesson in reverse: there a prompt was
// obeyed and the code read the wrong field; here the code is right and
// the prompt asked for the wrong thing.
//
// The fix aligns the fallback's service instruction with the contract
// the other producer already states. Nothing else in that prompt moves,
// the structuredData schema is untouched, and F5 is untouched.
//
// WHAT THESE TESTS ARE FOR. The existing F5 suite supplies `extracted`
// directly, so it never runs the fallback at all — its OpenAI stub
// returns "NONE", which fails to parse and yields null. Nothing anywhere
// proved that a fallback-PRODUCED service reaches F5, converges with the
// other path, and is what every downstream surface reads. These tests
// drive the real `processCallEnded` with `extracted: null` and a
// deterministic mocked extractor, so the pipeline is the thing under
// test rather than a helper's return value.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { processCallEnded } from "@/lib/voice/calls";

const T = (...turns) => turns.join("\n");

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CONNECTION_ID = "33333333-3333-4333-8333-333333333333";
const RESOURCE_ID = "44444444-4444-4444-8444-444444444444";
const CALENDAR_ID = "owner@example.com";
const APPOINTMENT_ISO = "2026-08-20T14:00:00.000Z";

// The caller describes a leaking radiator in their own words and names a
// time. Everything a legitimate calendar-backed booking needs is here.
const CALLER_RADIATOR = T(
  "AI: How can I help?",
  "User: My radiator is leaking.",
  "AI: When suits?",
  "User: Thursday 20 August at 3 PM."
);

// The business lists the service, so the Knowledge Base gate can open.
const KB_RADIATOR = [
  {
    id: "k1",
    category: "services",
    title: "Radiator repair",
    content: "We repair leaking radiators and boilers.",
  },
];

/** What a compliant fallback extractor returns for the call above. */
const fallbackJson = (over = {}) =>
  JSON.stringify({
    intent: "new_booking",
    name: "Jason Test",
    email: "jason@example.com",
    phone: null,
    service: "leaking radiator",
    preferred_datetime: "Thursday 20 August at 3 PM",
    service_address: null,
    urgent: false,
    ...over,
  });

const call = (id, { transcript, extracted = null }) => ({
  kind: "call-ended",
  provider: "vapi",
  dedupeKey: `vapi:fbsvc-${id}-${Math.random()}:end-of-call-report`,
  providerCallId: id,
  businessPhone: "+353212345678",
  callerPhone: "+353861234567",
  direction: "inbound",
  startedAt: "2026-08-17T10:00:00.000Z",
  endedAt: "2026-08-17T10:05:00.000Z",
  durationSeconds: 300,
  endedReason: "customer-ended-call",
  summary: "Caller would like someone to come out.",
  transcript,
  recordingUrl: null,
  costUsd: null,
  costBreakdown: null,
  // null is the state the whole file is about: Vapi left structuredData
  // empty, so the transcript fallback is the ONLY producer.
  extracted,
});

function detailsRow(html, label) {
  const m = html.match(new RegExp(`<td[^>]*>${label}</td><td[^>]*>([^<]*)</td>`));
  return m ? m[1] : null;
}

async function encrypted() {
  const { encryptCredentials, loadKeyringFromEnv } = await import(
    "@/lib/integrations/crypto"
  );
  return encryptCredentials(
    {
      strategy: "oauth2",
      accessToken: "ya29.token",
      refreshToken: "1//refresh",
      expiresAtIso: "2099-01-01T00:00:00.000Z",
      scopes: "calendar",
    },
    loadKeyringFromEnv()
  );
}

async function installStubs({ extractionJson, knowledge = KB_RADIATOR } = {}) {
  process.env.INTEGRATIONS_ENABLED = "true";
  process.env.CALENDAR_SYNC_ENABLED = "true";
  process.env.CALENDAR_AVAILABILITY_BLOCKING = "true";
  process.env.CALENDAR_EVENT_CREATION_ORG_IDS = ORG_ID;
  process.env.VOICE_CALENDAR_BOOKING_ENABLED = "true";
  process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "client-id";
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "client-secret";

  const credentials = await encrypted();
  const realFetch = globalThis.fetch;
  const leads = new Map();
  const creates = [];
  const emails = [];
  const links = [];
  // Every prompt the fallback extractor actually sent. Asserting against
  // THIS rather than the source string means the structural test is
  // reading the prompt production really used.
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

    // Two different callers reach OpenAI on this path and they must not
    // be confused: the transcript fallback extractor, and the datetime
    // parser. Discriminate on the prompt itself and refuse anything
    // else, so a third caller can never be served the wrong answer
    // silently.
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

    if (url.includes("oauth2.googleapis.com") || url.includes("/token")) {
      return json({ access_token: "fresh", expires_in: 3600, scope: "calendar" });
    }
    if (url.includes("googleapis.com/calendar/v3/freeBusy")) {
      return json({ calendars: { [CALENDAR_ID]: { busy: [] } } });
    }
    if (url.includes("/calendar/v3/calendars/") && url.includes("/events")) {
      creates.push({ method, url, body });
      return json({ id: body.id ?? "evt-1", etag: '"e1"' });
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
      return obj ? json(row) : json([row]);
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
      return obj ? json(row) : json([row]);
    }
    if (url.includes("/rest/v1/integration_links")) {
      if (method === "POST") {
        links.push(body);
        return json([], 201);
      }
      if (method === "PATCH") return json([]);
      return obj ? json(links[0] ?? null) : json(links);
    }
    if (url.includes("/rest/v1/voice_calls")) {
      const r = { id: "call-row-1" };
      return obj ? json(r) : json([r]);
    }
    if (url.includes("/rest/v1/business_knowledge")) return json(knowledge);
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
    if (url.includes("/rest/v1/leads")) {
      if (method === "HEAD") {
        return new Response(null, { status: 200, headers: { "content-range": "*/0" } });
      }
      if (method === "POST") {
        const id = `lead-${++seq}`;
        const stored = { id, metadata: null, appointment_datetime: null, source: "voice", ...body };
        leads.set(id, stored);
        return obj ? json({ id }) : json([{ id }]);
      }
      if (method === "PATCH") {
        const row = leads.get(eqOf("id"));
        if (row) Object.assign(row, body);
        return json([]);
      }
      const project = (row) => {
        if (!row) return null;
        const sel = (q.get("select") ?? "*").trim();
        if (sel === "*" || sel === "") return row;
        const out = {};
        for (const c of sel.split(",").map((x) => x.trim()).filter(Boolean)) {
          out[c] = row[c] === undefined ? null : row[c];
        }
        return out;
      };
      if (q.has("id")) {
        const row = project(leads.get(eqOf("id")) ?? null);
        return obj ? json(row) : json(row ? [row] : []);
      }
      if (q.has("conversation_id")) {
        const cid = eqOf("conversation_id");
        const row = project([...leads.values()].find((l) => l.conversation_id === cid) ?? null);
        return obj ? json(row) : json(row ? [row] : []);
      }
      return obj ? json(null) : json([]);
    }
    if (url.includes("/rest/v1/voice_events")) return json([{ id: "evt-1" }]);
    throw new Error(`Unstubbed fetch in test: ${method} ${url}`);
  };

  return {
    leads,
    creates,
    emails,
    links,
    extractionPrompts,
    all() {
      return [...leads.values()];
    },
    only() {
      const rows = [...leads.values()];
      assert.equal(rows.length, 1, "expected exactly one lead row");
      return rows[0];
    },
    /** The owner's call-summary email. */
    ownerHtml() {
      const sent = emails.find((e) => String(e.html ?? "").includes("Caller ID"));
      return String(sent?.html ?? "");
    },
    eventBodies() {
      return creates.map((c) => c.body);
    },
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

async function admin() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

// ── The real fallback pipeline ─────────────────────────────────────

describe("the transcript fallback produces a caller-grounded service", () => {
  let stubs;
  afterEach(() => stubs?.restore());

  test("A. caller wording survives the fallback and still books", async () => {
    // The point of the whole change. The caller said "my radiator is
    // leaking"; a compliant extractor returns their words; F5 keeps
    // them; the booking proceeds. Under the OLD contract the model was
    // told to summarise instead, and test B is what that produced.
    stubs = await installStubs({ extractionJson: fallbackJson() });
    await processCallEnded(
      await admin(),
      ORG_ID,
      call("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", { transcript: CALLER_RADIATOR })
    );

    const lead = stubs.only();
    assert.equal(lead.service_needed, "leaking radiator", "the caller's own words are canonical");
    assert.equal(lead.status, "booked", "a caller-grounded service still books");
    assert.equal(stubs.creates.length, 1, "one calendar event was created");
  });

  test("A2. every downstream surface reads the SAME resolved value", async () => {
    // The PR #39 lesson, re-proved on the path nothing covered: a
    // consumer reading the raw extraction instead of the resolved value
    // is the defect pattern. Owner row, diary title and the customer's
    // confirmation must all agree with the lead.
    stubs = await installStubs({ extractionJson: fallbackJson() });
    await processCallEnded(
      await admin(),
      ORG_ID,
      call("bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", { transcript: CALLER_RADIATOR })
    );

    const stored = stubs.only().service_needed;
    assert.equal(stored, "leaking radiator");
    assert.equal(
      detailsRow(stubs.ownerHtml(), "Service needed"),
      stored,
      "the owner reads exactly what the lead carries"
    );
    assert.match(
      String(stubs.eventBodies()[0].summary ?? ""),
      /leaking radiator/i,
      "the engineer's diary entry carries the same service"
    );
    // The CUSTOMER's booking confirmation reads the same resolved value
    // (leadCapture passes `extracted.service` to
    // sendBookingConfirmationEmails), but it is dispatched inside
    // `after()` and this harness does not flush that, so it is not
    // asserted here rather than asserted vacuously. The three surfaces
    // above are observable and all agree.
  });

  test("B. a PARAPHRASE is still refused — F5 is not weakened", async () => {
    // Exactly what the old "short summary … e.g. 'Boiler repair'"
    // contract invited, and the reason the fix belongs in the producer:
    // the guard has to refuse this, and refusing it costs the booking.
    stubs = await installStubs({
      extractionJson: fallbackJson({ service: "Boiler repair" }),
    });
    await processCallEnded(
      await admin(),
      ORG_ID,
      call("cccccccc-3333-4333-8333-cccccccccccc", { transcript: CALLER_RADIATOR })
    );

    const lead = stubs.only();
    assert.equal(lead.service_needed, null, "the caller never said boiler or repair");
    assert.notEqual(lead.status, "booked", "an ungrounded service cannot unlock booking");
    assert.equal(stubs.creates.length, 0, "and no calendar event was created");
    assert.equal(
      detailsRow(stubs.ownerHtml(), "Service needed"),
      null,
      "absence is rendered as absence, never as the refused label"
    );
  });

  test("C. assistant terminology cannot establish the service", async () => {
    // The assistant is the one party holding the business's own
    // "Services Offered" vocabulary. Its turns are not caller evidence,
    // whichever producer repeats them.
    stubs = await installStubs({
      extractionJson: fallbackJson({ service: "boiler service" }),
    });
    await processCallEnded(
      await admin(),
      ORG_ID,
      call("dddddddd-4444-4444-8444-dddddddddddd", {
        transcript: T(
          "AI: We do emergency plumbing and boiler service.",
          "User: Something is dripping under the sink.",
          "AI: When suits?",
          "User: Thursday 20 August at 3 PM."
        ),
      })
    );

    assert.equal(stubs.only().service_needed, null, "the assistant said it, not the caller");
    assert.equal(stubs.creates.length, 0);
  });

  test("D. a negated caller mention is not support", async () => {
    stubs = await installStubs({
      extractionJson: fallbackJson({ service: "boiler repair" }),
    });
    await processCallEnded(
      await admin(),
      ORG_ID,
      call("eeeeeeee-5555-4555-8555-eeeeeeeeeeee", {
        transcript: T(
          "AI: How can I help?",
          "User: It's not the boiler, it's the radiator.",
          "AI: When suits?",
          "User: Thursday 20 August at 3 PM."
        ),
      })
    );

    const stored = stubs.only().service_needed;
    assert.ok(
      stored === null || !/boiler/i.test(stored),
      `a negated word must never survive — got ${stored}`
    );
  });

  test("E. a later caller correction wins, and the superseded value cannot return", async () => {
    stubs = await installStubs({
      extractionJson: fallbackJson({ service: "radiator" }),
      knowledge: [
        {
          id: "k1",
          category: "services",
          title: "Radiator repair",
          content: "We repair leaking radiators and boilers.",
        },
      ],
    });
    await processCallEnded(
      await admin(),
      ORG_ID,
      call("ffffffff-6666-4666-8666-ffffffffffff", {
        transcript: T(
          "AI: How can I help?",
          "User: Boiler service, sorry, no — the radiator.",
          "AI: When suits?",
          "User: Thursday 20 August at 3 PM."
        ),
      })
    );

    assert.equal(
      stubs.only().service_needed,
      "radiator",
      "the caller's corrected word is what stands"
    );
  });

  test("F. a fallback that fails changes nothing — no service is invented", async () => {
    // The extractor returns unparseable content, exactly as it does on a
    // provider error. Its contract is null-on-failure, and null must not
    // become a manufactured service anywhere.
    stubs = await installStubs({ extractionJson: "NONE" });
    await processCallEnded(
      await admin(),
      ORG_ID,
      call("99999999-7777-4777-8777-999999999999", { transcript: CALLER_RADIATOR })
    );

    assert.equal(stubs.all().length, 0, "no details at all means no lead was manufactured");
    assert.equal(stubs.creates.length, 0, "and certainly no booking");
  });

  test("G. structuredData present — the fallback is never consulted", async () => {
    // The other producer's contract was already correct and is untouched
    // by this change. When it supplies data, the extractor must not run
    // at all: no prompt is sent.
    stubs = await installStubs({ extractionJson: fallbackJson() });
    await processCallEnded(
      await admin(),
      ORG_ID,
      call("12121212-8888-4888-8888-121212121212", {
        transcript: CALLER_RADIATOR,
        extracted: {
          intent: "new_booking",
          name: "Jason Test",
          email: null,
          phone: null,
          service: "leaking radiator",
          preferred_datetime: "Thursday 20 August at 3 PM",
          service_address: null,
          urgent: false,
        },
      })
    );

    assert.equal(
      stubs.extractionPrompts.length,
      0,
      "structuredData was present, so the fallback extractor never ran"
    );
    assert.equal(stubs.only().service_needed, "leaking radiator");
    assert.equal(stubs.only().status, "booked", "structuredData behaviour is unchanged");
  });
});

// ── The producer contract itself ───────────────────────────────────
// Read out of the prompt the pipeline actually sent, not out of the
// source file — the same reason the PR #40 tests parse the required
// field list back out of the assistant prompt.

describe("the fallback service instruction asks for the caller's own words", () => {
  let stubs;
  afterEach(() => stubs?.restore());

  async function servicePrompt() {
    stubs = await installStubs({ extractionJson: fallbackJson() });
    await processCallEnded(
      await admin(),
      ORG_ID,
      call("34343434-9999-4999-8999-343434343434", { transcript: CALLER_RADIATOR })
    );
    assert.equal(stubs.extractionPrompts.length, 1, "the extractor ran exactly once");
    const prompt = stubs.extractionPrompts[0];
    // The `service —` field paragraph, up to the next field bullet.
    const m = prompt.match(/\nservice — [\s\S]*?(?=\npreferred_datetime — )/);
    assert.ok(m, "the prompt still documents a service field");
    return m[0];
  }

  test("it requires the caller's exact words and forbids renaming", async () => {
    const rule = await servicePrompt();
    assert.match(rule, /EXACTLY in their own words/);
    assert.match(rule, /never\s+expand, rename, relabel, or infer/);
  });

  test("it no longer asks for a SUMMARY of what the caller wants", async () => {
    const rule = await servicePrompt();
    assert.ok(
      !/summary/i.test(rule),
      "asking for a summary is what invited the paraphrase F5 must refuse"
    );
  });

  test("it offers no canonical-label examples for service", async () => {
    const rule = await servicePrompt();
    // The two examples did as much steering as the word "summary": both
    // were canonical trade labels, neither was caller speech.
    assert.ok(!/Boiler repair/i.test(rule), "'Boiler repair' anchored the model to a label");
    assert.ok(!/Product demo/i.test(rule), "'Product demo' did the same");
  });

  test("the intent restriction is preserved", async () => {
    const rule = await servicePrompt();
    assert.match(rule, /Only when intent is new_booking; otherwise null\./);
  });

  test("the OTHER field contracts are untouched", async () => {
    stubs = await installStubs({ extractionJson: fallbackJson() });
    await processCallEnded(
      await admin(),
      ORG_ID,
      call("56565656-aaaa-4aaa-8aaa-565656565656", { transcript: CALLER_RADIATOR })
    );
    const prompt = stubs.extractionPrompts[0];
    assert.match(prompt, /preferred_datetime — the caller's requested day and time EXACTLY as they/);
    assert.match(prompt, /service_address — the address or location where the work is needed, exactly/);
    assert.match(prompt, /URGENCY IS NOT A TIME/);
    assert.match(prompt, /CORRECTIONS WIN/);
    assert.match(prompt, /Extract only what the caller actually said; never invent details\./);
  });
});
