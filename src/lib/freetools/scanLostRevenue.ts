// ── Business Opportunity Scan, Phase 1: the Lost Revenue module ───
//
// ONE EXPRESSION. THAT IS THE WHOLE MODULE, AND THE SUBTRACTION IS THE
// POINT (§88.1).
//
// Three sizing expressions were considered and two were REJECTED,
// because §82.1 requires a volume, a conversion or value, AND a
// diagnosed loss mechanism, and neither rejected candidate can supply
// the middle term without inventing it:
//
//   unfollowed enquiries × value — REJECTED. Sizing it needs the share
//     a follow-up would have RECOVERED, and no owner can supply that.
//     "How many would you win back if you called them?" is both
//     leading and unanswerable, and any default would be an invented
//     conversion rate.
//
//   booking opportunities × value — REJECTED. Friction and no-shows are
//     not established losses: a slot may be refilled, a job
//     rescheduled, a customer retained. Treating effort as revenue
//     would count as lost the work the business actually did.
//
// So `enquiry.no_followup` and `booking.friction` are REAL FINDINGS
// WITH IMPACT UNKNOWN, ALWAYS, IN PHASE 1. A finding with a strong
// diagnosis and no number is a good finding (§82.3), and a product that
// must attach a number to everything will invent two thirds of them.
//
// "WE CANNOT SIZE THIS" IS A FIRST-CLASS RESULT, NOT A FAILURE (§82.3).
// Six separate conditions produce it, each with its own code, and none
// of them is a degraded version of a number.
//
// PROHIBITIONS, RESTATED BECAUSE THIS IS WHERE THEY BITE (§88.2): no
// benchmark or industry figure; no model-generated operand; no
// annualisation and no monthly conversion of a weekly answer; no
// lifetime-value multiplier; no compounding; no silent substitution of
// a missing input; and NO POINT ESTIMATE — the result is a range or it
// is unknown.
//
// AND THE ACCEPTANCE TEST: A DISPLAYED NUMBER MUST BE RECOMPUTABLE FROM
// ITS STORED BASIS ALONE, OR IT MAY NOT BE DISPLAYED (§88.4). That is
// what "deterministic" has to mean to be worth claiming, so this module
// ships the recomputation itself — `recomputeFromBasis` — rather than
// asserting reproducibility and leaving it unchecked.
//
// The estimate is `derived_deterministic` over `business_provided`
// operands and is NEVER `observed`. No promotion, adoption or later
// confirmation changes that (§89.4), and a later measured outcome is
// compared against an OBSERVED baseline, never against this estimate
// (§82.5, Part X P39). The frozen basis exists so the estimate can be
// found WRONG — an estimate that cannot be found wrong is worthless to
// the learning layer and dishonest to the customer.

import { SCAN_QUESTION_SET_VERSION } from "@/lib/freetools/scanQuestions";
import type {
  ConversionShare,
  EstimateBasis,
  EstimateOperand,
  EstimateResult,
  LostRevenueUnknownReason,
  MoneyAnswer,
  ScanAnswers,
  ScanAssumption,
  ScanConfidence,
  ScanConfidenceCapReason,
  ScanFinding,
  ScanImpact,
  ScanRunContext,
} from "@/lib/freetools/scanTypes";

/** E1's identity — §88.2. Stored per run, and a change breaks comparability. */
export const E1_EXPRESSION_ID = "lost_revenue.unanswered_enquiries" as const;
export const E1_EXPRESSION_VERSION = "v1" as const;

/** The versioned key, for logs and display. Never parsed back apart. */
export const E1_EXPRESSION_KEY = `${E1_EXPRESSION_ID}.${E1_EXPRESSION_VERSION}`;

/**
 * The rule-set version this sizing obeys.
 *
 * Kept here rather than imported from the finding engine so the two
 * modules stay acyclic: findings may reach sizing, sizing never reaches
 * findings.
 */
export const SCAN_SIZING_RULE_SET_VERSION = "v1";

/**
 * Q9's buckets, FIXED IN THE CONTRACT AND NOT CHOSEN AT RUNTIME
 * (§88.2). They are written here exactly as the architecture states
 * them so two implementations cannot disagree — and so a change to them
 * is a version change rather than a tweak.
 */
export const CONVERSION_BUCKET_RANGES: Record<
  Exclude<ConversionShare, "not_sure">,
  readonly [number, number]
> = {
  most: [0.67, 1.0],
  about_half: [0.4, 0.6],
  a_minority: [0.0, 0.33],
};

/** The narrowest bucket's width. Anything wider caps size confidence. */
const NARROWEST_BUCKET_WIDTH = 0.2;

/**
 * The three assumptions shown with every E1 result (§88.2), in the
 * owner's view and NOT in a footnote (§26, §84.2).
 *
 * The first one says out loud that it is likely to be generous, because
 * it is: a missed caller who rings the next trade is not a customer who
 * was choosing you.
 */
export const E1_ASSUMPTIONS: readonly ScanAssumption[] = [
  {
    code: "assumed.same_conversion",
    source_type: "assumed",
    display_text:
      "We've assumed the enquiries you missed would have become work at about the same rate as the ones you answered. That is likely to be generous — someone who couldn't reach you may well have called someone else.",
  },
  {
    code: "assumed.typical_value",
    source_type: "assumed",
    display_text: "We've used the typical job value you gave us.",
  },
  {
    code: "assumed.owner_estimate",
    source_type: "assumed",
    display_text: "These are your estimates of a typical week, not measurements.",
  },
] as const;

/**
 * The order caps are applied in when two bind at the same level.
 *
 * Fixed so the reported reason is deterministic rather than dependent
 * on evaluation order — the cap is DISPLAYED (§87.3), so which one is
 * displayed has to be a rule.
 */
const CAP_PRECEDENCE: readonly ScanConfidenceCapReason[] = [
  "q5_partial_miss_visibility",
  "q9_wide_conversion_bucket",
  "q8_value_range",
] as const;

const CONFIDENCE_RANK: Record<ScanConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const unknown = (reason: LostRevenueUnknownReason): ScanImpact => ({
  kind: "unknown",
  reason,
});

/**
 * Snap away IEEE-754 dust before rounding outward.
 *
 * 0.67 × 3 × 250 is 502.49999999999994 in binary floating point, and
 * flooring that gives 502 where the arithmetic gives 502.5 → 502. The
 * snap makes the two agree, and it is applied identically in `compute`
 * and in `recomputeFromBasis` so a basis always reproduces its result.
 */
const snap = (n: number): number => Number(n.toFixed(10));

/** Q8's two ends, in the owner's own currency. */
function moneyRange(answer: MoneyAnswer): readonly [number, number] | null {
  if (answer.kind === "amount") return [answer.amount, answer.amount];
  if (answer.kind === "range") return [answer.low, answer.high];
  return null;
}

/**
 * Multiply the operands' low ends and high ends, in the stored order.
 *
 * The order is fixed rather than incidental: floating-point
 * multiplication is not associative, so recomputation must multiply the
 * same values in the same sequence to reproduce the same number.
 */
function evaluate(
  operands: readonly EstimateOperand[]
): { low: number; high: number } {
  let low = 1;
  let high = 1;
  for (const operand of operands) {
    low *= operand.normalised_range[0];
    high *= operand.normalised_range[1];
  }
  return { low, high };
}

/**
 * Round outward, never inward — the low end down, the high end up.
 *
 * Rounding inward would narrow a range to look more precise than the
 * answers support, which is exactly the fabricated precision §43.2
 * forbids.
 */
function roundOutward(low: number, high: number): { low: number; high: number } {
  return { low: Math.floor(snap(low)), high: Math.ceil(snap(high)) };
}

/**
 * §88.3's last condition: a range spanning MORE THAN ONE ORDER OF
 * MAGNITUDE carries no information, and printing it would be precision
 * theatre in the other direction.
 *
 * A low end of zero fails this too, and deliberately: "somewhere
 * between nothing and £900 a week" is not a size. It is why Q9 = "a
 * minority", whose contract bucket starts at 0.0, can never be sized —
 * a consequence of the fixed buckets rather than a rule added here.
 */
function rangeCarriesInformation(low: number, high: number): boolean {
  if (high <= 0) return false;
  if (low <= 0) return false;
  return high <= low * 10;
}

/**
 * Size confidence — separate from finding confidence and NEVER merged
 * with it (§82.4). They can point in opposite directions, and the
 * difference is the honest part: "we are fairly confident you are
 * missing enquiries; we can only size it very roughly" is the ordinary
 * case and has to be expressible.
 *
 * Capped by the widest operand bucket and by Q5 = "sometimes" (§88.2),
 * with the capping reason shown.
 */
function sizeConfidence(
  share: Exclude<ConversionShare, "not_sure">,
  value: MoneyAnswer,
  visibility: ScanAnswers["q5_miss_visibility"]
): { confidence: ScanConfidence; reason: ScanConfidenceCapReason | null } {
  const caps: { level: ScanConfidence; reason: ScanConfidenceCapReason }[] = [];

  const [lo, hi] = CONVERSION_BUCKET_RANGES[share];
  if (snap(hi - lo) > NARROWEST_BUCKET_WIDTH) {
    caps.push({ level: "medium", reason: "q9_wide_conversion_bucket" });
  }
  if (value.kind === "range" && value.low !== value.high) {
    caps.push({ level: "medium", reason: "q8_value_range" });
  }
  if (visibility === "sometimes") {
    caps.push({ level: "low", reason: "q5_partial_miss_visibility" });
  }

  if (caps.length === 0) return { confidence: "high", reason: null };

  const lowest = caps.reduce((a, b) =>
    CONFIDENCE_RANK[b.level] < CONFIDENCE_RANK[a.level] ? b : a
  ).level;
  const binding = CAP_PRECEDENCE.find((r) =>
    caps.some((c) => c.reason === r && c.level === lowest)
  );

  return { confidence: lowest, reason: binding ?? null };
}

/**
 * Size one finding, or say why it cannot be sized.
 *
 * The gate (§88.2): raised only when `enquiry.unanswered` was raised,
 * AND Q5 ≠ "no", AND all three operands are genuinely present.
 *
 * The four answer-level gates below are also enforced by the finding
 * engine, so in a whole-report run they are unreachable. They are kept
 * because this function is callable on its own and because a sizing
 * module that trusts its caller to have checked is a sizing module that
 * will one day be called by something that did not.
 */
export function computeLostRevenue(
  finding: ScanFinding,
  answers: ScanAnswers,
  context: ScanRunContext
): ScanImpact {
  // E1 sizes ONE condition. The other two codes are unknown by
  // contract, always, in Phase 1 — not because an operand is missing,
  // but because no legitimate expression exists for them (§88.1).
  if (finding.condition !== "enquiry.unanswered") {
    return unknown("no_unanswered_finding");
  }

  const q4 = answers.q4_unanswered_per_week;
  if (!q4) return unknown("q4_missing");
  if (q4.kind === "not_sure") return unknown("q4_not_sure");
  if (q4.value === 0) return unknown("q4_zero");

  const q3 = answers.q3_enquiries_per_week;
  if (q3.kind === "count" && q4.value > q3.value) return unknown("q4_exceeds_q3");

  // The owner has no way of knowing a miss happened, so the count is a
  // recollection with no record behind it. It may support a
  // low-confidence finding; IT MAY NOT SUPPORT MONEY (§88.3).
  if (answers.q5_miss_visibility === "no") return unknown("q5_no_miss_visibility");

  const q8 = answers.q8_typical_job_value;
  if (!q8) return unknown("q8_missing");
  if (q8.kind === "not_sure") return unknown("q8_not_sure");

  const q9 = answers.q9_conversion_share;
  if (!q9) return unknown("q9_missing");
  if (q9 === "not_sure") return unknown("q9_not_sure");

  const valueRange = moneyRange(q8);
  if (!valueRange) return unknown("q8_not_sure");

  // The operand order is the expression's order and is fixed:
  // unanswered_per_week × conversion_share × typical_job_value.
  const operands: EstimateOperand[] = [
    {
      operand_id: "q4_unanswered_per_week",
      raw_answer: q4,
      normalised_range: [q4.value, q4.value],
      unit: "enquiries_per_week",
      source_type: "business_provided",
      answered_at: context.answered_at,
    },
    {
      operand_id: "q9_conversion_share",
      raw_answer: q9,
      normalised_range: CONVERSION_BUCKET_RANGES[q9],
      unit: "share_of_answered_enquiries",
      source_type: "business_provided",
      answered_at: context.answered_at,
    },
    {
      operand_id: "q8_typical_job_value",
      raw_answer: q8,
      normalised_range: valueRange,
      // The owner's own currency travels ON the operand, so the
      // displayed currency is recomputable from the basis rather than
      // read back off the result it is meant to verify.
      unit: q8.currency,
      source_type: "business_provided",
      answered_at: context.answered_at,
    },
  ];

  const raw = evaluate(operands);
  const rounded = roundOutward(raw.low, raw.high);
  if (!rangeCarriesInformation(rounded.low, rounded.high)) {
    return unknown("range_spans_more_than_one_order_of_magnitude");
  }

  const { confidence, reason } = sizeConfidence(q9, q8, answers.q5_miss_visibility);

  const basis: EstimateBasis = {
    expression_id: E1_EXPRESSION_ID,
    expression_version: E1_EXPRESSION_VERSION,
    operands,
    assumptions: E1_ASSUMPTIONS,
    result: {
      low: rounded.low,
      high: rounded.high,
      currency: q8.currency,
      // Per week — the same period the owner answered in. NEVER
      // annualised, and never converted to a month (§88.2).
      period: "week",
      rounding_rule: "outward_to_whole_currency_unit",
    },
    size_confidence: confidence,
    size_confidence_cap_reason: reason,
    question_set_version: SCAN_QUESTION_SET_VERSION,
    rule_set_version: SCAN_SIZING_RULE_SET_VERSION,
    computed_at: context.computed_at,
    source_type: "derived_deterministic",
  };

  return { kind: "estimate", basis };
}

/**
 * Recompute a stored estimate from its basis ALONE — §88.4's acceptance
 * test made executable.
 *
 * It reads the operands, the stored rounding rule and the currency
 * carried on the value operand. It does NOT read the stored result's
 * numbers, which is the only way this can verify them.
 */
export function recomputeFromBasis(basis: EstimateBasis): EstimateResult {
  const raw = evaluate(basis.operands);
  const rounded = roundOutward(raw.low, raw.high);
  const valueOperand = basis.operands.find(
    (o) => o.operand_id === "q8_typical_job_value"
  );

  return {
    low: rounded.low,
    high: rounded.high,
    currency: valueOperand ? valueOperand.unit : "",
    period: "week",
    rounding_rule: basis.result.rounding_rule,
  };
}

/**
 * Whether a basis reproduces its own stored result.
 *
 * IF THIS IS FALSE, THE NUMBER MAY NOT BE SHOWN (§88.4). The rule is
 * not "show it with a warning" — a figure that cannot be reproduced
 * from the operands beside it is wrong, and displaying it would make
 * the audit trail a decoration.
 */
export function basisReproducesResult(basis: EstimateBasis): boolean {
  const recomputed = recomputeFromBasis(basis);
  return (
    recomputed.low === basis.result.low &&
    recomputed.high === basis.result.high &&
    recomputed.currency === basis.result.currency &&
    recomputed.period === basis.result.period &&
    recomputed.rounding_rule === basis.result.rounding_rule
  );
}
