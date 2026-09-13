// ── Business Opportunity Scan, PR D: evidence gaps ────────────────
//
// WHAT WOULD LET NITEOWL APPLY ITS OWN RULES MORE CONFIDENTLY — never
// an invented fact about the business (Part XIV §105).
//
// THE LINE THIS MODULE EXISTS TO HOLD:
//
//   "This would let us put a range on it" is a claim about our own
//     sizing gates, and is verifiable against them.
//
//   "This would probably reveal a figure of X" is an ESTIMATE WEARING
//     A GAP'S CLOTHING, and Part X P39 bars it outright.
//
// So `expected_information_gain` comes from a closed enumeration whose
// every member is a statement about a NiteOwl rule, and a test refuses
// any gap whose wording carries a digit, a currency or the vocabulary
// of loss.
//
// GAPS ARE DERIVED, NEVER PRIMARY (§105). Every one is reconstructible
// from a confidence cap reason, a sizing unknown reason or a stage
// state that already exists on the report. There is no store, no
// separate input and no judgement of its own — a gap that needed one
// would be a second record of something already recorded (§48.3).
//
// `no_permitted_expression` PRODUCES NO GAP, AND THIS IS THE MOST
// IMPORTANT RULE IN THE FILE. No information the owner can supply would
// let NiteOwl size that finding, because the expression does not exist
// (§88.1). A gap there would tell an owner a number is within reach if
// they only worked harder for it, which is false and is precisely the
// pressure §26 forbids.
//
// `q4_zero` AND `q4_exceeds_q3` PRODUCE NO GAP EITHER. Nothing to
// report is a legitimate outcome, not a shortfall in evidence; and an
// inconsistency is already SHOWN to the owner in its own right (§87.4),
// so restating it as a gap would ask them to fix the same thing twice.
//
// NO CLOCK, NO RANDOMNESS, NO NETWORK, NO STORAGE, NO TENANT, NO MODEL.

import type {
  LostRevenueUnknownReason,
  ScanBusinessProcess,
  ScanConfidenceCapReason,
  ScanEvidenceGap,
  ScanEvidenceGapBlocks,
  ScanEvidenceGapCode,
  ScanFunnelStageId,
  ScanGapEffortBand,
  ScanInformationGain,
  ScanQuestionId,
  ScanReportFinding,
  ScanStageNotEstablishedReason,
} from "@/lib/freetools/scanTypes";

/** Everything about a gap that does not depend on the run. */
interface GapDefinition {
  readonly blocks: readonly ScanEvidenceGapBlocks[];
  /** One of OUR nine questions, where re-asking would close it. */
  readonly closing_question_id: ScanQuestionId | null;
  /** What the owner could find out, where no question of ours closes it. */
  readonly owner_action: string | null;
  readonly expected_information_gain: ScanInformationGain;
  readonly effort_band: ScanGapEffortBand;
  readonly wording: string;
}

/**
 * The gap table.
 *
 * The declaration order here IS the presentation order, so two runs
 * with the same gaps list them identically. `closing_question_id` and
 * `owner_action` are deliberately exclusive: a question we can simply
 * ask again is not something the owner has to go and find out, and a
 * gap that pretended otherwise would send them away to do work we
 * could have done by asking.
 */
export const SCAN_EVIDENCE_GAPS: Readonly<
  Record<ScanEvidenceGapCode, GapDefinition>
> = {
  unanswered_count_not_given: {
    blocks: ["diagnosis", "sizing"],
    closing_question_id: "q4_unanswered_per_week",
    owner_action: null,
    expected_information_gain: "would_allow_a_size_range",
    effort_band: "answer_now",
    wording:
      "You did not tell us roughly how many enquiries go unanswered in a typical week. With that, our rules can both look at this properly and put a range on it.",
  },
  unanswered_count_unknown: {
    blocks: ["diagnosis", "sizing"],
    closing_question_id: null,
    owner_action:
      "Keep a simple tally, for a fortnight, of the calls and messages nobody got to.",
    expected_information_gain: "would_allow_a_size_range",
    effort_band: "count_over_a_period",
    wording:
      "You told us you are not sure how many enquiries go unanswered. With a rough number, our rules can both look at this properly and put a range on it.",
  },
  miss_visibility_absent: {
    blocks: ["confidence", "sizing"],
    closing_question_id: null,
    owner_action:
      "Set up something that shows a missed call or an unanswered message after the fact — a missed-call list, or a shared inbox someone checks.",
    expected_information_gain: "would_allow_a_size_range",
    effort_band: "needs_a_change_in_how_you_work",
    wording:
      "You told us you have no way of knowing when a call or message is missed, so anything you tell us about misses rests on recollection. Our rules will not put a figure on a number with no record behind it.",
  },
  miss_visibility_partial: {
    blocks: ["confidence"],
    closing_question_id: null,
    owner_action:
      "Make the record cover every way people reach you, not only some of them.",
    expected_information_gain: "would_raise_confidence",
    effort_band: "needs_a_change_in_how_you_work",
    wording:
      "You told us you only sometimes know when a call or message is missed, so part of this rests on recollection. A fuller record would let our rules hold this more confidently.",
  },
  job_value_not_given: {
    blocks: ["sizing"],
    closing_question_id: "q8_typical_job_value",
    owner_action: null,
    expected_information_gain: "would_allow_a_size_range",
    effort_band: "answer_now",
    wording:
      "You did not tell us what a typical job or booking is worth to you. Our sizing rules need it before they will produce a range.",
  },
  job_value_unknown: {
    blocks: ["sizing"],
    closing_question_id: null,
    owner_action:
      "Look back at a handful of recent jobs and note what each was worth.",
    expected_information_gain: "would_allow_a_size_range",
    effort_band: "count_over_a_period",
    wording:
      "You told us you are not sure what a typical job or booking is worth. Our sizing rules need it before they will produce a range.",
  },
  job_value_range: {
    blocks: ["sizing"],
    closing_question_id: null,
    owner_action:
      "Narrow the typical job value, or split it by the kind of work, if the spread comes from mixing different jobs together.",
    expected_information_gain: "would_narrow_the_size_range",
    effort_band: "answer_now",
    wording:
      "You gave a typical job value as a range, so our rules can only produce a range in turn.",
  },
  conversion_share_not_given: {
    blocks: ["sizing"],
    closing_question_id: "q9_conversion_share",
    owner_action: null,
    expected_information_gain: "would_allow_a_size_range",
    effort_band: "answer_now",
    wording:
      "You did not tell us what share of the enquiries you answer become work. Our sizing rules need it before they will produce a range.",
  },
  conversion_share_unknown: {
    blocks: ["sizing"],
    closing_question_id: null,
    owner_action:
      "Over a month, note how many of the enquiries you answered turned into work.",
    expected_information_gain: "would_allow_a_size_range",
    effort_band: "count_over_a_period",
    wording:
      "You told us you are not sure what share of the enquiries you answer become work. Our sizing rules need it before they will produce a range.",
  },
  conversion_share_coarse: {
    blocks: ["sizing"],
    closing_question_id: null,
    owner_action:
      "Over a month, note how many of the enquiries you answered turned into work.",
    expected_information_gain: "would_narrow_the_size_range",
    effort_band: "count_over_a_period",
    wording:
      "You gave the share of enquiries that become work as a broad bucket, so our rules can only work to a broad range.",
  },
  operand_ranges_too_wide: {
    blocks: ["sizing"],
    closing_question_id: null,
    owner_action:
      "Narrow either the typical job value or the share that becomes work, whichever you can pin down more easily.",
    expected_information_gain: "would_narrow_the_size_range",
    effort_band: "answer_now",
    wording:
      "The answers you gave produce a range so wide that our rules refuse to show it. Narrowing either end would let them.",
  },
  followup_practice_unknown: {
    blocks: ["diagnosis"],
    closing_question_id: "q6_followup",
    owner_action: null,
    expected_information_gain: "would_allow_this_stage_to_be_assessed",
    effort_band: "answer_now",
    wording:
      "You told us you are not sure what happens to an enquiry that does not book, so we have not looked at that part of the path at all.",
  },
  booking_effort_unknown: {
    blocks: ["diagnosis"],
    closing_question_id: "q7_messages_to_book",
    owner_action: null,
    expected_information_gain: "would_allow_this_stage_to_be_assessed",
    effort_band: "answer_now",
    wording:
      "You told us you are not sure how many messages it takes to agree a time, so we have not looked at that part of the path at all.",
  },
  messages_to_book_unsteady: {
    blocks: ["confidence"],
    closing_question_id: null,
    owner_action:
      "Count the messages it takes on the next handful of bookings.",
    expected_information_gain: "would_raise_confidence",
    effort_band: "count_over_a_period",
    wording:
      "You told us the number of messages varies a lot, so the pattern is less clear to our rules than a steady number would make it.",
  },
};

/** Fixed presentation order — the declaration order of the table above. */
const GAP_ORDER = Object.keys(SCAN_EVIDENCE_GAPS) as ScanEvidenceGapCode[];

/**
 * Which gap a displayed confidence cap corresponds to.
 *
 * Every cap the finding engine and the sizing module can display has
 * one, because a cap the owner is shown without any way of lifting it
 * is a complaint rather than a diagnosis.
 */
const GAP_BY_CAP_REASON: Readonly<
  Record<ScanConfidenceCapReason, ScanEvidenceGapCode>
> = {
  q5_no_miss_visibility: "miss_visibility_absent",
  q5_partial_miss_visibility: "miss_visibility_partial",
  q7_varies_a_lot: "messages_to_book_unsteady",
  q9_wide_conversion_bucket: "conversion_share_coarse",
  q8_value_range: "job_value_range",
};

/**
 * Which gap a sizing-unknown reason corresponds to, where one does.
 *
 * A Record over the closed enumeration, so a reason added to the sizing
 * module has to be given a gap or an explicit null here. The three
 * nulls are the rules stated at the top of this file, and each is a
 * decision rather than an omission.
 */
const GAP_BY_UNKNOWN_REASON: Readonly<
  Record<LostRevenueUnknownReason, ScanEvidenceGapCode | null>
> = {
  no_permitted_expression: null,
  q4_zero: null,
  q4_exceeds_q3: null,
  q4_missing: "unanswered_count_not_given",
  q4_not_sure: "unanswered_count_unknown",
  q5_no_miss_visibility: "miss_visibility_absent",
  q8_missing: "job_value_not_given",
  q8_not_sure: "job_value_unknown",
  q9_missing: "conversion_share_not_given",
  q9_not_sure: "conversion_share_unknown",
  range_spans_more_than_one_order_of_magnitude: "operand_ranges_too_wide",
};

/**
 * Which gap explains a stage nobody could assess, KEYED BY THE STAGE
 * AND THE REASON IT COULD NOT BE ESTABLISHED.
 *
 * READ FROM THE FUNNEL, NOT FROM SIZING, AND THIS IS THE WHOLE POINT.
 * Three of these gaps concern a question that raises a finding, so
 * deriving them from a sizing reason cannot work: sizing runs only on a
 * finding, and an unanswered question raises none (§87.4). The funnel
 * already records exactly what is needed — the stage is
 * `not_established`, and `not_established_reason` says whether the
 * owner left the question blank or told us they are not sure — so the
 * gap is derived from canonical report state and stays reconstructible
 * from it (§105: derived, never primary).
 *
 * NOTHING HERE MANUFACTURES A FINDING. A gap says what would let our
 * rules look at a stage; it never asserts that there is something wrong
 * at one, and an unassessed stage stays unassessed.
 *
 * The two reasons deliberately absent from every stage:
 *
 *   `answers_inconsistent` — already SHOWN to the owner in its own
 *     right (§87.4). Restating it as a gap would ask them to fix the
 *     same thing twice.
 *
 *   `no_way_of_knowing` — the owner answered both questions; what is
 *     missing is a record, not an answer, and no question of ours and
 *     no counting exercise closes it.
 *
 * `answer_not_given` appears only for Q4. Q6 and Q7 are required, so a
 * validated run cannot leave them blank, and an entry for them would be
 * unreachable.
 */
const GAP_BY_UNESTABLISHED_STAGE: Readonly<
  Partial<
    Record<
      ScanFunnelStageId,
      Partial<Record<ScanStageNotEstablishedReason, ScanEvidenceGapCode>>
    >
  >
> = {
  enquiry_answered: {
    answer_not_given: "unanswered_count_not_given",
    owner_not_sure: "unanswered_count_unknown",
  },
  time_agreed: {
    owner_not_sure: "booking_effort_unknown",
  },
  enquiry_followed_up: {
    owner_not_sure: "followup_practice_unknown",
  },
};

/**
 * Derive one run's evidence gaps.
 *
 * Three sources, ALL OF THEM ALREADY ON THE REPORT: the confidence caps
 * the findings display, the reasons sizing gave for not producing a
 * number, and the stages the funnel could not establish. The raw
 * answers are deliberately NOT read — everything a gap needs has
 * already been decided by a canonical module and recorded, so reading
 * the answers again would be a second opinion about state the report
 * already holds.
 *
 * That is also what makes the set reconstructible: anyone holding the
 * report can rebuild it from those three sources alone (§105).
 *
 * Deduplicated by code — Q5 = "no" reaches the list from both a cap and
 * a sizing reason, and it is one gap however many rules noticed it.
 */
export function deriveEvidenceGaps(
  reportFindings: readonly ScanReportFinding[],
  funnel: ScanBusinessProcess
): ScanEvidenceGap[] {
  const codes = new Set<ScanEvidenceGapCode>();

  for (const entry of reportFindings) {
    const cap = entry.finding.confidence_cap_reason;
    if (cap) codes.add(GAP_BY_CAP_REASON[cap]);

    if (entry.impact.kind === "unknown") {
      const fromReason = GAP_BY_UNKNOWN_REASON[entry.impact.reason];
      if (fromReason) codes.add(fromReason);
    } else {
      const sizeCap = entry.impact.basis.size_confidence_cap_reason;
      if (sizeCap) codes.add(GAP_BY_CAP_REASON[sizeCap]);
    }
  }

  for (const stage of funnel.stages) {
    if (!stage.assessable) continue;
    if (stage.assessment !== "not_established") continue;
    if (!stage.not_established_reason) continue;
    const code =
      GAP_BY_UNESTABLISHED_STAGE[stage.stage_id]?.[stage.not_established_reason];
    if (code) codes.add(code);
  }

  return GAP_ORDER.filter((code) => codes.has(code)).map((code) => {
    const definition = SCAN_EVIDENCE_GAPS[code];
    return {
      gap_code: code,
      blocks: definition.blocks,
      closing_question_id: definition.closing_question_id,
      owner_action: definition.owner_action,
      expected_information_gain: definition.expected_information_gain,
      effort_band: definition.effort_band,
      wording: definition.wording,
      source_type: "derived_deterministic",
    };
  });
}
