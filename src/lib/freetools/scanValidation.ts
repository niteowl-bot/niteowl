// ── Business Opportunity Scan, Phase 1: the validator ─────────────
//
// A small hand-written pure validator over the nine-question contract
// (docs/ARCHITECTURE.md §87.2). No dependency is added: this project
// validates by hand everywhere else, and a schema library here would
// put the contract in two places — the library's schema and the
// architecture document — with nothing keeping them agreed.
//
// IT NEVER REPAIRS AND IT NEVER COERCES. A malformed value is reported
// as malformed and thrown away; it is never rounded, clamped, trimmed
// into validity, parsed out of a string or nudged toward the nearest
// legal value. The reason is §87.4's rule: a wrong answer accepted
// quietly becomes evidence, and evidence is what the whole product is
// judged on.
//
// A BLANK IS NEVER "NOT SURE". They are different answers and they
// stay different: "not sure" is something the owner told us, and an
// absent optional answer is something they did not tell us. Collapsing
// the two would let silence manufacture an operand, which §82.2
// forbids. Nothing here supplies a default for any question.
//
// THE Q4 > Q3 INCONSISTENCY IS SURFACED, NOT RESOLVED (§87.4). More
// unanswered enquiries than enquiries cannot both be true, and the
// validator says so — without changing either value, without picking a
// winner, and without making the run invalid. It suppresses the
// finding that would have rested on it (§88.3); it does not reject the
// owner's input.
//
// THE SAME VALIDATOR SERVES BOTH SIDES. It is pure and free of React,
// of the network and of any request object, so the UI can run it as a
// visitor types and a later server recomputation can run the identical
// rules over a stored run. Two validators would eventually disagree,
// and the one that disagreed silently would be the one in production.

import {
  CONTACT_CHANNELS,
  CONVERSION_SHARES,
  FOLLOWUP_PRACTICES,
  MESSAGES_TO_BOOK,
  MISS_VISIBILITIES,
  REACHABLE_WINDOWS,
  SCAN_COUNT_MAX,
  SCAN_COUNT_MIN,
  SCAN_QUESTION_IDS,
} from "@/lib/freetools/scanQuestions";
import type {
  ContactChannel,
  ConversionShare,
  CountAnswer,
  FollowupPractice,
  MessagesToBook,
  MissVisibility,
  MoneyAnswer,
  ReachableWindow,
  ScanAnswers,
  ScanInconsistency,
  ScanQuestionId,
} from "@/lib/freetools/scanTypes";

/** Why a value was refused. Codes, not prose (§20.7 rule 1). */
export type ScanValidationErrorCode =
  | "not_an_object"
  | "unexpected_question"
  | "required"
  | "malformed"
  | "unknown_value"
  | "empty_selection"
  | "duplicate_value"
  | "not_an_integer"
  | "out_of_range"
  | "not_positive"
  | "range_inverted"
  | "invalid_currency";

/** One refusal, tied to the question it came from. */
export interface ScanValidationError {
  /** null only for whole-payload problems, e.g. not an object at all. */
  readonly question_id: ScanQuestionId | null;
  readonly code: ScanValidationErrorCode;
  readonly message: string;
}

/**
 * The validator's whole answer.
 *
 * `valid` reflects ERRORS ONLY. An inconsistency is a truthful report
 * about answers that are each individually well formed, so it never
 * makes a run invalid — it is shown to the owner and it suppresses a
 * finding, which is a different thing from rejecting their input.
 */
export interface ScanValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ScanValidationError[];
  readonly inconsistencies: readonly ScanInconsistency[];
  /** The validated answers, or null when anything was refused. */
  readonly answers: ScanAnswers | null;
}

const err = (
  question_id: ScanQuestionId | null,
  code: ScanValidationErrorCode,
  message: string
): ScanValidationError => ({ question_id, code, message });

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Absent means "not answered". A blank string is malformed, not absent. */
const isAbsent = (v: unknown): boolean => v === undefined || v === null;

/**
 * A count answer: `{kind:"count", value}` with an integer in range, or
 * `{kind:"not_sure"}`.
 *
 * The integer test is deliberately strict — no string, no float, no
 * NaN, no Infinity. "3" is not 3 here: accepting it would be a silent
 * coercion, and the caller that produced it has a bug worth seeing.
 */
function readCount(
  id: ScanQuestionId,
  raw: unknown,
  errors: ScanValidationError[]
): CountAnswer | null {
  if (!isRecord(raw)) {
    errors.push(err(id, "malformed", `${id}: expected an answer object`));
    return null;
  }
  if (raw.kind === "not_sure") {
    // A first-class answer. It carries no value and needs none.
    return { kind: "not_sure" };
  }
  if (raw.kind !== "count") {
    errors.push(err(id, "unknown_value", `${id}: unknown answer kind`));
    return null;
  }
  const value = raw.value;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    errors.push(err(id, "not_an_integer", `${id}: a count must be a whole number`));
    return null;
  }
  if (value < SCAN_COUNT_MIN || value > SCAN_COUNT_MAX) {
    errors.push(
      err(
        id,
        "out_of_range",
        `${id}: a count must be between ${SCAN_COUNT_MIN} and ${SCAN_COUNT_MAX}`
      )
    );
    return null;
  }
  return { kind: "count", value };
}

/** Three uppercase letters. The owner's own currency; nothing converts it. */
const isCurrencyCode = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Z]{3}$/.test(v);

/** A finite money amount, strictly greater than zero (§87.2). */
const isPositiveMoney = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * Q8: an amount, a range, or "not sure".
 *
 * Zero and negative values are refused rather than corrected: a job
 * worth nothing is not a typical job, and it would drive an E1 result
 * of zero that reads like a measurement.
 */
function readMoney(
  id: ScanQuestionId,
  raw: unknown,
  errors: ScanValidationError[]
): MoneyAnswer | null {
  if (!isRecord(raw)) {
    errors.push(err(id, "malformed", `${id}: expected an answer object`));
    return null;
  }
  if (raw.kind === "not_sure") return { kind: "not_sure" };

  if (raw.kind === "amount") {
    if (!isPositiveMoney(raw.amount)) {
      errors.push(err(id, "not_positive", `${id}: an amount must be above zero`));
      return null;
    }
    if (!isCurrencyCode(raw.currency)) {
      errors.push(
        err(id, "invalid_currency", `${id}: a three-letter currency code is required`)
      );
      return null;
    }
    return { kind: "amount", amount: raw.amount, currency: raw.currency };
  }

  if (raw.kind === "range") {
    if (!isPositiveMoney(raw.low) || !isPositiveMoney(raw.high)) {
      errors.push(
        err(id, "not_positive", `${id}: both ends of a range must be above zero`)
      );
      return null;
    }
    if (raw.low > raw.high) {
      // Not swapped. A caller that sent them the wrong way round has a
      // bug, and quietly reordering it hides the bug in the owner's data.
      errors.push(
        err(id, "range_inverted", `${id}: the low end must not exceed the high end`)
      );
      return null;
    }
    if (!isCurrencyCode(raw.currency)) {
      errors.push(
        err(id, "invalid_currency", `${id}: a three-letter currency code is required`)
      );
      return null;
    }
    return { kind: "range", low: raw.low, high: raw.high, currency: raw.currency };
  }

  errors.push(err(id, "unknown_value", `${id}: unknown answer kind`));
  return null;
}

/** A closed single-select value, or null with an error recorded. */
function readChoice<T extends string>(
  id: ScanQuestionId,
  raw: unknown,
  allowed: readonly T[],
  errors: ScanValidationError[]
): T | null {
  if (typeof raw !== "string") {
    errors.push(err(id, "malformed", `${id}: expected one of the allowed values`));
    return null;
  }
  if (!(allowed as readonly string[]).includes(raw)) {
    errors.push(err(id, "unknown_value", `${id}: "${raw}" is not an allowed value`));
    return null;
  }
  return raw as T;
}

/**
 * Validate one payload against the nine-question contract.
 *
 * Accepts `unknown` deliberately: the caller is a form, and a validator
 * that requires its input to already be the right shape validates
 * nothing.
 */
export function validateScanAnswers(input: unknown): ScanValidationResult {
  const errors: ScanValidationError[] = [];
  const inconsistencies: ScanInconsistency[] = [];

  if (!isRecord(input)) {
    return {
      valid: false,
      errors: [err(null, "not_an_object", "expected an answers object")],
      inconsistencies: [],
      answers: null,
    };
  }

  // The contract is EXACTLY nine questions. An extra key is refused
  // rather than ignored: a tenth question that nothing validates is how
  // an unreviewed input reaches a finding.
  for (const key of Object.keys(input)) {
    if (!(SCAN_QUESTION_IDS as readonly string[]).includes(key)) {
      errors.push(err(null, "unexpected_question", `"${key}" is not part of the scan`));
    }
  }

  // ── Q1 — multi-select, at least one ────────────────────────────
  let q1: ContactChannel[] | null = null;
  const rawQ1 = input.q1_channels;
  if (isAbsent(rawQ1)) {
    errors.push(err("q1_channels", "required", "q1_channels: an answer is required"));
  } else if (!Array.isArray(rawQ1)) {
    errors.push(err("q1_channels", "malformed", "q1_channels: expected a list"));
  } else if (rawQ1.length === 0) {
    errors.push(
      err("q1_channels", "empty_selection", "q1_channels: choose at least one")
    );
  } else {
    const seen = new Set<string>();
    let ok = true;
    for (const entry of rawQ1) {
      if (typeof entry !== "string" || !(CONTACT_CHANNELS as readonly string[]).includes(entry)) {
        errors.push(
          err("q1_channels", "unknown_value", "q1_channels: unknown channel")
        );
        ok = false;
        continue;
      }
      if (seen.has(entry)) {
        errors.push(
          err("q1_channels", "duplicate_value", `q1_channels: "${entry}" repeats`)
        );
        ok = false;
        continue;
      }
      seen.add(entry);
    }
    if (ok) {
      // Presentation order, not tick order, so two runs with the same
      // selection produce byte-identical evidence.
      q1 = CONTACT_CHANNELS.filter((c) => seen.has(c));
    }
  }

  // ── Q2 — required single-select ────────────────────────────────
  let q2: ReachableWindow | null = null;
  if (isAbsent(input.q2_reachable)) {
    errors.push(err("q2_reachable", "required", "q2_reachable: an answer is required"));
  } else {
    q2 = readChoice("q2_reachable", input.q2_reachable, REACHABLE_WINDOWS, errors);
  }

  // ── Q3 — required count or "not sure" ──────────────────────────
  let q3: CountAnswer | null = null;
  if (isAbsent(input.q3_enquiries_per_week)) {
    errors.push(
      err("q3_enquiries_per_week", "required", "q3_enquiries_per_week: an answer is required")
    );
  } else {
    q3 = readCount("q3_enquiries_per_week", input.q3_enquiries_per_week, errors);
  }

  // ── Q4 — optional count or "not sure" ──────────────────────────
  let q4: CountAnswer | null = null;
  if (!isAbsent(input.q4_unanswered_per_week)) {
    q4 = readCount("q4_unanswered_per_week", input.q4_unanswered_per_week, errors);
  }

  // ── Q5 — required single-select, no "not sure" ─────────────────
  let q5: MissVisibility | null = null;
  if (isAbsent(input.q5_miss_visibility)) {
    errors.push(
      err("q5_miss_visibility", "required", "q5_miss_visibility: an answer is required")
    );
  } else {
    q5 = readChoice("q5_miss_visibility", input.q5_miss_visibility, MISS_VISIBILITIES, errors);
  }

  // ── Q6 — required single-select ────────────────────────────────
  let q6: FollowupPractice | null = null;
  if (isAbsent(input.q6_followup)) {
    errors.push(err("q6_followup", "required", "q6_followup: an answer is required"));
  } else {
    q6 = readChoice("q6_followup", input.q6_followup, FOLLOWUP_PRACTICES, errors);
  }

  // ── Q7 — required single-select ────────────────────────────────
  let q7: MessagesToBook | null = null;
  if (isAbsent(input.q7_messages_to_book)) {
    errors.push(
      err("q7_messages_to_book", "required", "q7_messages_to_book: an answer is required")
    );
  } else {
    q7 = readChoice("q7_messages_to_book", input.q7_messages_to_book, MESSAGES_TO_BOOK, errors);
  }

  // ── Q8 — optional money or "not sure" ──────────────────────────
  let q8: MoneyAnswer | null = null;
  if (!isAbsent(input.q8_typical_job_value)) {
    q8 = readMoney("q8_typical_job_value", input.q8_typical_job_value, errors);
  }

  // ── Q9 — optional single-select ────────────────────────────────
  let q9: ConversionShare | null = null;
  if (!isAbsent(input.q9_conversion_share)) {
    q9 = readChoice("q9_conversion_share", input.q9_conversion_share, CONVERSION_SHARES, errors);
  }

  if (errors.length > 0) {
    return { valid: false, errors, inconsistencies: [], answers: null };
  }

  // Both well formed, and they contradict each other. Reported, and
  // NEITHER IS CHANGED (§87.4).
  if (
    q3 !== null &&
    q4 !== null &&
    q3.kind === "count" &&
    q4.kind === "count" &&
    q4.value > q3.value
  ) {
    inconsistencies.push({
      code: "q4_exceeds_q3",
      question_ids: ["q3_enquiries_per_week", "q4_unanswered_per_week"],
      message:
        "You told us more enquiries go unanswered each week than you receive. We have not changed either answer, and we have not used them to work anything out.",
    });
  }

  const answers: ScanAnswers = {
    q1_channels: q1 as ContactChannel[],
    q2_reachable: q2 as ReachableWindow,
    q3_enquiries_per_week: q3 as CountAnswer,
    q4_unanswered_per_week: q4,
    q5_miss_visibility: q5 as MissVisibility,
    q6_followup: q6 as FollowupPractice,
    q7_messages_to_book: q7 as MessagesToBook,
    q8_typical_job_value: q8,
    q9_conversion_share: q9,
  };

  return { valid: true, errors: [], inconsistencies, answers };
}
