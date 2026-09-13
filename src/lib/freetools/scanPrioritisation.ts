// ── Business Opportunity Scan, PR D: deterministic ordering ───────
//
// THE SCAN MAY ORDER ITS FINDINGS. IT MAY NOT PRODUCE A SCORE
// (Part XIV §100.2).
//
// Five conditions, and every one of them is structural here rather
// than aspirational:
//
//   DETERMINISTIC — the same findings always produce the same order.
//     No model, no randomness, no clock, no tenant, no provider is
//     reachable from this module, and the boundary suite refuses the
//     imports that would create one.
//
//   EXPLAINABLE FROM A VISIBLE RULE — every position carries the
//     ENUMERATED REASON CODE of the rule that placed it, and a fixed
//     sentence the owner reads. "Priority #1 because…" is a
//     restatement of a rule, never a justification written afterwards.
//
//   PRODUCT-SCOPED — the ordering is in the Scan's own domain terms. It
//     is not a NiteOwl priority unit, is not comparable with another
//     product's ordering, and is never an input to one (§43.3).
//
//   VERSIONED INDEPENDENTLY — SCAN_PRIORITISATION_RULE_SET_VERSION sits
//     beside the rule-set version rather than inside it, so an ordering
//     change is visible as one instead of hiding in a findings change.
//
//   NO HIDDEN SCORE — no weights, no points, no normalised units, no
//     composite number, neither displayed nor computed in memory. The
//     comparator returns a direction from enumerated comparisons; a
//     number that exists only in memory is still a score, and the next
//     change to it would be unfalsifiable.
//
// ESTIMATED MONEY IS NOT AN INPUT, AND CANNOT BE. This module is handed
// findings and dependencies. `ScanFinding` carries no impact, no
// estimate and no basis, so there is nothing here to order by value
// even by accident (§100.2: in Phase 1 one condition of three is ever
// sizeable, so ordering by value would order by what NiteOwl happens
// to be able to measure).
//
// THE LADDER, IN ORDER. The first rule that distinguishes two findings
// places them and supplies the reason:
//
//   1. blocked_by another finding      — declared; never fires today
//   2. earlier in the enquiry path     — THE BINDING RULE
//   3. better supported by the answers — declared; never fires today
//   4. SCAN_CONDITION_ORDER            — the canonical final tie-break
//
// Rules 1, 3 and 4 do not fire in Phase 1 because the three conditions
// anchor to three DIFFERENT stages, so stage position is already a
// total order. They are evaluated anyway, and a sweep test pins that
// they never bind — which is what stops a fourth condition, or a
// second condition on one stage, being added silently.
//
// PRIORITISATION RANKS GENUINE FINDINGS ONLY (§107.4). It never
// manufactures, promotes or retains a finding in order to have
// something to rank, and ordering an empty set produces an empty
// ordering rather than a recommendation.

import { stageForCondition } from "@/lib/freetools/scanFunnel";
import {
  SCAN_CONDITION_ORDER,
  SCAN_PRIORITISATION_RULE_SET_VERSION,
  type ScanConditionCode,
  type ScanConfidence,
  type ScanDependency,
  type ScanFinding,
  type ScanPriority,
  type ScanPriorityReasonCode,
} from "@/lib/freetools/scanTypes";

export { SCAN_PRIORITISATION_RULE_SET_VERSION };

/**
 * The confidence scale, low to high, used for ORDER ALONE.
 *
 * The same idiom the recommendation layer already uses for its two
 * bucketed metrics: a position on a declared scale, never shown, never
 * treated as a quantity and never combined with anything.
 */
const CONFIDENCE_SCALE: readonly ScanConfidence[] = ["low", "medium", "high"];

/** Fixed owner-facing wording, one sentence per rule. Pinned by test. */
export const PRIORITY_REASON_WORDING: Readonly<
  Record<ScanPriorityReasonCode, string>
> = {
  only_finding:
    "This is the only thing we found, so there is nothing to order it against.",
  blocked_by_another_finding:
    "Something else on this list has to be dealt with before this one can be.",
  earlier_in_the_enquiry_path:
    "This sits earlier on the path an enquiry takes through your business, so a change here can be seen without the things after it moving at the same time. It is about the order to work in, not about one thing causing another.",
  better_supported_by_your_answers:
    "Your answers support this one more strongly than the one beside it.",
  canonical_condition_order:
    "Nothing in your answers separates these two, so they are shown in the order this scan always uses.",
};

/** Is `candidate` blocked by `other`, per the derived dependencies? */
function isBlockedBy(
  candidate: ScanConditionCode,
  other: ScanConditionCode,
  dependencies: readonly ScanDependency[]
): boolean {
  return dependencies.some(
    (d) =>
      d.relation === "blocked_by" &&
      d.from_condition === candidate &&
      d.to_condition === other
  );
}

/** A condition's position on the enquiry path. Every condition has one. */
function pathPosition(condition: ScanConditionCode): number {
  return stageForCondition(condition).position;
}

/**
 * Which rule separates two findings, evaluated in ladder order.
 *
 * Returns the reason code of the FIRST rule that distinguishes them.
 * The enumeration is a total order over a closed set, so a null return
 * is unreachable while two distinct conditions are compared — but the
 * type keeps it honest rather than asserting it.
 */
function distinguishingRule(
  a: ScanFinding,
  b: ScanFinding,
  dependencies: readonly ScanDependency[]
): ScanPriorityReasonCode | null {
  if (
    isBlockedBy(a.condition, b.condition, dependencies) ||
    isBlockedBy(b.condition, a.condition, dependencies)
  ) {
    return "blocked_by_another_finding";
  }
  if (pathPosition(a.condition) !== pathPosition(b.condition)) {
    return "earlier_in_the_enquiry_path";
  }
  if (
    CONFIDENCE_SCALE.indexOf(a.finding_confidence) !==
    CONFIDENCE_SCALE.indexOf(b.finding_confidence)
  ) {
    return "better_supported_by_your_answers";
  }
  if (
    SCAN_CONDITION_ORDER.indexOf(a.condition) !==
    SCAN_CONDITION_ORDER.indexOf(b.condition)
  ) {
    return "canonical_condition_order";
  }
  return null;
}

/**
 * Which of two findings comes first, by the same ladder.
 *
 * A direction, never a magnitude: each branch answers "which one" and
 * none of them produces a value that could be stored, displayed,
 * summed or tuned.
 */
function compare(
  a: ScanFinding,
  b: ScanFinding,
  dependencies: readonly ScanDependency[]
): number {
  if (isBlockedBy(a.condition, b.condition, dependencies)) return 1;
  if (isBlockedBy(b.condition, a.condition, dependencies)) return -1;

  const byPath = pathPosition(a.condition) - pathPosition(b.condition);
  if (byPath !== 0) return byPath;

  const byConfidence =
    CONFIDENCE_SCALE.indexOf(b.finding_confidence) -
    CONFIDENCE_SCALE.indexOf(a.finding_confidence);
  if (byConfidence !== 0) return byConfidence;

  return (
    SCAN_CONDITION_ORDER.indexOf(a.condition) -
    SCAN_CONDITION_ORDER.indexOf(b.condition)
  );
}

/**
 * Order one run's findings, with the reason for every position.
 *
 * Each entry's reason is the rule that placed it RELATIVE TO THE ENTRY
 * IMMEDIATELY ABOVE IT; the first entry's reason is the rule that
 * placed it above the second. A single finding is `only_finding`, and
 * an empty set produces an empty ordering.
 *
 * The findings are never copied into the result — a priority carries a
 * condition code, which is the reference the report already uses.
 */
export function prioritise(
  findings: readonly ScanFinding[],
  dependencies: readonly ScanDependency[] = []
): ScanPriority[] {
  const ordered = [...findings].sort((a, b) => compare(a, b, dependencies));

  return ordered.map((finding, index) => {
    const neighbour = index === 0 ? ordered[1] : ordered[index - 1];
    const reason: ScanPriorityReasonCode = neighbour
      ? distinguishingRule(finding, neighbour, dependencies) ??
        "canonical_condition_order"
      : "only_finding";

    const stage = stageForCondition(finding.condition);

    return {
      position: index + 1,
      condition: finding.condition,
      stage_id: stage.stage_id,
      reason_code: reason,
      reason_wording: PRIORITY_REASON_WORDING[reason],
      source_type: "derived_deterministic",
    };
  });
}
