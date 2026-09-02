// Regression: the owner could not see the email address the system
// actually used.
//
// normaliseSpokenEmail decides the address that is persisted on the
// lead and that sendBookingConfirmationEmails writes to. Until this
// change the owner's call-summary email had structured rows for Caller,
// Caller ID, alternate number, callback urgency and service address —
// and NO Email row. The only address the owner could read was the
// "Email:" line inside the summary paragraph, written independently by
// the provider's summary model from the transcript, with no sight of
// the normaliser's output.
//
// That is the same shape as the 2026-08-31 "Ernie Sephora" defect that
// PR #39 had to fix for the caller's NAME: the guard protected the
// persisted value while the surface the defect would be SEEN on read
// around it. Two ways it bites, and both are pinned below:
//
//   1. the paragraph and the normaliser disagree, and the owner re-keys
//      an address nothing was ever sent to;
//   2. the normaliser REJECTS the address as unusable — so no
//      confirmation email is sent at all — and the paragraph still
//      prints one, confidently, as though it had been accepted.
//
// The rule under test, in one line:
//   the structured row carries the canonical value or it carries
//   nothing; it is never the model's separate reading of the call.
//
// These drive the REAL processCallEnded and assert on the REAL rendered
// owner email, not on sendCallSummaryEmail called directly with the
// value under test. That distinction is the whole lesson of PR #34,
// whose 54 green tests supplied the value they then checked, and proved
// nothing about the pipeline that produces it.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { processCallEnded } from "@/lib/voice/calls";

const T = (...turns) => turns.join("\n");

const ORG_ID = "11111111-1111-4111-8111-111111111111";

/**
 * A completed call. `summary` is deliberately a parameter: several
 * cases below need the model's paragraph to say something DIFFERENT
 * from the canonical value, which is exactly the divergence this row
 * exists to expose.
 */
const emailCall = (id, { transcript, summary, extracted = {} }) => ({
  kind: "call-ended",
  provider: "vapi",
  dedupeKey: `vapi:canonical-email-${id}:end-of-call-report`,
  providerCallId: id,
  businessPhone: "+353212345678",
  callerPhone: "+353861234567",
  direction: "inbound",
  startedAt: "2026-09-02T15:00:00.000Z",
  endedAt: "2026-09-02T15:05:00.000Z",
  durationSeconds: 300,
  endedReason: "customer-ended-call",
  summary,
  transcript,
  recordingUrl: null,
  costUsd: null,
  costBreakdown: null,
  extracted: {
    intent: "question",
    name: "Ernesto",
    email: "ernesto@gmail.com",
    phone: null,
    service: "leaking radiator",
    preferred_datetime: null,
    service_address: null,
    urgent: true,
    ...extracted,
  },
});

/**
 * The value rendered in one structured details row.
 *
 * Scoped to the row deliberately, and this matters more for email than
 * for any other field: the owner email also embeds the summary
 * paragraph AND the raw transcript, both of which legitimately contain
 * email-shaped text. A whole-document search could not tell the
 * canonical row from the model's version of it — which is the very
 * confusion under test.
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

  const patches = [];

  return {
    inserts,
    patches,
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

describe("the owner email shows the canonical email address", () => {
  let stubs;
  beforeEach(() => {
    stubs = installStubs();
  });
  afterEach(() => stubs.restore());

  // ── A. the canonical value reaches the owner ────────────────────

  test("A. a canonical email is rendered in its own structured row", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      emailCall("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", {
        transcript: T(
          "AI: Can I take your name?",
          "User: Ernesto.",
          "AI: And the best email to reach you on?",
          "User: ernesto at gmail dot com."
        ),
        summary: "Ernesto called about a leaking radiator. Email: ernesto@gmail.com.",
      })
    );

    const html = stubs.summaryHtml();
    assert.equal(
      detailsRow(html, "Email"),
      "ernesto@gmail.com",
      "the structured Email row carries the canonical address"
    );
    assert.equal(
      stubs.inserts[0].email,
      "ernesto@gmail.com",
      "and it is the same address that was persisted on the lead"
    );
  });

  test("A2. a SPOKEN address is shown in the normalised form, not as words", async () => {
    // The address the model wrote is the spoken wording; the normaliser
    // is what makes it usable. Before this row existed the owner could
    // only see whichever form the summary model happened to choose.
    await processCallEnded(
      await admin(),
      ORG_ID,
      emailCall("aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa", {
        transcript: T(
          "AI: And your email?",
          "User: michael ryan at hotmail dot com."
        ),
        summary: "Caller gave their email. Email: michael ryan at hotmail dot com.",
        extracted: { name: "Michael", email: "michael ryan at hotmail dot com" },
      })
    );

    const html = stubs.summaryHtml();
    assert.equal(
      detailsRow(html, "Email"),
      "michaelryan@hotmail.com",
      "the row shows the address a confirmation would actually be sent to"
    );
    assert.equal(stubs.inserts[0].email, "michaelryan@hotmail.com");
  });

  // ── B. the paragraph disagrees, the row does not follow it ──────

  test("B. a DIFFERENT malformed address in the summary never wins", async () => {
    // The exact divergence this row exists to expose: the summary model
    // read the call its own way and produced an address that is not the
    // one the system accepted. The paragraph is left intact — removing
    // it is the separate F4 decision — but it is no longer the only
    // email the owner can see.
    await processCallEnded(
      await admin(),
      ORG_ID,
      emailCall("bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb", {
        transcript: T(
          "AI: And your email?",
          "User: ernesto at gmail dot com.",
          "AI: ernesto at gmail dot com?",
          "User: That's right."
        ),
        summary:
          "Ernesto called about a leaking radiator. Email: ernesto at gmial dot con.",
      })
    );

    const html = stubs.summaryHtml();
    assert.equal(
      detailsRow(html, "Email"),
      "ernesto@gmail.com",
      "the row is the canonical address, not the model's reading"
    );
    assert.ok(
      !/gmial/i.test(detailsRow(html, "Email") ?? ""),
      "the malformed address must never reach the structured row"
    );
    assert.ok(
      /gmial/i.test(html),
      "the summary paragraph itself is deliberately UNCHANGED by this fix — " +
        "removing it is the separate F4 decision, and this test would " +
        "otherwise pass for the wrong reason"
    );
  });

  // ── C. nothing canonical, nothing shown ─────────────────────────

  test("C. a REJECTED address renders no Email row at all", async () => {
    // "michael ryan at hotmail" has no domain: normaliseSpokenEmail
    // returns null, nothing is persisted, and no confirmation email can
    // ever be sent. The owner must not be shown an address as though it
    // had been accepted.
    await processCallEnded(
      await admin(),
      ORG_ID,
      emailCall("cccccccc-1111-4111-8111-cccccccccccc", {
        transcript: T("AI: And your email?", "User: michael ryan at hotmail."),
        summary: "Caller gave an email. Email: michaelryan@hotmail.com.",
        extracted: { name: "Michael", email: "michael ryan at hotmail" },
      })
    );

    const html = stubs.summaryHtml();
    assert.equal(
      detailsRow(html, "Email"),
      null,
      "no row is rendered when there is no canonical address"
    );
    assert.equal(
      stubs.inserts[0].email,
      null,
      "and nothing unusable was persisted — the row and the lead agree " +
        "about the absence, which is the point"
    );
  });

  test("C2. no email given at all renders no Email row", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      emailCall("cccccccc-2222-4222-8222-cccccccccccc", {
        transcript: T(
          "AI: How can I help?",
          "User: Burst pipe, it's urgent.",
          "AI: Can I take your name?",
          "User: Ernesto."
        ),
        summary: "Ernesto called with a burst pipe. Email: Not provided.",
        extracted: { email: null },
      })
    );

    assert.equal(detailsRow(stubs.summaryHtml(), "Email"), null);
  });

  test("C3. an unusable address never falls back to the caller's NAME row", async () => {
    // Guards against the fix being written as a fallback chain the way
    // the Caller row legitimately is (name -> phone). Email has no
    // acceptable substitute: the only correct rendering of "we do not
    // have one" is no row.
    await processCallEnded(
      await admin(),
      ORG_ID,
      emailCall("cccccccc-3333-4333-8333-cccccccccccc", {
        transcript: T("AI: And your email?", "User: I'd rather not give one."),
        summary: "Caller declined to give an email. Email: Not provided.",
        extracted: { email: "I'd rather not give one" },
      })
    );

    const html = stubs.summaryHtml();
    assert.equal(detailsRow(html, "Email"), null);
    assert.equal(
      detailsRow(html, "Caller"),
      "Ernesto",
      "the Caller row is unaffected"
    );
  });

  // ── D. the neighbouring guards are untouched ────────────────────

  test("D. PR #43 — a digit-suffixed email still cannot destroy the name", async () => {
    // The real 2026-09-02 call. Vapi had "Jason Test" right; Deepgram
    // rendered the isolated name turn as "JSON test". Replayed here to
    // prove the new Email row changed nothing about name resolution —
    // and that BOTH canonical values now reach the owner together.
    await processCallEnded(
      await admin(),
      ORG_ID,
      emailCall("dddddddd-1111-4111-8111-dddddddddddd", {
        transcript: T(
          "AI: May I have your name, please?",
          "User: JSON test.",
          "AI: Thanks, Jason. May I have your email address, please?",
          "User: Yeah. It's jason test 1 4 1 at g mail dot com."
        ),
        summary: "Jason Test called about a leaking radiator.",
        extracted: { name: "Jason Test", email: "jasontest141@gmail.com" },
      })
    );

    const html = stubs.summaryHtml();
    assert.equal(
      detailsRow(html, "Caller"),
      "Jason Test",
      "caller-name integrity is unchanged"
    );
    assert.equal(
      detailsRow(html, "Email"),
      "jasontest141@gmail.com",
      "and the canonical email is shown beside it"
    );
    assert.equal(stubs.inserts[0].name, "Jason Test");
    assert.equal(stubs.inserts[0].email, "jasontest141@gmail.com");
  });

  test("D2. PR #39 — a manufactured name is still rejected, email still kept", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      emailCall("dddddddd-2222-4222-8222-dddddddddddd", {
        transcript: T(
          "AI: How can I help?",
          "User: Burst pipe, it's urgent.",
          "AI: What is the best email to reach you on?",
          "User: james hartley at gmail dot com."
        ),
        summary: "Caller has a burst pipe.",
        extracted: { name: "James Hartley", email: "jameshartley@gmail.com" },
      })
    );

    const html = stubs.summaryHtml();
    assert.equal(
      detailsRow(html, "Caller"),
      "+353861234567",
      "the invented person is still refused"
    );
    assert.equal(
      detailsRow(html, "Email"),
      "jameshartley@gmail.com",
      "while the address itself — which was never in doubt — is shown"
    );
  });

  // ── E. the existing rows are unchanged ──────────────────────────

  test("E. the service address row is unaffected by the new row", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      emailCall("eeeeeeee-1111-4111-8111-eeeeeeeeeeee", {
        transcript: T(
          "AI: Can I take your name?",
          "User: Ernesto.",
          "AI: What's the address where the work is needed?",
          "User: 81 Oakland Drive.",
          "AI: And your email?",
          "User: ernesto at gmail dot com."
        ),
        summary: "Ernesto called. Address: 81 Oakland Drive. Email: ernesto@gmail.com.",
        extracted: { service_address: "81 Oakland Drive" },
      })
    );

    const html = stubs.summaryHtml();
    assert.equal(detailsRow(html, "Service address"), "81 Oakland Drive");
    assert.equal(detailsRow(html, "Email"), "ernesto@gmail.com");
    assert.equal(detailsRow(html, "Caller"), "Ernesto");
    assert.equal(detailsRow(html, "Caller ID"), "+353861234567");
  });

  test("E2. callback urgency and the caller ID rows still render", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      emailCall("eeeeeeee-2222-4222-8222-eeeeeeeeeeee", {
        transcript: T(
          "AI: Is there a particular day or time that would suit?",
          "User: As soon as possible. It's urgent.",
          "AI: And your email?",
          "User: ernesto at gmail dot com."
        ),
        summary: "Ernesto needs someone urgently.",
        extracted: { intent: "new_booking", urgent: true, preferred_datetime: null },
      })
    );

    const html = stubs.summaryHtml();
    assert.equal(
      detailsRow(html, "Callback urgency"),
      "Urgent — no specific day or time given",
      "PR #35's behaviour survives the change"
    );
    assert.equal(detailsRow(html, "Email"), "ernesto@gmail.com");
  });

  test("E3. markup in the extracted address never reaches the row", async () => {
    // detailsBlock interpolates raw, so the row is escaped like every
    // other caller-supplied value. That escape is defence in depth
    // rather than the primary control, and this test pins the reason:
    // the canonical value has already passed EMAIL_PATTERN, whose
    // character classes ([\w.+-] and [\w.-]) admit no <, >, &, " or ',
    // so no address that could inject can BE canonical in the first
    // place. The observable behaviour is refusal, not sanitising —
    // assert that, not a mangled value the pipeline cannot produce.
    await processCallEnded(
      await admin(),
      ORG_ID,
      emailCall("eeeeeeee-3333-4333-8333-eeeeeeeeeeee", {
        transcript: T("AI: Email?", "User: it's odd."),
        summary: "Caller gave an unusual address.",
        extracted: { email: '<img src=x onerror=alert(1)>@example.com' },
      })
    );

    const html = stubs.summaryHtml();
    assert.equal(
      detailsRow(html, "Email"),
      null,
      "a candidate carrying markup is refused outright, so no row is rendered"
    );
    assert.ok(
      !/<img src=x/.test(html),
      "and it reaches the email nowhere else either"
    );
  });
});
