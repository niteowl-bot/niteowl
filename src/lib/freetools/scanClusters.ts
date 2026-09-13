// ── Business Opportunity Scan, PR E: opportunity clusters ─────────
//
// A STATED RELATION BETWEEN TWO FINDINGS, AND NOTHING ELSE (§102).
//
// This module is STRICTLY DOWNSTREAM. It reads findings and the funnel;
// nothing reads it. `deriveFindings`, `computeLostRevenue`,
// `prioritise`, `deriveDependencies`, `deriveEvidenceGaps` and
// `recommendFor` neither import it nor take a clusters argument, and
// the boundary suite pins that. §102's *"clustering never collapses,
// summarises, re-ranks or re-confidences a member"* is therefore a
// property of the dependency graph rather than a promise in prose.
//
// ONE CLUSTER PER UNORDERED PAIR, ALWAYS, AND NEVER FEWER THAN TWO
// FINDINGS. A single-finding report has no clusters at all (§102), and
// a zero-finding report's clustering output is empty (§107.4).
//
// THE LADDER IS FIXED AND THE FIRST RULE THAT FIRES WINS. Three of its
// four positive rules CANNOT FIRE IN PHASE 1, and that is a statement
// about missing contracts rather than missing code — see
// ScanClusterRelation in scanTypes for why each one is blocked. None of
// them is approximated: a proxy for a hypothesis intersection would be
// hypothesis generation wearing a cluster's clothing, and a resource
// rule that fires on every pair would be narrative.
//
// SO `independent` IS A REAL OUTPUT HERE, unlike in the dependency
// layer where every Phase 1 pair is ordered by the path. It means
// **our rules found nothing**, never **these are unrelated** — and its
// confidence and its wording both say so.
//
// ADJACENCY IS ARITHMETIC, NOT CAUSATION (§100.3). This module may say
// that two findings sit next to each other on the path the owner
// described. It may never say that one produced the other, and the one
// sentence it emits about adjacency denies causation in as many words.
//
// NO CLOCK, NO RANDOMNESS, NO NETWORK, NO STORAGE, NO TENANT, NO
// PROVIDER, NO MODEL. The same findings must produce a deeply equal
// cluster set every time, forever.

import { stageForCondition } from "@/lib/freetools/scanFunnel";
import {
  SCAN_CLUSTER_RULE_SET_VERSION,
  type ScanCluster,
  type ScanClusterRelation,
  type ScanClusterRuleCode,
  type ScanConditionCode,
  type ScanConfidence,
  type ScanFinding,
  type ScanFunnelStageId,
} from "@/lib/freetools/scanTypes";

export { SCAN_CLUSTER_RULE_SET_VERSION };

/**
 * The owner-facing phrase for each stage, as it appears inside a
 * cluster sentence.
 *
 * Kept beside the wording it is used in — the same shape the dependency
 * module uses — so this module stays free of the presentation layer and
 * the sentence it produces is fixed data a test can pin verbatim.
 */
const STAGE_PHRASE: Readonly<Record<ScanFunnelStageId, string>> = {
  enquiry_received: "enquiries reaching you",
  enquiry_answered: "enquiries getting an answer",
  time_agreed: "agreeing a time",
  work_booked: "enquiries becoming work",
  enquiry_followed_up: "following up the ones that did not book",
};

/**
 * Confidence in the RELATION CLAIM, fixed by the relation alone.
 *
 * NEVER DERIVED FROM THE MEMBERS in any form — not inherited, copied,
 * averaged, nor taken as their minimum or maximum (§102). The function
 * that builds a cluster is never handed a member confidence, so there
 * is nothing there to derive from even by accident.
 *
 * `sequential_in_one_process` is `high` because adjacency is arithmetic
 * over NiteOwl's own stage table: once both findings exist, whether
 * their stages sit next to each other is fully known.
 *
 * `independent` is DELIBERATELY `low`. "No relation rule fired" is a
 * statement about a small and young rule set — three of whose four
 * positive rules cannot fire at all — and not evidence that the
 * business's problems are unrelated. A `high` here would turn an
 * absence of evidence into a positive claim, which is the one thing
 * this module must never do.
 */
const RELATION_CONFIDENCE: Readonly<Record<ScanClusterRelation, ScanConfidence>> = {
  sequential_in_one_process: "high",
  shared_cause_candidate: "low",
  competing_for_same_resource: "low",
  masked_measurement: "low",
  independent: "low",
};

/**
 * The sentence a `sequential_in_one_process` cluster carries.
 *
 * The last clause is not decoration. Without it, a sentence saying two
 * findings sit next to each other on the path is one careless reading
 * away from saying the earlier one produced the later one, which
 * §100.3 forbids the Scan outright.
 */
function sequentialWording(
  earlier: ScanFunnelStageId,
  later: ScanFunnelStageId
): string {
  return (
    `These are two points on one path, not two separate problems: ` +
    `${STAGE_PHRASE[earlier]} comes immediately before ${STAGE_PHRASE[later]} ` +
    `in the route an enquiry takes through your business. This is about ` +
    `where they sit on that path, and it does not claim that one causes ` +
    `the other.`
  );
}

/**
 * The sentence an `independent` cluster carries.
 *
 * THE SECOND SENTENCE IS THE WHOLE POINT. "We found no link" and "there
 * is no link" are different claims, and only the first is one the Scan
 * can make. Saying so out loud is what keeps a missing relation from
 * being read as an established separation.
 */
const INDEPENDENT_WORDING =
  "Our rules did not relate these two. That is not the same as knowing " +
  "they are unrelated — it means no link has been established, and we " +
  "would rather say so than invent one.";

/** A cluster id: the relation and its members, in canonical order. */
function clusterId(
  relation: ScanClusterRelation,
  members: readonly [ScanConditionCode, ScanConditionCode]
): string {
  return `${relation}:${members[0]}|${members[1]}`;
}

/** One finding, placed on the funnel. The stage lookup is total. */
interface PlacedFinding {
  readonly condition: ScanConditionCode;
  readonly stage_id: ScanFunnelStageId;
  readonly position: number;
}

function place(finding: ScanFinding): PlacedFinding {
  const stage = stageForCondition(finding.condition);
  return {
    condition: finding.condition,
    stage_id: stage.stage_id,
    position: stage.position,
  };
}

/**
 * One rung of the ladder: does this rule relate the pair?
 *
 * The pair arrives already in canonical order, earlier stage first. A
 * rule sees the two PLACEMENTS and nothing else — no evidence, no
 * confidence, no cap reason, no impact, no recommendation — which is
 * what makes "no hypothesis smuggling" checkable rather than promised.
 */
interface ClusterRule {
  readonly rule: ScanClusterRuleCode;
  readonly relation: ScanClusterRelation;
  readonly applies: (earlier: PlacedFinding, later: PlacedFinding) => boolean;
}

/**
 * The fixed ladder. First rule that fires wins; exactly one cluster per
 * pair, with `independent` as the fallthrough.
 *
 * Rules 2–4 are declared and return false unconditionally. They are not
 * dead weight: they hold the shape a later contract will fill, and the
 * sweep test that proves they never fire is what stops one being
 * enabled by a proxy in the meantime. Each `false` is a decision, and
 * the reason for it is recorded on `ScanClusterRelation`.
 */
const CLUSTER_RULE_LADDER: readonly ClusterRule[] = [
  {
    rule: "adjacent_funnel_stages",
    relation: "sequential_in_one_process",
    // LITERAL canonical adjacency. `work_booked` sits at position 4 and
    // is never assessed, and skipping it to make stages 3 and 5 adjacent
    // would assert adjacency ACROSS a stage the Scan deliberately
    // refuses to judge. Conservative, not clever.
    applies: (earlier, later) => later.position - earlier.position === 1,
  },
  {
    rule: "intersecting_hypotheses",
    relation: "shared_cause_candidate",
    // Requires §103. Hypotheses do not exist, and nothing here stands
    // in for them.
    applies: () => false,
  },
  {
    rule: "shared_owner_resource",
    relation: "competing_for_same_resource",
    // Requires a canonical resource model. There is none.
    applies: () => false,
  },
  {
    rule: "upstream_integrity_gap",
    relation: "masked_measurement",
    // Requires a canon-traceable finding-to-finding masking trigger.
    // There is none in Phase 1.
    applies: () => false,
  },
];

/** Build one cluster for an already-canonically-ordered pair. */
function makeCluster(
  relation: ScanClusterRelation,
  rule: ScanClusterRuleCode,
  earlier: PlacedFinding,
  later: PlacedFinding
): ScanCluster {
  const members: readonly [ScanConditionCode, ScanConditionCode] = [
    earlier.condition,
    later.condition,
  ];
  return {
    cluster_id: clusterId(relation, members),
    relation,
    rule,
    member_conditions: members,
    member_stage_ids: [earlier.stage_id, later.stage_id],
    // Fixed by the relation. The member findings are not in scope here.
    relation_confidence: RELATION_CONFIDENCE[relation],
    source_type: "derived_deterministic",
    wording:
      relation === "sequential_in_one_process"
        ? sequentialWording(earlier.stage_id, later.stage_id)
        : INDEPENDENT_WORDING,
  };
}

/**
 * Derive one run's clusters.
 *
 * Fewer than two findings produces an empty array — §102's *"a
 * single-finding report has no clusters at all"* and §107.4's
 * requirement that clustering output be empty on a zero-findings
 * report.
 *
 * Every unordered pair yields exactly one cluster. Pairs are ordered by
 * funnel stage position, and members within a pair likewise, so the
 * result does not depend on the order the caller supplied. The findings
 * themselves are never copied, re-ranked, re-confidenced or altered:
 * only their condition codes travel, as references.
 */
export function deriveClusters(findings: readonly ScanFinding[]): ScanCluster[] {
  if (findings.length < 2) return [];

  const placed = findings.map(place).sort((a, b) => a.position - b.position);

  const clusters: ScanCluster[] = [];

  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const earlier = placed[i];
      const later = placed[j];

      const fired = CLUSTER_RULE_LADDER.find((rule) => rule.applies(earlier, later));

      clusters.push(
        fired
          ? makeCluster(fired.relation, fired.rule, earlier, later)
          : makeCluster("independent", "no_relation_rule_fired", earlier, later)
      );
    }
  }

  return clusters;
}
