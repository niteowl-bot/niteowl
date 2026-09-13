// ── Business Opportunity Scan, PR D: impact classification ────────
//
// "WE CANNOT SIZE THIS" HAS SEVERAL MEANINGS AND HAD ONE VOICE. This
// module gives each of them its own (Part XIV §106).
//
// IT IS PRESENTATION OVER EVIDENCE THAT ALREADY EXISTS. It adds no
// arithmetic, changes no gate, widens no bucket, relaxes no test and
// computes no number. It reads the impact the sizing module already
// produced — the estimate, or the reason code for its absence — and
// says which of four things that is. §82.3 already made UNKNOWN a
// first-class result; this only stops four different results sounding
// identical.
//
// THE CLASSIFIER CANNOT REACH THE OPERANDS, AND THAT IS THE POINT.
// §106's sharpest rule is that `directional` MUST NEVER BE SILENTLY
// UPGRADED TO `quantified` by widening a bucket or relaxing the
// order-of-magnitude test — both exist to refuse precision theatre. A
// function that reads a reason code and nothing else has no way to do
// it, so the prohibition is structural rather than remembered.
//
// THE FOUR STATES, AND WHY EACH IS REACHABLE:
//
//   `quantified`              E1 produced a range from stated operands.
//   `directional`             The range spans more than an order of
//                             magnitude: the loss is real and its
//                             direction is supportable, but its size is
//                             not. Not a degraded number — a different
//                             claim.
//   `material_unquantifiable` A genuine finding for which NO PERMITTED
//                             EXPRESSION EXISTS (§88.1). The honest
//                             case, and it must read as a judgement
//                             rather than as a limitation.
//   `insufficient_evidence`   An operand was not supplied, or the
//                             integrity gate closed. It names what is
//                             missing and links the gap (§105).
//
// NO CLASS'S WORDING CONTAINS A NUMBER, A CURRENCY OR A COMPARISON TO
// ANOTHER BUSINESS, and a test pins that. A sentence about size that
// carries a figure is a size.

import type {
  LostRevenueUnknownReason,
  ScanImpact,
  ScanImpactClass,
  ScanImpactClassification,
  ScanImpactDirection,
} from "@/lib/freetools/scanTypes";

/**
 * Which class each sizing-unknown reason belongs to.
 *
 * A Record over the closed reason enumeration, so a reason added to the
 * sizing module without a class here is a compile error rather than a
 * finding that silently loses its voice.
 *
 * `q4_zero` and `q4_exceeds_q3` are unreachable FROM A REPORT — the
 * finding engine raises no finding in either case — but the classifier
 * is callable on any impact, and a table with a hole in it is worse
 * than a table with an unreachable row.
 */
export const IMPACT_CLASS_BY_REASON: Readonly<
  Record<LostRevenueUnknownReason, ScanImpactClass>
> = {
  no_permitted_expression: "material_unquantifiable",
  range_spans_more_than_one_order_of_magnitude: "directional",
  q4_missing: "insufficient_evidence",
  q4_not_sure: "insufficient_evidence",
  q4_zero: "insufficient_evidence",
  q4_exceeds_q3: "insufficient_evidence",
  q5_no_miss_visibility: "insufficient_evidence",
  q8_missing: "insufficient_evidence",
  q8_not_sure: "insufficient_evidence",
  q9_missing: "insufficient_evidence",
  q9_not_sure: "insufficient_evidence",
};

/**
 * The fixed owner-facing sentence for each class.
 *
 * `material_unquantifiable` is the one that took the most care: it must
 * say NiteOwl decided not to try, not that NiteOwl failed. "We have not
 * tried" is a judgement the owner can weigh; "we could not work it out"
 * invites them to think a number exists behind a locked door.
 */
export const IMPACT_CLASS_WORDING: Readonly<Record<ScanImpactClass, string>> = {
  quantified:
    "We have put a range on this, worked out from your own numbers. It is an estimate, not a measurement.",
  directional:
    "Your answers support the direction of this but not its size: the range they produce is so wide it would tell you nothing useful, so we are not showing one.",
  material_unquantifiable:
    "This is real, and there is no honest way to put a figure on it from the answers any business can give. We have not tried, rather than guessing.",
  insufficient_evidence:
    "We do not have what we would need to size this, so we have not.",
};

/**
 * Say which of the four things an impact is.
 *
 * The whole input is the impact. The answers are not consulted, the
 * finding is not consulted, and neither confidence is consulted — this
 * function cannot change what is sizeable, only how it is spoken about.
 */
export function classifyImpact(impact: ScanImpact): ScanImpactClassification {
  if (impact.kind === "estimate") {
    const direction: ScanImpactDirection = "loss";
    return {
      impact_class: "quantified",
      direction,
      reason: null,
      wording: IMPACT_CLASS_WORDING.quantified,
      source_type: "derived_deterministic",
    };
  }

  const impactClass = IMPACT_CLASS_BY_REASON[impact.reason];

  return {
    impact_class: impactClass,
    // A direction is claimed only where the answers support one. E1 is
    // a loss expression, so a range too wide to show is still a loss;
    // a finding with no expression and one with a missing operand
    // support no direction at all, and claiming one would be the
    // fabricated precision §43.2 forbids in its quietest form.
    direction: impactClass === "directional" ? "loss" : null,
    reason: impact.reason,
    wording: IMPACT_CLASS_WORDING[impactClass],
    source_type: "derived_deterministic",
  };
}
