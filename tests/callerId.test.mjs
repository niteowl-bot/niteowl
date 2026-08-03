// Regression tests for voice caller-ID handling.
//
// The original bug: a number the caller SPOKE during the call replaced
// the network caller ID on the lead and in the summary email, because
// the lead's phone was resolved as `details.phone ?? callerPhone`. A
// mis-transcribed or simply different spoken number therefore produced
// a lead nobody could ring back.
//
// These pin the two pure helpers the fix rests on: a withheld number
// must never look like a real one, and a caller reading their own
// number aloud must not be filed as an "alternate".

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { normaliseCallerId, isSameNumber } from "@/lib/voice/callerId";
import { parseVapiWebhook, buildVapiAssistantResponse } from "@/lib/voice/vapi";
import { buildVoiceAssistantConfig } from "@/lib/voice/assistant";

const ORG = {
  business_name: "Acme Plumbing",
  business_type: "plumber",
  primary_goal: "book jobs",
  description: null,
  website: null,
};
const SETTINGS = { greeting: null, voice_id: null, language: null };

function promptFor(callerPhone) {
  return buildVoiceAssistantConfig(ORG, [], SETTINGS, null, callerPhone)
    .systemPrompt;
}

const CALL_ID = "11111111-2222-3333-4444-555555555555";

function endOfCallReport(customerNumber) {
  return {
    message: {
      type: "end-of-call-report",
      call: { id: CALL_ID, type: "inboundPhoneCall" },
      phoneNumber: { number: "+35315550000" },
      customer: { number: customerNumber },
      analysis: { summary: "Caller asked about a boiler service." },
    },
  };
}

describe("normaliseCallerId", () => {
  test("keeps a real E.164 caller ID unchanged", () => {
    assert.equal(normaliseCallerId("+353861234567"), "+353861234567");
  });

  test("trims surrounding whitespace", () => {
    assert.equal(normaliseCallerId("  +353861234567 "), "+353861234567");
  });

  test("rejects withheld-number placeholders", () => {
    for (const blocked of [
      "anonymous",
      "Anonymous",
      "UNKNOWN",
      "restricted",
      "Private",
      "blocked",
      "unavailable",
    ]) {
      assert.equal(normaliseCallerId(blocked), null, blocked);
    }
  });

  test("rejects the keypad spellings carriers send for withheld numbers", () => {
    assert.equal(normaliseCallerId("+266696687"), null); // ANONYMOUS
    assert.equal(normaliseCallerId("+2568378"), null); // BLOCKED
  });

  test("rejects empty, missing and too-short values", () => {
    assert.equal(normaliseCallerId(null), null);
    assert.equal(normaliseCallerId(undefined), null);
    assert.equal(normaliseCallerId(""), null);
    assert.equal(normaliseCallerId("   "), null);
    assert.equal(normaliseCallerId("+353"), null);
  });
});

describe("isSameNumber", () => {
  test("matches E.164 against the national form the caller speaks", () => {
    assert.equal(isSameNumber("086 123 4567", "+353861234567"), true);
    assert.equal(isSameNumber("0861234567", "+353861234567"), true);
  });

  test("ignores punctuation and spacing", () => {
    assert.equal(isSameNumber("(086) 123-4567", "+353 86 123 4567"), true);
  });

  test("separates a genuinely different line", () => {
    assert.equal(isSameNumber("+353871119999", "+353861234567"), false);
  });

  test("never matches on missing or too-short input", () => {
    assert.equal(isSameNumber(null, "+353861234567"), false);
    assert.equal(isSameNumber("+353861234567", undefined), false);
    assert.equal(isSameNumber("1234", "1234"), false);
  });
});

describe("parseVapiWebhook caller ID", () => {
  test("carries a real caller ID through to the internal event", () => {
    const event = parseVapiWebhook(endOfCallReport("+353861234567"));
    assert.equal(event.kind, "call-ended");
    assert.equal(event.callerPhone, "+353861234567");
    assert.equal(event.businessPhone, "+35315550000");
  });

  test("normalises a withheld caller ID to null", () => {
    const event = parseVapiWebhook(endOfCallReport("anonymous"));
    assert.equal(event.kind, "call-ended");
    assert.equal(event.callerPhone, null);
  });
});

describe("vapi summaryPlan rendering", () => {
  function summaryPlan() {
    const config = buildVoiceAssistantConfig(
      ORG,
      [],
      SETTINGS,
      null,
      "+353861234567"
    );
    return buildVapiAssistantResponse(config).assistant.analysisPlan.summaryPlan;
  }

  test("sends the custom instructions as the system message", () => {
    const plan = summaryPlan();
    assert.equal(plan.enabled, true);
    assert.equal(plan.messages[0].role, "system");
    assert.match(plan.messages[0].content, /precise note-taker/i);
  });

  test("passes the transcript through Vapi's template variable", () => {
    const plan = summaryPlan();
    assert.equal(plan.messages[1].role, "user");
    assert.match(plan.messages[1].content, /\{\{transcript\}\}/);
    assert.match(plan.messages[1].content, /\{\{endedReason\}\}/);
  });

  test("keeps the raised analysis timeout", () => {
    assert.equal(summaryPlan().timeoutSeconds, 30);
  });
});

describe("assistant prompt — when Remy asks for a number", () => {
  // Remy CONFIRMS the caller ID rather than asking for a number from
  // scratch: the lead must carry a number the caller can be reached on,
  // but a yes/no confirmation speaks no digits, so the mis-transcription
  // this file's fix was written for still cannot reach the lead.
  test("with caller ID it confirms that number instead of asking for one", () => {
    const prompt = promptFor("+353861234567");
    assert.match(prompt, /\+353861234567/);
    assert.match(prompt, /never ask them to recite a number from scratch/i);
    assert.match(prompt, /is this the best number to reach you on/i);
  });

  test("a different spoken number stays an additional contact, not a replacement", () => {
    const prompt = promptFor("+353861234567");
    assert.match(prompt, /saved as an additional contact number/i);
  });

  test("with a withheld number it is told to ask", () => {
    const prompt = promptFor(null);
    assert.match(prompt, /withheld or unavailable/i);
    assert.match(prompt, /ask for the best number to reach them on/i);
  });

  // Regression: an urgent ceiling-leak call ended after Remy accepted
  // "tomorrow" as a callback time — no exact time, no number confirmed,
  // no address. The prompt must forbid closing on an incomplete lead.
  test("vague callback answers must be followed up", () => {
    const prompt = promptFor("+353861234567");
    assert.match(prompt, /NEVER accept a vague answer/i);
    assert.match(prompt, /What time tomorrow would suit you best/i);
  });

  test("the pre-close checklist covers every mandatory field", () => {
    const prompt = promptFor("+353861234567");
    for (const line of [
      /the caller's name/i,
      /the best callback number/i,
      /the callback DAY/,
      /the exact callback TIME/,
      /the service address/i,
    ]) {
      assert.match(prompt, line, String(line));
    }
    assert.match(prompt, /before you say anything that sounds like goodbye/i);
  });

  test("the call closes only after a final read-back is confirmed", () => {
    const prompt = promptFor("+353861234567");
    assert.match(prompt, /Just to confirm, I have Brian/i);
    assert.match(prompt, /Only after they confirm/i);
    assert.match(prompt, /never state a time they did not say/i);
  });

  test("the summary is grounded in the transcript and marks gaps", () => {
    const { summaryInstructions } = buildVoiceAssistantConfig(
      ORG,
      [],
      SETTINGS,
      null,
      "+353861234567"
    );
    assert.match(summaryInstructions, /Use ONLY what was actually said/i);
    assert.match(summaryInstructions, /write exactly "Not provided"/i);
    assert.match(summaryInstructions, /never turn it into a specific date or clock time/i);
    // Provider template syntax belongs to the adapter, not here.
    assert.doesNotMatch(summaryInstructions, /\{\{/);
  });

  test("the extraction schema carries the service address", () => {
    const config = buildVoiceAssistantConfig(
      ORG,
      [],
      SETTINGS,
      null,
      "+353861234567"
    );
    assert.ok(config.structuredDataSchema.properties.service_address);
  });

  test("the caller's number is never leaked into the greeting", () => {
    const config = buildVoiceAssistantConfig(
      ORG,
      [],
      SETTINGS,
      null,
      "+353861234567"
    );
    assert.doesNotMatch(config.firstMessage, /\+353861234567/);
  });
});
