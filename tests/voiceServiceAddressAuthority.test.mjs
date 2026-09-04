// Regression: a plausible but WRONG provider address outranked the
// caller's explicit words.
//
// From the partial-structuredData investigation. resolveServiceAddress
// was asymmetric. If the provider's `service_address` was absent, or
// looked like transcription noise, the transcript was consulted. If it
// was merely well formed, it was returned before the transcript was
// read at all — so a syntactically tidy address the caller never spoke
// became canonical, and every downstream consumer agreed with it,
// because they all read the same resolved value.
//
//   caller says   "81 Oakland Drive"
//   provider says "12 Meadow Court"
//   recorded      "12 Meadow Court"   ← the lead, the owner email, and
//                                       the calendar event LOCATION
//
// That is not information omission, which is what the rest of this
// module's cases are. It is information CORRUPTION reaching a
// real-world action: an engineer dispatched to a real address nobody
// asked for, with nothing on any surface to contradict it. The noise
// case this module was built for at least looks wrong.
//
// The rule under test, in one line:
//   explicit caller-spoken evidence naming a DIFFERENT place outranks
//   a provider address, and nothing else does.
//
// It is NOT "the transcript always wins". The transcript is exactly
// where the original 2026-09-01 defect came from — it mangled the
// house number twice. So the override fires only when
// findSpokenAddress clears every structural bar it already had (an
// answer to an explicit address question or a self-declaration, well
// formed, not itself noise) AND the two strings name different places.
// A same-street house-number difference is deliberately NOT a
// different place, because that is the transcript's known weakness.
//
// No second extraction, no model call, no merge of two readings: one
// value is chosen whole, from one of two sources.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  addressesDescribeSamePlace,
  findSpokenAddress,
  resolveServiceAddress,
} from "@/lib/voice/addressIntegrity";
import { encryptCredentials, loadKeyringFromEnv } from "@/lib/integrations/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { processCallEnded } from "@/lib/voice/calls";

const T = (...turns) => turns.join("\n");

const CALLER_ADDRESS = "81 Oakland Drive";
const PROVIDER_ADDRESS = "12 Meadow Court";

/** The caller states their address plainly, once, when asked. */
const askedAndAnswered = (address) =>
  T(
    "AI: Thanks for calling Acme Plumbing. How can I help?",
    "User: I need a boiler service.",
    "AI: What's the address where the work is needed?",
    `User: ${address}.`
  );

// ── The comparison, on its own ──────────────────────────────────────

describe("addressesDescribeSamePlace — same place, or two places", () => {
  test("identical, and identical bar punctuation or case", () => {
    assert.equal(addressesDescribeSamePlace("81 Oakland Drive", "81 Oakland Drive"), true);
    assert.equal(addressesDescribeSamePlace("81 oakland drive.", "81 Oakland Drive"), true);
    assert.equal(addressesDescribeSamePlace("81 Oakland Drive,", "81 Oakland Drive"), true);
  });

  test("the fuller form agrees with the shorter one", () => {
    // The candidate legitimately carries more than the caller said in
    // the one turn this module could read. Replacing it would DISCARD
    // information, which is the opposite of the point.
    assert.equal(
      addressesDescribeSamePlace("81 Oakland Drive", "81 Oakland Drive, Galway"),
      true
    );
    assert.equal(
      addressesDescribeSamePlace("14 Mill Road", "Flat 2, 14 Mill Road"),
      true
    );
    assert.equal(addressesDescribeSamePlace("Rose Cottage", "Rose Cottage, Mill Lane"), true);
  });

  test("a house-number difference on the SAME street is not a different place", () => {
    // The transcript is least trustworthy about digits — proven on the
    // 2026-09-01 call, where the number was mangled twice and the
    // street resolved both times. Overriding here would re-open that
    // failure from the other side.
    assert.equal(addressesDescribeSamePlace("18 Oakland Drive", "81 Oakland Drive"), true);
    assert.equal(addressesDescribeSamePlace("Oakland Drive", "81 Oakland Drive"), true);
  });

  test("different streets are different places, even sharing a street type", () => {
    assert.equal(addressesDescribeSamePlace("81 Oakland Drive", "12 Meadow Court"), false);
    assert.equal(addressesDescribeSamePlace("81 Oakland Drive", "12 Meadow Drive"), false);
    assert.equal(addressesDescribeSamePlace("Rose Cottage", "12 Meadow Court"), false);
    // EVERY place word must match, not merely one: "Oakland Drive" and
    // "Oakland Road" are two streets. A shared-token test would call
    // these the same place and let the wrong one stand.
    assert.equal(addressesDescribeSamePlace("81 Oakland Drive", "81 Oakland Road"), false);
    assert.equal(
      resolveServiceAddress("81 Oakland Road", askedAndAnswered("81 Oakland Drive")),
      "81 Oakland Drive"
    );
  });

  test("nothing to compare answers SAME — the conservative direction", () => {
    // No place word on one side means this cannot read the evidence,
    // so it leaves the candidate standing rather than replacing it.
    assert.equal(addressesDescribeSamePlace("81", "12 Meadow Court"), true);
    assert.equal(addressesDescribeSamePlace("", "12 Meadow Court"), true);
  });
});

// ── The authority boundary ──────────────────────────────────────────

describe("resolveServiceAddress — caller authority over a plausible provider value", () => {
  // A. Structured address ABSENT.
  test("A — absent candidate still recovers the caller's address", () => {
    assert.equal(
      resolveServiceAddress(null, askedAndAnswered(CALLER_ADDRESS)),
      CALLER_ADDRESS
    );
    assert.equal(
      resolveServiceAddress(undefined, askedAndAnswered("14 Mill Road")),
      "14 Mill Road"
    );
    assert.equal(resolveServiceAddress("   ", askedAndAnswered("Rose Cottage, Mill Lane")), "Rose Cottage, Mill Lane");
  });

  // B. Structured address NOISY.
  test("B — noisy candidate still yields to the caller, and still refuses alone", () => {
    assert.equal(
      resolveServiceAddress(
        "A c 1 Oakland Drive",
        T(
          "AI: What's the address where the work is needed?",
          "User: K e 1 Auckland Drive.",
          "AI: Anything else?",
          `User: My address is ${CALLER_ADDRESS}.`
        )
      ),
      CALLER_ADDRESS
    );
    // No usable evidence: still nothing, never a guess.
    assert.equal(
      resolveServiceAddress("A c 1 Oakland Drive", askedAndAnswered("Yeah")),
      null
    );
  });

  // C. Structured address CORRECT and MATCHING.
  test("C — provider and caller agree, so the provider value is kept byte for byte", () => {
    assert.equal(
      resolveServiceAddress(CALLER_ADDRESS, askedAndAnswered(CALLER_ADDRESS)),
      CALLER_ADDRESS
    );
    // The tidier, fuller provider rendering survives: same place.
    assert.equal(
      resolveServiceAddress("81 Oakland Drive, Galway", askedAndAnswered(CALLER_ADDRESS)),
      "81 Oakland Drive, Galway"
    );
    assert.equal(
      resolveServiceAddress("Flat 2, 14 Mill Road", askedAndAnswered("14 Mill Road")),
      "Flat 2, 14 Mill Road"
    );
  });

  // D. Structured address PLAUSIBLE but CONFLICTING — Case Q.
  test("D — CASE Q: a plausible conflicting provider address loses to the caller", () => {
    assert.equal(
      resolveServiceAddress(PROVIDER_ADDRESS, askedAndAnswered(CALLER_ADDRESS)),
      CALLER_ADDRESS
    );
  });

  test("D — and it loses when the caller VOLUNTEERED the address too", () => {
    assert.equal(
      resolveServiceAddress(
        PROVIDER_ADDRESS,
        T(
          "AI: How can I help?",
          `User: I need a boiler service. My address is ${CALLER_ADDRESS}.`
        )
      ),
      CALLER_ADDRESS
    );
  });

  // E. Transcript gives NO reliable evidence.
  test("E — a good provider address survives an unreadable transcript", () => {
    const unreadable = [
      null,
      undefined,
      "",
      "   ",
      // No address question, so the reply is not read as an answer.
      T("AI: How can I help?", "User: 12 Meadow Court."),
      // An answer that is not an address.
      T("AI: What's the address where the work is needed?", "User: Yeah."),
      T("AI: What's the address where the work is needed?", "User: That's right."),
      // A fragment: one bare word with no number is an acknowledgement.
      T("AI: What's the address where the work is needed?", "User: Galway."),
      // Evidence that is itself transcription noise is not evidence.
      T("AI: What's the address where the work is needed?", "User: K e 1 Auckland Drive."),
      // Only the ASSISTANT says an address; caller turns say nothing.
      T("AI: Is that 81 Oakland Drive?", "User: Sorry?"),
    ];
    for (const transcript of unreadable) {
      assert.equal(
        resolveServiceAddress(PROVIDER_ADDRESS, transcript),
        PROVIDER_ADDRESS,
        `unreliable evidence must not discard a good provider address: ${JSON.stringify(transcript)}`
      );
    }
  });

  test("E — an unreadable transcript never invents an address either", () => {
    assert.equal(resolveServiceAddress(null, T("AI: How can I help?", "User: Yeah.")), null);
    assert.equal(resolveServiceAddress(null, null), null);
  });

  // F. Explicit caller CORRECTION.
  test("F — the caller's correction wins over the provider AND over their first answer", () => {
    const corrected = T(
      "AI: What's the address where the work is needed?",
      "User: 14 Mill Road.",
      "AI: Got it, 14 Mill Road. Anything else?",
      `User: Sorry, no. My address is ${CALLER_ADDRESS}.`
    );
    // findSpokenAddress reads the LAST address, so a stale first
    // attempt is never resurrected — the reason the override is safe.
    assert.equal(findSpokenAddress(corrected), CALLER_ADDRESS);
    assert.equal(resolveServiceAddress(PROVIDER_ADDRESS, corrected), CALLER_ADDRESS);
    // And when the provider DID follow the correction, it stands.
    assert.equal(resolveServiceAddress(CALLER_ADDRESS, corrected), CALLER_ADDRESS);
  });

  test("F — a correction the provider ignored does not leave the stale value", () => {
    // The provider kept the caller's FIRST answer. The caller replaced
    // it out loud; the replacement is what is recorded.
    assert.equal(
      resolveServiceAddress(
        "14 Mill Road",
        T(
          "AI: What's the address where the work is needed?",
          "User: 14 Mill Road.",
          "AI: Anything else?",
          `User: Actually, my address is ${CALLER_ADDRESS}.`
        )
      ),
      CALLER_ADDRESS
    );
  });
});

// ── The house-number conflict ───────────────────────────────────────
// Found in pre-merge review. "81 Oakland Drive" and "12 Oakland Drive"
// share every place word, so the place comparison alone called them the
// same address and the provider's number stood. They are two front
// doors. Proven on the real path before the fix: the booking succeeded
// and the calendar event location read "12 Oakland Drive" while the
// caller had said 81 — a van sent to a stranger's house.
//
// Neither "the provider wins" nor "the transcript wins" is defensible
// here: the transcript's digits are exactly what the 2026-09-01 call
// mangled, and the provider's are what this review caught. So an
// unresolved numeric conflict resolves to NOTHING, which is the posture
// this module already takes for a value it cannot vouch for — the owner
// still has the caller's number, and the booking is not blocked.
//
// The one conflict that CAN be resolved deterministically is the
// caller's own correction, because both numbers are then in the
// caller's turns in order.

describe("a house-number conflict is a different destination, not a rendering", () => {
  test("same street, different numbers, no way to tell — record NOTHING", () => {
    assert.equal(
      resolveServiceAddress("12 Oakland Drive", askedAndAnswered("81 Oakland Drive")),
      null
    );
    // Symmetric: this is not a rule about which source is trusted.
    assert.equal(
      resolveServiceAddress("81 Oakland Drive", askedAndAnswered("12 Oakland Drive")),
      null
    );
    // A fuller provider rendering does not buy the number a pass.
    assert.equal(
      resolveServiceAddress(
        "12 Oakland Drive, Galway",
        askedAndAnswered("81 Oakland Drive")
      ),
      null
    );
  });

  test("the caller's OWN correction resolves the conflict — their last word wins", () => {
    // Both numbers are in the caller's turns, in order, so this is not
    // two sources guessing: the model missed a correction the caller
    // made out loud, and the superseded value is identifiable.
    const corrected = T(
      "AI: What's the address where the work is needed?",
      "User: 12 Oakland Drive.",
      "AI: Got it. Anything else?",
      "User: Sorry, my address is 81 Oakland Drive."
    );
    assert.equal(resolveServiceAddress("12 Oakland Drive", corrected), CALLER_ADDRESS);
    // And when the provider FOLLOWED the correction, nothing changes.
    assert.equal(resolveServiceAddress(CALLER_ADDRESS, corrected), CALLER_ADDRESS);
  });

  test("agreeing numbers are untouched, and so is a fuller rendering", () => {
    assert.equal(
      resolveServiceAddress(CALLER_ADDRESS, askedAndAnswered(CALLER_ADDRESS)),
      CALLER_ADDRESS
    );
    assert.equal(
      resolveServiceAddress("81 Oakland Drive, Galway", askedAndAnswered(CALLER_ADDRESS)),
      "81 Oakland Drive, Galway"
    );
  });

  test("a number the candidate LACKS is recovered, losslessly", () => {
    // Omission, not conflict. Taking the caller's wording only adds the
    // number — the engineer's diary would otherwise carry a street with
    // no house on it.
    assert.equal(
      resolveServiceAddress("Oakland Drive", askedAndAnswered(CALLER_ADDRESS)),
      CALLER_ADDRESS
    );
    // But never when it would DROP something the candidate held: this
    // candidate is not contained in what the caller said.
    assert.equal(
      resolveServiceAddress("Oakland Drive, Galway", askedAndAnswered(CALLER_ADDRESS)),
      "Oakland Drive, Galway"
    );
    // And the caller giving less than the candidate is not a conflict.
    assert.equal(
      resolveServiceAddress(CALLER_ADDRESS, askedAndAnswered("Oakland Drive")),
      CALLER_ADDRESS
    );
  });

  test("only COMPARABLE numbers conflict — nothing is inferred", () => {
    // A spelt-out number would need a number-word table to compare, so
    // it is not comparable and the candidate stands. Turning "eighty
    // one" into 81 is inference this module does not do.
    assert.equal(
      resolveServiceAddress(CALLER_ADDRESS, askedAndAnswered("eighty one Oakland Drive")),
      CALLER_ADDRESS
    );
    // A number that is not in the leading position is not read, so this
    // stays exactly as it behaved before — conservative, not clever.
    assert.equal(
      resolveServiceAddress("Flat 2, 14 Mill Road", askedAndAnswered("14 Mill Road")),
      "Flat 2, 14 Mill Road"
    );
    // Transcription noise is still not evidence of anything.
    assert.equal(
      resolveServiceAddress(
        CALLER_ADDRESS,
        T("AI: What's the address where the work is needed?", "User: K e 1 Oakland Drive.")
      ),
      CALLER_ADDRESS
    );
  });

  test("a DIFFERENT STREET is still Case Q, not a numeric conflict", () => {
    // The street rule must fire first: this returns the caller's
    // address, never null.
    assert.equal(
      resolveServiceAddress(PROVIDER_ADDRESS, askedAndAnswered(CALLER_ADDRESS)),
      CALLER_ADDRESS
    );
  });
});

// ── G. The real path, end to end ────────────────────────────────────
// Helper-level assertions cannot show the corruption reaching a
// real-world action. These drive processCallEnded for real, with a
// calendar that accepts the booking, and read the LOCATION off the
// event body actually sent to Google.

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CALENDAR_ID = "owner@example.com";
const CONNECTION_ID = "33333333-3333-4333-8333-333333333333";
const RESOURCE_ID = "44444444-4444-4444-8444-444444444444";
const APPOINTMENT_ISO = "2026-09-08T10:00:00.000Z";

const bookingCall = (id, transcript, extractedOver = {}) => ({
  kind: "call-ended",
  provider: "vapi",
  dedupeKey: `vapi:addrauth-${id}:end-of-call-report`,
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
    intent: "new_booking",
    name: "Jason",
    email: "jason@example.com",
    phone: null,
    service: "boiler service",
    preferred_datetime: "Tuesday 8 September at 11 AM",
    service_address: null,
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
    // The datetime parser lands here; a fixed instant keeps the
    // appointment time out of these assertions entirely.
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
      // PostgREST returns only the selected columns; honouring that is
      // why assertions on this path mean anything (see PR #47).
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
    /** The location on every calendar event body actually sent. */
    eventLocations() {
      return creates.map((c) => c.body?.location ?? null);
    },
    /** What landed on leads.metadata.service_address. */
    storedAddress() {
      const rows = [...leads.values()];
      const last = rows[rows.length - 1];
      return last?.metadata?.service_address ?? null;
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

describe("G — the real path: a wrong provider address cannot reach the diary", () => {
  let stubs;
  beforeEach(() => {
    stubs = installStubs();
  });
  afterEach(() => stubs.restore());

  test("CASE Q END TO END — the caller's address is booked, not the provider's", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      bookingCall(
        "a1a1a1a1-1111-4111-8111-a1a1a1a1a1a1",
        T(
          "AI: Thanks for calling Acme Plumbing. How can I help?",
          "User: I need a boiler service.",
          "AI: What's the address where the work is needed?",
          `User: ${CALLER_ADDRESS}.`,
          "AI: And when would suit you?",
          "User: Tuesday 8 September at 11 AM."
        ),
        { service_address: PROVIDER_ADDRESS }
      )
    );

    assert.ok(stubs.creates.length > 0, "the booking must actually have reached the calendar");

    // The point of the whole change.
    for (const location of stubs.eventLocations()) {
      assert.equal(
        location,
        CALLER_ADDRESS,
        "the calendar event location must be the address the caller gave"
      );
      assert.ok(
        !/Meadow/i.test(String(location ?? "")),
        "the provider's conflicting address must never reach the engineer's diary"
      );
    }

    // And the same one decision everywhere else.
    assert.equal(stubs.storedAddress(), CALLER_ADDRESS);
    assert.equal(detailsRow(stubs.summaryHtml(), "Service address"), CALLER_ADDRESS);
    assert.ok(
      !/Meadow/i.test(stubs.summaryHtml()),
      "the owner must not be shown the wrong address anywhere in the email"
    );
  });

  test("an AGREEING provider address still reaches the diary unchanged", async () => {
    // Nothing regresses for the ordinary call: the provider's fuller
    // rendering is kept, because it names the same place.
    const fuller = "81 Oakland Drive, Galway";
    await processCallEnded(
      await admin(),
      ORG_ID,
      bookingCall(
        "b2b2b2b2-2222-4222-8222-b2b2b2b2b2b2",
        T(
          "AI: Thanks for calling Acme Plumbing. How can I help?",
          "User: I need a boiler service.",
          "AI: What's the address where the work is needed?",
          `User: ${CALLER_ADDRESS}.`,
          "AI: And when would suit you?",
          "User: Tuesday 8 September at 11 AM."
        ),
        { service_address: fuller }
      )
    );

    assert.ok(stubs.creates.length > 0);
    for (const location of stubs.eventLocations()) {
      assert.equal(location, fuller);
    }
    assert.equal(stubs.storedAddress(), fuller);
  });

  test("no reliable caller evidence leaves the provider address in place", async () => {
    // Booking safety is unchanged: this is not a licence to discard a
    // good provider value whenever the transcript is thin.
    await processCallEnded(
      await admin(),
      ORG_ID,
      bookingCall(
        "c3c3c3c3-3333-4333-8333-c3c3c3c3c3c3",
        T(
          "AI: Thanks for calling Acme Plumbing. How can I help?",
          "User: I need a boiler service.",
          "AI: What's the address where the work is needed?",
          "User: Yeah, sorry, one second.",
          "AI: And when would suit you?",
          "User: Tuesday 8 September at 11 AM."
        ),
        { service_address: PROVIDER_ADDRESS }
      )
    );

    assert.ok(stubs.creates.length > 0);
    for (const location of stubs.eventLocations()) {
      assert.equal(location, PROVIDER_ADDRESS);
    }
    assert.equal(stubs.storedAddress(), PROVIDER_ADDRESS);
  });

  test("A WRONG HOUSE NUMBER cannot reach the diary — and does not block the booking", async () => {
    // Before the pre-merge fix this exact call booked successfully with
    // location "12 Oakland Drive" while the caller had said 81.
    await processCallEnded(
      await admin(),
      ORG_ID,
      bookingCall(
        "e5e5e5e5-5555-4555-8555-e5e5e5e5e5e5",
        T(
          "AI: Thanks for calling Acme Plumbing. How can I help?",
          "User: I need a boiler service.",
          "AI: What's the address where the work is needed?",
          `User: ${CALLER_ADDRESS}.`,
          "AI: And when would suit you?",
          "User: Tuesday 8 September at 11 AM."
        ),
        { service_address: "12 Oakland Drive" }
      )
    );

    // The booking is NOT abandoned: an unresolved address is not a
    // reason to lose the appointment. It is sent with no location.
    assert.ok(stubs.creates.length > 0, "the booking must still reach the calendar");
    for (const location of stubs.eventLocations()) {
      assert.equal(
        location ?? null,
        null,
        "an unresolved house number must send NO location, not a guess"
      );
    }

    assert.equal(stubs.storedAddress(), null);
    const html = stubs.summaryHtml();
    assert.equal(
      detailsRow(html, "Service address"),
      null,
      "the owner is shown no address rather than one of two contradictory ones"
    );
    assert.ok(!/12 Oakland Drive/.test(html), "the provider's number must not appear");
    assert.ok(
      !new RegExp(CALLER_ADDRESS).test(detailsRow(html, "Service address") ?? ""),
      "and neither is silently chosen"
    );
  });

  test("the caller's own house-number CORRECTION is booked", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      bookingCall(
        "f6f6f6f6-6666-4666-8666-f6f6f6f6f6f6",
        T(
          "AI: Thanks for calling Acme Plumbing. How can I help?",
          "User: I need a boiler service.",
          "AI: What's the address where the work is needed?",
          "User: 12 Oakland Drive.",
          "AI: And when would suit you?",
          "User: Tuesday 8 September at 11 AM.",
          "AI: Is there anything else I can help you with today?",
          `User: Sorry, my address is ${CALLER_ADDRESS}.`
        ),
        { service_address: "12 Oakland Drive" }
      )
    );

    assert.ok(stubs.creates.length > 0);
    for (const location of stubs.eventLocations()) {
      assert.equal(
        location,
        CALLER_ADDRESS,
        "a number the caller corrected out loud is resolvable, so it is used"
      );
    }
    assert.equal(stubs.storedAddress(), CALLER_ADDRESS);
  });

  test("the caller's spoken CORRECTION is what the diary receives", async () => {
    await processCallEnded(
      await admin(),
      ORG_ID,
      bookingCall(
        "d4d4d4d4-4444-4444-8444-d4d4d4d4d4d4",
        T(
          "AI: Thanks for calling Acme Plumbing. How can I help?",
          "User: I need a boiler service.",
          "AI: What's the address where the work is needed?",
          "User: 14 Mill Road.",
          "AI: And when would suit you?",
          "User: Tuesday 8 September at 11 AM.",
          "AI: Is there anything else I can help you with today?",
          `User: Yes, sorry. My address is ${CALLER_ADDRESS}.`
        ),
        { service_address: "14 Mill Road" }
      )
    );

    assert.ok(stubs.creates.length > 0);
    for (const location of stubs.eventLocations()) {
      assert.equal(
        location,
        CALLER_ADDRESS,
        "the superseded first answer must not reach the diary"
      );
    }
    assert.equal(stubs.storedAddress(), CALLER_ADDRESS);
  });
});
