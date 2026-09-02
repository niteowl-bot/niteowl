// Regression: the provider's summary could become canonical business data.
//
// `event.summary` is prose written by the voice provider's own model from
// the raw transcript. It is not derived from canonical values, not
// compared against them, and not constrained by any guard — it can state
// a name an email manufactured (PR #39), an address addressIntegrity
// refused (PR #42), an email normalisation rejected (PR #45), or a clock
// time the caller never gave (PR #35).
//
// It had four downstream roles. Three of them made it a FACT SOURCE:
//
//   1. extraction input. extractVoiceLeadFromTranscript took
//      (transcript, summary) and used `transcript || summary`, so a call
//      that arrived without a transcript had its name, email, address,
//      service, requested time and urgency extracted from the provider's
//      prose — and those became the lead.
//
//   2. leads.service_needed, via `extracted.service ?? userMessage`,
//      where userMessage is the summary on voice. From there it reached
//      the calendar event title directly, and again through the UPDATE
//      path's shouldUpdateService.
//
//   3. the CUSTOMER's booking confirmation email, through the same
//      expression — the only one of the three the customer reads.
//
// The fourth role, voice_calls.summary, is left exactly as it was: raw
// provider narrative kept for audit and review, which no changed path
// treats as structured data.
//
// The rule this pins:
//
//   RAW TRANSCRIPT -> extraction -> canonical facts -> business systems
//   provider summary -> non-authoritative narrative ONLY
//
// A transcript is the caller's own words. A summary is a retelling of
// them. Only the first is evidence.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { encryptCredentials, loadKeyringFromEnv } from "@/lib/integrations/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { processCallEnded } from "@/lib/voice/calls";

const T = (...t) => t.join("\n");
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CALENDAR_ID = "owner@example.com";
const CONNECTION_ID = "33333333-3333-4333-8333-333333333333";
const RESOURCE_ID = "44444444-4444-4444-8444-444444444444";
const APPOINTMENT_ISO = "2026-08-20T14:00:00.000Z";

/**
 * A summary that confidently states facts the guards would refuse. Every
 * value in it is one this codebase has had to defend against: the
 * email-manufactured person from the 2026-08-31 call, the transcription
 * noise from 2026-09-01, and urgency rendered as a clock time.
 */
const CONTRADICTING_SUMMARY = [
  "James Hartley called about a burst pipe.",
  "Name: James Hartley.",
  "Email: jameshartley@gmail.com.",
  "Callback number: Number calling from.",
  "Callback date: today. Callback time: 3 PM.",
  "Address: A c 1 Oakland Drive.",
  "Issue: Emergency drain excavation.",
].join(" ");

/**
 * What a competent extractor WOULD return if the contradicting summary
 * above were handed to it as if it were a transcript. Supplied to the
 * stub in the summary-only tests so those tests have causal weight: if
 * the fallback is ever restored, the extractor runs, returns this, and
 * a lead really is manufactured out of provider prose — which is
 * exactly what must fail.
 */
const FACTS_THE_SUMMARY_WOULD_YIELD = JSON.stringify({
  intent: "new_booking",
  name: "James Hartley",
  email: "jameshartley@gmail.com",
  phone: null,
  service: "Emergency drain excavation",
  preferred_datetime: "today at 3 PM",
  service_address: "A c 1 Oakland Drive",
  urgent: true,
});

const call = (id, { transcript, summary, extracted = null }) => ({
  kind: "call-ended",
  provider: "vapi",
  dedupeKey: `vapi:contain-${id}-${Math.random()}:end-of-call-report`,
  providerCallId: id,
  businessPhone: "+353212345678",
  callerPhone: "+353861234567",
  direction: "inbound",
  startedAt: "2026-08-17T10:00:00.000Z",
  endedAt: "2026-08-17T10:05:00.000Z",
  durationSeconds: 300,
  endedReason: "customer-ended-call",
  summary,
  transcript,
  recordingUrl: null,
  costUsd: null,
  costBreakdown: null,
  // Null by default: that is the state the provider leaves on its
  // analysis timeout, and the only state in which the fallback runs.
  extracted,
});

function installStubs({ extractionJson = null } = {}) {
  process.env.INTEGRATIONS_ENABLED = "true";
  process.env.CALENDAR_SYNC_ENABLED = "true";
  process.env.CALENDAR_AVAILABILITY_BLOCKING = "true";
  process.env.CALENDAR_EVENT_CREATION_ORG_IDS = ORG_ID;
  process.env.VOICE_CALENDAR_BOOKING_ENABLED = "true";
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
  const leads = new Map();
  const creates = [];
  const emails = [];
  const links = [];
  /** Every prompt sent to the extraction model, so the SOURCE is provable. */
  const openaiPrompts = [];
  const voiceCallUpserts = [];
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
      openaiPrompts.push(prompt);
      // The datetime parser and the lead extractor share this endpoint.
      if (/JSON object/i.test(prompt)) {
        return json({
          choices: [{ message: { content: extractionJson ?? "{}" } }],
        });
      }
      return json({ choices: [{ message: { content: APPOINTMENT_ISO } }] });
    }
    if (url.includes("oauth2.googleapis.com") || url.includes("/token")) {
      return json({ access_token: "fresh", expires_in: 3600, scope: "calendar" });
    }
    if (url.includes("googleapis.com/calendar/v3/freeBusy")) {
      return json({ calendars: { [CALENDAR_ID]: { busy: [] } } });
    }
    if (url.includes("/calendar/v3/calendars/") && url.includes("/events")) {
      if (method === "PATCH") return json({ id: "existing-event", etag: '"e2"' });
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
      // supabase-js sends an upsert as an array of rows.
      if (method === "POST" || method === "PATCH") {
        for (const r of Array.isArray(body) ? body : [body]) voiceCallUpserts.push(r);
      }
      const r = { id: "call-row-1" };
      return obj ? json(r) : json([r]);
    }
    if (url.includes("/rest/v1/business_knowledge")) {
      return json([
        { id: "k1", category: "services", title: "Boiler service", content: "We service boilers." },
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

    if (url.includes("/rest/v1/leads")) {
      if (method === "HEAD") {
        return new Response(null, { status: 200, headers: { "content-range": "*/0" } });
      }
      if (method === "POST") {
        const id = `lead-${++seq}`;
        leads.set(id, { id, metadata: null, appointment_datetime: null, source: "voice", ...body });
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
    openaiPrompts,
    voiceCallUpserts,
    all() {
      return [...leads.values()];
    },
    only() {
      const rows = [...leads.values()];
      assert.equal(rows.length, 1, "expected exactly one lead row");
      return rows[0];
    },
    /** The prompt sent to the LEAD extractor, if it ran at all. */
    extractionPrompt() {
      return openaiPrompts.find((p) => /JSON object/i.test(p)) ?? null;
    },
    ownerHtml() {
      const s = [...emails].reverse().find((e) => String(e.html ?? "").includes("Caller ID"));
      return String(s?.html ?? "");
    },
    /** The CUSTOMER's booking confirmation, if one was sent. */
    customerEmail() {
      return emails.find((e) => /confirm/i.test(String(e.subject ?? ""))) ?? null;
    },
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

const admin = () => createAdminClient();

const detailsRow = (html, label) => {
  const m = html.match(new RegExp(`<td[^>]*>${label}</td><td[^>]*>([^<]*)</td>`));
  return m ? m[1] : null;
};

describe("the provider summary is narrative, never a fact source", () => {
  let stubs;
  afterEach(() => stubs?.restore());

  // ── A + F. the transcript is the only extraction source ─────────

  test("A. with a transcript present, extraction reads the TRANSCRIPT, not the summary", async () => {
    stubs = installStubs({
      extractionJson: JSON.stringify({
        intent: "question",
        name: "Ernesto",
        email: null,
        phone: null,
        service: "burst pipe",
        preferred_datetime: null,
        service_address: null,
        urgent: true,
      }),
    });

    const transcript = T(
      "AI: How can I help?",
      "User: I have a burst pipe. It's urgent.",
      "AI: Can I take your name?",
      "User: Ernesto."
    );

    await processCallEnded(
      admin(),
      ORG_ID,
      call("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", {
        transcript,
        summary: CONTRADICTING_SUMMARY,
      })
    );

    const prompt = stubs.extractionPrompt();
    assert.ok(prompt, "the extractor ran");
    assert.ok(prompt.includes("I have a burst pipe"), "the transcript was the input");
    assert.ok(
      !prompt.includes("James Hartley"),
      "the contradicting summary was NOT sent to the extractor"
    );
    assert.ok(!prompt.includes("A c 1 Oakland Drive"));
    assert.equal(stubs.only().name, "Ernesto", "the canonical name came from the transcript");
  });

  test("F. facts the guards refuse cannot re-enter through the fallback", async () => {
    // No transcript: the only text the provider gave us is prose that
    // confidently states an email-manufactured name, refused address
    // and a clock time the caller never said.
    stubs = installStubs({ extractionJson: FACTS_THE_SUMMARY_WOULD_YIELD });

    await processCallEnded(
      admin(),
      ORG_ID,
      call("bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", {
        transcript: null,
        summary: CONTRADICTING_SUMMARY,
      })
    );

    assert.equal(stubs.extractionPrompt(), null, "no extraction ran at all");
    const everything = JSON.stringify(stubs.all());
    assert.ok(!everything.includes("James Hartley"), "no manufactured name was stored");
    assert.ok(!everything.includes("A c 1 Oakland"), "no refused address was stored");
    assert.ok(!everything.includes("3 PM"), "no invented callback time was stored");
  });

  // ── B + C. a summary-only call: unknown stays unknown, call kept ──

  test("B. a summary-only call creates NO canonical facts", async () => {
    stubs = installStubs({ extractionJson: FACTS_THE_SUMMARY_WOULD_YIELD });

    await processCallEnded(
      admin(),
      ORG_ID,
      call("cccccccc-3333-4333-8333-cccccccccccc", {
        transcript: null,
        summary: CONTRADICTING_SUMMARY,
      })
    );

    assert.equal(stubs.all().length, 0, "no lead is manufactured from prose");
    assert.equal(stubs.creates.length, 0, "and no calendar event");
  });

  test("C. the call is NOT lost — it is stored and the owner is told", async () => {
    // The existing mechanism, unchanged: the owner call-summary email is
    // sent for every completed call, lead or not, and voice_calls keeps
    // the raw provider narrative for review and replay. No new schema
    // and no new workflow were needed for this case.
    stubs = installStubs({ extractionJson: FACTS_THE_SUMMARY_WOULD_YIELD });

    await processCallEnded(
      admin(),
      ORG_ID,
      call("dddddddd-4444-4444-8444-dddddddddddd", {
        transcript: null,
        summary: CONTRADICTING_SUMMARY,
      })
    );

    const stored = stubs.voiceCallUpserts.find((r) => "summary" in r);
    assert.ok(stored, "the call row was written");
    assert.equal(stored.summary, CONTRADICTING_SUMMARY, "the call row keeps the narrative");
    assert.equal(stored.status, "completed");

    const html = stubs.ownerHtml();
    assert.ok(html, "the owner was emailed");
    assert.ok(
      html.includes("James Hartley"),
      "the summary is still shown, as review context"
    );
    assert.ok(
      html.includes("No lead was created from this call"),
      "and the owner is told plainly that nothing canonical was established"
    );
    assert.equal(
      detailsRow(html, "Caller"),
      "+353861234567",
      "the structured Caller falls back to the real number, not the prose name"
    );
    assert.equal(detailsRow(html, "Email"), null, "no canonical email is claimed");
    assert.equal(detailsRow(html, "Service address"), null, "no canonical address is claimed");
  });

  // ── D + E. the service and the calendar title ───────────────────

  test("D. a canonical service is what reaches the calendar title", async () => {
    stubs = installStubs();

    await processCallEnded(
      admin(),
      ORG_ID,
      call("eeeeeeee-5555-4555-8555-eeeeeeeeeeee", {
        transcript: T("AI: How can I help?", "User: Boiler service on Thursday 20 August at 3 PM."),
        summary: CONTRADICTING_SUMMARY,
        extracted: {
          intent: "new_booking",
          name: "Jason",
          email: "jason@example.com",
          phone: null,
          service: "Boiler service",
          preferred_datetime: "Thursday 20 August at 3 PM",
          service_address: null,
          urgent: false,
        },
      })
    );

    assert.equal(stubs.only().service_needed, "Boiler service");
    assert.equal(stubs.creates.length, 1);
    assert.match(stubs.creates[0].body.summary, /^Boiler service/);
    assert.ok(
      !stubs.creates[0].body.summary.includes("Emergency drain excavation"),
      "the summary's competing service never reaches the diary"
    );
  });

  test("E. a NULL canonical service does not fall back to the prose", async () => {
    stubs = installStubs();

    await processCallEnded(
      admin(),
      ORG_ID,
      call("ffffffff-6666-4666-8666-ffffffffffff", {
        transcript: T("AI: How can I help?", "User: Thursday 20 August at 3 PM please."),
        summary: CONTRADICTING_SUMMARY,
        extracted: {
          intent: "new_booking",
          name: "Jason",
          email: "jason@example.com",
          phone: null,
          service: null, // nothing canonical was established
          preferred_datetime: "Thursday 20 August at 3 PM",
          service_address: null,
          urgent: false,
        },
      })
    );

    assert.equal(
      stubs.only().service_needed,
      null,
      "absence stays absence — the prose does not become the service"
    );
    // Scoped to the canonical field on purpose: leads.message DOES
    // still hold the whole summary, deliberately (see the last test in
    // this file). The rule is that the narrative decides no fact, not
    // that it is absent.
    assert.ok(
      !String(stubs.only().service_needed ?? "").includes("Emergency drain"),
      "the summary's competing service never becomes the canonical service"
    );
    // Pre-existing, and worth pinning while this file is here: a voice
    // call with no named service can never reach the calendar at all,
    // because mayBookOnCalendar requires Boolean(extracted.service).
    // The fallback removed above was therefore already dead for voice
    // BOOKINGS — but not for the lead's service_needed asserted above,
    // nor for the customer confirmation, nor for chat.
    assert.equal(
      stubs.creates.length,
      0,
      "a serviceless phone call books nothing — unchanged by this fix"
    );
  });

  test("E-chat. the reachable neutral-title path: chat with no canonical service", async () => {
    // Chat is where a booking can confirm with a null service, so this
    // is where the calendar title's neutral fallback actually applies.
    // Called directly, exactly as the chat and widget routes call it —
    // and note it passes no serviceLocation, per PR #47.
    stubs = installStubs();
    const { capturePartialLead } = await import("@/lib/leadCapture");

    await capturePartialLead(
      admin(),
      ORG_ID,
      "77777777-dddd-4ddd-8ddd-777777777777",
      "Can someone come out on Thursday 20 August at 3 PM? It's the thing by the back door.",
      {
        intent: "new_booking",
        name: "Dana",
        email: "dana@example.com",
        phone: "+353861111111",
        service: null, // nothing canonical was established
        preferred_datetime: "Thursday 20 August at 3 PM",
        confidence: 0.9,
      },
      "chat"
    );

    assert.equal(stubs.only().service_needed, null, "the message is not the service");
    assert.equal(stubs.creates.length, 1, "the booking still went to the calendar");
    assert.equal(
      stubs.creates[0].body.summary,
      "Appointment — Dana",
      "the existing neutral title is used, not the customer's whole message"
    );
    assert.ok(
      !stubs.creates[0].body.summary.includes("back door"),
      "no part of the message leaks into the event title"
    );
  });

  test("E2. the CUSTOMER's confirmation never states a service made of prose", async () => {
    stubs = installStubs();

    await processCallEnded(
      admin(),
      ORG_ID,
      call("11111111-7777-4777-8777-111111111111", {
        transcript: T("AI: How can I help?", "User: Thursday 20 August at 3 PM please."),
        summary: CONTRADICTING_SUMMARY,
        extracted: {
          intent: "new_booking",
          name: "Jason",
          email: "jason@example.com",
          phone: null,
          service: null,
          preferred_datetime: "Thursday 20 August at 3 PM",
          service_address: null,
          urgent: false,
        },
      })
    );

    const customer = stubs.customerEmail();
    if (customer) {
      assert.ok(
        !String(customer.html).includes("Emergency drain excavation"),
        "the summary's service never reaches the customer"
      );
      assert.ok(!String(customer.html).includes("James Hartley"));
    }
    // Whether a confirmation is sent at all is decided elsewhere and is
    // not what this test governs; it must simply never carry prose.
  });

  // ── G–L. the neighbouring guards still hold ─────────────────────

  test("G+I. PR #39 / #43 name protections are untouched", async () => {
    stubs = installStubs();
    await processCallEnded(
      admin(),
      ORG_ID,
      call("22222222-8888-4888-8888-222222222222", {
        transcript: T(
          "AI: May I have your name?",
          "User: JSON test.",
          "AI: And your email?",
          "User: jason test 1 4 1 at g mail dot com."
        ),
        summary: CONTRADICTING_SUMMARY,
        extracted: {
          intent: "question",
          name: "Jason Test",
          email: "jasontest141@gmail.com",
          phone: null,
          service: "leaking radiator",
          preferred_datetime: null,
          service_address: null,
          urgent: true,
        },
      })
    );
    assert.equal(stubs.only().name, "Jason Test", "PR #43 digit-suffix rule holds");
    assert.equal(stubs.only().email, "jasontest141@gmail.com");
    assert.equal(detailsRow(stubs.ownerHtml(), "Caller"), "Jason Test");
  });

  test("H+K. PR #42 address and PR #46 metadata protections are untouched", async () => {
    stubs = installStubs();
    await processCallEnded(
      admin(),
      ORG_ID,
      call("33333333-9999-4999-8999-333333333333", {
        transcript: T("AI: What's the address?", "User: A c 1 Oakland Drive."),
        summary: CONTRADICTING_SUMMARY,
        extracted: {
          intent: "question",
          name: "Ernesto",
          email: null,
          phone: null,
          service: "burst pipe",
          preferred_datetime: null,
          service_address: "A c 1 Oakland Drive",
          urgent: true,
        },
      })
    );
    assert.equal(
      stubs.only().metadata?.service_address,
      undefined,
      "the refused address is not stored, and the summary cannot supply one"
    );
    assert.equal(
      stubs.only().metadata?.callback_urgency,
      "Urgent — no specific day or time given",
      "PR #35 urgency still resolves from the canonical flag"
    );
  });

  test("J. PR #45 canonical owner rows still render from canonical values", async () => {
    stubs = installStubs();
    await processCallEnded(
      admin(),
      ORG_ID,
      call("44444444-aaaa-4aaa-8aaa-444444444444", {
        transcript: T(
          "AI: Can I take your name?",
          "User: Ernesto.",
          "AI: And your email?",
          "User: michael ryan at hotmail dot com.",
          "AI: What's the address?",
          "User: 81 Oakland Drive."
        ),
        summary: CONTRADICTING_SUMMARY,
        extracted: {
          intent: "question",
          name: "Ernesto",
          email: "michael ryan at hotmail dot com",
          phone: null,
          service: "burst pipe",
          preferred_datetime: null,
          service_address: "81 Oakland Drive",
          urgent: false,
        },
      })
    );
    const html = stubs.ownerHtml();
    assert.equal(detailsRow(html, "Email"), "michaelryan@hotmail.com");
    assert.equal(detailsRow(html, "Service address"), "81 Oakland Drive");
    assert.equal(detailsRow(html, "Caller"), "Ernesto");
  });

  // ── M + N. booking semantics and event identity ─────────────────

  test("M+N+L. booking outcome, event identity and location are unchanged", async () => {
    stubs = installStubs();
    await processCallEnded(
      admin(),
      ORG_ID,
      call("55555555-bbbb-4bbb-8bbb-555555555555", {
        transcript: T("AI: Address?", "User: 81 Oakland Drive.", "AI: When?", "User: Thursday 20 August at 3 PM."),
        summary: CONTRADICTING_SUMMARY,
        extracted: {
          intent: "new_booking",
          name: "Jason",
          email: "jason@example.com",
          phone: null,
          service: "Boiler service",
          preferred_datetime: "Thursday 20 August at 3 PM",
          service_address: "81 Oakland Drive",
          urgent: false,
        },
      })
    );

    assert.equal(stubs.only().status, "booked", "booking still succeeds");
    assert.equal(stubs.creates.length, 1);
    const body = stubs.creates[0].body;
    assert.ok(body.id, "the event carries a derived id as before");
    assert.equal(body.location, "81 Oakland Drive", "PR #47's canonical location holds");
    assert.equal(body.start.timeZone, "Europe/London", "timezone unchanged");
    assert.equal(stubs.links.length, 1, "exactly one integration link — no duplicate");
  });

  // ── leads.message is deliberately left alone ────────────────────

  test("leads.message still carries the narrative — this PR contains sources only", async () => {
    stubs = installStubs();
    await processCallEnded(
      admin(),
      ORG_ID,
      call("66666666-cccc-4ccc-8ccc-666666666666", {
        transcript: T("AI: How can I help?", "User: Burst pipe."),
        summary: CONTRADICTING_SUMMARY,
        extracted: {
          intent: "question",
          name: "Ernesto",
          email: null,
          phone: null,
          service: "burst pipe",
          preferred_datetime: null,
          service_address: null,
          urgent: true,
        },
      })
    );
    assert.equal(
      stubs.only().message,
      CONTRADICTING_SUMMARY,
      "unchanged: the narrative is retained, it simply decides no canonical fact"
    );
  });
});
