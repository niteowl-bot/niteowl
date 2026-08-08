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

import {
  normaliseCallerId,
  isSameNumber,
  normaliseSpokenNumber,
} from "@/lib/voice/callerId";
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

describe("normaliseSpokenNumber", () => {
  // A number the caller SAYS is transcribed speech. Formatting is
  // stripped; obvious non-numbers are refused rather than written to
  // the lead as something that looks dialable but is not.
  test("strips the punctuation speech-to-text puts in a spoken number", () => {
    assert.equal(normaliseSpokenNumber("086 123 4567"), "0861234567");
    assert.equal(normaliseSpokenNumber("086-123-4567"), "0861234567");
    assert.equal(normaliseSpokenNumber("(086) 123 4567"), "0861234567");
    assert.equal(normaliseSpokenNumber("086.123.4567"), "0861234567");
  });

  test("keeps the leading + that marks an international number", () => {
    assert.equal(normaliseSpokenNumber("+353 86 123 4567"), "+353861234567");
  });

  test("accepts legitimate international numbers", () => {
    assert.equal(normaliseSpokenNumber("+1 415 555 2671"), "+14155552671");
    assert.equal(normaliseSpokenNumber("+44 20 7946 0958"), "+442079460958");
    assert.equal(normaliseSpokenNumber("00353 86 123 4567"), "00353861234567");
  });

  test("refuses a number too short to dial", () => {
    assert.equal(normaliseSpokenNumber("086 12"), null);
    assert.equal(normaliseSpokenNumber("4567"), null);
  });

  test("refuses transcription that is not a number at all", () => {
    assert.equal(normaliseSpokenNumber("the office line"), null);
    assert.equal(normaliseSpokenNumber("anonymous"), null);
    assert.equal(normaliseSpokenNumber(""), null);
    assert.equal(normaliseSpokenNumber(null), null);
    assert.equal(normaliseSpokenNumber(undefined), null);
  });

  test("refuses more digits than any real number has", () => {
    // Two numbers run together, or a spoken extension tacked on.
    assert.equal(normaliseSpokenNumber("086 123 4567 01 555 1234"), null);
  });

  test("never invents digits — what comes back is what was heard", () => {
    assert.equal(normaliseSpokenNumber("0861234567"), "0861234567");
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
    assert.match(prompt, /is that the best number to reach you on/i);
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
    // Consolidated into rule 5's ordered steps — same fields, now one
    // rule instead of an order rule plus a duplicate checklist.
    const prompt = promptFor("+353861234567");
    for (const line of [
      /What the caller needs, in their own words/i,
      /The day and time they want/i,
      // Softened 2026-08-08: an ordinary name is taken as given, and
      // read back only where it may genuinely have been misheard. The
      // field is still a mandatory step, which is what this pins.
      /Their name — take an ordinary name as given/i,
      /The address where the work is needed/i,
      /The callback number/i,
    ]) {
      assert.match(prompt, line, String(line));
    }
    assert.match(prompt, /say anything that sounds like goodbye/i);
  });

  test("the call closes only after a final read-back is confirmed", () => {
    const prompt = promptFor("+353861234567");
    assert.match(prompt, /Brian, I've noted your preferred time/i);
    assert.match(prompt, /Only once they confirm/i);
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

describe("assistant prompt — the caller ID is never read aloud", () => {
  // Regression, 2026-08-03 test call: Remy recited "I see you're
  // calling from plus three five three eight seven..." back at a
  // caller who already knows their own number. It still has to HOLD
  // the number (to answer "what number have you got for me?"), so the
  // prompt keeps it exactly once, as reference, never as a script.
  test("no scripted line speaks the digits", () => {
    const prompt = promptFor("+353861234567");
    const occurrences = prompt.split("+353861234567").length - 1;
    assert.equal(occurrences, 1, "caller ID should appear once, as reference");
    assert.doesNotMatch(prompt, /calling from \+353861234567/i);
  });

  test("it is told explicitly not to say the number out loud", () => {
    const prompt = promptFor("+353861234567");
    assert.match(prompt, /NEVER say that number out loud/);
    assert.match(prompt, /do not read it out, in full or digit by digit/i);
    assert.match(prompt, /for your reference only/i);
  });

  test("the confirmation question names the number without speaking it", () => {
    const prompt = promptFor("+353861234567");
    assert.match(prompt, /I can use the number you're calling from/i);
    assert.match(prompt, /is that the best number to reach you on/i);
  });

  test("a caller who asks may still be told the number", () => {
    const prompt = promptFor("+353861234567");
    assert.match(prompt, /if the caller directly asks you which number you have/i);
  });

  test("declining sends Remy to the open question, not to the digits", () => {
    const prompt = promptFor("+353861234567");
    assert.match(prompt, /What's the best number to reach you on\?/);
  });

  test("the final read-back refers to the line, not the digits", () => {
    const prompt = promptFor("+353861234567");
    assert.match(prompt, /contact you on the number you're calling from/i);
    assert.match(prompt, /never the digits/i);
    assert.match(prompt, /read back only a DIFFERENT number they gave you aloud/i);
  });
});

describe("assistant prompt — spoken callback numbers are checked", () => {
  test("an unclear number is asked for again, never guessed", () => {
    const prompt = promptFor("+353861234567");
    assert.match(prompt, /NEVER guess or fill in the missing digits/);
    assert.match(prompt, /I may not have caught the full number/i);
    assert.match(prompt, /Could you repeat it for me\?/);
  });

  test("the same check applies when the caller ID is withheld", () => {
    const prompt = promptFor(null);
    assert.match(prompt, /NEVER guess or fill in the missing digits/);
    assert.match(prompt, /I may not have caught the full number/i);
  });

  test("a number that is heard clearly is still confirmed back", () => {
    assert.match(promptFor("+353861234567"), /Thanks, I've got 086 123 4567/);
    assert.match(promptFor(null), /Thanks, I've got your number as 086 123 4567/);
  });
});

describe("assistant prompt — mis-heard service names", () => {
  // Regression, 2026-08-03 test call: "boiler service" was transcribed
  // as "valer service" and Remy went straight to treating it as a
  // service the business does not provide.
  test("one clarifying question comes before ruling a service out", () => {
    const prompt = promptFor("+353861234567");
    assert.match(prompt, /ask ONE short clarifying question/);
    assert.match(prompt, /Sorry, did you say boiler service\?/);
    assert.match(prompt, /Ask this once only/i);
  });

  test("the booking rule defers to it before deciding a service is not listed", () => {
    const prompt = promptFor("+353861234567");
    assert.match(
      prompt,
      /make sure you actually heard it correctly first \(rule 8\)/i
    );
  });

  test("still-unsure falls back to the team, never to a guess", () => {
    const prompt = promptFor("+353861234567");
    assert.match(prompt, /I'll pass that request to the team to confirm/i);
    assert.match(
      prompt,
      /Never tell a caller a service is available because it merely sounds like one/i
    );
  });

  test("clarifying never becomes a booking on its own", () => {
    const prompt = promptFor("+353861234567");
    assert.match(prompt, /asking this question never confirms a booking/i);
  });
});
