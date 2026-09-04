// Regression: speech-to-text noise became the service address.
//
// From the 2026-09-01 production call. The caller's house number was
// 81. The transcriber returned "K e 1 Auckland Drive", and then, on the
// caller's own correction, "A c 1 Oakland Drive" — mangling the DIGITS
// both times while the street name resolved. Remy read "A c 1 Oakland
// Drive" back and accepted it. Nothing in the prompt says a house
// number is a number, and nothing downstream could catch it: the
// caller had to volunteer "81 Oakland Drive" himself, unprompted,
// during the close.
//
// Two independent problems, both covered here:
//
//   1. No deterministic backstop. `service_address` was the last
//      caller-supplied voice field with none — email has
//      normaliseSpokenEmail, preferred_datetime has
//      sanitisePreferredDatetime, name has resolveCallerName.
//   2. No convergence. The address never passed through
//      toExtractedLead, so the calendar event and the lead's stored
//      copy each read the raw model value independently.
//
// The rule under test, in one line:
//   transcription noise must never become the canonical address, and a
//   value we cannot vouch for is dropped rather than guessed at.
//
// CONSTRAIN-ONLY. Every legitimate form a real address takes — 12A,
// Flat 2, Apartment 3B, Unit 5, a named house with no number — must
// pass through byte for byte. Those cases are the ones that would make
// this fix worse than the bug, so they are pinned hardest.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  findSpokenAddress,
  looksLikeTranscriptionNoise,
  resolveServiceAddress,
} from "@/lib/voice/addressIntegrity";
import { processCallEnded } from "@/lib/voice/calls";
import { buildVoiceAssistantConfig } from "@/lib/voice/assistant";

const T = (...turns) => turns.join("\n");

// ── The conversational guard ───────────────────────────────────────
// The deterministic helper is the backstop; this is the part that stops
// the bad value being taken in the first place.

describe("rule 5 step 7 — a house number is a number", () => {
  const promptFor = () =>
    buildVoiceAssistantConfig(
      {
        business_name: "Acme Plumbing",
        business_type: "plumber",
        primary_goal: "book jobs",
        description: null,
        website: null,
      },
      [],
      { greeting: null, voice_id: null, language: null },
      null,
      "+353861234567",
      new Date("2026-09-01T09:00:00+01:00")
    ).systemPrompt;

  test("the artefact class is named, with the real observed values", () => {
    const prompt = promptFor();
    assert.match(prompt, /A HOUSE NUMBER IS A NUMBER/);
    assert.match(prompt, /"81" came back as "K e 1" and then "A c 1" on a real call/);
  });

  test("it asks ONCE, for that component alone", () => {
    const prompt = promptFor();
    assert.match(
      prompt,
      /ask ONCE for that part alone and nothing else in the turn: "Sorry, what's the house number there\?"/
    );
    assert.match(prompt, /Take their answer and move on/);
  });

  test("legitimate forms are protected by name, and never queried", () => {
    const prompt = promptFor();
    assert.match(prompt, /Plenty of real addresses do not start with a plain number/);
    for (const form of ["12A", "Flat 2", "Apartment 3B", "Unit 5"]) {
      assert.ok(prompt.includes(form), `${form} should be named as fine`);
    }
    assert.match(prompt, /a named house with no number at all/);
    assert.match(
      prompt,
      /never query them, and never ask a caller to add a number they do not have/
    );
  });

  test("the existing street-name check and correction rule are untouched", () => {
    const prompt = promptFor();
    assert.match(prompt, /Sorry, was that Birch Drive\?/);
    assert.match(
      prompt,
      /change only the wrong part and say the WHOLE corrected address back once/
    );
  });
});

// ── The noise test, in isolation ───────────────────────────────────

describe("looksLikeTranscriptionNoise — narrow by design", () => {
  test("THE OBSERVED ARTEFACTS are noise", () => {
    assert.equal(looksLikeTranscriptionNoise("K e 1 Auckland Drive"), true);
    assert.equal(looksLikeTranscriptionNoise("A c 1 Oakland Drive"), true);
    assert.equal(looksLikeTranscriptionNoise("A c 1. Oakland Drive"), true);
  });

  test("a lone letter followed by a bare digit is the same failure", () => {
    assert.equal(looksLikeTranscriptionNoise("A 1 Oakland Drive"), true);
  });

  test("ORDINARY numeric addresses are never noise", () => {
    for (const a of [
      "19 Auckland Avenue",
      "81 Oakland Drive",
      "14 Mill Road",
      "221B Baker Street",
      "3-5 Quay Street",
      "5 The Green",
    ]) {
      assert.equal(looksLikeTranscriptionNoise(a), false, a);
    }
  });

  test("12A and other alphanumeric identifiers survive", () => {
    for (const a of ["12A Oak Road", "12a oak road", "4B Seaview Terrace"]) {
      assert.equal(looksLikeTranscriptionNoise(a), false, a);
    }
  });

  test("apartment and unit forms survive", () => {
    for (const a of [
      "Flat 2, 14 Mill Road",
      "Apartment 3B, The Quays",
      "Unit 5, Docklands Business Park",
      "Suite 12, Two Grand Canal",
    ]) {
      assert.equal(looksLikeTranscriptionNoise(a), false, a);
    }
  });

  test("named properties with NO house number survive", () => {
    for (const a of [
      "Rose Cottage, Mill Lane",
      "The Old Rectory, Ballymore",
      "Seaview House, Coast Road",
    ]) {
      assert.equal(looksLikeTranscriptionNoise(a), false, a);
    }
  });

  test("ONE leading single letter is not enough — block and stair letters are real", () => {
    assert.equal(looksLikeTranscriptionNoise("B Block, Mill Road"), false);
  });

  test("nothing at all is not noise — absence is handled elsewhere", () => {
    assert.equal(looksLikeTranscriptionNoise(null), false);
    assert.equal(looksLikeTranscriptionNoise(undefined), false);
    assert.equal(looksLikeTranscriptionNoise("   "), false);
  });
});

// ── Reading what the caller actually said ──────────────────────────

describe("findSpokenAddress — evidence, not a guess", () => {
  test("THE OBSERVED CALL — the last, corrected address wins", () => {
    assert.equal(
      findSpokenAddress(
        T(
          "AI: Thanks, Ernesto. May I have the address where the radiator is leaking?",
          "User: K e 1 Auckland Drive.",
          "AI: Thanks. Just to confirm, was that k e 1 Auckland Drive?",
          "User: No. A c 1. Oakland Drive,",
          "AI: Got it. A c 1 Oakland Drive. May I have the best number to reach you on?",
          "User: This number that I'm calling from,",
          "AI: Is there anything else I can help you with today?",
          "User: Yes. My address is 81 Oakland Drive."
        )
      ),
      "81 Oakland Drive"
    );
  });

  test("a later correction supersedes an earlier well-formed answer", () => {
    assert.equal(
      findSpokenAddress(
        T(
          "AI: What's the address where the work is needed?",
          "User: 14 Mill Road.",
          "AI: Anything else?",
          "User: Actually my address is 15 Oak Drive."
        )
      ),
      "15 Oak Drive"
    );
  });

  test("a mangled answer is never treated as evidence", () => {
    assert.equal(
      findSpokenAddress(
        T("AI: What's the address?", "User: K e 1 Auckland Drive.")
      ),
      null
    );
  });

  test("bare acknowledgements are not addresses", () => {
    assert.equal(
      findSpokenAddress(T("AI: What's the address?", "User: Yeah.")),
      null
    );
    assert.equal(
      findSpokenAddress(T("AI: What's the address?", "User: That's right.")),
      null
    );
  });

  test("ANY single bare word is refused, not just the ones on a list", () => {
    // Structural, because a stop-word list would never stop growing —
    // the lesson this codebase already recorded for service matching.
    for (const reply of ["Grand.", "Perfect.", "Lovely.", "Whatever."]) {
      assert.equal(
        findSpokenAddress(T("AI: What's the address?", `User: ${reply}`)),
        null,
        reply
      );
    }
    // But a real single-line address with a number still gets through.
    assert.equal(
      findSpokenAddress(T("AI: What's the address?", "User: 14 Mill Road.")),
      "14 Mill Road"
    );
    // And a named property, which has two words and no number.
    assert.equal(
      findSpokenAddress(T("AI: What's the address?", "User: Rose Cottage.")),
      "Rose Cottage"
    );
  });

  test("only an answer to an address question counts", () => {
    // "Ernesto" answers a NAME question and must never become an address.
    assert.equal(
      findSpokenAddress(T("AI: May I have your name, please?", "User: Ernesto.")),
      null
    );
  });

  test("no transcript is simply no evidence", () => {
    assert.equal(findSpokenAddress(null), null);
    assert.equal(findSpokenAddress(""), null);
  });
});

// ── The precedence rule ────────────────────────────────────────────

describe("resolveServiceAddress — constrain and converge, never rewrite", () => {
  test("an ordinary candidate is kept byte for byte", () => {
    assert.equal(resolveServiceAddress("19 Auckland Avenue", null), "19 Auckland Avenue");
    assert.equal(resolveServiceAddress("12A Oak Road", null), "12A Oak Road");
    assert.equal(
      resolveServiceAddress("Flat 2, 14 Mill Road", null),
      "Flat 2, 14 Mill Road"
    );
    assert.equal(
      resolveServiceAddress("Rose Cottage, Mill Lane", null),
      "Rose Cottage, Mill Lane"
    );
  });

  test("THE OBSERVED DEFECT — noise yields to what the caller said", () => {
    assert.equal(
      resolveServiceAddress(
        "A c 1 Oakland Drive",
        T(
          "AI: May I have the address where the radiator is leaking?",
          "User: K e 1 Auckland Drive.",
          "AI: Anything else?",
          "User: Yes. My address is 81 Oakland Drive."
        )
      ),
      "81 Oakland Drive"
    );
  });

  test("noise with NO evidence records nothing rather than something untrue", () => {
    assert.equal(
      resolveServiceAddress("A c 1 Oakland Drive", "AI: Hello. User: Hi."),
      null
    );
    assert.equal(resolveServiceAddress("K e 1 Auckland Drive", null), null);
  });

  test("a well-formed candidate naming a DIFFERENT place yields to the caller", () => {
    // SUPERSEDED EXPECTATION, kept deliberately rather than deleted.
    //
    // This case originally asserted "15 Oak Drive" — a well-formed
    // candidate was never second-guessed, on the reasoning that the
    // extractor is told corrections win and preferring a spoken value
    // could resurrect what the caller replaced.
    //
    // The first half of that reasoning does not hold: nothing in the
    // transcript says "15 Oak Drive", so the candidate is not a
    // correction of anything the caller uttered. The second half is
    // answered structurally instead — findSpokenAddress returns the
    // LAST address the caller gave, so a genuine correction is what
    // wins here, never a stale earlier attempt.
    assert.equal(
      resolveServiceAddress(
        "15 Oak Drive",
        T("AI: What's the address?", "User: 14 Mill Road.")
      ),
      "14 Mill Road"
    );
  });

  test("no candidate falls back to the caller's own words", () => {
    assert.equal(
      resolveServiceAddress(
        null,
        T("AI: What's the address where the work is needed?", "User: 14 Mill Road.")
      ),
      "14 Mill Road"
    );
  });

  test("nothing anywhere stays nothing — never invented", () => {
    assert.equal(resolveServiceAddress(null, null), null);
    assert.equal(resolveServiceAddress(null, "AI: Hello."), null);
    assert.equal(resolveServiceAddress("   ", null), null);
  });
});

// ── The real path ──────────────────────────────────────────────────

const ORG_ID = "11111111-1111-4111-8111-111111111111";

const addressCall = (id, transcript, extractedOver = {}) => ({
  kind: "call-ended",
  provider: "vapi",
  dedupeKey: `vapi:addr-${id}:end-of-call-report`,
  providerCallId: id,
  businessPhone: "+353212345678",
  callerPhone: "+353861234567",
  direction: "inbound",
  startedAt: "2026-09-01T15:00:00.000Z",
  endedAt: "2026-09-01T15:02:00.000Z",
  durationSeconds: 120,
  endedReason: "assistant-ended-call",
  summary: "Caller has a leaking radiator and needs someone urgently.",
  transcript,
  recordingUrl: null,
  costUsd: null,
  costBreakdown: null,
  extracted: {
    intent: "question",
    name: "Ernesto",
    email: null,
    phone: null,
    service: "leaking radiator",
    preferred_datetime: null,
    service_address: null,
    urgent: true,
    ...extractedOver,
  },
});

function detailsRow(html, label) {
  const m = html.match(new RegExp(`<td[^>]*>${label}</td><td[^>]*>([^<]*)</td>`));
  return m ? m[1] : null;
}

function installStubs() {
  const realFetch = globalThis.fetch;
  const inserts = [];
  const patches = [];
  const emails = [];
  const json = (b) =>
    new Response(JSON.stringify(b), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    const h = new Headers(init.headers ?? {});
    const obj = (h.get("accept") ?? "").includes("pgrst.object");
    const body = init.body ? JSON.parse(init.body) : null;

    if (url.includes("api.resend.com")) {
      emails.push(body);
      return json({ id: `email-${emails.length}` });
    }
    if (url.includes("api.openai.com")) {
      return json({ choices: [{ message: { content: "NONE" } }] });
    }
    if (url.includes("/rest/v1/voice_calls")) {
      const r = { id: "call-row-1" };
      return obj ? json(r) : json([r]);
    }
    if (url.includes("/rest/v1/business_knowledge")) return json([]);
    if (url.includes("/rest/v1/business_hours")) {
      return json(
        [0, 1, 2, 3, 4, 5, 6].map((day_of_week) => ({
          day_of_week,
          is_closed: false,
          open_time: "09:00",
          close_time: "17:00",
          lunch_start: null,
          lunch_end: null,
        }))
      );
    }
    if (url.includes("/rest/v1/organisations")) {
      const r = {
        id: ORG_ID,
        owner_id: "22222222-2222-4222-8222-222222222222",
        business_name: "Acme Plumbing",
        notification_email: "owner@example.com",
        appointment_duration_minutes: 60,
        emergency_mode_enabled: false,
        max_concurrent_bookings: 1,
        timezone: "Europe/London",
      };
      return obj ? json(r) : json([r]);
    }
    if (url.includes("/rest/v1/conversations")) return obj ? json(null) : json([]);
    if (url.includes("/rest/v1/leads")) {
      if (method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-range": "*/0" },
        });
      }
      if (method === "POST") {
        const stored = { id: "lead-1", ...body };
        inserts.push(stored);
        return obj ? json({ id: stored.id }) : json([{ id: stored.id }]);
      }
      if (method === "PATCH") {
        patches.push(body);
        return json([]);
      }
      if (url.includes("select=metadata")) {
        const r = { metadata: {}, appointment_datetime: null };
        return obj ? json(r) : json([r]);
      }
      return obj ? json(null) : json([]);
    }
    if (url.includes("/rest/v1/voice_events")) return json([{ id: "evt-1" }]);
    if (url.includes("/rest/v1/integration_connections")) {
      return obj ? json(null) : json([]);
    }
    throw new Error(`Unstubbed fetch in test: ${method} ${url}`);
  };

  return {
    inserts,
    patches,
    emails,
    /** What actually landed on leads.metadata.service_address. */
    storedAddress() {
      const withMeta = patches.filter((p) => p && p.metadata);
      const last = withMeta[withMeta.length - 1];
      return last ? last.metadata.service_address ?? null : null;
    },
    summaryHtml() {
      const sent = emails.find((e) => String(e.html ?? "").includes("Caller ID"));
      return String(sent?.html ?? "");
    },
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

async function admin() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

describe("the real path — one canonical address", () => {
  let stubs;
  beforeEach(() => {
    stubs = installStubs();
  });
  afterEach(() => stubs.restore());

  test("THE OBSERVED CALL — the corrected address is what persists", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      addressCall(
        "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
        T(
          "AI: Thanks for calling Acme Plumbing. How can I help?",
          "User: I have a leaking radiator. I need someone as soon as possible.",
          "AI: Thanks, Ernesto. May I have the address where the radiator is leaking?",
          "User: K e 1 Auckland Drive.",
          "AI: Thanks. Just to confirm, was that k e 1 Auckland Drive?",
          "User: No. A c 1. Oakland Drive,",
          "AI: Got it. A c 1 Oakland Drive. Is there anything else I can help you with today?",
          "User: Yes. My address is 81 Oakland Drive."
        ),
        { service_address: "A c 1 Oakland Drive" }
      )
    );

    assert.equal(
      stubs.storedAddress(),
      "81 Oakland Drive",
      "leads.metadata.service_address must be the corrected value"
    );
    assert.ok(
      !/A c 1/i.test(stubs.storedAddress() ?? ""),
      "the transcription artefact must never persist"
    );
  });

  test("the owner email and the lead show the SAME resolved address", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      addressCall(
        "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
        T(
          "AI: What's the address where the work is needed?",
          "User: K e 1 Auckland Drive.",
          "AI: Anything else?",
          "User: My address is 81 Oakland Drive."
        ),
        { service_address: "A c 1 Oakland Drive" }
      )
    );

    const shown = detailsRow(stubs.summaryHtml(), "Service address");
    assert.equal(shown, "81 Oakland Drive");
    assert.equal(
      shown,
      stubs.storedAddress(),
      "the owner must be shown the address the lead actually holds"
    );
  });

  test("an ordinary address reaches the lead untouched", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      addressCall(
        "cccccccc-3333-4333-8333-cccccccccccc",
        T("AI: What's the address where the work is needed?", "User: 19 Auckland Avenue."),
        { service_address: "19 Auckland Avenue" }
      )
    );
    assert.equal(stubs.storedAddress(), "19 Auckland Avenue");
    assert.equal(
      detailsRow(stubs.summaryHtml(), "Service address"),
      "19 Auckland Avenue"
    );
  });

  for (const [label, address] of [
    ["12A", "12A Oak Road"],
    ["an apartment", "Flat 2, 14 Mill Road"],
    ["a plain street address", "14 Mill Road"],
    ["a named property with no number", "Rose Cottage, Mill Lane"],
  ]) {
    test(`${label} survives the real path unchanged`, async () => {
      await processCallEnded(
        await admin(),
        ORG_ID,
        addressCall(
          `dddddddd-4444-4444-8444-${label.length}${"d".repeat(11)}`.slice(0, 36),
          T("AI: What's the address where the work is needed?", `User: ${address}.`),
          { service_address: address }
        )
      );
      assert.equal(stubs.storedAddress(), address);
    });
  }

  test("noise with no recoverable evidence records NO address at all", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      addressCall(
        "eeeeeeee-5555-4555-8555-eeeeeeeeeeee",
        T("AI: What's the address where the work is needed?", "User: K e 1 Auckland Drive."),
        { service_address: "K e 1 Auckland Drive" }
      )
    );
    assert.equal(
      stubs.storedAddress(),
      null,
      "better nothing than an address that cannot exist"
    );
    assert.equal(
      detailsRow(stubs.summaryHtml(), "Service address"),
      null,
      "and no Service address row is rendered"
    );
  });

  test("PR #35, #37 and #39 behaviour is untouched on the same call", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      addressCall(
        "ffffffff-6666-4666-8666-ffffffffffff",
        T(
          "AI: How can I help?",
          "User: I have a leaking radiator. As soon as possible. It's urgent.",
          "AI: Is there a particular day or time window that would suit you?",
          "User: No particular day or time. Just as soon as possible.",
          "AI: May I have your name, please?",
          "User: Ernesto.",
          "AI: What's the address where the work is needed?",
          "User: 19 Auckland Avenue."
        ),
        {
          name: "Ernie Sephora",
          email: "erniesophora@gmail.com",
          service_address: "19 Auckland Avenue",
        }
      )
    );

    const html = stubs.summaryHtml();
    // PR #39 — the email must not manufacture the caller.
    assert.equal(detailsRow(html, "Caller"), "Ernesto");
    assert.equal(stubs.inserts[0].name, "Ernesto");
    // PR #35 — the urgency still reaches the owner.
    assert.equal(
      detailsRow(html, "Callback urgency"),
      "Urgent — no specific day or time given"
    );
    // PR #37 — no booking outcome is reported when no time was requested.
    assert.equal(detailsRow(html, "Booking status"), null);
    assert.equal(stubs.inserts[0].preferred_datetime ?? null, null);
  });
});
