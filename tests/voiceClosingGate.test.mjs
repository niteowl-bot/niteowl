// Regression coverage for the 2026-09-01 production call, where Remy
// entered closing-style dialogue before rule 5's COMPLETION GATE was
// satisfied.
//
// The call, in brief: the caller wanted an urgent service visit for a
// leaking radiator and could not give a day or a time. Remy handled the
// urgency correctly (rule 6), collected the name, the address and the
// callback number — and then went straight to "Is there anything else I
// can help you with today?" with the EMAIL never asked for and no recap
// and no confirmation. It asked "anything else?" a second time as well.
//
// The trigger is visible in the transcript. The moment the caller
// declined a time, Remy spoke rule 11's urgent CLOSING line mid-call —
// "I'll note this as urgent and pass your request to the team straight
// away" — and repeated it verbatim at the number step. Having spoken a
// closing, it behaved as though the call was closing.
//
// So the defect is NOT "Remy forgot the email". It is that closing-style
// dialogue could begin before the gate was satisfied. The invariant these
// tests pin is:
//
//   Closing dialogue is forbidden until the applicable required-field
//   gate is satisfied — and an urgent handoff acknowledgement is not
//   closing dialogue, so saying one never licenses the transition.
//
// Two kinds of test below. The first pin the invariant's wording, because
// the prompt IS the mechanism — there is no state machine to test, the
// live tool surface being exactly endCall and check_availability. The
// second parse the gate back out of the prompt and REPLAY the real call
// against it, so the collision that string-presence tests missed —
// urgent request + no time + email still required — is checked as a
// sequence rather than as a sentence that exists somewhere.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildVoiceAssistantConfig } from "@/lib/voice/assistant";

const ORG = {
  business_name: "Acme Plumbing",
  business_type: "plumber",
  primary_goal: "book jobs",
  description: null,
  website: null,
};
const SETTINGS = { greeting: null, voice_id: null, language: null };
const CALLER = "+353861234567";
const MONDAY_3_AUG_2026 = new Date("2026-08-03T09:00:00+01:00");

function promptFor(callerPhone = CALLER, now = MONDAY_3_AUG_2026) {
  return buildVoiceAssistantConfig(ORG, [], SETTINGS, null, callerPhone, now)
    .systemPrompt;
}

// ── Parsing the gate back out of the prompt ────────────────────────
// The model below is built FROM the prompt, never hard-coded beside it.
// If the gate stops naming a field, or stops blocking an action, these
// tests change their mind with it — which is the point: they assert the
// prompt's own rule, not a copy of it that can drift.

function gateBlock(prompt) {
  const start = prompt.indexOf("COMPLETION GATE");
  assert.notEqual(start, -1, "rule 5 should still have a COMPLETION GATE");
  const end = prompt.indexOf("\n6. ", start);
  return prompt.slice(start, end === -1 ? undefined : end);
}

/** The fields the gate says must be held, normalised to bare names. */
function requiredFields(prompt) {
  const match = /check you hold each of: (.+?)\. Ask for anything missing/.exec(
    gateBlock(prompt)
  );
  assert.ok(match, "the gate should still enumerate what must be held");
  return match[1]
    .split(",")
    .map((part) =>
      part
        .trim()
        .replace(/^and\s+/i, "")
        .replace(/^the\s+/i, "")
        .replace(/^confirmed\s+/i, "")
        .replace(/\s+whenever the job happens at their premises$/i, "")
        .trim()
    )
    .filter(Boolean);
}

/**
 * A deliberately small model of the gate: which conversational moves
 * are closing moves, and whether the gate currently permits one.
 *
 * `held` is what the caller has actually settled — a field they refused
 * or could not give counts as settled, exactly as the gate says ("A
 * caller who refuses or cannot give a detail counts as done for it").
 */
function gateState(prompt, held) {
  const required = requiredFields(prompt);
  const open = required.filter((field) => !held.has(field));
  return {
    required,
    open,
    satisfied: open.length === 0,
    // Every one of these is a closing move, and the gate blocks all of
    // them together — that is what made the live call's "anything else?"
    // a defect rather than a stylistic slip.
    mayClose(move) {
      assert.ok(
        ["anything else?", "recap", "goodbye", "closing line"].includes(move),
        `unknown move: ${move}`
      );
      return open.length === 0;
    },
  };
}

// The real 2026-09-01 call, turn by turn, in the order it happened.
// `settles` is what the caller actually gave or declined on that turn.
const LIVE_CALL_2026_09_01 = [
  { caller: "Hi. I have a leaking radiator. And I need someone as soon as possible.", settles: ["service"] },
  // Rule 6 asked for a day and time; the caller declined one twice. A
  // declined detail counts as settled, so date and time close here —
  // and nothing else does.
  { caller: "As soon as possible.", settles: [] },
  { caller: "No. Just as soon as possible. It's urgent.", settles: ["calendar date", "time"] },
  { caller: "Ernesto. Ernesto.", settles: ["name"] },
  { caller: "K e 1 Auckland Drive.", settles: [] },
  { caller: "No. A c 1. Oakland Drive,", settles: ["address"] },
  { caller: "This number that I'm calling from,", settles: ["callback number"] },
];

/** Replays the turns and returns what is settled at the end. */
function replay(turns) {
  const held = new Set();
  for (const turn of turns) for (const field of turn.settles) held.add(field);
  return held;
}

describe("the invariant: no closing dialogue before the gate is satisfied", () => {
  test("urgency never opens the gate, and an urgent service visit keeps rule 5's list", () => {
    const gate = gateBlock(promptFor());
    assert.match(gate, /URGENCY NEVER OPENS THE GATE/);
    // The live call's exact shape: urgent, and no day or time obtainable.
    assert.match(
      gate,
      /An urgent caller, and a caller who could not give a day or a time, still get this whole list/
    );
    // Rule 13's shorter list is what would have made the missing email
    // legitimate. It does not apply to a service visit.
    assert.match(
      gate,
      /An urgent SERVICE VISIT is a service request, not a callback: it keeps this list, and rule 13's shorter one does NOT apply to it/
    );
  });

  test("declining a time settles the time and nothing else", () => {
    const gate = gateBlock(promptFor());
    assert.match(
      gate,
      /Declining a time settles the TIME and nothing else — it is not a reason to stop collecting, and it is never a sign the call is ready to end/
    );
  });

  test("email is named as the step this failure loses", () => {
    assert.match(
      gateBlock(promptFor()),
      /Email is the step most often lost this way: check it explicitly before you go anywhere near the recap/
    );
  });

  test("a handoff acknowledgement is not a closing", () => {
    const gate = gateBlock(promptFor());
    assert.match(gate, /TELLING THE CALLER THE TEAM WILL BE IN TOUCH IS NOT A CLOSING/);
    // Both wordings Remy actually used on the live call.
    assert.match(gate, /I'll note that as urgent/);
    assert.match(gate, /I'll pass your request to the team straight away/);
    // Saying it is allowed — it is the TRANSITION that is forbidden.
    assert.match(gate, /you may give one the moment it is true \(rules 6, 12 and 13\)/);
    assert.match(gate, /Saying it changes NOTHING about where you are in this list/);
  });

  test("the handoff acknowledgement may not be followed by any closing move", () => {
    // The exact transition the live call made.
    assert.match(
      gateBlock(promptFor()),
      /Never follow one with "anything else\?", a recap, a goodbye, or rule 11's closing line — follow it with the very next unfinished item above/
    );
  });

  test("rule 11's closing lines are end-of-call only, and are gated", () => {
    const prompt = promptFor();
    assert.match(prompt, /THE FOUR LINES BELOW ARE CLOSING LINES/);
    assert.match(
      prompt,
      /Never speak one — least of all the callback\/urgent one — while a required field from rule 5 is still open/
    );
    assert.match(
      gateBlock(prompt),
      /forbidden until this gate is satisfied AND the caller has confirmed the recap/
    );
  });

  test("having already said it never counts as having closed", () => {
    const prompt = promptFor();
    assert.match(
      gateBlock(prompt),
      /having said something that sounded like one earlier never counts as having closed/
    );
    // And the debt is spelled out, so a model that already said it knows
    // what it still owes.
    assert.match(
      prompt,
      /If you already told the caller you would pass their details to the team, you STILL owe them every remaining question, the recap, and their confirmation of it/
    );
  });

  test("rule 11 defers to the gate for when the call may end", () => {
    assert.match(
      promptFor(),
      /Once every step of rule 5 that applies is done — that is, once its COMPLETION GATE is satisfied and not before/
    );
  });

  test("rule 6's urgency-only acknowledgement is not a closing", () => {
    const prompt = promptFor();
    // The acknowledgement itself survives untouched (PR #35 wording).
    assert.match(
      prompt,
      /I'll note that and ask the team to ring you as early as they can/
    );
    assert.match(prompt, /THAT ACKNOWLEDGEMENT IS NOT A CLOSING: it settles the timing question and nothing else/);
    // And it names where to go instead — email included, in order.
    assert.match(
      prompt,
      /Go straight on to the next unfinished step of rule 5 — their name, then their email, then the address, then the number — never to a recap, "anything else\?" or a goodbye/
    );
  });

  test("rule 12's callback assurance is not a closing either", () => {
    assert.match(
      promptFor(),
      /that assurance is an acknowledgement, not a closing, so carry straight on through rule 5 and its COMPLETION GATE/
    );
  });

  test("rule 13 separates its mid-call handoff phrase from rule 11's closing", () => {
    assert.match(
      promptFor(),
      /Either is an ACKNOWLEDGEMENT wherever it falls mid-call, never the closing — rule 11's closing line is a different sentence, spoken only after rule 5's COMPLETION GATE is satisfied and the recap confirmed/
    );
  });
});

describe("the sequence the string tests missed: urgent + no time + email required", () => {
  test("the gate still names email among the required fields", () => {
    // Parsed from the prompt, not asserted against a copy of it.
    assert.ok(requiredFields(promptFor()).includes("email"));
  });

  test("replaying the real call leaves EXACTLY email open", () => {
    const prompt = promptFor();
    const held = replay(LIVE_CALL_2026_09_01);
    const state = gateState(prompt, held);

    // Everything the caller actually settled, including the declined
    // date and time, is accounted for. Only email is missing — which is
    // precisely what the owner's email showed as "Not provided".
    assert.deepEqual(state.open, ["email"]);
    assert.equal(state.satisfied, false);
  });

  test("at that point every closing move is forbidden", () => {
    const state = gateState(promptFor(), replay(LIVE_CALL_2026_09_01));

    // The live call made the first of these. All four are blocked.
    assert.equal(state.mayClose("anything else?"), false);
    assert.equal(state.mayClose("recap"), false);
    assert.equal(state.mayClose("goodbye"), false);
    assert.equal(state.mayClose("closing line"), false);
  });

  test("declining the day and time does not settle anything else", () => {
    // Stop the replay immediately after the caller declined a time —
    // the exact turn where Remy began closing-style dialogue.
    const throughDecline = LIVE_CALL_2026_09_01.slice(0, 3);
    const state = gateState(promptFor(), replay(throughDecline));

    assert.equal(state.satisfied, false);
    for (const field of ["name", "email", "address", "callback number"]) {
      assert.ok(state.open.includes(field), `${field} should still be open`);
    }
    assert.equal(state.mayClose("anything else?"), false);
  });

  test("collecting the email is what releases the gate", () => {
    const prompt = promptFor();
    const held = replay(LIVE_CALL_2026_09_01);
    assert.equal(gateState(prompt, held).satisfied, false);

    held.add("email");
    const state = gateState(prompt, held);
    assert.equal(state.satisfied, true);
    assert.deepEqual(state.open, []);
    assert.equal(state.mayClose("anything else?"), true);
    assert.equal(state.mayClose("recap"), true);
  });

  test("a caller who REFUSES the email releases the gate too — refusal is not a blocker", () => {
    // The gate says a refused detail counts as done. Remy must never be
    // trapped into pressing a caller who will not give an address.
    assert.match(
      gateBlock(promptFor()),
      /A caller who refuses or cannot give a detail counts as done for it — acknowledge once \("No problem\."\), never press, never invent it/
    );
    const held = replay(LIVE_CALL_2026_09_01);
    held.add("email"); // settled by refusal
    assert.equal(gateState(promptFor(), held).satisfied, true);
  });

  test("a caller who gives a real day and time reaches the close normally", () => {
    // The ordinary path must be unaffected: every field settled, so
    // every closing move is permitted.
    const ordinary = [
      { caller: "I need a boiler service.", settles: ["service"] },
      { caller: "Thursday at 2pm.", settles: ["calendar date", "time"] },
      { caller: "Brian.", settles: ["name"] },
      { caller: "brian at example dot com", settles: ["email"] },
      { caller: "14 Mill Road, Galway.", settles: ["address"] },
      { caller: "Yes, this number is fine.", settles: ["callback number"] },
    ];
    const state = gateState(promptFor(), replay(ordinary));
    assert.equal(state.satisfied, true);
    assert.equal(state.mayClose("closing line"), true);
  });

  test("the recap and the confirmation still precede the close", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /the call ends in THIS order: recap, then their confirmation of it, then "anything else\?", then goodbye/
    );
    assert.match(
      prompt,
      /Never ask "anything else\?" before the caller has confirmed the recap/
    );
    // And "anything else?" stays a once-per-call question — the live
    // call asked it twice.
    assert.match(prompt, /Ask it ONCE per call — never twice/);
  });
});

describe("behaviour that must survive this change", () => {
  test("PR #35: urgency is still not a date or a time", () => {
    const prompt = promptFor();
    assert.match(prompt, /URGENCY IS NOT A DATE OR A TIME/);
    assert.match(
      prompt,
      /NEVER accept one as the day, as the time, or as both, and never record it as either/
    );
    // The extraction schema's half of the same rule.
    const schema = buildVoiceAssistantConfig(
      ORG,
      [],
      SETTINGS,
      null,
      CALLER,
      MONDAY_3_AUG_2026
    ).structuredDataSchema;
    assert.match(schema.properties.preferred_datetime.description, /URGENCY IS NOT A TIME/);
    assert.match(schema.properties.urgent.description, /True if the caller was urgent/);
  });

  test("the caller is not pressed for a time they have already declined", () => {
    const prompt = promptFor();
    assert.match(prompt, /Ask at most twice; if they still cannot commit, accept what they gave/);
    assert.match(prompt, /never press, never invent it/);
  });

  test("PR #37: booking wording is untouched", () => {
    const prompt = promptFor();
    assert.match(prompt, /NEVER tell a caller their appointment is confirmed or booked/);
    assert.match(prompt, /A time it reports as available is still only a REQUEST — never say reserved/);
    assert.match(prompt, /That time is currently showing as available/);
  });

  test("PR #39: the name and email steps keep their own read-back rules", () => {
    const prompt = promptFor();
    assert.match(prompt, /Their email — ask "May I have your email address, please\?"/);
    assert.match(prompt, /This one read-back always happens/);
    assert.match(prompt, /Their name — take an ordinary name as given/);
  });

  test("rule 13's callback list is still the shorter one", () => {
    const prompt = promptFor();
    assert.match(prompt, /An email and a service address are not required for a callback/);
    assert.match(prompt, /a callback request has its own shorter list — rule 13/);
  });

  test("the tool surface is unchanged — no state machine was introduced", () => {
    const config = buildVoiceAssistantConfig(
      ORG,
      [],
      SETTINGS,
      "https://example.test/api/voice/webhook",
      CALLER,
      MONDAY_3_AUG_2026
    );
    // The fix is prompt-only. Config shape must not have grown.
    assert.deepEqual(
      Object.keys(config).sort(),
      [
        "firstMessage",
        "language",
        "maxDurationSeconds",
        "serverUrl",
        "structuredDataSchema",
        "summaryInstructions",
        "systemPrompt",
        "voiceId",
      ].sort()
    );
  });

  test("the prompt still has exactly 13 numbered rules", () => {
    const numbers = promptFor()
      .split("\n")
      .map((line) => /^(\d+)\.\s/.exec(line))
      .filter(Boolean)
      .map((match) => Number(match[1]));
    assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });
});
