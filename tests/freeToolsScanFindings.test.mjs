// A Phase 1 finding is a stated rule over stated answers, and nothing
// else (docs/ARCHITECTURE.md §87.3).
//
// The properties worth testing are not "does it find things" but:
//
//   NO FINDING IS EVER PRODUCED BY ABSENCE. A blank means nothing was
//   established, never that the answer was bad, and "not sure" means
//   the owner told us they cannot say (§87.4). Either one raising a
//   finding would be the product inventing a problem for a business
//   that never described one.
//
//   AN INCONSISTENT PAIR RAISES NOTHING AND IS NOT REPAIRED. Q4 > Q3
//   cannot both be true, so it supports no claim — and neither answer
//   is changed to make it support one.
//
//   THE SAME ANSWERS ALWAYS PRODUCE THE SAME FINDINGS. Determinism is
//   what makes a stored run re-derivable, which is what makes the
//   estimate on top of it auditable. No clock, no randomness, no model.
//
//   THE ORDER IS THE ENUMERATION'S. Not a score, not a weight, and
//   emphatically not the size of a number — Phase 1 can size one of the
//   three classes, so ranking by money would rank by what we happen to
//   be able to measure.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  SCAN_RULE_SET_VERSION,
  buildScanReport,
  deriveFindings,
} from "@/lib/freetools/scanFindings";
import { SCAN_CONDITION_ORDER } from "@/lib/freetools/scanTypes";
import { validateScanAnswers } from "@/lib/freetools/scanValidation";

const CONTEXT = {
  answered_at: "2026-09-09T10:00:00.000Z",
  computed_at: "2026-09-09T10:00:01.000Z",
};

/** Answers that raise nothing at all — every diagnostic question quiet. */
const QUIET = {
  q1_channels: ["phone"],
  q2_reachable: "working_hours",
  q3_enquiries_per_week: { kind: "count", value: 20 },
  q4_unanswered_per_week: { kind: "count", value: 0 },
  q5_miss_visibility: "yes_always",
  q6_followup: "within_a_day",
  q7_messages_to_book: "one",
};

/** Validate first — the engine's input contract is validated answers. */
function answers(patch = {}) {
  const result = validateScanAnswers({ ...QUIET, ...patch });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return result.answers;
}

const conditions = (patch) => deriveFindings(answers(patch)).map((f) => f.condition);
const findingFor = (patch, condition) =>
  deriveFindings(answers(patch)).find((f) => f.condition === condition);

// ── 1. The enumeration ─────────────────────────────────────────────

describe("the condition enumeration is the Phase 1 three", () => {
  test("exactly three codes, in the canonical order", () => {
    assert.equal(SCAN_CONDITION_ORDER.length, 3);
    assert.deepEqual(SCAN_CONDITION_ORDER, [
      "enquiry.unanswered",
      "enquiry.no_followup",
      "booking.friction",
    ]);
  });

  test("the rule set carries a version", () => {
    assert.equal(typeof SCAN_RULE_SET_VERSION, "string");
    assert.ok(SCAN_RULE_SET_VERSION.length > 0);
  });
});

// ── 2. enquiry.unanswered ──────────────────────────────────────────

describe("enquiry.unanswered — Q4 >= 1, and Q4 <= Q3 where both given", () => {
  test("raised when unanswered enquiries are reported", () => {
    assert.deepEqual(conditions({ q4_unanswered_per_week: { kind: "count", value: 4 } }), [
      "enquiry.unanswered",
    ]);
  });

  test("raised at the boundary of one", () => {
    assert.deepEqual(conditions({ q4_unanswered_per_week: { kind: "count", value: 1 } }), [
      "enquiry.unanswered",
    ]);
  });

  test("raised when Q4 equals Q3 — equal is not a conflict", () => {
    assert.deepEqual(
      conditions({
        q3_enquiries_per_week: { kind: "count", value: 6 },
        q4_unanswered_per_week: { kind: "count", value: 6 },
      }),
      ["enquiry.unanswered"]
    );
  });

  test("raised when Q3 is not sure — an unknown denominator cannot refute it", () => {
    assert.deepEqual(
      conditions({
        q3_enquiries_per_week: { kind: "not_sure" },
        q4_unanswered_per_week: { kind: "count", value: 3 },
      }),
      ["enquiry.unanswered"]
    );
  });

  test("NOT raised at Q4 = 0 — nothing to report is a legitimate outcome", () => {
    assert.deepEqual(conditions({ q4_unanswered_per_week: { kind: "count", value: 0 } }), []);
  });

  test("NOT raised when Q4 is not sure — a claim with no count is a slogan", () => {
    assert.deepEqual(conditions({ q4_unanswered_per_week: { kind: "not_sure" } }), []);
  });

  test("NOT raised when Q4 was not answered at all", () => {
    const input = { ...QUIET };
    delete input.q4_unanswered_per_week;
    const validated = validateScanAnswers(input);
    assert.equal(validated.valid, true);
    assert.deepEqual(deriveFindings(validated.answers), []);
  });

  test("NOT raised when Q4 > Q3, and neither answer is repaired", () => {
    const patch = {
      q3_enquiries_per_week: { kind: "count", value: 5 },
      q4_unanswered_per_week: { kind: "count", value: 9 },
    };
    assert.deepEqual(conditions(patch), []);
    const validated = answers(patch);
    assert.deepEqual(validated.q3_enquiries_per_week, { kind: "count", value: 5 });
    assert.deepEqual(validated.q4_unanswered_per_week, { kind: "count", value: 9 });
  });

  test("Q5 caps confidence but never blocks the finding", () => {
    const cases = [
      ["yes_always", "high", null],
      ["sometimes", "medium", "q5_partial_miss_visibility"],
      ["no", "low", "q5_no_miss_visibility"],
    ];
    for (const [visibility, confidence, reason] of cases) {
      const finding = findingFor(
        {
          q4_unanswered_per_week: { kind: "count", value: 4 },
          q5_miss_visibility: visibility,
        },
        "enquiry.unanswered"
      );
      assert.ok(finding, `q5=${visibility} lost the finding`);
      assert.equal(finding.finding_confidence, confidence);
      assert.equal(finding.confidence_cap_reason, reason);
    }
  });

  test("Q4 and Q5 always support it; Q3 joins only when it took part", () => {
    const withCount = findingFor(
      { q4_unanswered_per_week: { kind: "count", value: 4 } },
      "enquiry.unanswered"
    );
    assert.deepEqual(withCount.supporting_question_ids, [
      "q3_enquiries_per_week",
      "q4_unanswered_per_week",
      "q5_miss_visibility",
    ]);

    const withoutCount = findingFor(
      {
        q3_enquiries_per_week: { kind: "not_sure" },
        q4_unanswered_per_week: { kind: "count", value: 4 },
      },
      "enquiry.unanswered"
    );
    assert.deepEqual(withoutCount.supporting_question_ids, [
      "q4_unanswered_per_week",
      "q5_miss_visibility",
    ]);
  });
});

// ── 3. enquiry.no_followup ─────────────────────────────────────────

describe("enquiry.no_followup — Q6 states the practice", () => {
  for (const value of ["only_if_they_return", "nothing_planned"]) {
    test(`raised on Q6 = ${value}`, () => {
      assert.deepEqual(conditions({ q6_followup: value }), ["enquiry.no_followup"]);
    });
  }

  for (const value of ["within_a_day", "eventually", "not_sure"]) {
    test(`NOT raised on Q6 = ${value}`, () => {
      assert.deepEqual(conditions({ q6_followup: value }), []);
    });
  }

  test("Q6 alone carries it, quoted verbatim", () => {
    const finding = findingFor({ q6_followup: "nothing_planned" }, "enquiry.no_followup");
    assert.deepEqual(finding.supporting_question_ids, ["q6_followup"]);
    assert.deepEqual(finding.evidence, [
      {
        question_id: "q6_followup",
        raw_answer: "nothing_planned",
        source_type: "business_provided",
      },
    ]);
    assert.equal(finding.finding_confidence, "high");
    assert.equal(finding.confidence_cap_reason, null);
  });
});

// ── 4. booking.friction ────────────────────────────────────────────

describe("booking.friction — Q7 states the effort", () => {
  test("raised on 'more than three', uncapped", () => {
    const finding = findingFor({ q7_messages_to_book: "more_than_three" }, "booking.friction");
    assert.ok(finding);
    assert.equal(finding.finding_confidence, "high");
    assert.equal(finding.confidence_cap_reason, null);
  });

  test("raised on 'it varies a lot', capped below 'more than three'", () => {
    const finding = findingFor({ q7_messages_to_book: "varies_a_lot" }, "booking.friction");
    assert.ok(finding);
    assert.equal(finding.finding_confidence, "medium");
    assert.equal(finding.confidence_cap_reason, "q7_varies_a_lot");
  });

  for (const value of ["one", "two_or_three", "not_sure"]) {
    test(`NOT raised on Q7 = ${value}`, () => {
      assert.deepEqual(conditions({ q7_messages_to_book: value }), []);
    });
  }
});

// ── 5. Insufficient evidence, and zero findings ────────────────────

describe("a report with no findings is a valid, honest result", () => {
  test("every diagnostic question quiet produces no findings", () => {
    assert.deepEqual(deriveFindings(answers()), []);
  });

  test("every diagnostic question 'not sure' produces no findings", () => {
    assert.deepEqual(
      conditions({
        q3_enquiries_per_week: { kind: "not_sure" },
        q4_unanswered_per_week: { kind: "not_sure" },
        q6_followup: "not_sure",
        q7_messages_to_book: "not_sure",
      }),
      []
    );
  });

  test("Q1, Q2, Q5, Q8 and Q9 cannot raise anything on their own", () => {
    for (const patch of [
      { q1_channels: ["phone", "text_whatsapp", "email", "web_form", "social", "in_person", "other"] },
      { q2_reachable: "working_hours" },
      { q5_miss_visibility: "no" },
      { q8_typical_job_value: { kind: "amount", amount: 5000, currency: "EUR" } },
      { q9_conversion_share: "a_minority" },
    ]) {
      assert.deepEqual(conditions(patch), [], JSON.stringify(patch));
    }
  });

  test("the empty report still carries its version stamps", () => {
    const report = buildScanReport(answers(), CONTEXT);
    assert.deepEqual(report.findings, []);
    assert.equal(typeof report.question_set_version, "string");
    assert.equal(typeof report.rule_set_version, "string");
  });
});

// ── 6. Ordering and the cap of three ───────────────────────────────

describe("ranking is the enumeration, and at most three findings", () => {
  const ALL_THREE = {
    q4_unanswered_per_week: { kind: "count", value: 4 },
    q6_followup: "nothing_planned",
    q7_messages_to_book: "more_than_three",
  };

  test("all three raised, in the canonical order", () => {
    assert.deepEqual(conditions(ALL_THREE), [
      "enquiry.unanswered",
      "enquiry.no_followup",
      "booking.friction",
    ]);
  });

  test("never more than three findings, and never a duplicate", () => {
    const found = deriveFindings(answers(ALL_THREE));
    assert.ok(found.length <= 3);
    assert.equal(new Set(found.map((f) => f.condition)).size, found.length);
  });

  test("every emitted condition is one of the three", () => {
    const found = deriveFindings(answers(ALL_THREE));
    for (const f of found) assert.ok(SCAN_CONDITION_ORDER.includes(f.condition));
  });

  test("order does not follow confidence", () => {
    // booking.friction at high confidence still ranks below a
    // low-confidence enquiry.unanswered.
    const found = deriveFindings(
      answers({ ...ALL_THREE, q5_miss_visibility: "no", q7_messages_to_book: "more_than_three" })
    );
    assert.equal(found[0].condition, "enquiry.unanswered");
    assert.equal(found[0].finding_confidence, "low");
    assert.equal(found[2].condition, "booking.friction");
    assert.equal(found[2].finding_confidence, "high");
  });

  test("order does not follow whether a finding could be sized", () => {
    // The only sizeable class is enquiry.unanswered. Removing its
    // operands must not move anything.
    const sized = buildScanReport(
      answers({
        ...ALL_THREE,
        q8_typical_job_value: { kind: "amount", amount: 250, currency: "EUR" },
        q9_conversion_share: "about_half",
      }),
      CONTEXT
    );
    const unsized = buildScanReport(answers(ALL_THREE), CONTEXT);
    assert.deepEqual(
      sized.findings.map((f) => f.finding.condition),
      unsized.findings.map((f) => f.finding.condition)
    );
    assert.equal(sized.findings[0].impact.kind, "estimate");
    assert.equal(unsized.findings[0].impact.kind, "unknown");
  });
});

// ── 7. Provenance ──────────────────────────────────────────────────

describe("a finding carries its evidence and its provenance", () => {
  test("every finding is derived_deterministic, and its evidence business_provided", () => {
    const found = deriveFindings(
      answers({
        q4_unanswered_per_week: { kind: "count", value: 4 },
        q6_followup: "nothing_planned",
        q7_messages_to_book: "varies_a_lot",
      })
    );
    assert.equal(found.length, 3);
    for (const finding of found) {
      assert.equal(finding.source_type, "derived_deterministic");
      assert.ok(finding.evidence.length > 0);
      for (const ref of finding.evidence) {
        assert.equal(ref.source_type, "business_provided");
        assert.ok(finding.supporting_question_ids.includes(ref.question_id));
      }
    }
  });

  test("nothing is ever observed or verified", () => {
    const serialised = JSON.stringify(
      buildScanReport(
        answers({
          q4_unanswered_per_week: { kind: "count", value: 4 },
          q6_followup: "nothing_planned",
          q7_messages_to_book: "more_than_three",
          q8_typical_job_value: { kind: "amount", amount: 250, currency: "EUR" },
          q9_conversion_share: "about_half",
        }),
        CONTEXT
      )
    );
    assert.doesNotMatch(serialised, /"observed"|"verified"|"ai_predicted"/);
  });

  test("the raw answer travels with the finding, unaltered", () => {
    const finding = findingFor(
      { q4_unanswered_per_week: { kind: "count", value: 7 } },
      "enquiry.unanswered"
    );
    const ref = finding.evidence.find((e) => e.question_id === "q4_unanswered_per_week");
    assert.deepEqual(ref.raw_answer, { kind: "count", value: 7 });
  });
});

// ── 8. Determinism ─────────────────────────────────────────────────

describe("the engine is deterministic and pure", () => {
  const PATCH = {
    q4_unanswered_per_week: { kind: "count", value: 3 },
    q6_followup: "only_if_they_return",
    q7_messages_to_book: "varies_a_lot",
    q8_typical_job_value: { kind: "amount", amount: 300, currency: "GBP" },
    q9_conversion_share: "about_half",
  };

  test("the same answers produce deeply equal findings, every time", () => {
    const first = deriveFindings(answers(PATCH));
    for (let i = 0; i < 25; i += 1) {
      assert.deepEqual(deriveFindings(answers(PATCH)), first);
    }
  });

  test("the same answers serialise identically", () => {
    const a = JSON.stringify(deriveFindings(answers(PATCH)));
    const b = JSON.stringify(deriveFindings(answers(PATCH)));
    assert.equal(a, b);
  });

  test("the whole report is stable given the same context", () => {
    assert.deepEqual(
      buildScanReport(answers(PATCH), CONTEXT),
      buildScanReport(answers(PATCH), CONTEXT)
    );
  });

  test("the answers object is never mutated", () => {
    const validated = answers(PATCH);
    const before = structuredClone(validated);
    deriveFindings(validated);
    buildScanReport(validated, CONTEXT);
    assert.deepEqual(validated, before);
  });

  test("inconsistencies are carried into the report untouched", () => {
    const validated = validateScanAnswers({
      ...QUIET,
      q3_enquiries_per_week: { kind: "count", value: 5 },
      q4_unanswered_per_week: { kind: "count", value: 9 },
      q6_followup: "nothing_planned",
    });
    const report = buildScanReport(validated.answers, CONTEXT, validated.inconsistencies);
    assert.equal(report.inconsistencies.length, 1);
    assert.equal(report.inconsistencies[0].code, "q4_exceeds_q3");
    // The inconsistent pair raised nothing; Q6 still did.
    assert.deepEqual(
      report.findings.map((f) => f.finding.condition),
      ["enquiry.no_followup"]
    );
  });
});
