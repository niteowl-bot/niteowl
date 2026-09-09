// The scan validator must refuse, never repair.
//
// Every answer it accepts becomes evidence under a finding a real
// business will act on, so the property that matters is not that valid
// input passes but that INVALID INPUT NEVER QUIETLY BECOMES VALID.
//
// Three failure modes are worth more than the rest combined:
//
//   SILENT REPAIR — clamping a count into range, swapping an inverted
//   money range, parsing "3" into 3. Each turns a caller's bug into the
//   owner's data, where nothing can see it again.
//
//   BLANK BECOMING "NOT SURE" — they are different answers. "Not sure"
//   is something the owner told us; a blank is something they did not.
//   Collapsing them lets silence manufacture an operand (§82.2).
//
//   AN INCONSISTENCY BEING RESOLVED — Q4 > Q3 is shown to the owner and
//   neither value is changed (§87.4). Picking a winner would be the
//   product deciding which of the owner's own answers to believe.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { validateScanAnswers } from "@/lib/freetools/scanValidation";
import {
  SCAN_QUESTIONS,
  SCAN_QUESTION_IDS,
  SCAN_QUESTION_SET_VERSION,
} from "@/lib/freetools/scanQuestions";

/** A fully answered, internally consistent run. */
const FULL = {
  q1_channels: ["phone", "web_form"],
  q2_reachable: "working_hours",
  q3_enquiries_per_week: { kind: "count", value: 20 },
  q4_unanswered_per_week: { kind: "count", value: 4 },
  q5_miss_visibility: "yes_always",
  q6_followup: "nothing_planned",
  q7_messages_to_book: "more_than_three",
  q8_typical_job_value: { kind: "amount", amount: 250, currency: "EUR" },
  q9_conversion_share: "about_half",
};

/** The five required questions and nothing else. */
const MINIMAL = {
  q1_channels: ["phone"],
  q2_reachable: "varies",
  q3_enquiries_per_week: { kind: "not_sure" },
  q5_miss_visibility: "sometimes",
  q6_followup: "not_sure",
  q7_messages_to_book: "not_sure",
};

const withQ = (patch) => ({ ...FULL, ...patch });
const codesFor = (result, id) =>
  result.errors.filter((e) => e.question_id === id).map((e) => e.code);

// ── 1. The question contract itself ────────────────────────────────

describe("the question set is the nine-question contract", () => {
  test("exactly nine questions, with the canonical ids", () => {
    assert.equal(SCAN_QUESTIONS.length, 9);
    assert.deepEqual(SCAN_QUESTION_IDS, [
      "q1_channels",
      "q2_reachable",
      "q3_enquiries_per_week",
      "q4_unanswered_per_week",
      "q5_miss_visibility",
      "q6_followup",
      "q7_messages_to_book",
      "q8_typical_job_value",
      "q9_conversion_share",
    ]);
  });

  test("the five required and four optional questions match §87.2", () => {
    const required = SCAN_QUESTIONS.filter((q) => q.required).map((q) => q.id);
    assert.deepEqual(required, [
      "q1_channels",
      "q2_reachable",
      "q3_enquiries_per_week",
      "q5_miss_visibility",
      "q6_followup",
      "q7_messages_to_book",
    ]);
  });

  test("the question set carries a version", () => {
    assert.equal(typeof SCAN_QUESTION_SET_VERSION, "string");
    assert.ok(SCAN_QUESTION_SET_VERSION.length > 0);
  });

  test("no question presupposes a defect or asks what it costs", () => {
    for (const q of SCAN_QUESTIONS) {
      assert.doesNotMatch(
        q.wording,
        /losing|lost|how much business|missing out|costing you/i,
        `${q.id} asks the owner to assert the product's conclusion`
      );
    }
  });

  test("Q5 offers no 'not sure' — it is the honesty gate", () => {
    const q5 = SCAN_QUESTIONS.find((q) => q.id === "q5_miss_visibility");
    assert.ok(!q5.allowedValues.includes("not_sure"));
  });
});

// ── 2. Valid input ─────────────────────────────────────────────────

describe("valid answers pass through unchanged", () => {
  test("a full run validates and is returned intact", () => {
    const result = validateScanAnswers(FULL);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.inconsistencies, []);
    assert.deepEqual(result.answers.q3_enquiries_per_week, { kind: "count", value: 20 });
    assert.deepEqual(result.answers.q8_typical_job_value, {
      kind: "amount",
      amount: 250,
      currency: "EUR",
    });
  });

  test("the four optional questions may be absent, and stay absent", () => {
    const result = validateScanAnswers(MINIMAL);
    assert.equal(result.valid, true);
    // Absent, NOT defaulted and NOT turned into "not sure".
    assert.equal(result.answers.q4_unanswered_per_week, null);
    assert.equal(result.answers.q8_typical_job_value, null);
    assert.equal(result.answers.q9_conversion_share, null);
  });

  test("q1 is normalised to presentation order, not tick order", () => {
    const a = validateScanAnswers(withQ({ q1_channels: ["web_form", "phone"] }));
    const b = validateScanAnswers(withQ({ q1_channels: ["phone", "web_form"] }));
    assert.deepEqual(a.answers.q1_channels, b.answers.q1_channels);
    assert.deepEqual(a.answers.q1_channels, ["phone", "web_form"]);
  });

  test("a money range validates, and both ends survive", () => {
    const result = validateScanAnswers(
      withQ({ q8_typical_job_value: { kind: "range", low: 100, high: 400, currency: "GBP" } })
    );
    assert.equal(result.valid, true);
    assert.deepEqual(result.answers.q8_typical_job_value, {
      kind: "range",
      low: 100,
      high: 400,
      currency: "GBP",
    });
  });

  test("count bounds are inclusive at both ends", () => {
    for (const value of [0, 999]) {
      const result = validateScanAnswers(
        withQ({
          q3_enquiries_per_week: { kind: "count", value: 999 },
          q4_unanswered_per_week: { kind: "count", value },
        })
      );
      assert.equal(result.valid, true, `${value} should be accepted`);
    }
  });
});

// ── 3. "Not sure" is a first-class answer ──────────────────────────

describe("every not_sure path is a valid, explicit answer", () => {
  for (const [id, value] of [
    ["q3_enquiries_per_week", { kind: "not_sure" }],
    ["q4_unanswered_per_week", { kind: "not_sure" }],
    ["q6_followup", "not_sure"],
    ["q7_messages_to_book", "not_sure"],
    ["q8_typical_job_value", { kind: "not_sure" }],
    ["q9_conversion_share", "not_sure"],
  ]) {
    test(`${id} = not_sure validates and is preserved`, () => {
      const result = validateScanAnswers(withQ({ [id]: value }));
      assert.equal(result.valid, true, JSON.stringify(result.errors));
      assert.deepEqual(result.answers[id], value);
    });
  }

  test("not_sure is never produced from a blank", () => {
    const result = validateScanAnswers(MINIMAL);
    assert.equal(result.valid, true);
    for (const id of ["q4_unanswered_per_week", "q8_typical_job_value", "q9_conversion_share"]) {
      assert.notDeepEqual(result.answers[id], { kind: "not_sure" }, `${id} invented not_sure`);
      assert.notEqual(result.answers[id], "not_sure", `${id} invented not_sure`);
    }
  });

  test("a not_sure count carries no value, and none is added", () => {
    const result = validateScanAnswers(withQ({ q3_enquiries_per_week: { kind: "not_sure" } }));
    assert.deepEqual(Object.keys(result.answers.q3_enquiries_per_week), ["kind"]);
  });
});

// ── 4. Missing required answers ────────────────────────────────────

describe("required answers are required, and absence is never filled", () => {
  for (const id of [
    "q1_channels",
    "q2_reachable",
    "q3_enquiries_per_week",
    "q5_miss_visibility",
    "q6_followup",
    "q7_messages_to_book",
  ]) {
    test(`${id} missing is refused, with no substitute value`, () => {
      const input = { ...FULL };
      delete input[id];
      const result = validateScanAnswers(input);
      assert.equal(result.valid, false);
      assert.deepEqual(codesFor(result, id), ["required"]);
      assert.equal(result.answers, null);
    });

    test(`${id} explicitly null is refused too`, () => {
      const result = validateScanAnswers(withQ({ [id]: null }));
      assert.equal(result.valid, false);
      assert.deepEqual(codesFor(result, id), ["required"]);
    });
  }

  test("an empty run reports every required question and defaults nothing", () => {
    const result = validateScanAnswers({});
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 6);
    assert.ok(result.errors.every((e) => e.code === "required"));
    assert.equal(result.answers, null);
  });
});

// ── 5. Malformed values, out of range, unknown enums ───────────────

describe("malformed values are refused, never coerced", () => {
  test("a non-object payload is refused whole", () => {
    for (const input of [null, undefined, "answers", 42, ["q1_channels"]]) {
      const result = validateScanAnswers(input);
      assert.equal(result.valid, false);
      assert.equal(result.errors[0].code, "not_an_object");
    }
  });

  test("an unknown question is refused, not ignored", () => {
    const result = validateScanAnswers({ ...FULL, q10_revenue_guess: "lots" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === "unexpected_question"));
  });

  test("a numeric string is never parsed into a count", () => {
    const result = validateScanAnswers(
      withQ({ q3_enquiries_per_week: { kind: "count", value: "20" } })
    );
    assert.equal(result.valid, false);
    assert.deepEqual(codesFor(result, "q3_enquiries_per_week"), ["not_an_integer"]);
  });

  test("a fractional, NaN or infinite count is refused", () => {
    for (const value of [2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = validateScanAnswers(
        withQ({ q4_unanswered_per_week: { kind: "count", value } })
      );
      assert.equal(result.valid, false);
      assert.deepEqual(codesFor(result, "q4_unanswered_per_week"), ["not_an_integer"]);
    }
  });

  test("an out-of-range count is refused, NOT clamped", () => {
    for (const value of [-1, 1000]) {
      const result = validateScanAnswers(
        withQ({ q3_enquiries_per_week: { kind: "count", value } })
      );
      assert.equal(result.valid, false);
      assert.deepEqual(codesFor(result, "q3_enquiries_per_week"), ["out_of_range"]);
      assert.equal(result.answers, null);
    }
  });

  test("an unknown enum value is refused for every select question", () => {
    for (const id of [
      "q2_reachable",
      "q5_miss_visibility",
      "q6_followup",
      "q7_messages_to_book",
      "q9_conversion_share",
    ]) {
      const result = validateScanAnswers(withQ({ [id]: "sometimes_ish" }));
      assert.equal(result.valid, false, `${id} accepted an unknown value`);
      assert.deepEqual(codesFor(result, id), ["unknown_value"]);
    }
  });

  test("q5 does not accept not_sure, which the contract does not offer", () => {
    const result = validateScanAnswers(withQ({ q5_miss_visibility: "not_sure" }));
    assert.equal(result.valid, false);
    assert.deepEqual(codesFor(result, "q5_miss_visibility"), ["unknown_value"]);
  });

  test("q1 refuses an empty selection, a non-list, an unknown or a repeat", () => {
    assert.deepEqual(codesFor(validateScanAnswers(withQ({ q1_channels: [] })), "q1_channels"), [
      "empty_selection",
    ]);
    assert.deepEqual(codesFor(validateScanAnswers(withQ({ q1_channels: "phone" })), "q1_channels"), [
      "malformed",
    ]);
    assert.deepEqual(
      codesFor(validateScanAnswers(withQ({ q1_channels: ["pigeon"] })), "q1_channels"),
      ["unknown_value"]
    );
    assert.deepEqual(
      codesFor(validateScanAnswers(withQ({ q1_channels: ["phone", "phone"] })), "q1_channels"),
      ["duplicate_value"]
    );
  });

  test("a job value of zero or below is refused, never treated as unknown", () => {
    for (const answer of [
      { kind: "amount", amount: 0, currency: "EUR" },
      { kind: "amount", amount: -50, currency: "EUR" },
      { kind: "range", low: 0, high: 300, currency: "EUR" },
    ]) {
      const result = validateScanAnswers(withQ({ q8_typical_job_value: answer }));
      assert.equal(result.valid, false);
      assert.deepEqual(codesFor(result, "q8_typical_job_value"), ["not_positive"]);
    }
  });

  test("an inverted money range is refused, NOT swapped", () => {
    const result = validateScanAnswers(
      withQ({ q8_typical_job_value: { kind: "range", low: 400, high: 100, currency: "EUR" } })
    );
    assert.equal(result.valid, false);
    assert.deepEqual(codesFor(result, "q8_typical_job_value"), ["range_inverted"]);
    assert.equal(result.answers, null);
  });

  test("a missing or malformed currency is refused, never defaulted", () => {
    for (const currency of [undefined, "", "euro", "eur", "EURO"]) {
      const result = validateScanAnswers(
        withQ({ q8_typical_job_value: { kind: "amount", amount: 250, currency } })
      );
      assert.equal(result.valid, false, `${currency} was accepted`);
      assert.deepEqual(codesFor(result, "q8_typical_job_value"), ["invalid_currency"]);
    }
  });

  test("an unknown answer kind is refused for the structured questions", () => {
    assert.deepEqual(
      codesFor(
        validateScanAnswers(withQ({ q3_enquiries_per_week: { kind: "estimate", value: 5 } })),
        "q3_enquiries_per_week"
      ),
      ["unknown_value"]
    );
    assert.deepEqual(
      codesFor(
        validateScanAnswers(withQ({ q8_typical_job_value: { kind: "guess", amount: 5 } })),
        "q8_typical_job_value"
      ),
      ["unknown_value"]
    );
  });
});

// ── 6. The Q4 > Q3 inconsistency ───────────────────────────────────

describe("the q4 > q3 inconsistency is surfaced, not resolved", () => {
  const INCONSISTENT = withQ({
    q3_enquiries_per_week: { kind: "count", value: 5 },
    q4_unanswered_per_week: { kind: "count", value: 9 },
  });

  test("the run stays valid — the answers are individually well formed", () => {
    const result = validateScanAnswers(INCONSISTENT);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  test("the inconsistency is reported, naming both questions", () => {
    const result = validateScanAnswers(INCONSISTENT);
    assert.equal(result.inconsistencies.length, 1);
    assert.equal(result.inconsistencies[0].code, "q4_exceeds_q3");
    assert.deepEqual(result.inconsistencies[0].question_ids, [
      "q3_enquiries_per_week",
      "q4_unanswered_per_week",
    ]);
  });

  test("NEITHER value is changed", () => {
    const result = validateScanAnswers(INCONSISTENT);
    assert.deepEqual(result.answers.q3_enquiries_per_week, { kind: "count", value: 5 });
    assert.deepEqual(result.answers.q4_unanswered_per_week, { kind: "count", value: 9 });
  });

  test("equal counts are consistent, and a not_sure denominator cannot conflict", () => {
    const equal = validateScanAnswers(
      withQ({
        q3_enquiries_per_week: { kind: "count", value: 5 },
        q4_unanswered_per_week: { kind: "count", value: 5 },
      })
    );
    assert.deepEqual(equal.inconsistencies, []);

    const unknownDenominator = validateScanAnswers(
      withQ({
        q3_enquiries_per_week: { kind: "not_sure" },
        q4_unanswered_per_week: { kind: "count", value: 900 },
      })
    );
    assert.deepEqual(unknownDenominator.inconsistencies, []);
  });
});

// ── 7. Determinism ─────────────────────────────────────────────────

describe("the validator is pure", () => {
  test("the same input validates identically every time", () => {
    const a = validateScanAnswers(FULL);
    const b = validateScanAnswers(FULL);
    assert.deepEqual(a, b);
  });

  test("the input object is never mutated", () => {
    const input = structuredClone(FULL);
    validateScanAnswers(input);
    assert.deepEqual(input, FULL);
  });
});
