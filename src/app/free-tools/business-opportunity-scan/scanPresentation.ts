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
