// Regression tests for explicitly stated numeric dates.
//
// The bug: "Can I book an appointment for 20/08/26 at 2pm?" was handed
// to the model like any other phrase, and came back as a different date
// — read as US MM/DD, or as 2020. The customer had stated the date
// exactly and we silently changed it, so availability was checked, the
// calendar event written and the confirmation spoken against the wrong
// day.
//
// This locale is DD/MM. These tests pin that, and pin the refusal to
// guess when the text does not determine a single instant.
//
// The model is stubbed to return a DELIBERATELY WRONG answer. Every
// test that expects a correct date therefore also proves the model was
// never consulted — if the short-circuit regresses, the wrong date
// appears immediately.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installStubs } from "./support.mjs";
import {
  parseExplicitNumericDatetime,
  parseDatetimeToIso,
} from "@/lib/parseDatetime";

const TZ = "Europe/London";

/** The wall-clock time an instant lands on in the business timezone. */
function londonParts(iso) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const m = {};
  for (const p of parts) m[p.type] = p.value;
  return `${m.year}-${m.month}-${m.day} ${m.hour}:${m.minute}`;
}

describe("explicit numeric dates are resolved in code, not by the model", () => {
  // TEST 1 — the reported failure.
  test("20/08/26 at 2pm is 20 August 2026 at 14:00", () => {
    const r = parseExplicitNumericDatetime("20/08/26 at 2pm", TZ);
    assert.equal(londonParts(r.iso), "2026-08-20 14:00");
  });

  test("it is NOT read as 26 August, nor as any other year", () => {
    const r = parseExplicitNumericDatetime(
      "Can I book an appointment for 20/08/26 at 2pm?",
      TZ
    );
    const when = londonParts(r.iso);
    assert.equal(when, "2026-08-20 14:00");
    assert.ok(!when.startsWith("2020"), "read the 26 as a year");
    assert.ok(!when.includes("-08-26"), "read the day as the year digits");
  });

  test("the four-digit form agrees with the two-digit form", () => {
    const short = parseExplicitNumericDatetime("20/08/26 at 2pm", TZ);
    const long = parseExplicitNumericDatetime("20/08/2026 at 2pm", TZ);
    assert.equal(short.iso, long.iso);
  });

  test("05/09/26 is 5 September, never 9 May", () => {
    const r = parseExplicitNumericDatetime("05/09/26 at 10:00", TZ);
    assert.equal(londonParts(r.iso), "2026-09-05 10:00");
  });

  test("a day past 12 cannot be mistaken for a month either way", () => {
    const r = parseExplicitNumericDatetime("25/12/26 at 9am", TZ);
    assert.equal(londonParts(r.iso), "2026-12-25 09:00");
  });

  test("dash and dot separators mean the same thing", () => {
    const slash = parseExplicitNumericDatetime("20/08/26 at 2pm", TZ);
    for (const text of ["20-08-26 at 2pm", "20.08.26 at 2pm"]) {
      assert.equal(
        parseExplicitNumericDatetime(text, TZ).iso,
        slash.iso,
        text
      );
    }
  });
});

describe("times are read exactly, or not at all", () => {
  const cases = [
    ["20/08/26 at 2pm", "14:00"],
    ["20/08/26 at 2:30pm", "14:30"],
    ["20/08/26 at 2.30 pm", "14:30"],
    ["20/08/26 at 14:00", "14:00"],
    ["20/08/26 at 09:30", "09:30"],
    ["20/08/26 at 10:00", "10:00"],
    ["20/08/26 at 12pm", "12:00"],
    ["20/08/26 at 12am", "00:00"],
  ];

  for (const [text, expected] of cases) {
    test(`${text} → ${expected}`, () => {
      const r = parseExplicitNumericDatetime(text, TZ);
      assert.equal(londonParts(r.iso).slice(11), expected);
    });
  }

  test("a bare hour is ambiguous, so we ask instead of guessing", () => {
    const r = parseExplicitNumericDatetime("20/08/26 at 2", TZ);
    assert.equal(r.iso, null);
    assert.equal(r.needsClarification, true);
  });

  test("a date with no time at all asks rather than inventing one", () => {
    const r = parseExplicitNumericDatetime("can you do 20/08/26", TZ);
    assert.equal(r.iso, null);
    assert.equal(r.needsClarification, true);
  });
});

describe("impossible dates are never coerced into real ones", () => {
  test("32/08/26 is refused, not rolled into September", () => {
    const r = parseExplicitNumericDatetime("32/08/26 at 2pm", TZ);
    assert.equal(r.iso, null);
    assert.equal(r.needsClarification, true);
  });

  test("31/02/26 is refused, not rolled into March", () => {
    const r = parseExplicitNumericDatetime("31/02/26 at 2pm", TZ);
    assert.equal(r.iso, null);
    assert.equal(r.needsClarification, true);
  });

  test("13/20/26 is refused rather than silently re-read as MM/DD", () => {
    const r = parseExplicitNumericDatetime("13/20/26 at 2pm", TZ);
    assert.equal(r.iso, null);
    assert.equal(r.needsClarification, true);
  });
});

describe("conversational dates still reach the model untouched", () => {
  for (const text of [
    "tomorrow at 4pm",
    "next Monday 10am",
    "this Friday afternoon",
    "20th August at 2pm",
    "the following day at 11am",
  ]) {
    test(`"${text}" is not claimed by the numeric parser`, () => {
      assert.equal(parseExplicitNumericDatetime(text, TZ), null);
    });
  }
});

describe("the model is not consulted for an explicit date", () => {
  let stubs;
  afterEach(() => stubs?.restore());

  test("a wrong model answer cannot override a stated date", async () => {
    // What the model actually did with this input: US reading, wrong day.
    stubs = installStubs({ modelIso: "2026-08-26T13:00:00.000Z" });

    const r = await parseDatetimeToIso("20/08/26 at 2pm", TZ);

    assert.equal(stubs.calls.openai, 0, "the model was consulted");
    assert.equal(londonParts(r.iso), "2026-08-20 14:00");
  });

  test("a conversational date DOES still reach the model", async () => {
    stubs = installStubs({ modelIso: "2026-08-20T13:00:00.000Z" });

    await parseDatetimeToIso("tomorrow at 2pm", TZ);

    assert.equal(stubs.calls.openai, 1, "the model path regressed");
  });

  test("an explicit date still resolves with no OpenAI key present", async () => {
    stubs = installStubs({});
    const key = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const r = await parseDatetimeToIso("20/08/26 at 2pm", TZ);
      assert.equal(r.failed, false);
      assert.equal(londonParts(r.iso), "2026-08-20 14:00");
    } finally {
      if (key !== undefined) process.env.OPENAI_API_KEY = key;
    }
  });
});

// ── The date we understood, for the question we have to ask ───────
//
// Refusing to guess is only half the behaviour: Remy then has to ask
// for the missing piece, and to ask it SPECIFICALLY — "what time on
// 20 August?" rather than a bare "what time?". That needs the date we
// resolved, formatted here rather than left to the reply model, which
// is exactly the component that reads "20/08/26" as 26 August.

describe("the resolved date is named when only the time is missing", () => {
  test("a date with no time carries the date it understood", () => {
    const r = parseExplicitNumericDatetime("can you do 20/08/26", TZ);
    assert.equal(r.iso, null);
    assert.equal(r.needsClarification, true);
    assert.equal(r.clarificationDate, "20 August 2026");
  });

  test("a bare hour carries it too", () => {
    const r = parseExplicitNumericDatetime("20/08/26 at 2", TZ);
    assert.equal(r.needsClarification, true);
    assert.equal(r.clarificationDate, "20 August 2026");
  });

  test("it is DD/MM here as well — never 8 August", () => {
    // The whole point: if this ever says "8 August 2026" the parser has
    // started reading MM/DD and the question would name the wrong day.
    const r = parseExplicitNumericDatetime("05/09/26", TZ);
    assert.equal(r.clarificationDate, "5 September 2026");
  });

  test("an IMPOSSIBLE date names nothing — there is no date to name", () => {
    // The question then has to be about the date itself, so offering a
    // formatted one would be inventing the very thing we refused.
    for (const text of ["32/08/26 at 2pm", "31/02/26 at 2pm", "13/20/26 at 2pm"]) {
      const r = parseExplicitNumericDatetime(text, TZ);
      assert.equal(r.needsClarification, true, text);
      assert.equal(r.clarificationDate, undefined, text);
    }
  });

  test("a RESOLVED datetime carries neither flag", () => {
    const r = parseExplicitNumericDatetime("20/08/26 at 2pm", TZ);
    assert.ok(r.iso);
    assert.equal(r.needsClarification, undefined);
    assert.equal(r.clarificationDate, undefined);
  });

  test("the date label does not move with the timezone", () => {
    // It labels a date the customer typed, not an instant, so it must
    // read the same everywhere — a label that shifted by zone would
    // reintroduce the off-by-one-day bug in the question itself.
    for (const zone of ["Europe/London", "America/New_York", "Australia/Sydney"]) {
      const r = parseExplicitNumericDatetime("20/08/26", zone);
      assert.equal(r.clarificationDate, "20 August 2026", zone);
    }
  });
});
