// F5 — a service the caller never asked for must never become canonical.
//
// `service` was the last caller-supplied voice field with no
// deterministic backstop, and the failure it admits is a different
// shape from the four already guarded. Name was corrupted by an
// adjacent field, address by the transcriber, timing by the wrong kind
// of value. Here the model is ASKED FOR A LABEL and returns one, and
// nothing checked that the label came from the caller.
//
// The 2026-09-03 production call was correct — caller "I have a leaking
// radiator", canonical "leaking radiator" — but by model obedience, not
// enforcement. Had the extractor answered "radiator repair", "heating
// service" or "boiler repair", every surface would have taken it: the
// lead, the owner's email, the Knowledge Base gate, the calendar title,
// and the confirmation email the CUSTOMER reads.
//
// The invariant under test, in one line:
//   every word of the canonical service was spoken by the CALLER, on
//   this call, and not under a negation.
//
// CONSTRAIN-ONLY. The result is always a subsequence of the model's own
// candidate, so the guard can never invent a service and can never
// resurrect one the caller superseded. The cases that would make this
// fix worse than the bug — a legitimate reordering, a caller's own
// "no hot water", a genuine morphological variant — are pinned hardest.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  callerSupportedStems,
  resolveRequestedService,
} from "@/lib/voice/serviceIntegrity";
import { processCallEnded } from "@/lib/voice/calls";

const T = (...turns) => turns.join("\n");

// ── The deterministic helper ───────────────────────────────────────

describe("caller evidence is the caller's turns, and only those", () => {
  test("an assistant turn is never caller evidence", () => {
    const stems = callerSupportedStems(
      T("AI: We do emergency plumbing and boiler repair.", "User: My radiator is leaking.")
    );
    assert.ok(stems.has("radiator"));
    assert.ok(stems.has("leak"), "leaking and leak are the same word (PR #28 morphology)");
    assert.ok(!stems.has("plumb"), "the assistant said plumbing, not the caller");
    assert.ok(!stems.has("boiler"), "the assistant said boiler, not the caller");
  });

  test("a negated clause supplies no evidence", () => {
    const stems = callerSupportedStems(
      T("User: It's not the boiler, it's the radiator.")
    );
    assert.ok(stems.has("radiator"));
    assert.ok(!stems.has("boiler"), "the caller said the boiler is NOT the problem");
  });

  test("negation reaches to the end of its clause and no further", () => {
    const stems = callerSupportedStems(T("User: I don't need a plumber. My tap is leaking."));
    assert.ok(!stems.has("plumb"), "the negated clause supplies nothing");
    assert.ok(stems.has("tap"), "the NEXT clause is positive again");
    assert.ok(stems.has("leak"));
  });

  test("bare 'no' is NOT a negation — 'no hot water' is a real complaint", () => {
    const stems = callerSupportedStems(T("User: I have no hot water."));
    assert.ok(stems.has("hot"));
    assert.ok(stems.has("water"));
    assert.ok(stems.has("no"), "the caller's own word survives as their own word");
  });

  test("no transcript yields no evidence at all", () => {
    assert.equal(callerSupportedStems(null).size, 0);
    assert.equal(callerSupportedStems("   ").size, 0);
  });
});

describe("resolveRequestedService — keep, reduce, or refuse", () => {
  const CALLER_RADIATOR = T(
    "AI: How can I help?",
    "User: My radiator is leaking.",
    "AI: I'm sorry to hear that."
  );

  // A. verbatim
  test("A. the caller's own wording survives byte for byte", () => {
    assert.equal(
      resolveRequestedService(
        "leaking radiator",
        T("AI: How can I help?", "User: I have a leaking radiator.")
      ),
      "leaking radiator"
    );
  });

  // B. legitimate reordering and morphology
  test("B. reordering and morphology survive — this is not a substring check", () => {
    assert.equal(
      resolveRequestedService("leaking radiator", CALLER_RADIATOR),
      "leaking radiator"
    );
    assert.equal(
      resolveRequestedService("radiator leak", CALLER_RADIATOR),
      "radiator leak"
    );
  });

  test("B2. a past-participle variant still counts as the same word", () => {
    assert.equal(
      resolveRequestedService(
        "boiler repair",
        T("User: My boiler needs repaired.")
      ),
      "boiler repair"
    );
  });

  // C. invented label
  test("C. an invented label is reduced to the caller's own words", () => {
    assert.equal(
      resolveRequestedService("radiator repair", CALLER_RADIATOR),
      "radiator",
      "the caller never said repair"
    );
  });

  test("C2. a wholly unsupported label is refused outright", () => {
    for (const invented of [
      "boiler repair",
      "plumbing repair",
      "heating service",
      "emergency plumbing",
    ]) {
      assert.equal(
        resolveRequestedService(invented, CALLER_RADIATOR),
        null,
        `${invented} was never spoken by this caller`
      );
    }
  });

  // D + E. assistant and Knowledge Base terminology
  test("D+E. business vocabulary the assistant spoke cannot become the service", () => {
    assert.equal(
      resolveRequestedService(
        "emergency plumbing",
        T(
          "AI: We offer emergency plumbing, boiler repair and heating service.",
          "User: Something is wrong with my radiator."
        )
      ),
      null
    );
  });

  // F. nothing given
  test("F. no candidate stays no candidate — never invented", () => {
    assert.equal(resolveRequestedService(null, CALLER_RADIATOR), null);
    assert.equal(resolveRequestedService("   ", CALLER_RADIATOR), null);
    assert.equal(resolveRequestedService(null, null), null);
  });

  // G. vague
  test("G. a vague request must not be sharpened into a specific service", () => {
    const vague = T("AI: How can I help?", "User: I need someone to come out.");
    assert.equal(resolveRequestedService("emergency plumbing", vague), null);
    assert.equal(resolveRequestedService("boiler repair", vague), null);
  });

  // H. correction
  test("H. a corrected candidate survives, and the superseded one cannot return", () => {
    const corrected = T(
      "AI: What seems to be the problem?",
      "User: The boiler, I think.",
      "AI: Right, the boiler.",
      "User: Actually it's not the boiler, it's the radiator. It's leaking."
    );
    const resolved = resolveRequestedService("leaking radiator", corrected);
    assert.equal(resolved, "leaking radiator");
    assert.ok(!/boiler/i.test(resolved), "the superseded service is not resurrected");
  });

  test("H2. KNOWN LIMITATION, pinned deliberately — an un-negated earlier mention still counts", () => {
    // The caller said "the boiler" positively before replacing it
    // WITHOUT an explicit negation. The guard constrains PROVENANCE,
    // not correction ordering: "boiler" really was the caller's word,
    // so it survives while "repair" — which was nobody's — does not.
    //
    // Recorded rather than hidden. Fixing it would mean deciding which
    // of a caller's own utterances supersede which, and that is the
    // classification engine this guard is explicitly not.
    assert.equal(
      resolveRequestedService(
        "boiler repair",
        T(
          "AI: What's the problem?",
          "User: The boiler.",
          "AI: Anything else?",
          "User: Sorry, I meant the radiator."
        )
      ),
      "boiler"
    );
  });

  // I. negation
  test("I. a negated mention is not support, however plainly the word appears", () => {
    assert.equal(
      resolveRequestedService(
        "boiler repair",
        T("AI: What's wrong?", "User: It's not the boiler, it's the radiator.")
      ),
      null
    );
    assert.equal(
      resolveRequestedService(
        "plumbing",
        T("User: I don't need a plumber, I need an electrician.")
      ),
      null
    );
    assert.equal(
      resolveRequestedService(
        "heating",
        T("User: Not the heating, it's the tap.")
      ),
      null
    );
  });

  // J. several genuine issues
  test("J. several issues change nothing — one field, no invented merging", () => {
    const two = T("User: My radiator is leaking and the tap is dripping.");
    assert.equal(resolveRequestedService("leaking radiator", two), "leaking radiator");
    assert.equal(resolveRequestedService("dripping tap", two), "dripping tap");
  });

  // The evidence-absent posture, stated as a test so it cannot drift.
  test("with no transcript the candidate stands — absence of evidence is not evidence", () => {
    assert.equal(resolveRequestedService("boiler repair", null), "boiler repair");
    assert.equal(resolveRequestedService("boiler repair", "AI: Hello?"), "boiler repair");
  });

  test("the result is always a subsequence of the candidate — never a new word", () => {
    for (const [candidate, transcript] of [
      ["radiator repair", CALLER_RADIATOR],
      ["emergency boiler radiator", CALLER_RADIATOR],
      ["leaking radiator", CALLER_RADIATOR],
    ]) {
      const resolved = resolveRequestedService(candidate, transcript) ?? "";
      for (const word of resolved.split(/\s+/).filter(Boolean)) {
        assert.ok(
          candidate.includes(word),
          `${word} is not in the candidate — the guard invented it`
        );
      }
    }
  });
});

// ── The real path ──────────────────────────────────────────────────

const ORG_ID = "11111111-1111-4111-8111-111111111111";

const serviceCall = (id, transcript, extractedOver = {}) => ({
  kind: "call-ended",
  provider: "vapi",
  dedupeKey: `vapi:svc-${id}:end-of-call-report`,
  providerCallId: id,
  businessPhone: "+353212345678",
  callerPhone: "+353861234567",
  direction: "inbound",
  startedAt: "2026-09-03T15:00:00.000Z",
  endedAt: "2026-09-03T15:02:00.000Z",
  durationSeconds: 120,
  endedReason: "assistant-ended-call",
  summary: "Caller has a problem and would like someone to come out.",
  transcript,
  recordingUrl: null,
  costUsd: null,
  costBreakdown: null,
  extracted: {
    intent: "new_booking",
    name: "Jason Test",
    email: null,
    phone: null,
    service: "leaking radiator",
    preferred_datetime: null,
    service_address: null,
    urgent: false,
    ...extractedOver,
  },
});

function detailsRow(html, label) {
  const m = html.match(new RegExp(`<td[^>]*>${label}</td><td[^>]*>([^<]*)</td>`));
  return m ? m[1] : null;
}

function installStubs({ knowledge = [] } = {}) {
  const realFetch = globalThis.fetch;
  const inserts = [];
  const emails = [];
  const extractionPrompts = [];
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
      extractionPrompts.push(JSON.stringify(body));
      return json({ choices: [{ message: { content: "NONE" } }] });
    }
    if (url.includes("/rest/v1/voice_calls")) {
      const r = { id: "call-row-1" };
      return obj ? json(r) : json([r]);
    }
    if (url.includes("/rest/v1/business_knowledge")) return json(knowledge);
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
    extractionPrompts,
    /** What landed in leads.service_needed. */
    storedService() {
      return inserts.length ? inserts[inserts.length - 1].service_needed ?? null : null;
    },
    summaryHtml() {
      const sent = emails.find((e) => String(e.html ?? "").includes("Caller ID"));
      return String(sent?.html ?? "");
    },
    /** The owner's canonical Service needed row, or null when absent. */
    ownerServiceRow() {
      return detailsRow(this.summaryHtml(), "Service needed");
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

describe("the real path — one canonical service", () => {
  let stubs;
  beforeEach(() => {
    stubs = installStubs();
  });
  afterEach(() => stubs.restore());

  test("THE VERIFIED CALL — the 2026-09-03 service survives untouched", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      serviceCall(
        "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
        T(
          "AI: Thanks for calling Acme Plumbing. How can I help?",
          "User: I have a leaking radiator, and I need someone to come out.",
          "AI: Of course. Can I take your name?",
          "User: Jason Test."
        )
      )
    );

    assert.equal(stubs.storedService(), "leaking radiator");
    assert.equal(stubs.ownerServiceRow(), "leaking radiator");
  });

  test("AN INVENTED LABEL DOES NOT BECOME CANONICAL — the regression itself", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      serviceCall(
        "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
        T(
          "AI: How can I help?",
          "User: My radiator is leaking.",
          "AI: Can I take your name?",
          "User: Jason Test."
        ),
        { service: "boiler repair" }
      )
    );

    const stored = stubs.storedService();
    assert.ok(
      !/boiler/i.test(String(stored ?? "")),
      "a service the caller never said reached the lead"
    );
    assert.equal(stored, null, "nothing supported, so nothing is claimed");
    assert.equal(stubs.ownerServiceRow(), null, "absence renders as absence — no row");
  });

  test("a partly-invented label is reduced to the caller's own word", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      serviceCall(
        "cccccccc-3333-4333-8333-cccccccccccc",
        T("AI: How can I help?", "User: My radiator is leaking."),
        { service: "radiator repair" }
      )
    );

    assert.equal(stubs.storedService(), "radiator");
    assert.equal(stubs.ownerServiceRow(), "radiator");
  });

  test("the assistant's own vocabulary cannot establish the service", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      serviceCall(
        "dddddddd-4444-4444-8444-dddddddddddd",
        T(
          "AI: We handle emergency plumbing, boiler repair and heating service. What do you need?",
          "User: Something is wrong at the house. Can someone come out?"
        ),
        { service: "emergency plumbing" }
      ),
    );

    assert.equal(stubs.storedService(), null);
    assert.equal(stubs.ownerServiceRow(), null);
  });

  test("Knowledge Base terminology cannot manufacture the caller's service", async () => {
    stubs.restore();
    stubs = installStubs({
      knowledge: [
        { id: "k1", category: "services", title: "Emergency Plumbing Call-Out", content: "24/7" },
      ],
    });

    await processCallEnded(
      await admin(),
      ORG_ID,
      serviceCall(
        "eeeeeeee-5555-4555-8555-eeeeeeeeeeee",
        T("AI: How can I help?", "User: I need someone to come out today."),
        { service: "emergency plumbing call-out" }
      )
    );

    assert.equal(
      stubs.storedService(),
      null,
      "a KB-shaped label the caller never spoke must not be confirmed by the KB it came from"
    );
  });

  test("a negated service cannot be booked against — the transcript says the opposite", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      serviceCall(
        "ffffffff-6666-4666-8666-ffffffffffff",
        T(
          "AI: What's the problem?",
          "User: It's not the boiler, it's the radiator. It's leaking."
        ),
        { service: "boiler repair" }
      )
    );

    const stored = String(stubs.storedService() ?? "");
    assert.ok(!/boiler/i.test(stored), "the caller said it was NOT the boiler");
    assert.equal(stubs.storedService(), null);
  });

  test("the call is never lost — the owner is still emailed with the narrative", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      serviceCall(
        "99999999-7777-4777-8777-999999999999",
        T("AI: How can I help?", "User: I need someone to come out."),
        { service: "emergency plumbing" }
      )
    );

    const html = stubs.summaryHtml();
    assert.ok(html, "the owner was emailed");
    assert.ok(
      html.includes("would like someone to come out"),
      "the provider narrative is still there as review context"
    );
  });

  // ── Downstream agreement ─────────────────────────────────────────
  // The PR #39 lesson: guarding the lead while a surface read the raw
  // value was the original defect. Every consumer must read the same
  // resolved decision.
  test("DOWNSTREAM AGREEMENT — lead and owner row carry the same resolved value", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      serviceCall(
        "12121212-8888-4888-8888-121212121212",
        T("AI: How can I help?", "User: My radiator is leaking."),
        { service: "radiator repair" }
      )
    );

    const stored = stubs.storedService();
    const row = stubs.ownerServiceRow();

    assert.equal(stored, "radiator");
    assert.equal(row, stored, "the owner reads exactly what the lead carries");
    assert.ok(
      !/radiator repair/i.test(stubs.summaryHtml().replace(/Summary:[\s\S]*$/, "")),
      "the untrusted candidate does not survive anywhere in the canonical rows"
    );
  });
});
