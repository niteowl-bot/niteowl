// Regression: a per-call fact could outlive the call it belonged to.
//
// recordLeadCallDetails wrote its metadata keys only when the new value
// was truthy. It could therefore say "this call found an address" but
// never "this call found none", so a second write to the same lead row
// left the earlier value standing as though it belonged to the later
// call. The rule it broke:
//
//   A MISSING CURRENT FACT MUST NOT RESURRECT A PREVIOUS CALL'S FACT.
//
// ── How the row is actually reused, which is NOT what it looks like ─
//
// The obvious reading is "a repeat caller reuses their lead". That does
// not happen, and the tests below pin it: leadCapture's
// resolveExistingLead returns null outright for source "voice", so two
// calls from one handset get two SEPARATE leads. That isolation was
// added deliberately after a 2026-08 incident where one caller's lead
// absorbed another's details, and it means the cross-call vector is
// closed by design.
//
// The row is reused when the SAME call is processed twice. That is a
// designed path, not an edge case: processCallEnded THROWS when the
// owner's summary email fails, specifically to leave the event
// replayable, and that throw happens after recordLeadCallDetails has
// already written. replay.ts then re-runs the identical code path on
// the same stored payload — and where the provider returned no
// structured data, the extraction comes from the transcript fallback,
// a fresh model call that can legitimately resolve less than the first
// attempt did. First pass records an address, second pass resolves
// none, and the address stayed.
//
// These drive the REAL processCallEnded against a stateful lead store,
// so the row genuinely persists between the two processings.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { processCallEnded } from "@/lib/voice/calls";
import { EditPanel } from "@/app/(dashboard)/leads/LeadsTable";

const T = (...turns) => turns.join("\n");
const ORG_ID = "11111111-1111-4111-8111-111111111111";

const URGENCY = "Urgent — no specific day or time given";

const call = (id, { transcript, summary = "Call summary.", extracted = {} }) => ({
  kind: "call-ended",
  provider: "vapi",
  dedupeKey: `vapi:stale-${id}-${Math.random()}:end-of-call-report`,
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
    email: null,
    phone: null,
    service: "burst pipe",
    preferred_datetime: null,
    service_address: null,
    urgent: false,
    ...extracted,
  },
});

/**
 * A stateful lead store. The whole defect only exists across two writes
 * to one row, so a stub that returns a fresh `{}` for every metadata
 * read — as the other voice suites do — cannot see it at all.
 */
function installStubs() {
  const realFetch = globalThis.fetch;
  const leads = new Map();
  const emails = [];
  const leadPatches = [];
  let seq = 0;
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
    const q = new URL(url, "https://stub.supabase.co").searchParams;
    const eqOf = (k) => (q.get(k) ?? "").replace(/^eq\./, "");

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
        const id = `lead-${++seq}`;
        const stored = {
          id,
          metadata: null,
          appointment_datetime: null,
          notes: null,
          source: "voice",
          ...body,
        };
        leads.set(id, stored);
        return obj ? json({ id }) : json([{ id }]);
      }
      if (method === "PATCH") {
        const id = eqOf("id");
        leadPatches.push({ id, body });
        const row = leads.get(id);
        if (row) Object.assign(row, body);
        return json([]);
      }
      // GET
      if (q.has("id")) {
        const row = leads.get(eqOf("id")) ?? null;
        return obj ? json(row) : json(row ? [row] : []);
      }
      if (q.has("conversation_id")) {
        const cid = eqOf("conversation_id");
        const row =
          [...leads.values()].find((l) => l.conversation_id === cid) ?? null;
        return obj ? json(row) : json(row ? [row] : []);
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
    leads,
    emails,
    leadPatches,
    all() {
      return [...leads.values()];
    },
    /** The single lead, asserting there is exactly one. */
    only() {
      const rows = [...leads.values()];
      assert.equal(rows.length, 1, "expected exactly one lead row");
      return rows[0];
    },
    meta() {
      return this.only().metadata ?? {};
    },
    /** Metadata writes only — the ones this fix is about. */
    metadataPatches() {
      return leadPatches.filter((p) => "metadata" in p.body);
    },
    /** The most recent owner call-summary email. */
    summaryHtml() {
      const sent = [...emails]
        .reverse()
        .find((e) => String(e.html ?? "").includes("Caller ID"));
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

function detailsRow(html, label) {
  const m = html.match(
    new RegExp(`<td[^>]*>${label}</td><td[^>]*>([^<]*)</td>`)
  );
  return m ? m[1] : null;
}

/** Renders the real leads drawer for a stored lead row. */
function drawer(leadRow) {
  return renderToStaticMarkup(
    createElement(EditPanel, {
      lead: {
        id: leadRow.id,
        name: leadRow.name ?? null,
        phone: leadRow.phone ?? null,
        email: leadRow.email ?? null,
        service_needed: leadRow.service_needed ?? null,
        preferred_datetime: leadRow.preferred_datetime ?? null,
        appointment_datetime: leadRow.appointment_datetime ?? null,
        message: leadRow.message ?? null,
        source: leadRow.source ?? "voice",
        status: leadRow.status ?? "new",
        ai_confidence: leadRow.ai_confidence ?? null,
        notes: leadRow.notes ?? null,
        metadata: leadRow.metadata ?? null,
        created_at: leadRow.created_at ?? "2026-09-02T15:00:00.000Z",
      },
      timezone: "Europe/London",
      onClose: () => {},
      onUpdate: () => {},
    })
  );
}

const CALL_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

/** The first pass: an urgent call with an address. */
const firstPass = () =>
  call(CALL_ID, {
    transcript: T(
      "AI: How can I help?",
      "User: I have a burst pipe. As soon as possible, it's urgent.",
      "AI: What's the address where the work is needed?",
      "User: 81 Oakland Drive."
    ),
    summary: "Ernesto has a burst pipe. Address: 81 Oakland Drive.",
    extracted: { service_address: "81 Oakland Drive", urgent: true },
  });

describe("a per-call fact never outlives its call", () => {
  let stubs;
  beforeEach(() => {
    stubs = installStubs();
  });
  afterEach(() => stubs.restore());

  // ── The premise, pinned ─────────────────────────────────────────

  test("two DIFFERENT calls from one caller get two separate leads", async () => {
    // The cross-call vector is closed by design, not by this fix, and
    // this test exists so a later change to lead resolution cannot
    // silently open it. If this ever fails, the clearing below is doing
    // far more work than its comments claim.
    const a = await admin();
    await processCallEnded(a, ORG_ID, firstPass());
    await processCallEnded(
      a,
      ORG_ID,
      call("bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", {
        transcript: T("AI: How can I help?", "User: Just a question."),
      })
    );

    const rows = stubs.all();
    assert.equal(rows.length, 2, "a second call must not reuse the first lead");
    assert.equal(
      rows[1].metadata?.service_address,
      undefined,
      "and cannot inherit its address"
    );
    assert.equal(rows[1].metadata?.callback_urgency, undefined);
    assert.equal(
      rows[0].metadata?.service_address,
      "81 Oakland Drive",
      "while the first lead keeps its own"
    );
  });

  // ── A. the address does not survive a pass that found none ──────

  test("A. reprocessed call with no address — the old address is cleared", async () => {
    const a = await admin();
    await processCallEnded(a, ORG_ID, firstPass());
    assert.equal(stubs.meta().service_address, "81 Oakland Drive");

    await processCallEnded(
      a,
      ORG_ID,
      call(CALL_ID, {
        transcript: T("AI: How can I help?", "User: I have a burst pipe."),
        summary: "Ernesto has a burst pipe.",
      })
    );

    assert.equal(stubs.all().length, 1, "the same row was reused");
    assert.equal(
      stubs.meta().service_address,
      undefined,
      "a pass that resolved no address must not leave the old one standing"
    );
  });

  // ── B. a rejected address clears, and never becomes canonical ───

  test("B. an address REJECTED by PR #42 clears the old one and is not stored", async () => {
    const a = await admin();
    await processCallEnded(a, ORG_ID, firstPass());

    // "A c 1 Oakland Drive" is the real 2026-09-01 transcription noise
    // addressIntegrity.ts exists to refuse. It resolves to null, and
    // the transcript offers no better spoken candidate.
    await processCallEnded(
      a,
      ORG_ID,
      call(CALL_ID, {
        transcript: T(
          "AI: What's the address where the work is needed?",
          "User: A c 1 Oakland Drive."
        ),
        summary: "Ernesto has a burst pipe.",
        extracted: { service_address: "A c 1 Oakland Drive" },
      })
    );

    const meta = stubs.meta();
    assert.equal(
      meta.service_address,
      undefined,
      "the refused value clears the old address rather than preserving it"
    );
    assert.ok(
      !JSON.stringify(meta).includes("A c 1"),
      "and the rejected raw address is never written"
    );
    assert.ok(
      !JSON.stringify(meta).includes("81 Oakland"),
      "no guessed or resurrected address takes its place"
    );
  });

  // ── C. urgency does not survive a call that was not urgent ──────

  test("C. a later non-urgent pass clears the earlier urgency", async () => {
    const a = await admin();
    await processCallEnded(a, ORG_ID, firstPass());
    assert.equal(stubs.meta().callback_urgency, URGENCY);

    await processCallEnded(
      a,
      ORG_ID,
      call(CALL_ID, {
        transcript: T("AI: How can I help?", "User: Just a general question."),
        summary: "Ernesto asked a general question.",
        extracted: { urgent: false },
      })
    );

    assert.equal(
      stubs.meta().callback_urgency,
      undefined,
      "PR #35's urgency must not be reported against a call that had none"
    );
  });

  test("C2. no urgency is fabricated from absence", async () => {
    const a = await admin();
    await processCallEnded(
      a,
      ORG_ID,
      call(CALL_ID, {
        transcript: T("AI: How can I help?", "User: Just a question."),
      })
    );
    assert.equal(stubs.meta().callback_urgency, undefined);
  });

  // ── D + E. real values still replace and still persist ──────────

  test("D. a later pass with its own values replaces the earlier ones", async () => {
    const a = await admin();
    await processCallEnded(a, ORG_ID, firstPass());

    await processCallEnded(
      a,
      ORG_ID,
      call(CALL_ID, {
        transcript: T(
          "AI: What's the address?",
          "User: 12 Meadow Court, Galway.",
          "AI: When suits?",
          "User: As soon as possible, it's urgent."
        ),
        summary: "Ernesto needs someone urgently at 12 Meadow Court.",
        extracted: { service_address: "12 Meadow Court, Galway", urgent: true },
      })
    );

    const meta = stubs.meta();
    assert.equal(meta.service_address, "12 Meadow Court, Galway");
    assert.equal(meta.callback_urgency, URGENCY);
    assert.equal(meta.caller_id, "+353861234567");
  });

  test("E. a legitimate current address is untouched by the clearing", async () => {
    const a = await admin();
    await processCallEnded(a, ORG_ID, firstPass());
    assert.equal(stubs.meta().service_address, "81 Oakland Drive");
    assert.equal(stubs.meta().callback_urgency, URGENCY);
    assert.equal(stubs.meta().caller_id, "+353861234567");
  });

  test("E2. an alternate number behaves the same way in both directions", async () => {
    const a = await admin();
    await processCallEnded(
      a,
      ORG_ID,
      call(CALL_ID, {
        transcript: T("AI: Best number?", "User: Try the office, 01 765 4321."),
        extracted: { phone: "017654321" },
      })
    );
    assert.equal(stubs.meta().alternate_phone, "017654321");

    await processCallEnded(
      a,
      ORG_ID,
      call(CALL_ID, {
        transcript: T("AI: How can I help?", "User: Just a question."),
      })
    );
    assert.equal(
      stubs.meta().alternate_phone,
      undefined,
      "a pass where no second number was given clears the old one"
    );
  });

  // ── F. persistent facts are NOT per-call and must survive ───────

  test("F. keys this function does not own are preserved through a clear", async () => {
    const a = await admin();
    await processCallEnded(a, ORG_ID, firstPass());

    // Written by leadCapture's needs-review notifier, not by the voice
    // metadata writer. It means "the owner has already been told",
    // which stays true forever — clearing it would send a duplicate.
    const row = stubs.only();
    row.metadata = {
      ...row.metadata,
      needs_review_notification_sent: true,
      needs_review_notified_conversation_id: CALL_ID,
      some_future_key: "keep me",
    };

    await processCallEnded(
      a,
      ORG_ID,
      call(CALL_ID, {
        transcript: T("AI: How can I help?", "User: Just a question."),
      })
    );

    const meta = stubs.meta();
    assert.equal(meta.needs_review_notification_sent, true);
    assert.equal(meta.needs_review_notified_conversation_id, CALL_ID);
    assert.equal(meta.some_future_key, "keep me");
    assert.equal(meta.service_address, undefined, "while the per-call fact went");
  });

  test("F2. appointment_request is deliberately NOT cleared", async () => {
    // The one exception, and it is a capacity marker rather than a
    // reported fact. Leaving it set slightly over-counts capacity;
    // wrongly clearing it frees a slot the lead really holds and
    // invites a double booking. Pinned so the asymmetry is a decision
    // rather than an oversight.
    const a = await admin();
    await processCallEnded(a, ORG_ID, firstPass());

    const row = stubs.only();
    row.metadata = { ...row.metadata, appointment_request: true };

    await processCallEnded(
      a,
      ORG_ID,
      call(CALL_ID, {
        transcript: T("AI: How can I help?", "User: Just a question."),
      })
    );

    assert.equal(
      stubs.meta().appointment_request,
      true,
      "the capacity marker survives a non-appointment pass"
    );
  });

  // ── G. timing semantics stay as PR #35 left them ────────────────

  test("G. a real callback time on the later pass leaves no urgency behind", async () => {
    // PR #35's rule: a real timing wins outright, and urgency is never
    // shown beside a field that means WHEN. Across two passes that only
    // holds if the earlier urgency is cleared.
    const a = await admin();
    await processCallEnded(a, ORG_ID, firstPass());
    assert.equal(stubs.meta().callback_urgency, URGENCY);

    await processCallEnded(
      a,
      ORG_ID,
      call(CALL_ID, {
        transcript: T(
          "AI: Is there a day or time that would suit?",
          "User: Thursday at 2pm."
        ),
        summary: "Ernesto asked for Thursday at 2pm.",
        extracted: { preferred_datetime: "Thursday at 2pm" },
      })
    );

    const row = stubs.only();
    assert.equal(
      row.metadata?.callback_urgency,
      undefined,
      "urgency must never sit beside a real requested time"
    );
    assert.equal(
      row.preferred_datetime,
      "Thursday at 2pm",
      "and the requested time itself is recorded as before"
    );
  });

  test("G2. urgency still reaches the owner when it IS this call's fact", async () => {
    const a = await admin();
    await processCallEnded(a, ORG_ID, firstPass());
    assert.equal(
      detailsRow(stubs.summaryHtml(), "Callback urgency"),
      URGENCY,
      "PR #35's behaviour is unchanged for a single call"
    );
  });

  // ── H. neither owner surface shows a stale fact ─────────────────

  test("H. the owner email of the later pass shows no stale address or urgency", async () => {
    const a = await admin();
    await processCallEnded(a, ORG_ID, firstPass());

    const first = stubs.summaryHtml();
    assert.equal(detailsRow(first, "Service address"), "81 Oakland Drive");

    await processCallEnded(
      a,
      ORG_ID,
      call(CALL_ID, {
        transcript: T("AI: How can I help?", "User: Just a general question."),
        summary: "Ernesto asked a general question.",
      })
    );

    const second = stubs.summaryHtml();
    assert.equal(
      detailsRow(second, "Service address"),
      null,
      "no Service address row on a pass that resolved none"
    );
    assert.equal(detailsRow(second, "Callback urgency"), null);
    assert.equal(
      detailsRow(second, "Caller ID"),
      "+353861234567",
      "the rows that are still true are unaffected"
    );
  });

  test("H2. the leads drawer shows no stale address after the later pass", async () => {
    const a = await admin();
    await processCallEnded(a, ORG_ID, firstPass());
    assert.ok(
      /81 Oakland Drive/.test(drawer(stubs.only())),
      "the address is shown while it is this lead's fact"
    );

    await processCallEnded(
      a,
      ORG_ID,
      call(CALL_ID, {
        transcript: T("AI: How can I help?", "User: Just a question."),
        summary: "Ernesto asked a question.",
      })
    );

    const html = drawer(stubs.only());
    assert.ok(
      !/Service address/.test(html),
      "and the row is gone once it is not"
    );
    assert.ok(
      !/Callback urgency/.test(html),
      "so is the urgency note"
    );
    assert.ok(/Caller ID/.test(html), "while the caller ID still renders");
  });

  // ── The write itself stays cheap ────────────────────────────────

  test("no metadata UPDATE is issued when nothing changed", async () => {
    // The old code returned early when every argument was falsey. That
    // shortcut had to go — a call with no address is exactly the one
    // that must clear a stale one — so the same saving is now made from
    // the row instead. Pinned, or the fix quietly doubles the writes.
    const a = await admin();
    await processCallEnded(a, ORG_ID, firstPass());
    const afterFirst = stubs.metadataPatches().length;

    // Identical payload: same values, nothing to add and nothing stale.
    await processCallEnded(a, ORG_ID, firstPass());

    assert.equal(
      stubs.metadataPatches().length,
      afterFirst,
      "a re-run that changes nothing must write nothing"
    );
    assert.equal(stubs.meta().service_address, "81 Oakland Drive");
    assert.equal(stubs.meta().callback_urgency, URGENCY);
  });

  test("a call with no details at all still issues no metadata write", async () => {
    const a = await admin();
    await processCallEnded(
      a,
      ORG_ID,
      call("dddddddd-4444-4444-8444-dddddddddddd", {
        transcript: T("AI: How can I help?", "User: Just a question."),
        extracted: { name: null },
      })
    );
    // caller_id is the one fact such a call still carries.
    assert.deepEqual(Object.keys(stubs.meta()), ["caller_id"]);
    assert.equal(stubs.metadataPatches().length, 1);
  });
});
