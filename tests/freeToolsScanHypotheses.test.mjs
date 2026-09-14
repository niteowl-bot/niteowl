// Business Opportunity Scan — hypotheses (PR F, Part XIV §103).
//
// "What might be behind this?" answered from the owner's own answers
// and nothing else. These tests prove the properties §103 makes
// binding: every hypothesis names the evidence it rests on, the claim
// class is fixed to `hypothesis`, the list is ranked with no winner,
// an empty list is a deliberate stated result, confidence is the
// hypothesis's own, and nothing upstream changes because hypotheses
// exist. Plus the boundary: no clock, randomness, network, storage,
// tenant or model.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  SCAN_HYPOTHESIS_CODES,
  SCAN_HYPOTHESIS_RULE_SET_VERSION,
  deriveHypotheses,
} from "@/lib/freetools/scanHypotheses";
import { buildScanReport, deriveFindings } from "@/lib/freetools/scanFindings";
import { computeLostRevenue } from "@/lib/freetools/scanLostRevenue";
import { recommendFor } from "@/lib/freetools/scanRecommendations";
import { buildEnquiryFunnel, findEarliestLeak } from "@/lib/freetools/scanFunnel";
import { deriveDependencies } from "@/lib/freetools/scanDependencies";
import { prioritise } from "@/lib/freetools/scanPrioritisation";
import { classifyImpact } from "@/lib/freetools/scanImpactClass";
import { deriveEvidenceGaps } from "@/lib/freetools/scanEvidenceGaps";
import { deriveClusters } from "@/lib/freetools/scanClusters";
import {
  SCAN_CLUSTER_RULE_SET_VERSION,
  SCAN_CONDITION_ORDER,
  SCAN_PRIORITISATION_RULE_SET_VERSION,
  SCAN_RULE_SET_VERSION,
} from "@/lib/freetools/scanTypes";
import { validateScanAnswers } from "@/lib/freetools/scanValidation";
import {
  HYPOTHESES_NONE_WORDING,
  HYPOTHESES_SECTION_NOTE,
  HYPOTHESES_SECTION_TITLE,
} from "@/app/free-tools/business-opportunity-scan/scanPresentation";
import { ScanReportDocument } from "@/app/free-tools/business-opportunity-scan/ScanClient";

const MODULE = "src/lib/freetools/scanHypotheses.ts";
const source = () => readFileSync(MODULE, "utf8");

const CONTEXT = {
  answered_at: "2026-09-14T10:00:00.000Z",
  computed_at: "2026-09-14T10:00:01.000Z",
};

/** Answers that raise nothing at all. */
const QUIET = {
  q1_channels: ["phone"],
  q2_reachable: "any_time",
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

function render(r, a) {
  return renderToStaticMarkup(createElement(ScanReportDocument, { report: r, answers: a }));
}

const unescape = (html) => html.replaceAll("&#x27;", "'").replaceAll("&quot;", '"');
const count = (html, re) => (html.match(re) ?? []).length;

const UNANSWERED = { q4_unanswered_per_week: { kind: "count", value: 4 } };
const FOLLOWUP = { q6_followup: "nothing_planned" };
const FRICTION = { q7_messages_to_book: "more_than_three" };

const CAUSAL_CERTAINTY = /\b(because|caused|cause of|root cause|is why)\b/i;

// ── 1. Boundary ────────────────────────────────────────────────────

describe("the hypothesis module is pure and stays inside the scan boundary", () => {
  test("imports only scanTypes", () => {
    const specifiers = source().match(/from\s+["']([^"']+)["']/g) ?? [];
    assert.deepEqual(specifiers, ['from "@/lib/freetools/scanTypes"']);
  });

  test("no clock, randomness, id generation, network, storage, tenant or model", () => {
    const src = source();
    assert.doesNotMatch(src, /Date\.now|new Date\(|performance\.now|toISOString/);
    assert.doesNotMatch(src, /Math\.random|crypto|randomUUID|uuid|nanoid/i);
    assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|document\.|window\./);
    assert.doesNotMatch(src, /org_id|organisation|tenant_id|supabase|openai|anthropic|prompt|completion|model\./i);
  });

  test("it cannot read a finding's confidence or cap: the entry point takes the condition", () => {
    const src = source();
    assert.match(src, /export function deriveHypotheses\(\s*condition: ScanConditionCode,\s*answers: ScanAnswers/);
    assert.doesNotMatch(src, /finding_confidence|confidence_cap_reason|ScanFinding\b/);
  });

  test("only the assembler imports it; no upstream layer takes hypotheses", () => {
    const upstream = [
      "src/lib/freetools/scanLostRevenue.ts",
      "src/lib/freetools/scanRecommendations.ts",
      "src/lib/freetools/scanFunnel.ts",
      "src/lib/freetools/scanDependencies.ts",
      "src/lib/freetools/scanPrioritisation.ts",
      "src/lib/freetools/scanImpactClass.ts",
      "src/lib/freetools/scanEvidenceGaps.ts",
      "src/lib/freetools/scanClusters.ts",
      "src/lib/freetools/scanValidation.ts",
      "src/lib/freetools/scanQuestions.ts",
    ];
    for (const file of upstream) {
      const src = readFileSync(file, "utf8");
      assert.doesNotMatch(src, /scanHypotheses|hypotheses\b.*:|ScanHypothesis\b/, `${file} reaches hypotheses`);
    }
    // deriveFindings itself takes answers only.
    const findings = readFileSync("src/lib/freetools/scanFindings.ts", "utf8");
    assert.match(findings, /export function deriveFindings\(answers: ScanAnswers\)/);
  });

  test("the version is its own constant and the report carries it", () => {
    assert.equal(SCAN_HYPOTHESIS_RULE_SET_VERSION, "v1");
    const r = report();
    assert.equal(r.hypothesis_rule_set_version, SCAN_HYPOTHESIS_RULE_SET_VERSION);
    // Present on the finding-less report too.
    assert.equal(r.findings.length, 0);
    assert.equal(typeof r.hypothesis_rule_set_version, "string");
  });

  test("the code set is closed and every table code is in the declared union", () => {
    const types = readFileSync("src/lib/freetools/scanTypes.ts", "utf8");
    const union = types.match(/export type ScanHypothesisCode =([\s\S]*?);/);
    assert.ok(union);
    const declared = (union[1].match(/"[^"]+"/g) ?? []).map((s) => s.slice(1, -1));
    assert.deepEqual([...new Set(SCAN_HYPOTHESIS_CODES)].sort(), [...declared].sort());
    assert.equal(declared.length, 6);
  });
});

// ── 2. Evidence integrity ──────────────────────────────────────────

describe("every emitted hypothesis rests on the owner's own answer", () => {
  const cases = [
    { name: "unanswered / working hours", patch: { ...UNANSWERED, q2_reachable: "working_hours" } },
    { name: "unanswered / varies", patch: { ...UNANSWERED, q2_reachable: "varies" } },
    { name: "unanswered / three channels", patch: { ...UNANSWERED, q1_channels: ["phone", "email", "social"] } },
    { name: "unanswered / no visibility", patch: { ...UNANSWERED, q5_miss_visibility: "no" } },
    { name: "friction / async channel", patch: { ...FRICTION, q1_channels: ["phone", "text_whatsapp"] } },
    { name: "friction / varies", patch: { ...FRICTION, q2_reachable: "varies" } },
    {
      name: "everything at once",
      patch: {
        ...UNANSWERED,
        ...FOLLOWUP,
        ...FRICTION,
        q1_channels: ["phone", "email", "web_form", "social"],
        q2_reachable: "working_hours",
        q5_miss_visibility: "sometimes",
      },
    },
  ];

  for (const c of cases) {
    test(`${c.name}: ≥1 evidence ref, each deep-equal to the answer given`, () => {
      const v = answers(c.patch);
      const r = buildScanReport(v.answers, CONTEXT, v.inconsistencies);
      let seen = 0;
      for (const entry of r.findings) {
        for (const h of entry.hypotheses) {
          seen += 1;
          assert.ok(h.evidence.length >= 1, `${h.code} has no evidence`);
          for (const ref of h.evidence) {
            assert.equal(ref.source_type, "business_provided");
            assert.deepEqual(ref.raw_answer, v.answers[ref.question_id]);
          }
        }
      }
      assert.ok(seen > 0, "case emitted nothing");
    });
  }

  test("the rule table's own evidence is quoted, not a different question", () => {
    const v = answers({ ...UNANSWERED, q2_reachable: "working_hours" });
    const { hypotheses } = deriveHypotheses("enquiry.unanswered", v.answers);
    const window = hypotheses.find((h) => h.code === "reachability_window_limited");
    assert.ok(window);
    assert.deepEqual(window.evidence, [
      { question_id: "q2_reachable", raw_answer: "working_hours", source_type: "business_provided" },
    ]);
  });
});

// ── 3. Claim class and wording ─────────────────────────────────────

describe("a hypothesis is a hypothesis and speaks like one", () => {
  test("claim_class is the literal 'hypothesis' on every output", () => {
    const v = answers({
      ...UNANSWERED,
      ...FRICTION,
      q1_channels: ["phone", "email", "social"],
      q2_reachable: "varies",
      q5_miss_visibility: "no",
    });
    for (const condition of SCAN_CONDITION_ORDER) {
      for (const h of deriveHypotheses(condition, v.answers).hypotheses) {
        assert.equal(h.claim_class, "hypothesis");
        assert.equal(h.source_type, "derived_deterministic");
        assert.deepEqual(h.contradicting_evidence, []);
      }
    }
  });

  test("the module never names another claim class", () => {
    assert.doesNotMatch(source(), /asserted_cause|"observation"|business_state/);
  });

  test("no emitter display text carries causal-certainty wording", () => {
    const texts = source().match(/display_text:\s*\n?\s*"([^"]+)"/g) ?? [];
    assert.equal(texts.length, 6, "expected six display texts in the table");
    for (const t of texts) assert.doesNotMatch(t, CAUSAL_CERTAINTY, t);
    for (const t of texts) assert.match(t, /\b(may|could|suggests)\b/, `${t} is not tentative`);
    // And the presentation strings.
    for (const s of [HYPOTHESES_SECTION_TITLE, HYPOTHESES_SECTION_NOTE, HYPOTHESES_NONE_WORDING]) {
      assert.doesNotMatch(s, CAUSAL_CERTAINTY, s);
    }
  });

  test("rendered wording carries no causal certainty either", () => {
    const v = answers({
      ...UNANSWERED,
      ...FOLLOWUP,
      ...FRICTION,
      q1_channels: ["phone", "email", "social"],
      q2_reachable: "working_hours",
      q5_miss_visibility: "no",
    });
    const html = unescape(render(buildScanReport(v.answers, CONTEXT, v.inconsistencies), v.answers));
    const section = html.match(/data-hypotheses[\s\S]*?<\/ol>/g) ?? [];
    assert.ok(section.length > 0);
    for (const s of section) assert.doesNotMatch(s, CAUSAL_CERTAINTY);
  });
});

// ── 4. No winner ───────────────────────────────────────────────────

describe("a ranked list with no winner", () => {
  test("no is_primary, winner or selected anywhere in the module or the types", () => {
    // Comments may (and do) SAY "no winner"; the code may not declare one.
    const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const file of [MODULE, "src/lib/freetools/scanTypes.ts"]) {
      assert.doesNotMatch(stripComments(readFileSync(file, "utf8")), /is_primary|isPrimary|winner|selected/i, file);
    }
  });

  test("ranks are 1..n, reason-coded, deterministic — and a one-item list is still ranked", () => {
    const v = answers({ ...FRICTION, q1_channels: ["phone"], q2_reachable: "working_hours" });
    const { hypotheses } = deriveHypotheses("booking.friction", v.answers);
    assert.equal(hypotheses.length, 1);
    assert.equal(hypotheses[0].rank, 1);
    assert.equal(hypotheses[0].rank_reason, "rule_table_order");

    const w = answers({
      ...UNANSWERED,
      q1_channels: ["phone", "email", "social"],
      q2_reachable: "working_hours",
      q5_miss_visibility: "no",
    });
    const many = deriveHypotheses("enquiry.unanswered", w.answers).hypotheses;
    assert.deepEqual(
      many.map((h) => h.rank),
      many.map((_, i) => i + 1)
    );
    assert.deepEqual(
      many.map((h) => h.code),
      ["reachability_window_limited", "channels_spread", "misses_go_unnoticed"]
    );
    for (const h of many) assert.equal(h.rank_reason, "rule_table_order");
  });

  test("the `more_evidence` rung is declared and never binds in Phase 1 (every rule cites one answer)", () => {
    // Pinned so that a rule citing two answers cannot appear without a
    // test noticing the ladder's first rung has come alive.
    let seen = 0;
    for (const q1 of [["phone"], ["phone", "email", "social"], ["text_whatsapp", "email", "web_form"]]) {
      for (const q2 of ["working_hours", "extended", "any_time", "varies"]) {
        for (const q5 of ["yes_always", "sometimes", "no"]) {
          const v = answers({ ...UNANSWERED, ...FRICTION, q1_channels: q1, q2_reachable: q2, q5_miss_visibility: q5 });
          for (const condition of SCAN_CONDITION_ORDER) {
            for (const h of deriveHypotheses(condition, v.answers).hypotheses) {
              seen += 1;
              assert.equal(h.evidence.length, 1);
              assert.equal(h.rank_reason, "rule_table_order");
            }
          }
        }
      }
    }
    assert.ok(seen > 50);
  });

  test("hypothesis ids are deterministic and never positional", () => {
    const v = answers({ ...UNANSWERED, q2_reachable: "working_hours", q5_miss_visibility: "no" });
    const ids = deriveHypotheses("enquiry.unanswered", v.answers).hypotheses.map((h) => h.hypothesis_id);
    assert.deepEqual(ids, [
      "enquiry.unanswered:reachability_window_limited",
      "enquiry.unanswered:misses_go_unnoticed",
    ]);
  });
});

// ── 5. Explicit emptiness ──────────────────────────────────────────

describe("an empty list is a stated result", () => {
  test("enquiry.no_followup has no rules: [] with no_rule_matched", () => {
    const r = report({ ...FOLLOWUP, q1_channels: ["phone", "email", "social"], q2_reachable: "varies", q5_miss_visibility: "no" });
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].finding.condition, "enquiry.no_followup");
    assert.deepEqual(r.findings[0].hypotheses, []);
    assert.equal(r.findings[0].hypotheses_empty_reason, "no_rule_matched");
  });

  test("a finding whose answers match no rule is empty too, never null", () => {
    // Unanswered, reachable any time, one channel, always notices misses.
    const r = report({ ...UNANSWERED, q2_reachable: "any_time", q1_channels: ["phone"], q5_miss_visibility: "yes_always" });
    assert.equal(r.findings[0].finding.condition, "enquiry.unanswered");
    assert.deepEqual(r.findings[0].hypotheses, []);
    assert.equal(r.findings[0].hypotheses_empty_reason, "no_rule_matched");
  });

  test("the reason is null exactly when the list is non-empty", () => {
    const r = report({ ...UNANSWERED, q2_reachable: "working_hours" });
    assert.ok(r.findings[0].hypotheses.length > 0);
    assert.equal(r.findings[0].hypotheses_empty_reason, null);
  });
});

// ── 6. Determinism ─────────────────────────────────────────────────

describe("identical answers produce identical hypotheses", () => {
  test("across repeated calls", () => {
    const v = answers({ ...UNANSWERED, ...FRICTION, q1_channels: ["email", "phone"], q2_reachable: "varies" });
    const a = buildScanReport(v.answers, CONTEXT, v.inconsistencies);
    const b = buildScanReport(v.answers, CONTEXT, v.inconsistencies);
    assert.deepEqual(a, b);
  });

  test("across answer-object key order", () => {
    const forward = answers({ ...UNANSWERED, ...FRICTION, q1_channels: ["email", "phone"], q2_reachable: "varies" });
    const reversed = validateScanAnswers(
      Object.fromEntries(
        Object.entries({ ...QUIET, ...UNANSWERED, ...FRICTION, q1_channels: ["email", "phone"], q2_reachable: "varies" }).reverse()
      )
    );
    assert.equal(reversed.valid, true);
    for (const condition of SCAN_CONDITION_ORDER) {
      assert.deepEqual(
        deriveHypotheses(condition, forward.answers),
        deriveHypotheses(condition, reversed.answers)
      );
    }
  });
});

// ── 7. Confidence independence ─────────────────────────────────────

describe("hypothesis confidence is its own, not the finding's", () => {
  test("a LOW-confidence finding carries a MEDIUM hypothesis", () => {
    // Q5 = no caps the finding at low; the working-hours rule is medium.
    const r = report({ ...UNANSWERED, q2_reachable: "working_hours", q5_miss_visibility: "no" });
    const entry = r.findings[0];
    assert.equal(entry.finding.finding_confidence, "low");
    const h = entry.hypotheses.find((x) => x.code === "reachability_window_limited");
    assert.equal(h.hypothesis_confidence, "medium");
  });

  test("a HIGH-confidence finding carries a LOW hypothesis", () => {
    const r = report({ ...UNANSWERED, q2_reachable: "varies", q5_miss_visibility: "yes_always" });
    const entry = r.findings[0];
    assert.equal(entry.finding.finding_confidence, "high");
    assert.deepEqual(
      entry.hypotheses.map((h) => [h.code, h.hypothesis_confidence]),
      [["reachability_inconsistent", "low"]]
    );
  });

  test("the same rule yields the same confidence whatever the finding's is", () => {
    const low = report({ ...UNANSWERED, q1_channels: ["phone", "email", "social"], q5_miss_visibility: "no" });
    const high = report({ ...UNANSWERED, q1_channels: ["phone", "email", "social"], q5_miss_visibility: "yes_always" });
    assert.notEqual(low.findings[0].finding.finding_confidence, high.findings[0].finding.finding_confidence);
    const pick = (r) => r.findings[0].hypotheses.find((h) => h.code === "channels_spread").hypothesis_confidence;
    assert.equal(pick(low), pick(high));
  });
});

// ── 8. Non-interference ────────────────────────────────────────────

describe("nothing upstream changes because hypotheses exist", () => {
  const scenarios = [
    {},
    UNANSWERED,
    FOLLOWUP,
    FRICTION,
    { ...UNANSWERED, ...FOLLOWUP },
    { ...UNANSWERED, ...FRICTION },
    { ...FOLLOWUP, ...FRICTION },
    { ...UNANSWERED, ...FOLLOWUP, ...FRICTION },
    { ...UNANSWERED, q2_reachable: "working_hours", q5_miss_visibility: "no" },
    { ...UNANSWERED, q1_channels: ["phone", "email", "web_form", "social"], q2_reachable: "varies" },
    { ...FRICTION, q1_channels: ["text_whatsapp"], q2_reachable: "varies" },
    { ...UNANSWERED, ...FRICTION, q8_typical_job_value: { kind: "amount", amount: 180, currency: "EUR" }, q9_conversion_share: "most" },
    { ...UNANSWERED, q4_unanswered_per_week: { kind: "count", value: 40 } }, // Q4 > Q3: suppressed
    { ...UNANSWERED, q3_enquiries_per_week: { kind: "not_sure" } },
  ];

  test("every pre-existing report field deep-equals its own recomputation without hypotheses", () => {
    for (const patch of scenarios) {
      const v = answers(patch);
      const r = buildScanReport(v.answers, CONTEXT, v.inconsistencies);

      const derived = deriveFindings(v.answers);
      assert.deepEqual(r.findings.map((f) => f.finding), derived);
      assert.deepEqual(
        r.findings.map((f) => f.finding.condition),
        derived.map((f) => f.condition)
      );
      // Delivery order is SCAN_CONDITION_ORDER, unchanged.
      const orderIndex = (c) => SCAN_CONDITION_ORDER.indexOf(c);
      const conditions = r.findings.map((f) => f.finding.condition);
      assert.deepEqual(conditions, [...conditions].sort((a, b) => orderIndex(a) - orderIndex(b)));

      r.findings.forEach((entry, i) => {
        const impact = computeLostRevenue(derived[i], v.answers, CONTEXT);
        assert.deepEqual(entry.impact, impact);
        assert.deepEqual(entry.recommendation, recommendFor(derived[i], v.answers));
        assert.deepEqual(entry.impact_class, classifyImpact(impact));
      });

      const conds = derived.map((f) => f.condition);
      const funnel = buildEnquiryFunnel(v.answers, conds, v.inconsistencies);
      const dependencies = deriveDependencies(conds);
      assert.deepEqual(r.funnel, funnel);
      assert.deepEqual(r.earliest_leak, findEarliestLeak(funnel));
      assert.deepEqual(r.dependencies, dependencies);
      assert.deepEqual(r.prioritisation, prioritise(derived, dependencies));
      assert.deepEqual(
        r.evidence_gaps,
        deriveEvidenceGaps(
          // The gap deriver is handed findings WITHOUT the new fields, proving
          // its output never depended on them.
          r.findings.map(({ finding, impact, recommendation, impact_class }) => ({ finding, impact, recommendation, impact_class })),
          funnel
        )
      );
      assert.deepEqual(r.clusters, deriveClusters(derived));
      assert.deepEqual(r.inconsistencies, v.inconsistencies);
      assert.equal(r.rule_set_version, SCAN_RULE_SET_VERSION);
      assert.equal(r.prioritisation_rule_set_version, SCAN_PRIORITISATION_RULE_SET_VERSION);
      assert.equal(r.cluster_rule_set_version, SCAN_CLUSTER_RULE_SET_VERSION);
    }
  });

  test("the only new keys are the two per-finding fields and the report version", () => {
    const r = report({ ...UNANSWERED, ...FOLLOWUP, ...FRICTION });
    assert.deepEqual(
      Object.keys(r).sort(),
      [
        "cluster_rule_set_version",
        "clusters",
        "dependencies",
        "earliest_leak",
        "evidence_gaps",
        "findings",
        "funnel",
        "hypothesis_rule_set_version",
        "inconsistencies",
        "prioritisation",
        "prioritisation_rule_set_version",
        "question_set_version",
        "rule_set_version",
      ]
    );
    for (const entry of r.findings) {
      assert.deepEqual(Object.keys(entry).sort(), [
        "finding",
        "hypotheses",
        "hypotheses_empty_reason",
        "impact",
        "impact_class",
        "recommendation",
      ]);
    }
  });

  test("the existing version constants did not move", () => {
    assert.equal(SCAN_RULE_SET_VERSION, "v1");
    assert.equal(SCAN_PRIORITISATION_RULE_SET_VERSION, "v1");
    assert.equal(SCAN_CLUSTER_RULE_SET_VERSION, "v1");
  });

  test("shared_cause_candidate is still unreachable: clusters do not read hypotheses", () => {
    const r = report({ ...UNANSWERED, ...FRICTION, q2_reachable: "working_hours", q1_channels: ["email", "phone"] });
    // Both findings now carry hypotheses that overlap on Q2 evidence —
    // and the cluster layer must not notice.
    assert.ok(r.findings.every((f) => f.hypotheses.length > 0));
    assert.ok(r.clusters.every((c) => c.relation !== "shared_cause_candidate"));
    assert.doesNotMatch(readFileSync("src/lib/freetools/scanClusters.ts", "utf8"), /scanHypotheses/);
  });
});

// ── 9. Anti-funnel ─────────────────────────────────────────────────

describe("hypotheses add no pressure and no reach", () => {
  test("a zero-findings report renders no hypotheses section at all", () => {
    const v = answers({ q2_reachable: "working_hours", q1_channels: ["phone", "email", "social"], q5_miss_visibility: "no" });
    const r = buildScanReport(v.answers, CONTEXT, v.inconsistencies);
    assert.equal(r.findings.length, 0);
    const html = render(r, v.answers);
    assert.equal(count(html, /data-hypotheses/g), 0);
    assert.equal(count(html, /data-hypothesis=/g), 0);
    assert.ok(!unescape(html).includes(HYPOTHESES_SECTION_TITLE));
  });

  test("a suppressed finding (Q4 > Q3) yields no hypotheses", () => {
    const v = answers({ q4_unanswered_per_week: { kind: "count", value: 40 }, q2_reachable: "working_hours" });
    const r = buildScanReport(v.answers, CONTEXT, v.inconsistencies);
    assert.ok(r.inconsistencies.some((i) => i.code === "q4_exceeds_q3"));
    assert.equal(r.findings.length, 0);
    assert.equal(count(render(r, v.answers), /data-hypothes/g), 0);
  });

  test("no new CTA, link, product, handoff or storage", () => {
    const client = readFileSync("src/app/free-tools/business-opportunity-scan/ScanClient.tsx", "utf8");
    const section = client.slice(client.indexOf("HYPOTHESES_SECTION_TITLE}"), client.indexOf("What it may be worth"));
    assert.ok(section.length > 0);
    assert.doesNotMatch(section, /href=|<Link|<a |localStorage|sessionStorage|fetch\(|data-product|data-handoff|signup|Sign up/);
  });
});

// ── 10. Surface ────────────────────────────────────────────────────

describe("the section appears only inside an existing finding", () => {
  test("populated: title, note, one item per hypothesis, each with rank, evidence and confidence", () => {
    const v = answers({ ...UNANSWERED, q2_reachable: "working_hours", q5_miss_visibility: "no" });
    const r = buildScanReport(v.answers, CONTEXT, v.inconsistencies);
    const html = unescape(render(r, v.answers));
    assert.equal(count(html, new RegExp(HYPOTHESES_SECTION_TITLE, "g")), 1);
    assert.ok(html.includes(HYPOTHESES_SECTION_NOTE));
    assert.equal(count(html, /data-hypotheses="2"/g), 1);
    assert.equal(count(html, /data-hypothesis="reachability_window_limited"/g), 1);
    assert.equal(count(html, /data-hypothesis="misses_go_unnoticed"/g), 1);
    assert.equal(count(html, /data-hypothesis-rank="1"/g), 1);
    assert.equal(count(html, /data-hypothesis-rank="2"/g), 1);
    assert.equal(count(html, /data-hypothesis-evidence="q2_reachable"/g), 1);
    assert.equal(count(html, /data-hypothesis-evidence="q5_miss_visibility"/g), 1);
    assert.equal(count(html, /data-hypothesis-confidence="medium"/g), 2);
    assert.ok(!html.includes(HYPOTHESES_NONE_WORDING));
    // The section lives inside the finding article, after the evidence and confidence.
    const article = html.slice(html.indexOf('data-condition="enquiry.unanswered"'));
    assert.ok(article.indexOf("How confident we are") < article.indexOf(HYPOTHESES_SECTION_TITLE));
    assert.ok(article.indexOf(HYPOTHESES_SECTION_TITLE) < article.indexOf("What it may be worth"));
  });

  test("empty: the neutral sentence renders, nothing is invented", () => {
    const v = answers(FOLLOWUP);
    const r = buildScanReport(v.answers, CONTEXT, v.inconsistencies);
    const html = unescape(render(r, v.answers));
    assert.equal(count(html, new RegExp(HYPOTHESES_SECTION_TITLE, "g")), 1);
    assert.equal(count(html, /data-hypotheses-none="no_rule_matched"/g), 1);
    assert.ok(html.includes(HYPOTHESES_NONE_WORDING));
    assert.equal(count(html, /data-hypothesis=/g), 0);
  });

  test("one section per finding, never a top-level section", () => {
    const v = answers({ ...UNANSWERED, ...FOLLOWUP, ...FRICTION, q2_reachable: "working_hours" });
    const r = buildScanReport(v.answers, CONTEXT, v.inconsistencies);
    const html = unescape(render(r, v.answers));
    assert.equal(r.findings.length, 3);
    assert.equal(count(html, new RegExp(HYPOTHESES_SECTION_TITLE, "g")), 3);
    const client = readFileSync("src/app/free-tools/business-opportunity-scan/ScanClient.tsx", "utf8");
    // Referenced once, inside the finding card component only.
    assert.equal((client.match(/HYPOTHESES_SECTION_TITLE\}/g) ?? []).length, 1);
    assert.doesNotMatch(client, /deriveHypotheses\(|HYPOTHESIS_RULES/);
  });

  test("the footer carries the explanation rule-set version from its own field", () => {
    const v = answers(UNANSWERED);
    const r = buildScanReport(v.answers, CONTEXT, v.inconsistencies);
    const html = unescape(render(r, v.answers));
    assert.ok(
      html.includes(
        `Question set ${r.question_set_version}, rules ${r.rule_set_version}, ordering rules ${r.prioritisation_rule_set_version}, relation rules ${r.cluster_rule_set_version}, explanation rules ${r.hypothesis_rule_set_version}.`
      )
    );
  });
});
