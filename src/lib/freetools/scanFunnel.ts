// ── Business Opportunity Scan, PR D: the enquiry funnel ───────────
//
// AN ANALYTICAL REPRESENTATION OF WHAT THE OWNER TOLD US, AND NOTHING
// MORE (Part XIV §101). Five stages of one process, each informed by
// questions the owner answered, each carrying the state of OUR
// KNOWLEDGE and, separately, its own health.
//
// THE SCAN OBSERVES NOTHING (§84.1). There is no observed state here
// and no path that could produce one — the stage state enumeration
// cannot express it, which is what makes the guarantee structural
// rather than a promise.
//
// ORDER AND ADJACENCY, NEVER CAUSE (§100.3). This module may say which
// stage comes before which on the path the owner described, and may
// name the EARLIEST stage where the answers indicate work is being
// lost. It may never say that one stage caused a condition at another,
// and the wording it feeds the report says so out loud.
//
// TWO STAGES ARE DELIBERATELY NOT ASSESSED, and this is the restraint
// the whole module turns on:
//
//   `enquiry_received` reads Q1, Q2 and Q3, none of which establishes
//     anything alone (§87.2). How many enquiries a business gets is
//     demand generation — a different product's domain — and calling
//     it "working" would be a positive claim from questions that
//     support none.
//
//   `work_booked` reads Q9, which is an E1 operand and raises no
//     condition. Asserting a conversion problem there would reach a
//     class Phase 1 excluded on purpose (§81.3), and asserting
//     conversion is fine would be the same error with the sign
//     flipped.
//
// A STAGE WITH NO FINDING IS RENDERED AS ADEQUATE, NOT AS EMPTY (§101)
// — but adequacy is still a claim, so it is refused wherever the
// answers do not support it: an unknown answer, an inconsistency, or a
// zero that rests on visibility the owner has just told us they lack.
//
// NO CLOCK, NO RANDOMNESS, NO NETWORK, NO STORAGE, NO TENANT, NO MODEL.
// The same answers and findings must produce a deeply equal funnel
// every time, forever.

import type {
  ScanAnswers,
  ScanBusinessProcess,
  ScanConditionCode,
  ScanEarliestLeak,
  ScanFunnelStage,
  ScanFunnelStageId,
  ScanInconsistency,
  ScanQuestionId,
  ScanStageAssessment,
  ScanStageKind,
  ScanStageNotEstablishedReason,
  ScanStageState,
  ScanStageUnknownReason,
} from "@/lib/freetools/scanTypes";

/** The one process Phase 1 holds. A second is a boundary change (§100.3). */
export const SCAN_PROCESS_ID = "enquiry_to_booked_work" as const;

/** Everything about a stage that does not depend on the answers. */
export interface FunnelStageDefinition {
  readonly stage_id: ScanFunnelStageId;
  readonly position: number;
  readonly kind: ScanStageKind;
  readonly informed_by: readonly ScanQuestionId[];
  readonly assessable: boolean;
  /**
   * The condition that can anchor here, where one can.
   *
   * Exactly one condition per stage, which is why stage position alone
   * totally orders the findings — see scanPrioritisation.
   */
  readonly condition: ScanConditionCode | null;
}

/**
 * The five stages, in the order an enquiry travels.
 *
 * Follow-up sits LAST because it is what happens to an enquiry that did
 * not book: it follows the booking decision rather than preceding it,
 * and calling that out as a recovery stage keeps the ordering honest
 * instead of quietly reordering the path to suit the enumeration.
 */
export const SCAN_FUNNEL_STAGES: readonly FunnelStageDefinition[] = [
  {
    stage_id: "enquiry_received",
    position: 1,
    kind: "forward",
    informed_by: ["q1_channels", "q2_reachable", "q3_enquiries_per_week"],
    assessable: false,
    condition: null,
  },
  {
    stage_id: "enquiry_answered",
    position: 2,
    kind: "forward",
    informed_by: [
      "q3_enquiries_per_week",
      "q4_unanswered_per_week",
      "q5_miss_visibility",
    ],
    assessable: true,
    condition: "enquiry.unanswered",
  },
  {
    stage_id: "time_agreed",
    position: 3,
    kind: "forward",
    informed_by: ["q7_messages_to_book"],
    assessable: true,
    condition: "booking.friction",
  },
  {
    stage_id: "work_booked",
    position: 4,
    kind: "forward",
    informed_by: ["q9_conversion_share"],
    assessable: false,
    condition: null,
  },
  {
    stage_id: "enquiry_followed_up",
    position: 5,
    kind: "recovery",
    informed_by: ["q6_followup"],
    assessable: true,
    condition: "enquiry.no_followup",
  },
] as const;

/** One stage definition by its opaque id, never by position. */
export function funnelStageDefinition(
  stageId: ScanFunnelStageId
): FunnelStageDefinition | undefined {
  return SCAN_FUNNEL_STAGES.find((s) => s.stage_id === stageId);
}

/**
 * The stage each condition anchors to — EXHAUSTIVE BY TYPE.
 *
 * A Record over the closed condition enumeration rather than a lookup
 * with a fallback: a condition added without a stage is then a compile
 * error, and no caller has to invent a default stage for a condition
 * that has none. Exactly one condition per stage, which is why stage
 * position alone totally orders the findings (see scanPrioritisation).
 */
export const STAGE_BY_CONDITION: Readonly<
  Record<ScanConditionCode, ScanFunnelStageId>
> = {
  "enquiry.unanswered": "enquiry_answered",
  "enquiry.no_followup": "enquiry_followed_up",
  "booking.friction": "time_agreed",
};

/** The stage a condition anchors to. Every Phase 1 condition has one. */
export function stageForCondition(
  condition: ScanConditionCode
): FunnelStageDefinition {
  const stageId = STAGE_BY_CONDITION[condition];
  const definition = SCAN_FUNNEL_STAGES.find((s) => s.stage_id === stageId);
  // Unreachable: both sides are closed enumerations and the boundary
  // suite pins that they agree. The non-null assertion is avoided so
  // the type stays honest without a throw on a report path.
  return definition ?? SCAN_FUNNEL_STAGES[0];
}

/**
 * How an answer stands: given, stated "not sure", or absent.
 *
 * A BLANK IS NEVER "NOT SURE" — they are different facts and the stage
 * records which one it was. This mirrors the validator's own rule
 * rather than restating it: nothing here repairs, defaults or
 * substitutes anything.
 */
type AnswerStanding = "given" | "not_sure" | "absent";

function standingOf(answers: ScanAnswers, id: ScanQuestionId): AnswerStanding {
  const raw = answers[id as keyof ScanAnswers];
  if (raw === undefined || raw === null) return "absent";
  if (typeof raw === "string") return raw === "not_sure" ? "not_sure" : "given";
  if (Array.isArray(raw)) return raw.length > 0 ? "given" : "absent";
  const shaped = raw as { kind?: string };
  if (shaped.kind === "not_sure") return "not_sure";
  return "given";
}

/**
 * Which questions actually decide a stage's state.
 *
 * A stage may be INFORMED BY a question that cannot make it unknown.
 * `enquiry_answered` is informed by Q3 for the consistency check, but
 * an unknown Q3 does not make the stage unknown — Q4 is what the stage
 * is about, and Q5 is required and always answered. Reading every
 * informing question would let a question that qualifies evidence
 * silently erase the evidence.
 */
const STATE_DECIDING_QUESTIONS: Readonly<
  Record<ScanFunnelStageId, readonly ScanQuestionId[]>
> = {
  enquiry_received: ["q3_enquiries_per_week"],
  enquiry_answered: ["q4_unanswered_per_week"],
  time_agreed: ["q7_messages_to_book"],
  work_booked: ["q9_conversion_share"],
  enquiry_followed_up: ["q6_followup"],
};

/**
 * Which stage an inconsistency lands on.
 *
 * ONE INCONSISTENCY, ONE STAGE — the LATEST stage among those whose
 * deciding question it names. A contradiction between two answers is
 * about the relationship between them, and that relationship only
 * exists once both are in hand, which is the later of the two points.
 *
 * Q4 > Q3 therefore lands on `enquiry_answered` and not on
 * `enquiry_received`: how many enquiries arrive is not itself in doubt,
 * and marking that stage inconsistent would say we cannot tell how many
 * enquiries the business gets, which is not what was established.
 */
function inconsistentStages(
  inconsistencies: readonly ScanInconsistency[]
): ReadonlySet<ScanFunnelStageId> {
  const hit = new Set<ScanFunnelStageId>();
  for (const inconsistency of inconsistencies) {
    const matching = SCAN_FUNNEL_STAGES.filter((stage) =>
      inconsistency.question_ids.some((id) =>
        STATE_DECIDING_QUESTIONS[stage.stage_id].includes(id)
      )
    );
    if (matching.length === 0) continue;
    const latest = matching.reduce((a, b) => (b.position > a.position ? b : a));
    hit.add(latest.stage_id);
  }
  return hit;
}

/**
 * Build the funnel from one run's answers and its findings.
 *
 * The findings are passed in rather than re-derived: re-deriving them
 * here would put two readings of one run in play, which is the exact
 * pattern the canonical-information discipline exists to remove. This
 * module decides no finding and second-guesses none.
 */
export function buildEnquiryFunnel(
  answers: ScanAnswers,
  findingConditions: readonly ScanConditionCode[],
  inconsistencies: readonly ScanInconsistency[] = []
): ScanBusinessProcess {
  const inconsistent = inconsistentStages(inconsistencies);

  const stages: ScanFunnelStage[] = SCAN_FUNNEL_STAGES.map((definition) => {
    const deciding = STATE_DECIDING_QUESTIONS[definition.stage_id];
    const standings = deciding.map((id) => standingOf(answers, id));

    // Precedence: inconsistent beats unknown beats declared. An
    // inconsistency is a stronger statement about a stage than an
    // absence, and showing the weaker one would hide it.
    let state: ScanStageState;
    let unknownReason: ScanStageUnknownReason | null = null;

    if (inconsistent.has(definition.stage_id)) {
      state = "inconsistent";
    } else if (standings.some((s) => s !== "given")) {
      state = "unknown";
      unknownReason = standings.includes("not_sure") ? "owner_not_sure" : "not_answered";
    } else {
      // `derived` is never produced: no stage state is computed from
      // another stage, and one that was would be an inference this
      // module has no rule for.
      state = "owner_declared";
    }

    const condition =
      definition.condition && findingConditions.includes(definition.condition)
        ? definition.condition
        : null;

    let assessment: ScanStageAssessment;
    let notEstablished: ScanStageNotEstablishedReason | null = null;

    if (!definition.assessable) {
      assessment = "not_assessed";
    } else if (condition) {
      assessment = "finding";
    } else if (state === "inconsistent") {
      assessment = "not_established";
      notEstablished = "answers_inconsistent";
    } else if (state === "unknown") {
      assessment = "not_established";
      notEstablished =
        unknownReason === "owner_not_sure" ? "owner_not_sure" : "answer_not_given";
    } else if (
      definition.stage_id === "enquiry_answered" &&
      answers.q5_miss_visibility === "no"
    ) {
      // "No enquiries go unanswered" rests on visibility the owner has
      // just told us they do not have. That is not a contradiction, so
      // it is not recorded as one — but it is not adequacy either.
      assessment = "not_established";
      notEstablished = "no_way_of_knowing";
    } else {
      assessment = "appears_adequate";
    }

    return {
      stage_id: definition.stage_id,
      position: definition.position,
      kind: definition.kind,
      informed_by: definition.informed_by,
      assessable: definition.assessable,
      state,
      unknown_reason: unknownReason,
      assessment,
      not_established_reason: notEstablished,
      finding_condition: condition,
      source_type: "derived_deterministic",
    };
  });

  return {
    process_id: SCAN_PROCESS_ID,
    stages,
    source_type: "derived_deterministic",
  };
}

/**
 * The earliest ASSESSABLE stage carrying a finding, with what sits
 * before it.
 *
 * "Earliest" means the earliest point the Scan CAN SPEAK TO, and the
 * two lists are what keep that honest: stages before it that look
 * adequate, and stages before it that were never established. A report
 * that named the first without the second would imply nothing earlier
 * is wrong, which the answers do not support.
 */
export function findEarliestLeak(
  funnel: ScanBusinessProcess
): ScanEarliestLeak | null {
  const leak = funnel.stages.find(
    (s) => s.assessable && s.assessment === "finding" && s.finding_condition !== null
  );
  if (!leak || !leak.finding_condition) return null;

  const earlier = funnel.stages.filter(
    (s) => s.assessable && s.position < leak.position
  );

  return {
    stage_id: leak.stage_id,
    condition: leak.finding_condition,
    earlier_stages_adequate: earlier
      .filter((s) => s.assessment === "appears_adequate")
      .map((s) => s.stage_id),
    earlier_stages_not_established: earlier
      .filter((s) => s.assessment === "not_established")
      .map((s) => s.stage_id),
    source_type: "derived_deterministic",
  };
}
