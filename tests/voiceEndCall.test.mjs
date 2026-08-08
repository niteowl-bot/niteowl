// Regression: Remy said goodbye but never hung up.
//
// The 2026-08-06 production call ended like this:
//
//   AI:   "Thank you for calling Nite Owl Test. Have a great day.
//          Goodbye. Bye."
//   User: "Thanks. Bye."
//   AI:   "Goodbye."
//   User: "Bye."
//   AI:   "Goodbye."
//
// Everything else on that call was correct. The assistant recognised
// the conversation was over — it simply had no way to end it: the
// transient assistant we send Vapi carried NO tools at all, so the line
// stayed open until the caller rang off or maxDurationSeconds expired,
// and every further "bye" got answered.
//
// The fix is in two halves and needs both: the capability (Vapi's
// built-in endCall tool, wired into model.tools) and the instruction
// (rule 11 says when to use it). These tests pin each half. As with the
// rest of the voice prompt suite, the prompt assertions prove the
// wording is in the built prompt — only the tool's presence is a
// guarantee about what the model is ABLE to do.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildVoiceAssistantConfig } from "@/lib/voice/assistant";
import {
  buildVapiAssistantResponse,
  buildVapiDeclineResponse,
} from "@/lib/voice/vapi";

const ORG = {
  business_name: "Acme Plumbing",
  business_type: "plumber",
  primary_goal: "book jobs",
  description: null,
  website: null,
};
const SETTINGS = { greeting: null, voice_id: null, language: null };
const MONDAY_3_AUG_2026 = new Date("2026-08-03T09:00:00+01:00");

function configFor(callerPhone = "+353861234567") {
  return buildVoiceAssistantConfig(
    ORG,
    [],
    SETTINGS,
    null,
    callerPhone,
    MONDAY_3_AUG_2026
  );
}

const promptFor = (callerPhone) => configFor(callerPhone).systemPrompt;
const assistantFor = (callerPhone) =>
  buildVapiAssistantResponse(configFor(callerPhone)).assistant;

describe("the capability — Remy can actually hang up", () => {
  test("the assistant carries Vapi's built-in endCall tool", () => {
    const tools = assistantFor().model.tools;
    assert.ok(Array.isArray(tools), "model.tools must exist");
    assert.ok(
      tools.some((tool) => tool.type === "endCall"),
      "the endCall tool is what actually ends the call"
    );
  });

  test("it is the whole tool definition — a default tool needs no function", () => {
    const endCall = assistantFor().model.tools.find((t) => t.type === "endCall");
    assert.deepEqual(
      endCall,
      { type: "endCall" },
      "Vapi default tools are recognised by type alone"
    );
  });

  test("no other tool was introduced alongside it", () => {
    assert.equal(assistantFor().model.tools.length, 1);
  });

  test("the withheld-caller-ID assistant can hang up too", () => {
    assert.ok(assistantFor(null).model.tools.some((t) => t.type === "endCall"));
  });

  test("endCallPhrases is NOT used — it would cut callers off mid-sentence", () => {
    // Vapi's phrase matcher fires on literal caller speech, so
    // "bye for now, but I have another question" would hang up on the
    // word "bye". The decision has to stay with the model (test D).
    const assistant = assistantFor();
    assert.equal(assistant.endCallPhrases, undefined);
  });

  test("the rest of the assistant payload is unchanged", () => {
    // The fix adds a tool; it must not have disturbed anything the
    // live call already depended on.
    const assistant = assistantFor();
    assert.equal(assistant.name, "Remy");
    assert.equal(assistant.model.provider, "openai");
    assert.equal(assistant.model.model, "gpt-4o");
    assert.equal(assistant.model.messages[0].role, "system");
    assert.equal(assistant.maxDurationSeconds, 600);
    assert.deepEqual(assistant.serverMessages, [
      "end-of-call-report",
      "status-update",
    ]);
    assert.equal(assistant.artifactPlan.recordingEnabled, false);
    assert.equal(assistant.analysisPlan.summaryPlan.enabled, true);
    assert.equal(assistant.analysisPlan.structuredDataPlan.enabled, true);
  });

  test("the decline assistant can end its call as well", () => {
    // It was already told to "end the call" and had no way to do it.
    const assistant = buildVapiDeclineResponse("Acme Plumbing").assistant;
    assert.ok(assistant.model.tools.some((t) => t.type === "endCall"));
    assert.match(assistant.model.messages[0].content, /end the call with the end-call tool/);
  });
});

describe("the instruction — when the call ends", () => {
  test("A/B — the closing line is said once, then the call ends", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /Thank you for calling Acme Plumbing\. Have a great day\. Goodbye\./
    );
    assert.match(prompt, /Say that line ONCE, add nothing after it/);
    assert.match(prompt, /END THE CALL with the end-call tool in the same turn/);
  });

  test("B — the trailing second 'bye' is banned explicitly", () => {
    // The live call said "Goodbye. Bye." before going quiet.
    assert.match(promptFor(), /no second "bye"/);
  });

  test("C — a further farewell is never answered with another goodbye", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /Once it is spoken the call is over: never answer a further farewell with another goodbye/
    );
  });

  test("D — something new before the close stops the call from ending", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /The ONLY thing that stops you ending the call is the caller raising something NEW before you close/
    );
    assert.match(prompt, /actually, before I go, I have another question/);
    assert.match(prompt, /help them with it first \(rule 5\), then close and end the call once/);
  });

  test("the close still comes last, after the recap and 'anything else?'", () => {
    // Ending the call must not become a way to skip the flow that the
    // previous fixes put in place.
    const prompt = promptFor();
    const recap = prompt.indexOf("RECAP —");
    const anythingElse = prompt.indexOf("ANYTHING ELSE —");
    const endCall = prompt.indexOf("END THE CALL with the end-call tool");
    assert.ok(recap < anythingElse, "recap before 'anything else?'");
    assert.ok(anythingElse < endCall, "the call ends only at the very end");
  });

  // 2026-08-08 live call: Remy was cut off mid-sentence twice.
  //   AI:   "Just to confirm, you mean Wednesday, 12 August at 3 PM for"
  //   User: "Yeah. Sorry. Can you say that again?"
  //   AI:   "Of course. Just"
  //   User: "Sorry?"
  // No speaking plan was sent, so the provider default applied and ANY
  // transcribed caller speech stopped the assistant — including a
  // one-word "Yeah." that was agreement, not an interruption.
  test("F — a one-word backchannel no longer cuts Remy off mid-sentence", () => {
    const plan = assistantFor().stopSpeakingPlan;
    assert.ok(plan, "a stopSpeakingPlan must be sent — the default stops on any speech");
    assert.equal(plan.numWords, 2);
  });

  test("F — the caller can still interrupt naturally", () => {
    // The point of the fix is backchannels, NOT making Remy hard to
    // interrupt. Anything above a couple of words means the caller
    // talks over Remy for longer before being heard.
    const { numWords } = assistantFor().stopSpeakingPlan;
    assert.ok(numWords > 0, "0 is the default that caused the cut-offs");
    assert.ok(numWords <= 2, "more than two words makes interrupting feel broken");
  });

  test("F — the decline assistant is deliberately left alone", () => {
    // It speaks one sentence and hangs up; there is nothing to interrupt.
    const declined = buildVapiDeclineResponse("Acme Plumbing").assistant;
    assert.equal(declined.stopSpeakingPlan, undefined);
  });

  test("E — the earlier voice fixes are untouched by this one", () => {
    const prompt = promptFor();
    // Callback vs appointment (rule 13) and urgency (rule 6) intact.
    assert.match(prompt, /13\. A callback is not an appointment/);
    assert.match(prompt, /URGENCY IS NOT A DATE OR A TIME/);
    // The confirmation flow still gates the goodbye.
    assert.match(
      prompt,
      /Never ask "anything else\?" before the caller has confirmed the recap/
    );
    // And nothing promises a booking on the way out.
    assert.match(prompt, /Never promise an appointment or a guaranteed response time/);
  });
});
