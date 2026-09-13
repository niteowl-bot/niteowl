// Business Opportunity Scan — the four-state impact classification (PR D).
//
// What this suite proves:
//
//   1. Every sizing outcome maps to exactly one of the four states, and
//      the table is exhaustive over the live reason enumeration — a
//      reason added to the sizing module without a class here fails.
//   2. All four states are reachable FROM A REAL REPORT, so none is a
//      decorative enum member.
//   3. `directional` is never silently upgraded to `quantified`: the
//      classifier reads a reason code and cannot see the operands, so
//      it has no way to widen a bucket or relax a gate (§106).
//   4. It is PRESENTATION ONLY — adding it changed no arithmetic, no
//      gate and no number anywhere in the shipped sizing module.
//   5. No class's wording carries a figure, a currency or a comparison
//      to another business. A sentence about size that carries a number
//      is a size.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  IMPACT_CLASS_BY_REASON,
  IMPACT_CLASS_WORDING,
  classifyImpact,
} from "@/lib/freetools/scanImpactClass";
import { buildScanReport } from "@/lib/freetools/scanFindings";
import { computeLostRevenue } from "@/lib/freetools/scanLostRevenue";
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

function answers(patch = {}) {
  const result = validateScanAnswers({ ...QUIET, ...patch });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return result.answers;
}

const report = (patch) => buildScanReport(answers(patch), CONTEXT);

const entryFor = (patch, condition) =>
  report(patch).findings.find((f) => f.finding.condition === condition);

/** A sized run: unanswered enquiries with all three E1 operands present. */
const SIZED = {
  q4_unanswered_per_week: { kind: "count", value: 3 },
  q8_typical_job_value: { kind: "amount", amount: 250, currency: "EUR" },
  q9_conversion_share: "most",
};

// ── 1. The mapping is exhaustive ───────────────────────────────────

describe("every sizing outcome has exactly one class", () => {
  test("the table covers every reason the sizing module can produce", () => {
    const src = readFileSync("src/lib/freetools/scanTypes.ts", "utf8");
    const union = src.match(/export type LostRevenueUnknownReason =([\s\S]*?);/);
    assert.ok(union, "LostRevenueUnknownReason is not declared where expected");
    const declared = (union[1].match(/"[^"]+"/g) ?? []).map((s) => s.slice(1, -1));

    assert.ok(declared.length > 0);
    assert.deepEqual(
      [...declared].sort(),
      Object.keys(IMPACT_CLASS_BY_REASON).sort(),
      "a sizing reason has no impact class, or a class has no reason"
    );
  });

  test("every class has fixed wording", () => {
    for (const impactClass of Object.values(IMPACT_CLASS_BY_REASON)) {
      assert.equal(typeof IMPACT_CLASS_WORDING[impactClass], "string");
      assert.ok(IMPACT_CLASS_WORDING[impactClass].length > 0);
    }
    assert.ok(IMPACT_CLASS_WORDING.quantified.length > 0);
  });

  test("an estimate is quantified, with a loss direction", () => {
    const classification = classifyImpact({
      kind: "estimate",
      basis: { result: { low: 1, high: 2 } },
    });
    assert.equal(classification.impact_class, "quantified");
    assert.equal(classification.direction, "loss");
    assert.equal(classification.reason, null);
  });

  test("an unknown carries its reason through unchanged", () => {
    for (const reason of Object.keys(IMPACT_CLASS_BY_REASON)) {
      const classification = classifyImpact({ kind: "unknown", reason });
      assert.equal(classification.reason, reason);
      assert.equal(classification.impact_class, IMPACT_CLASS_BY_REASON[reason]);
      assert.equal(classification.source_type, "derived_deterministic");
    }
  });

  test("a direction is claimed only where the answers support one", () => {
    for (const reason of Object.keys(IMPACT_CLASS_BY_REASON)) {
      const classification = classifyImpact({ kind: "unknown", reason });
      if (classification.impact_class === "directional") {
        assert.equal(classification.direction, "loss");
      } else {
        assert.equal(classification.direction, null, reason);
      }
    }
  });
});

// ── 2. All four states are reachable from a real report ────────────

describe("all four states are reachable, none is decorative", () => {
  test("quantified — E1 produced a range", () => {
    const entry = entryFor(SIZED, "enquiry.unanswered");
    assert.equal(entry.impact.kind, "estimate");
    assert.equal(entry.impact_class.impact_class, "quantified");
  });

  test("material_unquantifiable — no permitted expression exists", () => {
    const followUp = entryFor({ q6_followup: "nothing_planned" }, "enquiry.no_followup");
    assert.equal(followUp.impact.reason, "no_permitted_expression");
    assert.equal(followUp.impact_class.impact_class, "material_unquantifiable");

    const friction = entryFor({ q7_messages_to_book: "more_than_three" }, "booking.friction");
    assert.equal(friction.impact_class.impact_class, "material_unquantifiable");
  });

  test("insufficient_evidence — an operand is missing, or the gate closed", () => {
    const noValue = entryFor(
      { q4_unanswered_per_week: { kind: "count", value: 3 }, q9_conversion_share: "most" },
      "enquiry.unanswered"
    );
    assert.equal(noValue.impact.reason, "q8_missing");
    assert.equal(noValue.impact_class.impact_class, "insufficient_evidence");

    const noVisibility = entryFor({ ...SIZED, q5_miss_visibility: "no" }, "enquiry.unanswered");
    assert.equal(noVisibility.impact.reason, "q5_no_miss_visibility");
    assert.equal(noVisibility.impact_class.impact_class, "insufficient_evidence");
  });

  test("directional — the range is too wide to carry information", () => {
    const wide = entryFor(
      {
        q4_unanswered_per_week: { kind: "count", value: 3 },
        q8_typical_job_value: { kind: "range", low: 50, high: 5000, currency: "EUR" },
        q9_conversion_share: "about_half",
      },
      "enquiry.unanswered"
    );
    assert.equal(wide.impact.reason, "range_spans_more_than_one_order_of_magnitude");
    assert.equal(wide.impact_class.impact_class, "directional");
    assert.equal(wide.impact_class.direction, "loss");
  });
});

// ── 3. Directional is never upgraded ───────────────────────────────

describe("directional is never silently upgraded to quantified", () => {
  test("the classifier sees a reason code and never the operands", () => {
    const codeOf = readFileSync("src/lib/freetools/scanImpactClass.ts", "utf8")
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    // No arithmetic, no operand, no bucket, no threshold.
    assert.doesNotMatch(codeOf, /operands|normalised_range|CONVERSION_BUCKET|Math\.|roundOutward|evaluate\(/);
  });

  test("classifyImpact takes the impact and nothing else", () => {
    assert.equal(classifyImpact.length, 1);
  });

  test("the same wide range stays directional however it is reached", () => {
    for (const q9 of ["about_half", "a_minority"]) {
      const impact = computeLostRevenue(
        { condition: "enquiry.unanswered" },
        answers({
          q4_unanswered_per_week: { kind: "count", value: 3 },
          q8_typical_job_value: { kind: "range", low: 50, high: 5000, currency: "EUR" },
          q9_conversion_share: q9,
        }),
        CONTEXT
      );
      assert.equal(impact.kind, "unknown");
      assert.notEqual(classifyImpact(impact).impact_class, "quantified");
    }
  });
});

// ── 4. Presentation only ───────────────────────────────────────────

describe("classification changed no arithmetic in the shipped sizing module", () => {
  test("the sizing module does not import or know about the classifier", () => {
    const src = readFileSync("src/lib/freetools/scanLostRevenue.ts", "utf8");
    assert.doesNotMatch(src, /scanImpactClass|impact_class|ScanImpactClass/);
  });

  test("the impact on a report is byte-identical to computeLostRevenue's own output", () => {
    for (const patch of [SIZED, { q6_followup: "nothing_planned" }, { q7_messages_to_book: "varies_a_lot" }]) {
      const r = report(patch);
      for (const entry of r.findings) {
        assert.deepEqual(
          entry.impact,
          computeLostRevenue(entry.finding, answers(patch), CONTEXT)
        );
      }
    }
  });
});

// ── 5. No figure inside a sentence about size ──────────────────────

describe("no class wording carries a figure or a comparison", () => {
  test("no digit, no currency, no benchmark language", () => {
    for (const [name, wording] of Object.entries(IMPACT_CLASS_WORDING)) {
      assert.doesNotMatch(wording, /\d/, `${name} carries a digit`);
      assert.doesNotMatch(wording, /[£€$]|\b(EUR|GBP|USD)\b/, `${name} carries a currency`);
      assert.doesNotMatch(
        wording,
        /businesses like yours|other businesses|industry|average business|benchmark/i,
        `${name} compares to other businesses`
      );
    }
  });

  test("material_unquantifiable reads as a judgement, not as a failure", () => {
    assert.match(IMPACT_CLASS_WORDING.material_unquantifiable, /we have not tried/i);
    assert.doesNotMatch(IMPACT_CLASS_WORDING.material_unquantifiable, /we could not work|we failed/i);
  });
});
