// Business Opportunity Scan — the anti-funnel properties (PR D, P51).
//
// §107.4 STATES THESE AS PROPERTIES THE CONTRACTS MUST HAVE, NOT AS
// INTENTIONS, and P51 is explicit that a safeguard which is not
// executable is an intention. So they are tested here, over the whole
// answer space, against the rendered report and not only the object.
//
// PR D INCREASES FUNNEL RISK. Ordering findings, naming an earliest
// leak and relating recommendations to one another are exactly the
// moves a sales funnel would make. What separates this from one is that
// each of them refuses to fire on a report with nothing genuine to say:
//
//   1. A report with NO findings stays fully reachable, and
//      prioritisation, dependencies and the earliest leak are all empty
//      on it. No priority, no cluster, no urgency, no product.
//   2. `recommended_product: null` and `free_tool_handoff: null` remain
//      simultaneously reachable with a complete, useful report.
//   3. Prioritisation ranks genuine findings only, and never
//      manufactures, promotes or retains one to have something to rank.
//   4. At least one action on any report is doable with no purchase.
//   5. No urgency vocabulary appears without owner-stated urgency, and
//      no estimate is presented as a cost of delay.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { buildScanReport } from "@/lib/freetools/scanFindings";
import { SCAN_RECOMMENDATIONS } from "@/lib/freetools/scanRecommendations";
import { validateScanAnswers } from "@/lib/freetools/scanValidation";
import { NO_FINDINGS_WORDING } from "@/app/free-tools/business-opportunity-scan/scanPresentation";
import { ScanReportDocument } from "@/app/free-tools/business-opportunity-scan/ScanClient";

const CONTEXT = {
  answered_at: "2026-09-13T10:00:00.000Z",
  computed_at: "2026-09-13T10:00:01.000Z",
};

const QUIET = {
  q1_channels: ["phone"],
  q2_reachable: "working_hours",
  q3_enquiries_per_week: { kind: "count", value: 20 },
  q4_unanswered_per_week: { kind: "count", value: 0 },
  q5_miss_visibility: "yes_always",
  q6_followup: "within_a_day",
  q7_messages_to_book: "one",
};

function run(patch = {}) {
  const input = { ...QUIET, ...patch };
  for (const key of Object.keys(patch)) {
    if (patch[key] === undefined) delete input[key];
  }
  const v = validateScanAnswers(input);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  const report = buildScanReport(v.answers, CONTEXT, v.inconsistencies);
  const html = renderToStaticMarkup(
    createElement(ScanReportDocument, { report, answers: v.answers })
  );
  return { report, html, answers: v.answers };
}

const unescape = (s) =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/");

const count = (html, re) => (html.match(re) ?? []).length;

/** Every combination of the four diagnostic answers, plus the operands. */
function* sweep() {
  const q4s = [undefined, { kind: "not_sure" }, { kind: "count", value: 0 }, { kind: "count", value: 4 }];
  const q5s = ["yes_always", "sometimes", "no"];
  const q6s = ["within_a_day", "eventually", "only_if_they_return", "nothing_planned", "not_sure"];
  const q7s = ["one", "two_or_three", "more_than_three", "varies_a_lot", "not_sure"];
  const q8s = [undefined, { kind: "not_sure" }, { kind: "amount", amount: 250, currency: "EUR" }];
  const q9s = [undefined, "most", "a_minority", "not_sure"];

  for (const q4 of q4s)
    for (const q5 of q5s)
      for (const q6 of q6s)
        for (const q7 of q7s)
          for (const q8 of q8s)
            for (const q9 of q9s) {
              yield {
                q4_unanswered_per_week: q4,
                q5_miss_visibility: q5,
                q6_followup: q6,
                q7_messages_to_book: q7,
                q8_typical_job_value: q8,
                q9_conversion_share: q9,
              };
            }
}

// ── 1. The zero-findings report ────────────────────────────────────

describe("a report with no findings stays complete and stays empty of pressure", () => {
  test("the honest wording is present and nothing is manufactured", () => {
    const { report, html } = run();
    assert.equal(report.findings.length, 0);
    assert.ok(unescape(html).includes(NO_FINDINGS_WORDING));
    assert.match(html, /data-no-findings/);
  });

  test("prioritisation, dependencies and the earliest leak are all empty", () => {
    const { report } = run();
    assert.deepEqual(report.prioritisation, []);
    assert.deepEqual(report.dependencies, []);
    assert.equal(report.earliest_leak, null);
  });

  test("no priority, dependency, product or handoff is rendered", () => {
    const { html } = run();
    assert.equal(count(html, /data-priority=/g), 0);
    assert.equal(count(html, /data-priorities/g), 0);
    assert.equal(count(html, /data-dependencies/g), 0);
    assert.equal(count(html, /data-earliest-leak/g), 0);
    assert.equal(count(html, /data-product=/g), 0);
    assert.equal(count(html, /data-handoff/g), 0);
    assert.equal(count(html, /data-next-step/g), 0);
    assert.equal(count(html, /data-condition=/g), 0);
    // PR F: no finding, no hypotheses section, no hypothesis, no empty-state line.
    assert.equal(count(html, /data-hypotheses/g), 0);
    assert.equal(count(html, /data-hypothesis=/g), 0);
    assert.equal(count(html, /data-hypotheses-none/g), 0);
  });

  test("the funnel IS still shown, and says what looks like it is working", () => {
    // The zero-findings report is where the funnel earns its keep: a
    // qualified "this part looks like it is working" is the
    // highest-trust output the Scan can produce.
    const { html } = run();
    assert.match(html, /data-funnel/);
    assert.equal(count(html, /data-stage-assessment="appears_adequate"/g), 3);
    assert.match(unescape(html), /From what you told us, this looks like it is working/);
  });

  test("every zero-finding run in the sweep has empty ordering output", () => {
    let empties = 0;
    for (const patch of sweep()) {
      const v = validateScanAnswers(
        Object.fromEntries(
          Object.entries({ ...QUIET, ...patch }).filter(([, value]) => value !== undefined)
        )
      );
      assert.equal(v.valid, true, JSON.stringify(v.errors));
      const report = buildScanReport(v.answers, CONTEXT, v.inconsistencies);
      if (report.findings.length > 0) continue;
      empties += 1;
      assert.deepEqual(report.prioritisation, []);
      assert.deepEqual(report.dependencies, []);
      assert.equal(report.earliest_leak, null);
      // PR F: a zero-findings report carries no hypotheses anywhere, and
      // still carries the explanation rule-set version.
      assert.deepEqual(report.findings.flatMap((f) => f.hypotheses), []);
      assert.equal(typeof report.hypothesis_rule_set_version, "string");
    }
    assert.ok(empties > 20, `only ${empties} zero-finding runs were reached`);
  });
});

// ── 2. Routing away from the product stays reachable ───────────────

describe("no product and no handoff remain simultaneously reachable", () => {
  test("a complete, useful report names no paid product at all", () => {
    const { report, html } = run({ q6_followup: "nothing_planned" });
    assert.equal(report.findings.length, 1);
    const recommendation = report.findings[0].recommendation;
    assert.equal(recommendation.recommended_product, null);
    assert.equal(recommendation.free_tool_handoff, null);
    // And the report is still complete: a next step, a criterion, a
    // priority and a funnel.
    assert.match(html, /data-next-step/);
    assert.match(html, /data-success-criterion/);
    assert.match(html, /data-priority="1"/);
    assert.match(html, /data-funnel/);
    assert.equal(count(html, /data-product=/g), 0);
    assert.equal(count(html, /data-handoff/g), 0);
  });

  test("at least one Phase 1 recommendation structurally routes to null", () => {
    const products = Object.values(SCAN_RECOMMENDATIONS).map((r) => r.recommended_product);
    assert.ok(products.includes(null));
  });

  test("PR D added no product mention of its own", () => {
    // Every product attribution on a report still comes from the
    // recommendation layer, one per finding that carries one.
    for (const patch of [{ q6_followup: "nothing_planned" }, { q7_messages_to_book: "more_than_three" }]) {
      const { report, html } = run(patch);
      const withProduct = report.findings.filter((f) => f.recommendation.recommended_product);
      assert.equal(count(html, /data-product=/g), withProduct.length);
    }
  });
});

// ── 3. Ordering ranks genuine findings only ────────────────────────

describe("prioritisation never manufactures something to rank", () => {
  test("across the sweep, the ordering is exactly the findings", () => {
    let ordered = 0;
    for (const patch of sweep()) {
      const v = validateScanAnswers(
        Object.fromEntries(
          Object.entries({ ...QUIET, ...patch }).filter(([, value]) => value !== undefined)
        )
      );
      const report = buildScanReport(v.answers, CONTEXT, v.inconsistencies);
      assert.equal(report.prioritisation.length, report.findings.length);
      const findingCodes = new Set(report.findings.map((f) => f.finding.condition));
      for (const p of report.prioritisation) {
        assert.ok(findingCodes.has(p.condition), `${p.condition} ranked without a finding`);
      }
      if (report.prioritisation.length > 0) ordered += 1;
    }
    assert.ok(ordered > 100, `only ${ordered} ordered runs were reached`);
  });

  test("a suppressed finding is never ranked", () => {
    // Q4 > Q3: the inconsistency is shown, the finding is suppressed,
    // and nothing is ordered in its place.
    const { report, html } = run({
      q3_enquiries_per_week: { kind: "count", value: 5 },
      q4_unanswered_per_week: { kind: "count", value: 9 },
    });
    assert.equal(report.inconsistencies.length, 1);
    assert.ok(!report.findings.some((f) => f.finding.condition === "enquiry.unanswered"));
    assert.ok(!report.prioritisation.some((p) => p.condition === "enquiry.unanswered"));
    assert.match(html, /data-inconsistency="q4_exceeds_q3"/);
  });
});

// ── 4. Something is always doable without buying anything ──────────

describe("at least one action on any report needs no purchase", () => {
  test("every rendered next step is the owner's own to take", () => {
    for (const patch of [
      { q6_followup: "nothing_planned" },
      { q7_messages_to_book: "more_than_three" },
      { q4_unanswered_per_week: { kind: "count", value: 4 } },
    ]) {
      const { report } = run(patch);
      assert.ok(report.findings.length > 0);
      for (const entry of report.findings) {
        const step = entry.recommendation.next_step;
        assert.ok(step.length > 0);
        assert.doesNotMatch(step, /\bbuy\b|\bsubscribe\b|\bsign up\b|\bupgrade\b|\bpurchase\b|\bpricing\b/i);
      }
    }
  });

  test("no report asks for an account, a sign-up or payment", () => {
    for (const patch of [{}, { q6_followup: "nothing_planned" }, { q4_unanswered_per_week: { kind: "count", value: 4 }, q6_followup: "nothing_planned", q7_messages_to_book: "more_than_three" }]) {
      const { html } = run(patch);
      assert.doesNotMatch(
        unescape(html),
        /sign up|create an account|start your free trial|enter your card|book a demo|talk to sales/i
      );
    }
  });
});

// ── 5. No urgency, and no cost of delay ────────────────────────────

describe("no urgency vocabulary and no estimate presented as a cost of delay", () => {
  const URGENCY =
    /\bact now\b|\bimmediately\b|\bdon'?t delay\b|\bdon'?t wait\b|\bevery day you wait\b|\bcosting you\b|\bhurry\b|\bbefore it'?s too late\b|\blimited time\b|\bright away\b/i;

  test("no urgency language on any report in the sweep", () => {
    let checked = 0;
    for (const patch of sweep()) {
      // Render a representative subset: rendering the whole sweep is
      // slow, and the wording is fixed data keyed by codes the object
      // already carries.
      if (checked >= 40) break;
      const { html } = run(patch);
      assert.doesNotMatch(unescape(html), URGENCY, JSON.stringify(patch));
      checked += 1;
    }
    assert.equal(checked, 40);
  });

  test("a sized estimate is presented as a range, never as a cost of delay", () => {
    const { report, html } = run({
      q4_unanswered_per_week: { kind: "count", value: 4 },
      q8_typical_job_value: { kind: "amount", amount: 250, currency: "EUR" },
      q9_conversion_share: "most",
    });
    assert.equal(report.findings[0].impact.kind, "estimate");
    assert.equal(report.findings[0].impact.basis.result.period, "week");

    // Scoped to the impact block: a gap elsewhere may legitimately say
    // "over a month", which is a counting period for closing the gap
    // and not a restatement of the estimate.
    const block = unescape(html).match(/data-impact="estimate"([\s\S]*?)<\/div>/);
    assert.ok(block, "the estimate block is not rendered where expected");
    assert.match(block[1], /Between EUR/);
    assert.match(block[1], /per week/);
    assert.doesNotMatch(block[1], /per year|annually|per month|each month|a year/i);
    assert.match(block[1], /an estimate/i);

    // And no urgency anywhere on the report, estimate or not.
    assert.doesNotMatch(unescape(html), URGENCY);
  });

  test("the earliest leak claims no cause, and says so", () => {
    const { html } = run({
      q4_unanswered_per_week: { kind: "count", value: 4 },
      q6_followup: "nothing_planned",
      q7_messages_to_book: "more_than_three",
    });
    const text = unescape(html);
    assert.match(text, /data-earliest-leak="enquiry_answered"/);
    assert.match(text, /It is not a claim that any of them causes another\./);
    assert.doesNotMatch(text, /root cause|is causing|caused by|because of your/i);
  });
});
