// Regression: "as soon as possible" stored as a callback DATE and TIME.
//
// From the 2026-08-06 test call. Asked "which day and time would suit
// you best?", the caller said "As soon as possible", and the call was
// written up as:
//
//   Callback date: as soon as possible
//   Callback time: as soon as possible
//
// The prompt and the extraction schema now tell the model that urgency
// is not a time (tests/voiceConversation.test.mjs pins that wording),
// but those are instructions to a language model. These tests pin the
// deterministic guard underneath: whatever comes back from extraction,
// an urgency-only phrase never reaches the lead's preferred_datetime,
// and a genuine answer — however vague — is never thrown away.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  isUrgencyOnlyTiming,
  sanitisePreferredDatetime,
} from "@/lib/voice/callbackTiming";
import { sendCallSummaryEmail } from "@/lib/email";
import { processCallEnded } from "@/lib/voice/calls";

describe("urgency is not a time", () => {
  const URGENCY_ONLY = [
    "as soon as possible",
    "As soon as possible.",
    "ASAP",
    "asap please",
    "as soon as you can",
    "as soon as someone can",
    "whenever possible",
    "whenever you can",
    "the earliest you can",
    "earliest available",
    "next available",
    "soon",
    "the soonest",
    "immediately",
    "right away",
    "straight away",
    "urgently",
    "it's an emergency",
    "any time",
    "anytime",
    "no preference",
    "I don't mind",
    "doesn't matter",
    "whatever suits",
  ];

  for (const phrase of URGENCY_ONLY) {
    test(`"${phrase}" is urgency, not a day or a time`, () => {
      assert.equal(isUrgencyOnlyTiming(phrase), true);
      const { preferredDatetime, urgency } = sanitisePreferredDatetime(phrase);
      assert.equal(preferredDatetime, null, "it must never become a datetime");
      assert.equal(urgency, phrase.trim(), "the caller's words are kept");
    });
  }

  test("the exact phrase from the call is cleared from both fields", () => {
    // The bug in one assertion: the same string arriving as the
    // preferred_datetime must leave as no date and no time at all.
    const { preferredDatetime, urgency } =
      sanitisePreferredDatetime("as soon as possible");
    assert.equal(preferredDatetime, null);
    assert.equal(urgency, "as soon as possible");
  });
});

describe("real timing answers survive untouched", () => {
  const REAL_TIMING = [
    "Thursday at 2pm",
    "Thursday afternoon",
    "Friday morning",
    "tomorrow",
    "tomorrow at 4pm",
    "any time between 2 and 5",
    "any time between 2 and 5 on Thursday",
    "6 August at 2pm",
    "next Monday",
    "this weekend",
    "the afternoon",
    "9 o'clock",
    "18:30",
    // Urgency ALONGSIDE a real day is a real day — the caller answered.
    "Thursday, as soon as possible",
    "as soon as possible tomorrow morning",
    "the earliest you can on Friday",
  ];

  for (const phrase of REAL_TIMING) {
    test(`"${phrase}" is kept exactly as the caller said it`, () => {
      assert.equal(isUrgencyOnlyTiming(phrase), false);
      const { preferredDatetime, urgency } = sanitisePreferredDatetime(phrase);
      assert.equal(preferredDatetime, phrase);
      assert.equal(urgency, null, "a real answer is not urgency");
    });
  }
});

describe("nothing to sanitise", () => {
  test("null, undefined and blank stay empty and are not urgency", () => {
    for (const value of [null, undefined, "", "   "]) {
      assert.equal(isUrgencyOnlyTiming(value), false);
      assert.deepEqual(sanitisePreferredDatetime(value), {
        preferredDatetime: null,
        urgency: null,
      });
    }
  });

  test("surrounding whitespace is trimmed, not treated as content", () => {
    assert.deepEqual(sanitisePreferredDatetime("  Thursday at 2pm  "), {
      preferredDatetime: "Thursday at 2pm",
      urgency: null,
    });
  });

  test("an unrelated phrase is left alone rather than guessed at", () => {
    // Not urgency and not a time — this helper's job is narrow, so it
    // passes the value through and lets the existing parser decide.
    assert.deepEqual(sanitisePreferredDatetime("after the school run"), {
      preferredDatetime: "after the school run",
      urgency: null,
    });
  });
});

// ── Surfacing: the urgency has to reach the owner ──────────────────
//
// The guard above stops "as soon as possible" becoming a callback date
// and time. That half shipped 2026-08-06 and works. The other half did
// not: the phrase was written to leads.metadata.callback_urgency and
// then read by NOTHING — not the owner's call-summary email, not the
// leads dashboard. So the most urgent callers arrived looking exactly
// like a caller who declined to give a time at all.
//
// These tests pin the owner-facing half. The distinction they protect
// is three-way and must stay three-way:
//
//   a real callback time   → shown as a time
//   urgency only           → shown as URGENCY, never as a time
//   neither                → nothing shown, nothing invented


let restoreFetch = null;

/** Captures what Resend was asked to send; nothing leaves the process. */
function captureEmails() {
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(typeof input === "string" ? input : input.url);
    if (url.includes("api.resend.com")) {
      sent.push(init.body ? JSON.parse(init.body) : {});
      return new Response(JSON.stringify({ id: `email-${sent.length}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input, init);
  };
  restoreFetch = () => {
    globalThis.fetch = realFetch;
  };
  return sent;
}

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
});

const CALLBACK_CALL = {
  businessOwnerEmail: "owner@example-business.test",
  businessName: "Niteowl Test",
  callerPhone: "+353871465274",
  callerName: "Michael Ryan",
  startedAt: "2026-08-26T11:54:38.000Z",
  durationSeconds: 42,
  summary: "Michael asked for someone to ring him back.",
  transcript: "AI: When would suit?\nUser: As soon as possible.",
  leadCreated: true,
  // A callback has no appointment, so no booking status is reported.
  bookingStatus: null,
  timezone: "Europe/London",
};

async function summaryHtmlFor(overrides) {
  const sent = captureEmails();
  const ok = await sendCallSummaryEmail({ ...CALLBACK_CALL, ...overrides });
  assert.equal(ok, true, "the summary email should have been sent");
  assert.equal(sent.length, 1, "exactly one owner summary email per call");
  return sent[0].html;
}

describe("the owner's email shows the urgency the caller actually gave", () => {
  test("an urgency-only callback names it, in the caller's own words", async () => {
    const html = await summaryHtmlFor({ callbackUrgency: "as soon as possible" });
    assert.match(html, /Callback urgency/, "the row must be present");
    assert.match(html, /as soon as possible/, "the caller's words must appear");
  });

  test("it is labelled as urgency, never as a date or a time", async () => {
    const html = await summaryHtmlFor({ callbackUrgency: "as soon as possible" });
    // The exact failure of 2026-08-06: the phrase presented under a
    // label that means WHEN.
    assert.ok(
      !/Callback date[\s\S]{0,80}as soon as possible/i.test(html),
      "must never appear under a date label"
    );
    assert.ok(
      !/Callback time[\s\S]{0,80}as soon as possible/i.test(html),
      "must never appear under a time label"
    );
    assert.ok(
      !/>Time<\/td><td[^>]*>as soon as possible/i.test(html),
      "must never land in the call's Time row"
    );
  });

  test("the value is escaped like every other caller-supplied string", async () => {
    const html = await summaryHtmlFor({
      callbackUrgency: '<script>alert("x")</script> asap',
    });
    assert.ok(!/<script>/.test(html), "raw markup must never reach the email");
    assert.match(html, /&lt;script&gt;/, "it must be escaped, not dropped");
  });

  test("a genuine callback time is unaffected — no urgency row appears", async () => {
    // sanitisePreferredDatetime returns EITHER a timing OR urgency, so a
    // real answer leaves callbackUrgency null. Pinned here because the
    // email must not invent a row from a real time.
    const { preferredDatetime, urgency } =
      sanitisePreferredDatetime("Thursday at 2pm");
    assert.equal(preferredDatetime, "Thursday at 2pm");
    assert.equal(urgency, null);

    const html = await summaryHtmlFor({ callbackUrgency: urgency });
    assert.ok(!/Callback urgency/.test(html), "no urgency row for a real time");
  });

  test("neither timing nor urgency invents nothing at all", async () => {
    for (const value of [null, undefined, "", "   "]) {
      const html = await summaryHtmlFor({ callbackUrgency: value });
      assert.ok(
        !/Callback urgency/.test(html),
        `no urgency row for ${JSON.stringify(value)}`
      );
    }
  });

  test("the rest of the summary is unchanged by this addition", async () => {
    const html = await summaryHtmlFor({ callbackUrgency: "asap" });
    assert.match(html, /Caller ID/);
    assert.match(html, /Duration/);
    assert.match(html, /Michael asked for someone to ring him back/);
  });
});

// ── Dashboard ──────────────────────────────────────────────────────
//
// A STRUCTURAL test, following the precedent set in
// tests/calendarEventCreation.test.mjs: this repo has no React renderer,
// and adding one to assert a rendered paragraph would be a large new
// dependency for a small guarantee. It reads the component's source and
// pins the properties that actually matter.
//
// LIMITATION, stated plainly: this proves the component is SHAPED
// correctly, not that React renders it. The behavioural half of the
// guarantee is the email above, which drives the real send path.

describe("the leads dashboard shows it too, and never as a time", () => {
  const FILE = "src/app/(dashboard)/leads/LeadsTable.tsx";

  async function source() {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    return readFile(path.resolve(process.cwd(), FILE), "utf8");
  }

  test("the drawer reads callback_urgency out of the lead's metadata", async () => {
    const src = await source();
    assert.match(
      src,
      /metadataString\(lead,\s*"callback_urgency"\)/,
      "the urgency must be read from metadata"
    );
  });

  test("it is rendered conditionally, so nothing shows when there is none", async () => {
    const src = await source();
    assert.match(
      src,
      /\{metadataString\(lead,\s*"callback_urgency"\)\s*&&\s*\(/,
      "the note must be guarded by the value's presence"
    );
  });

  test("it is NOT bound to the date/time input", async () => {
    const src = await source();
    // The input's value comes from `datetime` state alone. If urgency
    // ever became its value or its default, the owner would see a
    // non-time in a time field and could save it into
    // preferred_datetime — the original defect, re-entered by the back
    // door.
    assert.match(
      src,
      /value=\{datetime\}/,
      "the timing input stays bound to datetime state"
    );
    assert.ok(
      !/value=\{[^}]*callback_urgency[^}]*\}/.test(src),
      "urgency must never be an input value"
    );
    assert.ok(
      !/setDatetime\([^)]*callback_urgency/.test(src),
      "urgency must never be written into the datetime state"
    );
  });

  test("it can never be saved into preferred_datetime", async () => {
    const src = await source();
    // The save payload's timing field is the input's trimmed value and
    // nothing else.
    assert.match(
      src,
      /preferred_datetime:\s*datetime\.trim\(\)\s*\|\|\s*null/,
      "the saved timing must come from the input, not from metadata"
    );
  });
});

// ── The live 2026-08-31 call — the OBEDIENT-model path ─────────────
//
// Everything above this point tests the sanitiser and the email
// renderer in isolation, and all of it passed while production quietly
// failed. That is the lesson worth keeping: those tests hand
// sendCallSummaryEmail a callbackUrgency value and check it renders.
// Nothing exercised the step that DECIDES that value.
//
// The live call:
//   User: "As soon as possible. It's urgent."
//   AI:   "Is there a particular day or time?"
//   User: "I don't have a specific time. Just as soon as possible, please."
//
// The owner's email showed "Callback date: Not provided. Callback time:
// Not provided." — right — and no Callback urgency row at all.
//
// Why: extraction.ts instructs the model "NEVER record one of them
// here; set urgent true instead", so an obedient model returns
// preferred_datetime: null and urgent: true. calls.ts read urgency
// ONLY out of preferred_datetime, so there was nothing to read.
//
// These drive the REAL processCallEnded with the HTTP layer stubbed,
// so they fail if the decision is wrong, not merely if the template is.

const URGENT_CALLBACK = {
  kind: "call-ended",
  provider: "vapi",
  dedupeKey: "vapi:urgent-callback:end-of-call-report",
  providerCallId: "aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa",
  businessPhone: "+353212345678",
  callerPhone: "+353861234567",
  direction: "inbound",
  startedAt: "2026-08-31T15:00:00.000Z",
  endedAt: "2026-08-31T15:04:00.000Z",
  durationSeconds: 240,
  endedReason: "customer-ended-call",
  summary:
    "Michael asked for the team to ring him back as early as they can. Callback date: Not provided. Callback time: Not provided.",
  transcript:
    "AI: When would suit for a callback?\nUser: As soon as possible. It's urgent.\nAI: Is there a particular day or time?\nUser: I don't have a specific time. Just as soon as possible, please.",
  recordingUrl: null,
  costUsd: null,
  costBreakdown: null,
  extracted: {
    intent: "question",
    name: "Michael Ryan",
    email: null,
    phone: null,
    service: null,
    // The model OBEYING extraction.ts: urgency never goes here.
    preferred_datetime: null,
    service_address: null,
    urgent: true,
  },
};

/** The same caller, but the model disobeyed and wrote the phrase in. */
const URGENT_CALLBACK_DISOBEDIENT_MODEL = {
  ...URGENT_CALLBACK,
  dedupeKey: "vapi:urgent-callback-2:end-of-call-report",
  providerCallId: "bbbbbbbb-8888-4888-8888-bbbbbbbbbbbb",
  extracted: {
    ...URGENT_CALLBACK.extracted,
    preferred_datetime: "as soon as possible",
  },
};

/** A caller who DID name a time. Urgency must not compete with it. */
const URGENT_WITH_A_REAL_TIME = {
  ...URGENT_CALLBACK,
  dedupeKey: "vapi:urgent-callback-3:end-of-call-report",
  providerCallId: "cccccccc-9999-4999-8999-cccccccccccc",
  extracted: {
    ...URGENT_CALLBACK.extracted,
    preferred_datetime: "Thursday afternoon",
    urgent: true,
  },
};

function installCallStubs() {
  const realFetch = globalThis.fetch;
  const inserts = [];
  const updates = [];
  const emails = [];
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
    const body = init.body ? JSON.parse(init.body) : null;

    if (url.includes("api.resend.com")) {
      emails.push(body);
      return json({ id: `email-${emails.length}` });
    }
    // No datetime to parse on a callback; answer safely if asked.
    if (url.includes("api.openai.com")) {
      return json({ choices: [{ message: { content: "NONE" } }] });
    }
    if (url.includes("/rest/v1/voice_calls")) {
      const row = { id: "call-row-1" };
      return wantsObject ? json(row) : json([row]);
    }
    if (url.includes("/rest/v1/business_knowledge")) return json([]);
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
      const row = {
        id: CALL_ORG_ID,
        owner_id: "22222222-2222-4222-8222-222222222222",
        business_name: "Acme Plumbing",
        notification_email: "owner@example.com",
        appointment_duration_minutes: 60,
        emergency_mode_enabled: false,
        max_concurrent_bookings: 1,
        timezone: "Europe/London",
      };
      return wantsObject ? json(row) : json([row]);
    }
    if (url.includes("/rest/v1/conversations")) {
      return wantsObject ? json(null) : json([]);
    }
    if (url.includes("/rest/v1/leads")) {
      if (method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-range": "*/0" },
        });
      }
      if (method === "POST") {
        const stored = { id: "lead-1", ...body };
        inserts.push(stored);
        return wantsObject ? json({ id: stored.id }) : json([{ id: stored.id }]);
      }
      if (method === "PATCH") {
        updates.push(body);
        return json([]);
      }
      if (url.includes("select=metadata")) {
        const row = { metadata: {}, appointment_datetime: null };
        return wantsObject ? json(row) : json([row]);
      }
      return wantsObject ? json(null) : json([]);
    }
    if (url.includes("/rest/v1/voice_events")) return json([{ id: "evt-1" }]);
    if (url.includes("/rest/v1/integration_connections")) {
      return wantsObject ? json(null) : json([]);
    }
    throw new Error(`Unstubbed fetch in test: ${method} ${url}`);
  };

  return {
    inserts,
    updates,
    emails,
    /** The owner's call-summary email — the one carrying the details block. */
    summaryHtml() {
      const sent = emails.find((e) =>
        String(e.html ?? "").includes("Caller ID")
      );
      return String(sent?.html ?? "");
    },
    /** Metadata written by the read-merge in recordLeadCallDetails. */
    metadata() {
      return updates.find((u) => u.metadata)?.metadata ?? null;
    },
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

const CALL_ORG_ID = "11111111-1111-4111-8111-111111111111";

async function adminClient() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

describe("the live urgent callback reaches the owner, end to end", () => {
  let stubs;
  beforeEach(() => {
    stubs = installCallStubs();
  });
  afterEach(() => stubs.restore());

  test("the owner's email carries a Callback urgency row", async () => {
    await processCallEnded(await adminClient(), CALL_ORG_ID, URGENT_CALLBACK);
    assert.match(
      stubs.summaryHtml(),
      /Callback urgency/,
      "the row the 2026-08-31 call was missing"
    );
  });

  test("the callback date and time stay unset", async () => {
    await processCallEnded(await adminClient(), CALL_ORG_ID, URGENT_CALLBACK);
    const lead = stubs.inserts[0];
    assert.equal(lead.preferred_datetime, null, "no callback time is invented");
    assert.ok(
      lead.appointment_datetime == null,
      "urgency never becomes an appointment instant"
    );
  });

  test("urgency is never rendered under a date or a time label", async () => {
    await processCallEnded(await adminClient(), CALL_ORG_ID, URGENT_CALLBACK);
    const html = stubs.summaryHtml();
    assert.ok(
      !/Callback date[\s\S]{0,80}Urgent/i.test(html),
      "must never appear under a date label"
    );
    assert.ok(
      !/>\s*Time\s*<[\s\S]{0,120}Urgent/i.test(html),
      "must never appear under a time label"
    );
  });

  test("the urgency is persisted so the leads drawer can show it too", async () => {
    await processCallEnded(await adminClient(), CALL_ORG_ID, URGENT_CALLBACK);
    const meta = stubs.metadata();
    assert.ok(meta, "the call detail write-back should have run");
    assert.ok(
      typeof meta.callback_urgency === "string" &&
        meta.callback_urgency.length > 0,
      "callback_urgency must be preserved on the lead"
    );
  });

  test("no booking confirmation is produced by an urgent callback", async () => {
    await processCallEnded(await adminClient(), CALL_ORG_ID, URGENT_CALLBACK);
    const lead = stubs.inserts[0];
    assert.notEqual(lead.status, "booked", "a callback is never a booking");
    const confirmations = stubs.emails.filter((e) =>
      /booking (is )?confirmed|your appointment is confirmed/i.test(
        String(e.subject ?? "") + String(e.html ?? "")
      )
    );
    assert.equal(confirmations.length, 0, "no false confirmation may be sent");
  });

  test("a disobedient model still yields the caller's own words", async () => {
    await processCallEnded(
      await adminClient(),
      CALL_ORG_ID,
      URGENT_CALLBACK_DISOBEDIENT_MODEL
    );
    assert.match(stubs.summaryHtml(), /Callback urgency/);
    assert.match(
      stubs.summaryHtml(),
      /as soon as possible/i,
      "when the model gives the phrase, the caller's words win"
    );
    assert.equal(stubs.inserts[0].preferred_datetime, null);
  });

  test("a real timing wins — urgency must not compete with it", async () => {
    await processCallEnded(
      await adminClient(),
      CALL_ORG_ID,
      URGENT_WITH_A_REAL_TIME
    );
    assert.equal(
      stubs.inserts[0].preferred_datetime,
      "Thursday afternoon",
      "the caller's timing is kept exactly as given"
    );
    assert.ok(
      !/Callback urgency/.test(stubs.summaryHtml()),
      "no urgency row when the caller actually named a time"
    );
  });
});
