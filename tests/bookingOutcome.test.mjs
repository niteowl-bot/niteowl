// The reply must state the operation that actually happened.
//
// Found on the 2026-08-08 live production test. A widget reschedule
// moved the appointment AND moved the Google event — and the reply said:
//
//   "I'm sorry, but I can't change or update appointments. However, I
//    can take your name and contact details, and have a team member
//    assist you with this request."
//
// The customer was told the opposite of what happened. If they acted on
// it they would arrive at the old time.
//
// ── Root cause ──
// The chat routes run TWO independent model calls: one extracts the
// intent (which drives the mutation), one writes the reply. Only
// FAILURE was ever communicated to the second — `unavailableReason` and
// `suggestedAlternativeIso`. On success it was told nothing: not that an
// appointment existed, not that it had moved, not to what time. It was
// left to infer the outcome, with a negative rule ("never say you
// cannot change a booking") and no grounding fact behind it.
//
// Production logs confirmed the intent WAS "reschedule", so BOOKING MODE
// and that rule were both in the prompt. A negative constraint is not a
// fact; these tests pin the fact.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { buildBookingOutcomeNote } from "@/lib/bookingOutcome";
import { ACTIONABLE_INTENTS } from "@/lib/leadCapture";

// Wednesday 19 August 2026, 15:00 Europe/London (BST) = 14:00Z — the
// instant from the live test.
const WHEN = "2026-08-19T14:00:00.000Z";

const base = {
  intent: "reschedule",
  booked: true,
  appointmentIso: WHEN,
  unavailableReason: null,
};

describe("a successful reschedule is stated accurately", () => {
  test("it says the appointment MOVED, with the new time", () => {
    const note = buildBookingOutcomeNote(base);
    assert.ok(note, "a successful reschedule must produce a note");
    assert.match(note, /HAS BEEN MOVED/);
    assert.match(note, /19 August 2026/);
    assert.match(note, /15:00/, "the new time, in the business's zone");
  });

  test("it explicitly forbids the refusal the live call produced", () => {
    const note = buildBookingOutcomeNote(base);
    assert.match(note, /You DID change their appointment/);
    assert.match(note, /never say you cannot change or update a booking/);
    assert.match(
      note,
      /never suggest a team member has to do it instead/,
      "the live reply offered exactly that"
    );
  });

  test("it states the change is already saved", () => {
    assert.match(buildBookingOutcomeNote(base), /already saved/);
  });

  test("the time is rendered in the org's timezone, not UTC", () => {
    // 14:00Z is 15:00 in London (BST) and 16:00 in Madrid. The note must
    // follow the business, and must not invite a second rendering.
    assert.match(buildBookingOutcomeNote(base), /15:00/);
    assert.match(
      buildBookingOutcomeNote({ ...base, timezone: "Europe/Madrid" }),
      /16:00/
    );
    assert.match(buildBookingOutcomeNote(base), /Do not restate it in another timezone/);
  });
});

describe("a successful new booking is stated accurately", () => {
  test("it says BOOKED rather than moved", () => {
    const note = buildBookingOutcomeNote({ ...base, intent: "new_booking" });
    assert.match(note, /IS NOW BOOKED/);
    assert.doesNotMatch(note, /HAS BEEN MOVED/);
    assert.match(note, /19 August 2026/);
  });
});

describe("a refused or failed operation NEVER claims success", () => {
  // The direction that must not break: the note is additive, so it must
  // stay silent whenever anything went wrong. The existing Availability
  // Note owns those cases and must not be contradicted.
  for (const reason of ["capacity", "hours", "ends_after_close", "lookup_failed"]) {
    test(`"${reason}" produces no note at all`, () => {
      assert.equal(
        buildBookingOutcomeNote({ ...base, unavailableReason: reason }),
        null
      );
    });
  }

  test("a refused reschedule that kept the OLD time claims nothing", () => {
    // capturePartialLead keeps the original instant when the calendar
    // refuses the move, so appointmentIso is still populated — being
    // booked is not enough on its own.
    assert.equal(
      buildBookingOutcomeNote({
        ...base,
        appointmentIso: "2026-08-18T10:00:00.000Z",
        unavailableReason: "lookup_failed",
      }),
      null
    );
  });

  test("not booked means no claim, whatever the intent", () => {
    assert.equal(buildBookingOutcomeNote({ ...base, booked: false }), null);
    assert.equal(
      buildBookingOutcomeNote({ ...base, intent: "new_booking", booked: false }),
      null
    );
  });

  test("no appointment instant means no claim — a time is never invented", () => {
    assert.equal(buildBookingOutcomeNote({ ...base, appointmentIso: null }), null);
  });

  test("an unparseable instant produces no note rather than 'Invalid Date'", () => {
    assert.equal(
      buildBookingOutcomeNote({ ...base, appointmentIso: "not-a-date" }),
      null
    );
  });
});

describe("the mutation and the response cannot disagree", () => {
  // The contradiction has exactly two shapes. Both are pinned here.
  test("MUTATION HAPPENED ⇒ the reply is told so, affirmatively", () => {
    for (const intent of ["new_booking", "reschedule"]) {
      const note = buildBookingOutcomeNote({ ...base, intent });
      assert.ok(note, `${intent} that booked must produce a note`);
      // The note states the outcome as fact and says it is persisted.
      assert.match(note, /(HAS BEEN MOVED|IS NOW BOOKED)/);
      assert.match(note, /already saved/);
      // Every mention of refusal wording is a PROHIBITION, never an
      // instruction to refuse — "cannot" only ever appears after "never".
      for (const m of note.matchAll(/\b(cannot|can't|unable)\b/gi)) {
        const preceding = note.slice(Math.max(0, m.index - 60), m.index);
        assert.match(
          preceding,
          /never/i,
          `refusal wording must be prohibited, not instructed: "${note.slice(Math.max(0, m.index - 40), m.index + 20)}"`
        );
      }
    }
  });

  test("NO MUTATION ⇒ the reply is told nothing (never a false success)", () => {
    const noMutation = [
      { ...base, booked: false },
      { ...base, appointmentIso: null },
      { ...base, unavailableReason: "capacity" },
      { ...base, intent: "question" },
      { ...base, intent: "unknown" },
    ];
    for (const outcome of noMutation) {
      assert.equal(buildBookingOutcomeNote(outcome), null);
    }
  });
});

describe("no unrelated intent gains a claim — or mutation capability", () => {
  test("only new_booking and reschedule ever produce a note", () => {
    for (const intent of ["contact_update", "question", "unknown"]) {
      assert.equal(
        buildBookingOutcomeNote({ ...base, intent }),
        null,
        `${intent} must not announce a booking`
      );
    }
  });

  test("contact_update stays silent even when it completed a booking", () => {
    // It CAN finish a booking begun in an earlier turn, but the
    // customer's message was about their details — an unprompted
    // confirmation reads as a non-sequitur. Under-stating is safe.
    assert.equal(
      buildBookingOutcomeNote({ ...base, intent: "contact_update", booked: true }),
      null
    );
  });

  test("the set of mutating intents is unchanged by this fix", () => {
    // The bug was in what the reply was TOLD, not in what may mutate.
    // If this list ever grows, that is a separate decision.
    assert.deepEqual(ACTIONABLE_INTENTS, [
      "new_booking",
      "reschedule",
      "contact_update",
    ]);
    for (const intent of ["question", "unknown"]) {
      assert.equal(
        ACTIONABLE_INTENTS.includes(intent),
        false,
        `${intent} must never reach capturePartialLead`
      );
    }
  });
});
