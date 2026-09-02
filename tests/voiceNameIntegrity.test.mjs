// Regression: an email address manufactured a caller name.
//
// From the 2026-08-31 production call. The caller gave the name
// "Ernesto" and the call summary recorded `Name: Ernesto` correctly,
// but the STRUCTURED Caller field in the owner email read "Ernie
// Sephora" — a person who does not exist, whose name is the local part
// of the email address spoken later in the same call.
//
// No code derives a name from an email. Read-only reproduction against
// the real extractor established the mechanism: when a caller name is
// absent or unclear, extraction fabricates a plausible one from the
// adjacent email local part. "jameshartley@gmail.com" came back as name
// "James Hartley" on 3 of 3 runs.
//
// Which extractor produced the bad name on the live call was NOT
// established — the provider's structured data and the transcript
// fallback are both possible, and the logs no longer reach back. The
// guard therefore sits where the two paths converge, in
// toExtractedLead, and these tests drive it from both directions: the
// helper directly, and the REAL processCallEnded.
//
// The rule under test, in one line:
//   a caller-supplied identity outranks a model inference, and an email
//   outranks nothing at all.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  findSpokenName,
  looksDerivedFromEmail,
  resolveCallerName,
} from "@/lib/voice/nameIntegrity";
import { processCallEnded } from "@/lib/voice/calls";

const T = (...turns) => turns.join("\n");

// ── The helper, in isolation ───────────────────────────────────────

describe("looksDerivedFromEmail — the negative guard only", () => {
  test("an exact normalised match to the local part is derived", () => {
    assert.equal(looksDerivedFromEmail("James Hartley", "jameshartley@gmail.com"), true);
    assert.equal(looksDerivedFromEmail("john smith", "JohnSmith@gmail.com"), true);
  });

  test("the observed single-vowel drift is caught by the narrow rule", () => {
    // "erniesephora" vs "erniesophura" — one edit. This is the measured
    // reason the edit-distance rule exists at all.
    assert.equal(looksDerivedFromEmail("Ernie Sephora", "erniesophura@gmail.com"), true);
  });

  test("genuinely different names are NOT derived", () => {
    assert.equal(looksDerivedFromEmail("Ernesto", "erniesophura@gmail.com"), false);
    assert.equal(looksDerivedFromEmail("Mary O'Brien", "jameshartley@gmail.com"), false);
    assert.equal(looksDerivedFromEmail("John Smith", "accounts@acmeplumbing.ie"), false);
  });

  test("the edit-distance rule is restricted, so short names cannot collide", () => {
    // "ann" vs "sam" would be 3 edits anyway, but the length floor is
    // what stops near-miss short names being dropped at all.
    assert.equal(looksDerivedFromEmail("Ann", "sam@gmail.com"), false);
    assert.equal(looksDerivedFromEmail("Dave", "dan@gmail.com"), false);
  });

  test("nothing to compare is never a match", () => {
    assert.equal(looksDerivedFromEmail(null, "jameshartley@gmail.com"), false);
    assert.equal(looksDerivedFromEmail("James Hartley", null), false);
    assert.equal(looksDerivedFromEmail("", ""), false);
  });
});

describe("findSpokenName — evidence, never a guess", () => {
  test("reads the answer to a name question", () => {
    assert.equal(
      findSpokenName(T("AI: Can I take your name?", "User: Ernesto.")),
      "Ernesto"
    );
  });

  test("handles the inline transcript form as well as newlines", () => {
    assert.equal(
      findSpokenName("AI: May I have your name? User: Ernesto. AI: Thanks."),
      "Ernesto"
    );
  });

  test("strips a spoken opener", () => {
    assert.equal(
      findSpokenName(T("AI: Your name?", "User: It's John Smith.")),
      "John Smith"
    );
  });

  test("joins a spelled-out answer", () => {
    assert.equal(
      findSpokenName(T("AI: Can I take your name?", "User: E R N E S T O")),
      "ERNESTO"
    );
  });

  test("a spoken EMAIL is never read as a spoken name", () => {
    assert.equal(
      findSpokenName(
        T("AI: What is the best email?", "User: james hartley at gmail dot com.")
      ),
      null
    );
  });

  test("an unusable answer yields no evidence rather than a guess", () => {
    assert.equal(findSpokenName(T("AI: Can I take your name?", "User: [inaudible]")), null);
    assert.equal(findSpokenName(T("AI: Can I take your name?", "User: Yes.")), null);
    assert.equal(findSpokenName(null), null);
    assert.equal(findSpokenName(""), null);
  });

  test("a name is only read where one was actually asked for", () => {
    assert.equal(
      findSpokenName(T("AI: How can I help?", "User: Burst pipe, urgent.")),
      null
    );
  });
});

// ── The precedence rule ────────────────────────────────────────────

describe("resolveCallerName — caller-supplied identity outranks the model", () => {
  test("1. THE OBSERVED CASE — the spoken name survives the email", () => {
    assert.equal(
      resolveCallerName(
        "Ernie Sephora",
        "erniesophura@gmail.com",
        T(
          "AI: Can I take your name?",
          "User: Ernesto.",
          "AI: And the best email to reach you on?",
          "User: ernie sophura at gmail dot com.",
          "AI: ernie sophura at gmail dot com?",
          "User: That's right."
        )
      ),
      "Ernesto"
    );
  });

  test("2. name first, email captured and CORRECTED later — name unchanged", () => {
    assert.equal(
      resolveCallerName(
        "Ernesto",
        "erniesophura@gmail.com",
        T(
          "AI: Can I take your name?",
          "User: Ernesto.",
          "AI: And your email?",
          "User: ernie sophora at gmail dot com.",
          "AI: I have ernie sophora at gmail dot com — is that right?",
          "User: No, sophura. S O P H U R A.",
          "AI: ernie sophura at gmail dot com?",
          "User: That's it."
        )
      ),
      "Ernesto"
    );
  });

  test("3. NO name given + name-like email — no person is invented", () => {
    assert.equal(
      resolveCallerName(
        "James Hartley",
        "jameshartley@gmail.com",
        T(
          "AI: How can I help?",
          "User: I have a burst pipe, it's urgent.",
          "AI: What is the best email to reach you on?",
          "User: james hartley at gmail dot com."
        )
      ),
      null
    );
  });

  test("4. garbled name answer + name-like email — fails safe", () => {
    assert.equal(
      resolveCallerName(
        "James Hartley",
        "jameshartley@gmail.com",
        T(
          "AI: Can I take your name?",
          "User: [inaudible]",
          "AI: And your email?",
          "User: james hartley at gmail dot com."
        )
      ),
      null
    );
  });

  test("5. LEGITIMATE John Smith with johnsmith@gmail.com — kept", () => {
    // The guard must not simply delete names that resemble their
    // owner's address. Spoken support wins before the email test runs.
    assert.equal(
      resolveCallerName(
        "John Smith",
        "johnsmith@gmail.com",
        T(
          "AI: May I have your name?",
          "User: John Smith.",
          "AI: And your email?",
          "User: john smith at gmail dot com."
        )
      ),
      "John Smith"
    );
  });

  test("5b. the fuller model form is kept when the turn caught less", () => {
    assert.equal(
      resolveCallerName(
        "John Smith",
        "johnsmith@gmail.com",
        T("AI: Can I take your name?", "User: John.")
      ),
      "John Smith"
    );
  });

  test("6. clear name + unrelated email — preserved", () => {
    assert.equal(
      resolveCallerName(
        "Ernesto",
        "accounts@acmeplumbing.ie",
        T("AI: Can I take your name?", "User: Ernesto.")
      ),
      "Ernesto"
    );
  });

  test("7. clear name + NO email — preserved", () => {
    assert.equal(
      resolveCallerName("Ernesto", null, T("AI: Your name?", "User: Ernesto.")),
      "Ernesto"
    );
  });

  test("8. a caller CORRECTING their own name is not overridden", () => {
    // The extractor is told corrections win. This guard must never
    // resurrect the stale first answer.
    assert.equal(
      resolveCallerName(
        "Ernest",
        "someone@example.com",
        T(
          "AI: Can I take your name?",
          "User: Ernesto.",
          "AI: Sorry, could you repeat that?",
          "User: Actually it's Ernest."
        )
      ),
      "Ernest"
    );
  });

  test("no candidate and no evidence stays empty", () => {
    assert.equal(resolveCallerName(null, "jameshartley@gmail.com", "AI: Hello."), null);
  });

  test("a candidate with no transcript at all behaves as before", () => {
    assert.equal(resolveCallerName("Ernesto", null, null), "Ernesto");
  });
});

// ── The real path ──────────────────────────────────────────────────

const ORG_ID = "11111111-1111-4111-8111-111111111111";

const nameCall = (id, transcript, extractedOver = {}) => ({
  kind: "call-ended",
  provider: "vapi",
  dedupeKey: `vapi:name-${id}:end-of-call-report`,
  providerCallId: id,
  businessPhone: "+353212345678",
  callerPhone: "+353861234567",
  direction: "inbound",
  startedAt: "2026-08-31T15:00:00.000Z",
  endedAt: "2026-08-31T15:05:00.000Z",
  durationSeconds: 300,
  endedReason: "customer-ended-call",
  summary: "Caller has a burst pipe and needs someone urgently. Name: Ernesto.",
  transcript,
  recordingUrl: null,
  costUsd: null,
  costBreakdown: null,
  extracted: {
    intent: "question",
    name: "Ernie Sephora",
    email: "erniesophura@gmail.com",
    phone: null,
    service: "burst pipe",
    preferred_datetime: null,
    service_address: null,
    urgent: true,
    ...extractedOver,
  },
});

/**
 * The value rendered in one details row, e.g. callerRow("Caller").
 * Scoped deliberately: the owner email also embeds the raw transcript,
 * which legitimately contains the caller's spoken email words, so a
 * whole-document search would flag those as a fabricated name.
 */
function detailsRow(html, label) {
  const m = html.match(
    new RegExp(`<td[^>]*>${label}</td><td[^>]*>([^<]*)</td>`)
  );
  return m ? m[1] : null;
}
function installStubs() {
  const realFetch = globalThis.fetch;
  const inserts = [];
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
      if (method === "PATCH") return json([]);
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
    emails,
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

describe("the real path — an email cannot manufacture a caller", () => {
  let stubs;
  beforeEach(() => {
    stubs = installStubs();
  });
  afterEach(() => stubs.restore());

  test("THE OBSERVED CALL — the lead and the owner email both say Ernesto", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      nameCall(
        "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
        T(
          "AI: Thanks for calling Acme Plumbing. How can I help?",
          "User: I have a burst pipe. I need someone as soon as possible. It's urgent.",
          "AI: Of course. Can I take your name?",
          "User: Ernesto.",
          "AI: Thanks. And the best email to reach you on?",
          "User: ernie sophura at gmail dot com.",
          "AI: ernie sophura at gmail dot com?",
          "User: That's right."
        )
      )
    );

    assert.equal(stubs.inserts[0].name, "Ernesto", "the persisted lead name");
    const html = stubs.summaryHtml();
    assert.equal(detailsRow(html, "Caller"), "Ernesto", "the owner-email Caller field");
    assert.ok(
      !/Ernie Sephora/i.test(detailsRow(html, "Caller") ?? ""),
      "the fabricated person must never be the Caller"
    );
  });

  test("email capture cannot mutate a name the caller gave", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      nameCall(
        "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
        T(
          "AI: Can I take your name?",
          "User: Ernesto.",
          "AI: And your email?",
          "User: ernie sophora at gmail dot com.",
          "AI: I have ernie sophora — is that right?",
          "User: No, sophura. S O P H U R A.",
          "AI: ernie sophura at gmail dot com?",
          "User: That's it."
        ),
        { name: "Ernesto" }
      )
    );
    assert.equal(stubs.inserts[0].name, "Ernesto");
  });

  test("no name given — the owner sees the phone number, not a person", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      nameCall(
        "cccccccc-3333-4333-8333-cccccccccccc",
        T(
          "AI: How can I help?",
          "User: Burst pipe, it's urgent.",
          "AI: What is the best email to reach you on?",
          "User: james hartley at gmail dot com."
        ),
        { name: "James Hartley", email: "jameshartley@gmail.com" }
      )
    );
    assert.equal(stubs.inserts[0].name, null, "no person is invented");
    const html = stubs.summaryHtml();
    assert.equal(
      detailsRow(html, "Caller"),
      "+353861234567",
      "the Caller field falls back to the real phone number"
    );
    assert.ok(
      !/James Hartley/i.test(detailsRow(html, "Caller") ?? ""),
      "the fabricated person is never the Caller"
    );
  });

  test("a legitimate John Smith with johnsmith@gmail.com survives", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      nameCall(
        "dddddddd-4444-4444-8444-dddddddddddd",
        T(
          "AI: May I have your name?",
          "User: John Smith.",
          "AI: And your email?",
          "User: john smith at gmail dot com."
        ),
        { name: "John Smith", email: "johnsmith@gmail.com" }
      )
    );
    assert.equal(stubs.inserts[0].name, "John Smith");
    assert.match(stubs.summaryHtml(), /John Smith/);
  });

  test("the email itself is untouched by the name guard", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      nameCall(
        "eeeeeeee-5555-4555-8555-eeeeeeeeeeee",
        T("AI: Can I take your name?", "User: Ernesto.", "AI: Email?", "User: ernie sophura at gmail dot com."),
        { name: "Ernie Sephora", email: "erniesophura@gmail.com" }
      )
    );
    assert.equal(
      stubs.inserts[0].email,
      "erniesophura@gmail.com",
      "email normalisation is unchanged by this fix"
    );
  });
});

// ── The 2026-09-02 digit-suffix regression ─────────────────────────
// A SECOND way the caller name was lost, and the opposite failure to
// the Ernesto one above: there the model INVENTED a name and the guard
// had to reject it; here the model got the name RIGHT and the guard
// destroyed it.
//
// The live call (Vapi 01a06124-b3e9-744c-9a32-b6a9ea8f4ddc, 2026-09-02):
// the caller was "Jason Test" on jasontest141@gmail.com. Deepgram
// rendered the isolated name turn as "JSON test" — it transcribed the
// same speaker's "jason" correctly seconds later inside the spoken
// email, so this is the formatting layer picking the technical token,
// not an acoustic failure. Vapi's structuredData was CORRECT
// ("Jason Test"). The lead still persisted "JSON test", because:
//
//   normalise("jasontest141") stripped the digits -> "jasontest"
//   normalise("Jason Test")                       -> "jasontest"
//   => looksDerivedFromEmail reported an EXACT match
//   => namesAgree("Jason Test","JSON test") was false, the transcript
//      having mangled the only evidence that would have vindicated it
//   => rule 2 fired and took the mangled transcript value.
//
// These use the REAL production values throughout.

const JASON_TRANSCRIPT = T(
  "AI: Dot, thanks for calling night owl test. This is Remy, your AI receptionist. How can I help you today?",
  "User: Hi. I have a leaking radiator, and I need someone as soon as possible.",
  "AI: Of course, I'll mark that as urgent. Is there a particular day or time window that would suit you?",
  "User: It's urgent, but I don't have a particular day or time. So as soon as possible is fine.",
  "AI: No problem. I'll note that and ask the team to ring you as early as they can. May I have your name, please?",
  "User: JSON test.",
  "AI: Thanks, Jason. May I have your email address, please?",
  "User: Yeah. It's jason test 1 4 1 at g mail dot com.",
  "AI: I've got that as JSON test 1 4 1, at g mail dot com. Is that right?",
  "User: Yeah.",
  "AI: What's the address where the work is needed?",
  "User: 81 Oakland Drive.",
  "AI: Thank you. I can use the number you're calling from. Is that the best number to reach you on?",
  "User: Yeah."
);

describe("looksDerivedFromEmail — a digit suffix is not the same string", () => {
  test("THE OBSERVED SHAPE — a real name plus digits is NOT derived", () => {
    assert.equal(
      looksDerivedFromEmail("Jason Test", "jasontest141@gmail.com"),
      false
    );
  });

  test("ordinary name-plus-digits addresses are all safe", () => {
    assert.equal(looksDerivedFromEmail("John Smith", "johnsmith82@gmail.com"), false);
    assert.equal(looksDerivedFromEmail("Mary O'Brien", "maryobrien1990@gmail.com"), false);
    assert.equal(looksDerivedFromEmail("Ernesto", "ernesto123@gmail.com"), false);
  });

  test("separators are still not significant — only digits are", () => {
    // A local part written with a separator is ONE name, and must stay
    // caught: this is the PR #39 shape with a dot in it.
    assert.equal(looksDerivedFromEmail("James Hartley", "james.hartley@gmail.com"), true);
    assert.equal(looksDerivedFromEmail("James Hartley", "james_hartley@gmail.com"), true);
    assert.equal(looksDerivedFromEmail("James Hartley", "james-hartley@gmail.com"), true);
  });

  test("PR #39's own cases are untouched by the digit rule", () => {
    // No digits anywhere in these local parts, so they normalise
    // exactly as they did before and must behave exactly as before.
    assert.equal(looksDerivedFromEmail("James Hartley", "jameshartley@gmail.com"), true);
    assert.equal(looksDerivedFromEmail("Ernie Sephora", "erniesophura@gmail.com"), true);
    assert.equal(looksDerivedFromEmail("Ernesto", "erniesophura@gmail.com"), false);
  });

  test("distinct names still never collapse into one another", () => {
    // The digit change must not have widened identity matching.
    assert.equal(looksDerivedFromEmail("Jason Test", "brianmurphy141@gmail.com"), false);
    assert.equal(looksDerivedFromEmail("John Smith", "johnsmyth141@gmail.com"), false);
    assert.equal(looksDerivedFromEmail("Dave", "dan1@gmail.com"), false);
  });
});

describe("resolveCallerName — the correct name survives a digit-suffixed email", () => {
  test("THE OBSERVED CALL — the model's correct name is kept", () => {
    assert.equal(
      resolveCallerName("Jason Test", "jasontest141@gmail.com", JASON_TRANSCRIPT),
      "Jason Test"
    );
  });

  test("a caller CORRECTING their name still wins, digits or not", () => {
    // Precedence unchanged: the candidate stands on a plain
    // disagreement, so a later correction is never overridden here.
    assert.equal(
      resolveCallerName(
        "Brian",
        "brian141@gmail.com",
        T("AI: Can I take your name?", "User: Bryan. B R Y A N.")
      ),
      "Brian"
    );
  });

  test("a manufactured name with NO digits is still rejected", () => {
    // PR #39 rule 4, unchanged: no spoken support and the candidate
    // looks built from the address.
    assert.equal(
      resolveCallerName("James Hartley", "jameshartley@gmail.com", null),
      null
    );
  });
});

describe("the real path — a correct name survives to the lead and the owner", () => {
  let stubs;
  beforeEach(() => {
    stubs = installStubs();
  });
  afterEach(() => stubs.restore());

  test("THE OBSERVED CALL — the lead and the owner email both say Jason Test", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      nameCall(
        "cccccccc-3333-4333-8333-cccccccccccc",
        JASON_TRANSCRIPT,
        {
          // The real structuredData Vapi returned for this call.
          intent: "new_booking",
          name: "Jason Test",
          email: "jasontest141@gmail.com",
          service: "leaking radiator",
          service_address: "81 Oakland Drive",
          preferred_datetime: null,
          urgent: true,
        }
      )
    );

    assert.equal(stubs.inserts[0].name, "Jason Test", "the persisted lead name");
    assert.equal(
      stubs.inserts[0].email,
      "jasontest141@gmail.com",
      "the email is untouched by the name guard"
    );
    const html = stubs.summaryHtml();
    assert.equal(
      detailsRow(html, "Caller"),
      "Jason Test",
      "the owner-email Caller field"
    );
    assert.ok(
      !/JSON test/.test(detailsRow(html, "Caller") ?? ""),
      "the mangled transcript rendering must never become the Caller"
    );
  });
});
