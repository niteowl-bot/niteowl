// Regression: "Wednesday afternoon" accepted as an appointment time.
//
// Live call, 2026-08-06:
//   Caller: "I'd like to make an appointment for a burst pipe."
//   AI:     "Which day and time would be best for the repair?"
//   Caller: "Next Wednesday afternoon."
//   AI:     resolved Wednesday, 12 August — correctly — and then moved
//           straight on to the caller's name.
//
// The date resolution was right; the time was not. "Afternoon" is a
// four-hour span, and a plumber cannot be sent to a burst pipe at "the
// afternoon". Remy behaved exactly as instructed: rule 6 said a day
// plus a window "is enough", full stop.
//
// That sentence was written for CALLBACKS (2026-08-06, rule 13), where
// a window genuinely is a usable preference, and it was then applied to
// everything. The fix makes the one branch conditional on intent rather
// than adding a new rule.
//
// These tests pin both halves of that split. Prompt assertions prove
// the wording is in the built prompt, not that the model obeys it —
// only a live call does that.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildVoiceAssistantConfig } from "@/lib/voice/assistant";
import { sanitisePreferredDatetime } from "@/lib/voice/callbackTiming";

const ORG = {
  business_name: "Acme Plumbing",
  business_type: "plumber",
  primary_goal: "book jobs",
  description: null,
  website: null,
};
const MONDAY_3_AUG_2026 = new Date("2026-08-03T09:00:00+01:00");

function promptFor() {
  return buildVoiceAssistantConfig(
    ORG,
    [],
    { greeting: null, voice_id: null, language: null },
    null,
    "+353861234567",
    MONDAY_3_AUG_2026
  ).systemPrompt;
}

describe("a window is a callback preference, not an appointment time", () => {
  test("A — callback: a window is accepted and never narrowed", () => {
    const prompt = promptFor();
    assert.match(prompt, /enough for a CALLBACK — confirm the calendar date/);
    assert.match(prompt, /keep their window in their own words/);
    assert.match(prompt, /never narrow it to a single time yourself/);
  });

  test("B — appointment: the same window is NOT enough, and gets one question", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /NOT enough for an APPOINTMENT, which needs a clock time: confirm the date, then ask ONCE/
    );
    // The date is still said back — the half that already worked live.
    assert.match(
      prompt,
      /Wednesday, 12 August\. What time that afternoon would suit you\?/
    );
  });

  test("C — an explicit clock time is never asked for twice", () => {
    // "Next Wednesday at 3 PM" already carries a time, so the window
    // branch does not apply and rule 6's explicit-date branch stands.
    const prompt = promptFor();
    assert.match(
      prompt,
      /They gave an explicit DATE and time \("6 August at 2pm"\): Do NOT ask for the date again/
    );
    assert.match(prompt, /never ask a second time/);
  });

  test("D — a reasonably specific answer is accepted as spoken", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /Accept how people really answer \("3pm", "around 3", "half three", "quarter past two"\) and move on/
    );
  });

  test("the split is stated once, inside the existing branch", () => {
    // Smallest-change check: no new numbered rule was added for this.
    const prompt = promptFor();
    const ruleCount = prompt
      .split("\n")
      .filter((line) => /^\d+\.\s/.test(line)).length;
    assert.equal(ruleCount, 13, "still 13 rules — this reshaped rule 6");
    const windows = prompt.match(/They gave a DAY with a WINDOW/g) ?? [];
    assert.equal(windows.length, 1, "one branch, not two competing ones");
  });
});

describe("no availability is invented, no intent is converted", () => {
  test("Remy never claims a time is available, free or reserved", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /You cannot see a calendar, so never say a time is available, free or reserved either/
    );
    // The pre-existing booking prohibitions are still there.
    assert.match(
      prompt,
      /NEVER tell a caller their appointment is confirmed or booked/
    );
    assert.match(prompt, /never promise the slot is guaranteed/);
  });

  test("a requested time stays a REQUEST, in the existing wording", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /the time you have taken is the caller's REQUESTED or PREFERRED time, not an appointment/
    );
  });

  test("an appointment is never downgraded to a callback", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /Never downgrade an appointment to a callback because you cannot book it yourself/
    );
    // And the other direction, which rule 13 already owned.
    assert.match(prompt, /Never quietly turn it into an appointment booking/);
  });

  test("the appointment path still needs a clock time at the gate", () => {
    // Rule 5's completion gate already demanded "time"; rule 13 now
    // points at rule 6 so the two cannot drift apart.
    const prompt = promptFor();
    assert.match(prompt, /it needs a clock time, not just a window \(rule 6\)/);
    assert.match(
      prompt,
      /check you hold each of: service, calendar date, time, name, email, confirmed callback number/
    );
  });
});

describe("E — the callback timing guard is untouched by this", () => {
  // A window is still a real timing answer: it must still reach
  // preferred_datetime verbatim, for callbacks and appointments alike.
  // Only urgency-only phrases are stripped, exactly as before.
  for (const phrase of [
    "Wednesday afternoon",
    "tomorrow morning",
    "Friday evening",
    "between 2 and 5",
    "next Wednesday at 3 PM",
    "around 3 on Wednesday",
  ]) {
    test(`"${phrase}" is still stored exactly as the caller said it`, () => {
      assert.deepEqual(sanitisePreferredDatetime(phrase), {
        preferredDatetime: phrase,
        urgency: null,
      });
    });
  }

  test("and urgency is still stripped, for callbacks as before", () => {
    assert.deepEqual(sanitisePreferredDatetime("as soon as possible"), {
      preferredDatetime: null,
      urgency: "as soon as possible",
    });
  });
});

describe("G/H — behaviour the live call proved works stays put", () => {
  test("relative-date resolution is unchanged", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /work out the calendar date from today's date above and CONFIRM it/
    );
    assert.match(prompt, /Just to confirm, you mean Thursday, 6 August at 2pm\?/);
  });

  test("corrections still replace the earlier value", () => {
    const prompt = promptFor();
    assert.match(prompt, /the corrected version REPLACES what you had/);
    assert.match(prompt, /the caller's name, the day, the time/);
  });

  test("caller ID and the alternate number are untouched", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /I can use the number you're calling from\. Is that the best number to reach you on\?/
    );
    assert.match(
      prompt,
      /A different number they give is saved as an additional contact number/
    );
  });

  test("F — the endCall instruction is still in rule 11", () => {
    const prompt = promptFor();
    assert.match(prompt, /END THE CALL with the end-call tool in the same turn/);
  });
});
