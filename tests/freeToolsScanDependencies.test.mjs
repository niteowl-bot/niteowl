// Business Opportunity Scan — dependencies (PR D).
//
// What this suite proves:
//
//   1. One entry per PAIR of findings, in the (earlier, later)
//      direction, and none at all for zero or one finding.
//   2. Every dependency NAMES THE CANONICAL RULE that produced it
//      (§104) — a dependency without one is prose.
//   3. The wording states sequencing and measurement order, and NEVER
//      asserts a cause (§100.3). The denial is in the sentence.
//   4. `blocked_by`, `independent` and `should_follow` are never
//      emitted in Phase 1, and neither are the three dependency rules
//      that have nothing to fire on. Pinned by sweep, so a fourth
//      condition cannot be added silently.
//   5. A dependency is never invented to justify a sequence: the set is
//      exactly the pairs the findings actually produce.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { deriveDependencies } from "@/lib/freetools/scanDependencies";
import { buildScanReport } from "@/lib/freetools/scanFindings";
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

const UNANSWERED = { q4_unanswered_per_week: { kind: "count", value: 4 } };
const FOLLOWUP = { q6_followup: "nothing_planned" };
const FRICTION = { q7_messages_to_book: "more_than_three" };
const ALL_THREE = { ...UNANSWERED, ...FOLLOWUP, ...FRICTION };

const pairs = (deps) => deps.map((d) => [d.from_condition, d.to_condition]);

// ── 1. One entry per pair ──────────────────────────────────────────

describe("a dependency exists only where two findings do", () => {
  test("zero findings, no dependencies", () => {
    assert.deepEqual(report().dependencies, []);
    assert.deepEqual(deriveDependencies([]), []);
  });

  test("one finding, no dependencies", () => {
    for (const patch of [UNANSWERED, FOLLOWUP, FRICTION]) {
      assert.deepEqual(report(patch).dependencies, []);
    }
  });

  test("two findings, exactly one entry, earlier first", () => {
    const deps = report({ ...FOLLOWUP, ...FRICTION }).dependencies;
    assert.equal(deps.length, 1);
    assert.deepEqual(pairs(deps), [["booking.friction", "enquiry.no_followup"]]);
  });

  test("three findings, exactly three entries, every pair once", () => {
    const deps = report(ALL_THREE).dependencies;
    assert.equal(deps.length, 3);
    assert.deepEqual(pairs(deps), [
      ["enquiry.unanswered", "booking.friction"],
      ["enquiry.unanswered", "enquiry.no_followup"],
      ["booking.friction", "enquiry.no_followup"],
    ]);
  });

  test("the caller's order does not change the output", () => {
    const forward = deriveDependencies([
      "enquiry.unanswered",
      "enquiry.no_followup",
      "booking.friction",
    ]);
    const reversed = deriveDependencies([
      "booking.friction",
      "enquiry.no_followup",
      "enquiry.unanswered",
    ]);
    assert.deepEqual(forward, reversed);
  });

  test("a pair is never recorded twice, in either direction", () => {
    const deps = report(ALL_THREE).dependencies;
    const seen = new Set();
    for (const d of deps) {
      const key = [d.from_condition, d.to_condition].sort().join("|");
      assert.ok(!seen.has(key), `${key} recorded twice`);
      seen.add(key);
    }
  });
});

// ── 2. Every dependency names its rule ─────────────────────────────

describe("every dependency names the canonical rule behind it", () => {
  test("all of them cite stage order", () => {
    for (const d of report(ALL_THREE).dependencies) {
      assert.equal(d.rule, "stage_order");
      assert.equal(d.relation, "should_precede");
      assert.equal(d.source_type, "derived_deterministic");
    }
  });

  test("none carries an empty rule or an empty sentence", () => {
    for (const d of report(ALL_THREE).dependencies) {
      assert.ok(d.rule.length > 0);
      assert.ok(d.wording.length > 0);
    }
  });
});

// ── 3. Sequencing, never causation ─────────────────────────────────

describe("the wording orders actions and never asserts a cause", () => {
  test("no dependency sentence asserts a cause", () => {
    for (const d of report(ALL_THREE).dependencies) {
      assert.doesNotMatch(
        d.wording,
        /\bcauses\b|\bcaused\b|\bbecause of\b|\bleads to\b|\bresults in\b|\bdue to\b|\bmeans that you\b/i,
        `a dependency asserts a cause: ${d.wording}`
      );
    }
  });

  test("every dependency sentence DENIES causation explicitly", () => {
    for (const d of report(ALL_THREE).dependencies) {
      assert.match(d.wording, /not\s+about\s+one\s+causing\s+the\s+other/i);
    }
  });

  test("it is framed as the order things can be measured in", () => {
    for (const d of report(ALL_THREE).dependencies) {
      assert.match(d.wording, /order things can be measured in/i);
    }
  });

  test("the sentence names both stages in the owner's words", () => {
    const deps = report({ ...UNANSWERED, ...FRICTION }).dependencies;
    assert.equal(deps.length, 1);
    assert.match(deps[0].wording, /enquiries getting an answer/);
    assert.match(deps[0].wording, /agreeing a time/);
  });
});

// ── 4. What is never emitted ───────────────────────────────────────

describe("three relations and three rules never fire in Phase 1", () => {
  test("no sweep of the answer space emits blocked_by, independent or should_follow", () => {
    const relations = new Set();
    const rules = new Set();
    let runs = 0;

    const q4s = [undefined, { kind: "not_sure" }, { kind: "count", value: 0 }, { kind: "count", value: 6 }];
    const q5s = ["yes_always", "sometimes", "no"];
    const q6s = ["within_a_day", "eventually", "only_if_they_return", "nothing_planned", "not_sure"];
    const q7s = ["one", "two_or_three", "more_than_three", "varies_a_lot", "not_sure"];
    const q9s = [undefined, "most", "about_half", "a_minority", "not_sure"];

    for (const q4 of q4s)
      for (const q5 of q5s)
        for (const q6 of q6s)
          for (const q7 of q7s)
            for (const q9 of q9s) {
              const input = { ...QUIET, q5_miss_visibility: q5, q6_followup: q6, q7_messages_to_book: q7 };
              if (q4 === undefined) delete input.q4_unanswered_per_week;
              else input.q4_unanswered_per_week = q4;
              if (q9 !== undefined) input.q9_conversion_share = q9;

              const v = validateScanAnswers(input);
              assert.equal(v.valid, true, JSON.stringify(v.errors));
              const r = buildScanReport(v.answers, CONTEXT, v.inconsistencies);
              for (const d of r.dependencies) {
                relations.add(d.relation);
                rules.add(d.rule);
              }
              runs += 1;
            }

    assert.ok(runs > 500, `the sweep only ran ${runs} cases`);
    assert.deepEqual([...relations], ["should_precede"]);
    assert.deepEqual([...rules], ["stage_order"]);
  });

  test("the relations and rules stay in the vocabulary for a later condition", () => {
    const src = readFileSync("src/lib/freetools/scanTypes.ts", "utf8");
    for (const relation of ["blocked_by", "should_precede", "should_follow", "independent"]) {
      assert.ok(src.includes(`"${relation}"`), `${relation} left the vocabulary`);
    }
    for (const rule of ["stage_order", "measurement_integrity", "capacity_headroom", "conversion_before_volume"]) {
      assert.ok(src.includes(`"${rule}"`), `${rule} left the vocabulary`);
    }
  });
});

// ── 5. Determinism ─────────────────────────────────────────────────

describe("dependencies are deterministic", () => {
  test("the same findings produce a deeply equal set", () => {
    assert.deepEqual(report(ALL_THREE).dependencies, report(ALL_THREE).dependencies);
  });
});
