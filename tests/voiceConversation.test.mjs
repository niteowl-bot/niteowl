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

// Monday 3 August 2026 — so "Thursday" that week is 6 August, the date
// from the production call this behaviour came out of.
const MONDAY_3_AUG_2026 = new Date("2026-08-03T09:00:00+01:00");

function configFor(callerPhone = CALLER, now = MONDAY_3_AUG_2026) {
  return buildVoiceAssistantConfig(ORG, [], SETTINGS, null, callerPhone, now);
}

function promptFor(callerPhone = CALLER, now = MONDAY_3_AUG_2026) {
  return configFor(callerPhone, now).systemPrompt;
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
  // Rule 13 (callback vs appointment) was added afterwards, for the
  // 2026-08-06 call — see the describe block at the bottom of the file.
  test("there are 13 numbered rules, in sequence", () => {
    const prompt = promptFor();
    assert.equal(ruleCount(prompt), 13);
    const numbers = prompt
      .split("\n")
      .map((line) => /^(\d+)\.\s/.exec(line))
      .filter(Boolean)
      .map((match) => Number(match[1]));
    assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  test("the withheld-caller-ID prompt has the same 13 rules", () => {
    assert.equal(ruleCount(promptFor(null)), 13);
  });

  test("no rule points at a rule number that no longer exists", () => {
    const prompt = promptFor();
    const referenced = [...prompt.matchAll(/\brule (\d+)\b/gi)].map((m) =>
      Number(m[1])
    );
    assert.ok(referenced.length > 0, "rules should cross-reference each other");
    for (const number of referenced) {
      assert.ok(number >= 1 && number <= 13, `dangling reference to rule ${number}`);
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
    // 7 since email became a required step of its own — it used to be a
    // sub-clause of the name step, which is how a call reached
    // "anything else?" without one.
    // 8 since the calendar check became step 4: it used to live only in
    // rule 9's tail, so the model worked through this whole list first
    // and checked availability last. Nothing was removed to make room.
    assert.equal(checklistOrder(promptFor()).length, 8);
  });

  // From the test call: the caller asked for "next Wednesday at 3 PM"
  // and was taken through service, name, email, address and callback
  // number BEFORE anything looked at the calendar — so a slot that was
  // never free cost the caller the whole interrogation. Rule 9 always
  // said to call the tool "once you hold an appointment DATE and CLOCK
  // TIME", but rule 5 is the rule that owns the ORDER and it never
  // mentioned the check at all.
  test("availability is checked before any customer detail is collected", () => {
    const lines = checklistOrder(promptFor());
    const indexOf = (pattern) => lines.findIndex((line) => pattern.test(line));

    const datetime = indexOf(/The day and time they want/i);
    const check = indexOf(/THE CALENDAR CHECK/);
    const name = indexOf(/Their name/);
    const email = indexOf(/Their email/);
    const address = indexOf(/The address where the work is needed/);
    const number = indexOf(/The callback number/);

    assert.notEqual(check, -1, "rule 5 should carry the calendar check as a step");
    assert.ok(datetime < check, "the date and time are settled before the check");
    for (const [label, index] of Object.entries({ name, email, address, number })) {
      assert.ok(check < index, `the calendar check comes before ${label}`);
    }
  });

  test("the check is named as the reason not to collect details first", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /name, email, address and number make no difference to whether a slot is free/i
    );
    assert.match(prompt, /NEVER collect them first to find out/);
    // Rule 9 still owns what the tool means; rule 5 now owns when.
    assert.match(prompt, /Call it THEN, at step 4 of rule 5, not at the end of the call/);
    // A callback must not start burning calendar lookups.
    assert.match(prompt, /A callback skips this step entirely \(rule 13\)/);
  });

  // Also from the test call: Remy confirmed the date, then the email,
  // then the address, each as its own extra turn, and then read all
  // three back again in the closing recap.
  test("high-confidence details are acknowledged, not re-confirmed", () => {
    const prompt = promptFor();
    assert.match(prompt, /CONFIRM ONCE, NOT TWICE/);
    assert.match(
      prompt,
      /NEVER ask "is that correct\?", "did I get that right\?" or "I've noted X — is that right\?" about something you are already confident of/
    );
    assert.match(prompt, /never re-ask a detail the caller has already confirmed once/);
    // A clearly-heard address gets an acknowledgement and nothing more.
    assert.match(
      prompt,
      /do NOT read the whole address back or ask whether it is correct \(rule 2\); the rule 11 recap covers it/
    );
    // The one final check survives, and is explicitly the only repeat.
    assert.match(prompt, /it is one check at the end, not a re-reading of the whole call/);
  });

  // 2026-08-08 live call. The caller said "17 Elm Drive"; Deepgram
  // transcribed "17 Ellen Drive", and Remy faithfully read back what it
  // had been given — but in the SAME turn as the next question:
  //   AI: "I have noted the address as 1 7 Ellen Drive. I can use the
  //        number you're calling from. Is that the best number...?"
  //   User: "Yeah. Yeah."
  // The yes confirmed the number. The wrong address was stored silently.
  // Remy cannot see the transcriber's confidence, so the guard is the
  // same one rule 8 already uses for services: name what you think you
  // heard, once, and nothing else in that turn.
  test("an uncertain street name is clarified once, on its own", () => {
    const prompt = promptFor();
    assert.match(prompt, /A street name is the detail speech-to-text gets wrong most often/);
    assert.match(
      prompt,
      /ask ONCE, naming only the part you are unsure of and nothing else in that turn: "Sorry, was that Birch Drive\?"/
    );
    // The correction path is untouched — still read back WHOLE.
    assert.match(
      prompt,
      /change only the wrong part and say the WHOLE corrected address back once — never a part-corrected one/
    );
  });

  // 2026-08-08 live call. The caller corrected one field during the
  // final recap and got the entire recap again:
  //   User: "No. It Elm. My address is Elm Drive, e l m, Elm."
  //   AI:   "Thank you for correcting that. I've updated the address to
  //          21 Elm Drive. Just to confirm, Jimmy, I've noted your
  //          preferred time as Thursday, 13 August at 9 AM for the
  //          radiator repair. At 21 Elm Drive. I have your email as..."
  // Rule 11's CONFIRMATION clause literally said "recap once more and
  // ask again", so Remy was following instructions.
  test("a correction during the recap confirms only the corrected field", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /read back ONLY what they corrected and then ASK about the rest: "Got it — 15 Oak Drive\. Is everything else correct\?"/
    );
    // "everything else", not "everything I've summarised" — the rest is
    // already agreed, and re-asking the wider question invited the full
    // re-read this fix exists to stop.
    assert.match(prompt, /Say "everything else", not "everything I've summarised"/);
  });

  // 2026-08-08 fourth live call. Remy STATED the check instead of asking
  // it, so the caller was told what to think rather than confirming:
  //   AI: "Got it. 21 Elm Drive. And the number as 052121456.
  //        Everything else is correct."
  // The scripted phrase was a bare declarative with a question mark, and
  // the flat reading is what came out.
  test("the post-correction check is asked, never stated", () => {
    const prompt = promptFor();
    assert.match(prompt, /Is everything else correct\?/);
    assert.match(
      prompt,
      /Ask it as a real question and WAIT — "Is everything else correct\?", never the flat statement "Everything else is correct\."/
    );
    assert.match(prompt, /leaves the rest unconfirmed/);
  });

  // Same call: the caller corrected the address AND the number in one
  // breath. Both were updated and read back, which is right — but the
  // instruction said "confirm ONLY that one field", singular.
  test("two corrections in one breath are both read back, in one turn", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /If they corrected TWO OR MORE things in one breath, update them all and read back each corrected value once, still in a single turn/
    );
    assert.match(
      prompt,
      /"Got it — 15 Oak Drive, and the number as 086 123 4567\. Is everything else correct\?"/
    );
    // Still no full re-read.
    assert.match(prompt, /Do NOT repeat the recap, and do not restate a single unchanged detail/);
  });

  // Same call: a corrected email was read back and then folded straight
  // into "Everything else is correct?" — so the caller's "yes" was about
  // the other details, and a wrong email went a further round trip.
  test("every version of an email needs its own yes", () => {
    const prompt = promptFor();
    assert.match(prompt, /EVERY VERSION NEEDS ITS OWN YES/);
    assert.match(
      prompt,
      /read it back and ask "is that right\?" about the EMAIL ITSELF, and wait, however many times they change it/
    );
    // Including when the correction lands during the closing recap.
    assert.match(
      prompt,
      /there, confirm the new email first, and only once they say yes ask whether everything else is correct/
    );
    assert.match(
      prompt,
      /Folding an unconfirmed email into "is everything else correct\?" is how a wrong address gets recorded/
    );
    // A replaced version never comes back.
    assert.match(
      prompt,
      /never keep, repeat or fall back to a version they have replaced/
    );
  });

  // Same call: two restatements before the calendar was ever consulted —
  //   "I'll note your request for a radiator repair next Wednesday at
  //    3 PM. Just to confirm, you mean Wednesday, 12 August at 3 PM."
  test("the request is confirmed once, then checked immediately", () => {
    const prompt = promptFor();
    assert.match(prompt, /CONFIRM THE TIME ONCE, THEN CHECK/);
    assert.match(
      prompt,
      /never precede it with "I'll note your request for…" and never follow it with a second version of the same thing/
    );
    assert.match(prompt, /One sentence, then the tool/);
    // And a chosen alternative is not restated back either.
    assert.match(
      prompt,
      /do not restate it back to them either; the rule 11 recap is where they hear it again/
    );
    assert.match(prompt, /Do NOT repeat the recap, and do not restate a single unchanged detail/);
    // One genuine reason to re-recap survives: the appointment itself.
    assert.match(
      prompt,
      /ONLY when what changed was the appointment itself — the date, the time or the service/
    );
  });

  test("acknowledgements are cut at the source, not swapped for synonyms", () => {
    const prompt = promptFor();
    assert.match(prompt, /SAY LESS/);
    assert.match(prompt, /Most answers need no acknowledgement at all/);
    assert.match(prompt, /Never open two turns in a row with thanks/);
    // The objective is less speech, not a bigger phrase book.
    assert.match(
      prompt,
      /The goal is FEWER WORDS, not a wider set of openers — do not swap one stock phrase for another/
    );
    // The scripted thank-yous the live call echoed are gone from the
    // examples the model copies.
    assert.doesNotMatch(prompt, /Thank you for correcting that/);
    assert.doesNotMatch(prompt, /Thanks, I've got that as/);
    assert.doesNotMatch(prompt, /take with a brief "Thanks\."/);
  });

  test("the email read-back survives — it is the one that must not be dropped", () => {
    const prompt = promptFor();
    assert.match(prompt, /I've got that as michaelryan@hotmail\.com — is that right\?/);
    assert.match(prompt, /This one read-back always happens/);
    // But a corrected email confirms the email and nothing else.
    assert.match(
      prompt,
      /read the corrected address back the same way and NOTHING else — never restate their name, time or anything already settled/
    );
  });

  test("a read-back is never merged with the next question", () => {
    const prompt = promptFor();
    assert.match(prompt, /A READ-BACK IS A WHOLE TURN/);
    assert.match(
      prompt,
      /the caller answers the LAST thing you said, so a "yes" there confirms the number and silently lets a wrong address through/
    );
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

describe("appointment date and time", () => {
  // From the 2026-08 production call: the caller said "Thursday at 2 PM",
  // Remy accepted it, and 06/08/2026 14:00 was stored without the caller
  // ever hearing a date. The prompt carried no date at all, so Remy had
  // nothing to resolve "Thursday" against.
  test("Remy is told today's date, so a weekday can become a calendar date", () => {
    assert.match(promptFor(), /Today is Monday, 3 August 2026\./);
    assert.match(promptFor(), /work out the calendar date behind any day the caller names/i);
  });

  test("the date moves with the clock", () => {
    assert.match(
      promptFor(CALLER, new Date("2026-12-25T09:00:00Z")),
      /Today is Friday, 25 December 2026\./
    );
  });

  test("a named weekday is resolved and confirmed before it counts", () => {
    const prompt = promptFor();
    assert.match(prompt, /work out the calendar date from today's date above and CONFIRM it/);
    assert.match(
      prompt,
      /Just to confirm, you mean Thursday, 6 August at 2pm\?/
    );
    assert.match(prompt, /only once they agree/i);
  });

  test("a time with no day gets a day question", () => {
    const prompt = promptFor();
    assert.match(prompt, /They gave only a TIME \("2pm"\): ask which day/);
    assert.match(prompt, /Which day would suit you best\?/);
  });

  test("a day with no time gets a time question", () => {
    const prompt = promptFor();
    assert.match(prompt, /They gave only a DAY \("Thursday"\): ask for the time/);
    assert.match(prompt, /What time on Thursday would suit you\?/);
  });

  test("an explicit date is not asked for a second time", () => {
    const prompt = promptFor();
    assert.match(prompt, /They gave an explicit DATE and time \("6 August at 2pm"\)/);
    assert.match(prompt, /Do NOT ask for the date again/);
  });

  test("an ambiguous relative date is asked about, never guessed", () => {
    const prompt = promptFor();
    assert.match(prompt, /NEVER guess a calendar date/);
    assert.match(prompt, /never say a date you have not had confirmed/i);
    assert.match(prompt, /could mean either of two weeks/i);
    assert.match(prompt, /ask plainly which date they mean rather than picking one/i);
  });

  test("vague answers are still refused", () => {
    // Unchanged behaviour — the rule absorbed this, it did not replace it.
    const prompt = promptFor();
    assert.match(prompt, /NEVER accept a vague answer about when/);
    assert.match(prompt, /What time tomorrow would suit you best\?/);
  });
});

describe("the real call: 'Thursday at 2 PM' must not pass unconfirmed", () => {
  // Reproduces the production sequence that failed:
  //   Caller: "Thursday at 2 PM."
  //   Remy:   "Thank you. May I have your name, please?"   <- wrong
  // Remy moved straight to the name without ever saying a calendar
  // date, and closed with "this Thursday at 2 PM".
  //
  // NOTE ON WHAT THIS CAN PROVE: these assert the INSTRUCTION is in the
  // prompt. They cannot prove the model obeys it — and in the failing
  // call the instruction was not in the deployed prompt at all, because
  // the change was never committed. A passing test here means the
  // wording is present in the built prompt, nothing more.
  test("the ordered steps gate step 4 behind a confirmed date", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /say the calendar date back and get their agreement BEFORE step 4/
    );
    assert.match(prompt, /never carry an unconfirmed date into the call/);
  });

  test("the gate sits on the date step, ahead of the name step", () => {
    const lines = checklistOrder(promptFor());
    const dateStep = lines.findIndex((l) => /BEFORE step 4/.test(l));
    const nameStep = lines.findIndex((l) => /Their name/.test(l));
    assert.notEqual(dateStep, -1, "the date step should carry the gate");
    assert.ok(dateStep < nameStep, "the date must be confirmed before the name");
  });

  test("a bare weekday is never the final word on the date", () => {
    const prompt = promptFor();
    // "this Thursday at 2 PM" — what the failing call actually closed with.
    assert.match(prompt, /the weekday AND the calendar date — never a bare weekday/);
    assert.match(prompt, /Just to confirm, you mean Thursday, 6 August at 2pm\?/);
  });

  test("the owner's summary reports the settled calendar date", () => {
    // The email said "Callback date: Thursday". The summary is generated
    // from the transcript, so it can only be as good as what Remy said —
    // but where a date WAS settled, it must not be reduced to a weekday.
    const { summaryInstructions } = configFor();
    assert.match(summaryInstructions, /Callback date: if the transcript settled on a calendar date/);
    assert.match(summaryInstructions, /write that full date, not the bare weekday/);
    assert.match(summaryInstructions, /never work out a date yourself/);
  });

  test("the summary still refuses to invent a date that was never said", () => {
    const { summaryInstructions } = configFor();
    assert.match(
      summaryInstructions,
      /If a bare weekday or a vague phrase was all that was ever said, write exactly that/
    );
    assert.match(summaryInstructions, /Use ONLY what was actually said/i);
  });
});

describe("the real call: boiler service closed without an address", () => {
  // Production sequence that failed:
  //   "boiler service" -> "Thursday at 2 PM" -> date confirmed -> name
  //   -> email -> "Is there anything else I can help you with?"
  // No service address was ever requested; the caller had to interrupt
  // with "What about my address?". Remy also said the team would ring
  // "on the number you're calling from" without ever asking whether
  // that was the best number.
  //
  // Two wordings let that happen: email was a sub-clause of the name
  // step rather than a required field, and the address and number steps
  // carried "only when..." conditionals the model could judge its way
  // out of. Both are now unconditional entries in a named gate.
  test("the gate names every required field, email and address included", () => {
    const prompt = promptFor();
    assert.match(prompt, /COMPLETION GATE/);
    assert.match(
      prompt,
      /check you hold each of: service, calendar date, time, name, email, confirmed callback number, and the address whenever the job happens at their premises/
    );
  });

  test("the gate blocks 'anything else?', the recap AND the goodbye", () => {
    const prompt = promptFor();
    assert.match(prompt, /before you may ask "anything else\?"/);
    assert.match(prompt, /give the rule 11 recap/);
    assert.match(prompt, /say anything that sounds like goodbye/);
    assert.match(prompt, /Ask for anything missing NOW, one at a time/);
  });

  test("an on-site job always needs an address — boiler work named explicitly", () => {
    // The old wording was "ONLY for jobs at the caller's premises
    // (plumbing, electrical, heating...)", which left the model to
    // decide whether a boiler service qualified. It now says EVERY, and
    // names boiler work first.
    const prompt = promptFor();
    assert.match(prompt, /EVERY job at the caller's premises: boiler and heating work/);
    assert.doesNotMatch(prompt, /skip it entirely otherwise/);
  });

  test("email is its own required step, not an aside on the name step", () => {
    const lines = checklistOrder(promptFor());
    const nameStep = lines.findIndex((l) => /Their name/.test(l));
    const emailStep = lines.findIndex((l) => /Their email/.test(l));
    const addressStep = lines.findIndex((l) => /The address where the work is needed/.test(l));
    const numberStep = lines.findIndex((l) => /The callback number/.test(l));

    for (const [label, i] of Object.entries({ nameStep, emailStep, addressStep, numberStep })) {
      assert.notEqual(i, -1, `${label} should be its own step`);
    }
    assert.ok(nameStep < emailStep, "name then email");
    assert.ok(emailStep < addressStep, "email then address");
    assert.ok(addressStep < numberStep, "address then number");
  });

  test("caller ID must still be verified out loud, not assumed", () => {
    const prompt = promptFor();
    assert.match(prompt, /Caller ID does not excuse you: you must still ASK the rule 7 question and get a yes/);
    assert.match(prompt, /Assuming the number is fine is not confirming it/);
    // Rule 7 still owns the wording, and still speaks no digits.
    assert.match(prompt, /I can use the number you're calling from\. Is that the best number to reach you on\?/);
  });

  test("a withheld caller ID still means asking for a number", () => {
    const prompt = promptFor(null);
    assert.match(prompt, /withheld or unavailable/i);
    assert.match(prompt, /ask for the best number to reach them on/i);
    assert.match(prompt, /COMPLETION GATE/);
  });

  test("the recap carries every collected field", () => {
    const prompt = promptFor();
    assert.match(prompt, /Just to confirm, Brian, I've noted your preferred time as Tuesday, 11 August at 4pm for the boiler service/);
    assert.match(prompt, /the weekday AND the calendar date — never a bare weekday/);
  });

  test("the date-confirmation behaviour that now works is untouched", () => {
    // Guard: this hardening must not weaken the fix verified on the
    // last live call.
    const prompt = promptFor();
    assert.match(prompt, /Today is Monday, 3 August 2026\./);
    assert.match(prompt, /Just to confirm, you mean Thursday, 6 August at 2pm\?/);
    assert.match(prompt, /say the calendar date back and get their agreement BEFORE step 4/);
  });
});

describe("a requested time is not a booking", () => {
  test("the time taken on the call is described as requested or preferred", () => {
    const prompt = promptFor();
    assert.match(prompt, /the caller's REQUESTED or PREFERRED time, not an appointment/);
    assert.match(
      prompt,
      /I've noted your preferred time as Thursday, 6 August at 2pm\. The team will contact you to confirm the appointment\./
    );
  });

  test("confirmed-booking wording is banned while on the call", () => {
    const prompt = promptFor();
    assert.match(prompt, /NEVER tell a caller their appointment is confirmed or booked/);
    assert.match(prompt, /booked in/);
    assert.match(prompt, /see them/);
    assert.match(prompt, /never promise the slot is guaranteed/i);
  });

  test("but a genuinely confirmed booking may still be called confirmed", () => {
    // The ban is conditional, not absolute — it turns on whether the
    // business has actually confirmed, not on the words themselves.
    const prompt = promptFor();
    assert.match(
      prompt,
      /Booked or confirmed wording is only ever correct once the business has actually confirmed the appointment/
    );
    // The listed-service path still promises a confirmation to follow.
    assert.match(prompt, /They'll confirm your appointment shortly/);
  });

  test("the final recap gives the calendar date, not a bare weekday", () => {
    const prompt = promptFor();
    assert.match(prompt, /the weekday AND the calendar date — never a bare weekday/);
  });
});

describe("spoken email addresses", () => {
  test("the address is converted from speech, not repeated as spoken", () => {
    const prompt = promptFor();
    assert.match(prompt, /Their email — ask .* It will be SPOKEN in words/);
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

  // 2026-08-08: the caller booked a service visit for a broken radiator
  // and the owner's email read "Callback date: Thursday, 13 August.
  // Callback time: 9 AM." The lead row was right (metadata carried
  // appointment_request: true) — only the summary was wrong, because
  // the six labels were hardcoded to callback wording regardless of
  // what the caller actually asked for.
  test("an appointment is labelled an appointment, not a callback", () => {
    const { summaryInstructions } = configFor();
    assert.match(summaryInstructions, /LABEL THE DATE AND TIME FOR WHAT THEY ACTUALLY ARE/);
    assert.match(
      summaryInstructions,
      /the labels are "Appointment date" and "Appointment time"/
    );
    assert.match(
      summaryInstructions,
      /If they were asking to be RUNG BACK, the labels are "Callback date" and "Callback time"/
    );
    assert.match(summaryInstructions, /never label an appointment as a callback/);
    // Decided from the caller's request, not from Remy's phrasing.
    assert.match(
      summaryInstructions,
      /never from which words the receptionist happened to use/
    );
    // The contact-number label is intentionally unchanged.
    assert.match(summaryInstructions, /"Callback number" keeps its name either way/);
  });

  // 2026-08-08 third live call: the owner summary read "Callback number:
  // Not provided" while the email's own Caller ID row directly above it
  // showed the real number, and the lead stored it. The summarising model
  // only sees the transcript, and rule 7 forbids Remy from ever reading
  // the digits aloud — so no number appears there and "Not provided" was
  // the honest-looking wrong answer. An earlier call rendered the same
  // situation as "Number calling from", which is the convention.
  test("a known caller ID is never summarised as 'Not provided'", () => {
    const { summaryInstructions } = configFor();
    assert.match(
      summaryInstructions,
      /NEVER missing merely because no digits appear in the transcript/
    );
    assert.match(
      summaryInstructions,
      /If the caller agreed to be reached on the number they are calling from, write exactly "Number calling from"/
    );
    // A genuinely different spoken number still wins.
    assert.match(
      summaryInstructions,
      /If they gave a DIFFERENT number aloud, write that number as they gave it/
    );
    // "Not provided" survives for the one case that earns it.
    assert.match(
      summaryInstructions,
      /Write "Not provided" ONLY if the caller explicitly refused to give a number AND declined the one they were calling from/
    );
    // The general "Not provided" rule for the other labels stands.
    // Seven since Email joined the list (2026-08-08) — see below.
    assert.match(summaryInstructions, /Include all seven labels every time/);
    assert.match(
      summaryInstructions,
      /apply exactly the same way when the labels are "Appointment date" and "Appointment time"/
    );
  });

  // 2026-08-08 fourth live call: the caller gave an email, corrected it
  // twice, and the final value was stored correctly on the lead
  // (jason123@gmail.com) — but the owner's summary listed Name, Callback
  // number, date, time, Address and Issue and NO email at all. Nothing in
  // the code or its history treats that omission as deliberate: the
  // structured schema extracts email, the lead stores it, and the summary
  // simply never had a label for it.
  test("the owner summary carries the caller's final email", () => {
    const { summaryInstructions } = configFor();
    assert.match(
      summaryInstructions,
      /give these seven details in this order, each written as "Label: value" and separated by full stops: Name, Email, Callback number, the date, the time, Address, Issue/
    );
    // Written form, not the spoken wording the transcript contains.
    assert.match(
      summaryInstructions,
      /write the address in normal written form \(michaelryan@hotmail\.com\), NEVER the spoken wording/
    );
    // Only the final confirmed version — this call had three.
    assert.match(
      summaryInstructions,
      /If the caller changed it during the call, give ONLY the final version they confirmed — never an earlier one, and never both/
    );
  });
});

describe("repetition", () => {
  test("'anything else?' is asked at most once per call, right after the recap", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /immediately after they confirm, ask: "Is there anything else I can help you with today\?"/
    );
    assert.match(prompt, /Ask it ONCE per call/);
    assert.match(prompt, /never twice/i);
    assert.match(prompt, /never again after they have said no/i);
    assert.match(prompt, /Once every step of rule 5 that applies is done/i);
  });

  test("the yes-path ends at the goodbye, not at a second 'anything else?'", () => {
    // A "yes" still loops through rule 5 and a fresh recap, but the
    // question itself is never re-asked — that is what made the live
    // call ask it twice.
    const prompt = promptFor();
    assert.match(
      prompt,
      /go straight to the goodbye once they confirm — do not ask "anything else\?" a second time/
    );
  });

  test("a 'no' ends the call instead of prompting the question again", () => {
    const prompt = promptFor();
    assert.match(prompt, /that would be all/i);
    assert.match(prompt, /take that as final/i);
    assert.match(prompt, /Are you sure there's nothing else\?/);
  });
});

describe("spoken polish", () => {
  // Small wording fixes from the 2026-08-04 live call. Each pins a
  // phrase Remy got wrong out loud; none of them changes the flow.
  test("the business name is said exactly as configured", () => {
    // Heard as "Night Owl Test" for an org stored as "NiteOwl Test".
    const prompt = promptFor();
    assert.match(
      prompt,
      /Say that business name exactly as written, never re-spelled or split into different words/
    );
    // Whatever the org is called, the prompt carries that name verbatim.
    assert.match(prompt, /the AI receptionist for Acme Plumbing/);
  });

  test("the email is asked for in plain English", () => {
    // Heard as "I have your email address please?" — the opening words
    // were missing, which rule 1 already forbids.
    const prompt = promptFor();
    assert.match(prompt, /ask "May I have your email address, please\?"/);
  });

  test("a corrected address is never read back half-corrected", () => {
    // Heard as "15 O Drive" then "15 Ork Drive" on the way to "15 Oak Drive".
    const prompt = promptFor();
    assert.match(
      prompt,
      /change only the wrong part and say the WHOLE corrected address back once — never a part-corrected one/
    );
    assert.match(
      prompt,
      // The "Thank you for correcting that." preamble was dropped
      // 2026-08-08 — it was one of the stock openers the live call
      // repeated. The whole-address read-back it introduced is intact.
      /never the version you first heard again: "Got it — 15 Oak Drive\."/
    );
  });

  test("no word is repeated, and the follow-up line is scripted", () => {
    // Heard as "And and someone will contact you...".
    const prompt = promptFor();
    assert.match(prompt, /never repeat a word \("And and\.\.\."\)/);
    assert.match(prompt, /Someone will contact you as soon as possible\./);
  });
});

describe("final confirmation", () => {
  test("it is spoken naturally, not read out as a list of labels", () => {
    const prompt = promptFor();
    assert.match(prompt, /as natural spoken sentences, not a list of labels/i);
    assert.match(prompt, /give ONE complete recap of everything you have collected/i);
  });

  // The recap used to come AFTER "anything else?", so the caller heard
  // "is there anything else?" before they had heard back a single detail
  // they had given. A receptionist reads the details back, gets a yes,
  // and only then asks whether there is anything more.
  test("the recap and its confirmation come before 'anything else?'", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /recap, then their confirmation of it, then "anything else\?", then goodbye/
    );
    assert.match(
      prompt,
      /Never ask "anything else\?" before the caller has confirmed the recap/
    );

    const recap = prompt.indexOf("RECAP —");
    const confirmation = prompt.indexOf("CONFIRMATION —");
    const anythingElse = prompt.indexOf("ANYTHING ELSE —");
    assert.ok(recap !== -1 && confirmation !== -1 && anythingElse !== -1);
    assert.ok(recap < confirmation, "the recap comes before its confirmation");
    assert.ok(confirmation < anythingElse, "the confirmation comes before 'anything else?'");
  });

  test("the caller is asked to confirm the recap, and Remy waits for it", () => {
    const prompt = promptFor();
    assert.match(prompt, /as its own question, and WAIT for their answer: "Is everything I've summarised correct\?"/);
    assert.match(
      prompt,
      /Only once they confirm: "Perfect\. I'll pass your details to our team straight away\. Someone will contact you as soon as possible\."/
    );
  });

  test("the recap names every field the call collected", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /Include the service, the appointment date, the appointment time, the caller's name, the callback number, the address, and any important note they gave/
    );
  });

  test("a 'yes' to 'anything else?' loops back through a fresh recap", () => {
    const prompt = promptFor();
    assert.match(prompt, /working through rule 5 again for anything new/i);
    assert.match(prompt, /give a FRESH complete recap if anything changed or was added/i);
    assert.match(prompt, /ask "Is everything I've summarised correct\?" again/);
  });

  test("a 'no' closes the call on the goodbye, not on the recap", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /Thank you for calling Acme Plumbing\. Have a great day\. Goodbye\./
    );
  });

  test("it names the service and when, and how the team will make contact", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /Just to confirm, Brian, I've noted your preferred time as Tuesday, 11 August at 4pm for the boiler service/
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

describe("the real call: 'as soon as possible' became the callback date AND time", () => {
  // 2026-08-06 test call:
  //   Caller: "I rang earlier but nobody got back to me. I need someone
  //            to call me about an appointment. I'm fairly busy though."
  //   Remy:   "What is the appointment for?"      -> treated as a booking
  //   Caller: "Burst pipe."
  //   Remy:   "Which day and time would suit you best?"
  //   Caller: "As soon as possible."
  //   Remy:   accepted it, and the call was written up as
  //             Callback date: as soon as possible
  //             Callback time: as soon as possible
  //           with the flow collapsed into "the team will contact you".
  //
  // Two faults: a CALLBACK request was taken as an APPOINTMENT, and an
  // urgency phrase was accepted as a day and a time. The deterministic
  // half of the fix is in callbackTiming.test.mjs; these pin the
  // instructions. As elsewhere in this file, a passing test proves the
  // wording is in the built prompt — not that the model obeys it.

  test("A — a request to be rung back is a callback, not a booking", () => {
    const prompt = promptFor();
    assert.match(prompt, /13\. A callback is not an appointment/);
    assert.match(prompt, /I need someone to call me about an appointment/);
    assert.match(prompt, /I rang earlier but nobody got back to me/);
    assert.match(
      prompt,
      /Never quietly turn it into an appointment booking/
    );
  });

  test("A — the clarifying question is scripted, and asked only when needed", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /Would you like me to arrange a callback to discuss the appointment, or are you trying to book the appointment now\?/
    );
    assert.match(prompt, /Do not ask it when their intent is already clear/);
  });

  test("B — urgency is never a date or a time", () => {
    const prompt = promptFor();
    assert.match(prompt, /URGENCY IS NOT A DATE OR A TIME/);
    assert.match(prompt, /NEVER accept one as the day, as the time, or as both/);
    assert.match(prompt, /never record it as either/i);
  });

  test("B — urgency is acknowledged, then the timing is asked for separately", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /I'll mark that as urgent\. Is there a particular day or time window that would suit you\?/
    );
  });

  test("C — a bare 'tomorrow' still gets a time question", () => {
    // The day-only branch already existed for weekdays; it now says out
    // loud that a relative day is no different, since "tomorrow" is the
    // answer callers actually give.
    const prompt = promptFor();
    assert.match(
      prompt,
      /A relative day is no different: "tomorrow" on its own still needs a time/
    );
    assert.match(prompt, /What time tomorrow would suit you\?/);
  });

  test("D — a day with a broad window is enough FOR A CALLBACK, and is not narrowed", () => {
    // Re-scoped 2026-08-06 after a live appointment call: this rule was
    // written for callbacks and was being applied to appointments too,
    // so "next Wednesday afternoon" was accepted as a bookable time.
    // A window is still enough for a callback — see the appointment
    // half of the same branch in the describe block at the end of file.
    const prompt = promptFor();
    assert.match(
      prompt,
      /They gave a DAY with a WINDOW \("Thursday afternoon", "Friday morning", "any time between 2 and 5 on Thursday"\): enough for a CALLBACK/
    );
    assert.match(prompt, /keep their window in their own words/);
    assert.match(prompt, /never narrow it to a single time yourself/);
  });

  test("E — a corrected day or time replaces the earlier one entirely", () => {
    // Rule 10 already owned this; it must still name the day and time.
    const prompt = promptFor();
    assert.match(prompt, /the corrected version REPLACES what you had/);
    assert.match(prompt, /the caller's name, the day, the time/);
  });

  test("F — wanting the appointment itself still runs rules 5 and 9", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /APPOINTMENT — if they want the appointment itself, work through rule 5 and close with rule 9/
    );
    assert.match(prompt, /Nothing in that flow changes/);
    // And rule 9's no-invented-booking wording is untouched.
    assert.match(
      prompt,
      /NEVER tell a caller their appointment is confirmed or booked/
    );
  });

  test("the callback checklist is shorter, and rule 5's gate says so", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /a callback request has its own shorter list — rule 13/
    );
    assert.match(
      prompt,
      /what the callback is about, in their own words; the day and time window that suits them FOR THE CALL/
    );
    assert.match(prompt, /their name; and the callback number \(rule 7\)/);
  });

  test("'the team will contact you' cannot end the timing question early", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /NEVER end the timing question early by falling back on "the team will contact you"/
    );
    assert.match(
      prompt,
      /only AFTER you hold a usable callback day and time window, or after the caller has declined to give one/
    );
  });

  test("no preference is recorded as no preference, not as a day or a time", () => {
    const prompt = promptFor();
    assert.match(prompt, /any time, earliest available callback/);
    assert.match(prompt, /never a day and never a time/);
    assert.match(
      prompt,
      /I'll note that any time suits and ask the team to ring you as early as they can/
    );
  });

  test("nothing is promised that the system cannot keep", () => {
    const prompt = promptFor();
    assert.match(prompt, /I'll record that as your preferred time/);
    assert.match(prompt, /I'll pass that request to the team/);
    assert.match(
      prompt,
      /NEVER guarantee a callback time \("someone will definitely call before 3"\)/
    );
  });

  test("the extraction schema refuses urgency as a preferred_datetime", () => {
    const schema = configFor().structuredDataSchema;
    const datetime = schema.properties.preferred_datetime.description;
    assert.match(datetime, /URGENCY IS NOT A TIME/);
    assert.match(datetime, /NEVER record one of them here \(set urgent instead\)/);
    assert.match(datetime, /including when urgency was all they gave/);
    // A real window is still recorded.
    assert.match(datetime, /Thursday between 2 and 5/);
  });

  test("the extraction schema does not read a callback as a new booking", () => {
    const intent = configFor().structuredDataSchema.properties.intent.description;
    assert.match(
      intent,
      /Asking for someone to CALL THEM BACK about an appointment is not by itself a new_booking/
    );
    assert.match(intent, /only if the caller actually asked to arrange the appointment on this call/);
  });

  test("the owner's summary writes 'Not provided', never the urgency phrase", () => {
    const summary = configFor().summaryInstructions;
    assert.match(summary, /URGENCY IS NOT A DATE AND NOT A TIME/);
    assert.match(
      summary,
      /NEVER write one of them as the Callback date or the Callback time/
    );
    assert.match(summary, /both are "Not provided"/);
    // The urgency itself is still reported — in the sentences, not the fields.
    assert.match(summary, /you say in the sentences above that they asked to be called back as soon as possible/);
  });

  test("the owner's summary keeps a real time window, and names the request", () => {
    const summary = configFor().summaryInstructions;
    assert.match(summary, /a time window the caller gave \("the afternoon", "between 2 and 5"\) IS a time/);
    assert.match(
      summary,
      /report it as a callback request — never as a booked or requested appointment/
    );
  });
});
