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
