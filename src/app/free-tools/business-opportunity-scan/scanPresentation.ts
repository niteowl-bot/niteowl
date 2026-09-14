// ── Business Opportunity Scan: presentation only ──────────────────
//
// This file translates CANONICAL CODES INTO OWNER-READABLE WORDS, and
// converts what the visitor typed into the payload the shipped Scan
// validator expects. It decides nothing. Every rule about what a
// finding is, what it is worth, how confident it is and what it
// recommends lives in src/lib/freetools/scan*.ts, and this file reads
// those results without touching them (docs/ARCHITECTURE.md §84.2).
//
// ONE SOURCE OF TRUTH FOR THE QUESTIONS. The question wording, order,
// allowed values, required flags and bounds are read from
// SCAN_QUESTIONS; nothing here restates them. The only data this file
// owns is the label beside each code — §87.2's own wording for each
// option — and a test pins that every canonical value has one, so a
// value added to the contract cannot reach the screen unnamed.
//
// NO PERSISTENCE, NO IDENTITY, NO NETWORK. The draft is a plain object
// that lives in one React state and nowhere else. No storage API, no
// cookie, no run id, no fetch.
//
// NO REPAIR. `draftToPayload` never coerces a malformed answer into a
// valid one. A blank optional answer is ABSENT (the key is omitted); a
// blank required answer is also absent, so the validator — the single
// authority — is what reports it. "Not sure" is an explicit choice the
// visitor makes, never a default the page supplies (§87.2).

import type {
  ScanAnswerValue,
  ScanConfidence,
  ScanConfidenceCapReason,
  ScanQuestionId,
  ScanRecommendedProduct,
  LostRevenueUnknownReason,
  EstimateResult,
  ScanDependencyRelation,
  ScanDependencyRuleCode,
  ScanEarliestLeak,
  ScanEvidenceGapBlocks,
  ScanFunnelStageId,
  ScanGapEffortBand,
  ScanImpactClass,
  ScanInformationGain,
  ScanStageAssessment,
  ScanStageKind,
  ScanStageNotEstablishedReason,
  ScanStageState,
  ScanClusterRelation,
  ScanClusterRuleCode,
  ScanHypothesisRankReason,
} from "@/lib/freetools/scanTypes";
import type { ScanValidationErrorCode } from "@/lib/freetools/scanValidation";
import { SCAN_QUESTIONS } from "@/lib/freetools/scanQuestions";

// ── Labels for canonical answer values ────────────────────────────
//
// Keyed by the canonical value. The values across the nine questions
// are distinct except `not_sure`, which means the same thing wherever
// it appears. Wording follows §87.2's allowed-values column.

export const VALUE_LABELS: Readonly<Record<string, string>> = {
  // Q1
  phone: "Phone",
  text_whatsapp: "Text or WhatsApp",
  email: "Email",
  web_form: "Website form",
  social: "Social media message",
  in_person: "In person",
  other: "Other",
  // Q2
  working_hours: "Working hours only",
  extended: "Extended hours",
  any_time: "Any time",
  varies: "It varies",
  // Q5
  yes_always: "Yes, always",
  sometimes: "Sometimes",
  no: "No",
  // Q6
  within_a_day: "Someone follows up within a day",
  eventually: "Someone follows up eventually",
  only_if_they_return: "Only if they get in touch again",
  nothing_planned: "Nothing planned",
  // Q7
  one: "One",
  two_or_three: "Two or three",
  more_than_three: "More than three",
  varies_a_lot: "It varies a lot",
  // Q9
  most: "Most (about 2 in 3 or more)",
  about_half: "About half",
  a_minority: "A minority (about 1 in 3 or fewer)",
  // Shared
  not_sure: "Not sure",
};

export const NOT_SURE_LABEL = VALUE_LABELS.not_sure;

/** The label for a canonical select value; the code itself if unlabelled. */
export function valueLabel(value: string): string {
  return VALUE_LABELS[value] ?? value;
}

/** Whole numbers with a thousands separator, without a locale API. */
function formatWhole(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A money figure exactly as given: the code, a space, the number. */
export function formatMoney(amount: number, currency: string): string {
  return `${currency} ${formatWhole(amount)}`;
}

/**
 * One answer as the visitor gave it, in words.
 *
 * Counts and money are rendered from their own value; select answers
 * through the label map; a multi-select as a comma-separated list in
 * the order chosen. Nothing is summarised or normalised.
 */
export function answerLabel(value: ScanAnswerValue): string {
  if (Array.isArray(value)) {
    return (value as readonly string[]).map(valueLabel).join(", ");
  }
  if (typeof value === "string") return valueLabel(value);
  const v = value as Exclude<ScanAnswerValue, string | readonly string[]>;
  switch (v.kind) {
    case "not_sure":
      return NOT_SURE_LABEL;
    case "count":
      return formatWhole(v.value);
    case "amount":
      return formatMoney(v.amount, v.currency);
    case "range":
      return `${formatMoney(v.low, v.currency)} to ${formatMoney(v.high, v.currency)}`;
  }
}

// ── Labels for the codes the report carries ───────────────────────

export const CONFIDENCE_LABELS: Readonly<Record<ScanConfidence, string>> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

/** Why a confidence was capped, in the owner's terms — §87.3 says the cap is displayed. */
export const CAP_REASON_LABELS: Readonly<Record<ScanConfidenceCapReason, string>> = {
  q5_no_miss_visibility:
    "You told us you have no way of knowing when a call or message is missed, so this rests on recollection rather than a record.",
  q5_partial_miss_visibility:
    "You told us you only sometimes know when a call or message is missed, so part of this rests on recollection.",
  q7_varies_a_lot:
    "You told us the number of messages varies a lot, so the pattern is less clear than a steady number would make it.",
  q9_wide_conversion_bucket:
    "You gave the share of enquiries that become work as a broad bucket, so the size can only be rough.",
  q8_value_range:
    "You gave a typical job value as a range, so the size is a range too.",
};

/** Why a finding could not be sized — §82.3's first-class "we cannot size this". */
export const UNKNOWN_REASON_LABELS: Readonly<Record<LostRevenueUnknownReason, string>> = {
  no_permitted_expression:
    "There is no honest way to put a figure on this from the answers a business can give, so we have not tried.",
  q4_missing: "You did not give a number of unanswered enquiries.",
  q4_not_sure: "You told us you are not sure how many enquiries go unanswered.",
  q4_zero: "You told us no enquiries go unanswered.",
  q4_exceeds_q3:
    "The number of unanswered enquiries you gave is higher than the number of enquiries you receive.",
  q5_no_miss_visibility:
    "You told us you have no way of knowing when a call or message is missed.",
  q8_missing: "You did not give a typical job value.",
  q8_not_sure: "You told us you are not sure what a typical job is worth.",
  q9_missing: "You did not say what share of the enquiries you answer become work.",
  q9_not_sure:
    "You told us you are not sure what share of the enquiries you answer become work.",
  range_spans_more_than_one_order_of_magnitude:
    "The range your answers produce is so wide that it would not tell you anything useful.",
};

/**
 * Validation refusals in the owner's terms.
 *
 * The validator's own messages name question ids and are written for
 * a developer; the rule behind each code is unchanged and is still the
 * validator's alone — this only says it in plain words.
 */
export const ERROR_LABELS: Readonly<Record<ScanValidationErrorCode, string>> = {
  not_an_object: "Something went wrong with your answers. Please start again.",
  unexpected_question: "Something went wrong with your answers. Please start again.",
  required: "Please answer this question.",
  malformed: "This answer is not in a form we can read. Please choose or enter it again.",
  unknown_value: "Please choose one of the options offered.",
  empty_selection: "Choose at least one option.",
  duplicate_value: "An option was chosen more than once.",
  not_an_integer: "Enter a whole number, or choose “Not sure”.",
  out_of_range: "Enter a number between 0 and 999.",
  not_positive: "Enter an amount above zero.",
  range_inverted: "The low end must not be higher than the high end.",
  invalid_currency: "Choose a currency, or enter a three-letter currency code.",
};

/**
 * Where a recommended product is named, a NEUTRAL ATTRIBUTION and no
 * more (§84.3, G4): it says where the answer lives at NiteOwl. It is
 * not an instruction, not an offer, and it authorises nothing.
 */
export const PRODUCT_ATTRIBUTION: Readonly<Record<ScanRecommendedProduct, string>> = {
  remy: "At NiteOwl, this is the type of problem Remy is designed to address.",
};

/** Q8 currency shortlist. Presentation only; any ISO code may be typed. No default. */
export const CURRENCY_CHOICES: readonly string[] = ["EUR", "GBP", "USD"];
export const OTHER_CURRENCY = "other";

/** A report with no findings is a real answer (§87.4), and this is how it is said. */
export const NO_FINDINGS_WORDING =
  "We could not establish a clear opportunity from the information provided. That is a real result, not a failure: nothing in your answers pointed to one of the three things this scan looks for.";

/** Impact as a range: both ends, the owner's currency, per week — never annualised, never a midpoint. */
export function formatImpactRange(result: EstimateResult): string {
  return `Between ${formatMoney(result.low, result.currency)} and ${formatMoney(
    result.high,
    result.currency
  )} per ${result.period}`;
}

// ── Draft state ───────────────────────────────────────────────────
//
// What the visitor has typed or chosen so far, keyed by question id and
// shaped by the question's KIND. Strings stay strings until
// `draftToPayload`, which is the one place they become the canonical
// answer shapes.

export interface CountDraft {
  /** null until the visitor chooses to give a number or say "not sure". */
  readonly mode: "count" | "not_sure" | null;
  readonly value: string;
}

export interface MoneyDraft {
  readonly mode: "amount" | "range" | "not_sure" | null;
  readonly amount: string;
  readonly low: string;
  readonly high: string;
  /** "" until chosen; a CURRENCY_CHOICES entry; or OTHER_CURRENCY. */
  readonly currency: string;
  /** The typed code when `currency` is OTHER_CURRENCY. */
  readonly otherCurrency: string;
}

export type DraftValue = readonly string[] | string | null | CountDraft | MoneyDraft;

export type ScanDraft = Readonly<Record<ScanQuestionId, DraftValue>>;

/** An empty draft: no answer chosen for any question, and no default. */
export function emptyDraft(): ScanDraft {
  const draft: Partial<Record<ScanQuestionId, DraftValue>> = {};
  for (const q of SCAN_QUESTIONS) {
    switch (q.kind) {
      case "multi_select":
        draft[q.id] = [];
        break;
      case "single_select":
        draft[q.id] = null;
        break;
      case "count_or_not_sure":
        draft[q.id] = { mode: null, value: "" };
        break;
      case "money_or_not_sure":
        draft[q.id] = {
          mode: null,
          amount: "",
          low: "",
          high: "",
          currency: "",
          otherCurrency: "",
        };
        break;
    }
  }
  return draft as ScanDraft;
}

/** A typed whole number, as a number; anything else exactly as typed. */
function wholeNumberOrRaw(text: string): unknown {
  const t = text.trim();
  return /^\d+$/.test(t) ? Number(t) : t;
}

/** A typed decimal amount, as a number; anything else exactly as typed. */
function decimalOrRaw(text: string): unknown {
  const t = text.trim();
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : t;
}

/** The currency the visitor chose or typed, trimmed and otherwise untouched. */
function currencyOf(m: MoneyDraft): unknown {
  return m.currency === OTHER_CURRENCY ? m.otherCurrency.trim() : m.currency;
}

/**
 * The draft as the payload `validateScanAnswers` expects.
 *
 * ABSENT MEANS ABSENT. A question the visitor has not answered is left
 * out entirely — required or not — and the validator decides what that
 * means. A number is converted only when it is plainly a number;
 * anything else is passed through as typed so the validator, not this
 * function, refuses it. No key is ever added that is not one of the
 * nine, and no value is ever substituted.
 */
export function draftToPayload(draft: ScanDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const q of SCAN_QUESTIONS) {
    const d = draft[q.id];
    switch (q.kind) {
      case "multi_select": {
        const chosen = d as readonly string[];
        if (chosen.length > 0) payload[q.id] = [...chosen];
        break;
      }
      case "single_select": {
        if (typeof d === "string" && d !== "") payload[q.id] = d;
        break;
      }
      case "count_or_not_sure": {
        const c = d as CountDraft;
        if (c.mode === "not_sure") payload[q.id] = { kind: "not_sure" };
        else if (c.mode === "count" && c.value.trim() !== "") {
          payload[q.id] = { kind: "count", value: wholeNumberOrRaw(c.value) };
        }
        break;
      }
      case "money_or_not_sure": {
        const m = d as MoneyDraft;
        if (m.mode === "not_sure") payload[q.id] = { kind: "not_sure" };
        else if (m.mode === "amount" && m.amount.trim() !== "") {
          payload[q.id] = {
            kind: "amount",
            amount: decimalOrRaw(m.amount),
            currency: currencyOf(m),
          };
        } else if (m.mode === "range" && (m.low.trim() !== "" || m.high.trim() !== "")) {
          payload[q.id] = {
            kind: "range",
            low: decimalOrRaw(m.low),
            high: decimalOrRaw(m.high),
            currency: currencyOf(m),
          };
        }
        break;
      }
    }
  }
  return payload;
}

// ── PR D: labels for the diagnosis layer ──────────────────────────
//
// STILL PRESENTATION ONLY. Every judgement below was made by a pure
// module: which stage a finding sits at, what order to work in and why,
// what relates to what, how an impact should be spoken about, and what
// is missing. This file names the codes and adds no rule of its own.
//
// A label that is a claim is written as a claim ABOUT WHAT THE OWNER
// TOLD US. "This looks like it is working" is qualified everywhere it
// appears, because the Scan has looked at nothing (§84.1).

export const STAGE_LABELS: Readonly<Record<ScanFunnelStageId, string>> = {
  enquiry_received: "Enquiries reaching you",
  enquiry_answered: "Enquiries getting an answer",
  time_agreed: "Agreeing a time",
  work_booked: "Enquiries becoming work",
  enquiry_followed_up: "Following up the ones that did not book",
};

/** One stage's label; the id itself if somehow unlabelled. */
export function stageLabel(stageId: ScanFunnelStageId): string {
  return STAGE_LABELS[stageId] ?? stageId;
}

/**
 * The state of OUR knowledge of a stage — not its health.
 *
 * `derived` is labelled although Phase 1 never produces it: an
 * unlabelled canonical value is how a code reaches the screen raw.
 */
export const STAGE_STATE_LABELS: Readonly<Record<ScanStageState, string>> = {
  owner_declared: "From your answers",
  derived: "Worked out from your answers",
  unknown: "Not established",
  inconsistent: "Your answers disagree here",
};

/** What the funnel says about a stage, in the owner's terms. */
export const STAGE_ASSESSMENT_LABELS: Readonly<
  Record<ScanStageAssessment, string>
> = {
  finding: "Something to look at",
  appears_adequate: "From what you told us, this looks like it is working",
  not_established: "We could not establish this",
  not_assessed: "Context only — this scan does not judge this stage",
};

/** Why adequacy could not be claimed — §87.3's "the cap is displayed", generalised. */
export const STAGE_NOT_ESTABLISHED_LABELS: Readonly<
  Record<ScanStageNotEstablishedReason, string>
> = {
  answer_not_given: "You did not answer the question this rests on.",
  owner_not_sure: "You told us you are not sure, which we take at face value.",
  answers_inconsistent:
    "Two of your answers here disagree, so we have not drawn anything from them.",
  no_way_of_knowing:
    "You told us no enquiries go unanswered, and also that you have no way of knowing when one is missed. We are not treating that as either good or bad news.",
};

/**
 * Why a stage is marked context only.
 *
 * SAID OUT LOUD RATHER THAN LEFT AS SILENCE. A stage shown with no
 * verdict invites the reader to supply one, and the two stages this
 * covers are exactly the two where an invented verdict would reach a
 * domain the Scan has no evidence for.
 */
export const STAGE_NOT_ASSESSED_NOTE: Readonly<
  Partial<Record<ScanFunnelStageId, string>>
> = {
  enquiry_received:
    "How many enquiries you get is not something this scan judges — it looks at what happens to the ones you already have.",
  work_booked:
    "The share of enquiries that become work is used for sizing, and this scan does not draw a conclusion from it on its own.",
};

/** The kind of stage. Follow-up is a recovery step, not a forward one. */
export const STAGE_KIND_LABELS: Readonly<Record<ScanStageKind, string>> = {
  forward: "On the way through",
  recovery: "After a booking did not happen",
};

/** How an impact may be spoken about — §106's four states. */
export const IMPACT_CLASS_LABELS: Readonly<Record<ScanImpactClass, string>> = {
  quantified: "Sized, as a range",
  directional: "Real, but we will not put a size on it",
  material_unquantifiable: "Real, and not something anyone can size honestly",
  insufficient_evidence: "Not enough to size it",
};

/** What an evidence gap is holding back (§105). */
export const GAP_BLOCKS_LABELS: Readonly<Record<ScanEvidenceGapBlocks, string>> = {
  diagnosis: "looking at this part of the path at all",
  prioritisation: "deciding where this sits in the order",
  sizing: "putting a range on it",
  action: "recommending a next step",
  confidence: "holding this more confidently",
};

/**
 * What closing a gap would do — FOR NITEOWL'S RULES, never for the
 * business (§105).
 *
 * Each of these is checkable against a gate in the sizing module. None
 * of them says anything about what the owner would find, and none may
 * ever be rewritten to.
 */
export const INFORMATION_GAIN_LABELS: Readonly<
  Record<ScanInformationGain, string>
> = {
  would_allow_a_size_range: "This would let our rules put a range on it.",
  would_narrow_the_size_range: "This would let our rules work to a narrower range.",
  would_raise_confidence: "This would let our rules hold it more confidently.",
  would_allow_this_stage_to_be_assessed:
    "This would let our rules look at that part of the path at all.",
};

/** Roughly what closing a gap takes. Bands, never hours and never money. */
export const GAP_EFFORT_LABELS: Readonly<Record<ScanGapEffortBand, string>> = {
  answer_now: "You could answer this now",
  count_over_a_period: "This needs counting over a little while",
  needs_a_change_in_how_you_work: "This needs a change in how you work",
};

/** How two findings relate in the order they can be worked on (§104). */
export const DEPENDENCY_RELATION_LABELS: Readonly<
  Record<ScanDependencyRelation, string>
> = {
  blocked_by: "Waits on",
  should_precede: "Comes before",
  should_follow: "Comes after",
  independent: "Separate from",
};

/** The canonical rule behind a dependency — §104 forbids one without. */
export const DEPENDENCY_RULE_LABELS: Readonly<
  Record<ScanDependencyRuleCode, string>
> = {
  stage_order: "the order of the path an enquiry takes",
  measurement_integrity: "how reliably this can be measured",
  capacity_headroom: "how much room there is to take more work",
  conversion_before_volume: "settling conversion before chasing volume",
};

// ── Fixed section wording ─────────────────────────────────────────

export const FUNNEL_SECTION_TITLE = "Where your enquiries are going";
export const FUNNEL_SECTION_NOTE =
  "The path your own answers describe, in order. We have not looked at any of your systems — this is your description, laid out.";

export const PRIORITY_SECTION_TITLE = "Where to start";

/**
 * The disclaimer under the priority list.
 *
 * NOT OPTIONAL, AND NOT A FOOTNOTE. Ordering findings is the closest
 * the Scan comes to Atlas's territory, and this sentence is the line
 * §100.3 draws: order and adjacency, never cause.
 */
export const PRIORITY_ORDER_NOT_CAUSE =
  "This is the order we would work in, based on where each one sits on the path an enquiry takes. It is not a claim that any of them causes another.";

export const DEPENDENCY_SECTION_TITLE = "How these relate";
export const GAPS_SECTION_TITLE = "What would sharpen this";
export const GAPS_SECTION_NOTE =
  "These are things that would let our own rules go further. None of them is a guess about what you would find.";

/** The earliest-leak sentences, built from fixed fragments. */
export function earliestLeakSentences(leak: ScanEarliestLeak): string[] {
  const list = (ids: readonly ScanFunnelStageId[]) =>
    ids.map((id) => stageLabel(id).toLowerCase()).join(", ");

  const sentences = [
    `The earliest point we can see something going wrong is: ${stageLabel(
      leak.stage_id
    )}.`,
  ];

  if (leak.earlier_stages_adequate.length > 0) {
    sentences.push(
      `From what you told us, ${list(
        leak.earlier_stages_adequate
      )} does not look like the immediate problem.`
    );
  }

  // The honesty clause. Without it, "earliest" quietly implies that
  // nothing earlier is wrong — which the answers do not support when an
  // earlier stage was never established at all.
  if (leak.earlier_stages_not_established.length > 0) {
    sentences.push(
      `We could not establish anything about ${list(
        leak.earlier_stages_not_established
      )}, so this is the earliest point we can speak to — not necessarily the earliest point where work is being lost.`
    );
  }

  return sentences;
}

// ── PR E: labels for clusters ─────────────────────────────────────
//
// STILL PRESENTATION ONLY. Which relation holds between two findings,
// and how confident we are in that relation, were decided by a pure
// module. This file names the codes and adds no rule of its own.
//
// THE INDEPENDENT SUMMARY IS THE CAREFUL ONE. Rendering a row per
// unrelated pair would pad the report with non-statements; rendering
// nothing would let the reader supply a connection we never made.
// One sentence, saying what our rules did and did not establish.

export const CLUSTER_RELATION_LABELS: Readonly<
  Record<ScanClusterRelation, string>
> = {
  sequential_in_one_process: "Two points on one path",
  shared_cause_candidate: "May share a cause",
  competing_for_same_resource: "Compete for the same attention",
  masked_measurement: "One makes the other harder to measure",
  independent: "No link established",
};

/** The canonical rule behind a relation — §102 forbids one without. */
export const CLUSTER_RULE_LABELS: Readonly<Record<ScanClusterRuleCode, string>> = {
  adjacent_funnel_stages: "these sit next to each other on the enquiry path",
  intersecting_hypotheses: "the possible explanations overlap",
  shared_owner_resource: "both need the same attention from you",
  upstream_integrity_gap: "an earlier gap affects how reliable the later answer is",
  no_relation_rule_fired: "none of our rules related them",
};

/**
 * The one sentence that stands in for every `independent` pair.
 *
 * NOT "these are unrelated". The Scan has not established a link, and
 * saying that plainly is what stops an absence of evidence being read
 * as evidence of absence.
 */
export const CLUSTERS_NONE_ESTABLISHED_WORDING =
  "No link has been established between the other findings. Our rules did not relate them, which is not the same as knowing they are separate — where nothing has been established, we say so rather than filling the gap.";

// ── PR F: labels for hypotheses ───────────────────────────────────
//
// STILL PRESENTATION ONLY. Which candidate explanations a finding's
// answers support, and how confident we are in each, were decided by a
// pure module. This file names the section and adds no rule of its own.
//
// THE WORDING STAYS TENTATIVE. A hypothesis is the Scan's ceiling
// (§103): it may say "may", "could" and "suggests", and it may never say
// "because". The empty case is a real answer, not a gap — nothing is
// invented to fill it.

export const HYPOTHESES_SECTION_TITLE = "What might be behind this";
export const HYPOTHESES_SECTION_NOTE =
  "Possible explanations your own answers support. These are candidates to look into, ranked, not a diagnosis — none of them is presented as the reason.";
export const HYPOTHESES_NONE_WORDING =
  "Your answers don't point to a particular reason.";
export const HYPOTHESIS_RANK_REASON_LABELS: Readonly<
  Record<ScanHypothesisRankReason, string>
> = {
  more_evidence: "more of your answers support this",
  rule_table_order: "listed in the order our rules consider them",
};
