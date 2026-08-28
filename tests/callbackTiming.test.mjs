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

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  isUrgencyOnlyTiming,
  sanitisePreferredDatetime,
} from "@/lib/voice/callbackTiming";
import { sendCallSummaryEmail } from "@/lib/email";

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
