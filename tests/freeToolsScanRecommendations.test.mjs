// The Scan's Phase 1 recommendation layer: one fixed, owner-actionable
// next step per finding, and nothing a model wrote.
//
// The properties worth testing are not "does it recommend things" but:
//
//   THE RECOMMENDATION IS A FUNCTION OF THE CONDITION AND NOTHING ELSE.
//   Not the impact, not the estimate's size, not either confidence, not
//   a cap reason. A sized and an unsized instance of the same condition
//   receive the same recommendation, because a next step that changed
//   with the size of a number would be a sales figure steering advice.
//
//   THE THRESHOLD NEVER INVENTS A TARGET (D-B1). Success is improvement
//   in the stated direction from the OWNER'S OWN STATED ANSWER — never
//   from the estimate, a benchmark or a midpoint. An owner who said
//   "not sure" has no baseline, and the wording says so instead of
//   quietly supplying one.
//
//   AT LEAST ONE RECOMMENDATION ROUTES TO NO PAID PRODUCT. The
//   anti-funnel invariant: a scan that routes every problem to Remy is
//   an advertisement wearing a diagnostic's clothes (§26).
//
//   THE FREE-TOOL HANDOFF IS A LINK. No answers, no pre-fill, no token,
//   no state, no consent implied.
//
//   ALL OWNER-FACING TEXT IS FIXED DATA, pinned here verbatim.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { buildScanReport, deriveFindings } from "@/lib/freetools/scanFindings";
import {
  SCAN_RECOMMENDATIONS,
  SCAN_REVIEW_WINDOW_DAYS,
  SETUP_KIT_HANDOFF,
  recommendFor,
} from "@/lib/freetools/scanRecommendations";
import { SCAN_CONDITION_ORDER, SCAN_RULE_SET_VERSION } from "@/lib/freetools/scanTypes";
import { validateScanAnswers } from "@/lib/freetools/scanValidation";

const CONTEXT = {
  answered_at: "2026-09-11T10:00:00.000Z",
  computed_at: "2026-09-11T10:00:01.000Z",
};

/** Answers that raise nothing at all. */
const QUIET = {
  q1_channels: ["phone"],
  q2_reachable: "working_hours",
  q3_enquiries_per_week: { kind: "count", value: 20 },
  q4_unanswered_per_week: { kind: "count", value: 0 },
  q5_miss_visibility: "yes_always",
  q6_followup: "within_a_day",
  q7_messages_to_book: "one",
};

/** Raises all three conditions, unsized (no Q8, no Q9). */
const ALL_THREE = {
  q4_unanswered_per_week: { kind: "count", value: 4 },
  q6_followup: "nothing_planned",
  q7_messages_to_book: "more_than_three",
};

/** The same three, with everything E1 needs to produce an estimate. */
const ALL_THREE_SIZED = {
  ...ALL_THREE,
  q8_typical_job_value: { kind: "amount", amount: 250, currency: "EUR" },
  q9_conversion_share: "about_half",
};

function answers(patch = {}) {
  const result = validateScanAnswers({ ...QUIET, ...patch });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return result.answers;
}

const report = (patch) => buildScanReport(answers(patch), CONTEXT);

function recommendationFor(patch, condition) {
  const entry = report(patch).findings.find((f) => f.finding.condition === condition);
  assert.ok(entry, `${condition} was not raised`);
  return entry.recommendation;
}

/** Every owner-facing string a recommendation carries. */
function ownerText(rec) {
  return [
    rec.headline,
    rec.why_it_matters,
    rec.next_step,
    rec.success_criterion.wording,
    rec.free_tool_handoff?.label ?? "",
  ].join("\n");
}

// ── 1. Shape and determinism ───────────────────────────────────────

describe("every rendered finding carries exactly one recommendation", () => {
  test("one recommendation per finding, keyed to that finding's condition", () => {
    const r = report(ALL_THREE_SIZED);
    assert.equal(r.findings.length, 3);
    for (const entry of r.findings) {
      assert.ok(entry.recommendation, `${entry.finding.condition} has no recommendation`);
      assert.equal(entry.recommendation.condition, entry.finding.condition);
      assert.equal(Array.isArray(entry.recommendation), false);
    }
  });

  test("no finding, no recommendation — nothing generic is manufactured", () => {
    const r = report();
    assert.deepEqual(r.findings, []);
    assert.equal("recommendations" in r, false, "the report grew a recommendation list of its own");
  });

  test("the same answers produce deeply equal recommendations across repeated runs", () => {
    const first = report(ALL_THREE_SIZED).findings.map((f) => f.recommendation);
    for (let i = 0; i < 25; i += 1) {
      assert.deepEqual(report(ALL_THREE_SIZED).findings.map((f) => f.recommendation), first);
    }
    assert.equal(
      JSON.stringify(report(ALL_THREE).findings.map((f) => f.recommendation)),
      JSON.stringify(report(ALL_THREE).findings.map((f) => f.recommendation))
    );
  });

  test("the answers object is never mutated", () => {
    const validated = answers(ALL_THREE_SIZED);
    const before = structuredClone(validated);
    buildScanReport(validated, CONTEXT);
    for (const finding of deriveFindings(validated)) recommendFor(finding, validated);
    assert.deepEqual(validated, before);
  });

  test("recommendFor takes the finding and the answers, and nothing else", () => {
    assert.equal(recommendFor.length, 2);
  });

  test("the fixed table covers exactly the three Phase 1 codes", () => {
    assert.deepEqual(Object.keys(SCAN_RECOMMENDATIONS).sort(), [...SCAN_CONDITION_ORDER].sort());
  });
});

// ── 2. Independence from impact and confidence ─────────────────────

describe("the recommendation depends on the condition only", () => {
  test("a sized and an unsized enquiry.unanswered receive the same recommendation", () => {
    const sized = report(ALL_THREE_SIZED).findings[0];
    const unsized = report(ALL_THREE).findings[0];
    assert.equal(sized.impact.kind, "estimate");
    assert.equal(unsized.impact.kind, "unknown");
    // The baseline is read from Q4, which is identical here, so the two
    // recommendations must be identical in every field.
    assert.deepEqual(sized.recommendation, unsized.recommendation);
  });

  test("the estimate's size changes nothing", () => {
    const small = recommendationFor(
      { ...ALL_THREE_SIZED, q8_typical_job_value: { kind: "amount", amount: 10, currency: "EUR" } },
      "enquiry.unanswered"
    );
    const large = recommendationFor(
      { ...ALL_THREE_SIZED, q8_typical_job_value: { kind: "amount", amount: 9000, currency: "EUR" } },
      "enquiry.unanswered"
    );
    assert.deepEqual(small, large);
  });

  test("finding confidence and its cap reason change nothing", () => {
    const high = report({ ...ALL_THREE, q5_miss_visibility: "yes_always" }).findings[0];
    const medium = report({ ...ALL_THREE, q5_miss_visibility: "sometimes" }).findings[0];
    const low = report({ ...ALL_THREE, q5_miss_visibility: "no" }).findings[0];
    assert.equal(high.finding.finding_confidence, "high");
    assert.equal(medium.finding.confidence_cap_reason, "q5_partial_miss_visibility");
    assert.equal(low.finding.confidence_cap_reason, "q5_no_miss_visibility");
    assert.deepEqual(high.recommendation, medium.recommendation);
    assert.deepEqual(medium.recommendation, low.recommendation);
  });

  test("size confidence and its cap reason change nothing", () => {
    const narrow = report(ALL_THREE_SIZED).findings[0];
    const wide = report({
      ...ALL_THREE_SIZED,
      q8_typical_job_value: { kind: "range", low: 100, high: 400, currency: "EUR" },
      q9_conversion_share: "most",
    }).findings[0];
    assert.equal(narrow.impact.kind, "estimate");
    assert.equal(wide.impact.kind, "estimate");
    assert.notEqual(narrow.impact.basis.size_confidence, wide.impact.basis.size_confidence);
    assert.deepEqual(narrow.recommendation, wide.recommendation);
  });

  test("the booking.friction cap (varies a lot) changes the baseline only, never the advice", () => {
    const firm = recommendationFor(ALL_THREE, "booking.friction");
    const varies = recommendationFor(
      { ...ALL_THREE, q7_messages_to_book: "varies_a_lot" },
      "booking.friction"
    );
    const { success_criterion: a, ...restFirm } = firm;
    const { success_criterion: b, ...restVaries } = varies;
    assert.deepEqual(restFirm, restVaries);
    assert.equal(a.metric, b.metric);
    assert.equal(a.direction, b.direction);
    assert.equal(a.threshold_rule, b.threshold_rule);
  });

  test("the fixed table holds no impact, estimate or confidence field", () => {
    for (const fixed of Object.values(SCAN_RECOMMENDATIONS)) {
      assert.doesNotMatch(
        JSON.stringify(fixed),
        /impact|estimate|confidence|cap_reason|expected_effect/i
      );
    }
  });
});

// ── 3. Routing ─────────────────────────────────────────────────────

describe("Phase 1 routing", () => {
  test("enquiry.unanswered routes to Remy", () => {
    const rec = recommendationFor(ALL_THREE, "enquiry.unanswered");
    assert.equal(rec.recommended_product, "remy");
    assert.equal(rec.free_tool_handoff, null);
  });

  test("booking.friction hands off to the Setup Kit, link-only, and names Remy as where the answer lives", () => {
    const rec = recommendationFor(ALL_THREE, "booking.friction");
    assert.equal(rec.recommended_product, "remy");
    assert.deepEqual(rec.free_tool_handoff, SETUP_KIT_HANDOFF);
    // Two separate fields: the handoff is not the product, and the
    // next step is still the owner's own to take.
    assert.notEqual(rec.free_tool_handoff.tool, rec.recommended_product);
  });

  test("enquiry.no_followup routes to no product at all", () => {
    const rec = recommendationFor(ALL_THREE, "enquiry.no_followup");
    assert.equal(rec.recommended_product, null);
    assert.equal(rec.free_tool_handoff, null);
  });

  test("ANTI-FUNNEL: at least one recommendation structurally routes to null", () => {
    const products = Object.values(SCAN_RECOMMENDATIONS).map((r) => r.recommended_product);
    assert.ok(products.includes(null), "every Phase 1 recommendation names a paid product");
  });

  test("the only paid product the table can name is Remy", () => {
    for (const fixed of Object.values(SCAN_RECOMMENDATIONS)) {
      assert.ok([null, "remy"].includes(fixed.recommended_product));
    }
  });
});

// ── 4. The Setup Kit handoff is a link and nothing more ────────────

describe("the free-tool handoff carries no state", () => {
  test("it is exactly a tool id, a path and a label", () => {
    assert.deepEqual(Object.keys(SETUP_KIT_HANDOFF).sort(), ["href", "label", "tool"]);
    assert.equal(SETUP_KIT_HANDOFF.tool, "ai_receptionist_setup_kit");
    assert.equal(SETUP_KIT_HANDOFF.href, "/free-tools/ai-receptionist-setup-kit");
  });

  test("the path carries no query, fragment, token or pre-fill", () => {
    assert.doesNotMatch(SETUP_KIT_HANDOFF.href, /[?#=&]/);
    assert.doesNotMatch(JSON.stringify(SETUP_KIT_HANDOFF), /token|answers|prefill|pre_fill|state|consent|q\d_/i);
  });

  test("the handoff object on a report is byte-identical to the constant — no answers attached", () => {
    const rec = recommendationFor(ALL_THREE_SIZED, "booking.friction");
    assert.equal(JSON.stringify(rec.free_tool_handoff), JSON.stringify(SETUP_KIT_HANDOFF));
  });

  test("the handoff path is the shipped Setup Kit route", () => {
    assert.doesNotThrow(() =>
      readFileSync("src/app/free-tools/ai-receptionist-setup-kit/page.tsx", "utf8")
    );
  });
});

// ── 5. Success criterion and D-B1 ──────────────────────────────────

describe("the success criterion is direction-aware improvement from the stated baseline", () => {
  test("every recommendation carries a criterion with the D-B1 rule and a direction", () => {
    for (const entry of report(ALL_THREE_SIZED).findings) {
      const c = entry.recommendation.success_criterion;
      assert.equal(c.threshold_rule, "improvement_from_stated_baseline");
      assert.ok(["increase", "decrease"].includes(c.direction));
      assert.equal(typeof c.metric, "string");
      assert.equal(typeof c.wording, "string");
      assert.ok(c.wording.length > 0);
    }
  });

  test("the exact metric and direction per condition", () => {
    const by = Object.fromEntries(
      report(ALL_THREE_SIZED).findings.map((f) => [
        f.finding.condition,
        [f.recommendation.success_criterion.metric, f.recommendation.success_criterion.direction],
      ])
    );
    assert.deepEqual(by, {
      "enquiry.unanswered": ["unanswered_enquiries_per_week", "decrease"],
      "enquiry.no_followup": ["answered_enquiries_becoming_work_share", "increase"],
      "booking.friction": ["messages_to_book", "decrease"],
    });
  });

  test("both directions are represented, so the rule is not a hard-coded 'below baseline'", () => {
    const directions = new Set(
      report(ALL_THREE_SIZED).findings.map((f) => f.recommendation.success_criterion.direction)
    );
    assert.deepEqual([...directions].sort(), ["decrease", "increase"]);
  });

  test("the baseline is the owner's raw Q4 answer, not the estimate's result", () => {
    const entry = report(ALL_THREE_SIZED).findings[0];
    assert.equal(entry.impact.kind, "estimate");
    const baseline = entry.recommendation.success_criterion.baseline;
    assert.deepEqual(baseline, {
      question_id: "q4_unanswered_per_week",
      raw_answer: { kind: "count", value: 4 },
      source_type: "business_provided",
    });
    // Nothing from the sizing result appears anywhere in the criterion.
    const serialised = JSON.stringify(entry.recommendation.success_criterion);
    assert.doesNotMatch(serialised, /low|high|currency|EUR|result|expression|basis/);
    assert.equal(serialised.includes(String(entry.impact.basis.result.low)), false);
  });

  test("the increase metric's baseline is the owner's raw Q9 answer", () => {
    const rec = recommendationFor(ALL_THREE_SIZED, "enquiry.no_followup");
    assert.deepEqual(rec.success_criterion.baseline, {
      question_id: "q9_conversion_share",
      raw_answer: "about_half",
      source_type: "business_provided",
    });
  });

  test("not_sure → baseline null, direction retained, wording says a baseline must be established", () => {
    const rec = recommendationFor(
      { ...ALL_THREE, q9_conversion_share: "not_sure" },
      "enquiry.no_followup"
    );
    assert.equal(rec.success_criterion.baseline, null);
    assert.equal(rec.success_criterion.direction, "increase");
    assert.match(rec.success_criterion.wording, /baseline/i);
    assert.match(rec.success_criterion.wording, /first/i);
  });

  test("an unanswered optional baseline question → baseline null, never a substituted number", () => {
    const rec = recommendationFor(ALL_THREE, "enquiry.no_followup");
    assert.equal(rec.success_criterion.baseline, null);
    assert.doesNotMatch(JSON.stringify(rec.success_criterion), /\d/);
  });

  test("'varies a lot' has no position on the messages scale, so the baseline is null", () => {
    const rec = recommendationFor(
      { ...ALL_THREE, q7_messages_to_book: "varies_a_lot" },
      "booking.friction"
    );
    assert.equal(rec.success_criterion.baseline, null);
    assert.equal(rec.success_criterion.direction, "decrease");
    assert.match(rec.success_criterion.wording, /baseline/i);
  });

  test("a stated Q7 position IS the baseline", () => {
    const rec = recommendationFor(ALL_THREE, "booking.friction");
    assert.deepEqual(rec.success_criterion.baseline, {
      question_id: "q7_messages_to_book",
      raw_answer: "more_than_three",
      source_type: "business_provided",
    });
  });

  test("a not_sure Q4 handed straight to the pure function yields null, not a number", () => {
    // enquiry.unanswered can only be raised on a counted Q4, so this
    // reaches the guard directly: the function must still refuse to
    // invent a baseline for an answer that carries no number.
    const finding = deriveFindings(answers(ALL_THREE))[0];
    const withNotSure = answers({ ...ALL_THREE, q4_unanswered_per_week: { kind: "not_sure" } });
    const rec = recommendFor(finding, withNotSure);
    assert.equal(rec.success_criterion.baseline, null);
    assert.equal(rec.success_criterion.direction, "decrease");
  });

  test("NO NUMERIC TARGET IS EVER INVENTED", () => {
    for (const entry of report(ALL_THREE_SIZED).findings) {
      const c = entry.recommendation.success_criterion;
      assert.equal("target" in c, false);
      assert.equal("target_value" in c, false);
      assert.equal("threshold_value" in c, false);
      assert.deepEqual(Object.keys(c).sort(), [
        "baseline",
        "direction",
        "metric",
        "threshold_rule",
        "wording",
      ]);
      // The only number anywhere in a criterion is the owner's own Q4
      // count (question ids such as "q4_…" are stripped before counting).
      const numbers =
        JSON.stringify(c).replace(/"q\d_[a-z_]+"/g, '""').match(/\d+/g) ?? [];
      const own =
        c.baseline?.raw_answer?.kind === "count" ? [String(c.baseline.raw_answer.value)] : [];
      assert.deepEqual(numbers, own);
    }
  });
});

// ── 6. Canonical metadata ──────────────────────────────────────────

describe("provenance and authority metadata", () => {
  test("every recommendation carries the canonical literals", () => {
    for (const entry of report(ALL_THREE_SIZED).findings) {
      const rec = entry.recommendation;
      assert.equal(rec.action_status, "proposed");
      assert.equal(rec.authority_level, "recommend");
      assert.equal(rec.source_type, "derived_deterministic");
      assert.equal(rec.rule_set_version, SCAN_RULE_SET_VERSION);
      assert.equal(rec.review_window_days, 28);
      assert.equal(SCAN_REVIEW_WINDOW_DAYS, 28);
    }
  });

  test("no expected_effect, no review_at, no impact copy — W.2 stays deferred", () => {
    for (const entry of report(ALL_THREE_SIZED).findings) {
      const rec = entry.recommendation;
      assert.equal("expected_effect" in rec, false);
      assert.equal("review_at" in rec, false);
      assert.equal("impact" in rec, false);
      assert.equal("basis" in rec, false);
      assert.equal("estimate" in rec, false);
    }
  });

  test("the recommendation's key set is exactly the reviewed contract", () => {
    for (const entry of report(ALL_THREE_SIZED).findings) {
      assert.deepEqual(Object.keys(entry.recommendation).sort(), [
        "action_status",
        "authority_level",
        "condition",
        "free_tool_handoff",
        "headline",
        "next_step",
        "recommendation_code",
        "recommended_product",
        "review_window_days",
        "rule_set_version",
        "source_type",
        "success_criterion",
        "why_it_matters",
      ]);
    }
  });

  test("recommendation codes are distinct and namespaced under their condition", () => {
    const codes = Object.entries(SCAN_RECOMMENDATIONS).map(([condition, r]) => {
      assert.ok(r.recommendation_code.startsWith(`${condition}.`), r.recommendation_code);
      return r.recommendation_code;
    });
    assert.equal(new Set(codes).size, 3);
  });
});

// ── 7. Owner-facing text ───────────────────────────────────────────

const FORBIDDEN = [
  /you are losing/i,
  /you're losing/i,
  /you lost/i,
  /you have lost/i,
  /losing/i,
  /we observed/i,
  /we saw/i,
  /we found/i,
  /we noticed/i,
  /most businesses/i,
  /businesses like yours/i,
  /industry/i,
  /average/i,
  /benchmark/i,
  /typical(ly)? (business|trade)/i,
  /[€£$]\s?\d/,
  /\d+(\.\d+)?\s?%/,
  /per (year|annum|month)/i,
  /annual/i,
  /guarantee/i,
  /don't miss out/i,
  /limited time/i,
  /act now/i,
  /before it's too late/i,
];

describe("owner-facing text is fixed, plain and non-manipulative", () => {
  test("the exact wording is pinned", () => {
    const u = SCAN_RECOMMENDATIONS["enquiry.unanswered"];
    assert.equal(u.recommendation_code, "enquiry.unanswered.answer_every_enquiry");
    assert.equal(u.headline, "Some enquiries are going unanswered");
    assert.equal(
      u.why_it_matters,
      "You told us that some of the enquiries you get each week are not answered. An enquiry that gets no answer cannot become a booking, and the person who sent it may not try again."
    );
    assert.equal(
      u.next_step,
      "Decide what happens to an enquiry when nobody can take it: who answers, by when, and how — for example a voicemail message that promises a call back within a set time, or a person or service that picks up when you are busy. Then count your unanswered enquiries again at the end of the review window."
    );

    const f = SCAN_RECOMMENDATIONS["enquiry.no_followup"];
    assert.equal(f.recommendation_code, "enquiry.no_followup.follow_up_every_enquiry");
    assert.equal(f.headline, "Enquiries that do not book are not followed up");
    assert.equal(
      f.why_it_matters,
      "You told us that when an enquiry does not turn into a booking, nothing is planned to follow it up. Someone who asked once and heard nothing more has to decide to come back on their own."
    );
    assert.equal(
      f.next_step,
      "Choose one follow-up you will do for every enquiry that does not book — a short message or call within a day — and keep a note of what came of each one. Then look again at how many of your enquiries become work at the end of the review window."
    );

    const b = SCAN_RECOMMENDATIONS["booking.friction"];
    assert.equal(b.recommendation_code, "booking.friction.write_down_booking_rules");
    assert.equal(b.headline, "Agreeing a time takes several messages");
    assert.equal(
      b.why_it_matters,
      "You told us that agreeing an appointment time takes more than three messages, or varies a lot. Every extra exchange is a chance for the customer to drift away, and it is time spent on something other than the work."
    );
    assert.equal(
      b.next_step,
      "Write down the booking rules someone would need in order to pick a time themselves — the days and hours you take work, how long each type of job takes, and how many you can fit in a day — and offer those up front. The free AI Receptionist Setup Kit walks you through writing them down, and you can use it without buying anything."
    );
    assert.equal(SETUP_KIT_HANDOFF.label, "Open the free AI Receptionist Setup Kit");
  });

  test("the success wording is pinned, with and without a baseline", () => {
    assert.equal(
      recommendationFor(ALL_THREE, "enquiry.unanswered").success_criterion.wording,
      "Success is fewer unanswered enquiries in a typical week than the number you gave us."
    );
    assert.equal(
      recommendationFor(ALL_THREE_SIZED, "enquiry.no_followup").success_criterion.wording,
      "Success is a larger share of the enquiries you answer becoming work than the share you gave us."
    );
    assert.equal(
      recommendationFor(ALL_THREE, "enquiry.no_followup").success_criterion.wording,
      "You have not given us the share of the enquiries you answer that become work yet, so a baseline needs to be established first. Success is a larger share of the enquiries you answer becoming work than that baseline."
    );
    assert.equal(
      recommendationFor(ALL_THREE, "booking.friction").success_criterion.wording,
      "Success is fewer messages to agree a time than the number you gave us."
    );
    assert.equal(
      recommendationFor({ ...ALL_THREE, q7_messages_to_book: "varies_a_lot" }, "booking.friction")
        .success_criterion.wording,
      "You told us the number of messages varies a lot, so a baseline needs to be established first. Success is fewer messages to agree a time than that baseline."
    );
    assert.equal(
      recommendFor(
        deriveFindings(answers(ALL_THREE))[0],
        answers({ ...ALL_THREE, q4_unanswered_per_week: { kind: "not_sure" } })
      ).success_criterion.wording,
      "You have not given us a number of unanswered enquiries yet, so a baseline needs to be established first. Success is fewer than that baseline in a typical week."
    );
  });

  test("next_step is non-empty and actionable without buying anything", () => {
    for (const fixed of Object.values(SCAN_RECOMMENDATIONS)) {
      assert.ok(fixed.next_step.trim().length > 40);
      // Each step names something the owner does themselves.
      assert.match(fixed.next_step, /^(Decide|Choose|Write down)/);
      assert.doesNotMatch(fixed.next_step, /\b(buy|purchase|subscribe|sign up|upgrade)\b/i);
    }
  });

  test("no forbidden marketing, certainty, loss or benchmark wording", () => {
    const all = report({
      ...ALL_THREE_SIZED,
    }).findings.map((f) => ownerText(f.recommendation));
    all.push(ownerText(recommendationFor(ALL_THREE, "enquiry.no_followup")));
    all.push(
      ownerText(recommendationFor({ ...ALL_THREE, q7_messages_to_book: "varies_a_lot" }, "booking.friction"))
    );
    for (const text of all) {
      for (const pattern of FORBIDDEN) {
        assert.doesNotMatch(text, pattern, `forbidden wording: ${pattern}`);
      }
    }
  });

  test("the text restates what the owner told us — never what we observed", () => {
    for (const fixed of Object.values(SCAN_RECOMMENDATIONS)) {
      assert.match(fixed.why_it_matters, /^You told us/);
    }
  });

  test("no text is generated: the module holds no template, model or prompt", () => {
    const src = readFileSync("src/lib/freetools/scanRecommendations.ts", "utf8");
    assert.doesNotMatch(src, /prompt|openai|anthropic|generate|complete\(|\$\{[^}]*(headline|why|next_step)/i);
  });
});

// ── 8. Suppression ─────────────────────────────────────────────────

describe("a suppressed finding gets no recommendation", () => {
  test("Q4 > Q3 raises no enquiry.unanswered, so nothing recommends for it", () => {
    const validated = validateScanAnswers({
      ...QUIET,
      q3_enquiries_per_week: { kind: "count", value: 5 },
      q4_unanswered_per_week: { kind: "count", value: 9 },
    });
    assert.equal(validated.valid, true);
    assert.equal(validated.inconsistencies.length, 1);
    const r = buildScanReport(validated.answers, CONTEXT, validated.inconsistencies);
    assert.deepEqual(r.findings, []);
    assert.equal(r.inconsistencies[0].code, "q4_exceeds_q3");
    assert.doesNotMatch(JSON.stringify(r), /recommendation_code|answer_every_enquiry|remy/);
  });

  test("an inconsistency alongside another finding recommends for that finding only", () => {
    const validated = validateScanAnswers({
      ...QUIET,
      q3_enquiries_per_week: { kind: "count", value: 5 },
      q4_unanswered_per_week: { kind: "count", value: 9 },
      q6_followup: "nothing_planned",
    });
    const r = buildScanReport(validated.answers, CONTEXT, validated.inconsistencies);
    assert.deepEqual(
      r.findings.map((f) => f.recommendation.recommendation_code),
      ["enquiry.no_followup.follow_up_every_enquiry"]
    );
  });
});
