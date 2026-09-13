// ── Business Opportunity Scan, PR D: dependencies ─────────────────
//
// AN ORDERING CONSTRAINT BETWEEN TWO OF THE SCAN'S OWN RECOMMENDATIONS,
// AND NOTHING ELSE (Part XIV §104).
//
// A DEPENDENCY IS NOT EVIDENCE OF CAUSATION (§100.3). "Do this first"
// is a statement about the order in which actions can be MEASURED, not
// about what causes what — and the owner-facing wording says that in
// as many words rather than leaving it to be inferred.
//
// EVERY DEPENDENCY NAMES THE ENUMERATED RULE THAT PRODUCED IT (§104).
// A dependency with no rule behind it is prose, and prose is what a
// narrative is made of.
//
// ONE RULE FIRES IN PHASE 1, AND THREE DO NOT:
//
//   `stage_order` — the two findings sit at different points on one
//     path the owner described. This is arithmetic about that path: an
//     enquiry nobody answered never reaches the stage where a time is
//     agreed.
//
//   `measurement_integrity` — never fires. In Phase 1 it is a property
//     of ONE finding's own evidence (Q5 caps the unanswered finding),
//     not a relation between two findings.
//
//   `capacity_headroom` — never fires. The Scan asks no capacity
//     question, and inventing one would reach a class §81.3 excluded.
//
//   `conversion_before_volume` — never fires. The Scan raises no volume
//     finding to order a conversion finding against.
//
// `blocked_by` IS NEVER EMITTED. Nothing among the three conditions
// makes one action impossible until another is done. Calling "you
// cannot cleanly measure this until that moves" a blockage would
// overstate it, and overstatement here is how an ordering becomes a
// story about cause.
//
// `independent` IS NEVER EMITTED EITHER, because all three Phase 1
// conditions lie on one ordered path. It stays in the vocabulary
// because a condition off that path would need it — and because §104
// requires that a relation never be invented to justify a sequence,
// which is only testable while the honest alternative exists.
//
// A SINGLE-RECOMMENDATION REPORT HAS NO DEPENDENCIES (§104), and a
// zero-finding report has none either.

import { stageForCondition } from "@/lib/freetools/scanFunnel";
import type {
  ScanConditionCode,
  ScanDependency,
  ScanFunnelStageId,
} from "@/lib/freetools/scanTypes";

/**
 * The owner-facing label for each stage, as it appears inside a
 * dependency sentence.
 *
 * Kept beside the wording it is used in, rather than imported from the
 * presentation layer, so this module stays free of the surface and the
 * sentence it produces is fixed data pinned by test.
 */
const STAGE_PHRASE: Readonly<Record<ScanFunnelStageId, string>> = {
  enquiry_received: "enquiries reaching you",
  enquiry_answered: "enquiries getting an answer",
  time_agreed: "agreeing a time",
  work_booked: "enquiries becoming work",
  enquiry_followed_up: "following up the ones that did not book",
};

/**
 * The sentence a `stage_order` dependency carries.
 *
 * THE LAST CLAUSE IS NOT DECORATION. Without it, "work on this one
 * first" reads as "this one is causing the other", which is the single
 * claim §100.3 forbids the Scan outright.
 */
function stageOrderWording(
  earlier: ScanFunnelStageId,
  later: ScanFunnelStageId
): string {
  return (
    `On the path you described, ${STAGE_PHRASE[earlier]} comes before ` +
    `${STAGE_PHRASE[later]}. Working on the earlier one first means you can ` +
    `see what changes at the later one without the earlier one moving ` +
    `underneath it. This is about the order things can be measured in, not ` +
    `about one causing the other.`
  );
}

/**
 * Derive the ordering constraints between a run's findings.
 *
 * One entry per PAIR, expressed once in the (earlier, later) direction:
 * `should_follow` is the same fact read from the other end, and
 * emitting both would double-count a single relation.
 *
 * The findings are passed in as condition codes — references, not
 * copies (Part IV M7). Nothing here reads a finding's evidence, its
 * confidence, its recommendation or its impact.
 */
export function deriveDependencies(
  findingConditions: readonly ScanConditionCode[]
): ScanDependency[] {
  // Order the conditions by their stage position, so the emitted pairs
  // do not depend on the order the caller happened to supply.
  const placed = findingConditions
    .map((condition) => ({ condition, stage: stageForCondition(condition) }))
    .sort((a, b) => a.stage.position - b.stage.position);

  const dependencies: ScanDependency[] = [];

  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const earlier = placed[i];
      const later = placed[j];
      dependencies.push({
        from_condition: earlier.condition,
        to_condition: later.condition,
        relation: "should_precede",
        rule: "stage_order",
        wording: stageOrderWording(earlier.stage.stage_id, later.stage.stage_id),
        source_type: "derived_deterministic",
      });
    }
  }

  return dependencies;
}
