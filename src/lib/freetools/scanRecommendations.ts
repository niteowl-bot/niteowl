// ── Business Opportunity Scan, Phase 1: the recommendation layer ──
//
// ONE FIXED NEXT STEP PER FINDING, KEYED BY THE CONDITION AND BY
// NOTHING ELSE.
//
// A finding's value is the action it licenses and the measurement that
// follows (§84.2), so every rendered finding leaves here with exactly
// one owner-actionable recommendation. The recommendation is a lookup
// on `finding.condition`: not the impact, not the estimate's size, not
// either confidence, not a cap reason, not the provider, not the clock.
// A sized and an unsized instance of the same condition receive the
// same advice, because a next step that changed with the size of a
// number would be a sales figure steering the diagnosis.
//
// ALL OWNER-FACING TEXT IS FIXED DATA. No model writes a headline, an
// explanation or a step, and the exact wording is pinned by test. The
// text restates what the owner TOLD US and never claims something was
// seen, measured, compared to other businesses or priced.
//
// SUCCESS NEVER INVENTS A TARGET (D-B1). The one threshold rule is
// improvement in the stated direction from the OWNER'S OWN STATED
// ANSWER: fewer unanswered enquiries than the count they gave, a
// larger share becoming work than the share they gave, fewer messages
// than the number they gave. The baseline is never `EstimateBasis
// .result`, never a benchmark and never a midpoint. Where the stated
// answer has no position on the metric's scale — "not sure", absent,
// "it varies a lot" — the baseline is null and the wording says one
// must be established first.
//
// NOT EVERY PROBLEM ROUTES TO REMY. `enquiry.no_followup` names no
// product at all; `booking.friction` hands off to a free tool first and
// names Remy as where the answer lives (§84.3). A scan that sent
// every finding to the same product would be an advertisement wearing
// a diagnostic's clothes (§26), and the test suite pins that at least
// one recommendation structurally routes to null.
//
// THE HANDOFF IS A LINK. A bare path, a tool id and a label — no
// answers, no pre-fill, no token, no state, no consent implied.
//
// NO CLOCK, NO RANDOMNESS, NO NETWORK, NO STORAGE, NO TENANT. The review
// window is a number of days; a surface derives its own review date
// from its own timestamp. Nothing here persists: a recommendation is
// transient and pre-consent, and is NOT a `DecisionRecord` (§20.7) —
// it carries the same authority-and-provenance literals one would, so
// a later surface can lift it into one without reinterpreting it.

import {
  SCAN_RULE_SET_VERSION,
  type ConversionShare,
  type CountAnswer,
  type MessagesToBook,
  type ScanAnswerValue,
  type ScanAnswers,
  type ScanConditionCode,
  type ScanFinding,
  type ScanFreeToolHandoff,
  type ScanQuestionId,
  type ScanRecommendation,
  type ScanRecommendedProduct,
  type ScanStatedBaseline,
  type ScanSuccessCriterion,
  type ScanSuccessDirection,
  type ScanSuccessMetric,
} from "@/lib/freetools/scanTypes";

/** How long to act before re-asking the success question. Days, not a date. */
export const SCAN_REVIEW_WINDOW_DAYS = 28;

/**
 * The Setup Kit handoff — a link and nothing else.
 *
 * The path is the shipped free tool's route. Nothing is appended to it
 * and nothing rides alongside it: the Kit starts from a blank page, as
 * it does for anyone, and the owner's answers stay in the Scan.
 */
export const SETUP_KIT_HANDOFF: ScanFreeToolHandoff = {
  tool: "ai_receptionist_setup_kit",
  href: "/free-tools/ai-receptionist-setup-kit",
  label: "Open the free AI Receptionist Setup Kit",
} as const;

// ── Success metrics ───────────────────────────────────────────────

/**
 * Where each metric's baseline is read from, and which way it must
 * move. Each metric IS one of the nine questions asked again, so a
 * later measurement is the same `business_provided` answer given a
 * second time, not a new kind of fact.
 */
interface MetricDefinition {
  readonly question_id: ScanQuestionId;
  readonly direction: ScanSuccessDirection;
  /** Fixed wording when the owner's stated answer is the baseline. */
  readonly with_baseline: string;
  /** Fixed wording when no baseline could be read from the answer. */
  readonly without_baseline: string;
}

const METRICS: Record<ScanSuccessMetric, MetricDefinition> = {
  unanswered_enquiries_per_week: {
    question_id: "q4_unanswered_per_week",
    direction: "decrease",
    with_baseline:
      "Success is fewer unanswered enquiries in a typical week than the number you gave us.",
    without_baseline:
      "You have not given us a number of unanswered enquiries yet, so a baseline needs to be established first. Success is fewer than that baseline in a typical week.",
  },
  answered_enquiries_becoming_work_share: {
    question_id: "q9_conversion_share",
    direction: "increase",
    with_baseline:
      "Success is a larger share of the enquiries you answer becoming work than the share you gave us.",
    without_baseline:
      "You have not given us the share of the enquiries you answer that become work yet, so a baseline needs to be established first. Success is a larger share of the enquiries you answer becoming work than that baseline.",
  },
  messages_to_book: {
    question_id: "q7_messages_to_book",
    direction: "decrease",
    with_baseline: "Success is fewer messages to agree a time than the number you gave us.",
    without_baseline:
      "You told us the number of messages varies a lot, so a baseline needs to be established first. Success is fewer messages to agree a time than that baseline.",
  },
};

/**
 * The ordinal scales the two bucketed metrics are read on, low to high.
 *
 * Only answers WITH a position on the scale can be a baseline or be
 * compared: "not sure" is the owner saying they cannot place it, and
 * "it varies a lot" is a statement that there is no single position.
 * Neither is given one, and no number is attached to any bucket here —
 * the comparison is by order alone.
 */
const CONVERSION_SCALE: readonly Exclude<ConversionShare, "not_sure">[] = [
  "a_minority",
  "about_half",
  "most",
];

const MESSAGES_SCALE: readonly Exclude<MessagesToBook, "not_sure" | "varies_a_lot">[] = [
  "one",
  "two_or_three",
  "more_than_three",
];

/**
 * An answer's position on its metric's scale, or null when it has none.
 *
 * A count is its own position. A bucket's position is its index on the
 * fixed scale — used for ORDER only, never shown and never treated as
 * a quantity. Anything else (absent, "not sure", "varies a lot", or a
 * value of the wrong shape) has no position and yields null.
 */
function positionOf(metric: ScanSuccessMetric, answer: ScanAnswerValue | null | undefined): number | null {
  if (answer === null || answer === undefined) return null;
  switch (metric) {
    case "unanswered_enquiries_per_week": {
      const count = answer as CountAnswer;
      return typeof count === "object" && !Array.isArray(count) && count.kind === "count"
        ? count.value
        : null;
    }
    case "answered_enquiries_becoming_work_share": {
      const index = (CONVERSION_SCALE as readonly unknown[]).indexOf(answer);
      return index === -1 ? null : index;
    }
    case "messages_to_book": {
      const index = (MESSAGES_SCALE as readonly unknown[]).indexOf(answer);
      return index === -1 ? null : index;
    }
  }
}

/**
 * Read the baseline from the owner's raw stated answer — or refuse.
 *
 * The baseline is the answer itself, quoted with its question id and
 * its `business_provided` source, exactly as a finding quotes its
 * evidence. Nothing is normalised, rounded, bucketed or substituted,
 * and an answer with no position on the scale produces null rather
 * than a guess.
 */
function baselineFor(metric: ScanSuccessMetric, answers: ScanAnswers): ScanStatedBaseline | null {
  const { question_id } = METRICS[metric];
  const raw = answers[question_id as keyof ScanAnswers];
  if (positionOf(metric, raw) === null) return null;
  return {
    question_id,
    raw_answer: raw as ScanAnswerValue,
    source_type: "business_provided",
  };
}

function successCriterionFor(metric: ScanSuccessMetric, answers: ScanAnswers): ScanSuccessCriterion {
  const definition = METRICS[metric];
  const baseline = baselineFor(metric, answers);
  return {
    metric,
    direction: definition.direction,
    threshold_rule: "improvement_from_stated_baseline",
    baseline,
    wording: baseline ? definition.with_baseline : definition.without_baseline,
  };
}

/*
 * THE CRITERION IS DECLARED HERE AND EVALUATED NOWHERE IN THIS LAYER.
 * Comparing a later answer against the baseline is the
 * `observed outcome → comparison → learning` stage of §85.1's loop,
 * owned by a later runtime with its own provenance (§43.4, §94). This
 * module states what success would be; it never judges whether it was.
 */

// ── The fixed table ───────────────────────────────────────────────

/**
 * Everything about a recommendation that does not depend on the
 * owner's answers: the condition is the whole key.
 *
 * Every string here is what the owner reads, verbatim. Each `why`
 * begins "You told us" because that is the only thing Phase 1 knows;
 * each `next_step` is something the owner can do themselves, and stays
 * useful whether or not they ever buy anything.
 */
export interface FixedRecommendation {
  readonly recommendation_code: string;
  readonly headline: string;
  readonly why_it_matters: string;
  readonly next_step: string;
  readonly recommended_product: ScanRecommendedProduct | null;
  readonly free_tool_handoff: ScanFreeToolHandoff | null;
  /** The metric alone; its direction and wording live with the metric. */
  readonly success_metric: ScanSuccessMetric;
}

export const SCAN_RECOMMENDATIONS: Record<ScanConditionCode, FixedRecommendation> = {
  "enquiry.unanswered": {
    recommendation_code: "enquiry.unanswered.answer_every_enquiry",
    headline: "Some enquiries are going unanswered",
    why_it_matters:
      "You told us that some of the enquiries you get each week are not answered. An enquiry that gets no answer cannot become a booking, and the person who sent it may not try again.",
    next_step:
      "Decide what happens to an enquiry when nobody can take it: who answers, by when, and how — for example a voicemail message that promises a call back within a set time, or a person or service that picks up when you are busy. Then count your unanswered enquiries again at the end of the review window.",
    recommended_product: "remy",
    free_tool_handoff: null,
    success_metric: "unanswered_enquiries_per_week",
  },
  "enquiry.no_followup": {
    recommendation_code: "enquiry.no_followup.follow_up_every_enquiry",
    headline: "Enquiries that do not book are not followed up",
    why_it_matters:
      "You told us that when an enquiry does not turn into a booking, nothing is planned to follow it up. Someone who asked once and heard nothing more has to decide to come back on their own.",
    next_step:
      "Choose one follow-up you will do for every enquiry that does not book — a short message or call within a day — and keep a note of what came of each one. Then look again at how many of your enquiries become work at the end of the review window.",
    // Deliberately no product: a follow-up habit is the owner's to
    // build, and nothing NiteOwl sells is the honest answer here.
    recommended_product: null,
    free_tool_handoff: null,
    success_metric: "answered_enquiries_becoming_work_share",
  },
  "booking.friction": {
    recommendation_code: "booking.friction.write_down_booking_rules",
    headline: "Agreeing a time takes several messages",
    why_it_matters:
      "You told us that agreeing an appointment time takes more than three messages, or varies a lot. Every extra exchange is a chance for the customer to drift away, and it is time spent on something other than the work.",
    next_step:
      "Write down the booking rules someone would need in order to pick a time themselves — the days and hours you take work, how long each type of job takes, and how many you can fit in a day — and offer those up front. The free AI Receptionist Setup Kit walks you through writing them down, and you can use it without buying anything.",
    // Remy is where the answer to booking friction lives (§84.3, G4:
    // the routing attribute names the product that addresses the
    // class). The Setup Kit is the first step of §84.4's path and the
    // next step is useful without either; naming Remy authorises and
    // requires nothing (§43.4).
    recommended_product: "remy",
    free_tool_handoff: SETUP_KIT_HANDOFF,
    success_metric: "messages_to_book",
  },
};

/**
 * The one recommendation for a finding.
 *
 * `finding.condition` selects everything the owner reads; `answers`
 * supplies only the baseline, quoted from the question the metric is
 * read from. Nothing about the impact or either confidence is
 * consulted, and the finding itself is not copied into the result.
 */
export function recommendFor(finding: ScanFinding, answers: ScanAnswers): ScanRecommendation {
  const fixed = SCAN_RECOMMENDATIONS[finding.condition];
  return {
    condition: finding.condition,
    recommendation_code: fixed.recommendation_code,
    headline: fixed.headline,
    why_it_matters: fixed.why_it_matters,
    next_step: fixed.next_step,
    recommended_product: fixed.recommended_product,
    free_tool_handoff: fixed.free_tool_handoff,
    success_criterion: successCriterionFor(fixed.success_metric, answers),
    review_window_days: SCAN_REVIEW_WINDOW_DAYS,
    action_status: "proposed",
    authority_level: "recommend",
    source_type: "derived_deterministic",
    rule_set_version: SCAN_RULE_SET_VERSION,
  };
}
