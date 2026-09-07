// The caller's requested day and time must survive a PARTIAL provider
// payload.
//
// `sanitisePreferredDatetime` is null-in/null-out, so
// `sanitisePreferredDatetime(details.preferred_datetime)` resolved to
// null whenever Vapi's structuredData omitted the field — on calls whose
// transcript plainly carried the day the caller was asked for and gave.
// The transcript already reached `toExtractedLead` and was read there for
// the caller's name, address and email; timing was the field with the
// evidence available and no reader for it.
//
// The loss is not cosmetic. With no timing there is no instant, so
// `isBookingConfirmed` cannot confirm, no calendar event is written, the
// owner sees no requested-appointment row and no booking-status block,
// and a caller who said when they wanted the visit gets a request nobody
// can act on.
//
// WHAT THIS GUARD IS, AND IS NOT. It is EVIDENCE SELECTION, not datetime
// parsing. It recovers the caller's PHRASE and hands it to exactly the
// same downstream path a provider phrase takes — `parseDatetimeToIso`,
// with the organisation's timezone, DST and weekday correction. Nothing
// here resolves, completes, repairs or invents a datetime, and the
// existing sanitiser is imported unchanged: a recovered value passes the
// same urgency filter the provider's does (the PR #35 rule).
//
// THE AUTHORITY ORDER, and every test below pins one part of it:
//   1. a provider timing that survives the sanitiser WINS, byte for
//      byte, and the transcript is not consulted at all;
//   2. a provider URGENCY answer is preserved and blocks recovery — the
//      caller was asked and answered, so a day mentioned elsewhere on
//      the call must not outrank them;
//   3. only a genuinely ABSENT value admits caller evidence;
//   4. evidence is caller-turn only, anchored to an explicit timing
//      question or an explicit caller cue, and must pin a DAY of its
//      own. A clock with no day recovers nothing, because the day would
//      have to come from the assistant.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  findSpokenDatetime,
  resolveRequestedDatetime,
} from "@/lib/voice/datetimeIntegrity";
import { parseVapiWebhook } from "@/lib/voice/vapi";
import { processCallEnded } from "@/lib/voice/calls";

const T = (...turns) => turns.join("\n");

/** A plain "we asked, they answered" call carrying one stated timing. */
const asked = (answer) =>
  T(
    "AI: How can I help?",
    "User: My radiator is leaking.",
    "AI: When suits you best?",
    `User: ${answer}`
  );

// ── 1. The structured value wins outright ──────────────────────────

describe("a provider timing is authoritative", () => {
  test("kept byte for byte, and the transcript is never consulted", () => {
    const timing = resolveRequestedDatetime(
      "Thursday 20 August at 3 PM",
      asked("Friday at 2 PM.")
    );
    assert.equal(timing.preferredDatetime, "Thursday 20 August at 3 PM");
    assert.equal(timing.urgency, null);
  });

  test("a vague provider value is still the provider's value", () => {
    const timing = resolveRequestedDatetime("tomorrow", asked("Friday at 2 PM."));
    assert.equal(timing.preferredDatetime, "tomorrow");
  });

  test("surrounding whitespace does not make a real value absent", () => {
    const timing = resolveRequestedDatetime("  Friday at 2  ", asked("Monday."));
    assert.equal(timing.preferredDatetime, "Friday at 2");
  });

  test("a provider URGENCY answer is preserved and blocks recovery", () => {
    // The caller was ASKED and said "as soon as possible". That is an
    // answer, not an absence — a day mentioned elsewhere must not
    // displace it, and the owner still gets the urgency row (PR #35).
    const timing = resolveRequestedDatetime(
      "as soon as possible",
      T(
        "AI: When suits you best?",
        "User: As soon as possible.",
        "AI: What day would suit?",
        "User: Friday at 2 PM."
      )
    );
    assert.equal(timing.preferredDatetime, null, "urgency is never a time");
    assert.equal(timing.urgency, "as soon as possible", "and it is not lost");
  });

  test("urgency still blocks recovery when the day arrives behind a caller cue", () => {
    // The second shape of the same rule: not an answer to a timing
    // question but a volunteered aside. The caller's ANSWER about when
    // was "as soon as possible", and that stands.
    const timing = resolveRequestedDatetime(
      "asap",
      T(
        "AI: When suits you best?",
        "User: ASAP.",
        "AI: Anything else?",
        "User: Can you come Friday at 2 if that's easier?"
      )
    );
    assert.equal(timing.preferredDatetime, null);
    assert.equal(timing.urgency, "asap");
  });

  test("no provider value and no evidence records nothing", () => {
    assert.deepEqual(resolveRequestedDatetime(null, "AI: Hello. User: Hi."), {
      preferredDatetime: null,
      urgency: null,
    });
    assert.deepEqual(resolveRequestedDatetime(null, null), {
      preferredDatetime: null,
      urgency: null,
    });
  });
});

// ── 2. Recovery, when the provider said nothing ────────────────────

describe("an omitted field is recovered from the caller's own turn", () => {
  const recovered = (answer) =>
    resolveRequestedDatetime(null, asked(answer)).preferredDatetime;

  test("a concrete day and time", () => {
    assert.equal(recovered("Thursday 20 August at 3 PM."), "Thursday 20 August at 3 PM");
  });

  test("tomorrow", () => {
    assert.equal(recovered("Tomorrow."), "Tomorrow");
  });

  test("tomorrow morning", () => {
    assert.equal(recovered("Tomorrow morning."), "Tomorrow morning");
  });

  test("this afternoon", () => {
    assert.equal(recovered("This afternoon."), "This afternoon");
  });

  test("a named weekday alone", () => {
    assert.equal(recovered("Friday."), "Friday");
  });

  test("a named weekday with a time", () => {
    assert.equal(recovered("Friday at 2."), "Friday at 2");
  });

  test("an explicit numeric date", () => {
    assert.equal(recovered("20/08/26 at 3pm."), "20/08/26 at 3pm");
  });

  test("an ordinal date and time", () => {
    assert.equal(recovered("The 10th at 3pm."), "The 10th at 3pm");
  });

  test("a spelled ordinal with its month", () => {
    assert.equal(
      recovered("The twelfth of July at 10 AM."),
      "The twelfth of July at 10 AM"
    );
  });

  test("an answer prefix is not part of the answer", () => {
    assert.equal(recovered("Yes, Friday at 2."), "Friday at 2");
    assert.equal(recovered("No, Friday at 2."), "Friday at 2");
  });

  test("a comma-separated date survives whole rather than being cut down", () => {
    assert.equal(
      recovered("Thursday, 20 August, at 3 PM."),
      "Thursday, 20 August, at 3 PM"
    );
  });

  test("a trailing aside is trimmed, the timing is not", () => {
    assert.equal(recovered("Friday at 2, if that's easier."), "Friday at 2");
  });

  test("a leading aside is trimmed, the timing is not", () => {
    assert.equal(recovered("My name is John Smith, Friday at 2."), "Friday at 2");
  });

  test("volunteered behind an explicit caller cue, with no question asked", () => {
    const transcript = T(
      "AI: How can I help?",
      "User: My radiator is leaking. Can you come Friday at 2?"
    );
    assert.equal(
      resolveRequestedDatetime(null, transcript).preferredDatetime,
      "Friday at 2"
    );
  });

  test("an inline transcript with no newlines reads the same", () => {
    const transcript =
      "AI: How can I help? User: A leak. AI: When suits you best? User: Friday at 2.";
    assert.equal(
      resolveRequestedDatetime(null, transcript).preferredDatetime,
      "Friday at 2"
    );
  });
});

// ── 3. Corrections — the last anchored caller value wins ───────────

describe("the caller's last reliable word wins", () => {
  test("a self-correction inside one turn", () => {
    assert.equal(
      findSpokenDatetime(asked("Thursday. Actually, make it Friday at 2.")),
      "Friday at 2"
    );
  });

  test("a change of mind later in the call", () => {
    const transcript = T(
      "AI: When suits you best?",
      "User: Thursday at 10.",
      "AI: And your address?",
      "User: 81 Oakland Drive.",
      "AI: What day would suit for the visit?",
      "User: Sorry, can you come Friday at 2 instead?"
    );
    assert.equal(findSpokenDatetime(transcript), "Friday at 2 instead");
  });

  test("two answers to two timing questions — the later one stands", () => {
    const transcript = T(
      "AI: When suits you best?",
      "User: Thursday at 10.",
      "AI: Sorry, what day was that?",
      "User: Friday at 2."
    );
    assert.equal(findSpokenDatetime(transcript), "Friday at 2");
  });

  test("an earlier value is never resurrected by a later non-answer", () => {
    const transcript = T(
      "AI: When suits you best?",
      "User: Thursday at 10.",
      "AI: Just to confirm, Thursday at 10?",
      "User: That's right."
    );
    assert.equal(findSpokenDatetime(transcript), "Thursday at 10");
  });
});

// ── 4. Assistant speech is never caller evidence ───────────────────

describe("only the caller can supply the timing", () => {
  test("the assistant suggests and the caller merely agrees — nothing", () => {
    const transcript = T(
      "AI: How can I help?",
      "User: My radiator is leaking.",
      "AI: Does Tuesday at 2 suit you?",
      "User: Yes."
    );
    assert.equal(findSpokenDatetime(transcript), null);
    assert.equal(resolveRequestedDatetime(null, transcript).preferredDatetime, null);
  });

  test("every other bare acknowledgement is the same", () => {
    for (const reply of [
      "Correct.",
      "That's right.",
      "That's fine.",
      "Perfect.",
      "Okay.",
      "Grand.",
      "Sure.",
    ]) {
      const transcript = T("AI: Does Tuesday at 2 suit you?", `User: ${reply}`);
      assert.equal(findSpokenDatetime(transcript), null, reply);
    }
  });

  test("an assistant read-back alone recovers nothing", () => {
    const transcript = T(
      "AI: So that's Tuesday the 12th at 2 PM, is that right?",
      "User: Yeah."
    );
    assert.equal(findSpokenDatetime(transcript), null);
  });

  test("an assistant turn is not read even when it is the only timing on the call", () => {
    const transcript = T(
      "AI: Our next free slot is Tuesday at 2 PM.",
      "User: Hmm.",
      "AI: Anything else?",
      "User: No, that's everything."
    );
    assert.equal(findSpokenDatetime(transcript), null);
  });

  test("an assistant offer phrased EXACTLY like the caller's own cue is still not evidence", () => {
    // The sharp case, and the one the first draft of these tests could
    // not tell apart: "How about Tuesday at 2?" is a recognised
    // self-declaration cue, so ONLY the speaker separates the
    // assistant's suggestion from the caller volunteering a time. Read
    // the assistant's turn and its own proposal becomes the caller's
    // evidence — which is how a model-generated time gets laundered
    // into a booking nobody asked for.
    const transcript = T(
      "AI: I have a slot free. How about Tuesday at 2?",
      "User: Yes, that's fine."
    );
    assert.equal(findSpokenDatetime(transcript), null);
    assert.equal(resolveRequestedDatetime(null, transcript).preferredDatetime, null);
  });

  test("the ordinary shape: asked, unsure, offered a slot, agreed", () => {
    // How this actually happens on a call. The only concrete time on it
    // is the assistant's, and the caller never says one — so there is
    // nothing to recover, and the request stays honestly timeless.
    const transcript = T(
      "AI: When suits you best?",
      "User: I'm not sure, to be honest.",
      "AI: How about Friday at 2?",
      "User: Yes, go on."
    );
    assert.equal(findSpokenDatetime(transcript), null);
  });

  test("a caller who states the time themselves IS evidence", () => {
    // The distinction is the speaker, not the value: they said it.
    const transcript = T(
      "AI: Does Tuesday at 2 suit you?",
      "User: Yes, Tuesday at 2 is perfect."
    );
    assert.equal(findSpokenDatetime(transcript), "Tuesday at 2 is perfect");
  });
});

// ── 5. False positives — ordinary speech is not a booking ──────────

describe("ordinary speech is never read as a requested time", () => {
  const nothing = (answer) => {
    const transcript = asked(answer);
    assert.equal(findSpokenDatetime(transcript), null, answer);
  };

  test("a house number", () => nothing("81 Oakland Drive."));
  test("a house number on a street named after a day", () =>
    nothing("3 Sunday Close."));
  test("a phone number", () => nothing("It's 087 123 4567."));
  test("a duration", () => nothing("It's been leaking for three days."));
  test("a numeric duration", () => nothing("It's been going for 2 weeks."));
  test("a quantity", () => nothing("There are 2 radiators."));
  test("urgency", () => nothing("As soon as possible."));
  test("indifference", () => nothing("Any time, really."));
  test("a clock with no day of its own", () => nothing("3 PM."));
  test("a bare day part", () => nothing("The afternoon."));
  test("a vague future", () => nothing("Sometime next week."));
  test("a refusal", () => nothing("I don't have a specific time."));

  test("an unanchored turn is not read, however concrete it sounds", () => {
    // No timing question, no caller cue — the caller is describing the
    // problem, not booking. Anchoring is what separates the two.
    const transcript = T(
      "AI: What seems to be the problem?",
      "User: It started leaking Friday at 2 and hasn't stopped."
    );
    assert.equal(findSpokenDatetime(transcript), null);
  });

  test("a rambling turn is not stored as a timing", () => {
    const long =
      "Well Friday would probably be alright although I might be at my mother's " +
      "house and the dog needs collecting from the vet at some point as well";
    assert.equal(findSpokenDatetime(asked(long + ".")), null);
  });
});

// ── 6. The real path ───────────────────────────────────────────────

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const APPOINTMENT_ISO = "2026-08-20T14:00:00.000Z";

const RICH_TRANSCRIPT = T(
  "AI: How can I help?",
  "User: My radiator is leaking.",
  "AI: Can I take your name?",
  "User: Jason Test.",
  "AI: And your email?",
  "User: jason test at gmail dot com.",
  "AI: What's the address?",
  "User: 81 Oakland Drive.",
  "AI: When suits you best?",
  "User: Thursday 20 August at 3 PM."
);

/** Builds a REAL Vapi end-of-call payload and parses it for real. */
function parsedEvent(id, structuredData) {
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
      transcript: RICH_TRANSCRIPT,
      analysis: { summary: "Caller rang about a radiator.", structuredData },
    },
  });
  assert.ok(event, "the webhook parsed");
  return event;
}

function installStubs() {
  process.env.VOICE_CALENDAR_BOOKING_ENABLED = "true";

  const realFetch = globalThis.fetch;
  const leads = new Map();
  const emails = [];
  const extractionPrompts = [];
  const datetimePrompts = [];
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
        datetimePrompts.push(prompt);
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
    datetimePrompts,
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

describe("the real end-of-call path", () => {
  let stubs;
  afterEach(() => stubs?.restore());

  /** Runs one call and returns what the lead and the owner ended up with. */
  async function run(id, structuredData) {
    stubs = installStubs();
    await processCallEnded(await admin(), ORG_ID, parsedEvent(id, structuredData));
    const lead = stubs.only();
    const html = stubs.ownerHtml();
    return {
      lead,
      html,
      extractorRuns: stubs.extractionPrompts.length,
      datetimeRuns: stubs.datetimePrompts.length,
      restore: stubs.restore,
    };
  }

  const COMPLETE = {
    intent: "new_booking",
    name: "Jason Test",
    service: "leaking radiator",
    service_address: "81 Oakland Drive",
    preferred_datetime: "Thursday 20 August at 3 PM",
  };
  /** The same payload, with only the timing field missing. */
  const PARTIAL = { ...COMPLETE, preferred_datetime: undefined };

  test("a partial payload's omitted timing survives into the lead", async () => {
    const { lead, extractorRuns } = await run(
      "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      PARTIAL
    );

    assert.equal(
      extractorRuns,
      0,
      "producer selection is untouched — the fallback extractor never runs"
    );
    assert.equal(
      lead.preferred_datetime,
      "Thursday 20 August at 3 PM",
      "the caller's own words, recovered"
    );
    // The fields that already worked are unaffected.
    assert.equal(lead.name, "Jason Test");
    assert.equal(lead.email, "jasontest@gmail.com");
    assert.equal(lead.service_needed, "leaking radiator");
  });

  test("the owner sees the requested appointment", async () => {
    const { html } = await run("bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", PARTIAL);
    const appointment = detailsRow(html, "Appointment");
    const requested = detailsRow(html, "Requested appointment");
    assert.ok(
      appointment || requested,
      "the owner is told about the timing one way or the other"
    );
    assert.equal(
      detailsRow(html, "Callback urgency"),
      null,
      "a real timing is never rendered as urgency"
    );
  });

  test("booking and calendar behaviour is IDENTICAL to the complete payload", async () => {
    // The proof that this guard changes what is KNOWN and nothing about
    // what is DONE with it: the same call, once with the provider
    // supplying the timing and once with it omitted, must settle the
    // same way.
    const withValue = await run("cccccccc-3333-4333-8333-cccccccccccc", COMPLETE);
    withValue.restore();
    const recovered = await run("dddddddd-4444-4444-8444-dddddddddddd", PARTIAL);

    // Non-vacuity first: the comparison below is only worth anything if
    // the complete payload actually books something.
    assert.equal(
      withValue.lead.appointment_datetime,
      APPOINTMENT_ISO,
      "the control call really did resolve an instant"
    );
    assert.equal(withValue.datetimeRuns, 1, "and really did parse it once");

    assert.equal(
      recovered.lead.preferred_datetime,
      withValue.lead.preferred_datetime,
      "same stored phrase"
    );
    assert.equal(
      recovered.lead.appointment_datetime,
      withValue.lead.appointment_datetime,
      "same resolved instant"
    );
    assert.equal(recovered.lead.status, withValue.lead.status, "same status");
    assert.equal(
      recovered.datetimeRuns,
      withValue.datetimeRuns,
      "the same single datetime parse — no extra model call is introduced"
    );
    assert.equal(
      detailsRow(recovered.html, "Appointment"),
      detailsRow(withValue.html, "Appointment"),
      "same owner Appointment row"
    );
    assert.equal(
      detailsRow(recovered.html, "Requested appointment"),
      detailsRow(withValue.html, "Requested appointment"),
      "same owner Requested row"
    );
  });

  test("a present provider timing is never overridden by the transcript", async () => {
    // The transcript says Thursday 20 August at 3 PM; the provider says
    // Monday. The provider wins — this is not "the transcript wins".
    const { lead } = await run("eeeeeeee-5555-4555-8555-eeeeeeeeeeee", {
      ...COMPLETE,
      preferred_datetime: "Monday at 9 AM",
    });
    assert.equal(lead.preferred_datetime, "Monday at 9 AM");
  });

  test("an assistant-suggested time the caller merely accepted books NOTHING", async () => {
    // The false positive that would matter most on the real path: the
    // only concrete time on the call is the assistant's own, and
    // adopting it would create a booking the caller never asked for.
    const event = parseVapiWebhook({
      message: {
        type: "end-of-call-report",
        call: { id: "12121212-8888-4888-8888-121212121212" },
        customer: { number: "+353861234567" },
        phoneNumber: { number: "+353212345678" },
        startedAt: "2026-08-17T10:00:00.000Z",
        endedAt: "2026-08-17T10:05:00.000Z",
        durationSeconds: 300,
        endedReason: "customer-ended-call",
        transcript: T(
          "AI: How can I help?",
          "User: My radiator is leaking.",
          "AI: When suits you best?",
          "User: I'm not sure, to be honest.",
          "AI: How about Thursday 20 August at 3 PM?",
          "User: Yes, that's fine."
        ),
        analysis: {
          summary: "Caller rang about a radiator.",
          structuredData: {
            intent: "new_booking",
            name: "Jason Test",
            service: "leaking radiator",
          },
        },
      },
    });
    stubs = installStubs();
    await processCallEnded(await admin(), ORG_ID, event);

    const lead = stubs.only();
    assert.equal(lead.preferred_datetime, null, "the caller stated no time");
    assert.equal(lead.appointment_datetime, null, "so nothing was booked");
    assert.notEqual(lead.status, "booked");
    assert.equal(
      stubs.datetimePrompts.length,
      0,
      "and nothing was parsed, because nothing was requested"
    );
  });

  test("an urgency-only call still recovers nothing and still reports urgency", async () => {
    const event = parseVapiWebhook({
      message: {
        type: "end-of-call-report",
        call: { id: "ffffffff-6666-4666-8666-ffffffffffff" },
        customer: { number: "+353861234567" },
        phoneNumber: { number: "+353212345678" },
        startedAt: "2026-08-17T10:00:00.000Z",
        endedAt: "2026-08-17T10:05:00.000Z",
        durationSeconds: 300,
        endedReason: "customer-ended-call",
        transcript: T(
          "AI: How can I help?",
          "User: My radiator is leaking.",
          "AI: When suits you best?",
          "User: As soon as possible. It's urgent."
        ),
        analysis: {
          summary: "Urgent radiator call.",
          structuredData: {
            intent: "new_booking",
            name: "Jason Test",
            service: "leaking radiator",
            urgent: true,
          },
        },
      },
    });
    stubs = installStubs();
    await processCallEnded(await admin(), ORG_ID, event);

    const lead = stubs.only();
    assert.equal(lead.preferred_datetime, null, "urgency is never a time");
    assert.equal(
      lead.metadata?.callback_urgency,
      "Urgent — no specific day or time given",
      "and the owner still learns the caller was urgent (PR #35)"
    );
    assert.equal(
      stubs.datetimePrompts.length,
      0,
      "nothing was parsed, because nothing was requested"
    );
  });
});
