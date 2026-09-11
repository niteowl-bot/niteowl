// Phase 1 has exactly ONE permitted Lost Revenue expression, and the
// subtraction is the point (docs/ARCHITECTURE.md §88.1).
//
// The failure this file exists against is not an arithmetic bug. It is
// the pressure a free acquisition product puts on its own numbers:
//
//   SIZING WHAT CANNOT BE SIZED. `enquiry.no_followup` and
//   `booking.friction` are real findings with impact UNKNOWN, always,
//   because each needs a recovery or loss rate no owner can supply.
//   Any default here would be an invented conversion rate.
//
//   A NUMBER THAT CANNOT BE FOUND WRONG. §88.4's acceptance test is
//   that a displayed figure is recomputable from its stored basis
//   ALONE. If it is not, it may not be displayed — not shown with a
//   caveat, not shown at all.
//
//   PRECISION THEATRE IN EITHER DIRECTION. A point estimate claims more
//   than the answers support; a range spanning orders of magnitude
//   claims to have measured something while saying nothing.
//
// And UNKNOWN is a first-class result throughout (§82.3): six separate
// conditions produce it, each with its own code, and none of them is a
// degraded version of a number.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  CONVERSION_BUCKET_RANGES,
  E1_ASSUMPTIONS,
  E1_EXPRESSION_ID,
  E1_EXPRESSION_KEY,
  E1_EXPRESSION_VERSION,
  basisReproducesResult,
  computeLostRevenue,
  recomputeFromBasis,
} from "@/lib/freetools/scanLostRevenue";
import {
  SCAN_RULE_SET_VERSION as FINDINGS_RULE_SET_VERSION,
  buildScanReport,
  deriveFindings,
} from "@/lib/freetools/scanFindings";
import { SCAN_RULE_SET_VERSION } from "@/lib/freetools/scanTypes";
import { validateScanAnswers } from "@/lib/freetools/scanValidation";

const CONTEXT = {
  answered_at: "2026-09-09T10:00:00.000Z",
  computed_at: "2026-09-09T10:00:01.000Z",
};

/** A sizeable run: a finding, visibility, a value and a share. */
const SIZEABLE = {
  q1_channels: ["phone"],
  q2_reachable: "working_hours",
  q3_enquiries_per_week: { kind: "count", value: 20 },
  q4_unanswered_per_week: { kind: "count", value: 4 },
  q5_miss_visibility: "yes_always",
  q6_followup: "within_a_day",
  q7_messages_to_book: "one",
  q8_typical_job_value: { kind: "amount", amount: 250, currency: "EUR" },
  q9_conversion_share: "about_half",
};

function answers(patch = {}) {
  const input = { ...SIZEABLE, ...patch };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete input[key];
  }
  const result = validateScanAnswers(input);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return result.answers;
}

/** The `enquiry.unanswered` finding for a patch, or a synthetic one. */
function unansweredFinding(validated) {
  const found = deriveFindings(validated).find((f) => f.condition === "enquiry.unanswered");
  return (
    found ?? {
      // Synthetic, so the sizing gates can be exercised one at a time
      // even where the finding engine would already have refused.
      condition: "enquiry.unanswered",
      supporting_question_ids: ["q4_unanswered_per_week", "q5_miss_visibility"],
      evidence: [],
      source_type: "derived_deterministic",
      finding_confidence: "low",
      confidence_cap_reason: null,
    }
  );
}

const size = (patch = {}) => {
  const validated = answers(patch);
  return computeLostRevenue(unansweredFinding(validated), validated, CONTEXT);
};

// ── 1. The expression's identity ───────────────────────────────────

describe("E1 is the one permitted expression", () => {
  test("its identifier and version are the contract's", () => {
    assert.equal(E1_EXPRESSION_ID, "lost_revenue.unanswered_enquiries");
    assert.equal(E1_EXPRESSION_VERSION, "v1");
    assert.equal(E1_EXPRESSION_KEY, "lost_revenue.unanswered_enquiries.v1");
  });

  test("the Q9 buckets are the contract's, fixed and not chosen at runtime", () => {
    assert.deepEqual(CONVERSION_BUCKET_RANGES, {
      most: [0.67, 1.0],
      about_half: [0.4, 0.6],
      a_minority: [0.0, 0.33],
    });
  });

  test("no expression exists for the other two conditions", () => {
    const validated = answers({
      q6_followup: "nothing_planned",
      q7_messages_to_book: "more_than_three",
    });
    const report = buildScanReport(validated, CONTEXT);
    for (const entry of report.findings) {
      if (entry.finding.condition === "enquiry.unanswered") continue;
      assert.equal(entry.impact.kind, "unknown", entry.finding.condition);
      assert.equal(entry.impact.reason, "no_permitted_expression");
    }
  });

  // ── The reason code must SAY what is actually the case. For the two
  // unsizeable conditions the finding engine did raise a finding and
  // every operand may be present; what is missing is a permitted
  // expression (§88.1). A code that blamed an absent finding or a
  // missing operand would send a reader looking in the wrong place.

  test("the reason names the actual condition: no permitted expression, not an absent finding", () => {
    const validated = answers({
      q6_followup: "nothing_planned",
      q7_messages_to_book: "more_than_three",
    });
    const findings = deriveFindings(validated);
    // The unanswered finding IS present on this run, so "no unanswered
    // finding" would be false — and every E1 operand is present too.
    assert.ok(findings.some((f) => f.condition === "enquiry.unanswered"));
    for (const condition of ["enquiry.no_followup", "booking.friction"]) {
      const finding = findings.find((f) => f.condition === condition);
      assert.ok(finding, condition);
      const impact = computeLostRevenue(finding, validated, CONTEXT);
      assert.deepEqual(impact, { kind: "unknown", reason: "no_permitted_expression" });
    }
  });

  test("no_permitted_expression is never the reason for the one sizeable condition", () => {
    for (const patch of [
      {},
      { q4_unanswered_per_week: undefined },
      { q5_miss_visibility: "no" },
      { q8_typical_job_value: undefined },
      { q9_conversion_share: "a_minority" },
    ]) {
      const impact = size(patch);
      if (impact.kind === "unknown") {
        assert.notEqual(impact.reason, "no_permitted_expression", JSON.stringify(patch));
      }
    }
  });

  test("the report and every estimate basis carry ONE shared rule-set version", () => {
    // D3: one constant, defined in scanTypes, read by both the finding
    // engine (report) and the sizing module (basis). They cannot drift.
    assert.equal(FINDINGS_RULE_SET_VERSION, SCAN_RULE_SET_VERSION);
    const report = buildScanReport(answers(), CONTEXT);
    assert.equal(report.rule_set_version, SCAN_RULE_SET_VERSION);
    const sized = report.findings.filter((e) => e.impact.kind === "estimate");
    assert.ok(sized.length > 0, "the sizeable run must produce an estimate");
    for (const entry of sized) {
      assert.equal(entry.impact.basis.rule_set_version, report.rule_set_version);
      assert.equal(entry.impact.basis.rule_set_version, SCAN_RULE_SET_VERSION);
    }
  });

  test("a follow-up or friction finding is never sized, even with full operands", () => {
    const validated = answers({
      q6_followup: "nothing_planned",
      q7_messages_to_book: "more_than_three",
    });
    for (const condition of ["enquiry.no_followup", "booking.friction"]) {
      const finding = deriveFindings(validated).find((f) => f.condition === condition);
      assert.ok(finding);
      const impact = computeLostRevenue(finding, validated, CONTEXT);
      assert.equal(impact.kind, "unknown");
    }
  });
});

// ── 2. The calculation ─────────────────────────────────────────────

describe("E1 computes a range, never a point", () => {
  test("the happy path: 4 × [0.4, 0.6] × 250 EUR per week", () => {
    const impact = size();
    assert.equal(impact.kind, "estimate");
    assert.deepEqual(impact.basis.result, {
      low: 400,
      high: 600,
      currency: "EUR",
      period: "week",
      rounding_rule: "outward_to_whole_currency_unit",
    });
  });

  test("both ends are evaluated — low with low, high with high", () => {
    const impact = size({
      q8_typical_job_value: { kind: "range", low: 100, high: 400, currency: "EUR" },
    });
    // 4 × 0.4 × 100 = 160 ; 4 × 0.6 × 400 = 960
    assert.equal(impact.basis.result.low, 160);
    assert.equal(impact.basis.result.high, 960);
  });

  test("the result is never a point", () => {
    const impact = size();
    assert.notEqual(impact.basis.result.low, impact.basis.result.high);
  });

  test("rounding is outward — low down, high up", () => {
    // 3 × 0.67 × 250 = 502.5 → 502 ; 3 × 1.0 × 250 = 750
    const impact = size({
      q4_unanswered_per_week: { kind: "count", value: 3 },
      q9_conversion_share: "most",
    });
    assert.equal(impact.basis.result.low, 502);
    assert.equal(impact.basis.result.high, 750);
  });

  test("the period is the week the owner answered in — never annualised", () => {
    const impact = size();
    assert.equal(impact.basis.result.period, "week");
    const weekly = 4 * 0.6 * 250;
    assert.ok(impact.basis.result.high <= Math.ceil(weekly));
  });

  test("the currency is the owner's own, and nothing converts it", () => {
    const impact = size({
      q8_typical_job_value: { kind: "amount", amount: 250, currency: "GBP" },
    });
    assert.equal(impact.basis.result.currency, "GBP");
  });
});

// ── 3. The Q9 bucket boundaries ────────────────────────────────────

describe("the Q9 buckets are applied at their endpoints", () => {
  test("'most' uses 0.67 and 1.0", () => {
    const impact = size({ q9_conversion_share: "most" });
    // 4 × 0.67 × 250 = 670 ; 4 × 1.0 × 250 = 1000
    assert.equal(impact.basis.result.low, 670);
    assert.equal(impact.basis.result.high, 1000);
    const bucket = impact.basis.operands.find((o) => o.operand_id === "q9_conversion_share");
    assert.deepEqual(bucket.normalised_range, [0.67, 1.0]);
  });

  test("'about half' uses 0.4 and 0.6", () => {
    const bucket = size().basis.operands.find((o) => o.operand_id === "q9_conversion_share");
    assert.deepEqual(bucket.normalised_range, [0.4, 0.6]);
  });

  test("'a minority' starts at zero, so it can never be sized", () => {
    // A consequence of the contract's own bucket, not a rule added
    // here: "somewhere between nothing and a number" is not a size.
    const impact = size({ q9_conversion_share: "a_minority" });
    assert.equal(impact.kind, "unknown");
    assert.equal(impact.reason, "range_spans_more_than_one_order_of_magnitude");
  });
});

// ── 4. Every UNKNOWN condition, separately ─────────────────────────

describe("UNKNOWN is a first-class result, with its own reason each time", () => {
  test("Q4 absent", () => {
    const impact = size({ q4_unanswered_per_week: undefined });
    assert.equal(impact.kind, "unknown");
    assert.equal(impact.reason, "q4_missing");
  });

  test("Q4 = not sure", () => {
    const impact = size({ q4_unanswered_per_week: { kind: "not_sure" } });
    assert.equal(impact.reason, "q4_not_sure");
  });

  test("Q4 = 0 — there is no finding to size", () => {
    const impact = size({ q4_unanswered_per_week: { kind: "count", value: 0 } });
    assert.equal(impact.reason, "q4_zero");
  });

  test("Q4 > Q3 — internally inconsistent", () => {
    const impact = size({
      q3_enquiries_per_week: { kind: "count", value: 5 },
      q4_unanswered_per_week: { kind: "count", value: 9 },
    });
    assert.equal(impact.reason, "q4_exceeds_q3");
  });

  test("Q5 = no BLOCKS SIZING — a recollection may not support money", () => {
    const impact = size({ q5_miss_visibility: "no" });
    assert.equal(impact.kind, "unknown");
    assert.equal(impact.reason, "q5_no_miss_visibility");
  });

  test("Q5 = no still permits the finding itself, at low confidence", () => {
    const validated = answers({ q5_miss_visibility: "no" });
    const finding = deriveFindings(validated).find((f) => f.condition === "enquiry.unanswered");
    assert.ok(finding, "the finding must survive; only the money is refused");
    assert.equal(finding.finding_confidence, "low");
  });

  test("Q8 absent, and Q8 = not sure", () => {
    assert.equal(size({ q8_typical_job_value: undefined }).reason, "q8_missing");
    assert.equal(size({ q8_typical_job_value: { kind: "not_sure" } }).reason, "q8_not_sure");
  });

  test("Q9 absent, and Q9 = not sure", () => {
    assert.equal(size({ q9_conversion_share: undefined }).reason, "q9_missing");
    assert.equal(size({ q9_conversion_share: "not_sure" }).reason, "q9_not_sure");
  });

  test("a range spanning more than one order of magnitude", () => {
    const impact = size({
      q4_unanswered_per_week: { kind: "count", value: 1 },
      q8_typical_job_value: { kind: "range", low: 10, high: 500, currency: "EUR" },
    });
    // 0.4 × 10 = 4 ; 0.6 × 500 = 300 — a 75× span, which says nothing.
    assert.equal(impact.kind, "unknown");
    assert.equal(impact.reason, "range_spans_more_than_one_order_of_magnitude");
  });

  // ── D1: the order-of-magnitude test reads the COMPUTED range (§88.3),
  // before outward rounding; rounding belongs to presentation (§88.2).
  // 1 × [0.4, 0.6] × [4, 23] = [1.6, 13.8]: a 8.6× span the arithmetic
  // supports. Rounded outward it is [1, 14], a 14× span, which is what
  // the test must NOT be judged on.

  test("eligibility uses the pre-rounding endpoints, so rounding cannot refuse a range the arithmetic supports", () => {
    const impact = size({
      q4_unanswered_per_week: { kind: "count", value: 1 },
      q8_typical_job_value: { kind: "range", low: 4, high: 23, currency: "EUR" },
    });
    assert.equal(impact.kind, "estimate");
  });

  test("presentation still uses the outward-rounded endpoints", () => {
    const impact = size({
      q4_unanswered_per_week: { kind: "count", value: 1 },
      q8_typical_job_value: { kind: "range", low: 4, high: 23, currency: "EUR" },
    });
    assert.equal(impact.basis.result.low, 1); // floor(1.6)
    assert.equal(impact.basis.result.high, 14); // ceil(13.8)
    assert.equal(impact.basis.result.rounding_rule, "outward_to_whole_currency_unit");
  });

  test("recomputation of the pre-rounding-eligible range is deterministic and reproduces the stored result", () => {
    const patch = {
      q4_unanswered_per_week: { kind: "count", value: 1 },
      q8_typical_job_value: { kind: "range", low: 4, high: 23, currency: "EUR" },
    };
    const first = size(patch);
    const second = size(patch);
    assert.deepEqual(first, second);
    assert.equal(basisReproducesResult(first.basis), true);
    assert.deepEqual(recomputeFromBasis(first.basis), first.basis.result);
  });

  test("UNKNOWN stays fail-safe: a computed range that spans more than 10× is still refused", () => {
    // 1 × [0.4, 0.6] × [4, 24] = [1.6, 14.4]: 9×, kept.
    // 1 × [0.4, 0.6] × [4, 30] = [1.6, 18.0]: 11.25×, refused.
    const kept = size({
      q4_unanswered_per_week: { kind: "count", value: 1 },
      q8_typical_job_value: { kind: "range", low: 4, high: 24, currency: "EUR" },
    });
    assert.equal(kept.kind, "estimate");
    const refused = size({
      q4_unanswered_per_week: { kind: "count", value: 1 },
      q8_typical_job_value: { kind: "range", low: 4, high: 30, currency: "EUR" },
    });
    assert.equal(refused.kind, "unknown");
    assert.equal(refused.reason, "range_spans_more_than_one_order_of_magnitude");
    // And a zero low end is refused before rounding could hide it.
    const zero = size({ q9_conversion_share: "a_minority" });
    assert.equal(zero.kind, "unknown");
    assert.equal(zero.reason, "range_spans_more_than_one_order_of_magnitude");
  });

  test("exactly one order of magnitude is still information", () => {
    const impact = size({
      q4_unanswered_per_week: { kind: "count", value: 1 },
      q8_typical_job_value: { kind: "range", low: 100, high: 1000, currency: "EUR" },
    });
    // 0.4 × 100 = 40 ; 0.6 × 1000 = 600 → 15×, refused.
    assert.equal(impact.kind, "unknown");

    const narrower = size({
      q4_unanswered_per_week: { kind: "count", value: 1 },
      q8_typical_job_value: { kind: "range", low: 200, high: 400, currency: "EUR" },
    });
    // 0.4 × 200 = 80 ; 0.6 × 400 = 240 → 3×, kept.
    assert.equal(narrower.kind, "estimate");
  });

  test("no UNKNOWN result carries a number anywhere", () => {
    for (const patch of [
      { q4_unanswered_per_week: { kind: "not_sure" } },
      { q5_miss_visibility: "no" },
      { q8_typical_job_value: { kind: "not_sure" } },
      { q9_conversion_share: "not_sure" },
    ]) {
      const impact = size(patch);
      assert.equal(impact.kind, "unknown");
      assert.ok(!("basis" in impact));
      assert.ok(!("result" in impact));
    }
  });
});

// ── 5. Size confidence, separate from finding confidence ───────────

describe("size confidence is capped, and never merged with the finding's", () => {
  test("uncapped when the narrowest bucket, a single amount and full visibility", () => {
    const impact = size();
    assert.equal(impact.basis.size_confidence, "high");
    assert.equal(impact.basis.size_confidence_cap_reason, null);
  });

  test("a wide Q9 bucket caps it", () => {
    const impact = size({ q9_conversion_share: "most" });
    assert.equal(impact.basis.size_confidence, "medium");
    assert.equal(impact.basis.size_confidence_cap_reason, "q9_wide_conversion_bucket");
  });

  test("a Q8 range caps it", () => {
    const impact = size({
      q8_typical_job_value: { kind: "range", low: 200, high: 400, currency: "EUR" },
    });
    assert.equal(impact.basis.size_confidence, "medium");
    assert.equal(impact.basis.size_confidence_cap_reason, "q8_value_range");
  });

  test("Q5 = sometimes caps it lowest, and is the reason shown", () => {
    const impact = size({
      q5_miss_visibility: "sometimes",
      q9_conversion_share: "most",
    });
    assert.equal(impact.basis.size_confidence, "low");
    assert.equal(impact.basis.size_confidence_cap_reason, "q5_partial_miss_visibility");
  });

  test("the two confidences can differ, which is the honest part", () => {
    const validated = answers({ q5_miss_visibility: "sometimes" });
    const finding = deriveFindings(validated).find((f) => f.condition === "enquiry.unanswered");
    const impact = computeLostRevenue(finding, validated, CONTEXT);
    assert.equal(finding.finding_confidence, "medium");
    assert.equal(impact.basis.size_confidence, "low");
  });
});

// ── 6. The estimate_basis ──────────────────────────────────────────

describe("the estimate_basis freezes everything the number rests on", () => {
  test("it holds the actual operands used, with their raw answers", () => {
    const impact = size({
      q4_unanswered_per_week: { kind: "count", value: 4 },
      q8_typical_job_value: { kind: "range", low: 200, high: 400, currency: "EUR" },
    });
    const ids = impact.basis.operands.map((o) => o.operand_id);
    assert.deepEqual(ids, [
      "q4_unanswered_per_week",
      "q9_conversion_share",
      "q8_typical_job_value",
    ]);

    const byId = Object.fromEntries(impact.basis.operands.map((o) => [o.operand_id, o]));
    assert.deepEqual(byId.q4_unanswered_per_week.raw_answer, { kind: "count", value: 4 });
    assert.deepEqual(byId.q4_unanswered_per_week.normalised_range, [4, 4]);
    assert.equal(byId.q4_unanswered_per_week.unit, "enquiries_per_week");
    assert.equal(byId.q9_conversion_share.raw_answer, "about_half");
    assert.deepEqual(byId.q8_typical_job_value.raw_answer, {
      kind: "range",
      low: 200,
      high: 400,
      currency: "EUR",
    });
    assert.equal(byId.q8_typical_job_value.unit, "EUR");
  });

  test("every operand is business_provided and carries answered_at", () => {
    for (const operand of size().basis.operands) {
      assert.equal(operand.source_type, "business_provided");
      assert.equal(operand.answered_at, CONTEXT.answered_at);
    }
  });

  test("the basis carries both version stamps and computed_at", () => {
    const basis = size().basis;
    assert.equal(basis.expression_id, "lost_revenue.unanswered_enquiries");
    assert.equal(basis.expression_version, "v1");
    assert.ok(basis.question_set_version.length > 0);
    assert.ok(basis.rule_set_version.length > 0);
    assert.equal(basis.computed_at, CONTEXT.computed_at);
  });

  test("the estimate is derived_deterministic, never observed", () => {
    const basis = size().basis;
    assert.equal(basis.source_type, "derived_deterministic");
    assert.doesNotMatch(JSON.stringify(basis), /"observed"|"verified"|"ai_predicted"/);
  });

  test("all three assumptions are retained, with their display text", () => {
    const basis = size().basis;
    assert.deepEqual(
      basis.assumptions.map((a) => a.code),
      ["assumed.same_conversion", "assumed.typical_value", "assumed.owner_estimate"]
    );
    for (const assumption of basis.assumptions) {
      assert.equal(assumption.source_type, "assumed");
      assert.ok(assumption.display_text.length > 0);
    }
    assert.deepEqual(basis.assumptions, E1_ASSUMPTIONS);
  });

  test("the same-conversion assumption says it is likely to be generous", () => {
    const same = E1_ASSUMPTIONS.find((a) => a.code === "assumed.same_conversion");
    assert.match(same.display_text, /generous/i);
  });

  test("no benchmark, industry figure or annualisation appears anywhere", () => {
    const serialised = JSON.stringify(size().basis);
    assert.doesNotMatch(serialised, /benchmark|industry|average business|per year|annual/i);
  });
});

// ── 7. Recomputability — §88.4's acceptance test ───────────────────

describe("a displayed number is recomputable from its basis alone", () => {
  const PATCHES = [
    {},
    { q9_conversion_share: "most" },
    { q4_unanswered_per_week: { kind: "count", value: 3 }, q9_conversion_share: "most" },
    { q8_typical_job_value: { kind: "range", low: 200, high: 400, currency: "GBP" } },
    { q4_unanswered_per_week: { kind: "count", value: 1 } },
    { q5_miss_visibility: "sometimes" },
  ];

  test("recomputeFromBasis reproduces the stored result exactly", () => {
    for (const patch of PATCHES) {
      const impact = size(patch);
      assert.equal(impact.kind, "estimate", JSON.stringify(patch));
      assert.deepEqual(recomputeFromBasis(impact.basis), impact.basis.result);
    }
  });

  test("basisReproducesResult holds for every estimate produced", () => {
    for (const patch of PATCHES) {
      assert.equal(basisReproducesResult(size(patch).basis), true);
    }
  });

  test("recomputation uses the operands, not the stored result", () => {
    const impact = size();
    const tampered = {
      ...impact.basis,
      result: { ...impact.basis.result, low: 1, high: 999999 },
    };
    // The stored figures changed; the recomputation did not follow them.
    assert.deepEqual(recomputeFromBasis(tampered), impact.basis.result);
    assert.equal(basisReproducesResult(tampered), false);
  });

  test("a basis whose operand was altered no longer reproduces its result", () => {
    const impact = size();
    const tampered = {
      ...impact.basis,
      operands: impact.basis.operands.map((o) =>
        o.operand_id === "q4_unanswered_per_week"
          ? { ...o, normalised_range: [40, 40] }
          : o
      ),
    };
    assert.equal(basisReproducesResult(tampered), false);
  });

  test("the currency is recomputed from the operand, not read off the result", () => {
    const impact = size({
      q8_typical_job_value: { kind: "amount", amount: 250, currency: "GBP" },
    });
    const tampered = {
      ...impact.basis,
      result: { ...impact.basis.result, currency: "USD" },
    };
    assert.equal(recomputeFromBasis(tampered).currency, "GBP");
    assert.equal(basisReproducesResult(tampered), false);
  });

  test("EVERY displayed number in a whole report satisfies the invariant", () => {
    const report = buildScanReport(
      answers({ q6_followup: "nothing_planned", q7_messages_to_book: "more_than_three" }),
      CONTEXT
    );
    let displayed = 0;
    for (const entry of report.findings) {
      if (entry.impact.kind !== "estimate") continue;
      displayed += 1;
      assert.equal(
        basisReproducesResult(entry.impact.basis),
        true,
        `${entry.finding.condition} shows a number it cannot reproduce`
      );
    }
    assert.equal(displayed, 1, "exactly one Phase 1 class is sizeable");
  });
});

// ── 8. Determinism ─────────────────────────────────────────────────

describe("sizing is pure", () => {
  test("the same answers and context produce a deeply equal impact", () => {
    const a = size();
    for (let i = 0; i < 25; i += 1) assert.deepEqual(size(), a);
  });

  test("the answers object is never mutated", () => {
    const validated = answers();
    const before = structuredClone(validated);
    computeLostRevenue(unansweredFinding(validated), validated, CONTEXT);
    assert.deepEqual(validated, before);
  });

  test("timestamps come from the caller, never from a clock", () => {
    const other = {
      answered_at: "2020-01-01T00:00:00.000Z",
      computed_at: "2020-01-01T00:00:00.000Z",
    };
    const validated = answers();
    const impact = computeLostRevenue(unansweredFinding(validated), validated, other);
    assert.equal(impact.basis.computed_at, other.computed_at);
    assert.equal(impact.basis.operands[0].answered_at, other.answered_at);
  });
});
