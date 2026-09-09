// ── Business Opportunity Scan, Phase 1: the vocabulary ────────────
//
// Provider-neutral pure types for the Scan's Phase 1 contract
// (docs/ARCHITECTURE.md Part XI §80–§86 and Part XII §87–§90).
//
// NOTHING HERE PERSISTS, AND NOTHING HERE HAS AN OWNER. There is no
// org_id, no Supabase type, no provider type and no storage concern —
// a scan run happens before a tenant exists at all (§83.3, G1), and the
// free-product namespace is the one NiteOwl surface that legitimately
// has no tenant key (§26, docs/AGENT_ACCESS_LAYER.md §25.1). Its
// isolation is therefore STRUCTURAL, which is only true while these
// types stay unable to name a tenant.
//
// AN ANSWER IS `business_provided` AND STAYS THAT WAY FOREVER (§87.2).
// Every value below is something a stranger typed into a public form.
// Nothing here is `observed`, nothing becomes `verified`, and promotion
// to a tenant record later changes WHERE a fact lives, never WHAT IT IS
// (§89.4). That is why `source_type` is a literal type on the shapes
// that carry evidence rather than a mutable field: the wrong value is a
// compile error, not a review comment.
//
// "NOT SURE" IS A FIRST-CLASS ANSWER (§87.2). It is modelled as its own
// variant, never as null, blank or a missing key, because a design that
// cannot represent "the owner told us they don't know" will eventually
// fill the gap with an assumption — which §82.2 forbids outright.
//
// AN ESTIMATE IS `derived_deterministic`, NEVER `observed` (§88.4). It
// is arithmetic over answers, and no promotion, adoption or later
// confirmation ever changes that.

/**
 * The source types this product can carry, narrowed from §20.6's nine.
 *
 * `observed` is deliberately absent: Phase 1 observes nothing, and a
 * type that cannot express an observation cannot accidentally claim one.
 * `ai_predicted` is absent for the same reason — §88.2 permits no
 * model-generated operand, so Phase 1 has no case for it (§90.2).
 */
export type ScanSourceType =
  | "business_provided"
  | "derived_deterministic"
  | "assumed";

/** Confidence, per assertion and never blended into one score (§82.4). */
export type ScanConfidence = "low" | "medium" | "high";

/**
 * The Scan's product-owned `condition` enumeration — G2, resolved by
 * §87.1. THREE CODES AND NO MORE.
 *
 * There is no capacity, retention, repeat-business, handoff, cash-flow
 * or marketing code. Adding one is a Part XI boundary change (§81.3),
 * not an enumeration edit, and the boundary test pins the count.
 *
 * Named in NiteOwl's own domain vocabulary per §20.5, so the code
 * survives any provider change (Part IX P33).
 */
export type ScanConditionCode =
  | "enquiry.unanswered"
  | "enquiry.no_followup"
  | "booking.friction";

/**
 * The fixed presentation order — §84.2's "at most three findings,
 * ranked", ranked by the enumeration itself.
 *
 * NO SCORE, NO WEIGHT, NO MODEL, NO LEARNED PARAMETER, and explicitly
 * not ordered by estimated money: a sized finding and an unsized one
 * rank exactly where the enumeration puts them, because ranking by
 * value would make the Scan's order an artefact of what it happens to
 * be able to size — which in Phase 1 is one class out of three (§88.1).
 */
export const SCAN_CONDITION_ORDER: readonly ScanConditionCode[] = [
  "enquiry.unanswered",
  "enquiry.no_followup",
  "booking.friction",
] as const;

/** The nine question ids — §87.2. The set is closed. */
export type ScanQuestionId =
  | "q1_channels"
  | "q2_reachable"
  | "q3_enquiries_per_week"
  | "q4_unanswered_per_week"
  | "q5_miss_visibility"
  | "q6_followup"
  | "q7_messages_to_book"
  | "q8_typical_job_value"
  | "q9_conversion_share";

// ── Answer value shapes ───────────────────────────────────────────

/** Q1 — how customers get in touch. Multi-select, at least one. */
export type ContactChannel =
  | "phone"
  | "text_whatsapp"
  | "email"
  | "web_form"
  | "social"
  | "in_person"
  | "other";

/** Q2 — when someone can reach a person. Context only; raises nothing. */
export type ReachableWindow =
  | "working_hours"
  | "extended"
  | "any_time"
  | "varies";

/** Q5 — the honesty gate. Caps `enquiry.unanswered`, gates E1 (§87.2). */
export type MissVisibility = "yes_always" | "sometimes" | "no";

/** Q6 — what happens to an enquiry that does not book. */
export type FollowupPractice =
  | "within_a_day"
  | "eventually"
  | "only_if_they_return"
  | "nothing_planned"
  | "not_sure";

/** Q7 — how much back-and-forth agreeing a time takes. */
export type MessagesToBook =
  | "one"
  | "two_or_three"
  | "more_than_three"
  | "varies_a_lot"
  | "not_sure";

/** Q9 — the share of answered enquiries that become work. */
export type ConversionShare = "most" | "about_half" | "a_minority" | "not_sure";

/**
 * A weekly count, or the owner saying they do not know.
 *
 * `not_sure` is a stated answer, NOT an absence: the owner told us
 * something, and what they told us is that they cannot say. It
 * produces UNKNOWN and is never penalised, defaulted or substituted.
 */
export type CountAnswer =
  | { readonly kind: "count"; readonly value: number }
  | { readonly kind: "not_sure" };

/**
 * Q8 — a typical job value, in the owner's own currency.
 *
 * A single amount or a range, both strictly greater than zero, or
 * `not_sure`. The currency is the owner's; nothing converts it, and
 * nothing assumes one when it is absent.
 */
export type MoneyAnswer =
  | { readonly kind: "amount"; readonly amount: number; readonly currency: string }
  | {
      readonly kind: "range";
      readonly low: number;
      readonly high: number;
      readonly currency: string;
    }
  | { readonly kind: "not_sure" };

/** Any value one of the nine questions can carry, as the owner gave it. */
export type ScanAnswerValue =
  | readonly ContactChannel[]
  | ReachableWindow
  | CountAnswer
  | MissVisibility
  | FollowupPractice
  | MessagesToBook
  | MoneyAnswer
  | ConversionShare;

/**
 * One run's answers to the nine questions.
 *
 * The four optional questions are optional in the contract (§87.2), and
 * an absent one means nothing was established — never that the answer
 * was bad (§87.4).
 */
export interface ScanAnswers {
  readonly q1_channels: readonly ContactChannel[];
  readonly q2_reachable: ReachableWindow;
  readonly q3_enquiries_per_week: CountAnswer;
  readonly q4_unanswered_per_week?: CountAnswer | null;
  readonly q5_miss_visibility: MissVisibility;
  readonly q6_followup: FollowupPractice;
  readonly q7_messages_to_book: MessagesToBook;
  readonly q8_typical_job_value?: MoneyAnswer | null;
  readonly q9_conversion_share?: ConversionShare | null;
}

// ── Findings ──────────────────────────────────────────────────────

/**
 * Why a confidence was capped, as a code rather than prose.
 *
 * §87.3 requires the cap to be DISPLAYED, and §20.7 rule 1's "only
 * codes are learnable" is why it is not a sentence.
 */
export type ScanConfidenceCapReason =
  | "q5_no_miss_visibility"
  | "q5_partial_miss_visibility"
  | "q7_varies_a_lot"
  | "q9_wide_conversion_bucket"
  | "q8_value_range";

/**
 * One supporting answer, quoted rather than summarised.
 *
 * §84.2 requires the answers behind a finding to be shown as the
 * owner's own words, so the raw answer travels with the finding rather
 * than being re-read from somewhere else later.
 */
export interface ScanEvidenceRef {
  readonly question_id: ScanQuestionId;
  readonly raw_answer: ScanAnswerValue;
  readonly source_type: "business_provided";
}

/**
 * A Phase 1 finding: a stated rule over stated answers (§87.3).
 *
 * NO MODEL IS IN THIS PATH. A model may phrase prose around a finding;
 * it may never decide that one exists, and it may never produce an
 * operand (§82.2, §87.3). That is what makes Phase 1 testable — the
 * same answers must always produce the same findings.
 *
 * This is an ASSESSMENT FINDING, not a `DecisionRecord` (§83.3, P41):
 * no org_id, no canonical entity reference, no evidence reference to a
 * real event, because none of those exists when a scan runs.
 */
export interface ScanFinding {
  readonly condition: ScanConditionCode;
  /** Which questions carried it — the corroboration rule of §87.3. */
  readonly supporting_question_ids: readonly ScanQuestionId[];
  /** Those answers verbatim, exactly as the owner gave them. */
  readonly evidence: readonly ScanEvidenceRef[];
  /** Always derived: arithmetic-free, rule-based, model-free. */
  readonly source_type: "derived_deterministic";
  readonly finding_confidence: ScanConfidence;
  /** The binding cap, or null when nothing capped it. */
  readonly confidence_cap_reason: ScanConfidenceCapReason | null;
}

// ── Sizing ────────────────────────────────────────────────────────

/** The three assumptions every E1 result must show (§88.2). */
export type ScanAssumptionCode =
  | "assumed.same_conversion"
  | "assumed.typical_value"
  | "assumed.owner_estimate";

/**
 * An assumption, shown to the owner and not footnoted (§26, §84.2).
 *
 * The display text is carried in the basis rather than looked up at
 * render time, because §88.4 requires the basis to hold "the exact
 * display text shown" — a basis that points at wording which can later
 * change does not freeze what the owner actually read.
 */
export interface ScanAssumption {
  readonly code: ScanAssumptionCode;
  readonly source_type: "assumed";
  readonly display_text: string;
}

/** One operand of an expression, frozen as §88.4 requires. */
export interface EstimateOperand {
  readonly operand_id: ScanQuestionId;
  /** As the owner gave it. Never normalised in place. */
  readonly raw_answer: ScanAnswerValue;
  /** `[lo, hi]` — a point answer is a range whose ends are equal. */
  readonly normalised_range: readonly [number, number];
  readonly unit: string;
  readonly source_type: "business_provided";
  /** Supplied by the caller. This module never reads a clock. */
  readonly answered_at: string;
}

/**
 * The rounding rule, named so a basis records HOW it was rounded.
 *
 * Outward: the low end down, the high end up. Rounding inward would
 * narrow a range to look more precise than the answers support, which
 * is the fabricated precision §43.2 forbids.
 */
export type EstimateRoundingRule = "outward_to_whole_currency_unit";

/** A range, never a point (§88.2). Per week, never annualised. */
export interface EstimateResult {
  readonly low: number;
  readonly high: number;
  /** The owner's own currency, from Q8. Nothing converts it. */
  readonly currency: string;
  readonly period: "week";
  readonly rounding_rule: EstimateRoundingRule;
}

/**
 * P42, made precise by §88.4.
 *
 * THE DISPLAYED NUMBER MUST BE RECOMPUTABLE FROM THIS ALONE. That
 * sentence is the whole contract and the fields follow from it: if a
 * stored basis does not reproduce its stored result, the result is
 * wrong and MAY NOT BE SHOWN.
 *
 * The basis is frozen and append-only. A re-run produces a NEW basis;
 * this one is never edited (§23's re-attribution rule applied to money).
 * And the estimate is never the baseline a later measured outcome is
 * graded against — the frozen basis exists so the estimate can be found
 * WRONG, which is its only value to the learning layer (§82.5, P39).
 */
export interface EstimateBasis {
  readonly expression_id: "lost_revenue.unanswered_enquiries";
  readonly expression_version: "v1";
  readonly operands: readonly EstimateOperand[];
  readonly assumptions: readonly ScanAssumption[];
  readonly result: EstimateResult;
  readonly size_confidence: ScanConfidence;
  readonly size_confidence_cap_reason: ScanConfidenceCapReason | null;
  readonly question_set_version: string;
  readonly rule_set_version: string;
  /**
   * Supplied by the caller so the result is as-of (M15) without this
   * module reading a clock. Determinism is the acceptance test here
   * (Part XII's governing principle), and a function that reads the
   * time is not deterministic.
   */
  readonly computed_at: string;
  /** An estimate is derived. It is never, at any later point, observed. */
  readonly source_type: "derived_deterministic";
}

/** Why a finding could not be sized (§82.3, §88.3). */
export type LostRevenueUnknownReason =
  | "no_unanswered_finding"
  | "q4_missing"
  | "q4_not_sure"
  | "q4_zero"
  | "q4_exceeds_q3"
  | "q5_no_miss_visibility"
  | "q8_missing"
  | "q8_not_sure"
  | "q9_missing"
  | "q9_not_sure"
  | "range_spans_more_than_one_order_of_magnitude";

/**
 * Impact: a range, or the explicit "we cannot size this".
 *
 * UNKNOWN IS A FIRST-CLASS RESULT, NOT A FAILURE (§82.3). A finding
 * with a strong diagnosis and no number is a good finding, and in
 * Phase 1 two of the three condition codes are ALWAYS unknown (§88.1) —
 * sizing either would need a recovery or loss rate no owner can supply.
 */
export type ScanImpact =
  | { readonly kind: "unknown"; readonly reason: LostRevenueUnknownReason }
  | { readonly kind: "estimate"; readonly basis: EstimateBasis };

/** A finding together with its impact, ready to be presented. */
export interface ScanReportFinding {
  readonly finding: ScanFinding;
  readonly impact: ScanImpact;
}

/**
 * One run's output: at most three findings, already ranked (§84.2).
 *
 * A report with NO findings is valid and is a real answer — §23's
 * `unattributed` reasoning and §50.4's "NiteOwl is allowed not to know".
 *
 * There is no org_id, no run owner and no identity: linkage is the
 * bearer token the visitor holds, which lives outside this type
 * entirely (docs/AGENT_ACCESS_LAYER.md §25.1).
 */
export interface ScanReport {
  readonly question_set_version: string;
  readonly rule_set_version: string;
  readonly findings: readonly ScanReportFinding[];
  /** Inconsistencies shown to the owner rather than silently resolved. */
  readonly inconsistencies: readonly ScanInconsistency[];
}

/**
 * An internally inconsistent pair of answers — today only Q4 > Q3.
 *
 * §87.4: shown to the owner, NEVER silently resolved, and neither value
 * is repaired. It suppresses the finding it would have supported; it
 * does not make the run invalid.
 */
export interface ScanInconsistency {
  readonly code: "q4_exceeds_q3";
  readonly question_ids: readonly ScanQuestionId[];
  readonly message: string;
}

/**
 * Timestamps the caller supplies.
 *
 * Passed in rather than read, so every module in this path stays free
 * of a clock, of randomness, of network and of external state.
 */
export interface ScanRunContext {
  /** When the owner gave these answers. ISO-8601 instant. */
  readonly answered_at: string;
  /** When this computation ran. ISO-8601 instant. */
  readonly computed_at: string;
}
