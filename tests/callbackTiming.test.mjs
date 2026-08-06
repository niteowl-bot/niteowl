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

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  isUrgencyOnlyTiming,
  sanitisePreferredDatetime,
} from "@/lib/voice/callbackTiming";

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
