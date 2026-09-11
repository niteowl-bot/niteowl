// ── Business Opportunity Scan, Phase 1: the nine questions ────────
//
// The single source of truth for the question set fixed by
// docs/ARCHITECTURE.md §87.2. The validator, the finding engine and the
// sizing module all read the allowed values from here, so a wording or
// value change is one edit and a version bump rather than four edits
// that can disagree.
//
// NINE QUESTIONS, EACH LOAD-BEARING (§87.2). Q1 and Q2 exist so a
// recommendation is not made to the wrong business. Q3 is the
// denominator and the consistency check. Q4–Q7 are the ONLY questions
// that can raise a finding. Q8 and Q9 exist SOLELY as operands of E1
// and raise nothing at all.
//
// NON-MANIPULATION RULES, BINDING ON ANY FUTURE WORDING CHANGE (§87.2):
//
//   A question asks what happens, never what it costs. "How much
//   business do you think you're losing?" is forbidden — it asks the
//   owner to assert the product's own conclusion.
//
//   No question presupposes a defect. Q2 asks when someone is
//   reachable, not "how often are you unavailable?".
//
//   "Not sure" is offered wherever it is a truthful answer, and
//   choosing it is never worse for the visitor than guessing. A design
//   that makes UNKNOWN feel like failure will manufacture the numbers
//   it needs.
//
//   The answer set is closed, ordered neutrally, and carries no
//   recommended option. There is no default, no pre-selection and no
//   "most businesses choose" hint anywhere in this file.
//
// EVERY ANSWER IS `business_provided` AND IS NEVER PROMOTED TO
// `verified` (§26, §87.2), including after consent (§89.4).

import type {
  ConversionShare,
  FollowupPractice,
  MessagesToBook,
  MissVisibility,
  ContactChannel,
  ReachableWindow,
  ScanQuestionId,
} from "@/lib/freetools/scanTypes";

/**
 * The question-set version, stored per run.
 *
 * A change to any wording, allowed value or required flag below is a
 * version change: it breaks comparability between runs, and
 * docs/AGENT_ACCESS_LAYER.md §25.2 requires that to be visible rather
 * than silent.
 */
export const SCAN_QUESTION_SET_VERSION = "v1";

/** The counted questions' bounds — §87.2's "0–999". */
export const SCAN_COUNT_MIN = 0;
export const SCAN_COUNT_MAX = 999;

/** Q1's allowed channels, in the order they are presented. */
export const CONTACT_CHANNELS: readonly ContactChannel[] = [
  "phone",
  "text_whatsapp",
  "email",
  "web_form",
  "social",
  "in_person",
  "other",
] as const;

/** Q2's allowed values. */
export const REACHABLE_WINDOWS: readonly ReachableWindow[] = [
  "working_hours",
  "extended",
  "any_time",
  "varies",
] as const;

/** Q5's allowed values. Note there is deliberately no "not sure". */
export const MISS_VISIBILITIES: readonly MissVisibility[] = [
  "yes_always",
  "sometimes",
  "no",
] as const;

/** Q6's allowed values. */
export const FOLLOWUP_PRACTICES: readonly FollowupPractice[] = [
  "within_a_day",
  "eventually",
  "only_if_they_return",
  "nothing_planned",
  "not_sure",
] as const;

/** Q7's allowed values. */
export const MESSAGES_TO_BOOK: readonly MessagesToBook[] = [
  "one",
  "two_or_three",
  "more_than_three",
  "varies_a_lot",
  "not_sure",
] as const;

/** Q9's allowed values. */
export const CONVERSION_SHARES: readonly ConversionShare[] = [
  "most",
  "about_half",
  "a_minority",
  "not_sure",
] as const;

/** How a question's answer is shaped. */
export type ScanAnswerKind =
  | "multi_select"
  | "single_select"
  | "count_or_not_sure"
  | "money_or_not_sure";

/** One question's contract. */
export interface ScanQuestion {
  readonly id: ScanQuestionId;
  /** The owner-facing wording, verbatim from §87.2. */
  readonly wording: string;
  readonly kind: ScanAnswerKind;
  /**
   * The closed value set for a select question; null for the counted
   * and money questions, whose bounds are numeric instead.
   */
  readonly allowedValues: readonly string[] | null;
  readonly required: boolean;
  /** Bounds for `count_or_not_sure`; null otherwise. */
  readonly min: number | null;
  readonly max: number | null;
  /**
   * What this answer may establish ON ITS OWN — §87.2's last column,
   * kept as data so it cannot drift from the finding engine.
   *
   * Q1, Q2, Q3, Q5, Q8 and Q9 establish NOTHING alone. A channel mix
   * is not a problem, being closed is not a defect, and a job value is
   * not a finding.
   */
  readonly establishesAlone: false | "condition" | "count_only";
}

/**
 * The nine questions, in presentation order.
 *
 * The order is the contract's order. It is neutral: no question leads
 * the next, and the two sizing operands sit last precisely so the run
 * cannot read as an attempt to reach a number.
 */
export const SCAN_QUESTIONS: readonly ScanQuestion[] = [
  {
    id: "q1_channels",
    wording: "How do customers usually get in touch with you?",
    kind: "multi_select",
    allowedValues: CONTACT_CHANNELS,
    required: true,
    min: null,
    max: null,
    establishesAlone: false,
  },
  {
    id: "q2_reachable",
    wording: "Roughly when can someone reach an actual person?",
    kind: "single_select",
    allowedValues: REACHABLE_WINDOWS,
    required: true,
    min: null,
    max: null,
    establishesAlone: false,
  },
  {
    id: "q3_enquiries_per_week",
    wording:
      "In a typical week, roughly how many new customer enquiries do you get?",
    kind: "count_or_not_sure",
    allowedValues: null,
    required: true,
    min: SCAN_COUNT_MIN,
    max: SCAN_COUNT_MAX,
    establishesAlone: false,
  },
  {
    id: "q4_unanswered_per_week",
    wording:
      "In a typical week, roughly how many of those go unanswered — nobody picks up, or nobody replies?",
    kind: "count_or_not_sure",
    allowedValues: null,
    // Not required: an owner who cannot say leaves it, and absence
    // establishes nothing rather than counting against them (§87.4).
    required: false,
    min: SCAN_COUNT_MIN,
    max: SCAN_COUNT_MAX,
    establishesAlone: "count_only",
  },
  {
    id: "q5_miss_visibility",
    wording:
      "When a call or message is missed, do you have a way of knowing it happened?",
    kind: "single_select",
    allowedValues: MISS_VISIBILITIES,
    required: true,
    min: null,
    max: null,
    // The honesty gate. It qualifies other evidence and establishes
    // nothing itself — without it a recollection would be
    // indistinguishable from a record.
    establishesAlone: false,
  },
  {
    id: "q6_followup",
    wording: "If someone enquires and doesn't book, what usually happens next?",
    kind: "single_select",
    allowedValues: FOLLOWUP_PRACTICES,
    required: true,
    min: null,
    max: null,
    // One of the two questions that IS the condition rather than
    // evidence about it (§87.3), which is why one answer suffices.
    establishesAlone: "condition",
  },
  {
    id: "q7_messages_to_book",
    wording: "How many messages or calls does it usually take to agree a time?",
    kind: "single_select",
    allowedValues: MESSAGES_TO_BOOK,
    required: true,
    min: null,
    max: null,
    establishesAlone: "condition",
  },
  {
    id: "q8_typical_job_value",
    wording: "Roughly what is a typical job or booking worth to you?",
    kind: "money_or_not_sure",
    allowedValues: null,
    required: false,
    min: null,
    max: null,
    establishesAlone: false,
  },
  {
    id: "q9_conversion_share",
    wording: "Of the enquiries you do answer, roughly what share become work?",
    kind: "single_select",
    allowedValues: CONVERSION_SHARES,
    required: false,
    min: null,
    max: null,
    establishesAlone: false,
  },
] as const;

/** The nine ids, in contract order. The set is closed. */
export const SCAN_QUESTION_IDS: readonly ScanQuestionId[] = SCAN_QUESTIONS.map(
  (q) => q.id
);

/** One question's contract by id, or undefined for an unknown id. */
export function scanQuestion(id: string): ScanQuestion | undefined {
  return SCAN_QUESTIONS.find((q) => q.id === id);
}
