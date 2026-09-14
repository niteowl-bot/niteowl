// Business Opportunity Scan — the first user-facing surface (PR C).
//
// What this suite proves, and what it deliberately does not:
//
//   1. The presentation layer names every canonical code it can be
//      handed, so a value added to the contract cannot reach the
//      screen unlabelled.
//   2. draftToPayload converts what the visitor typed into the
//      canonical payload WITHOUT repairing, defaulting or inventing —
//      absent stays absent, "not sure" is explicit, and anything not
//      plainly a number is passed through for the validator to refuse.
//   3. The questionnaire is driven by SCAN_QUESTIONS: wording, order,
//      options, requiredness. Nothing is preselected.
//   4. The report renders the engine's output verbatim — findings in
//      delivered order, both confidences separately, impact as a range
//      or the canonical UNKNOWN, assumptions inline, next step, the
//      declared criterion, and the product and handoff EXACTLY as
//      carried — and adds no wording the contract forbids.
//   5. The surface is structurally unable to persist, fetch, reach a
//      provider, inject HTML, or route on Q1/Q2.
//
// It does not test the wizard's click-by-click behaviour: the
// repository has no DOM harness, and the parts that decide anything
// (validation, the report) are pure and are tested directly.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  SCAN_QUESTIONS,
  CONTACT_CHANNELS,
  REACHABLE_WINDOWS,
  MISS_VISIBILITIES,
  FOLLOWUP_PRACTICES,
  MESSAGES_TO_BOOK,
  CONVERSION_SHARES,
} from "@/lib/freetools/scanQuestions";
import { validateScanAnswers } from "@/lib/freetools/scanValidation";
import { buildScanReport } from "@/lib/freetools/scanFindings";
import { SETUP_KIT_HANDOFF, SCAN_RECOMMENDATIONS } from "@/lib/freetools/scanRecommendations";
import {
  VALUE_LABELS,
  CONFIDENCE_LABELS,
  CAP_REASON_LABELS,
  UNKNOWN_REASON_LABELS,
  ERROR_LABELS,
  PRODUCT_ATTRIBUTION,
  NO_FINDINGS_WORDING,
  CURRENCY_CHOICES,
  OTHER_CURRENCY,
  CLUSTERS_NONE_ESTABLISHED_WORDING,
  CLUSTER_RELATION_LABELS,
  CLUSTER_RULE_LABELS,
  DEPENDENCY_RELATION_LABELS,
  DEPENDENCY_RULE_LABELS,
  GAP_BLOCKS_LABELS,
  GAP_EFFORT_LABELS,
  IMPACT_CLASS_LABELS,
  INFORMATION_GAIN_LABELS,
  PRIORITY_ORDER_NOT_CAUSE,
  STAGE_ASSESSMENT_LABELS,
  STAGE_KIND_LABELS,
  STAGE_LABELS,
  STAGE_NOT_ASSESSED_NOTE,
  STAGE_NOT_ESTABLISHED_LABELS,
  STAGE_STATE_LABELS,
  earliestLeakSentences,
  emptyDraft,
  draftToPayload,
  answerLabel,
  formatImpactRange,
} from "@/app/free-tools/business-opportunity-scan/scanPresentation";
import ScanClient, {
  ScanReportDocument,
} from "@/app/free-tools/business-opportunity-scan/ScanClient";

const SURFACE_DIR = "src/app/free-tools/business-opportunity-scan";
const SURFACE_FILES = [
  `${SURFACE_DIR}/page.tsx`,
  `${SURFACE_DIR}/ScanClient.tsx`,
  `${SURFACE_DIR}/scanPresentation.ts`,
];
const HUB = "src/app/free-tools/page.tsx";

const read = (f) => readFileSync(f, "utf8");
/** Source with comment lines removed, so prose about the code is never mistaken for the code. */
const code = (f) =>
  read(f)
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

// ── Fixtures (the same shapes the recommendation suite uses) ──────

const CONTEXT = {
  answered_at: "2026-09-11T10:00:00.000Z",
  computed_at: "2026-09-11T10:00:01.000Z",
};

const QUIET = {
  q1_channels: ["phone", "web_form"],
  q2_reachable: "working_hours",
  q3_enquiries_per_week: { kind: "count", value: 20 },
  q4_unanswered_per_week: { kind: "count", value: 0 },
  q5_miss_visibility: "yes_always",
  q6_followup: "within_a_day",
  q7_messages_to_book: "one",
};

const ALL_THREE = {
  q4_unanswered_per_week: { kind: "count", value: 4 },
  q6_followup: "nothing_planned",
  q7_messages_to_book: "more_than_three",
};

const ALL_THREE_SIZED = {
  ...ALL_THREE,
  q8_typical_job_value: { kind: "amount", amount: 250, currency: "EUR" },
  q9_conversion_share: "about_half",
};

function validated(patch = {}) {
  const result = validateScanAnswers({ ...QUIET, ...patch });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return result;
}

function renderReport(patch = {}) {
  const v = validated(patch);
  const report = buildScanReport(v.answers, CONTEXT, v.inconsistencies);
  const html = renderToStaticMarkup(
    createElement(ScanReportDocument, { report, answers: v.answers })
  );
  return { report, answers: v.answers, html };
}

const count = (html, re) => (html.match(re) ?? []).length;
const unescape = (s) =>
  s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

// ── 1. Every canonical code has an owner-facing label ─────────────

describe("every canonical code the surface can be handed has a label", () => {
  test("every allowed value of every question", () => {
    for (const q of SCAN_QUESTIONS) {
      for (const v of q.allowedValues ?? []) {
        assert.equal(typeof VALUE_LABELS[v], "string", `${q.id}: "${v}" has no label`);
        assert.ok(VALUE_LABELS[v].trim().length > 0);
      }
    }
    // The exported value sets and the question definitions agree.
    for (const set of [
      CONTACT_CHANNELS,
      REACHABLE_WINDOWS,
      MISS_VISIBILITIES,
      FOLLOWUP_PRACTICES,
      MESSAGES_TO_BOOK,
      CONVERSION_SHARES,
    ]) {
      for (const v of set) assert.equal(typeof VALUE_LABELS[v], "string", v);
    }
  });

  test("every confidence, cap reason, unknown reason, error code and product", () => {
    const capReasons = code("src/lib/freetools/scanTypes.ts")
      .match(/export type ScanConfidenceCapReason =[\s\S]*?;/)[0]
      .match(/"([a-z0-9_]+)"/g)
      .map((s) => s.slice(1, -1));
    const unknownReasons = code("src/lib/freetools/scanTypes.ts")
      .match(/export type LostRevenueUnknownReason =[\s\S]*?;/)[0]
      .match(/"([a-z0-9_]+)"/g)
      .map((s) => s.slice(1, -1));
    const errorCodes = code("src/lib/freetools/scanValidation.ts")
      .match(/export type ScanValidationErrorCode =[\s\S]*?;/)[0]
      .match(/"([a-z0-9_]+)"/g)
      .map((s) => s.slice(1, -1));

    assert.ok(capReasons.length >= 5 && unknownReasons.length >= 11 && errorCodes.length >= 12);
    for (const c of capReasons) assert.equal(typeof CAP_REASON_LABELS[c], "string", c);
    for (const c of unknownReasons) assert.equal(typeof UNKNOWN_REASON_LABELS[c], "string", c);
    for (const c of errorCodes) assert.equal(typeof ERROR_LABELS[c], "string", c);
    for (const c of ["low", "medium", "high"]) assert.equal(typeof CONFIDENCE_LABELS[c], "string");
    assert.equal(typeof PRODUCT_ATTRIBUTION.remy, "string");
  });

  test("labels add no number, benchmark, percentage or currency figure of their own", () => {
    const all = [
      ...Object.values(CAP_REASON_LABELS),
      ...Object.values(UNKNOWN_REASON_LABELS),
      ...Object.values(PRODUCT_ATTRIBUTION),
      NO_FINDINGS_WORDING,
    ].join("\n");
    assert.doesNotMatch(all, /\d+(\.\d+)?\s?%/);
    assert.doesNotMatch(all, /[€£$]\s?\d/);
    assert.doesNotMatch(all, /benchmark|average|industry|most businesses/i);
    assert.doesNotMatch(all, /we (observed|saw|measured|found|noticed)/i);
  });
});

// ── 2. draftToPayload — no repair, no defaults ────────────────────

describe("draftToPayload converts without repairing or inventing", () => {
  test("an empty draft produces an EMPTY payload, so every required answer is the validator's refusal", () => {
    const payload = draftToPayload(emptyDraft());
    assert.deepEqual(payload, {});
    const result = validateScanAnswers(payload);
    assert.equal(result.valid, false);
    const required = SCAN_QUESTIONS.filter((q) => q.required).map((q) => q.id).sort();
    const refused = result.errors.filter((e) => e.code === "required").map((e) => e.question_id).sort();
    assert.deepEqual(refused, required);
  });

  test("optional questions left blank are omitted, never substituted", () => {
    const d = { ...emptyDraft(), q1_channels: ["phone"], q2_reachable: "working_hours" };
    const payload = draftToPayload(d);
    for (const q of SCAN_QUESTIONS.filter((q) => !q.required)) {
      assert.equal(q.id in payload, false, `${q.id} should be absent`);
    }
  });

  test("explicit 'not sure' becomes the canonical not_sure, for counts and money", () => {
    const d = {
      ...emptyDraft(),
      q3_enquiries_per_week: { mode: "not_sure", value: "" },
      q8_typical_job_value: {
        mode: "not_sure", amount: "", low: "", high: "", currency: "", otherCurrency: "",
      },
    };
    const payload = draftToPayload(d);
    assert.deepEqual(payload.q3_enquiries_per_week, { kind: "not_sure" });
    assert.deepEqual(payload.q8_typical_job_value, { kind: "not_sure" });
  });

  test("a count mode with nothing typed is absent, not zero", () => {
    const d = { ...emptyDraft(), q4_unanswered_per_week: { mode: "count", value: "  " } };
    assert.equal("q4_unanswered_per_week" in draftToPayload(d), false);
  });

  test("a whole number becomes an integer count", () => {
    const d = { ...emptyDraft(), q3_enquiries_per_week: { mode: "count", value: " 20 " } };
    assert.deepEqual(draftToPayload(d).q3_enquiries_per_week, { kind: "count", value: 20 });
  });

  test("a non-integer count is passed through for the validator to refuse — not rounded", () => {
    for (const typed of ["3.5", "abc", "-2", "1e3"]) {
      const d = { ...emptyDraft(), q3_enquiries_per_week: { mode: "count", value: typed } };
      const payload = draftToPayload(d);
      assert.equal(payload.q3_enquiries_per_week.value, typed, typed);
      const result = validateScanAnswers({ ...QUIET, ...payload });
      assert.equal(result.valid, false, typed);
      assert.ok(result.errors.some((e) => e.question_id === "q3_enquiries_per_week"));
    }
  });

  test("an amount with a chosen currency becomes a canonical amount", () => {
    const d = {
      ...emptyDraft(),
      q8_typical_job_value: {
        mode: "amount", amount: "250.50", low: "", high: "", currency: "GBP", otherCurrency: "",
      },
    };
    assert.deepEqual(draftToPayload(d).q8_typical_job_value, {
      kind: "amount", amount: 250.5, currency: "GBP",
    });
  });

  test("a range with a typed 'other' currency becomes a canonical range", () => {
    const d = {
      ...emptyDraft(),
      q8_typical_job_value: {
        mode: "range", amount: "", low: "100", high: "400", currency: OTHER_CURRENCY, otherCurrency: " CHF ",
      },
    };
    assert.deepEqual(draftToPayload(d).q8_typical_job_value, {
      kind: "range", low: 100, high: 400, currency: "CHF",
    });
  });

  test("no currency chosen is passed through empty and the validator refuses it — nothing is assumed", () => {
    const d = {
      ...emptyDraft(),
      q8_typical_job_value: {
        mode: "amount", amount: "250", low: "", high: "", currency: "", otherCurrency: "",
      },
    };
    const payload = draftToPayload(d);
    assert.equal(payload.q8_typical_job_value.currency, "");
    const result = validateScanAnswers({ ...QUIET, ...payload });
    assert.ok(result.errors.some((e) => e.code === "invalid_currency"));
    assert.equal(CURRENCY_CHOICES.includes(""), false);
  });

  test("an inverted range is passed through as typed, never swapped", () => {
    const d = {
      ...emptyDraft(),
      q8_typical_job_value: {
        mode: "range", amount: "", low: "400", high: "100", currency: "EUR", otherCurrency: "",
      },
    };
    const payload = draftToPayload(d);
    assert.deepEqual([payload.q8_typical_job_value.low, payload.q8_typical_job_value.high], [400, 100]);
    assert.ok(validateScanAnswers({ ...QUIET, ...payload }).errors.some((e) => e.code === "range_inverted"));
  });

  test("the payload never carries a key that is not one of the nine", () => {
    const d = { ...emptyDraft(), q1_channels: ["phone"], q2_reachable: "any_time" };
    const ids = new Set(SCAN_QUESTIONS.map((q) => q.id));
    for (const key of Object.keys(draftToPayload(d))) assert.ok(ids.has(key), key);
  });

  test("a fully answered draft round-trips through the validator", () => {
    const d = {
      ...emptyDraft(),
      q1_channels: ["phone", "email"],
      q2_reachable: "extended",
      q3_enquiries_per_week: { mode: "count", value: "30" },
      q4_unanswered_per_week: { mode: "count", value: "5" },
      q5_miss_visibility: "sometimes",
      q6_followup: "eventually",
      q7_messages_to_book: "two_or_three",
      q8_typical_job_value: {
        mode: "amount", amount: "180", low: "", high: "", currency: "EUR", otherCurrency: "",
      },
      q9_conversion_share: "most",
    };
    const result = validateScanAnswers(draftToPayload(d));
    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.deepEqual(result.answers.q1_channels, ["phone", "email"]);
    assert.deepEqual(result.answers.q8_typical_job_value, { kind: "amount", amount: 180, currency: "EUR" });
  });
});

// ── 3. The questionnaire is the contract ──────────────────────────

describe("the questionnaire is driven by SCAN_QUESTIONS", () => {
  const src = code(`${SURFACE_DIR}/ScanClient.tsx`);
  const pres = code(`${SURFACE_DIR}/scanPresentation.ts`);

  test("the empty draft has one entry per canonical question and nothing chosen", () => {
    const d = emptyDraft();
    assert.deepEqual(Object.keys(d).sort(), SCAN_QUESTIONS.map((q) => q.id).sort());
    for (const q of SCAN_QUESTIONS) {
      const v = d[q.id];
      if (q.kind === "multi_select") assert.deepEqual(v, []);
      else if (q.kind === "single_select") assert.equal(v, null);
      else assert.equal(v.mode, null, `${q.id} must start with no mode chosen`);
    }
  });

  test("no question wording, option list or required flag is restated in the surface", () => {
    for (const q of SCAN_QUESTIONS) {
      assert.doesNotMatch(src, new RegExp(q.wording.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(pres, new RegExp(q.wording.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    // The client reads the contract, and the contract alone, for the questions.
    assert.match(src, /SCAN_QUESTIONS/);
    assert.match(src, /question\.wording/);
    assert.match(src, /question\.allowedValues/);
    assert.match(src, /question\.required/);
    assert.match(src, /question\.kind/);
    // No hand-written option array.
    assert.doesNotMatch(src, /\[\s*"phone"|\[\s*"working_hours"|\[\s*"yes_always"/);
  });

  test("every canonical kind is rendered by a branch of its own, and nothing else is", () => {
    const kinds = [...new Set(SCAN_QUESTIONS.map((q) => q.kind))].sort();
    assert.deepEqual(kinds, ["count_or_not_sure", "money_or_not_sure", "multi_select", "single_select"]);
    for (const k of kinds) assert.match(src, new RegExp(`case "${k}"`));
  });

  test("the three screens cover the nine questions in order, without overlap", () => {
    const steps = [...src.matchAll(/from:\s*(\d+),\s*to:\s*(\d+)/g)].map((m) => [+m[1], +m[2]]);
    assert.equal(steps[0][0], 0);
    assert.equal(steps.at(-1)[1], SCAN_QUESTIONS.length);
    for (let i = 1; i < steps.length; i++) assert.equal(steps[i][0], steps[i - 1][1]);
  });

  test("no radio, checkbox or select is preselected: every control is bound to draft state", () => {
    assert.doesNotMatch(src, /defaultChecked|defaultValue|checked=\{true\}|selected/);
  });

  test("the whole page mounts without a DOM and shows the intro's zero-persistence statements", () => {
    const html = renderToStaticMarkup(createElement(ScanClient));
    assert.match(html, /Nothing is stored, and nothing is sent to NiteOwl/);
    assert.match(html, /Refreshing or closing the page clears the scan/);
    assert.match(html, /No account/);
    assert.match(html, /never count against you/);
  });
});

// ── 4. The report renders the engine's output verbatim ────────────

describe("the report renders what the engine delivered", () => {
  test("three findings, in the delivered order, each with headline, why, next step and criterion verbatim", () => {
    const { report, html } = renderReport(ALL_THREE_SIZED);
    assert.equal(report.findings.length, 3);
    const positions = report.findings.map((f) => html.indexOf(`data-condition="${f.finding.condition}"`));
    assert.ok(positions.every((p) => p >= 0));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
    for (const f of report.findings) {
      const rec = f.recommendation;
      for (const text of [rec.headline, rec.why_it_matters, rec.next_step, rec.success_criterion.wording]) {
        assert.ok(unescape(html).includes(text), `missing verbatim: ${text.slice(0, 40)}`);
      }
      assert.ok(html.includes(`Look again in ${rec.review_window_days} days`));
    }
    assert.equal(count(html, /data-no-findings/g), 0);
  });

  test("one finding", () => {
    const { report, html } = renderReport({ q6_followup: "nothing_planned" });
    assert.equal(report.findings.length, 1);
    assert.equal(count(html, /data-condition=/g), 1);
    assert.match(html, /data-condition="enquiry\.no_followup"/);
  });

  test("zero findings — the honest wording, and no manufactured recommendation", () => {
    const { report, html } = renderReport();
    assert.equal(report.findings.length, 0);
    assert.match(html, /data-no-findings/);
    assert.ok(unescape(html).includes(NO_FINDINGS_WORDING));
    assert.equal(count(html, /data-condition=/g), 0);
    assert.equal(count(html, /data-next-step/g), 0);
    assert.equal(count(html, /data-product=/g), 0);
    assert.equal(count(html, /data-handoff/g), 0);
    // Q1/Q2 context is still delivered (§87.4).
    assert.match(html, /data-what-you-told-us/);
    assert.match(html, /data-answer="q1_channels"[^>]*>Phone, Website form</);
    assert.match(html, /data-answer="q2_reachable"[^>]*>Working hours only</);
  });

  test("Q4 > Q3 — the inconsistency is shown verbatim and the finding is suppressed", () => {
    const { report, html } = renderReport({
      q3_enquiries_per_week: { kind: "count", value: 5 },
      q4_unanswered_per_week: { kind: "count", value: 9 },
    });
    assert.equal(report.inconsistencies.length, 1);
    assert.match(html, /data-inconsistency="q4_exceeds_q3"/);
    assert.ok(unescape(html).includes(report.inconsistencies[0].message));
    assert.doesNotMatch(html, /data-condition="enquiry\.unanswered"/);
  });

  test("UNKNOWN impact — the canonical reason's wording, and no placeholder amount", () => {
    const { report, html } = renderReport(ALL_THREE);
    for (const f of report.findings) assert.equal(f.impact.kind, "unknown");
    assert.equal(count(html, /data-impact="unknown"/g), 3);
    assert.equal(count(html, /data-impact="estimate"/g), 0);
    assert.match(html, /We cannot size this\./);
    for (const f of report.findings) {
      assert.ok(unescape(html).includes(UNKNOWN_REASON_LABELS[f.impact.reason]), f.impact.reason);
    }
    assert.doesNotMatch(html, /data-size-confidence/);
    assert.doesNotMatch(html, /per week/);
  });

  test("sized impact — both ends, the owner's currency, per week; no midpoint, nothing annualised", () => {
    const { report, html } = renderReport(ALL_THREE_SIZED);
    const sized = report.findings.find((f) => f.impact.kind === "estimate");
    assert.ok(sized);
    const { low, high, currency } = sized.impact.basis.result;
    assert.ok(high > low);
    assert.ok(html.includes(formatImpactRange(sized.impact.basis.result)));
    assert.match(html, new RegExp(`${currency} ${low}\\b`));
    assert.match(html, new RegExp(`${currency} ${high}\\b`));
    assert.match(html, /per week/);
    const midpoint = Math.round((low + high) / 2);
    assert.doesNotMatch(html, new RegExp(`${currency} ${midpoint}\\b`));
    assert.doesNotMatch(html, /per (year|annum|month)|annual/i);
    assert.doesNotMatch(html, new RegExp(`${low * 52}|${high * 52}`));
    assert.equal(count(html, /data-impact="estimate"/g), 1);
    assert.equal(count(html, /data-impact="unknown"/g), 2);
  });

  test("a low of zero is shown as zero, not hidden", () => {
    const html = formatImpactRange({
      low: 0, high: 40, currency: "EUR", period: "week", rounding_rule: "outward_to_whole_currency_unit",
    });
    assert.equal(html, "Between EUR 0 and EUR 40 per week");
  });

  test("both confidences appear separately, never as a score or percentage", () => {
    const { report, html } = renderReport({ ...ALL_THREE_SIZED, q5_miss_visibility: "sometimes" });
    const sized = report.findings.find((f) => f.impact.kind === "estimate");
    assert.match(html, new RegExp(`data-finding-confidence="${sized.finding.finding_confidence}"[^>]*>In the finding: ${CONFIDENCE_LABELS[sized.finding.finding_confidence]}\\.`));
    assert.match(html, new RegExp(`data-size-confidence="${sized.impact.basis.size_confidence}"[^>]*>In the size: ${CONFIDENCE_LABELS[sized.impact.basis.size_confidence]}\\.`));
    assert.equal(count(html, /data-finding-confidence=/g), 3);
    assert.equal(count(html, /data-size-confidence=/g), 1);
    // The cap is displayed (§87.3).
    assert.equal(sized.finding.confidence_cap_reason, "q5_partial_miss_visibility");
    assert.ok(unescape(html).includes(CAP_REASON_LABELS.q5_partial_miss_visibility));
    assert.doesNotMatch(html, /\d+(\.\d+)?\s?%/);
    assert.doesNotMatch(html, /confidence score/i);
  });

  test("assumptions render inline, verbatim, on the sized finding", () => {
    const { report, html } = renderReport(ALL_THREE_SIZED);
    const sized = report.findings.find((f) => f.impact.kind === "estimate");
    assert.match(html, /data-assumptions/);
    for (const a of sized.impact.basis.assumptions) {
      assert.ok(unescape(html).includes(a.display_text), a.code);
    }
  });

  test("evidence is the owner's own answer, labelled, beside its question", () => {
    const { report, html } = renderReport(ALL_THREE_SIZED);
    for (const f of report.findings) {
      for (const ref of f.finding.evidence) {
        const q = SCAN_QUESTIONS.find((q) => q.id === ref.question_id);
        assert.ok(unescape(html).includes(q.wording), q.id);
        assert.match(html, new RegExp(`data-evidence="${ref.question_id}"[^>]*>${answerLabel(ref.raw_answer)}<`));
      }
    }
    assert.match(html, /\(your answer\)/);
  });

  test("'What you told us' lists all nine questions, with 'Not answered' for an absent optional", () => {
    const { html } = renderReport(ALL_THREE);
    for (const q of SCAN_QUESTIONS) assert.match(html, new RegExp(`data-answer="${q.id}"`));
    assert.match(html, /data-answer="q8_typical_job_value"[^>]*>Not answered</);
    assert.match(html, /data-answer="q4_unanswered_per_week"[^>]*>4</);
  });

  test("the report adds no forbidden wording of its own", () => {
    for (const patch of [{}, ALL_THREE, ALL_THREE_SIZED]) {
      const { report, html } = renderReport(patch);
      // Only what the SURFACE adds is judged here. The engine's own
      // fixed strings are pinned, and swept, by the recommendation
      // suite ("use it without buying anything" is canonical text).
      let text = unescape(html.replace(/<[^>]+>/g, " "));
      for (const f of report.findings) {
        const rec = f.recommendation;
        for (const s of [
          rec.headline,
          rec.why_it_matters,
          rec.next_step,
          rec.success_criterion.wording,
          rec.free_tool_handoff?.label ?? "",
          ...(f.impact.kind === "estimate" ? f.impact.basis.assumptions.map((a) => a.display_text) : []),
        ]) {
          if (s) text = text.split(s).join(" ");
        }
      }
      for (const re of [
        /we (observed|saw|measured|found|noticed)/i,
        /you are losing|you're losing|you (have )?lost/i,
        /most businesses|businesses like yours|industry|average|benchmark/i,
        /\d+(\.\d+)?\s?%/,
        /per (year|annum|month)|annual/i,
        /guarantee|don't miss out|limited time|act now/i,
        /buy|purchase|sign ?up|subscribe|upgrade|free trial|start (a|your) trial|pricing|per month/i,
      ]) {
        assert.doesNotMatch(text, re, `forbidden: ${re}`);
      }
    }
  });
});

// ── 5. next_step, recommended_product and free_tool_handoff stay three things ──

describe("product and handoff are rendered exactly as carried, and separately", () => {
  test("enquiry.no_followup: no product element, no handoff element", () => {
    const { html } = renderReport({ q6_followup: "nothing_planned" });
    assert.equal(SCAN_RECOMMENDATIONS["enquiry.no_followup"].recommended_product, null);
    assert.equal(count(html, /data-product=/g), 0);
    assert.equal(count(html, /data-handoff/g), 0);
    assert.equal(count(html, /data-next-step/g), 1);
    assert.doesNotMatch(html, /Remy/);
  });

  test("enquiry.unanswered: the neutral Remy attribution and no handoff", () => {
    const { html } = renderReport({ q4_unanswered_per_week: { kind: "count", value: 3 } });
    assert.equal(count(html, /data-product="remy"/g), 1);
    assert.ok(unescape(html).includes(PRODUCT_ATTRIBUTION.remy));
    assert.equal(count(html, /data-handoff/g), 0);
  });

  test("booking.friction: exactly one Setup Kit link, href byte-equal to the canonical handoff, plus the attribution", () => {
    const { html } = renderReport({ q7_messages_to_book: "more_than_three" });
    assert.equal(count(html, /data-handoff/g), 1);
    const hrefs = [...html.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(hrefs, [SETUP_KIT_HANDOFF.href]);
    assert.equal(SETUP_KIT_HANDOFF.href, "/free-tools/ai-receptionist-setup-kit");
    assert.doesNotMatch(hrefs[0], /[?#]/);
    assert.ok(unescape(html).includes(SETUP_KIT_HANDOFF.label));
    assert.equal(count(html, /data-product="remy"/g), 1);
    // Three elements, in the delivered structure: next step, then handoff, then attribution.
    assert.ok(html.indexOf("data-next-step") < html.indexOf("data-handoff"));
    assert.ok(html.indexOf("data-handoff") < html.indexOf('data-product="remy"'));
  });

  test("the attribution is neutral: it names where the answer lives and asks for nothing", () => {
    assert.match(PRODUCT_ATTRIBUTION.remy, /Remy/);
    assert.doesNotMatch(PRODUCT_ATTRIBUTION.remy, /buy|trial|upgrade|subscribe|sign ?up|pricing|now|today|guarantee/i);
    // Rendered as text, not as a link or a button.
    const { html } = renderReport({ q4_unanswered_per_week: { kind: "count", value: 3 } });
    assert.doesNotMatch(html, /data-product="remy"[^>]*>\s*<(a|button)/);
  });
});

// ── 6. The structural boundary ────────────────────────────────────

describe("the surface cannot persist, fetch, reach a provider, inject HTML or route on Q1/Q2", () => {
  const importsOf = (file) =>
    read(file)
      .split(/\r?\n/)
      .filter((l) => /^\s*import\s/.test(l) || /^\s*}?\s*from\s+["']/.test(l))
      .join("\n");

  test("no Remy, provider, database, model or email import", () => {
    for (const file of [...SURFACE_FILES, HUB]) {
      assert.doesNotMatch(
        importsOf(file),
        /supabase|openai|resend|vapi|googleapis|leadCapture|lib\/voice|availability|calendarSync|integrations|lib\/email|@vercel|analytics|posthog|segment/i,
        `${file} imports something it must not`
      );
    }
  });

  test("the only non-framework imports are the scan modules and the surface's own files", () => {
    // A-1 (organic discoverability) added the two pure site modules — the
    // public-route inventory and the truthful JSON-LD builder — which
    // tests/organicDiscoverability.test.mjs proves import nothing but
    // `next` types and each other. Extended, not loosened: every other
    // specifier is still refused.
    for (const file of SURFACE_FILES) {
      const specifiers = (read(file).match(/from\s+["']([^"']+)["']/g) ?? []).map((s) =>
        s.replace(/from\s+["']|["']/g, "")
      );
      for (const s of specifiers) {
        assert.match(
          s,
          /^(react|next\/link|next|@\/lib\/freetools\/scan(Types|Questions|Validation|Findings|LostRevenue|Recommendations)|\.\/ScanClient|@\/app\/free-tools\/business-opportunity-scan\/scanPresentation|@\/lib\/site\/(publicRoutes|structuredData))$/,
          `${file} imports ${s}`
        );
      }
    }
  });

  test("no storage, cookie, query-string, identifier or network API", () => {
    for (const file of SURFACE_FILES) {
      const src = code(file);
      assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|document\.cookie|caches\./);
      assert.doesNotMatch(src, /useSearchParams|useRouter|searchParams|next\/navigation|URLSearchParams|history\.(push|replace)State/);
      assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon|EventSource/);
      assert.doesNotMatch(src, /crypto\.|randomUUID|Math\.random|nanoid|uuid/);
      assert.doesNotMatch(src, /"use server"|server-only|process\.env/);
    }
  });

  test("no dangerouslySetInnerHTML, and no href built from user input", () => {
    for (const file of SURFACE_FILES) {
      const src = code(file);
      assert.doesNotMatch(src, /dangerouslySetInnerHTML|innerHTML|eval\(|new Function/);
    }
    const client = code(`${SURFACE_DIR}/ScanClient.tsx`);
    const hrefs = [...client.matchAll(/href=\{([^}]+)\}|href="([^"]+)"/g)].map((m) => m[1] ?? m[2]);
    for (const h of hrefs) {
      assert.ok(
        h === "/free-tools" || h === "recommendation.free_tool_handoff.href",
        `unexpected href source: ${h}`
      );
    }
  });

  test("the client contains no question id at all — every question is handled by kind", () => {
    const client = code(`${SURFACE_DIR}/ScanClient.tsx`);
    for (const q of SCAN_QUESTIONS) {
      assert.doesNotMatch(client, new RegExp(q.id), `${q.id} appears in ScanClient.tsx`);
    }
  });

  test("no Q1/Q2 decision seam anywhere on the surface", () => {
    for (const file of SURFACE_FILES) {
      const lines = code(file).split(/\r?\n/);
      for (const line of lines) {
        if (!/q1_channels|q2_reachable/.test(line)) continue;
        // A question id may only ever appear as a data key or type
        // member, never inside a condition or a ternary.
        assert.doesNotMatch(line, /\bif\b|\?|&&|\|\||switch|===|!==/, `${file}: ${line.trim()}`);
      }
    }
    // The report never reads the answers to choose what to show: the
    // product and the handoff come from the recommendation object only.
    const client = code(`${SURFACE_DIR}/ScanClient.tsx`);
    assert.match(client, /recommendation\.recommended_product/);
    assert.match(client, /recommendation\.free_tool_handoff/);
    assert.doesNotMatch(client, /answers\.q|answers\[["']/);
  });

  test("the report is built by the shipped engine and the as-of instants are read once, here", () => {
    const client = code(`${SURFACE_DIR}/ScanClient.tsx`);
    assert.match(client, /buildScanReport\(/);
    assert.match(client, /validateScanAnswers\(/);
    assert.equal(count(client, /new Date\(\)/g), 1);
    // Nothing recomputes what the engine decided.
    assert.doesNotMatch(client, /deriveFindings|computeLostRevenue|recommendFor|recomputeFromBasis|\.sort\(/);
    assert.doesNotMatch(code(`${SURFACE_DIR}/scanPresentation.ts`), /deriveFindings|computeLostRevenue|recommendFor|recomputeFromBasis/);
  });

  test("the six shipped scan modules and their boundary suite are not what this PR changes", () => {
    // The scan modules import nothing from the app segment.
    for (const m of ["scanTypes", "scanQuestions", "scanValidation", "scanFindings", "scanLostRevenue", "scanRecommendations"]) {
      assert.doesNotMatch(importsOf(`src/lib/freetools/${m}.ts`), /app\/free-tools|business-opportunity-scan|react/i);
    }
  });

  test("the hub links to the scan by its canonical path and does not change the Setup Kit entry", () => {
    const hub = read(HUB);
    assert.match(hub, /href: "\/free-tools\/business-opportunity-scan"/);
    assert.match(hub, /href: "\/free-tools\/ai-receptionist-setup-kit"/);
    assert.match(hub, /Start setup →/);
  });

  test("save a copy is the browser's own print pipeline", () => {
    const client = code(`${SURFACE_DIR}/ScanClient.tsx`);
    assert.match(client, /window\.print\(\)/);
    assert.doesNotMatch(client, /jspdf|pdfkit|html2canvas|puppeteer|blob:|download=/i);
    const { html } = renderReport(ALL_THREE_SIZED);
    assert.match(html, /ft-print-only ft-print-header/);
    assert.match(html, /ft-doc-notice/);
  });
});

// ── 7. PR D — the diagnosis layer on the page ─────────────────────
//
// The same discipline as the rest of this suite: the surface renders
// what the pure modules delivered, in the order delivered, and adds no
// judgement of its own. What is new is that there are now four more
// things it could invent, so each one is checked against the object
// that produced it rather than against a sentence.

describe("every PR D code the surface can be handed has a label", () => {
  test("every stage id, state, assessment and not-established reason is named", () => {
    const src = read("src/lib/freetools/scanTypes.ts");
    const members = (typeName) => {
      const union = src.match(new RegExp(`export type ${typeName} =([\\s\\S]*?);`));
      assert.ok(union, `${typeName} is not declared where expected`);
      return (union[1].match(/"[^"]+"/g) ?? []).map((s) => s.slice(1, -1));
    };

    for (const id of members("ScanFunnelStageId")) {
      assert.equal(typeof STAGE_LABELS[id], "string", `no label for stage ${id}`);
      assert.ok(STAGE_LABELS[id].length > 0);
    }
    for (const state of members("ScanStageState")) {
      assert.equal(typeof STAGE_STATE_LABELS[state], "string", `no label for state ${state}`);
    }
    for (const assessment of members("ScanStageAssessment")) {
      assert.equal(
        typeof STAGE_ASSESSMENT_LABELS[assessment],
        "string",
        `no label for assessment ${assessment}`
      );
    }
    for (const reason of members("ScanStageNotEstablishedReason")) {
      assert.equal(
        typeof STAGE_NOT_ESTABLISHED_LABELS[reason],
        "string",
        `no label for reason ${reason}`
      );
    }
    for (const kind of members("ScanStageKind")) {
      assert.equal(typeof STAGE_KIND_LABELS[kind], "string", `no label for kind ${kind}`);
    }
    for (const impactClass of members("ScanImpactClass")) {
      assert.equal(
        typeof IMPACT_CLASS_LABELS[impactClass],
        "string",
        `no label for impact class ${impactClass}`
      );
    }
    for (const blocks of members("ScanEvidenceGapBlocks")) {
      assert.equal(typeof GAP_BLOCKS_LABELS[blocks], "string", `no label for blocks ${blocks}`);
    }
    for (const gain of members("ScanInformationGain")) {
      assert.equal(
        typeof INFORMATION_GAIN_LABELS[gain],
        "string",
        `no label for information gain ${gain}`
      );
    }
    for (const band of members("ScanGapEffortBand")) {
      assert.equal(typeof GAP_EFFORT_LABELS[band], "string", `no label for effort band ${band}`);
    }
    for (const relation of members("ScanDependencyRelation")) {
      assert.equal(
        typeof DEPENDENCY_RELATION_LABELS[relation],
        "string",
        `no label for relation ${relation}`
      );
    }
    for (const rule of members("ScanDependencyRuleCode")) {
      assert.equal(typeof DEPENDENCY_RULE_LABELS[rule], "string", `no label for rule ${rule}`);
    }
  });
});

describe("the funnel section renders the engine's stages, in order", () => {
  test("five stages, in position order, each with its own marker", () => {
    const { report, html } = renderReport(ALL_THREE_SIZED);
    const positions = report.funnel.stages.map((s) => html.indexOf(`data-stage="${s.stage_id}"`));
    assert.ok(positions.every((p) => p >= 0), "a stage is missing from the page");
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  });

  test("each stage renders the assessment the engine gave it", () => {
    const { report, html } = renderReport({ q7_messages_to_book: "not_sure" });
    for (const stage of report.funnel.stages) {
      assert.match(
        html,
        new RegExp(`data-stage="${stage.stage_id}" data-stage-assessment="${stage.assessment}"`)
      );
    }
  });

  test("adequacy is always qualified as being what the owner told us", () => {
    const { html } = renderReport();
    const label = STAGE_ASSESSMENT_LABELS.appears_adequate;
    assert.match(label, /^From what you told us/);
    assert.ok(unescape(html).includes(label));
  });

  test("a non-assessable stage gets its own note and no verdict", () => {
    const { html } = renderReport(ALL_THREE_SIZED);
    assert.match(html, /data-stage="enquiry_received" data-stage-assessment="not_assessed"/);
    assert.match(html, /data-stage="work_booked" data-stage-assessment="not_assessed"/);
    assert.ok(unescape(html).includes(STAGE_NOT_ASSESSED_NOTE.enquiry_received));
    assert.ok(unescape(html).includes(STAGE_NOT_ASSESSED_NOTE.work_booked));
    // And never the adequacy claim.
    assert.equal(count(html, /data-stage-assessment="appears_adequate"/g), 0);
  });

  test("a stage that could not be established says why, verbatim", () => {
    const { report, html } = renderReport({ q6_followup: "not_sure" });
    const stage = report.funnel.stages.find((s) => s.stage_id === "enquiry_followed_up");
    assert.equal(stage.not_established_reason, "owner_not_sure");
    assert.match(html, /data-stage-reason="owner_not_sure"/);
    assert.ok(
      unescape(html).includes(STAGE_NOT_ESTABLISHED_LABELS.owner_not_sure)
    );
  });
});

describe("the priority section renders the ordering and its reasons", () => {
  test("each priority appears once, in the engine's order, with its reason verbatim", () => {
    const { report, html } = renderReport(ALL_THREE_SIZED);
    assert.equal(report.prioritisation.length, 3);
    const positions = report.prioritisation.map((p) =>
      html.indexOf(`data-priority="${p.position}"`)
    );
    assert.ok(positions.every((p) => p >= 0));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
    for (const p of report.prioritisation) {
      assert.ok(unescape(html).includes(p.reason_wording), `missing reason: ${p.reason_code}`);
      assert.match(html, new RegExp(`data-priority-reason="${p.reason_code}"`));
    }
  });

  test("the order-not-cause line is always present beside the ordering", () => {
    const { html } = renderReport(ALL_THREE_SIZED);
    assert.match(html, /data-order-not-cause/);
    assert.ok(unescape(html).includes(PRIORITY_ORDER_NOT_CAUSE));
  });

  test("the earliest leak is rendered with its stage and its qualifications", () => {
    const { report, html } = renderReport({ q7_messages_to_book: "more_than_three" });
    assert.equal(report.earliest_leak.stage_id, "time_agreed");
    assert.match(html, /data-earliest-leak="time_agreed"/);
    for (const sentence of earliestLeakSentences(report.earliest_leak)) {
      assert.ok(unescape(html).includes(sentence), `missing: ${sentence}`);
    }
    assert.ok(
      unescape(html).includes("does not look like the immediate problem"),
      "the adequate-before-it clause is missing"
    );
  });

  test("an unestablished earlier stage produces the honesty clause", () => {
    const { report, html } = renderReport({
      q4_unanswered_per_week: { kind: "not_sure" },
      q7_messages_to_book: "more_than_three",
    });
    assert.deepEqual(report.earliest_leak.earlier_stages_not_established, ["enquiry_answered"]);
    assert.ok(
      unescape(html).includes("not necessarily the earliest point where work is being lost")
    );
  });

  test("the finding cards keep their delivered order and gain a priority line", () => {
    const { report, html } = renderReport(ALL_THREE_SIZED);
    // Unchanged from before PR D: cards follow report.findings.
    const cards = report.findings.map((f) =>
      html.indexOf(`data-condition="${f.finding.condition}"`)
    );
    assert.deepEqual(cards, [...cards].sort((a, b) => a - b));
    for (const p of report.prioritisation) {
      assert.match(html, new RegExp(`data-priority-position="${p.position}"`));
    }
    assert.ok(unescape(html).includes("Priority 1 of 3"));
  });
});

describe("dependencies and evidence gaps render what the engine produced", () => {
  test("a two-finding report renders exactly its one dependency, verbatim", () => {
    const { report, html } = renderReport({
      q6_followup: "nothing_planned",
      q7_messages_to_book: "more_than_three",
    });
    assert.equal(report.dependencies.length, 1);
    assert.equal(count(html, /data-dependency=/g), 1);
    assert.match(html, /data-dependency-rule="stage_order"/);
    assert.ok(unescape(html).includes(report.dependencies[0].wording));
  });

  test("a one-finding report renders no dependency section at all", () => {
    const { report, html } = renderReport({ q6_followup: "nothing_planned" });
    assert.deepEqual(report.dependencies, []);
    assert.equal(count(html, /data-dependencies/g), 0);
  });

  test("every gap is rendered with its gain, its route to closing it and its effort", () => {
    const { report, html } = renderReport({
      q4_unanswered_per_week: { kind: "count", value: 3 },
      q5_miss_visibility: "sometimes",
    });
    assert.ok(report.evidence_gaps.length > 0);
    for (const gap of report.evidence_gaps) {
      assert.match(html, new RegExp(`data-gap="${gap.gap_code}"`));
      assert.ok(unescape(html).includes(gap.wording), `missing gap wording: ${gap.gap_code}`);
      assert.ok(
        unescape(html).includes(INFORMATION_GAIN_LABELS[gap.expected_information_gain])
      );
      assert.ok(unescape(html).includes(GAP_EFFORT_LABELS[gap.effort_band]));
    }
  });

  test("no gap section on a report with no gaps", () => {
    const { report, html } = renderReport({ q6_followup: "nothing_planned" });
    assert.deepEqual(report.evidence_gaps, []);
    assert.equal(count(html, /data-gaps/g), 0);
  });

  test("the impact class is shown beside the impact, and never replaces it", () => {
    const { report, html } = renderReport(ALL_THREE_SIZED);
    for (const entry of report.findings) {
      assert.match(html, new RegExp(`data-impact-class="${entry.impact_class.impact_class}"`));
      assert.ok(unescape(html).includes(entry.impact_class.wording));
    }
    // The shipped impact rendering is untouched.
    assert.match(html, /data-impact="estimate"/);
    assert.match(html, /data-impact="unknown"/);
    assert.match(html, /data-assumptions/);
  });

  test("the footer names every rule-set version, each from its own field", () => {
    // PR E added the relation rules alongside the other three, and PR F
    // the explanation rules beside those. The
    // assertion stays an EXACT match on the whole line and is extended
    // rather than loosened: each version is read from its own report
    // field, so one sharing another's constant would still fail.
    const { report, html } = renderReport(ALL_THREE_SIZED);
    assert.ok(
      unescape(html).includes(
        `Question set ${report.question_set_version}, rules ${report.rule_set_version}, ordering rules ${report.prioritisation_rule_set_version}, relation rules ${report.cluster_rule_set_version}, explanation rules ${report.hypothesis_rule_set_version}.`
      )
    );
  });
});

describe("the PR D sections add no persistence, no network and no decision", () => {
  test("the surface still holds no rule about stages, ordering or gaps", () => {
    const client = code(`${SURFACE_DIR}/ScanClient.tsx`);
    // No stage table, no comparator, no gap table on the page.
    assert.doesNotMatch(client, /SCAN_FUNNEL_STAGES|stageForCondition|prioritise\(|deriveDependencies\(|deriveEvidenceGaps\(|classifyImpact\(/);
    // And it reads the report's own fields rather than recomputing them.
    assert.match(client, /report\.funnel/);
    assert.match(client, /report\.prioritisation/);
    assert.match(client, /report\.dependencies/);
    assert.match(client, /report\.evidence_gaps/);
  });

  test("the new sections introduce no storage, fetch or identifier", () => {
    for (const file of SURFACE_FILES) {
      assert.doesNotMatch(
        code(file),
        /localStorage|sessionStorage|document\.cookie|indexedDB|fetch\(|randomUUID|crypto\./,
        `${file} reaches for something the scan surface must not`
      );
    }
  });

  test("no PR D section renders raw HTML", () => {
    for (const file of SURFACE_FILES) {
      assert.doesNotMatch(code(file), /dangerouslySetInnerHTML/);
    }
  });
});

// ── 8. PR E — clusters on the page ────────────────────────────────
//
// No new section: clusters reuse "How these relate", which already
// exists and already renders only where there are two findings to
// relate. What is checked here is that the page states exactly what
// the engine established — one line per established relation, and one
// sentence covering every pair it did not relate.

describe("every PR E code the surface can be handed has a label", () => {
  test("every relation and every rule code is named", () => {
    const src = read("src/lib/freetools/scanTypes.ts");
    const members = (typeName) => {
      const union = src.match(new RegExp(`export type ${typeName} =([\\s\\S]*?);`));
      assert.ok(union, `${typeName} is not declared where expected`);
      return (union[1].match(/"[^"]+"/g) ?? []).map((s) => s.slice(1, -1));
    };
    for (const relation of members("ScanClusterRelation")) {
      assert.equal(
        typeof CLUSTER_RELATION_LABELS[relation],
        "string",
        `no label for relation ${relation}`
      );
    }
    for (const rule of members("ScanClusterRuleCode")) {
      assert.equal(typeof CLUSTER_RULE_LABELS[rule], "string", `no label for rule ${rule}`);
    }
  });
});

describe("clusters render inside the existing relate section", () => {
  test("an established relation renders one line, with its wording verbatim", () => {
    const { report, html } = renderReport(ALL_THREE_SIZED);
    const sequential = report.clusters.filter(
      (c) => c.relation === "sequential_in_one_process"
    );
    assert.equal(sequential.length, 1);
    assert.equal(count(html, /data-cluster="sequential_in_one_process"/g), 1);
    assert.match(html, /data-cluster-rule="adjacent_funnel_stages"/);
    assert.ok(unescape(html).includes(sequential[0].wording));
  });

  test("independent pairs get ONE sentence, never a row each", () => {
    const { report, html } = renderReport(ALL_THREE_SIZED);
    const independent = report.clusters.filter((c) => c.relation === "independent");
    assert.equal(independent.length, 2);
    // Two independent pairs, one sentence, and no row for either.
    assert.equal(count(html, /data-clusters-none-established/g), 1);
    assert.equal(count(html, /data-cluster="independent"/g), 0);
    assert.ok(unescape(html).includes(CLUSTERS_NONE_ESTABLISHED_WORDING));
  });

  test("the summary refuses to claim the findings are unrelated", () => {
    assert.match(CLUSTERS_NONE_ESTABLISHED_WORDING, /not the same as knowing they are separate/);
    assert.doesNotMatch(CLUSTERS_NONE_ESTABLISHED_WORDING, /they are unrelated\.|are separate problems/i);
  });

  test("no new section is added — clusters live under the existing heading", () => {
    const { html } = renderReport(ALL_THREE_SIZED);
    assert.equal(count(html, /data-dependencies/g), 1);
    const section = html.indexOf("data-dependencies");
    const cluster = html.indexOf('data-cluster="sequential_in_one_process"');
    const dependency = html.indexOf("data-dependency=");
    assert.ok(section >= 0 && cluster > section, "the cluster line is outside the section");
    assert.ok(cluster < dependency, "clusters must precede the dependency rows");
  });

  test("a one-finding report renders no cluster content at all", () => {
    const { report, html } = renderReport({ q6_followup: "nothing_planned" });
    assert.equal(report.findings.length, 1);
    assert.deepEqual(report.clusters, []);
    assert.equal(count(html, /data-cluster/g), 0);
    assert.equal(count(html, /data-clusters-none-established/g), 0);
  });

  test("a zero-findings report renders no cluster content at all", () => {
    const { report, html } = renderReport();
    assert.equal(report.findings.length, 0);
    assert.deepEqual(report.clusters, []);
    assert.equal(count(html, /data-cluster/g), 0);
    assert.equal(count(html, /data-clusters-none-established/g), 0);
  });

  test("a two-finding adjacent report shows the relation and no summary", () => {
    const { report, html } = renderReport({
      q4_unanswered_per_week: { kind: "count", value: 4 },
      q7_messages_to_book: "more_than_three",
    });
    assert.deepEqual(
      report.clusters.map((c) => c.relation),
      ["sequential_in_one_process"]
    );
    assert.equal(count(html, /data-cluster="sequential_in_one_process"/g), 1);
    assert.equal(count(html, /data-clusters-none-established/g), 0);
  });

  test("the surface holds no cluster rule of its own", () => {
    const client = code(`${SURFACE_DIR}/ScanClient.tsx`);
    assert.doesNotMatch(client, /deriveClusters\(|CLUSTER_RULE_LADDER|adjacent_funnel_stages/);
    assert.match(client, /report\.clusters/);
  });

  test("finding cards and their order are untouched by clustering", () => {
    const { report, html } = renderReport(ALL_THREE_SIZED);
    const cards = report.findings.map((f) =>
      html.indexOf(`data-condition="${f.finding.condition}"`)
    );
    assert.deepEqual(cards, [...cards].sort((a, b) => a - b));
    assert.equal(count(html, /data-condition=/g), 3);
  });
});
