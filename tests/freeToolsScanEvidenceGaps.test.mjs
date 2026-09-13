// Business Opportunity Scan — evidence gaps (PR D).
//
// What this suite proves:
//
//   1. Every gap is RECONSTRUCTIBLE from the report that carries it —
//      its confidence caps, its sizing reasons and its stage states —
//      and from nothing else (§105: derived, never primary). The
//      reconstruction is executed here, not asserted.
//   2. `no_permitted_expression` produces NO GAP. There is no
//      information an owner could supply that would size it, and a gap
//      there would promise a number that does not exist.
//   3. `expected_information_gain` is a claim about NITEOWL'S OWN RULES
//      — never about the business. No gap sentence carries a digit, a
//      currency or the vocabulary of loss.
//   4. A gap either names one of our nine questions or tells the owner
//      what to find out — never both, and never neither.
//   5. Gaps are deduplicated, ordered stably, and every gap code and
//      information gain is reachable.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { SCAN_EVIDENCE_GAPS, deriveEvidenceGaps } from "@/lib/freetools/scanEvidenceGaps";
import { buildScanReport } from "@/lib/freetools/scanFindings";
import { SCAN_QUESTION_IDS } from "@/lib/freetools/scanQuestions";
import { validateScanAnswers } from "@/lib/freetools/scanValidation";

const CONTEXT = {
  answered_at: "2026-09-13T10:00:00.000Z",
  computed_at: "2026-09-13T10:00:01.000Z",
};

const QUIET = {
  q1_channels: ["phone"],
  q2_reachable: "working_hours",
  q3_enquiries_per_week: { kind: "count", value: 20 },
  q4_unanswered_per_week: { kind: "count", value: 0 },
  q5_miss_visibility: "yes_always",
  q6_followup: "within_a_day",
  q7_messages_to_book: "one",
};

function validated(patch = {}) {
  const result = validateScanAnswers({ ...QUIET, ...patch });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return result;
}

function report(patch = {}) {
  const v = validated(patch);
  return buildScanReport(v.answers, CONTEXT, v.inconsistencies);
}

const codes = (patch) => report(patch).evidence_gaps.map((g) => g.gap_code);

// ── 1. Gaps are derived from the report and nothing else ───────────

describe("every gap is reconstructible from the report that carries it", () => {
  test("rebuilding from caps, sizing reasons and stage states reproduces the set", () => {
    // The reconstruction, written independently of the module: read the
    // three sources off the report and re-derive. If a gap ever came
    // from somewhere else, the two sets would differ.
    const CAP_TO_GAP = {
      q5_no_miss_visibility: "miss_visibility_absent",
      q5_partial_miss_visibility: "miss_visibility_partial",
      q7_varies_a_lot: "messages_to_book_unsteady",
      q9_wide_conversion_bucket: "conversion_share_coarse",
      q8_value_range: "job_value_range",
    };
    const REASON_TO_GAP = {
      q4_missing: "unanswered_count_not_given",
      q4_not_sure: "unanswered_count_unknown",
      q5_no_miss_visibility: "miss_visibility_absent",
      q8_missing: "job_value_not_given",
      q8_not_sure: "job_value_unknown",
      q9_missing: "conversion_share_not_given",
      q9_not_sure: "conversion_share_unknown",
      range_spans_more_than_one_order_of_magnitude: "operand_ranges_too_wide",
    };
    // Stage state, not raw answers: the funnel has already decided what
    // could not be established and why, and a gap is derived from that.
    const STAGE_TO_GAP = {
      enquiry_answered: {
        answer_not_given: "unanswered_count_not_given",
        owner_not_sure: "unanswered_count_unknown",
      },
      time_agreed: { owner_not_sure: "booking_effort_unknown" },
      enquiry_followed_up: { owner_not_sure: "followup_practice_unknown" },
    };

    const patches = [
      {},
      { q4_unanswered_per_week: { kind: "count", value: 3 } },
      { q4_unanswered_per_week: { kind: "count", value: 3 }, q5_miss_visibility: "sometimes" },
      { q4_unanswered_per_week: { kind: "count", value: 3 }, q5_miss_visibility: "no" },
      { q4_unanswered_per_week: { kind: "count", value: 3 }, q8_typical_job_value: { kind: "range", low: 100, high: 300, currency: "EUR" }, q9_conversion_share: "most" },
      { q4_unanswered_per_week: { kind: "count", value: 3 }, q8_typical_job_value: { kind: "amount", amount: 250, currency: "EUR" }, q9_conversion_share: "about_half" },
      { q6_followup: "not_sure", q7_messages_to_book: "not_sure" },
      { q7_messages_to_book: "varies_a_lot" },
      { q6_followup: "nothing_planned", q7_messages_to_book: "more_than_three" },
      { q4_unanswered_per_week: undefined },
      { q4_unanswered_per_week: { kind: "not_sure" } },
      { q4_unanswered_per_week: undefined, q7_messages_to_book: "varies_a_lot" },
      { q4_unanswered_per_week: { kind: "count", value: 0 }, q5_miss_visibility: "no" },
    ];

    for (const patch of patches) {
      const r = report(patch);
      const expected = new Set();

      for (const entry of r.findings) {
        if (entry.finding.confidence_cap_reason) {
          expected.add(CAP_TO_GAP[entry.finding.confidence_cap_reason]);
        }
        if (entry.impact.kind === "unknown") {
          const mapped = REASON_TO_GAP[entry.impact.reason];
          if (mapped) expected.add(mapped);
        } else if (entry.impact.basis.size_confidence_cap_reason) {
          expected.add(CAP_TO_GAP[entry.impact.basis.size_confidence_cap_reason]);
        }
      }

      for (const stage of r.funnel.stages) {
        if (!stage.assessable || stage.assessment !== "not_established") continue;
        const mapped = STAGE_TO_GAP[stage.stage_id]?.[stage.not_established_reason];
        if (mapped) expected.add(mapped);
      }

      assert.deepEqual(
        new Set(codes(patch)),
        expected,
        `gap set not reconstructible for ${JSON.stringify(patch)}`
      );
    }
  });

  test("deriveEvidenceGaps reads the findings and the funnel — not the raw answers", () => {
    // Two parameters, both canonical report state. The answers are
    // deliberately out of reach: everything a gap needs has already
    // been decided by a canonical module and recorded.
    assert.equal(deriveEvidenceGaps.length, 2);
  });
});

// ── 1b. The two Q4 gaps come from the funnel, not from sizing ──────

describe("an unanswered Q4 produces its gap from the stage, not from sizing", () => {
  test("Q4 absent — the stage is not_established, and the gap names our question", () => {
    const r = report({ q4_unanswered_per_week: undefined });
    const stage = r.funnel.stages.find((s) => s.stage_id === "enquiry_answered");
    assert.equal(stage.assessment, "not_established");
    assert.equal(stage.not_established_reason, "answer_not_given");

    const gap = r.evidence_gaps.find((g) => g.gap_code === "unanswered_count_not_given");
    assert.ok(gap, "the gap was not emitted");
    assert.equal(gap.closing_question_id, "q4_unanswered_per_week");
    assert.equal(gap.owner_action, null);
    assert.deepEqual([...gap.blocks], ["diagnosis", "sizing"]);
    assert.equal(gap.expected_information_gain, "would_allow_a_size_range");
    assert.equal(gap.effort_band, "answer_now");
    assert.equal(gap.source_type, "derived_deterministic");
  });

  test("Q4 not_sure — the stage is not_established, and the gap asks for no answer twice", () => {
    const r = report({ q4_unanswered_per_week: { kind: "not_sure" } });
    const stage = r.funnel.stages.find((s) => s.stage_id === "enquiry_answered");
    assert.equal(stage.assessment, "not_established");
    assert.equal(stage.not_established_reason, "owner_not_sure");

    const gap = r.evidence_gaps.find((g) => g.gap_code === "unanswered_count_unknown");
    assert.ok(gap, "the gap was not emitted");
    // The owner already answered truthfully; re-asking closes nothing.
    assert.equal(gap.closing_question_id, null);
    assert.ok(gap.owner_action && gap.owner_action.length > 0);
    assert.deepEqual([...gap.blocks], ["diagnosis", "sizing"]);
    assert.equal(gap.expected_information_gain, "would_allow_a_size_range");
    assert.equal(gap.effort_band, "count_over_a_period");
  });

  test("the two Q4 gaps are mutually exclusive", () => {
    const absent = codes({ q4_unanswered_per_week: undefined });
    const notSure = codes({ q4_unanswered_per_week: { kind: "not_sure" } });
    assert.ok(absent.includes("unanswered_count_not_given"));
    assert.ok(!absent.includes("unanswered_count_unknown"));
    assert.ok(notSure.includes("unanswered_count_unknown"));
    assert.ok(!notSure.includes("unanswered_count_not_given"));
  });

  test("NEITHER case manufactures an enquiry.unanswered finding", () => {
    for (const q4 of [undefined, { kind: "not_sure" }]) {
      const r = report({ q4_unanswered_per_week: q4 });
      assert.equal(r.findings.length, 0, "a finding was manufactured");
      assert.ok(!r.findings.some((f) => f.finding.condition === "enquiry.unanswered"));
      assert.deepEqual(r.prioritisation, []);
      assert.deepEqual(r.dependencies, []);
      assert.equal(r.earliest_leak, null);
    }
  });

  test("NEITHER case invokes sizing, and the gap is not a sizing result", () => {
    for (const q4 of [undefined, { kind: "not_sure" }]) {
      const r = report({ q4_unanswered_per_week: q4 });
      // No finding means computeLostRevenue was never called: there is
      // no impact anywhere on the report to have produced this gap.
      assert.equal(r.findings.length, 0);
      assert.ok(r.evidence_gaps.length > 0, "the gap came from somewhere");
      for (const entry of r.findings) assert.fail(`unexpected impact: ${entry.impact.kind}`);
    }
  });

  test("zero findings remains fully reachable alongside the gap", () => {
    const r = report({ q4_unanswered_per_week: undefined });
    assert.equal(r.findings.length, 0);
    assert.deepEqual(r.evidence_gaps.map((g) => g.gap_code), ["unanswered_count_not_given"]);
  });

  test("a stage unestablished for any OTHER reason still raises no gap", () => {
    // An inconsistency is shown in its own right, and "no way of
    // knowing" is a missing record rather than a missing answer.
    const clash = report({
      q3_enquiries_per_week: { kind: "count", value: 5 },
      q4_unanswered_per_week: { kind: "count", value: 9 },
    });
    assert.equal(
      clash.funnel.stages.find((s) => s.stage_id === "enquiry_answered")
        .not_established_reason,
      "answers_inconsistent"
    );
    assert.deepEqual(clash.evidence_gaps, []);

    const blind = report({
      q4_unanswered_per_week: { kind: "count", value: 0 },
      q5_miss_visibility: "no",
    });
    assert.equal(
      blind.funnel.stages.find((s) => s.stage_id === "enquiry_answered")
        .not_established_reason,
      "no_way_of_knowing"
    );
    assert.deepEqual(blind.evidence_gaps, []);
  });

  test("Q6 and Q7 gaps are unchanged by the move to stage state", () => {
    assert.deepEqual(codes({ q6_followup: "not_sure" }), ["followup_practice_unknown"]);
    assert.deepEqual(codes({ q7_messages_to_book: "not_sure" }), ["booking_effort_unknown"]);
  });
});

// ── 2. The gaps that must NOT exist ────────────────────────────────

describe("a gap is never raised where no information would close it", () => {
  test("no_permitted_expression raises nothing at all", () => {
    // Follow-up and friction alone: both are impact-unknown for that
    // reason, and neither may suggest a number is within reach.
    const followUp = report({ q6_followup: "nothing_planned" });
    assert.equal(followUp.findings[0].impact.reason, "no_permitted_expression");
    assert.deepEqual(followUp.evidence_gaps, []);

    const friction = report({ q7_messages_to_book: "more_than_three" });
    assert.equal(friction.findings[0].impact.reason, "no_permitted_expression");
    assert.deepEqual(friction.evidence_gaps, []);
  });

  test("a quiet run raises no gap", () => {
    assert.deepEqual(report().evidence_gaps, []);
  });

  test("nothing to report is not a shortfall in evidence", () => {
    // Q4 = 0 with visibility: the stage is adequate and nothing is
    // missing, so no gap is raised about it.
    assert.deepEqual(codes({ q4_unanswered_per_week: { kind: "count", value: 0 } }), []);
  });

  test("an inconsistency is shown in its own right, never restated as a gap", () => {
    const r = report({
      q3_enquiries_per_week: { kind: "count", value: 5 },
      q4_unanswered_per_week: { kind: "count", value: 9 },
    });
    assert.equal(r.inconsistencies.length, 1);
    assert.deepEqual(r.evidence_gaps, []);
  });
});

// ── 3. A gap is a claim about our rules, never about the business ──

describe("the information gain is about NiteOwl's rules, never the business", () => {
  const everyGap = Object.entries(SCAN_EVIDENCE_GAPS);

  test("no gap sentence carries a digit or a currency", () => {
    for (const [code, gap] of everyGap) {
      for (const text of [gap.wording, gap.owner_action ?? ""]) {
        assert.doesNotMatch(text, /\d/, `${code} carries a digit`);
        assert.doesNotMatch(text, /[£€$]|\b(EUR|GBP|USD)\b/, `${code} carries a currency`);
      }
    }
  });

  test("no gap promises what the owner would find", () => {
    // "Worth" is deliberately not banned: it is Q8's own noun ("what is
    // a typical job worth to you"), and naming the question a gap is
    // about is not a promise about what answering it would reveal.
    for (const [code, gap] of everyGap) {
      for (const text of [gap.wording, gap.owner_action ?? ""]) {
        assert.doesNotMatch(
          text,
          /\brevenue\b|\blosing\b|\blose\b|\blost\b|\bwould reveal\b|\bwould show you\b|\bwin back\b|\brecover\b/i,
          `${code} promises a finding rather than a rule`
        );
      }
    }
  });

  test("every gain is one of the four rule-shaped claims", () => {
    const allowed = new Set([
      "would_allow_a_size_range",
      "would_narrow_the_size_range",
      "would_raise_confidence",
      "would_allow_this_stage_to_be_assessed",
    ]);
    for (const [code, gap] of everyGap) {
      assert.ok(allowed.has(gap.expected_information_gain), `${code}: ${gap.expected_information_gain}`);
    }
  });

  test("every gain is reachable from a real report", () => {
    const seen = new Set();
    for (const patch of [
      { q4_unanswered_per_week: { kind: "count", value: 3 } },
      { q4_unanswered_per_week: { kind: "count", value: 3 }, q5_miss_visibility: "sometimes" },
      { q4_unanswered_per_week: { kind: "count", value: 3 }, q8_typical_job_value: { kind: "range", low: 100, high: 300, currency: "EUR" }, q9_conversion_share: "most" },
      { q6_followup: "not_sure" },
    ]) {
      for (const gap of report(patch).evidence_gaps) seen.add(gap.expected_information_gain);
    }
    assert.deepEqual([...seen].sort(), [
      "would_allow_a_size_range",
      "would_allow_this_stage_to_be_assessed",
      "would_narrow_the_size_range",
      "would_raise_confidence",
    ]);
  });
});

// ── 4. Shape ───────────────────────────────────────────────────────

describe("a gap names our question, or what the owner could find out", () => {
  test("exactly one of the two, never both and never neither", () => {
    for (const [code, gap] of Object.entries(SCAN_EVIDENCE_GAPS)) {
      const hasQuestion = gap.closing_question_id !== null;
      const hasAction = gap.owner_action !== null;
      assert.notEqual(hasQuestion, hasAction, `${code} has both or neither`);
    }
  });

  test("a named closing question is one of the nine", () => {
    for (const [code, gap] of Object.entries(SCAN_EVIDENCE_GAPS)) {
      if (gap.closing_question_id === null) continue;
      assert.ok(SCAN_QUESTION_IDS.includes(gap.closing_question_id), code);
    }
  });

  test("a gap names a closing question only where the owner has not already answered it", () => {
    // Q5 was answered ("no"), so its gap must not pretend re-asking
    // would close it — that would send the owner back to a question
    // they have already given a truthful answer to.
    assert.equal(SCAN_EVIDENCE_GAPS.miss_visibility_absent.closing_question_id, null);
    assert.equal(SCAN_EVIDENCE_GAPS.unanswered_count_unknown.closing_question_id, null);
    assert.equal(SCAN_EVIDENCE_GAPS.unanswered_count_not_given.closing_question_id, "q4_unanswered_per_week");
  });

  test("every gap declares what it blocks, and every block is a known kind", () => {
    const allowed = new Set(["diagnosis", "prioritisation", "sizing", "action", "confidence"]);
    for (const [code, gap] of Object.entries(SCAN_EVIDENCE_GAPS)) {
      assert.ok(gap.blocks.length > 0, `${code} blocks nothing`);
      for (const block of gap.blocks) assert.ok(allowed.has(block), `${code}: ${block}`);
    }
  });

  test("every gap carries an effort band from the closed set", () => {
    const allowed = new Set(["answer_now", "count_over_a_period", "needs_a_change_in_how_you_work"]);
    for (const [code, gap] of Object.entries(SCAN_EVIDENCE_GAPS)) {
      assert.ok(allowed.has(gap.effort_band), `${code}: ${gap.effort_band}`);
    }
  });
});

// ── 5. Dedup, order, reachability ──────────────────────────────────

describe("gaps are deduplicated, stably ordered and all reachable", () => {
  test("Q5 = no reaches the list from two rules and appears once", () => {
    const list = codes({ q4_unanswered_per_week: { kind: "count", value: 3 }, q5_miss_visibility: "no" });
    assert.equal(list.filter((c) => c === "miss_visibility_absent").length, 1);
  });

  test("the order is stable and is the table's declaration order", () => {
    const declared = Object.keys(SCAN_EVIDENCE_GAPS);
    const patch = {
      q4_unanswered_per_week: { kind: "count", value: 3 },
      q5_miss_visibility: "sometimes",
      q6_followup: "not_sure",
    };
    const list = codes(patch);
    assert.deepEqual(list, declared.filter((c) => list.includes(c)));
    assert.deepEqual(codes(patch), codes(patch));
  });

  test("every gap code in the type is in the table", () => {
    const src = readFileSync("src/lib/freetools/scanTypes.ts", "utf8");
    const union = src.match(/export type ScanEvidenceGapCode =([\s\S]*?);/);
    assert.ok(union, "ScanEvidenceGapCode is not declared where expected");
    const declared = (union[1].match(/"[^"]+"/g) ?? []).map((s) => s.slice(1, -1));
    assert.deepEqual([...declared].sort(), Object.keys(SCAN_EVIDENCE_GAPS).sort());
  });

  test("every gap code is reachable from some real report", () => {
    const seen = new Set();
    const q4s = [undefined, { kind: "not_sure" }, { kind: "count", value: 3 }];
    const q5s = ["yes_always", "sometimes", "no"];
    const q6s = ["within_a_day", "nothing_planned", "not_sure"];
    const q7s = ["one", "more_than_three", "varies_a_lot", "not_sure"];
    const q8s = [
      undefined,
      { kind: "not_sure" },
      { kind: "amount", amount: 250, currency: "EUR" },
      { kind: "range", low: 100, high: 300, currency: "EUR" },
      { kind: "range", low: 50, high: 5000, currency: "EUR" },
    ];
    const q9s = [undefined, "most", "about_half", "a_minority", "not_sure"];

    for (const q4 of q4s)
      for (const q5 of q5s)
        for (const q6 of q6s)
          for (const q7 of q7s)
            for (const q8 of q8s)
              for (const q9 of q9s) {
                const input = { ...QUIET, q5_miss_visibility: q5, q6_followup: q6, q7_messages_to_book: q7 };
                if (q4 === undefined) delete input.q4_unanswered_per_week;
                else input.q4_unanswered_per_week = q4;
                if (q8 !== undefined) input.q8_typical_job_value = q8;
                if (q9 !== undefined) input.q9_conversion_share = q9;

                const v = validateScanAnswers(input);
                assert.equal(v.valid, true, JSON.stringify(v.errors));
                const r = buildScanReport(v.answers, CONTEXT, v.inconsistencies);
                for (const gap of r.evidence_gaps) seen.add(gap.gap_code);
              }

    // EVERY DECLARED GAP CODE IS REACHABLE. The two Q4 codes reach the
    // sweep through the funnel's stage state rather than through a
    // sizing reason, which is the only route that can work: sizing runs
    // only on a finding, and an unanswered Q4 raises none (§87.4).
    assert.deepEqual(
      [...seen].sort(),
      Object.keys(SCAN_EVIDENCE_GAPS).sort(),
      "a declared gap code is unreachable"
    );
  });

  test("every gap is derived_deterministic", () => {
    for (const gap of report({ q4_unanswered_per_week: { kind: "count", value: 3 } }).evidence_gaps) {
      assert.equal(gap.source_type, "derived_deterministic");
    }
  });
});
