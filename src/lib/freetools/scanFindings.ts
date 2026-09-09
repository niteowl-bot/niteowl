// ── Business Opportunity Scan, Phase 1: the finding engine ────────
//
// A stated rule over stated answers, and NOTHING ELSE.
//
// NO MODEL IS IN THIS PATH (§87.3). A language model may phrase the
// prose around a finding; it may never decide that a finding exists, it
// may never produce an operand, and it may never alter the ranking.
// This module makes that structural rather than aspirational: it
// imports nothing but the question contract and the types, it takes no
// callback, it has no seam a model could be threaded through, and the
// boundary test refuses the imports that would create one.
//
// AND IT HAS NO CLOCK, NO RANDOMNESS, NO NETWORK AND NO EXTERNAL STATE.
// The same validated answers must produce deeply equal findings every
// time, forever. Determinism is not an implementation detail here — it
// is what lets a stored run be re-derived and checked, which is the
// whole of Part XII's governing principle.
//
// A FINDING IS A RESTATEMENT OF THE OWNER'S OWN ANSWER, PLUS A
// THRESHOLD, AND IT MUST READ THAT WAY (§87.3). `enquiry.no_followup`
// on Q6 = "nothing planned" is not an inference about the business; it
// is the owner's own description of their practice, named as a
// condition so it becomes learnable. The Scan's value is the
// recommendation and the measurement, not the revelation.
//
// NO FINDING IS EVER PRODUCED BY ABSENCE (§87.4). A blank means nothing
// was established, never that the answer was bad — and "not sure" means
// the owner told us they cannot say, which likewise raises nothing.
//
// THREE CONDITIONS, AT MOST THREE FINDINGS. There is no fourth code and
// no path that could emit one: the engine is three explicit blocks over
// a closed enumeration, so a NOT-IN-MVP class (capacity, retention,
// repeat business, handoff, cash flow, marketing — §81.3) cannot appear
// without a deliberate Part XI boundary change.

import { SCAN_QUESTION_SET_VERSION } from "@/lib/freetools/scanQuestions";
import { computeLostRevenue } from "@/lib/freetools/scanLostRevenue";
import {
  SCAN_CONDITION_ORDER,
  type ScanAnswers,
  type ScanConfidence,
  type ScanConfidenceCapReason,
  type ScanConditionCode,
  type ScanEvidenceRef,
  type ScanFinding,
  type ScanInconsistency,
  type ScanQuestionId,
  type ScanReport,
  type ScanReportFinding,
  type ScanRunContext,
} from "@/lib/freetools/scanTypes";

/**
 * The rule-set version, stored per run.
 *
 * A change to any threshold, cap or ordering rule below is a version
 * change: two runs graded by different rules are not comparable, and
 * docs/AGENT_ACCESS_LAYER.md §25.2 requires that to be visible.
 */
export const SCAN_RULE_SET_VERSION = "v1";

/** Quote an answer as the owner gave it (§84.2). */
function evidenceOf(
  answers: ScanAnswers,
  id: ScanQuestionId
): ScanEvidenceRef {
  const raw = answers[id as keyof ScanAnswers];
  return {
    question_id: id,
    // The four optional questions can be absent; a finding never rests
    // on one that is, so this cast is reached only for answered ones.
    raw_answer: raw as ScanEvidenceRef["raw_answer"],
    source_type: "business_provided",
  };
}

function makeFinding(
  answers: ScanAnswers,
  condition: ScanConditionCode,
  supporting: readonly ScanQuestionId[],
  confidence: ScanConfidence,
  capReason: ScanConfidenceCapReason | null
): ScanFinding {
  return {
    condition,
    supporting_question_ids: supporting,
    evidence: supporting.map((id) => evidenceOf(answers, id)),
    source_type: "derived_deterministic",
    finding_confidence: confidence,
    confidence_cap_reason: capReason,
  };
}

/**
 * `enquiry.unanswered` — §87.1: raised when Q4 ≥ 1, and Q4 ≤ Q3 where
 * both are given.
 *
 * Four ways it is NOT raised, each for its own reason (§87.4):
 *
 *   Q4 absent — nothing was established. Absence is not evidence.
 *   Q4 = "not sure" — a missed-enquiry claim with no count behind it
 *     is a slogan.
 *   Q4 = 0 — nothing to report is a legitimate outcome, and the report
 *     must be able to say so.
 *   Q4 > Q3 — internally inconsistent. The inconsistency is SHOWN to
 *     the owner and NEITHER ANSWER IS REPAIRED.
 *
 * Q5 never blocks the finding, and that is deliberate: an owner with no
 * way of knowing a miss happened can still be missing enquiries. What
 * Q5 = "no" does is cap the confidence at low permanently (§87.3) and
 * forbid the finding being sized at all (§88.3) — it may support a
 * low-confidence finding; it may not support money.
 */
function unansweredFinding(answers: ScanAnswers): ScanFinding | null {
  const q4 = answers.q4_unanswered_per_week;
  if (!q4 || q4.kind !== "count") return null;
  if (q4.value < 1) return null;

  const q3 = answers.q3_enquiries_per_week;
  const bothCounted = q3.kind === "count";
  if (bothCounted && q4.value > q3.value) return null;

  // Q4 and Q5 always carry it (§87.3's corroboration rule); Q3 joins
  // the evidence only when it actually took part in the check.
  const supporting: ScanQuestionId[] = bothCounted
    ? ["q3_enquiries_per_week", "q4_unanswered_per_week", "q5_miss_visibility"]
    : ["q4_unanswered_per_week", "q5_miss_visibility"];

  // Capped by the weakest supporting answer, and the cap is displayed.
  const visibility = answers.q5_miss_visibility;
  const confidence: ScanConfidence =
    visibility === "yes_always" ? "high" : visibility === "sometimes" ? "medium" : "low";
  const capReason: ScanConfidenceCapReason | null =
    visibility === "yes_always"
      ? null
      : visibility === "sometimes"
        ? "q5_partial_miss_visibility"
        : "q5_no_miss_visibility";

  return makeFinding(answers, "enquiry.unanswered", supporting, confidence, capReason);
}

/**
 * `enquiry.no_followup` — §87.1: raised when Q6 is "only if they get in
 * touch again" or "nothing planned".
 *
 * One answer is sufficient here DELIBERATELY (§87.3): the question is a
 * direct statement of the condition rather than evidence about it, and
 * manufacturing a second question to dress that up would be theatre.
 * "Not sure" raises nothing.
 *
 * Its confidence is uncapped because there is no weaker supporting
 * answer to cap it with — the owner described their own practice. In
 * Phase 1 it is nonetheless ALWAYS impact-unknown (§88.1): sizing it
 * would need the share of unfollowed enquiries a follow-up would have
 * recovered, and no owner can supply that.
 */
function noFollowupFinding(answers: ScanAnswers): ScanFinding | null {
  const q6 = answers.q6_followup;
  if (q6 !== "only_if_they_return" && q6 !== "nothing_planned") return null;
  return makeFinding(answers, "enquiry.no_followup", ["q6_followup"], "high", null);
}

/**
 * `booking.friction` — §87.1: raised when Q7 is "more than three" or
 * "it varies a lot".
 *
 * §87.3's second cap: "it varies a lot" is a weaker statement of the
 * condition than "more than three", so it caps the confidence below it.
 * "Not sure" raises nothing.
 *
 * Always impact-unknown in Phase 1 (§88.1): friction and no-shows are
 * not established losses — a slot may be refilled, a job rescheduled, a
 * customer retained — and treating effort as revenue would count as
 * lost the work the business actually did.
 */
function bookingFrictionFinding(answers: ScanAnswers): ScanFinding | null {
  const q7 = answers.q7_messages_to_book;
  if (q7 === "more_than_three") {
    return makeFinding(answers, "booking.friction", ["q7_messages_to_book"], "high", null);
  }
  if (q7 === "varies_a_lot") {
    return makeFinding(
      answers,
      "booking.friction",
      ["q7_messages_to_book"],
      "medium",
      "q7_varies_a_lot"
    );
  }
  return null;
}

/** The three rules, keyed by the code each one can raise. */
const CONDITION_RULES: Record<
  ScanConditionCode,
  (answers: ScanAnswers) => ScanFinding | null
> = {
  "enquiry.unanswered": unansweredFinding,
  "enquiry.no_followup": noFollowupFinding,
  "booking.friction": bookingFrictionFinding,
};

/**
 * Derive the findings for one set of validated answers.
 *
 * Already ranked, by the enumeration and by nothing else
 * (SCAN_CONDITION_ORDER): no score, no weight, no learned parameter, no
 * tuning, and never by estimated money. Sized and unsized findings rank
 * identically, because ranking by value would make the order an
 * artefact of which single class Phase 1 happens to be able to size.
 *
 * Zero findings is a valid, honest result (§87.4).
 */
export function deriveFindings(answers: ScanAnswers): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const condition of SCAN_CONDITION_ORDER) {
    const finding = CONDITION_RULES[condition](answers);
    if (finding) findings.push(finding);
  }
  return findings;
}

/**
 * Assemble one run's report: the ranked findings, each with its impact.
 *
 * Sizing runs per finding and returns UNKNOWN for everything it cannot
 * legitimately size — which in Phase 1 is both of the other two codes,
 * always (§88.1). Timestamps arrive in `context`; nothing here reads a
 * clock.
 */
export function buildScanReport(
  answers: ScanAnswers,
  context: ScanRunContext,
  inconsistencies: readonly ScanInconsistency[] = []
): ScanReport {
  const findings: ScanReportFinding[] = deriveFindings(answers).map((finding) => ({
    finding,
    impact: computeLostRevenue(finding, answers, context),
  }));

  return {
    question_set_version: SCAN_QUESTION_SET_VERSION,
    rule_set_version: SCAN_RULE_SET_VERSION,
    findings,
    inconsistencies,
  };
}
