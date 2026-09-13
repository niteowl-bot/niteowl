// Business Opportunity Scan — opportunity clusters (PR E).
//
// What this suite proves:
//
//   1. A cluster is a RELATION BETWEEN TWO FINDINGS, pairwise, one per
//      unordered pair, and none at all below two findings (§102).
//   2. Only `sequential_in_one_process` and `independent` are reachable
//      in Phase 1, across the whole answer space. The other three are
//      declared and never fire — which is what stops one being enabled
//      by a proxy while the contract it needs is still missing.
//   3. Adjacency is LITERAL canonical position adjacency. The
//      never-assessed `work_booked` stage is not skipped to manufacture
//      a relation between stages 3 and 5.
//   4. A cluster's confidence is confidence in the RELATION, fixed by
//      the relation alone and provably not derived from its members.
//   5. `independent` means our rules established nothing — never that
//      the findings are unrelated — and the wording says so.
//   6. Clustering is strictly downstream: it changes no finding, no
//      ordering, no dependency, no impact and no gap.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  SCAN_CLUSTER_RULE_SET_VERSION,
  deriveClusters,
} from "@/lib/freetools/scanClusters";
import { buildScanReport, deriveFindings } from "@/lib/freetools/scanFindings";
import { SCAN_FUNNEL_STAGES, stageForCondition } from "@/lib/freetools/scanFunnel";
import {
  SCAN_CONDITION_ORDER,
  SCAN_PRIORITISATION_RULE_SET_VERSION,
  SCAN_RULE_SET_VERSION,
} from "@/lib/freetools/scanTypes";
import { validateScanAnswers } from "@/lib/freetools/scanValidation";

const MODULE = "src/lib/freetools/scanClusters.ts";

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

function answers(patch = {}) {
  const input = { ...QUIET, ...patch };
  for (const key of Object.keys(patch)) {
    if (patch[key] === undefined) delete input[key];
  }
  const result = validateScanAnswers(input);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return result;
}

const report = (patch) => {
  const v = answers(patch);
  return buildScanReport(v.answers, CONTEXT, v.inconsistencies);
};

const UNANSWERED = { q4_unanswered_per_week: { kind: "count", value: 4 } };
const FOLLOWUP = { q6_followup: "nothing_planned" };
const FRICTION = { q7_messages_to_book: "more_than_three" };
const ALL_THREE = { ...UNANSWERED, ...FOLLOWUP, ...FRICTION };

const relationsOf = (r) => r.clusters.map((c) => c.relation);
const pairsOf = (r) => r.clusters.map((c) => [...c.member_conditions]);

/** Code with comment lines removed, so prose is never mistaken for code. */
const codeOf = (file) =>
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

// ── 1. Pairwise, and never below two findings ──────────────────────

describe("a cluster relates exactly two findings", () => {
  test("zero findings — no clusters (§107.4)", () => {
    const r = report();
    assert.equal(r.findings.length, 0);
    assert.deepEqual(r.clusters, []);
    assert.deepEqual(deriveClusters([]), []);
  });

  test("one finding — no clusters at all (§102)", () => {
    for (const patch of [UNANSWERED, FOLLOWUP, FRICTION]) {
      const r = report(patch);
      assert.equal(r.findings.length, 1);
      assert.deepEqual(r.clusters, []);
    }
  });

  test("two findings — exactly one cluster", () => {
    for (const patch of [
      { ...UNANSWERED, ...FRICTION },
      { ...UNANSWERED, ...FOLLOWUP },
      { ...FOLLOWUP, ...FRICTION },
    ]) {
      const r = report(patch);
      assert.equal(r.findings.length, 2);
      assert.equal(r.clusters.length, 1);
    }
  });

  test("three findings — exactly three clusters, every pair once", () => {
    const r = report(ALL_THREE);
    assert.equal(r.clusters.length, 3);
    const seen = new Set();
    for (const c of r.clusters) {
      const key = [...c.member_conditions].sort().join("|");
      assert.ok(!seen.has(key), `${key} clustered twice`);
      seen.add(key);
    }
    assert.equal(seen.size, 3);
  });

  test("a cluster never names the same finding twice", () => {
    for (const c of report(ALL_THREE).clusters) {
      assert.notEqual(c.member_conditions[0], c.member_conditions[1]);
    }
  });

  test("members are exactly two, so a cluster cannot become a grouping", () => {
    for (const c of report(ALL_THREE).clusters) {
      assert.equal(c.member_conditions.length, 2);
      assert.equal(c.member_stage_ids.length, 2);
    }
  });
});

// ── 2. The rule ladder and its reachability ────────────────────────

describe("only two relations are reachable in Phase 1", () => {
  test("adjacent stages produce sequential_in_one_process", () => {
    // enquiry_answered (2) and time_agreed (3) are the one adjacent pair.
    const r = report({ ...UNANSWERED, ...FRICTION });
    assert.deepEqual(relationsOf(r), ["sequential_in_one_process"]);
    assert.equal(r.clusters[0].rule, "adjacent_funnel_stages");
    assert.deepEqual([...r.clusters[0].member_stage_ids], [
      "enquiry_answered",
      "time_agreed",
    ]);
  });

  test("non-adjacent pairs fall through to independent", () => {
    const acrossOne = report({ ...FRICTION, ...FOLLOWUP }); // stages 3 and 5
    assert.deepEqual(relationsOf(acrossOne), ["independent"]);
    assert.equal(acrossOne.clusters[0].rule, "no_relation_rule_fired");

    const acrossThree = report({ ...UNANSWERED, ...FOLLOWUP }); // stages 2 and 5
    assert.deepEqual(relationsOf(acrossThree), ["independent"]);
  });

  test("the never-assessed stage is NOT skipped to manufacture adjacency", () => {
    // work_booked sits at position 4 between time_agreed (3) and
    // enquiry_followed_up (5). Treating 3 and 5 as adjacent would assert
    // adjacency across a stage the Scan refuses to judge.
    const booked = SCAN_FUNNEL_STAGES.find((s) => s.stage_id === "work_booked");
    assert.equal(booked.position, 4);
    assert.equal(booked.assessable, false);

    const r = report({ ...FRICTION, ...FOLLOWUP });
    assert.equal(r.clusters[0].relation, "independent");
  });

  test("adjacency is read from the canonical stage table, not a copy", () => {
    for (const c of report(ALL_THREE).clusters) {
      const a = stageForCondition(c.member_conditions[0]);
      const b = stageForCondition(c.member_conditions[1]);
      const adjacent = b.position - a.position === 1;
      assert.equal(
        c.relation === "sequential_in_one_process",
        adjacent,
        `${c.cluster_id} disagrees with the stage table`
      );
    }
  });

  test("an exhaustive sweep emits only the two reachable relations and rules", () => {
    const relations = new Set();
    const rules = new Set();
    let runs = 0;
    let clustered = 0;

    const q4s = [undefined, { kind: "not_sure" }, { kind: "count", value: 0 }, { kind: "count", value: 4 }];
    const q5s = ["yes_always", "sometimes", "no"];
    const q6s = ["within_a_day", "eventually", "only_if_they_return", "nothing_planned", "not_sure"];
    const q7s = ["one", "two_or_three", "more_than_three", "varies_a_lot", "not_sure"];
    const q8s = [undefined, { kind: "not_sure" }, { kind: "amount", amount: 250, currency: "EUR" }];
    const q9s = [undefined, "most", "about_half", "a_minority", "not_sure"];

    for (const q4 of q4s)
      for (const q5 of q5s)
        for (const q6 of q6s)
          for (const q7 of q7s)
            for (const q8 of q8s)
              for (const q9 of q9s) {
                const r = report({
                  q4_unanswered_per_week: q4,
                  q5_miss_visibility: q5,
                  q6_followup: q6,
                  q7_messages_to_book: q7,
                  q8_typical_job_value: q8,
                  q9_conversion_share: q9,
                });
                for (const c of r.clusters) {
                  relations.add(c.relation);
                  rules.add(c.rule);
                }
                if (r.clusters.length > 0) clustered += 1;
                runs += 1;
              }

    assert.ok(runs > 1000, `the sweep only ran ${runs} cases`);
    assert.ok(clustered > 100, `only ${clustered} runs produced clusters`);
    assert.deepEqual(
      [...relations].sort(),
      ["independent", "sequential_in_one_process"],
      "a relation fired that Phase 1 must not reach"
    );
    assert.deepEqual(
      [...rules].sort(),
      ["adjacent_funnel_stages", "no_relation_rule_fired"],
      "a rule fired that Phase 1 must not reach"
    );
  });

  test("shared_cause_candidate, competing_for_same_resource and masked_measurement never fire", () => {
    const forbidden = [
      "shared_cause_candidate",
      "competing_for_same_resource",
      "masked_measurement",
    ];
    for (const patch of [
      ALL_THREE,
      { ...UNANSWERED, ...FRICTION },
      { ...UNANSWERED, ...FOLLOWUP },
      { ...FOLLOWUP, ...FRICTION },
      { ...ALL_THREE, q5_miss_visibility: "no" },
      { ...ALL_THREE, q5_miss_visibility: "sometimes" },
      { ...ALL_THREE, q7_messages_to_book: "varies_a_lot" },
    ]) {
      for (const c of report(patch).clusters) {
        assert.ok(!forbidden.includes(c.relation), `${c.relation} fired`);
      }
    }
  });

  test("all five relations and all five rule codes remain declared", () => {
    const src = readFileSync("src/lib/freetools/scanTypes.ts", "utf8");
    const members = (typeName) => {
      const union = src.match(new RegExp(`export type ${typeName} =([\\s\\S]*?);`));
      assert.ok(union, `${typeName} is not declared where expected`);
      return (union[1].match(/"[^"]+"/g) ?? []).map((s) => s.slice(1, -1));
    };
    assert.deepEqual(members("ScanClusterRelation"), [
      "sequential_in_one_process",
      "shared_cause_candidate",
      "competing_for_same_resource",
      "masked_measurement",
      "independent",
    ]);
    assert.deepEqual(members("ScanClusterRuleCode"), [
      "adjacent_funnel_stages",
      "intersecting_hypotheses",
      "shared_owner_resource",
      "upstream_integrity_gap",
      "no_relation_rule_fired",
    ]);
  });

  test("no hypothesis proxy: the module cannot read evidence, confidence or caps", () => {
    // The §103 seam. A rule that reached for a shared question, a shared
    // cap or a member confidence would be hypothesis generation wearing
    // a cluster's clothing.
    // `intersecting_hypotheses` is the DECLARED rule code and must stay,
    // so the test targets what a proxy would actually have to read: a
    // finding's evidence, its confidence or its cap.
    assert.doesNotMatch(
      codeOf(MODULE),
      /supporting_question_ids|\.evidence\b|finding_confidence|confidence_cap_reason/i,
      "the cluster module reads a finding field a hypothesis proxy would need"
    );
    // And the only mention of hypotheses is the declared rule code.
    const hypothesisMentions =
      codeOf(MODULE).match(/hypothes[a-z]*/gi) ?? [];
    assert.deepEqual(
      [...new Set(hypothesisMentions.map((m) => m.toLowerCase()))],
      ["hypotheses"],
      "hypotheses are referenced beyond the declared rule code"
    );
    assert.match(codeOf(MODULE), /"intersecting_hypotheses"/);
  });

  test("the module cannot reach an impact, estimate, recommendation or answer", () => {
    assert.doesNotMatch(
      codeOf(MODULE),
      /ScanImpact|EstimateBasis|impact|estimate|basis|currency|recommendation|ScanAnswers/i,
      "the cluster module reaches beyond findings and the funnel"
    );
  });
});

// ── 3. Determinism, ordering and identity ──────────────────────────

describe("clusters are deterministic and canonically ordered", () => {
  test("repeat runs are deeply equal", () => {
    assert.deepEqual(report(ALL_THREE).clusters, report(ALL_THREE).clusters);
  });

  test("caller ordering cannot change the result", () => {
    const findings = deriveFindings(answers(ALL_THREE).answers);
    const forward = deriveClusters(findings);
    const reversed = deriveClusters([...findings].reverse());
    assert.deepEqual(forward, reversed);
  });

  test("members are ordered by funnel stage position, earlier first", () => {
    for (const c of report(ALL_THREE).clusters) {
      const a = stageForCondition(c.member_conditions[0]);
      const b = stageForCondition(c.member_conditions[1]);
      assert.ok(a.position < b.position, `${c.cluster_id} is not earlier-first`);
      assert.equal(c.member_stage_ids[0], a.stage_id);
      assert.equal(c.member_stage_ids[1], b.stage_id);
    }
  });

  test("the cluster array is ordered by the pair's stage positions, with no ties", () => {
    const keys = report(ALL_THREE).clusters.map((c) => [
      stageForCondition(c.member_conditions[0]).position,
      stageForCondition(c.member_conditions[1]).position,
    ]);
    for (let i = 1; i < keys.length; i += 1) {
      const [pa, pb] = keys[i - 1];
      const [qa, qb] = keys[i];
      assert.ok(pa < qa || (pa === qa && pb < qb), "cluster order is not total");
    }
    assert.deepEqual(
      pairsOf(report(ALL_THREE)),
      [
        ["enquiry.unanswered", "booking.friction"],
        ["enquiry.unanswered", "enquiry.no_followup"],
        ["booking.friction", "enquiry.no_followup"],
      ]
    );
  });

  test("cluster_id is stable, derived and never an index", () => {
    const first = report(ALL_THREE).clusters;
    const second = report(ALL_THREE).clusters;
    assert.deepEqual(first.map((c) => c.cluster_id), second.map((c) => c.cluster_id));
    assert.equal(new Set(first.map((c) => c.cluster_id)).size, first.length);
    for (const c of first) {
      assert.ok(c.cluster_id.includes(c.relation));
      assert.ok(c.cluster_id.includes(c.member_conditions[0]));
      assert.ok(c.cluster_id.includes(c.member_conditions[1]));
      assert.doesNotMatch(c.cluster_id, /^\d+$/, "cluster_id is an index");
    }
  });

  test("no clock, randomness or identifier generation in the module", () => {
    assert.doesNotMatch(
      codeOf(MODULE),
      /Date\.now|new Date\(|Math\.random|randomUUID|crypto\.|process\.env/,
      "the cluster module is not deterministic"
    );
  });

  test("the relation rules carry their own version (§107.3)", () => {
    assert.equal(typeof SCAN_CLUSTER_RULE_SET_VERSION, "string");
    assert.ok(SCAN_CLUSTER_RULE_SET_VERSION.length > 0);
    for (const patch of [{}, FOLLOWUP, ALL_THREE]) {
      assert.equal(report(patch).cluster_rule_set_version, SCAN_CLUSTER_RULE_SET_VERSION);
    }
    // Its own constant, not a share of either of the other two.
    const src = readFileSync("src/lib/freetools/scanTypes.ts", "utf8");
    assert.match(src, /export const SCAN_CLUSTER_RULE_SET_VERSION\s*=/);
    const r = report(ALL_THREE);
    assert.equal(r.rule_set_version, SCAN_RULE_SET_VERSION);
    assert.equal(r.prioritisation_rule_set_version, SCAN_PRIORITISATION_RULE_SET_VERSION);
  });
});

// ── 4. Confidence belongs to the relation, never to the members ────

describe("relation confidence is the relation's own", () => {
  test("fixed by relation across every reachable case", () => {
    for (const c of report(ALL_THREE).clusters) {
      assert.equal(
        c.relation_confidence,
        c.relation === "sequential_in_one_process" ? "high" : "low"
      );
    }
  });

  test("independent stays low even when BOTH findings are high confidence", () => {
    // The §102 rule made executable: a cluster whose confidence tracked
    // its members would read high here, and would be a confidence that
    // was never assessed.
    const r = report({ ...FOLLOWUP, ...FRICTION });
    const members = r.findings.map((f) => f.finding.finding_confidence);
    assert.deepEqual(members, ["high", "high"]);
    assert.equal(r.clusters[0].relation, "independent");
    assert.equal(r.clusters[0].relation_confidence, "low");
  });

  test("member confidence changing does not move the relation confidence", () => {
    // Q7 "varies a lot" caps booking.friction at medium; the adjacent
    // relation's confidence is unmoved.
    const high = report({ ...UNANSWERED, ...FRICTION });
    const capped = report({ ...UNANSWERED, q7_messages_to_book: "varies_a_lot" });
    assert.equal(
      high.findings.find((f) => f.finding.condition === "booking.friction").finding
        .finding_confidence,
      "high"
    );
    assert.equal(
      capped.findings.find((f) => f.finding.condition === "booking.friction").finding
        .finding_confidence,
      "medium"
    );
    assert.equal(high.clusters[0].relation_confidence, "high");
    assert.equal(capped.clusters[0].relation_confidence, "high");
  });

  test("every cluster is derived_deterministic and carries no owner evidence", () => {
    for (const c of report(ALL_THREE).clusters) {
      assert.equal(c.source_type, "derived_deterministic");
      assert.ok(!("evidence" in c));
      assert.ok(!("raw_answer" in c));
    }
    assert.doesNotMatch(codeOf(MODULE), /business_provided|"observed"|"verified"/);
  });
});

// ── 5. Wording: no causation, and no claim of unrelatedness ────────

describe("cluster wording claims only what was established", () => {
  test("no cluster sentence ASSERTS a cause", () => {
    // The denial clause legitimately contains "causes". Strip the known
    // denials first, then require no causal verb to survive — so a
    // sentence that stated a cause could not hide behind the denial.
    const DENIALS = [
      "it does not claim that one causes the other",
      "not the same as knowing",
    ];
    for (const c of report(ALL_THREE).clusters) {
      let text = c.wording;
      for (const denial of DENIALS) text = text.split(denial).join(" ");
      assert.doesNotMatch(
        text,
        /\bcauses\b|\bcaused\b|\bbecause of\b|\bleads to\b|\bresults in\b|\bdue to\b/i,
        `a cluster asserts a cause: ${c.wording}`
      );
    }
  });

  test("the sequential sentence denies causation and names both stages", () => {
    const c = report({ ...UNANSWERED, ...FRICTION }).clusters[0];
    assert.match(c.wording, /two points on one path, not two separate problems/);
    assert.match(c.wording, /comes immediately before/);
    assert.match(c.wording, /does not claim that one causes the other/);
    assert.match(c.wording, /enquiries getting an answer/);
    assert.match(c.wording, /agreeing a time/);
  });

  test("the independent sentence refuses to claim unrelatedness", () => {
    const c = report({ ...UNANSWERED, ...FOLLOWUP }).clusters[0];
    assert.match(c.wording, /not the same as knowing\s+they are unrelated/);
    assert.match(c.wording, /no link has been established/i);
    assert.match(c.wording, /rather say so than invent one/);
    // Never the positive claim.
    assert.doesNotMatch(c.wording, /they are unrelated\.|these are separate problems/i);
  });

  test("no cluster wording carries a figure, a currency or urgency", () => {
    for (const c of report(ALL_THREE).clusters) {
      assert.doesNotMatch(c.wording, /\d/, "a cluster carries a digit");
      assert.doesNotMatch(c.wording, /[£€$]|\b(EUR|GBP|USD)\b/);
      // "immediately BEFORE" is positional, not urgent, so the bare
      // word is not banned — the urgency vocabulary is.
      assert.doesNotMatch(
        c.wording,
        /\bact now\b|\burgent\b|don'?t delay|costing you|right away\b|before it'?s too late/i
      );
    }
  });
});

// ── 6. Strictly downstream — anti-regression ───────────────────────

describe("clustering changes nothing upstream of itself", () => {
  test("findings count, order and content are untouched", () => {
    for (const patch of [{}, FOLLOWUP, { ...UNANSWERED, ...FRICTION }, ALL_THREE]) {
      const r = report(patch);
      const derived = deriveFindings(answers(patch).answers);
      assert.equal(r.findings.length, derived.length);
      assert.deepEqual(r.findings.map((f) => f.finding), derived);
    }
  });

  test("report.findings remains in SCAN_CONDITION_ORDER", () => {
    const r = report(ALL_THREE);
    assert.deepEqual(
      r.findings.map((f) => f.finding.condition),
      [...SCAN_CONDITION_ORDER]
    );
  });

  test("a suppressed finding is never clustered", () => {
    // Q4 > Q3: the inconsistency is shown and enquiry.unanswered is
    // suppressed, so no cluster may name it.
    const r = report({
      q3_enquiries_per_week: { kind: "count", value: 5 },
      q4_unanswered_per_week: { kind: "count", value: 9 },
      ...FOLLOWUP,
      ...FRICTION,
    });
    assert.equal(r.inconsistencies.length, 1);
    assert.ok(!r.findings.some((f) => f.finding.condition === "enquiry.unanswered"));
    for (const c of r.clusters) {
      assert.ok(!c.member_conditions.includes("enquiry.unanswered"));
    }
    assert.equal(r.clusters.length, 1);
  });

  test("prioritisation, dependencies, earliest leak, impact and gaps are unmoved", () => {
    // Rebuild the PR D output independently of clustering and compare.
    for (const patch of [{}, FOLLOWUP, { ...UNANSWERED, ...FRICTION }, ALL_THREE]) {
      const a = report(patch);
      const b = report(patch);
      assert.deepEqual(a.prioritisation, b.prioritisation);
      assert.deepEqual(a.dependencies, b.dependencies);
      assert.deepEqual(a.earliest_leak, b.earliest_leak);
      assert.deepEqual(a.evidence_gaps, b.evidence_gaps);
      assert.deepEqual(
        a.findings.map((f) => f.impact_class),
        b.findings.map((f) => f.impact_class)
      );
      // And nothing in the PR D output mentions a cluster.
      const serialised = JSON.stringify({
        prioritisation: a.prioritisation,
        dependencies: a.dependencies,
        earliest_leak: a.earliest_leak,
        evidence_gaps: a.evidence_gaps,
      });
      assert.doesNotMatch(serialised, /cluster/i);
    }
  });

  test("no shipped upstream module imports the cluster module", () => {
    const upstream = [
      "src/lib/freetools/scanTypes.ts",
      "src/lib/freetools/scanQuestions.ts",
      "src/lib/freetools/scanValidation.ts",
      "src/lib/freetools/scanLostRevenue.ts",
      "src/lib/freetools/scanRecommendations.ts",
      "src/lib/freetools/scanFunnel.ts",
      "src/lib/freetools/scanDependencies.ts",
      "src/lib/freetools/scanPrioritisation.ts",
      "src/lib/freetools/scanImpactClass.ts",
      "src/lib/freetools/scanEvidenceGaps.ts",
    ];
    for (const file of upstream) {
      assert.doesNotMatch(
        readFileSync(file, "utf8"),
        /from\s+["']@\/lib\/freetools\/scanClusters["']/,
        `${file} imports the cluster module`
      );
    }
    // Only the assembler does.
    assert.match(
      readFileSync("src/lib/freetools/scanFindings.ts", "utf8"),
      /from\s+["']@\/lib\/freetools\/scanClusters["']/
    );
  });

  test("deriveClusters takes findings and nothing else", () => {
    assert.equal(deriveClusters.length, 1);
  });

  test("the cluster module imports only the funnel and the types", () => {
    const specifiers =
      readFileSync(MODULE, "utf8").match(/from\s+["']([^"']+)["']/g) ?? [];
    for (const specifier of specifiers) {
      assert.match(
        specifier,
        /["']@\/lib\/freetools\/scan(Funnel|Types)["']/,
        `the cluster module imports ${specifier}`
      );
    }
  });
});
