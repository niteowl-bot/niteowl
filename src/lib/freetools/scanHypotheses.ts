// ── Business Opportunity Scan — hypotheses (PR F, Part XIV §103) ──
//
// "WHAT MIGHT BE BEHIND THIS?" — answered from the owner's own answers
// and from nothing else. A hypothesis here is a candidate explanation
// a stated rule can support from the nine questions; it is never a
// cause, never a winner, and never a guess.
//
// STRICTLY DOWNSTREAM. Only the report assembler imports this module.
// `deriveFindings`, sizing, prioritisation, dependencies, evidence gaps,
// recommendations and clusters neither import it nor take hypotheses
// as input, and a source-level test pins that. A hypothesis therefore
// cannot change a finding, a number, an order or a relation — it can
// only be read beside them.
//
// IT CANNOT READ A FINDING'S CONFIDENCE. The entry point takes the
// condition code, not the finding, so the finding's confidence and cap
// are structurally out of reach: a hypothesis confidence that could
// have been copied from the finding is a confidence that was never
// assessed (§92). Each rule fixes its own.
//
// THE TABLE IS CLOSED. Every rule below is keyed by a condition and by
// business-provided answers, quotes the answer it read as evidence, and
// carries fixed tentative wording. Q1 and Q2 are read here ONLY as
// evidence for an explanation — this is not routing, and no rule
// changes which product is recommended (§87.2's Q1/Q2-aware routing
// remains deferred).
//
// EMPTY IS A REAL OUTPUT. `enquiry.no_followup` is Q6 stating a
// practice, and nothing else the owner said explains why the practice
// is what it is — so its list is empty with a stated reason, and
// nothing is invented to fill it (§103).
//
// NO MODEL, NO CLOCK, NO RANDOMNESS, NO NETWORK, NO STORAGE, NO TENANT.

import {
  SCAN_HYPOTHESIS_RULE_SET_VERSION,
  type ContactChannel,
  type ScanAnswers,
  type ScanConditionCode,
  type ScanConfidence,
  type ScanEvidenceRef,
  type ScanHypothesesEmptyReason,
  type ScanHypothesis,
  type ScanHypothesisCode,
  type ScanQuestionId,
} from "@/lib/freetools/scanTypes";

export { SCAN_HYPOTHESIS_RULE_SET_VERSION };

/** The assembler's view of one finding's hypotheses. */
export interface ScanHypothesisSet {
  readonly hypotheses: readonly ScanHypothesis[];
  readonly hypotheses_empty_reason: ScanHypothesesEmptyReason | null;
}

/**
 * One row of the closed rule table.
 *
 * `applies` reads answers and returns the question ids it relied on —
 * or null. The ids returned ARE the evidence: the rule cannot cite an
 * answer it did not read, and it cannot fire without citing one.
 */
interface HypothesisRule {
  readonly condition: ScanConditionCode;
  readonly code: ScanHypothesisCode;
  readonly applies: (answers: ScanAnswers) => readonly ScanQuestionId[] | null;
  readonly confidence: ScanConfidence;
  readonly display_text: string;
}

/** Q1 channels where agreeing a time happens by exchanging messages. */
const ASYNC_CHANNELS: readonly ContactChannel[] = [
  "text_whatsapp",
  "email",
  "web_form",
  "social",
];

/**
 * THE CLOSED RULE TABLE. Order within a condition is the tie-break
 * order (`rule_table_order`), so a row's position is part of the rule.
 *
 * Every display text is tentative by construction — "may", "could",
 * "suggests" — and a test refuses causal-certainty wording.
 */
const HYPOTHESIS_RULES: readonly HypothesisRule[] = [
  // ── enquiry.unanswered ───────────────────────────────────────────
  {
    condition: "enquiry.unanswered",
    code: "reachability_window_limited",
    applies: (a) => (a.q2_reachable === "working_hours" ? ["q2_reachable"] : null),
    confidence: "medium",
    display_text:
      "Enquiries may be arriving outside working hours, when nobody is free to answer them.",
  },
  {
    condition: "enquiry.unanswered",
    code: "reachability_inconsistent",
    applies: (a) => (a.q2_reachable === "varies" ? ["q2_reachable"] : null),
    confidence: "low",
    display_text:
      "With reachability varying, some enquiries could be landing at moments when nobody is available, and the gaps may not be predictable.",
  },
  {
    condition: "enquiry.unanswered",
    code: "channels_spread",
    applies: (a) => (a.q1_channels.length >= 3 ? ["q1_channels"] : null),
    confidence: "low",
    display_text:
      "Enquiries may be spread across several channels, which could make some of them easier to miss than others.",
  },
  {
    condition: "enquiry.unanswered",
    code: "misses_go_unnoticed",
    applies: (a) =>
      a.q5_miss_visibility === "no" || a.q5_miss_visibility === "sometimes"
        ? ["q5_miss_visibility"]
        : null,
    confidence: "medium",
    display_text:
      "Some missed enquiries may be going unnoticed, so nobody gets the chance to return them.",
  },
  // ── enquiry.no_followup ──────────────────────────────────────────
  //
  // No rows, deliberately. Q6 is the practice itself, and none of the
  // other answers says anything about why it is what it is. The list
  // is empty with a stated reason (§103), not padded.
  //
  // ── booking.friction ─────────────────────────────────────────────
  {
    condition: "booking.friction",
    code: "async_channel_back_and_forth",
    applies: (a) =>
      a.q1_channels.some((channel) => ASYNC_CHANNELS.includes(channel))
        ? ["q1_channels"]
        : null,
    confidence: "medium",
    display_text:
      "Agreeing a time over messages may be taking several rounds, with each reply waiting on the other side.",
  },
  {
    condition: "booking.friction",
    code: "replies_wait_for_availability",
    applies: (a) =>
      a.q2_reachable === "working_hours" || a.q2_reachable === "varies"
        ? ["q2_reachable"]
        : null,
    confidence: "low",
    display_text:
      "Replies could be waiting until someone is free to respond, which may stretch the back-and-forth out.",
  },
];

function evidenceOf(answers: ScanAnswers, id: ScanQuestionId): ScanEvidenceRef {
  return {
    question_id: id,
    // Only answered questions are ever cited: every rule above reads a
    // required question, so this cast is never reached for an absent one.
    raw_answer: answers[id as keyof ScanAnswers] as ScanEvidenceRef["raw_answer"],
    source_type: "business_provided",
  };
}

/**
 * Candidate explanations for one finding, ranked with no winner.
 *
 * Takes the CONDITION, not the finding — see the header. Ranking is
 * deterministic: more evidence first, then the table's own order, each
 * position carrying the reason that placed it.
 */
export function deriveHypotheses(
  condition: ScanConditionCode,
  answers: ScanAnswers
): ScanHypothesisSet {
  const fired: {
    readonly rule: HypothesisRule;
    readonly evidence: readonly ScanEvidenceRef[];
    readonly tableIndex: number;
  }[] = [];

  HYPOTHESIS_RULES.forEach((rule, tableIndex) => {
    if (rule.condition !== condition) return;
    const relied = rule.applies(answers);
    if (!relied || relied.length === 0) return;
    fired.push({
      rule,
      evidence: relied.map((id) => evidenceOf(answers, id)),
      tableIndex,
    });
  });

  if (fired.length === 0) {
    return { hypotheses: [], hypotheses_empty_reason: "no_rule_matched" };
  }

  const ordered = [...fired].sort(
    (a, b) => b.evidence.length - a.evidence.length || a.tableIndex - b.tableIndex
  );

  const hypotheses: ScanHypothesis[] = ordered.map((entry, index) => {
    // Placed above the next entry by having more evidence, or by the
    // table order alone. The last entry is always table order.
    const next = ordered[index + 1];
    const rank_reason: ScanHypothesis["rank_reason"] =
      next && next.evidence.length < entry.evidence.length
        ? "more_evidence"
        : "rule_table_order";
    return {
      hypothesis_id: `${condition}:${entry.rule.code}`,
      claim_class: "hypothesis",
      code: entry.rule.code,
      evidence: entry.evidence,
      contradicting_evidence: [],
      source_type: "derived_deterministic",
      hypothesis_confidence: entry.rule.confidence,
      rank: index + 1,
      rank_reason,
      display_text: entry.rule.display_text,
    };
  });

  return { hypotheses, hypotheses_empty_reason: null };
}

/** The codes the table can emit, for tests that pin the closed set. */
export const SCAN_HYPOTHESIS_CODES: readonly ScanHypothesisCode[] = HYPOTHESIS_RULES.map(
  (rule) => rule.code
);
