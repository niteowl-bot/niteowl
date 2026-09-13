// Business Opportunity Scan — the enquiry funnel (PR D).
//
// What this suite proves:
//
//   1. Five stages, with stable opaque ids, stable positions and a
//      fixed set of informing questions. Stage references are ids, not
//      array indices (P48).
//   2. Stage STATE tracks what we know — declared, unknown with the
//      right reason, or inconsistent — and never claims an observation.
//      `derived` is never produced, across the whole answer space.
//   3. Stage ASSESSMENT is separate from state: a finding, a qualified
//      "this looks like it is working", an honest "we could not
//      establish this", or — for the two stages no Phase 1 condition
//      can anchor to — no verdict at all.
//   4. Adequacy is refused where the answers do not support it,
//      including the Q4 = 0 with Q5 = "no" case, which is NOT recorded
//      as an inconsistency.
//   5. The earliest leak is the earliest ASSESSABLE stage with a
//      finding, and it carries both what looks adequate before it and
//      what was never established before it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  SCAN_FUNNEL_STAGES,
  STAGE_BY_CONDITION,
  buildEnquiryFunnel,
  findEarliestLeak,
  funnelStageDefinition,
  stageForCondition,
} from "@/lib/freetools/scanFunnel";
import { deriveFindings, buildScanReport } from "@/lib/freetools/scanFindings";
import { SCAN_CONDITION_ORDER } from "@/lib/freetools/scanTypes";
import { validateScanAnswers } from "@/lib/freetools/scanValidation";

const CONTEXT = {
  answered_at: "2026-09-13T10:00:00.000Z",
  computed_at: "2026-09-13T10:00:01.000Z",
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

function validated(patch = {}) {
  const result = validateScanAnswers({ ...QUIET, ...patch });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return result;
}

const answers = (patch = {}) => validated(patch).answers;

function funnelFor(patch = {}) {
  const v = validated(patch);
  const conditions = deriveFindings(v.answers).map((f) => f.condition);
  return buildEnquiryFunnel(v.answers, conditions, v.inconsistencies);
}

const stage = (funnel, id) => funnel.stages.find((s) => s.stage_id === id);

// ── 1. The stage table ─────────────────────────────────────────────

describe("the funnel is five stages of one process", () => {
  test("exactly one process, and it is the enquiry path", () => {
    assert.equal(funnelFor().process_id, "enquiry_to_booked_work");
  });

  test("five stages, in position order, with stable ids", () => {
    const funnel = funnelFor();
    assert.equal(funnel.stages.length, 5);
    assert.deepEqual(
      funnel.stages.map((s) => s.stage_id),
      [
        "enquiry_received",
        "enquiry_answered",
        "time_agreed",
        "work_booked",
        "enquiry_followed_up",
      ]
    );
    assert.deepEqual(funnel.stages.map((s) => s.position), [1, 2, 3, 4, 5]);
  });

  test("positions are strictly increasing and never used as references", () => {
    const funnel = funnelFor();
    for (let i = 1; i < funnel.stages.length; i += 1) {
      assert.ok(funnel.stages[i].position > funnel.stages[i - 1].position);
    }
    // Every reference out of the funnel is an opaque id (P48).
    for (const s of funnel.stages) {
      assert.equal(typeof s.stage_id, "string");
      assert.ok(funnelStageDefinition(s.stage_id));
    }
  });

  test("each stage names the questions that inform it", () => {
    const funnel = funnelFor();
    assert.deepEqual(stage(funnel, "enquiry_received").informed_by, [
      "q1_channels",
      "q2_reachable",
      "q3_enquiries_per_week",
    ]);
    assert.deepEqual(stage(funnel, "enquiry_answered").informed_by, [
      "q3_enquiries_per_week",
      "q4_unanswered_per_week",
      "q5_miss_visibility",
    ]);
    assert.deepEqual(stage(funnel, "time_agreed").informed_by, ["q7_messages_to_book"]);
    assert.deepEqual(stage(funnel, "work_booked").informed_by, ["q9_conversion_share"]);
    assert.deepEqual(stage(funnel, "enquiry_followed_up").informed_by, ["q6_followup"]);
  });

  test("follow-up is a recovery stage and sits after the booking decision", () => {
    const funnel = funnelFor();
    const followUp = stage(funnel, "enquiry_followed_up");
    assert.equal(followUp.kind, "recovery");
    assert.ok(followUp.position > stage(funnel, "work_booked").position);
    for (const id of ["enquiry_received", "enquiry_answered", "time_agreed", "work_booked"]) {
      assert.equal(stage(funnel, id).kind, "forward");
    }
  });

  test("every condition anchors to exactly one stage, and vice versa", () => {
    const anchored = SCAN_FUNNEL_STAGES.filter((s) => s.condition !== null);
    assert.equal(anchored.length, SCAN_CONDITION_ORDER.length);
    const seen = new Set();
    for (const condition of SCAN_CONDITION_ORDER) {
      const definition = stageForCondition(condition);
      assert.equal(definition.condition, condition);
      assert.equal(STAGE_BY_CONDITION[condition], definition.stage_id);
      assert.ok(!seen.has(definition.stage_id), "two conditions on one stage");
      seen.add(definition.stage_id);
    }
  });

  test("the assessable stages are exactly the three that can carry a finding", () => {
    const funnel = funnelFor();
    assert.deepEqual(
      funnel.stages.filter((s) => s.assessable).map((s) => s.stage_id),
      ["enquiry_answered", "time_agreed", "enquiry_followed_up"]
    );
  });
});

// ── 2. Stage state ─────────────────────────────────────────────────

describe("stage state says what we know, and never claims an observation", () => {
  test("answers given — owner_declared, with no unknown reason", () => {
    const funnel = funnelFor();
    const answered = stage(funnel, "enquiry_answered");
    assert.equal(answered.state, "owner_declared");
    assert.equal(answered.unknown_reason, null);
  });

  test("a stated not-sure is owner_not_sure, an absence is not_answered", () => {
    const notSure = funnelFor({ q4_unanswered_per_week: { kind: "not_sure" } });
    assert.equal(stage(notSure, "enquiry_answered").state, "unknown");
    assert.equal(stage(notSure, "enquiry_answered").unknown_reason, "owner_not_sure");

    const absent = validateScanAnswers({ ...QUIET, q4_unanswered_per_week: undefined });
    assert.equal(absent.valid, true);
    const funnel = buildEnquiryFunnel(absent.answers, [], absent.inconsistencies);
    assert.equal(stage(funnel, "enquiry_answered").state, "unknown");
    assert.equal(stage(funnel, "enquiry_answered").unknown_reason, "not_answered");
  });

  test("Q4 > Q3 makes the answering stage inconsistent, and only that stage", () => {
    const funnel = funnelFor({
      q3_enquiries_per_week: { kind: "count", value: 5 },
      q4_unanswered_per_week: { kind: "count", value: 9 },
    });
    assert.equal(stage(funnel, "enquiry_answered").state, "inconsistent");
    for (const id of ["enquiry_received", "time_agreed", "work_booked", "enquiry_followed_up"]) {
      assert.notEqual(stage(funnel, id).state, "inconsistent");
    }
  });

  test("no stage is ever `derived`, and none can be `observed`", () => {
    const seen = new Set();
    const q4s = [undefined, { kind: "not_sure" }, { kind: "count", value: 0 }, { kind: "count", value: 3 }, { kind: "count", value: 99 }];
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
              const conditions = deriveFindings(v.answers).map((f) => f.condition);
              const funnel = buildEnquiryFunnel(v.answers, conditions, v.inconsistencies);
              for (const s of funnel.stages) seen.add(s.state);
            }

    assert.ok(!seen.has("derived"), `derived was emitted: ${[...seen]}`);
    assert.ok(!seen.has("observed"));
    for (const state of seen) {
      assert.ok(["owner_declared", "unknown", "inconsistent"].includes(state), state);
    }
  });
});

// ── 3. Assessment, including what is deliberately not assessed ─────

describe("a stage with no finding is adequate, and adequacy is still a claim", () => {
  test("the two non-assessable stages never receive a verdict", () => {
    for (const patch of [
      {},
      { q9_conversion_share: "a_minority" },
      { q9_conversion_share: "not_sure" },
      { q3_enquiries_per_week: { kind: "not_sure" } },
      { q4_unanswered_per_week: { kind: "count", value: 9 }, q6_followup: "nothing_planned", q7_messages_to_book: "more_than_three" },
    ]) {
      const funnel = funnelFor(patch);
      assert.equal(stage(funnel, "enquiry_received").assessment, "not_assessed");
      assert.equal(stage(funnel, "work_booked").assessment, "not_assessed");
      assert.equal(stage(funnel, "enquiry_received").not_established_reason, null);
      assert.equal(stage(funnel, "work_booked").not_established_reason, null);
    }
  });

  test("a quiet run reports all three assessable stages as adequate", () => {
    const funnel = funnelFor();
    for (const id of ["enquiry_answered", "time_agreed", "enquiry_followed_up"]) {
      assert.equal(stage(funnel, id).assessment, "appears_adequate");
      assert.equal(stage(funnel, id).finding_condition, null);
    }
  });

  test("a finding puts its own stage into `finding`, and references it", () => {
    const funnel = funnelFor({ q6_followup: "nothing_planned" });
    const followUp = stage(funnel, "enquiry_followed_up");
    assert.equal(followUp.assessment, "finding");
    assert.equal(followUp.finding_condition, "enquiry.no_followup");
    assert.equal(stage(funnel, "time_agreed").assessment, "appears_adequate");
  });

  test("an unknown or inconsistent stage is not_established, with the reason", () => {
    const notSure = funnelFor({ q7_messages_to_book: "not_sure" });
    assert.equal(stage(notSure, "time_agreed").assessment, "not_established");
    assert.equal(stage(notSure, "time_agreed").not_established_reason, "owner_not_sure");

    const absent = validateScanAnswers({ ...QUIET, q4_unanswered_per_week: undefined });
    const funnel = buildEnquiryFunnel(absent.answers, [], absent.inconsistencies);
    assert.equal(stage(funnel, "enquiry_answered").not_established_reason, "answer_not_given");

    const clash = funnelFor({
      q3_enquiries_per_week: { kind: "count", value: 5 },
      q4_unanswered_per_week: { kind: "count", value: 9 },
    });
    assert.equal(stage(clash, "enquiry_answered").assessment, "not_established");
    assert.equal(stage(clash, "enquiry_answered").not_established_reason, "answers_inconsistent");
  });

  test("zero misses with no way of knowing is NOT adequate, and NOT an inconsistency", () => {
    const v = validated({ q4_unanswered_per_week: { kind: "count", value: 0 }, q5_miss_visibility: "no" });
    // It is not recorded as a contradiction — the two can both be true.
    assert.deepEqual(v.inconsistencies, []);

    const funnel = buildEnquiryFunnel(v.answers, [], v.inconsistencies);
    const answered = stage(funnel, "enquiry_answered");
    assert.equal(answered.assessment, "not_established");
    assert.equal(answered.not_established_reason, "no_way_of_knowing");
    // The state is still what the owner declared; only adequacy is refused.
    assert.equal(answered.state, "owner_declared");
  });

  test("zero misses WITH a way of knowing is adequate", () => {
    for (const visibility of ["yes_always", "sometimes"]) {
      const funnel = funnelFor({ q5_miss_visibility: visibility });
      assert.equal(stage(funnel, "enquiry_answered").assessment, "appears_adequate");
    }
  });
});

// ── 4. The earliest leak ───────────────────────────────────────────

describe("the earliest leak names a stage, never a cause", () => {
  test("no findings, no leak", () => {
    assert.equal(findEarliestLeak(funnelFor()), null);
    assert.equal(buildScanReport(answers(), CONTEXT).earliest_leak, null);
  });

  test("the earliest ASSESSABLE stage with a finding wins", () => {
    const all = funnelFor({
      q4_unanswered_per_week: { kind: "count", value: 4 },
      q6_followup: "nothing_planned",
      q7_messages_to_book: "more_than_three",
    });
    const leak = findEarliestLeak(all);
    assert.equal(leak.stage_id, "enquiry_answered");
    assert.equal(leak.condition, "enquiry.unanswered");
  });

  test("friction alone reports the booking stage, with the answering stage adequate before it", () => {
    const funnel = funnelFor({ q7_messages_to_book: "more_than_three" });
    const leak = findEarliestLeak(funnel);
    assert.equal(leak.stage_id, "time_agreed");
    assert.deepEqual(leak.earlier_stages_adequate, ["enquiry_answered"]);
    assert.deepEqual(leak.earlier_stages_not_established, []);
  });

  test("follow-up alone reports both earlier stages as adequate", () => {
    const leak = findEarliestLeak(funnelFor({ q6_followup: "nothing_planned" }));
    assert.equal(leak.stage_id, "enquiry_followed_up");
    assert.deepEqual(leak.earlier_stages_adequate, ["enquiry_answered", "time_agreed"]);
    assert.deepEqual(leak.earlier_stages_not_established, []);
  });

  test("an unestablished earlier stage is reported as such, not as adequate", () => {
    const leak = findEarliestLeak(
      funnelFor({ q4_unanswered_per_week: { kind: "not_sure" }, q7_messages_to_book: "more_than_three" })
    );
    assert.equal(leak.stage_id, "time_agreed");
    assert.deepEqual(leak.earlier_stages_adequate, []);
    assert.deepEqual(leak.earlier_stages_not_established, ["enquiry_answered"]);
  });

  test("non-assessable stages never appear in either list", () => {
    const leak = findEarliestLeak(funnelFor({ q6_followup: "nothing_planned" }));
    const all = [...leak.earlier_stages_adequate, ...leak.earlier_stages_not_established];
    assert.ok(!all.includes("enquiry_received"));
    assert.ok(!all.includes("work_booked"));
  });
});

// ── 5. Purity ──────────────────────────────────────────────────────

describe("the funnel is deterministic and decides no finding of its own", () => {
  test("the same answers produce a deeply equal funnel", () => {
    const patch = { q4_unanswered_per_week: { kind: "count", value: 3 }, q7_messages_to_book: "varies_a_lot" };
    assert.deepEqual(funnelFor(patch), funnelFor(patch));
  });

  test("it reports the findings it is given, and derives none", () => {
    // Handed no findings, a run that would raise one reports no finding.
    const v = validated({ q6_followup: "nothing_planned" });
    assert.equal(deriveFindings(v.answers).length, 1);
    const funnel = buildEnquiryFunnel(v.answers, [], v.inconsistencies);
    assert.equal(stage(funnel, "enquiry_followed_up").finding_condition, null);
    assert.notEqual(stage(funnel, "enquiry_followed_up").assessment, "finding");
  });

  test("every stage is derived_deterministic and the process is too", () => {
    const funnel = funnelFor();
    assert.equal(funnel.source_type, "derived_deterministic");
    for (const s of funnel.stages) assert.equal(s.source_type, "derived_deterministic");
  });
});
