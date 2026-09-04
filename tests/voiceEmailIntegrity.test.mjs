// Regression: a caller's email was lost when partial structuredData
// omitted it.
//
// `normaliseSpokenEmail` is a NORMALISER, null-in/null-out. So
// `normaliseSpokenEmail(details.email)` resolved to null whenever the
// provider omitted the field — on a call whose transcript plainly
// carried the address the caller had spelled out. The transcript
// reached toExtractedLead and was read there for the caller's name and
// their service address; email was the field with evidence available
// and no reader for it.
//
// Replayed through the real processCallEnded before the fix:
//
//   lead.email                : null
//   lead.status               : "booked"
//   calendar events created   : 1
//   owner email "Email" row   : null
//   any email TO the customer : none
//
// The booking completed and the customer was told nothing, because
// sendBookingConfirmationEmails is guarded by `if (customerEmail)` —
// the confirmation is not FAILED, it is never attempted.
//
// The rule under test, in one line:
//   the provider's value wins whenever it survives normalisation, and
//   only when nothing usable came from it is the caller's own speech
//   read — from an explicit email question or an explicit cue, never
//   from a span search and never from the assistant.
//
// WHY NOT A SPAN SEARCH. A greedy locator was prototyped during the
// investigation and manufactured well-formed but WRONG addresses in
// both directions: shortest-first turned "john dot smith at gmail dot
// com" into smith@gmail.com, longest-first absorbed surrounding speech
// into the local part. Those corruption cases are pinned below, because
// a wrong address here is deliverable — a stranger gets the
// confirmation and the real customer still hears nothing.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { findSpokenEmail, resolveCallerEmail } from "@/lib/voice/emailIntegrity";
import { encryptCredentials, loadKeyringFromEnv } from "@/lib/integrations/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { processCallEnded } from "@/lib/voice/calls";

const T = (...turns) => turns.join("\n");

/** The assistant asks for the email; the caller answers. */
const asked = (answer) =>
  T("AI: What's your email address?", `User: ${answer}`);

// ── POSITIVE: the caller supplied it, so it is recovered ────────────

describe("caller evidence — an answer to an explicit email question", () => {
  test("A — a literal address", () => {
    assert.equal(resolveCallerEmail(null, asked("john@example.com.")), "john@example.com");
  });

  test("B — spoken at/dot", () => {
    assert.equal(
      resolveCallerEmail(null, asked("john at example dot com.")),
      "john@example.com"
    );
  });

  test("C — a dotted local part is kept WHOLE", () => {
    // The exact shape the rejected shortest-first span search
    // truncated to smith@gmail.com.
    assert.equal(
      resolveCallerEmail(null, asked("john dot smith at gmail dot com.")),
      "john.smith@gmail.com"
    );
  });

  test("D — underscore and hyphen, where the normaliser already supports them", () => {
    assert.equal(
      resolveCallerEmail(null, asked("j underscore smith at outlook dot com.")),
      "j_smith@outlook.com"
    );
    assert.equal(
      resolveCallerEmail(null, asked("mary hyphen jane at outlook dot com.")),
      "mary-jane@outlook.com"
    );
  });

  test("E — a multi-part TLD", () => {
    assert.equal(
      resolveCallerEmail(null, asked("mary at yahoo dot co dot uk.")),
      "mary@yahoo.co.uk"
    );
  });

  test("G — the address inside a longer answer", () => {
    // The caller names themselves first. The clause boundary is the
    // caller's own comma, not a guessed span.
    assert.equal(
      resolveCallerEmail(null, asked("John Smith, john dot smith at example dot com.")),
      "john.smith@example.com"
    );
  });

  test("H — a leading answer prefix on a correction", () => {
    assert.equal(
      resolveCallerEmail(
        null,
        T("AI: Is your email jon@example.com?", "User: No, john at example dot com.")
      ),
      "john@example.com"
    );
  });

  test("H — the prefix is stripped even when the transcript has NO comma", () => {
    // Speech-to-text punctuation is unreliable, so the rejection word
    // often arrives fused to the address. Without the answer-prefix
    // strip this whole turn reads as an acknowledgement and the
    // correction is lost.
    assert.equal(
      resolveCallerEmail(
        null,
        T("AI: Is your email jon@example.com?", "User: No john at example dot com")
      ),
      "john@example.com"
    );
    assert.equal(
      resolveCallerEmail(null, asked("Sorry john dot smith at example dot com")),
      "john.smith@example.com"
    );
  });

  test("I — a trailing aside is ignored", () => {
    assert.equal(
      resolveCallerEmail(null, asked("john at example dot com, if that's easier.")),
      "john@example.com"
    );
  });

  test("'at sign' and 'point' still work through the locator", () => {
    assert.equal(
      resolveCallerEmail(null, asked("sam at sign gmail point com.")),
      "sam@gmail.com"
    );
  });
});

describe("caller evidence — an explicit self-declaration cue", () => {
  test("F — 'my email is …'", () => {
    assert.equal(
      resolveCallerEmail(
        null,
        T("AI: How can I help?", "User: My email is john at example dot com.")
      ),
      "john@example.com"
    );
  });

  test("F — 'my email address is …' and 'you can email me at …'", () => {
    assert.equal(
      resolveCallerEmail(
        null,
        T("AI: How can I help?", "User: My email address is john@example.com.")
      ),
      "john@example.com"
    );
    assert.equal(
      resolveCallerEmail(
        null,
        T("AI: How can I help?", "User: You can email me at john at example dot com.")
      ),
      "john@example.com"
    );
  });

  test("the cue is the LEFT BOUNDARY, so surrounding speech is not absorbed", () => {
    // Longest-first span search produced johnmyemailis@example.com on
    // exactly this shape.
    assert.equal(
      resolveCallerEmail(
        null,
        T(
          "AI: Can I take your details?",
          "User: My name is John and my email is john at example dot com."
        )
      ),
      "john@example.com"
    );
  });
});

describe("J — correction: the LAST reliable caller email wins", () => {
  test("across turns", () => {
    assert.equal(
      resolveCallerEmail(
        null,
        T(
          "AI: What's your email address?",
          "User: john at example dot com.",
          "AI: Got it. Anything else?",
          "User: Sorry, my email is john dot smith at example dot com."
        )
      ),
      "john.smith@example.com"
    );
  });

  test("within a single turn", () => {
    assert.equal(
      resolveCallerEmail(
        null,
        asked("john at example dot com, sorry, john dot smith at example dot com.")
      ),
      "john.smith@example.com"
    );
  });

  test("a superseded value is never resurrected", () => {
    const resolved = resolveCallerEmail(
      null,
      T(
        "AI: What's your email address?",
        "User: jon@example.com.",
        "AI: Thanks.",
        "User: My email is john@example.com."
      )
    );
    assert.equal(resolved, "john@example.com");
    assert.notEqual(resolved, "jon@example.com");
  });
});

// ── NEGATIVE: nothing reliable was supplied, so nothing is recorded ──

describe("negative safety — evidence that must NOT become an email", () => {
  test("L — the assistant says it and the caller only says yes", () => {
    // The assistant is the one party speaking a MODEL-GENERATED
    // address. Accepting a bare agreement would launder its own guess
    // into caller evidence — and if it mis-heard, the confirmation goes
    // to a stranger.
    for (const reply of ["Yes.", "Yeah.", "That's right.", "Correct.", "Perfect, thanks."]) {
      assert.equal(
        resolveCallerEmail(null, T("AI: Is your email john@example.com?", `User: ${reply}`)),
        null,
        reply
      );
    }
  });

  test("M — an address only the assistant ever says", () => {
    assert.equal(
      resolveCallerEmail(
        null,
        T("AI: I'll send it to john@example.com.", "User: Great, thanks.")
      ),
      null
    );
    assert.equal(
      findSpokenEmail(T("AI: Is your email john@example.com?", "User: Yes.")),
      null
    );
  });

  test("M — an assistant read-back phrased as a declaration is still not evidence", () => {
    // The dangerous shape: Remy's own read-back uses the very wording
    // the self-declaration cue recognises. Only the SPEAKER separates
    // it from the caller saying it, which is why caller-turn filtering
    // is the load-bearing rule and not a formality.
    assert.equal(
      resolveCallerEmail(
        null,
        T("AI: So the email address is john@example.com, is that right?", "User: Yes.")
      ),
      null
    );
    assert.equal(
      resolveCallerEmail(
        null,
        T(
          "AI: What's your email address?",
          "AI: I have the email address as john at example dot com.",
          "User: Yes, that's right."
        )
      ),
      null
    );
    assert.equal(
      findSpokenEmail(T("AI: My email is support@acme.com if you need it.", "User: Thanks.")),
      null
    );
  });

  test("N — an incomplete address is never completed", () => {
    assert.equal(resolveCallerEmail(null, asked("It's john at gmail...")), null);
    assert.equal(resolveCallerEmail(null, asked("john at example dot")), null);
    assert.equal(
      resolveCallerEmail(null, T("AI: How can I help?", "User: My email is john at gmail")),
      null
    );
  });

  test("O — ordinary speech containing at / dot / point", () => {
    const ordinary = [
      "I'm at the house on Oakland Drive, dot the i's on that.",
      "Pat at home is fine, call after six.",
      "Let's meet at four, at the shop on Mill Road.",
      "At this point I just need someone out.",
    ];
    for (const line of ordinary) {
      assert.equal(resolveCallerEmail(null, asked(line)), null, line);
      assert.equal(
        resolveCallerEmail(null, T("AI: Anything else?", `User: ${line}`)),
        null,
        line
      );
    }
  });

  test("P — the caller refuses or gives none", () => {
    assert.equal(resolveCallerEmail(null, asked("I'd rather not give it.")), null);
    assert.equal(resolveCallerEmail(null, asked("I don't have one.")), null);
  });

  test("Q — a name or address answer yields no email", () => {
    assert.equal(
      resolveCallerEmail(null, T("AI: May I have your name, please?", "User: Ernesto.")),
      null
    );
    assert.equal(
      resolveCallerEmail(
        null,
        T("AI: What's the address where the work is needed?", "User: 81 Oakland Drive.")
      ),
      null
    );
  });

  test("R — a free-floating address with no question or cue is NOT the caller's", () => {
    // The field means the caller's own email for this interaction, not
    // any address that happened to be uttered. Without the evidence
    // boundary this is exactly how a third party's address would be
    // recorded and then written to.
    assert.equal(
      resolveCallerEmail(
        null,
        T("AI: How can I help?", "User: My landlord is accounts@agency.com, he handles it.")
      ),
      null
    );
    assert.equal(
      resolveCallerEmail(null, T("AI: How can I help?", "User: john at example dot com")),
      null
    );
  });

  test("U — no structured email and no reliable evidence stays null", () => {
    assert.equal(resolveCallerEmail(null, null), null);
    assert.equal(resolveCallerEmail(null, ""), null);
    assert.equal(resolveCallerEmail(null, "AI: Hello."), null);
    assert.equal(resolveCallerEmail(undefined, undefined), null);
  });
});

// ── The rejected span search, pinned ────────────────────────────────

describe("the locator cannot manufacture an address", () => {
  test("it never truncates a local part — smith@gmail.com must not appear", () => {
    for (const spoken of [
      "john dot smith at gmail dot com",
      "mary dot jane dot smith at gmail dot com",
    ]) {
      const resolved = resolveCallerEmail(null, asked(`${spoken}.`));
      assert.ok(resolved, spoken);
      assert.ok(
        !/^smith@/.test(resolved),
        `a truncated local part must never be produced: ${resolved}`
      );
      assert.equal(resolved.split("@")[0].includes("smith"), true);
    }
  });

  test("it never absorbs surrounding speech into the local part", () => {
    const resolved = resolveCallerEmail(
      null,
      T("AI: Can I take your details?", "User: It's John, my email is john at example dot com.")
    );
    assert.equal(resolved, "john@example.com");
    assert.ok(!/myemail|itsjohn/i.test(resolved ?? ""));
  });

  test("a valid-looking address is never assembled from unrelated words", () => {
    // Every one of these contains the tokens a span search feeds on.
    for (const line of [
      "I'll be at my mother's, she lives at 12 Mill Road, dot com is fine",
      "call me at half past, dot the i's",
    ]) {
      assert.equal(resolveCallerEmail(null, asked(line)), null, line);
    }
  });
});

// ── Structured-email authority ──────────────────────────────────────

describe("the provider's value wins whenever it survives normalisation", () => {
  test("S — structured present and the transcript agrees", () => {
    assert.equal(
      resolveCallerEmail("john@example.com", asked("john at example dot com.")),
      "john@example.com"
    );
  });

  test("T — structured present and the transcript CONFLICTS: structured is preserved", () => {
    // Deliberately out of scope for this change. Unlike the service
    // address, there is no deterministic way to say which of two valid
    // addresses is wrong, and no corruption path has been demonstrated.
    // This is NOT "the transcript wins".
    assert.equal(
      resolveCallerEmail("jane@example.com", asked("john at example dot com.")),
      "jane@example.com"
    );
    assert.equal(
      resolveCallerEmail(
        "jane@example.com",
        T("AI: How can I help?", "User: My email is john@example.com.")
      ),
      "jane@example.com"
    );
  });

  test("a spoken structured value is still normalised, and still wins", () => {
    assert.equal(
      resolveCallerEmail("jane at example dot com", asked("john at example dot com.")),
      "jane@example.com"
    );
  });

  test("K — a structured value that normalises to null falls through to evidence", () => {
    // An absent field and an unusable one are the same absence after
    // normalisation, so they share one path rather than inventing a
    // separate authority class for malformed input.
    for (const malformed of ["not an email", "john at", "", "   ", "john@", "@example.com"]) {
      assert.equal(
        resolveCallerEmail(malformed, asked("john at example dot com.")),
        "john@example.com",
        malformed
      );
    }
  });

  test("malformed structured value with no evidence still records nothing", () => {
    assert.equal(resolveCallerEmail("not an email", "AI: Hello."), null);
  });
});

// ── The real path ───────────────────────────────────────────────────
// The proven scenario: partial structuredData carrying name, service,
// address and datetime but omitting email, on a call where the caller
// gave it plainly.

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CALENDAR_ID = "owner@example.com";
const CONNECTION_ID = "33333333-3333-4333-8333-333333333333";
const RESOURCE_ID = "44444444-4444-4444-8444-444444444444";
const APPOINTMENT_ISO = "2026-09-08T10:00:00.000Z";
const CALLER_ADDRESS = "81 Oakland Drive";
const RECOVERED = "john.smith@example.com";

const PARTIAL_CALL_TRANSCRIPT = T(
  "AI: Thanks for calling Acme Plumbing. How can I help?",
  "User: I need a boiler service.",
  "AI: May I have your name, please?",
  "User: John Smith.",
  "AI: What's your email address?",
  "User: john dot smith at example dot com.",
  "AI: What's the address where the work is needed?",
  `User: ${CALLER_ADDRESS}.`,
  "AI: And when would suit you?",
  "User: Tuesday 8 September at 11 AM."
);

const bookingCall = (id, transcript, extractedOver = {}) => ({
  kind: "call-ended",
  provider: "vapi",
  dedupeKey: `vapi:emailrec-${id}:end-of-call-report`,
  providerCallId: id,
  businessPhone: "+353212345678",
  callerPhone: "+353861234567",
  direction: "inbound",
  startedAt: "2026-09-04T09:00:00.000Z",
  endedAt: "2026-09-04T09:03:00.000Z",
  durationSeconds: 180,
  endedReason: "customer-ended-call",
  summary: "Caller booked a boiler service.",
  transcript,
  recordingUrl: null,
  costUsd: null,
  costBreakdown: null,
  extracted: {
    // A PARTIAL payload: substantive, so PR #58's parser correctly
    // treats it as present and the record-level fallback does not run.
    intent: "new_booking",
    name: "John Smith",
    email: null,
    phone: null,
    service: "boiler service",
    preferred_datetime: "Tuesday 8 September at 11 AM",
    service_address: CALLER_ADDRESS,
    urgent: false,
    ...extractedOver,
  },
});

function detailsRow(html, label) {
  const m = html.match(new RegExp(`<td[^>]*>${label}</td><td[^>]*>([^<]*)</td>`));
  return m ? m[1] : null;
}

function installStubs() {
  const previousEnv = { ...process.env };
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
      return json({ choices: [{ message: { content: APPOINTMENT_ISO } }] });
    }
    if (url.includes("oauth2.googleapis.com") || url.includes("/token")) {
      return json({ access_token: "fresh", expires_in: 3600, scope: "calendar" });
    }
    if (url.includes("googleapis.com/calendar/v3/freeBusy")) {
      return json({ calendars: { [CALENDAR_ID]: { busy: [] } } });
    }
    if (url.includes("/calendar/v3/calendars/") && url.includes("/events")) {
      creates.push({ method, url, body });
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
        created_at: "2026-09-01T00:00:00.000Z",
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
        {
          id: "k1",
          category: "services",
          title: "Boiler service",
          content: "We service boilers.",
        },
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
        const stored = {
          id,
          metadata: null,
          appointment_datetime: null,
          source: "voice",
          ...body,
        };
        leads.set(id, stored);
        return obj ? json({ id }) : json([{ id }]);
      }
      if (method === "PATCH") {
        const row = leads.get(eqOf("id"));
        if (row) Object.assign(row, { ...body });
        return json([]);
      }
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
        const row = project(
          [...leads.values()].find((l) => l.conversation_id === cid) ?? null
        );
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
    emails,
    only() {
      const rows = [...leads.values()];
      assert.equal(rows.length, 1, "expected exactly one lead row");
      return rows[0];
    },
    eventLocations() {
      return creates.map((c) => c.body?.location ?? null);
    },
    /**
     * What confirmAppointmentOnCalendar was given as the customer's
     * address — the same value leadCapture passes to
     * sendBookingConfirmationEmails, and therefore the exact input the
     * `if (customerEmail)` guard reads.
     */
    calendarAttendees() {
      return creates.flatMap((c) =>
        (c.body?.attendees ?? []).map((a) => a.email).filter(Boolean)
      );
    },
    summaryHtml() {
      const sent = emails.find((e) => String(e.html ?? "").includes("Caller ID"));
      return String(sent?.html ?? "");
    },
    restore() {
      globalThis.fetch = realFetch;
      for (const key of Object.keys(process.env)) {
        if (!(key in previousEnv)) delete process.env[key];
      }
      Object.assign(process.env, previousEnv);
    },
  };
}

const admin = () => createAdminClient();

describe("the real path — partial structuredData omitting email", () => {
  let stubs;
  beforeEach(() => {
    stubs = installStubs();
  });
  afterEach(() => stubs.restore());

  test("THE PROVEN CASE — the caller's email reaches the lead and the owner", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      bookingCall("a1a1a1a1-1111-4111-8111-a1a1a1a1a1a1", PARTIAL_CALL_TRANSCRIPT)
    );

    const lead = stubs.only();
    assert.equal(lead.email, RECOVERED, "the lead must carry the caller's own address");
    assert.equal(
      detailsRow(stubs.summaryHtml(), "Email"),
      RECOVERED,
      "the owner must be shown the address the lead holds"
    );
  });

  test("booking and calendar behaviour is otherwise UNCHANGED", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      bookingCall("b2b2b2b2-2222-4222-8222-b2b2b2b2b2b2", PARTIAL_CALL_TRANSCRIPT)
    );

    const lead = stubs.only();
    assert.equal(lead.status, "booked");
    assert.equal(lead.appointment_datetime, APPOINTMENT_ISO);
    assert.equal(stubs.creates.length, 1, "exactly one calendar event, as before");
    // PR #60 behaviour survives this change.
    assert.deepEqual(stubs.eventLocations(), [CALLER_ADDRESS]);
    // PR #39 behaviour survives it too.
    assert.equal(lead.name, "John Smith");
    assert.equal(detailsRow(stubs.summaryHtml(), "Service address"), CALLER_ADDRESS);
  });

  test("the recovered address reaches the customer-confirmation INPUT", async () => {
    // leadCapture passes lead.email to sendBookingConfirmationEmails,
    // whose send is guarded by `if (customerEmail)`. That dispatch runs
    // inside after(), which this harness does not flush — the
    // pre-existing, separately tracked coverage gap — so what is proven
    // here is that the value the guard reads is now the caller's
    // address rather than null. The same value is handed to the
    // calendar as the customer attendee, which IS observable.
    await processCallEnded(
      await admin(),
      ORG_ID,
      bookingCall("c3c3c3c3-3333-4333-8333-c3c3c3c3c3c3", PARTIAL_CALL_TRANSCRIPT)
    );

    assert.equal(stubs.only().email, RECOVERED);
    assert.ok(
      stubs.calendarAttendees().includes(RECOVERED),
      `the customer's address must reach the booking path: ${JSON.stringify(stubs.calendarAttendees())}`
    );
  });

  test("a PRESENT structured email is still what persists", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      bookingCall("d4d4d4d4-4444-4444-8444-d4d4d4d4d4d4", PARTIAL_CALL_TRANSCRIPT, {
        email: "jane@example.com",
      })
    );
    assert.equal(
      stubs.only().email,
      "jane@example.com",
      "the transcript must not override a usable provider value"
    );
  });

  test("no reliable caller evidence still records no email", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      bookingCall(
        "e5e5e5e5-5555-4555-8555-e5e5e5e5e5e5",
        T(
          "AI: Thanks for calling Acme Plumbing. How can I help?",
          "User: I need a boiler service.",
          "AI: What's your email address?",
          "User: I'd rather not give it out.",
          "AI: What's the address where the work is needed?",
          `User: ${CALLER_ADDRESS}.`,
          "AI: And when would suit you?",
          "User: Tuesday 8 September at 11 AM."
        )
      )
    );
    const lead = stubs.only();
    assert.equal(lead.email, null, "absence is still rendered as absence");
    assert.equal(lead.status, "booked", "and the booking is unaffected");
  });

  test("an assistant-spoken address never reaches the lead", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      bookingCall(
        "f6f6f6f6-6666-4666-8666-f6f6f6f6f6f6",
        T(
          "AI: Thanks for calling Acme Plumbing. How can I help?",
          "User: I need a boiler service.",
          "AI: I have your email as john@example.com, is that right?",
          "User: Yes, that's right.",
          "AI: What's the address where the work is needed?",
          `User: ${CALLER_ADDRESS}.`,
          "AI: And when would suit you?",
          "User: Tuesday 8 September at 11 AM."
        )
      )
    );
    assert.equal(
      stubs.only().email,
      null,
      "a model-generated address confirmed with a bare yes is not caller evidence"
    );
  });
});
