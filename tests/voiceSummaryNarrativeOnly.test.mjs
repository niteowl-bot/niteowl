// F4 Step 3: the provider summary is narrative, and nothing else.
//
// buildSummaryInstructions used to require SEVEN labelled facts — Name,
// Email, Callback number, the date, the time, Address, Issue — each
// written as "Label: value", with "Not provided" wherever a value was
// missing. That made the summarising model a second, unguarded source
// for every fact the deterministic pipeline had already resolved: it
// reads only the transcript, answers to none of the guards, and was
// reproduced contradicting canonical values on the caller's name, their
// email, their address and their callback timing.
//
// Most of the removed prompt was scar tissue from exactly those
// contradictions. Each labelled fact had needed its own paragraph of
// defence — how to render a settled date, when "Not provided" was
// honest for a number the receptionist is forbidden to read aloud, which
// of two label sets to choose — and the model still had to be trusted to
// obey all of it.
//
// The labels existed because the owner had nowhere else to read those
// facts. PRs #45 and #49 ended that: every one is now a canonical
// structured row, resolved once and rendered from the same value the
// lead, the calendar and the dashboard carry. So the labels are removed
// rather than defended.
//
// What the paragraph keeps is the job the rows cannot do — telling the
// owner what the call was actually about — and the grounding rules that
// keep prose honest, because narrative can still invent a time, repeat a
// value the caller corrected, or imply a booking that does not exist.
//
// ── What these tests can and cannot prove ─────────────────────────
// This is a MODEL-BEHAVIOUR prompt change. The suite can prove the
// instruction is present, coherent and mutation-sensitive; it can never
// prove the model obeys it. That is the PR #34 lesson, learned when 54
// green tests accompanied a feature that did nothing in production, and
// re-learned in PR #40. One live production call is the gate that
// actually closes F4 Step 3, and it is deliberately NOT part of this PR.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildVoiceAssistantConfig } from "@/lib/voice/assistant";
import { buildVapiAssistantResponse } from "@/lib/voice/vapi";

const ORG = {
  business_name: "Acme Plumbing",
  business_type: "plumber",
  primary_goal: "book jobs",
  description: null,
  website: null,
};
const SETTINGS = { greeting: null, voice_id: null, language: null };

const instructions = (callerPhone = "+353861234567") =>
  buildVoiceAssistantConfig(ORG, [], SETTINGS, null, callerPhone)
    .summaryInstructions;

/**
 * The seven labels the paragraph used to be required to enumerate, with
 * the exact prescriptive wording that required each. Asserting on the
 * REQUIREMENT rather than the bare word matters: the new prompt still
 * names several of these in order to FORBID them, and a test that
 * searched for the word alone would fail on the prohibition that fixes
 * the defect.
 */
const REMOVED_LABEL_REQUIREMENTS = [
  ['the seven-label list', /give these seven details in this order/],
  ['the "Label: value" format', /each written as "Label: value"/],
  ["the completeness demand", /Include all seven labels every time/],
  ['the "Not provided" convention', /Write "Not provided" ONLY if/],
  ["the Callback number rules", /Callback number: the caller's own number/],
  ["the Callback date rule", /Callback date: if the transcript settled/],
  ["the Callback time rule", /Callback time: a time window the caller gave/],
  ["the label-choosing block", /LABEL THE DATE AND TIME FOR WHAT THEY ACTUALLY ARE/],
  ["the Email rendering rule", /Email: write the address in normal written form/],
];

describe("the summary no longer enumerates canonical facts", () => {
  // ── 1. the seven factual labels are gone ────────────────────────

  for (const [name, pattern] of REMOVED_LABEL_REQUIREMENTS) {
    test(`${name} is no longer required`, () => {
      assert.doesNotMatch(instructions(), pattern);
    });
  }

  test("no label name survives as an instruction to write one", () => {
    const summary = instructions();
    for (const label of [
      "Callback number",
      "Callback date",
      "Callback time",
      "Appointment date",
      "Appointment time",
      "Number calling from",
    ]) {
      assert.doesNotMatch(
        summary,
        new RegExp(label),
        `"${label}" should not appear at all`
      );
    }
  });

  test("the paragraph is told the facts live elsewhere, and not to restate them", () => {
    const summary = instructions();
    assert.match(summary, /DO NOT list the caller's details/);
    assert.match(
      summary,
      /recorded separately and shown to the owner as their own fields in this same email/
    );
    assert.match(summary, /Do not restate them as a list/);
    assert.match(summary, /do not write them as "Label: value"/);
    assert.match(summary, /do not write "Not provided" for anything/);
    assert.match(summary, /no labelled fields/);
  });

  test("every fact the labels used to carry is named as belonging elsewhere", () => {
    // Named explicitly so a future reader can see the mapping from the
    // seven old labels to the canonical rows that replaced them.
    const summary = instructions();
    for (const fact of [
      "name",
      "email address",
      "phone number",
      "service address",
      "the service they want",
      "the day or time they asked for",
      "urgency",
      "booking outcome",
    ]) {
      assert.ok(
        summary.includes(fact),
        `the instruction should name "${fact}" as recorded separately`
      );
    }
  });

  // ── 2. the narrative remains useful prose ───────────────────────

  test("the paragraph is still asked for real context, not just a stub", () => {
    const summary = instructions();
    assert.match(
      summary,
      /Write two or three short sentences saying who called and what they wanted/
    );
    // The part a structured row genuinely cannot carry.
    assert.match(
      summary,
      /anything about the request the business would want to know that a form field could not carry/
    );
    assert.match(summary, /the problem in their own words/);
    // Naming a detail in a sentence is allowed; enumerating is not. The
    // paragraph must not become unreadably evasive.
    assert.match(
      summary,
      /Naming a detail in a natural sentence is fine where it is genuinely part of the story/
    );
  });

  test("it is still a note-taker, and still returns prose only", () => {
    const summary = instructions();
    assert.match(summary, /precise note-taker/i);
    assert.match(summary, /Return only the summary/);
    assert.match(summary, /No preamble, no headings, no markdown/);
  });

  // ── 3. the honesty rules that govern PROSE all survive ──────────

  test("grounding rules are kept — narrative can still invent", () => {
    const summary = instructions();
    assert.match(summary, /Use ONLY what was actually said on the call/);
    assert.match(summary, /Never infer, assume, or fill in a detail/);
    assert.match(summary, /Never invent or adjust a date, a time/);
    assert.match(summary, /write that vague phrase exactly as they said it/);
    assert.match(summary, /never turn it into a specific date or clock time/);
  });

  test("corrections still win in prose (PR #39 / #43 territory)", () => {
    const summary = instructions();
    assert.match(summary, /report ONLY their corrected version/);
    assert.match(summary, /Never report the mis-heard value, and never report both/);
  });

  test("urgency is still never a day or a clock time (PR #35)", () => {
    const summary = instructions();
    assert.match(summary, /URGENCY IS NOT A DATE AND NOT A TIME/);
    assert.match(summary, /Never turn one of them into a day or a clock time/);
    // Still reported — as narrative, which is where it belongs.
    assert.match(
      summary,
      /say plainly that they asked to be seen or called back as soon as possible/
    );
  });

  test("booking truth is still enforced in prose (PR #30 / #37)", () => {
    const summary = instructions();
    assert.match(
      summary,
      /report it as a callback request — never as a booked or requested appointment/
    );
    assert.match(summary, /never call it confirmed/);
  });

  test("a detail that cannot be supported goes unmentioned, not asserted absent", () => {
    // The old prompt made the model assert absence ("Not provided") from
    // a transcript that could not prove it — which is how a known caller
    // ID came to be summarised as missing. Silence is now the answer.
    assert.match(
      instructions(),
      /a detail you cannot support from the transcript must simply go unmentioned/
    );
  });

  // ── 4. nothing else about the config moved ──────────────────────

  test("the change is confined to the summary instructions", () => {
    const config = buildVoiceAssistantConfig(
      ORG,
      [],
      SETTINGS,
      null,
      "+353861234567"
    );
    // The config's key set must not have grown — no new switch, no new
    // provider field smuggled in alongside a prompt edit.
    assert.deepEqual(
      Object.keys(config).sort(),
      [
        "firstMessage",
        "language",
        "maxDurationSeconds",
        "serverUrl",
        "structuredDataSchema",
        "summaryInstructions",
        "voiceId",
        "systemPrompt",
      ].sort()
    );
    // The extraction schema still carries every field it did: the
    // paragraph stopped restating facts, the pipeline did not stop
    // collecting them.
    const properties = config.structuredDataSchema.properties;
    for (const field of [
      "intent",
      "name",
      "email",
      "phone",
      "service",
      "preferred_datetime",
      "service_address",
      "urgent",
    ]) {
      assert.ok(properties[field], `the schema should still extract ${field}`);
    }
  });

  test("the summary is still delivered through the provider's own plan", () => {
    const config = buildVoiceAssistantConfig(
      ORG,
      [],
      SETTINGS,
      null,
      "+353861234567"
    );
    const plan = buildVapiAssistantResponse(config).assistant.analysisPlan
      .summaryPlan;
    assert.equal(plan.enabled, true);
    assert.equal(plan.messages[0].role, "system");
    assert.equal(plan.messages[0].content, config.summaryInstructions);
    // Provider template syntax stays in the adapter, never in the prompt.
    assert.doesNotMatch(config.summaryInstructions, /\{\{/);
    assert.match(plan.messages[1].content, /\{\{transcript\}\}/);
  });

  test("the transcriber and voice configuration are untouched by this change", () => {
    const config = buildVoiceAssistantConfig(
      ORG,
      [],
      SETTINGS,
      null,
      "+353861234567"
    );
    const { assistant } = buildVapiAssistantResponse(config);
    // Recorded because F4 Step 3 is a prompt change and must not become
    // a provider change: Deepgram nova-2 en-GB is what production runs.
    assert.equal(assistant.transcriber.provider, "deepgram");
    assert.equal(assistant.transcriber.model, "nova-2");
  });
});
