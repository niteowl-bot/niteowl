// Business Opportunity Scan — deterministic ordering (PR D).
//
// The five conditions of Part XIV §100.2, each as an executable test:
//
//   1. DETERMINISTIC — the same findings always produce the same order.
//   2. EXPLAINABLE FROM A VISIBLE RULE — every position carries the
//      enumerated reason code of the rule that placed it, and a fixed
//      sentence the owner reads.
//   3. PRODUCT-SCOPED — the ordering is in the Scan's own terms and
//      references findings rather than copying them.
//   4. VERSIONED INDEPENDENTLY — a prioritisation version that is a
//      DIFFERENT constant from the rule-set version.
//   5. NO HIDDEN SCORE — no weights, points, normalised units or
//      composite number, displayed or computed.
//
// And the one that the commercial framing makes easiest to break:
// ESTIMATED MONEY IS NOT AN INPUT. Two runs that differ only in the
// sizing operands — hence only in the estimate — must order identically.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  PRIORITY_REASON_WORDING,
  SCAN_PRIORITISATION_RULE_SET_VERSION,
  prioritise,
} from "@/lib/freetools/scanPrioritisation";
import { deriveDependencies } from "@/lib/freetools/scanDependencies";
import { buildScanReport, deriveFindings } from "@/lib/freetools/scanFindings";
import { SCAN_CONDITION_ORDER, SCAN_RULE_SET_VERSION } from "@/lib/freetools/scanTypes";
import { validateScanAnswers } from "@/lib/freetools/scanValidation";

const MODULE = "src/lib/freetools/scanPrioritisation.ts";

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

const UNANSWERED = { q4_unanswered_per_week: { kind: "count", value: 4 } };
const FOLLOWUP = { q6_followup: "nothing_planned" };
const FRICTION = { q7_messages_to_book: "more_than_three" };
const ALL_THREE = { ...UNANSWERED, ...FOLLOWUP, ...FRICTION };

/** Code with comment lines removed, so prose is never mistaken for code. */
const codeOf = (file) =>
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

// ── 1. The ordering itself ─────────────────────────────────────────

describe("the ordering is by position on the enquiry path", () => {
  test("no findings, empty ordering", () => {
    assert.deepEqual(report().prioritisation, []);
  });

  test("one finding is `only_finding`", () => {
    const priorities = report(FOLLOWUP).prioritisation;
    assert.equal(priorities.length, 1);
    assert.equal(priorities[0].position, 1);
    assert.equal(priorities[0].condition, "enquiry.no_followup");
    assert.equal(priorities[0].reason_code, "only_finding");
  });

  test("all three order by stage, which is NOT the enumeration order", () => {
    const priorities = report(ALL_THREE).prioritisation;
    assert.deepEqual(
      priorities.map((p) => p.condition),
      ["enquiry.unanswered", "booking.friction", "enquiry.no_followup"]
    );
    // The distinction that makes the ordering worth having.
    assert.notDeepEqual(
      priorities.map((p) => p.condition),
      [...SCAN_CONDITION_ORDER]
    );
  });

  test("friction comes before follow-up, because follow-up is the recovery stage", () => {
    const priorities = report({ ...FOLLOWUP, ...FRICTION }).prioritisation;
    assert.deepEqual(
      priorities.map((p) => p.condition),
      ["booking.friction", "enquiry.no_followup"]
    );
  });

  test("positions are 1-based, contiguous and unique", () => {
    for (const patch of [FOLLOWUP, FRICTION, { ...UNANSWERED, ...FRICTION }, ALL_THREE]) {
      const priorities = report(patch).prioritisation;
      assert.deepEqual(
        priorities.map((p) => p.position),
        priorities.map((_, i) => i + 1)
      );
      assert.equal(new Set(priorities.map((p) => p.condition)).size, priorities.length);
    }
  });

  test("every priority names the stage it sits at", () => {
    const bySt = Object.fromEntries(
      report(ALL_THREE).prioritisation.map((p) => [p.condition, p.stage_id])
    );
    assert.deepEqual(bySt, {
      "enquiry.unanswered": "enquiry_answered",
      "booking.friction": "time_agreed",
      "enquiry.no_followup": "enquiry_followed_up",
    });
  });

  test("it ranks the genuine findings and nothing else", () => {
    for (const patch of [{}, FOLLOWUP, FRICTION, ALL_THREE]) {
      const r = report(patch);
      assert.equal(r.prioritisation.length, r.findings.length);
      for (const p of r.prioritisation) {
        assert.ok(r.findings.some((f) => f.finding.condition === p.condition));
      }
    }
  });

  test("the input order does not change the output order", () => {
    const findings = deriveFindings(answers(ALL_THREE));
    const forward = prioritise(findings, deriveDependencies(findings.map((f) => f.condition)));
    const reversed = prioritise([...findings].reverse(), deriveDependencies(findings.map((f) => f.condition)));
    assert.deepEqual(forward, reversed);
  });
});

// ── 2. Every position is explained by a visible rule ───────────────

describe("every position carries the rule that placed it", () => {
  test("the reason wording is fixed data, pinned verbatim", () => {
    assert.equal(
      PRIORITY_REASON_WORDING.only_finding,
      "This is the only thing we found, so there is nothing to order it against."
    );
    assert.equal(
      PRIORITY_REASON_WORDING.earlier_in_the_enquiry_path,
      "This sits earlier on the path an enquiry takes through your business, so a change here can be seen without the things after it moving at the same time. It is about the order to work in, not about one thing causing another."
    );
  });

  test("each position's wording is the wording of its own reason code", () => {
    for (const p of report(ALL_THREE).prioritisation) {
      assert.equal(p.reason_wording, PRIORITY_REASON_WORDING[p.reason_code]);
    }
  });

  test("no reason wording ASSERTS causation", () => {
    for (const wording of Object.values(PRIORITY_REASON_WORDING)) {
      assert.doesNotMatch(
        wording,
        /\bcauses\b|\bcaused\b|\bbecause of\b|\bleads to\b|\bresults in\b|\bdue to\b/i,
        `a reason asserts a cause: ${wording}`
      );
    }
  });

  test("the binding reason DENIES causation in as many words", () => {
    // The one place the Scan comes closest to another product's
    // territory, so the denial is part of the sentence rather than a
    // footnote beside it (§100.3).
    assert.match(
      PRIORITY_REASON_WORDING.earlier_in_the_enquiry_path,
      /not about one thing causing another/
    );
  });

  test("only two reason codes ever fire, across the whole answer space", () => {
    const seen = new Set();
    const q4s = [undefined, { kind: "not_sure" }, { kind: "count", value: 0 }, { kind: "count", value: 2 }, { kind: "count", value: 50 }];
    const q5s = ["yes_always", "sometimes", "no"];
    const q6s = ["within_a_day", "eventually", "only_if_they_return", "nothing_planned", "not_sure"];
    const q7s = ["one", "two_or_three", "more_than_three", "varies_a_lot", "not_sure"];
    const q8s = [undefined, { kind: "not_sure" }, { kind: "amount", amount: 250, currency: "EUR" }];
    const q9s = [undefined, "most", "about_half", "a_minority", "not_sure"];
    let runs = 0;

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
                for (const p of r.prioritisation) seen.add(p.reason_code);
                runs += 1;
              }

    assert.ok(runs > 1000, `the sweep only ran ${runs} cases`);
    assert.deepEqual(
      [...seen].sort(),
      ["earlier_in_the_enquiry_path", "only_finding"],
      "a rule fired that Phase 1 should not reach"
    );
  });
});

// ── 3. No score, and no money in the ladder ────────────────────────

describe("there is no score, and estimated money is not an input", () => {
  test("runs differing only in the estimate order identically", () => {
    const sized = report({ ...ALL_THREE, q8_typical_job_value: { kind: "amount", amount: 900, currency: "EUR" }, q9_conversion_share: "most" });
    const unsized = report(ALL_THREE);

    // One is sized and the other is not — the premise of the test.
    assert.equal(sized.findings[0].impact.kind, "estimate");
    assert.equal(unsized.findings[0].impact.kind, "unknown");

    assert.deepEqual(sized.prioritisation, unsized.prioritisation);
  });

  test("a bigger estimate does not promote its finding", () => {
    const small = report({ ...ALL_THREE, q8_typical_job_value: { kind: "amount", amount: 80, currency: "EUR" }, q9_conversion_share: "most" });
    const large = report({ ...ALL_THREE, q8_typical_job_value: { kind: "amount", amount: 900, currency: "EUR" }, q9_conversion_share: "most" });
    assert.deepEqual(
      small.prioritisation.map((p) => p.condition),
      large.prioritisation.map((p) => p.condition)
    );
  });

  test("a priority carries no number but its own position", () => {
    for (const p of report(ALL_THREE).prioritisation) {
      const numeric = Object.entries(p).filter(([, v]) => typeof v === "number");
      assert.deepEqual(numeric.map(([k]) => k), ["position"]);
    }
  });

  test("the module names no score, weight or point anywhere in its code", () => {
    assert.doesNotMatch(
      codeOf(MODULE),
      /\bscore\b|\bscores\b|\bscoring\b|\bweight|\bpoints\b|normalised_value|composite/i,
      "the ordering module names a scoring concept"
    );
  });

  test("the module cannot reach an impact, an estimate or a basis", () => {
    assert.doesNotMatch(
      codeOf(MODULE),
      /ScanImpact|EstimateBasis|EstimateResult|impact|estimate|basis|currency/i,
      "the ordering module can see money"
    );
  });

  test("prioritise takes findings and dependencies, and nothing else", () => {
    // Read from the signature rather than from arity: the second
    // parameter is defaulted, which Function.length does not count.
    const signature = codeOf(MODULE).match(
      /export function prioritise\(([\s\S]*?)\): ScanPriority\[\]/
    );
    assert.ok(signature, "prioritise is not declared where expected");
    const parameters = signature[1]
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    assert.equal(parameters.length, 2, signature[1]);
    assert.match(parameters[0], /^findings: readonly ScanFinding\[\]$/);
    assert.match(parameters[1], /^dependencies: readonly ScanDependency\[\]/);
  });
});

// ── 4. Versioned independently ─────────────────────────────────────

describe("the ordering is versioned separately from the rules it orders", () => {
  test("the two versions are different constants", () => {
    const src = readFileSync("src/lib/freetools/scanTypes.ts", "utf8");
    assert.match(src, /export const SCAN_PRIORITISATION_RULE_SET_VERSION\s*=/);
    assert.match(src, /export const SCAN_RULE_SET_VERSION\s*=/);
    assert.equal(typeof SCAN_PRIORITISATION_RULE_SET_VERSION, "string");
    assert.ok(SCAN_PRIORITISATION_RULE_SET_VERSION.length > 0);

    // Two fields on the report, each fed by its own constant, so a
    // change to one is visible without the other moving.
    const r = report(ALL_THREE);
    assert.equal(r.rule_set_version, SCAN_RULE_SET_VERSION);
    assert.equal(r.prioritisation_rule_set_version, SCAN_PRIORITISATION_RULE_SET_VERSION);
    assert.ok(
      Object.prototype.hasOwnProperty.call(r, "prioritisation_rule_set_version") &&
        Object.prototype.hasOwnProperty.call(r, "rule_set_version")
    );
  });

  test("PR D did not move the rule-set version", () => {
    assert.equal(SCAN_RULE_SET_VERSION, "v1");
  });

  test("every report carries it, the empty one included", () => {
    for (const patch of [{}, FOLLOWUP, ALL_THREE]) {
      assert.equal(
        report(patch).prioritisation_rule_set_version,
        SCAN_PRIORITISATION_RULE_SET_VERSION
      );
    }
  });
});

// ── 5. Determinism ─────────────────────────────────────────────────

describe("the ordering is deterministic", () => {
  test("the same answers produce a deeply equal ordering", () => {
    assert.deepEqual(report(ALL_THREE).prioritisation, report(ALL_THREE).prioritisation);
  });

  test("every priority is derived_deterministic", () => {
    for (const p of report(ALL_THREE).prioritisation) {
      assert.equal(p.source_type, "derived_deterministic");
    }
  });
});
