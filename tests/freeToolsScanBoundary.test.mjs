// The scan's pure logic must be unable to reach anything.
//
// These tests are STRUCTURAL rather than behavioural, in the style of
// the Setup Kit's boundary suite. They assert what the scan modules are
// allowed to IMPORT and to CONTAIN, because the guarantees Phase 1
// makes are only worth something while something enforces them:
//
//   NO MODEL IS IN THE PATH (§87.3). A language model may phrase the
//   prose around a finding; it may never decide that a finding exists,
//   never produce an operand and never alter the ranking. A module that
//   cannot import an SDK and cannot reach the network cannot quietly
//   acquire one later.
//
//   NO TENANT, NO REMY, NO PROVIDER, NO PERSISTENCE. A scan runs before
//   a tenant exists at all (§83.3), so the free-product namespace's
//   isolation is STRUCTURAL — it has no org_id to bind a query
//   discipline to (§26, docs/AGENT_ACCESS_LAYER.md §25.1).
//
//   NO CLOCK, NO RANDOMNESS, NO EXTERNAL STATE. Determinism is the
//   acceptance test for every number the Scan displays (§88.4), and a
//   function that reads the time is not deterministic. Timestamps are
//   passed in.
//
//   THREE CONDITION CODES, AND NO FOURTH. The NOT-IN-MVP classes —
//   capacity, retention, repeat business, operational handoff, cash
//   flow, marketing (§81.3) — are a Part XI boundary change, not an
//   enumeration edit, and no run of the engine may emit one.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { deriveFindings } from "@/lib/freetools/scanFindings";
import { SCAN_CONDITION_ORDER } from "@/lib/freetools/scanTypes";
import { validateScanAnswers } from "@/lib/freetools/scanValidation";

/** The five Phase 1 pure-logic modules. Nothing else is in scope here. */
const SCAN_MODULES = [
  "src/lib/freetools/scanTypes.ts",
  "src/lib/freetools/scanQuestions.ts",
  "src/lib/freetools/scanValidation.ts",
  "src/lib/freetools/scanFindings.ts",
  "src/lib/freetools/scanLostRevenue.ts",
];

/** Import statements only — comments discussing Remy are fine. */
const importsOf = (file) =>
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => /^\s*import\s/.test(l) || /^\s*}?\s*from\s+["']/.test(l))
    .join("\n");

/** Code with comment lines stripped — the same shape the Setup Kit uses. */
const codeOf = (file) =>
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

// ── 1. Imports ─────────────────────────────────────────────────────

describe("the scan modules cannot reach Remy, a provider or a tenant", () => {
  test("no Remy, provider, database or email import", () => {
    for (const file of SCAN_MODULES) {
      assert.doesNotMatch(
        importsOf(file),
        /leadCapture|lib\/voice|availability|bookingAvailability|calendarSync|lib\/calendar|integrations|supabase|@supabase|lib\/email|parseDatetime|resend|stripe/i,
        `${file} imports something it must not`
      );
    }
  });

  test("no model or AI SDK import of any kind", () => {
    for (const file of SCAN_MODULES) {
      assert.doesNotMatch(
        importsOf(file),
        /openai|anthropic|@ai-sdk|langchain|vapi|deepgram|\bai\b/i,
        `${file} imports a model SDK`
      );
    }
  });

  test("no framework, request or React import", () => {
    for (const file of SCAN_MODULES) {
      assert.doesNotMatch(
        importsOf(file),
        /next\/|react|server-only|node:|fs|http/i,
        `${file} imports a runtime it has no business needing`
      );
    }
  });

  test("every import is a sibling scan module", () => {
    for (const file of SCAN_MODULES) {
      const specifiers = readFileSync(file, "utf8").match(/from\s+["']([^"']+)["']/g) ?? [];
      for (const specifier of specifiers) {
        assert.match(
          specifier,
          /["']@\/lib\/freetools\/scan(Types|Questions|Validation|Findings|LostRevenue)["']/,
          `${file} imports ${specifier}`
        );
      }
    }
  });
});

// ── 2. What the code may contain ───────────────────────────────────

describe("the scan modules reach no network, storage or identifier", () => {
  test("no network call", () => {
    for (const file of SCAN_MODULES) {
      assert.doesNotMatch(
        codeOf(file),
        /fetch\(|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon|axios/,
        `${file} reaches the network`
      );
    }
  });

  test("no persistence or storage of any kind", () => {
    for (const file of SCAN_MODULES) {
      assert.doesNotMatch(
        codeOf(file),
        /localStorage|sessionStorage|document\.cookie|indexedDB|writeFile|readFile|\.from\(["']|insert\(|upsert\(/,
        `${file} reaches for storage`
      );
    }
  });

  test("no environment, no secret, no identifier generation", () => {
    for (const file of SCAN_MODULES) {
      assert.doesNotMatch(
        codeOf(file),
        /process\.env|randomUUID|crypto\.|Math\.random/,
        `${file} reaches for the environment or an identifier`
      );
    }
  });

  test("no clock — timestamps are passed in, never read", () => {
    for (const file of SCAN_MODULES) {
      assert.doesNotMatch(
        codeOf(file),
        /Date\.now|new Date\(|performance\.now|toISOString/,
        `${file} reads a clock, which makes it non-deterministic`
      );
    }
  });

  test("no tenant concept anywhere", () => {
    for (const file of SCAN_MODULES) {
      assert.doesNotMatch(
        codeOf(file),
        /org_id|orgId|organisation|organization|tenant/i,
        `${file} introduces a tenant concept`
      );
    }
  });

  test("no provider vocabulary leaks into the types", () => {
    for (const file of SCAN_MODULES) {
      assert.doesNotMatch(
        codeOf(file),
        /google|vapi|openai|resend|stripe|calendar_id|structuredData/i,
        `${file} names a provider`
      );
    }
  });

  test("nothing claims to be observed or verified", () => {
    for (const file of SCAN_MODULES) {
      assert.doesNotMatch(
        codeOf(file),
        /"observed"|"verified"|"ai_predicted"/,
        `${file} can express a claim Phase 1 cannot support`
      );
    }
  });
});

// ── 3. The condition enumeration is exactly three ──────────────────

describe("the condition enumeration contains exactly the Phase 1 three", () => {
  test("the exported order is the three codes and nothing else", () => {
    assert.equal(SCAN_CONDITION_ORDER.length, 3);
    assert.deepEqual([...SCAN_CONDITION_ORDER], [
      "enquiry.unanswered",
      "enquiry.no_followup",
      "booking.friction",
    ]);
  });

  test("the declared type union has exactly three members", () => {
    const src = readFileSync("src/lib/freetools/scanTypes.ts", "utf8");
    const union = src.match(/export type ScanConditionCode =([\s\S]*?);/);
    assert.ok(union, "ScanConditionCode is not declared where expected");
    const members = union[1].match(/"[^"]+"/g) ?? [];
    assert.equal(members.length, 3, `the union declares ${members.length} codes`);
    assert.deepEqual(members, [
      '"enquiry.unanswered"',
      '"enquiry.no_followup"',
      '"booking.friction"',
    ]);
  });

  test("no NOT-IN-MVP condition code appears in any module", () => {
    for (const file of SCAN_MODULES) {
      assert.doesNotMatch(
        codeOf(file),
        /capacity\.|retention\.|repeat_business\.|repeat\.|handoff\.|cashflow\.|cash_flow\.|finance\.|marketing\./i,
        `${file} names a class Phase 1 deliberately excluded`
      );
    }
  });

  test("no exhaustive sweep of the answer space can emit a fourth code", () => {
    const emitted = new Set();
    let runs = 0;

    const q3s = [{ kind: "not_sure" }, { kind: "count", value: 20 }, { kind: "count", value: 5 }];
    const q4s = [
      undefined,
      { kind: "not_sure" },
      { kind: "count", value: 0 },
      { kind: "count", value: 1 },
      { kind: "count", value: 9 },
      { kind: "count", value: 999 },
    ];
    const q5s = ["yes_always", "sometimes", "no"];
    const q6s = ["within_a_day", "eventually", "only_if_they_return", "nothing_planned", "not_sure"];
    const q7s = ["one", "two_or_three", "more_than_three", "varies_a_lot", "not_sure"];
    const q8s = [
      undefined,
      { kind: "not_sure" },
      { kind: "amount", amount: 250, currency: "EUR" },
      { kind: "range", low: 100, high: 400, currency: "EUR" },
    ];
    const q9s = [undefined, "most", "about_half", "a_minority", "not_sure"];

    for (const q3 of q3s)
      for (const q4 of q4s)
        for (const q5 of q5s)
          for (const q6 of q6s)
            for (const q7 of q7s)
              for (const q8 of q8s)
                for (const q9 of q9s) {
                  const input = {
                    q1_channels: ["phone"],
                    q2_reachable: "varies",
                    q3_enquiries_per_week: q3,
                    q5_miss_visibility: q5,
                    q6_followup: q6,
                    q7_messages_to_book: q7,
                  };
                  if (q4 !== undefined) input.q4_unanswered_per_week = q4;
                  if (q8 !== undefined) input.q8_typical_job_value = q8;
                  if (q9 !== undefined) input.q9_conversion_share = q9;

                  const validated = validateScanAnswers(input);
                  assert.equal(validated.valid, true, JSON.stringify(validated.errors));

                  const found = deriveFindings(validated.answers);
                  assert.ok(found.length <= 3, "more than three findings");
                  for (const f of found) emitted.add(f.condition);
                  runs += 1;
                }

    assert.ok(runs > 5000, `the sweep only ran ${runs} cases`);
    assert.deepEqual(
      [...emitted].sort(),
      ["booking.friction", "enquiry.no_followup", "enquiry.unanswered"]
    );
  });
});

// ── 4. No seam a model could be threaded through ───────────────────

describe("the finding path has no seam for a model", () => {
  test("deriveFindings takes answers and nothing else", () => {
    assert.equal(deriveFindings.length, 1);
  });

  test("no module accepts a callback, client or generator argument", () => {
    for (const file of SCAN_MODULES) {
      assert.doesNotMatch(
        codeOf(file),
        /=>\s*Promise|async function|await |client:|generate\(|complete\(|prompt:/i,
        `${file} exposes a seam an inference call could enter through`
      );
    }
  });
});
