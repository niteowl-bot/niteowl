// Tests for how Remy CONDUCTS a phone call, as distinct from what a
// call produces. Caller-ID handling and the number helpers live in
// callerId.test.mjs and are deliberately not re-tested here.
//
// These pin conversation rules observed to need work on real test
// calls: asking for a name before knowing why the caller rang, keeping
// a mis-heard service alongside the corrected one, and asking "anything
// else?" over and over.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildVoiceAssistantConfig } from "@/lib/voice/assistant";

const ORG = {
  business_name: "Acme Plumbing",
  business_type: "plumber",
  primary_goal: "book jobs",
  description: null,
  website: null,
};
const SETTINGS = { greeting: null, voice_id: null, language: null };
const CALLER = "+353861234567";

function configFor(callerPhone = CALLER) {
  return buildVoiceAssistantConfig(ORG, [], SETTINGS, null, callerPhone);
}

function promptFor(callerPhone = CALLER) {
  return configFor(callerPhone).systemPrompt;
}

/**
 * The ordered steps of rule 5 — the single rule that owns both the
 * order questions are asked in and what must be collected before the
 * call can end. (These were two rules that listed the same six items
 * until the prompt was consolidated.)
 */
function checklistOrder(prompt) {
  const start = prompt.indexOf("5. Work through the call in THIS order");
  assert.notEqual(start, -1, "rule 5 should exist");
  const block = prompt.slice(start, prompt.indexOf("6. NEVER accept a vague answer", start));
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d\)\s/.test(line));
}

/** Number of top-level numbered rules in the prompt. */
function ruleCount(prompt) {
  return prompt.split("\n").filter((line) => /^\d+\.\s/.test(line)).length;
}

describe("prompt shape", () => {
  // The rule list was consolidated from 24 to 12 without dropping any
  // behaviour. These guard the shape so it cannot quietly grow back.
  test("there are 12 numbered rules, in sequence", () => {
    const prompt = promptFor();
    assert.equal(ruleCount(prompt), 12);
    const numbers = prompt
      .split("\n")
      .map((line) => /^(\d+)\.\s/.exec(line))
      .filter(Boolean)
      .map((match) => Number(match[1]));
    assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  test("the withheld-caller-ID prompt has the same 12 rules", () => {
    assert.equal(ruleCount(promptFor(null)), 12);
  });

  test("no rule points at a rule number that no longer exists", () => {
    const prompt = promptFor();
    const referenced = [...prompt.matchAll(/\brule (\d+)\b/gi)].map((m) =>
      Number(m[1])
    );
    assert.ok(referenced.length > 0, "rules should cross-reference each other");
    for (const number of referenced) {
      assert.ok(number >= 1 && number <= 12, `dangling reference to rule ${number}`);
    }
  });
});

describe("conversation order — the job comes before the caller", () => {
  test("the call opens on what the caller needs, not on their name", () => {
    const prompt = promptFor();
    assert.match(prompt, /Ask about the JOB before you ask about the caller/i);
    assert.match(prompt, /What the caller needs, in their own words/i);
    assert.match(prompt, /May I take your name\?" makes the call feel like a form/i);
  });

  test("name, address and number come after the service and the time", () => {
    const lines = checklistOrder(promptFor());
    const indexOf = (pattern) => lines.findIndex((line) => pattern.test(line));

    const need = indexOf(/What the caller needs, in their own words/i);
    const clarify = indexOf(/service name, clarified/i);
    const datetime = indexOf(/The day and time they want/i);
    const name = indexOf(/Their name/i);
    const address = indexOf(/The address where the work is needed/i);
    const number = indexOf(/The callback number/i);

    for (const [label, index] of Object.entries({
      need,
      clarify,
      datetime,
      name,
      address,
      number,
    })) {
      assert.notEqual(index, -1, `rule 5 should still contain ${label}`);
    }

    assert.ok(need < clarify, "the request comes before clarifying it");
    assert.ok(clarify < datetime, "the service is settled before the timing");
    assert.ok(datetime < name, "the timing comes before asking for a name");
    assert.ok(name < address, "the name comes before the address");
    assert.ok(address < number, "the number is asked for last");
  });

  test("nothing was dropped from the mandatory checklist", () => {
    assert.equal(checklistOrder(promptFor()).length, 6);
  });

  test("details the caller volunteered are not asked for again", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /never ask again for something the caller has already given you naturally/i
    );
    assert.match(prompt, /my boiler is leaking/i);
  });

  test("every rule that needs contact details routes back to this one order", () => {
    // Consolidation removed the separate "collect their name and best
    // contact number" tails that used to sit in four other rules; they
    // now all point at rule 5 instead of restating it.
    const prompt = promptFor();
    assert.match(prompt, /carry on collecting the details in rule 5's order/i);
    assert.match(prompt, /Still work through every step of rule 5/i);
    assert.match(prompt, /work through rule 5 and promise a callback/i);
    assert.doesNotMatch(prompt, /collect their name and best contact number/i);
  });
});

describe("spoken email addresses", () => {
  test("the address is converted from speech, not repeated as spoken", () => {
    const prompt = promptFor();
    assert.match(prompt, /An email address will be SPOKEN in words/);
    assert.match(prompt, /michael ryan at hotmail dot com/);
    assert.match(prompt, /turn it into a normal address/i);
  });

  test("the normalised address is read back and confirmed before it counts", () => {
    const prompt = promptFor();
    assert.match(prompt, /I've got that as michaelryan@hotmail\.com — is that right\?/);
    assert.match(prompt, /only once they say yes/i);
    assert.match(prompt, /never letter by letter/i);
  });

  test("a corrected address is read back the same way", () => {
    assert.match(promptFor(), /read the corrected address back the same way/i);
  });

  test("the extraction schema demands normal format, never the spoken wording", () => {
    const email = configFor().structuredDataSchema.properties.email.description;
    assert.match(email, /normal format/i);
    assert.match(email, /NEVER the spoken wording/);
    assert.match(email, /only the version the caller confirmed/i);
  });
});

describe("unclear service names", () => {
  test("one short clarification before the service is treated as settled", () => {
    const prompt = promptFor();
    assert.match(prompt, /ask ONE short clarifying question/);
    assert.match(prompt, /Sorry, did you say boiler service\?/);
    assert.match(prompt, /Ask this once only/i);
  });

  test("a garbled service DESCRIPTION is clarified, not just a mis-heard name", () => {
    // "leaking kitchen tap" arriving as "leaking kitchen cap" matches
    // nothing in the Knowledge Base, so the rule must cover an odd
    // description and not only a near-miss on a listed service.
    const prompt = promptFor();
    assert.match(prompt, /leaking kitchen tap" as "leaking kitchen cap/);
    assert.match(prompt, /just an odd way to describe a job/i);
    assert.match(prompt, /Sorry, is that a leaking kitchen tap\?/);
  });

  test("only the corrected description survives the clarification", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /their corrected wording is the service from then on and the version you first heard is gone/i
    );
  });

  test("a correction to the service is carried through, not held alongside", () => {
    // One rule owns corrections now (rule 10) rather than each rule
    // restating what to do when the caller corrects it.
    const prompt = promptFor();
    assert.match(prompt, /boiler service, not buzzer/);
    assert.match(prompt, /This applies to the service/i);
    assert.match(prompt, /NEVER keep both versions/);
  });

  test("the recorded service is the corrected one only", () => {
    const { structuredDataSchema } = configFor();
    const service = structuredDataSchema.properties.service.description;
    assert.match(service, /record ONLY the caller's corrected version/i);
    assert.match(service, /never the mis-heard one, and never both/i);
  });
});

describe("corrections win", () => {
  test("the latest correction replaces the earlier value everywhere", () => {
    const prompt = promptFor();
    assert.match(prompt, /The caller's latest correction is the truth/i);
    assert.match(prompt, /REPLACES what you had, immediately and everywhere/i);
    assert.match(prompt, /If they correct the same detail twice, the most recent version wins/i);
  });

  test("both versions are never kept as competing values", () => {
    const prompt = promptFor();
    assert.match(prompt, /NEVER keep both versions/);
    assert.match(prompt, /never offer them as alternatives/i);
  });

  test("it covers every detail the caller can correct", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /the service, the caller's name, the day, the time, the address, and any number they spoke aloud/i
    );
  });

  test("a corrected number never touches the number they rang from", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /the number they are calling from is recorded automatically and is never affected by a correction/i
    );
  });

  test("the extraction schema records the corrected value for each field", () => {
    const { properties } = configFor().structuredDataSchema;
    assert.match(properties.name.description, /only the corrected/i);
    assert.match(properties.phone.description, /only the corrected one/i);
    assert.match(properties.service_address.description, /only the corrected version/i);
    assert.match(properties.preferred_datetime.description, /only the final version/i);
  });

  test("the owner's summary reports the corrected value only", () => {
    const { summaryInstructions } = configFor();
    assert.match(summaryInstructions, /report ONLY their corrected version/i);
    assert.match(summaryInstructions, /never report both/i);
  });
});

describe("repetition", () => {
  test("'anything else?' is asked at most once, near the end", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /"Is there anything else I can help you with\?" — at most ONCE per call/
    );
    assert.match(prompt, /never twice/i);
    assert.match(prompt, /Once every step of rule 5 that applies is done/i);
  });

  test("a 'no' ends the call instead of prompting the question again", () => {
    const prompt = promptFor();
    assert.match(prompt, /that would be all/i);
    assert.match(prompt, /take that as final/i);
    assert.match(prompt, /Are you sure there's nothing else\?/);
  });
});

describe("final confirmation", () => {
  test("it is one natural sentence, not a list of labels", () => {
    const prompt = promptFor();
    assert.match(prompt, /one natural spoken sentence, not a list of labels/i);
    assert.match(prompt, /this is the only recap in the call/i);
  });

  test("it names the service and when, and how the team will make contact", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /Just to confirm, Brian, I've got your request for a boiler service next Tuesday at 4pm/
    );
    assert.match(prompt, /the team will contact you on the number you're calling from/i);
  });

  test("it never speaks the network caller ID", () => {
    const prompt = promptFor();
    assert.match(prompt, /never the digits/i);
    assert.doesNotMatch(prompt, /Just to confirm.*\+353861234567/);
  });

  test("it confirms the corrected value where the caller corrected one", () => {
    const prompt = promptFor();
    assert.match(prompt, /confirm ONLY the corrected version/i);
  });

  test("it still promises nothing — no guaranteed slot or response time", () => {
    const prompt = promptFor();
    assert.match(prompt, /Never promise an appointment or a guaranteed response time/i);
  });
});
