// Regression: the calendar event lost a valid current service address
// on the existing-lead / UPDATE path.
//
// capturePartialLead has two calendar-settling call sites. The INSERT
// path passed the resolved current-call address (`serviceLocation`).
// The UPDATE path — the one a re-processed voice call takes — instead
// read `existing.metadata.service_address`.
//
// That expression could never return an address. LEAD_SELECT_COLUMNS
// does not select `metadata`, and all three layers of
// resolveExistingLead select exactly those columns, so
// `existing.metadata` was always undefined, the typeof test always
// false, and the location always null. A booking confirmed on this path
// reached the engineer's diary with nowhere to go, even when the caller
// had given a perfectly good address on that very call.
//
// It was NOT a stale-address leak: a prior investigation drove this
// path and proved the old address cannot reach the calendar, because
// there is nothing to read. The fix is a source correction, not an
// ordering one — and the stored address is deliberately NOT restored as
// a fallback, since a pass that resolves no address must send none.
//
//   CURRENT CALL → resolveServiceAddress → serviceLocation
//     → calendar location, persisted metadata, owner email, dashboard
//
// ── Why the stub projects `select=` ────────────────────────────────
// A lead stub that returns whole rows regardless of the requested
// columns hands this path a `metadata` object PostgREST would never
// have sent, and the dead expression then appears to work. The first
// attempt at this reproduction did exactly that and produced a
// confident false positive. The stub below honours `select=`, which is
// the only reason these assertions mean anything.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { encryptCredentials, loadKeyringFromEnv } from "@/lib/integrations/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { processCallEnded } from "@/lib/voice/calls";
import { capturePartialLead } from "@/lib/leadCapture";

const T = (...t) => t.join("\n");
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CALENDAR_ID = "owner@example.com";
const CONNECTION_ID = "33333333-3333-4333-8333-333333333333";
const RESOURCE_ID = "44444444-4444-4444-8444-444444444444";
const CALL_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

const OLD_ADDRESS = "81 Oakland Drive";
const APPOINTMENT_ISO = "2026-08-20T14:00:00.000Z";

const call = (id, { transcript, summary = "Summary.", extracted = {} }) => ({
  kind: "call-ended",
  provider: "vapi",
  dedupeKey: `vapi:calloc-${id}-${Math.random()}:end-of-call-report`,
  providerCallId: id,
  businessPhone: "+353212345678",
  callerPhone: "+353861234567",
  direction: "inbound",
  startedAt: "2026-08-17T10:00:00.000Z",
  endedAt: "2026-08-17T10:05:00.000Z",
  durationSeconds: 300,
  endedReason: "customer-ended-call",
  summary,
  transcript,
  recordingUrl: null,
  costUsd: null,
  costBreakdown: null,
  extracted: {
    intent: "new_booking",
    name: "Jason",
    email: "jason@example.com",
    phone: null,
    service: "Boiler service",
    preferred_datetime: "Thursday 20 August at 3 PM",
    service_address: null,
    urgent: false,
    ...extracted,
  },
});

function installStubs({ createStatus = 200 } = {}) {
  process.env.INTEGRATIONS_ENABLED = "true";
  process.env.CALENDAR_SYNC_ENABLED = "true";
  process.env.CALENDAR_AVAILABILITY_BLOCKING = "true";
  process.env.CALENDAR_EVENT_CREATION_ORG_IDS = ORG_ID;
  process.env.VOICE_CALENDAR_BOOKING_ENABLED = "true";
  process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "client-id";
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "client-secret";

  const credentials = encryptCredentials(
    {
      strategy: "oauth2",
      accessToken: "ya29.token",
      refreshToken: "1//refresh",
      expiresAtIso: "2099-01-01T00:00:00.000Z",
      scopes: "calendar",
    },
    loadKeyringFromEnv()
  );

  const realFetch = globalThis.fetch;
  const leads = new Map();
  const creates = [];
  const updates = [];
  const emails = [];
  const links = [];
  let seq = 0;
  const json = (b, s = 200) =>
    new Response(JSON.stringify(b), {
      status: s,
      headers: { "content-type": "application/json" },
    });

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    const h = new Headers(init.headers ?? {});
    const obj = (h.get("accept") ?? "").includes("pgrst.object");
    const body = init.body ? JSON.parse(init.body) : {};
    const q = new URL(url, "https://stub.supabase.co").searchParams;
    const eqOf = (k) => (q.get(k) ?? "").replace(/^eq\./, "");

    if (url.includes("api.resend.com")) {
      emails.push(body);
      return json({ id: "e1" });
    }
    // Both the transcript fallback and the datetime parser go here; a
    // fixed instant keeps the appointment time out of the assertions.
    if (url.includes("api.openai.com")) {
      return json({ choices: [{ message: { content: APPOINTMENT_ISO } }] });
    }
    if (url.includes("oauth2.googleapis.com") || url.includes("/token")) {
      return json({ access_token: "fresh", expires_in: 3600, scope: "calendar" });
    }
    if (url.includes("googleapis.com/calendar/v3/freeBusy")) {
      return json({ calendars: { [CALENDAR_ID]: { busy: [] } } });
    }
    if (url.includes("/calendar/v3/calendars/") && url.includes("/events")) {
      if (method === "PATCH") {
        updates.push({ url, body });
        return json({ id: "existing-event", etag: '"e2"' });
      }
      creates.push({ method, url, body });
      if (createStatus !== 200) return json({ error: { message: "boom" } }, createStatus);
      return json({ id: body.id ?? "evt-1", etag: '"e1"' });
    }
    if (url.includes("/rest/v1/integration_resources")) {
      const row = {
        id: RESOURCE_ID,
        connection_id: CONNECTION_ID,
        resource_type: "calendar",
        external_id: CALENDAR_ID,
        name: CALENDAR_ID,
        is_primary: true,
        sync_enabled: true,
        availability_enabled: true,
      };
      return obj ? json(row) : json([row]);
    }
    if (url.includes("/rest/v1/integration_connections")) {
      const row = {
        id: CONNECTION_ID,
        org_id: ORG_ID,
        provider: "google",
        capabilities: ["calendar"],
        auth_strategy: "oauth2",
        account_id: "acct",
        account_email: CALENDAR_ID,
        account_name: "Owner",
        status: "connected",
        last_error: null,
        token_expires_at: "2099-01-01T00:00:00.000Z",
        last_verified_at: null,
        created_at: "2026-08-01T00:00:00.000Z",
        credentials_encrypted: credentials,
      };
      return obj ? json(row) : json([row]);
    }
    if (url.includes("/rest/v1/integration_links")) {
      if (method === "POST") {
        links.push(body);
        return json([], 201);
      }
      if (method === "PATCH") return json([]);
      return obj ? json(links[0] ?? null) : json(links);
    }
    if (url.includes("/rest/v1/voice_calls")) {
      const r = { id: "call-row-1" };
      return obj ? json(r) : json([r]);
    }
    if (url.includes("/rest/v1/business_knowledge")) {
      return json([
        { id: "k1", category: "services", title: "Boiler service", content: "We service boilers." },
      ]);
    }
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
        max_concurrent_bookings: 5,
        timezone: "Europe/London",
      };
      return obj ? json(r) : json([r]);
    }
    if (url.includes("/rest/v1/conversations")) return obj ? json(null) : json([]);

    if (url.includes("/rest/v1/leads")) {
      if (method === "HEAD") {
        return new Response(null, { status: 200, headers: { "content-range": "*/0" } });
      }
      if (method === "POST") {
        const id = `lead-${++seq}`;
        const stored = { id, metadata: null, appointment_datetime: null, source: "voice", ...body };
        leads.set(id, stored);
        return obj ? json({ id }) : json([{ id }]);
      }
      if (method === "PATCH") {
        const row = leads.get(eqOf("id"));
        if (row) Object.assign(row, body);
        return json([]);
      }
      // PostgREST returns ONLY the selected columns. Honouring that is
      // the whole point: the defect was a read of a column this path
      // never asks for.
      const project = (row) => {
        if (!row) return null;
        const sel = (q.get("select") ?? "*").trim();
        if (sel === "*" || sel === "") return row;
        const out = {};
        for (const c of sel.split(",").map((x) => x.trim()).filter(Boolean)) {
          out[c] = row[c] === undefined ? null : row[c];
        }
        return out;
      };
      if (q.has("id")) {
        const row = project(leads.get(eqOf("id")) ?? null);
        return obj ? json(row) : json(row ? [row] : []);
      }
      if (q.has("conversation_id")) {
        const cid = eqOf("conversation_id");
        const row = project([...leads.values()].find((l) => l.conversation_id === cid) ?? null);
        return obj ? json(row) : json(row ? [row] : []);
      }
      return obj ? json(null) : json([]);
    }
    if (url.includes("/rest/v1/voice_events")) return json([{ id: "evt-1" }]);
    throw new Error(`Unstubbed fetch in test: ${method} ${url}`);
  };

  return {
    leads,
    creates,
    updates,
    emails,
    links,
    all() {
      return [...leads.values()];
    },
    only() {
      const rows = [...leads.values()];
      assert.equal(rows.length, 1, "expected exactly one lead row");
      return rows[0];
    },
    /** Event-create bodies, which is where `location` lands. */
    createBodies() {
      return creates.map((c) => c.body);
    },
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

const admin = () => createAdminClient();

/**
 * Drives the UPDATE path for real.
 *
 * Pass 1's calendar create is refused, so the lead settles to
 * needs_review rather than "booked". backsWithCalendar then permits a
 * settle on the re-processed call, which is the only way the
 * UPDATE-branch location expression is ever evaluated. Returns the
 * event-create bodies produced by pass 2 alone.
 */
async function reprocess({ firstAddress = OLD_ADDRESS, second }) {
  let stubs = installStubs({ createStatus: 500 });
  try {
    const a = admin();
    await processCallEnded(
      a,
      ORG_ID,
      call(CALL_ID, {
        transcript: T(
          "AI: How can I help?",
          "User: I need a boiler service.",
          "AI: What's the address where the work is needed?",
          `User: ${firstAddress}.`,
          "AI: When suits?",
          "User: Thursday 20 August at 3 PM."
        ),
        extracted: { service_address: firstAddress },
      })
    );

    const firstStatus = stubs.only().status;
    const storedBefore = stubs.only().metadata?.service_address;
    const carried = new Map(stubs.leads);
    stubs.restore();

    // Same lead row, now with a calendar that accepts the write.
    stubs = installStubs({ createStatus: 200 });
    for (const [k, v] of carried) stubs.leads.set(k, v);

    await processCallEnded(a, ORG_ID, call(CALL_ID, second));

    return {
      firstStatus,
      storedBefore,
      bodies: stubs.createBodies(),
      updates: stubs.updates,
      lead: stubs.only(),
      leadCount: stubs.all().length,
      links: stubs.links,
    };
  } finally {
    stubs.restore();
  }
}

describe("the calendar event takes the canonical current-call address", () => {
  // ── A + D. the current address is what the diary receives ───────

  test("A. UPDATE path with a valid current address sends that address", async () => {
    const r = await reprocess({
      second: {
        transcript: T(
          "AI: How can I help?",
          "User: I need a boiler service.",
          "AI: What's the address?",
          "User: 81 Oakland Drive.",
          "AI: When suits?",
          "User: Thursday 20 August at 3 PM."
        ),
        extracted: { service_address: OLD_ADDRESS },
      },
    });

    assert.equal(r.firstStatus, "needs_review", "pass 1 must NOT have booked");
    assert.equal(r.leadCount, 1, "the same lead row was reused");
    assert.equal(r.bodies.length, 1, "pass 2 created the event");
    assert.equal(r.bodies[0].location, OLD_ADDRESS);
  });

  test("D. a REPLACEMENT address wins over the one already stored", async () => {
    // The sharpest statement of the rule. The lead already holds
    // "81 Oakland Drive"; this call resolved somewhere else entirely.
    const r = await reprocess({
      second: {
        transcript: T(
          "AI: How can I help?",
          "User: I need a boiler service.",
          "AI: What's the address?",
          "User: 12 Meadow Court, Galway.",
          "AI: When suits?",
          "User: Thursday 20 August at 3 PM."
        ),
        extracted: { service_address: "12 Meadow Court, Galway" },
      },
    });

    assert.equal(r.storedBefore, OLD_ADDRESS, "the old address really was stored");
    assert.equal(
      r.bodies[0].location,
      "12 Meadow Court, Galway",
      "the diary gets the address of THIS call"
    );
    assert.equal(
      r.lead.metadata?.service_address,
      "12 Meadow Court, Galway",
      "and the lead agrees with it — one value, many renderings"
    );
  });

  // ── B + C. absence stays absence ────────────────────────────────

  test("B. an address REJECTED by PR #42 sends no location", async () => {
    // The real 2026-09-01 transcription noise addressIntegrity refuses.
    const r = await reprocess({
      second: {
        transcript: T(
          "AI: How can I help?",
          "User: I need a boiler service.",
          "AI: What's the address?",
          "User: A c 1 Oakland Drive.",
          "AI: When suits?",
          "User: Thursday 20 August at 3 PM."
        ),
        extracted: { service_address: "A c 1 Oakland Drive" },
      },
    });

    assert.equal(r.bodies[0].location, undefined, "no location is sent");
    assert.ok(
      !JSON.stringify(r.bodies[0]).includes(OLD_ADDRESS),
      "the previously stored address is NOT resurrected"
    );
    assert.ok(
      !JSON.stringify(r.bodies[0]).includes("A c 1"),
      "and the refused value never reaches the calendar either"
    );
  });

  test("C. no address on this call sends no location", async () => {
    const r = await reprocess({
      second: {
        transcript: T("AI: How can I help?", "User: I need a boiler service.", "AI: When suits?", "User: Thursday 20 August at 3 PM."),
        extracted: { service_address: null },
      },
    });

    assert.equal(r.bodies[0].location, undefined);
    assert.ok(
      !JSON.stringify(r.bodies[0]).includes(OLD_ADDRESS),
      "the previously stored address is NOT resurrected"
    );
    assert.equal(
      r.lead.metadata?.service_address,
      undefined,
      "PR #46's clearing still applies, so the two agree about the absence"
    );
  });

  // ── E. the UI/format neutrality of the change ───────────────────

  test("E. legitimate address formats pass through unchanged", async () => {
    for (const address of [
      "81 Oakland Drive",
      "81A Oakland Drive",
      "Apt 4B, Oakland Court",
      "Unit 3A Blackrock Business Park",
      "Rose Cottage, Oakland Drive",
      "12 Meadow Court, Galway",
    ]) {
      const r = await reprocess({
        second: {
          transcript: T(
            "AI: How can I help?",
            "User: I need a boiler service.",
            "AI: What's the address?",
            `User: ${address}.`,
            "AI: When suits?",
            "User: Thursday 20 August at 3 PM."
          ),
          extracted: { service_address: address },
        },
      });
      assert.equal(r.bodies[0].location, address, `sent unchanged: ${address}`);
    }
  });

  // ── F + G. the other callers are untouched ──────────────────────

  test("F. the INSERT path still uses the canonical serviceLocation", async () => {
    const stubs = installStubs();
    try {
      await processCallEnded(
        admin(),
        ORG_ID,
        call("bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", {
          transcript: T(
            "AI: How can I help?",
            "User: I need a boiler service.",
            "AI: What's the address?",
            "User: 81 Oakland Drive.",
            "AI: When suits?",
            "User: Thursday 20 August at 3 PM."
          ),
          extracted: { service_address: OLD_ADDRESS },
        })
      );
      assert.equal(stubs.createBodies()[0].location, OLD_ADDRESS);
      assert.equal(stubs.only().status, "booked", "and it booked, as before");
    } finally {
      stubs.restore();
    }
  });

  test("G. a caller that supplies no serviceLocation still sends none", async () => {
    // Chat and the widget pass nothing for this parameter. Their event
    // must carry the literal absence it always has.
    const stubs = installStubs();
    try {
      await capturePartialLead(
        admin(),
        ORG_ID,
        "cccccccc-3333-4333-8333-cccccccccccc",
        "I'd like to book a boiler service for Thursday 20 August at 3 PM",
        {
          intent: "new_booking",
          name: "Dana",
          email: "dana@example.com",
          phone: "+353861111111",
          service: "Boiler service",
          preferred_datetime: "Thursday 20 August at 3 PM",
          confidence: 0.9,
        },
        "chat"
        // no needsReview, no transcript, and NO serviceLocation
      );

      assert.equal(stubs.createBodies().length, 1, "an event was created");
      assert.equal(
        stubs.createBodies()[0].location,
        undefined,
        "chat behaviour is byte-identical to before"
      );
    } finally {
      stubs.restore();
    }
  });

  // ── H. identity does not move with the location ─────────────────

  test("H. the event id is identical with and without a location", async () => {
    // The id derives from buildAppointmentIdempotencyKey(leadId, startIso)
    // and has no location component, so adding one cannot create a
    // second event or defeat duplicate prevention. Both runs use the
    // same lead id and the same instant.
    const withAddress = await reprocess({
      second: {
        transcript: T(
          "AI: How can I help?",
          "User: I need a boiler service.",
          "AI: What's the address?",
          "User: 81 Oakland Drive.",
          "AI: When suits?",
          "User: Thursday 20 August at 3 PM."
        ),
        extracted: { service_address: OLD_ADDRESS },
      },
    });
    const without = await reprocess({
      second: {
        transcript: T("AI: How can I help?", "User: I need a boiler service.", "AI: When suits?", "User: Thursday 20 August at 3 PM."),
        extracted: { service_address: null },
      },
    });

    assert.equal(withAddress.bodies[0].location, OLD_ADDRESS);
    assert.equal(without.bodies[0].location, undefined);
    assert.equal(
      withAddress.bodies[0].id,
      without.bodies[0].id,
      "same lead and same instant — same event id, location or not"
    );
    assert.ok(withAddress.bodies[0].id, "and it is a real id, not undefined");
  });

  // ── I + J. nothing else about the booking moved ─────────────────

  test("I. booking status and confirmation are unaffected", async () => {
    const withAddress = await reprocess({
      second: {
        transcript: T(
          "AI: How can I help?",
          "User: I need a boiler service.",
          "AI: What's the address?",
          "User: 81 Oakland Drive.",
          "AI: When suits?",
          "User: Thursday 20 August at 3 PM."
        ),
        extracted: { service_address: OLD_ADDRESS },
      },
    });
    const without = await reprocess({
      second: {
        transcript: T("AI: How can I help?", "User: I need a boiler service.", "AI: When suits?", "User: Thursday 20 August at 3 PM."),
        extracted: { service_address: null },
      },
    });

    assert.equal(withAddress.lead.status, "booked");
    assert.equal(
      without.lead.status,
      "booked",
      "a missing address must never change whether the booking succeeded"
    );
    assert.equal(withAddress.links.length, without.links.length);
  });

  test("J. start, end and timezone are identical either way", async () => {
    const withAddress = await reprocess({
      second: {
        transcript: T(
          "AI: How can I help?",
          "User: I need a boiler service.",
          "AI: What's the address?",
          "User: 81 Oakland Drive.",
          "AI: When suits?",
          "User: Thursday 20 August at 3 PM."
        ),
        extracted: { service_address: OLD_ADDRESS },
      },
    });
    const without = await reprocess({
      second: {
        transcript: T("AI: How can I help?", "User: I need a boiler service.", "AI: When suits?", "User: Thursday 20 August at 3 PM."),
        extracted: { service_address: null },
      },
    });

    assert.deepEqual(withAddress.bodies[0].start, without.bodies[0].start);
    assert.deepEqual(withAddress.bodies[0].end, without.bodies[0].end);
    assert.equal(withAddress.bodies[0].start.timeZone, "Europe/London");
    assert.equal(withAddress.lead.appointment_datetime, without.lead.appointment_datetime);
  });
});
