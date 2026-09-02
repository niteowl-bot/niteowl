// F4 Step 2: the last two facts the owner could only learn from prose.
//
// After PR #45 the owner email carried canonical rows for Caller, Caller
// ID, Email, alternate number, callback urgency and Service address. Two
// factual areas still had NO structured row at all:
//
//   * what the caller wants doing (the service), and
//   * when they want it.
//
// For those two the generated summary paragraph was the owner's ONLY
// source — the summary model's own reading of the call, answering to no
// guard, which the F4 investigation reproduced contradicting canonical
// values on name, email, address and callback timing. PR #48 stopped
// that paragraph being a fact SOURCE for the system; this stops it being
// the owner's only source of these two facts.
//
// ── The four scheduling states, kept apart ─────────────────────────
// The whole difficulty of the timing row is that "when" has four
// answers, and collapsing them would break booking truth:
//
//   1. BOOKED          -> the calendar accepted it. The resolved instant,
//                         formatted in the ORGANISATION's timezone.
//   2. TIME REQUESTED  -> a day or time was named, nothing is confirmed.
//                         The caller's own words, verbatim.
//   3. CALLBACK TIMING -> the same, for a caller who wanted a call back
//                         rather than a visit. Only the label differs.
//   4. URGENT, NO TIME -> no timing row at all. The existing "Callback
//                         urgency" row is the whole truth.
//
// The paragraph is deliberately left in place and still allowed to
// contradict — removing it is F4 Step 3. What must hold now is that the
// structured rows are right regardless of what it says.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { encryptCredentials, loadKeyringFromEnv } from "@/lib/integrations/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { processCallEnded } from "@/lib/voice/calls";

const T = (...t) => t.join("\n");
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CALENDAR_ID = "owner@example.com";
const CONNECTION_ID = "33333333-3333-4333-8333-333333333333";
const RESOURCE_ID = "44444444-4444-4444-8444-444444444444";

/** 14:00Z on Thursday 20 August 2026 — 15:00 in London and Dublin, 10:00 in New York. */
const APPOINTMENT_ISO = "2026-08-20T14:00:00.000Z";

/** A paragraph that contradicts every canonical value it can. */
const CONTRADICTING_SUMMARY = [
  "James Hartley called about a burst pipe.",
  "Name: James Hartley.",
  "Email: jameshartley@gmail.com.",
  "Appointment date: Friday 21 August. Appointment time: 9 AM.",
  "Address: A c 1 Oakland Drive.",
  "Issue: Emergency drain excavation.",
].join(" ");

const call = (id, { transcript, summary = CONTRADICTING_SUMMARY, extracted = {} }) => ({
  kind: "call-ended",
  provider: "vapi",
  dedupeKey: `vapi:f4s2-${id}-${Math.random()}:end-of-call-report`,
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
  extracted: extracted === null ? null : {
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

function installStubs({ timezone = "Europe/London", createStatus = 200 } = {}) {
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
    if (url.includes("api.openai.com")) {
      const prompt = body?.messages?.[0]?.content ?? "";
      // The lead extractor and the datetime parser share this endpoint.
      if (/JSON object/i.test(prompt)) return json({ choices: [{ message: { content: "{}" } }] });
      return json({ choices: [{ message: { content: APPOINTMENT_ISO } }] });
    }
    if (url.includes("oauth2.googleapis.com") || url.includes("/token")) {
      return json({ access_token: "fresh", expires_in: 3600, scope: "calendar" });
    }
    if (url.includes("googleapis.com/calendar/v3/freeBusy")) {
      return json({ calendars: { [CALENDAR_ID]: { busy: [] } } });
    }
    if (url.includes("/calendar/v3/calendars/") && url.includes("/events")) {
      if (method === "PATCH") return json({ id: "existing-event", etag: '"e2"' });
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
          open_time: "08:00",
          close_time: "20:00",
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
        timezone,
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
        leads.set(id, { id, metadata: null, appointment_datetime: null, source: "voice", ...body });
        return obj ? json({ id }) : json([{ id }]);
      }
      if (method === "PATCH") {
        const row = leads.get(eqOf("id"));
        if (row) Object.assign(row, body);
        return json([]);
      }
      // PostgREST returns only the selected columns; the Appointment row
      // depends on appointment_datetime being one of them.
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
    emails,
    all() {
      return [...leads.values()];
    },
    only() {
      const rows = [...leads.values()];
      assert.equal(rows.length, 1, "expected exactly one lead row");
      return rows[0];
    },
    html() {
      const s = [...emails].reverse().find((e) => String(e.html ?? "").includes("Caller ID"));
      return String(s?.html ?? "");
    },
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

const admin = () => createAdminClient();

const row = (html, label) => {
  const m = html.match(new RegExp(`<td[^>]*>${label}</td><td[^>]*>([^<]*)</td>`));
  return m ? m[1] : null;
};

describe("the owner reads every fact from a canonical row", () => {
  let stubs;
  afterEach(() => stubs?.restore());

  // ── A + B. Service ──────────────────────────────────────────────

  test("A. the canonical service appears as its own structured row", async () => {
    stubs = installStubs();
    await processCallEnded(
      admin(),
      ORG_ID,
      call("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", {
        transcript: T("AI: How can I help?", "User: Boiler service, Thursday 20 August at 3 PM."),
      })
    );

    assert.equal(row(stubs.html(), "Service needed"), "Boiler service");
    assert.equal(
      stubs.only().service_needed,
      "Boiler service",
      "and it is the same value the lead and the calendar carry"
    );
  });

  test("B+G. a contradicting paragraph cannot alter the Service row", async () => {
    stubs = installStubs();
    await processCallEnded(
      admin(),
      ORG_ID,
      call("bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", {
        transcript: T("AI: How can I help?", "User: Boiler service, Thursday 20 August at 3 PM."),
      })
    );

    const html = stubs.html();
    assert.equal(row(html, "Service needed"), "Boiler service");
    assert.ok(
      !/Emergency drain excavation/.test(row(html, "Service needed") ?? ""),
      "the paragraph's competing service never reaches the row"
    );
    assert.ok(
      /Emergency drain excavation/.test(html),
      "while the paragraph itself is deliberately UNCHANGED — removing it " +
        "is F4 Step 3, and this test would otherwise pass for the wrong reason"
    );
  });

  test("F. no service established renders no Service row", async () => {
    stubs = installStubs();
    await processCallEnded(
      admin(),
      ORG_ID,
      call("cccccccc-3333-4333-8333-cccccccccccc", {
        transcript: T("AI: How can I help?", "User: Just a question."),
        extracted: { intent: "question", service: null, preferred_datetime: null },
      })
    );
    assert.equal(row(stubs.html(), "Service needed"), null, "absence stays absence");
  });

  // ── C + D. a CONFIRMED appointment ──────────────────────────────

  test("C. a booked appointment shows the resolved instant", async () => {
    stubs = installStubs();
    await processCallEnded(
      admin(),
      ORG_ID,
      call("dddddddd-4444-4444-8444-dddddddddddd", {
        transcript: T("AI: When?", "User: Thursday 20 August at 3 PM."),
      })
    );

    const html = stubs.html();
    assert.equal(stubs.only().status, "booked", "the calendar accepted it");
    // 14:00Z in Europe/London is 15:00 BST.
    assert.equal(row(html, "Appointment"), "Thursday, 20 August 2026 at 15:00");
    assert.equal(
      row(html, "Requested appointment"),
      null,
      "the requested phrase is not ALSO shown — one row, one answer"
    );
    assert.equal(row(html, "Booking status"), "BOOKED");
  });

  test("D. the ORGANISATION's timezone is honoured, not the server's", async () => {
    stubs = installStubs({ timezone: "America/New_York" });
    await processCallEnded(
      admin(),
      ORG_ID,
      call("eeeeeeee-5555-4555-8555-eeeeeeeeeeee", {
        transcript: T("AI: When?", "User: Thursday 20 August at 3 PM."),
      })
    );

    // The same 14:00Z instant is 10:00 in New York (EDT, UTC-4) and
    // 15:00 in London. A row that ignored the org zone would say 15:00.
    assert.equal(row(stubs.html(), "Appointment"), "Thursday, 20 August 2026 at 10:00");
  });

  test("D2. a DST-shifted zone resolves through the same formatter", async () => {
    // 14:00Z on 20 August is 15:00 in Dublin — IST, i.e. UTC+1, which
    // only holds because the date falls inside summer time. A formatter
    // ignoring DST would render 14:00.
    stubs = installStubs({ timezone: "Europe/Dublin" });
    await processCallEnded(
      admin(),
      ORG_ID,
      call("ffffffff-6666-4666-8666-ffffffffffff", {
        transcript: T("AI: When?", "User: Thursday 20 August at 3 PM."),
      })
    );
    assert.equal(row(stubs.html(), "Appointment"), "Thursday, 20 August 2026 at 15:00");
  });

  // ── The requested-but-not-confirmed states ──────────────────────

  test("a time that was requested but NOT confirmed is labelled as requested", async () => {
    // The calendar refuses the write, so the lead settles to
    // needs_review. The owner must see what was asked for, never an
    // "Appointment" that would contradict the status block beneath it.
    stubs = installStubs({ createStatus: 500 });
    await processCallEnded(
      admin(),
      ORG_ID,
      call("11111111-7777-4777-8777-111111111111", {
        transcript: T("AI: When?", "User: Thursday 20 August at 3 PM."),
      })
    );

    const html = stubs.html();
    assert.equal(row(html, "Appointment"), null, "nothing is presented as confirmed");
    assert.equal(row(html, "Requested appointment"), "Thursday 20 August at 3 PM");
    assert.equal(row(html, "Booking status"), "REQUIRES REVIEW");
  });

  test("a vague requested time is shown verbatim, never sharpened", async () => {
    stubs = installStubs({ createStatus: 500 });
    await processCallEnded(
      admin(),
      ORG_ID,
      call("22222222-8888-4888-8888-222222222222", {
        transcript: T("AI: When?", "User: Sometime tomorrow afternoon."),
        extracted: { preferred_datetime: "tomorrow afternoon" },
      })
    );

    const html = stubs.html();
    assert.equal(row(html, "Requested appointment"), "tomorrow afternoon");
    assert.equal(row(html, "Appointment"), null);
  });

  test("a CALLBACK request is labelled a callback, not an appointment", async () => {
    stubs = installStubs();
    await processCallEnded(
      admin(),
      ORG_ID,
      call("33333333-9999-4999-8999-333333333333", {
        transcript: T("AI: When shall we ring you?", "User: Thursday after 5."),
        extracted: {
          intent: "question", // not an appointment request
          service: null,
          preferred_datetime: "Thursday after 5",
        },
      })
    );

    const html = stubs.html();
    assert.equal(row(html, "Requested callback"), "Thursday after 5");
    assert.equal(row(html, "Requested appointment"), null);
    assert.equal(row(html, "Appointment"), null);
  });

  // ── E. urgency is not a time ────────────────────────────────────

  test("E. urgent with no specific time invents no clock time", async () => {
    stubs = installStubs();
    await processCallEnded(
      admin(),
      ORG_ID,
      call("44444444-aaaa-4aaa-8aaa-444444444444", {
        transcript: T("AI: When suits?", "User: As soon as possible. It's urgent."),
        extracted: { urgent: true, preferred_datetime: null, service: "burst pipe" },
      })
    );

    const html = stubs.html();
    assert.equal(row(html, "Appointment"), null);
    assert.equal(row(html, "Requested appointment"), null);
    assert.equal(row(html, "Requested callback"), null);
    assert.equal(
      row(html, "Callback urgency"),
      "Urgent — no specific day or time given",
      "PR #35's row is the whole truth about timing here"
    );
    assert.ok(
      !/Appointment time: 9 AM/.test(row(html, "Requested appointment") ?? ""),
      "and the paragraph's invented clock time reaches no row"
    );
  });

  test("E2. urgency written into preferred_datetime still cannot become a time", async () => {
    // The disobedient-model shape: the phrase lands in the timing field.
    // sanitisePreferredDatetime recovers it as urgency, so the timing row
    // must stay empty.
    stubs = installStubs();
    await processCallEnded(
      admin(),
      ORG_ID,
      call("55555555-bbbb-4bbb-8bbb-555555555555", {
        transcript: T("AI: When suits?", "User: As soon as possible."),
        extracted: { urgent: false, preferred_datetime: "as soon as possible", service: "burst pipe" },
      })
    );

    const html = stubs.html();
    assert.equal(row(html, "Requested appointment"), null);
    assert.equal(row(html, "Requested callback"), null);
    assert.equal(row(html, "Callback urgency"), "as soon as possible");
  });

  // ── H + I + J. everything else is unchanged ─────────────────────

  test("H. the Caller, Email and Service address rows are unchanged", async () => {
    stubs = installStubs();
    await processCallEnded(
      admin(),
      ORG_ID,
      call("66666666-cccc-4ccc-8ccc-666666666666", {
        transcript: T(
          "AI: Can I take your name?",
          "User: Ernesto.",
          "AI: And your email?",
          "User: michael ryan at hotmail dot com.",
          "AI: Address?",
          "User: 81 Oakland Drive.",
          "AI: When?",
          "User: Thursday 20 August at 3 PM."
        ),
        extracted: {
          name: "Ernesto",
          email: "michael ryan at hotmail dot com",
          service_address: "81 Oakland Drive",
        },
      })
    );

    const html = stubs.html();
    assert.equal(row(html, "Caller"), "Ernesto", "PR #39/#43 hold");
    assert.equal(row(html, "Email"), "michaelryan@hotmail.com", "PR #45 holds");
    assert.equal(row(html, "Service address"), "81 Oakland Drive", "PR #42/#45 hold");
    assert.equal(row(html, "Caller ID"), "+353861234567");
    assert.equal(row(html, "Service needed"), "Boiler service", "and the new row sits beside them");
  });

  test("I. F4 Step 1 containment is intact — no lead from prose alone", async () => {
    stubs = installStubs();
    await processCallEnded(
      admin(),
      ORG_ID,
      call("77777777-dddd-4ddd-8ddd-777777777777", {
        transcript: null,
        extracted: null,
      })
    );

    assert.equal(stubs.all().length, 0, "the paragraph still manufactures nothing");
    const html = stubs.html();
    assert.equal(row(html, "Service needed"), null, "and claims no canonical service");
    assert.equal(row(html, "Appointment"), null);
    assert.equal(row(html, "Requested appointment"), null);
    assert.ok(/Emergency drain excavation/.test(html), "the narrative is still shown as context");
  });

  test("J. booking truth and the calendar are unchanged", async () => {
    stubs = installStubs();
    await processCallEnded(
      admin(),
      ORG_ID,
      call("88888888-eeee-4eee-8eee-888888888888", {
        transcript: T("AI: Address?", "User: 81 Oakland Drive.", "AI: When?", "User: Thursday 20 August at 3 PM."),
        extracted: { service_address: "81 Oakland Drive" },
      })
    );

    const lead = stubs.only();
    assert.equal(lead.status, "booked");
    assert.equal(lead.appointment_datetime, APPOINTMENT_ISO, "the stored instant is unchanged");
    assert.equal(
      row(stubs.html(), "Appointment"),
      "Thursday, 20 August 2026 at 15:00",
      "and the row renders that same instant"
    );
    assert.equal(row(stubs.html(), "Booking status"), "BOOKED");
  });
});
