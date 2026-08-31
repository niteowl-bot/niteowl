// The owner's call summary states the SETTLED booking outcome.
//
// Voice writes the calendar AFTER the call ends, so for as long as a
// phone call could not book, this email had nothing to distinguish: the
// appointment was always a request. Once PR #23 let a confirmed phone
// appointment create the event — proven end to end in production on
// 2026-08-26 — the same wording covered two opposite realities, and the
// owner could not tell whether the job was already in their diary.
//
// The rule these tests pin down is the booking engine's own, applied to
// what the owner is TOLD: only a settled "booked" may be reported as
// booked. A conflict, an unreadable calendar, a failed create, an
// unrecognised status and a failed read all land on wording that asks
// the owner to check.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { sendCallSummaryEmail, ownerBookingStatus } from "@/lib/email";
import { processCallEnded } from "@/lib/voice/calls";

let restore = null;

/** Captures what Resend was asked to send; nothing leaves the process. */
function captureEmails() {
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(typeof input === "string" ? input : input.url);
    if (url.includes("api.resend.com")) {
      sent.push(init.body ? JSON.parse(init.body) : {});
      return new Response(JSON.stringify({ id: `email-${sent.length}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input, init);
  };
  restore = () => {
    globalThis.fetch = realFetch;
  };
  return sent;
}

afterEach(() => {
  restore?.();
  restore = null;
});

const BASE = {
  businessOwnerEmail: "owner@example-business.test",
  businessName: "Niteowl Test",
  callerPhone: "+353871465274",
  callerName: "Michael Ryan",
  startedAt: "2026-08-26T11:54:38.000Z",
  durationSeconds: 109,
  summary: "Michael called to book a plumbing appointment.",
  transcript: "AI: Hello.\nUser: I need a plumber.",
  leadCreated: true,
  timezone: "Europe/London",
};

async function sendWith(bookingStatus) {
  const sent = captureEmails();
  const ok = await sendCallSummaryEmail({ ...BASE, bookingStatus });
  assert.equal(ok, true, "the summary email should have been sent");
  assert.equal(sent.length, 1, "exactly one owner summary email per call");
  return sent[0].html;
}

/** Every phrase that would tell an owner the job is in their diary. */
function assertNeverClaimsBooked(html) {
  assert.ok(!/BOOKED/.test(html), "must not show the BOOKED label");
  assert.ok(
    !/no manual confirmation needed/i.test(html),
    "must not tell the owner the appointment needs no confirmation"
  );
  assert.ok(
    !/Booked in the calendar/i.test(html),
    "must not claim the appointment reached the calendar"
  );
}

describe("ownerBookingStatus — the mapping, in isolation", () => {
  test("only a settled 'booked' maps to booked", () => {
    assert.equal(ownerBookingStatus("booked"), "booked");
  });

  test("awaiting_confirmation maps to awaiting_confirmation", () => {
    assert.equal(
      ownerBookingStatus("awaiting_confirmation"),
      "awaiting_confirmation"
    );
  });

  test("needs_review — what a calendar failure settles to — requires review", () => {
    assert.equal(ownerBookingStatus("needs_review"), "requires_review");
  });

  test("fails closed on unknown, null and undefined", () => {
    // A status this build does not recognise, a lead row that could not
    // be read, and a column that came back empty must never be reported
    // as a booking.
    for (const value of [
      undefined,
      null,
      "",
      "new",
      "contacted",
      "qualified",
      "cancelled",
      "lost",
      "BOOKED", // case matters: only the exact stored literal counts
      "booked_pending",
      "something_a_future_migration_adds",
    ]) {
      assert.equal(
        ownerBookingStatus(value),
        "requires_review",
        `${JSON.stringify(value)} must fail closed`
      );
      assert.notEqual(ownerBookingStatus(value), "booked");
    }
  });
});

describe("owner call summary — booking status wording", () => {
  test("1. a settled booking reports BOOKED and never asks for confirmation", async () => {
    const html = await sendWith("booked");

    assert.ok(/Booking status/.test(html), "shows a booking status row");
    assert.ok(/BOOKED/.test(html), "reports it as booked");
    assert.ok(
      /Booked in the calendar/i.test(html),
      "tells the owner it reached the calendar"
    );
    assert.ok(
      /no manual confirmation needed/i.test(html),
      "tells the owner no action is required"
    );

    // The whole point: it must not ALSO read as a pending request.
    assert.ok(
      !/AWAITING CONFIRMATION/.test(html),
      "must not call a settled booking awaiting confirmation"
    );
    assert.ok(
      !/has not been confirmed in the calendar yet/i.test(html),
      "must not contradict itself"
    );
    assert.ok(!/REQUIRES REVIEW/.test(html));
  });

  test("2. awaiting_confirmation says confirmation is still required", async () => {
    const html = await sendWith("awaiting_confirmation");

    assert.ok(/AWAITING CONFIRMATION/.test(html));
    assert.ok(
      /has not been confirmed in the calendar yet/i.test(html),
      "states plainly that the calendar does not hold it"
    );
    assertNeverClaimsBooked(html);
  });

  test("3. a calendar-write failure fails closed and never claims booked", async () => {
    const html = await sendWith("requires_review");

    assert.ok(/REQUIRES REVIEW/.test(html));
    assert.ok(
      /was not confirmed in the calendar/i.test(html),
      "states the appointment did not reach the calendar"
    );
    assertNeverClaimsBooked(html);
  });

  test("4. an unknown lead status never produces a booked claim", async () => {
    // Drives the real mapper, exactly as calls.ts does, rather than
    // hand-passing a status the mapper would never emit.
    const html = await sendWith(ownerBookingStatus("a_status_nobody_wrote_yet"));

    assert.ok(/REQUIRES REVIEW/.test(html));
    assertNeverClaimsBooked(html);
  });

  test("5. the existing summary details are all still present", async () => {
    const sent = captureEmails();
    await sendCallSummaryEmail({ ...BASE, bookingStatus: "booked" });
    const email = sent[0];

    assert.match(
      email.subject,
      /Remy answered a call from Michael Ryan/,
      "subject unchanged"
    );
    assert.equal(email.to, BASE.businessOwnerEmail);

    const html = email.html;
    assert.ok(/Michael Ryan/.test(html), "caller name");
    assert.ok(/\+353871465274/.test(html), "caller ID");
    assert.ok(/Duration/.test(html) && /1m 49s/.test(html), "duration");
    assert.ok(/Michael called to book a plumbing appointment/.test(html), "summary");
    assert.ok(/I need a plumber/.test(html), "transcript");
    assert.ok(/View this lead in your dashboard/.test(html), "dashboard link");
    // Time is rendered on the BUSINESS's clock (12:54 BST, not 11:54Z).
    assert.ok(/12:54/.test(html), "call time in the organisation timezone");
  });

  test("6. no booking status block on a call that produced no appointment", async () => {
    // A callback or a general question has no appointment to report.
    // Omitting the block is what keeps those emails reading exactly as
    // they did before this change — and stops the email inventing an
    // appointment that was never requested.
    const html = await sendWith(null);

    assert.ok(!/Booking status/.test(html), "no status row at all");
    assert.ok(!/AWAITING CONFIRMATION/.test(html));
    assert.ok(!/REQUIRES REVIEW/.test(html));
    assertNeverClaimsBooked(html);

    // ...while everything the owner already relied on survives.
    assert.ok(/Michael Ryan/.test(html));
    assert.ok(/Michael called to book a plumbing appointment/.test(html));
  });

  test("7. omitting bookingStatus entirely behaves exactly as before", async () => {
    // Backward compatibility: the field is optional, so any caller that
    // has not been updated is unaffected rather than newly wrong.
    const sent = captureEmails();
    const ok = await sendCallSummaryEmail({ ...BASE });
    assert.equal(ok, true);
    assert.equal(sent.length, 1);

    const html = sent[0].html;
    assert.ok(!/Booking status/.test(html));
    assertNeverClaimsBooked(html);
    assert.ok(/View this lead in your dashboard/.test(html));
  });

  test("8. one call sends exactly one owner summary email", async () => {
    // Guards the requirement that this change introduces no duplicate
    // owner email. The dedupe guard itself (hasCallSummaryBeenSent)
    // lives in calls.ts and is unchanged and still covered by
    // voiceEventReplay.test.mjs; this pins the sender's own arity.
    const sent = captureEmails();
    await sendCallSummaryEmail({ ...BASE, bookingStatus: "booked" });
    assert.equal(sent.length, 1, "one email per invocation, never two");
  });
});

// ── Was a booking even attempted? — the real path ──────────────────
//
// From the 2026-08-31 live burst-pipe call. The caller wanted a visit
// and gave no day or time at all. Nothing was ever submitted to a
// calendar, and the owner was nonetheless told:
//
//   REQUIRES REVIEW
//   The requested appointment was not confirmed in the calendar.
//
// which describes a booking that was attempted and failed. None was.
// The block is gated on isAppointmentRequest — "the caller wanted a
// visit" — which says nothing about whether they named a time.
//
// Everything above this point tests ownerBookingStatus() and the email
// template in isolation, handing sendCallSummaryEmail a bookingStatus
// and checking it renders. That is the same shape of coverage that let
// PR #34 ship a feature which did nothing, so these drive the REAL
// processCallEnded and assert on what actually leaves the process.

const OWNER_ORG_ID = "11111111-1111-4111-8111-111111111111";

const ownerBase = {
  kind: "call-ended",
  provider: "vapi",
  businessPhone: "+353212345678",
  callerPhone: "+353861234567",
  direction: "inbound",
  startedAt: "2026-08-31T15:00:00.000Z",
  endedAt: "2026-08-31T15:05:00.000Z",
  durationSeconds: 300,
  endedReason: "customer-ended-call",
  summary: "Caller has a burst pipe and needs someone urgently.",
  transcript:
    "AI: How can I help?\nUser: I have a burst pipe. I need someone as soon as possible. It's urgent.\nAI: Is there a particular day or time?\nUser: I don't have a specific day or time.",
  recordingUrl: null,
  costUsd: null,
  costBreakdown: null,
  extracted: {
    intent: "new_booking",
    name: "Michael Ryan",
    email: null,
    phone: null,
    service: "burst pipe",
    preferred_datetime: null,
    service_address: null,
    urgent: true,
  },
};

const ownerCall = (id, over = {}, extractedOver = {}) => ({
  ...ownerBase,
  dedupeKey: `vapi:owner-${id}:end-of-call-report`,
  providerCallId: id,
  ...over,
  extracted: { ...ownerBase.extracted, ...extractedOver },
});

/** The live call: a visit wanted, no day or time named. */
const URGENT_NO_TIME = ownerCall("11111111-aaaa-4aaa-8aaa-111111111111");

/** A model ignoring its schema and writing the urgency in as a time. */
const URGENT_PHRASE_AS_TIME = ownerCall(
  "22222222-aaaa-4aaa-8aaa-222222222222",
  {},
  { preferred_datetime: "as soon as possible" }
);

/** A time WAS given, but nothing can resolve it. Must still report. */
const TIME_GIVEN_UNPARSEABLE = ownerCall(
  "33333333-aaaa-4aaa-8aaa-333333333333",
  {},
  { preferred_datetime: "sometime after the bank holiday" }
);

/** A real time, and the calendar write fails. Must still report. */
const TIME_GIVEN_CALENDAR_FAILS = ownerCall(
  "44444444-aaaa-4aaa-8aaa-444444444444",
  {},
  { preferred_datetime: "Wednesday at 3pm" }
);

/** No visit wanted at all — the callback case, already correct. */
const PURE_CALLBACK = ownerCall(
  "55555555-aaaa-4aaa-8aaa-555555555555",
  {},
  { intent: "question", service: null }
);

function installOwnerStubs({ resolvesDatetime = false } = {}) {
  const realFetch = globalThis.fetch;
  const inserts = [];
  const emails = [];
  let leadStatus = null;
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
      // "NONE" is what parseDatetimeToIso treats as unresolvable.
      return json({
        choices: [
          {
            message: {
              content: resolvesDatetime ? "2026-09-02T14:00:00.000Z" : "NONE",
            },
          },
        ],
      });
    }
    if (url.includes("/rest/v1/voice_calls")) {
      const r = { id: "call-row-1" };
      return obj ? json(r) : json([r]);
    }
    if (url.includes("/rest/v1/business_knowledge")) {
      return json([{ title: "Burst pipe repair", content: "We repair burst pipes." }]);
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
        id: OWNER_ORG_ID,
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
        leadStatus = stored.status ?? null;
        return obj ? json({ id: stored.id }) : json([{ id: stored.id }]);
      }
      if (method === "PATCH") {
        if (body?.status) leadStatus = body.status;
        return json([]);
      }
      if (url.includes("select=metadata")) {
        const r = {
          metadata: {},
          appointment_datetime: inserts[0]?.appointment_datetime ?? null,
        };
        return obj ? json(r) : json([r]);
      }
      if (url.includes("select=status")) {
        const r = { status: leadStatus };
        return obj ? json(r) : json([r]);
      }
      return obj ? json(null) : json([]);
    }
    if (url.includes("/rest/v1/voice_events")) return json([{ id: "evt-1" }]);
    // No calendar connection: a calendar-backed write cannot succeed.
    if (url.includes("/rest/v1/integration_connections")) {
      return obj ? json(null) : json([]);
    }
    throw new Error(`Unstubbed fetch in test: ${method} ${url}`);
  };

  return {
    inserts,
    emails,
    /** The owner's call-summary email, identified by its details block. */
    summaryHtml() {
      const sent = emails.find((e) => String(e.html ?? "").includes("Caller ID"));
      return String(sent?.html ?? "");
    },
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

async function ownerAdmin() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/** Any of the three booking-status labels, i.e. "the block is present". */
const BOOKING_BLOCK = /Booking status/;
const CALENDAR_FAILURE_LANGUAGE = /was not confirmed in the calendar|has not been confirmed in the calendar yet/i;

describe("the owner is told about a booking only when one was asked for", () => {
  let stubs;
  afterEach(() => stubs.restore());

  test("urgent, no time given — no booking-status block at all", async () => {
    stubs = installOwnerStubs();
    await processCallEnded(await ownerAdmin(), OWNER_ORG_ID, URGENT_NO_TIME);
    const html = stubs.summaryHtml();
    assert.ok(html.length > 0, "the owner summary should have been sent");
    assert.ok(
      !BOOKING_BLOCK.test(html),
      "nothing was submitted to a calendar, so there is no booking to report"
    );
  });

  test("urgent, no time given — no language implying a booking was attempted", async () => {
    stubs = installOwnerStubs();
    await processCallEnded(await ownerAdmin(), OWNER_ORG_ID, URGENT_NO_TIME);
    const html = stubs.summaryHtml();
    assert.ok(
      !CALENDAR_FAILURE_LANGUAGE.test(html),
      "must not say an appointment was not confirmed when none was ever requested"
    );
    assert.ok(!/REQUIRES REVIEW/.test(html), "the live 2026-08-31 defect");
  });

  test("urgent, no time given — the urgency still reaches the owner (PR #35)", async () => {
    stubs = installOwnerStubs();
    await processCallEnded(await ownerAdmin(), OWNER_ORG_ID, URGENT_NO_TIME);
    assert.match(
      stubs.summaryHtml(),
      /Callback urgency/,
      "removing the booking block must not remove the urgency row"
    );
  });

  test("an urgency phrase written in as a time is not a requested time", async () => {
    stubs = installOwnerStubs();
    await processCallEnded(
      await ownerAdmin(),
      OWNER_ORG_ID,
      URGENT_PHRASE_AS_TIME
    );
    const html = stubs.summaryHtml();
    assert.ok(
      !BOOKING_BLOCK.test(html),
      "a model ignoring its schema must not conjure a booking to report"
    );
    assert.match(html, /Callback urgency/, "it is urgency, and shows as urgency");
  });

  test("a time WAS given but could not be parsed — still reports, fail-closed", async () => {
    stubs = installOwnerStubs({ resolvesDatetime: false });
    await processCallEnded(
      await ownerAdmin(),
      OWNER_ORG_ID,
      TIME_GIVEN_UNPARSEABLE
    );
    const html = stubs.summaryHtml();
    assert.ok(
      BOOKING_BLOCK.test(html),
      "the caller asked for a time, so the outcome must be reported"
    );
    assert.match(
      html,
      /REQUIRES REVIEW/,
      "an unresolvable time is never reported as booked"
    );
  });

  test("a time WAS given and the calendar failed — still REQUIRES REVIEW", async () => {
    stubs = installOwnerStubs({ resolvesDatetime: true });
    await processCallEnded(
      await ownerAdmin(),
      OWNER_ORG_ID,
      TIME_GIVEN_CALENDAR_FAILS
    );
    const html = stubs.summaryHtml();
    assert.ok(BOOKING_BLOCK.test(html), "a requested time must report its outcome");
    assert.ok(
      !/BOOKED<|>BOOKED</.test(html),
      "a failed calendar write is never reported as booked"
    );
  });

  test("an ordinary callback still shows no booking-status block", async () => {
    stubs = installOwnerStubs();
    await processCallEnded(await ownerAdmin(), OWNER_ORG_ID, PURE_CALLBACK);
    assert.ok(
      !BOOKING_BLOCK.test(stubs.summaryHtml()),
      "unchanged behaviour — a callback has no booking to report"
    );
  });
});
