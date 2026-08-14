// Appointment emails state the time on the BUSINESS's clock.
//
// email.ts had exactly one time formatter and it was pinned to
// Europe/London. The stored instant has always been correct — the
// dashboard (PR #17) and the manage link (PR #19) both resolve the
// organisation's zone — so this was the last surface announcing that
// correct instant at the wrong hour, and for evening appointments in
// western zones, on the wrong DAY.
//
// Display-only, and deliberately fail-soft: unlike the booking write
// paths, which refuse rather than store a time nobody can vouch for,
// an email in the default zone beats no email telling a business
// someone booked.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  sendBookingConfirmationEmails,
  sendBookingSelfServiceChangeNotification,
  sendCallSummaryEmail,
} from "@/lib/email";

const ORG_ID = "11111111-1111-4111-8111-111111111111";

// 14:00 local on Thursday 20 August 2026, per zone.
const DUBLIN_2PM = "2026-08-20T13:00:00.000Z";
const NEW_YORK_2PM = "2026-08-20T18:00:00.000Z";
const DUBAI_2PM = "2026-08-20T10:00:00.000Z";
// 20:00 Thursday in New York — the same instant is FRIDAY in London.
const NEW_YORK_8PM = "2026-08-21T00:00:00.000Z";

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

async function confirmation(appointmentIso, timezone) {
  const sent = captureEmails();
  await sendBookingConfirmationEmails({
    customerName: "Brian Murphy",
    customerEmail: "brian@example.com",
    businessName: "Acme Plumbing",
    businessOwnerEmail: "owner@example.com",
    appointmentDatetime: appointmentIso,
    bookingReference: "ABC12345",
    serviceNeeded: "Boiler service",
    manageToken: "mt",
    timezone,
  });
  // [0] customer confirmation, [1] owner notification.
  return sent;
}

describe("EMAIL TIMEZONE — the appointment time is the business's, not London's", () => {
  // The fence for every organisation in production today. Dublin shares
  // London's offsets year-round, so this must not move at all.
  test("Europe/Dublin renders exactly as before", async () => {
    const [customer, owner] = await confirmation(DUBLIN_2PM, "Europe/Dublin");
    assert.match(customer.html, /Thursday, 20 August 2026 at 14:00/);
    assert.match(owner.html, /Thursday, 20 August 2026 at 14:00/);
    assert.match(owner.subject, /Thursday, 20 August 2026 at 14:00/);
  });

  test("America/New_York renders the business's local hour", async () => {
    const [customer, owner] = await confirmation(NEW_YORK_2PM, "America/New_York");
    assert.match(
      customer.html,
      /Thursday, 20 August 2026 at 14:00/,
      "19:00 would be the London rendering of the same instant"
    );
    assert.doesNotMatch(customer.html, /19:00/);
    assert.match(owner.html, /Thursday, 20 August 2026 at 14:00/);
  });

  test("Asia/Dubai renders the business's local hour", async () => {
    const [customer] = await confirmation(DUBAI_2PM, "Asia/Dubai");
    assert.match(customer.html, /Thursday, 20 August 2026 at 14:00/);
    assert.doesNotMatch(customer.html, /11:00/, "11:00 is London's version");
  });

  // The worst case: not just the wrong hour, the wrong DAY, in an email
  // whose entire purpose is telling someone when to turn up.
  test("a late appointment keeps the correct local DATE, not just time", async () => {
    const [customer] = await confirmation(NEW_YORK_8PM, "America/New_York");
    assert.match(customer.html, /Thursday, 20 August 2026 at 20:00/);
    assert.doesNotMatch(
      customer.html,
      /Friday, 21 August/,
      "London would call this Friday 21 August at 01:00"
    );
  });

  // Real IANA rules, not a fixed offset: the same wall clock either side
  // of the US transition is EST then EDT.
  test("DST uses the zone's real rules, not a fixed offset", async () => {
    const [winter] = await confirmation("2026-03-07T19:00:00.000Z", "America/New_York");
    assert.match(winter.html, /Saturday, 7 March 2026 at 14:00/, "EST, UTC-5");

    restore();
    const [summer] = await confirmation("2026-03-08T18:00:00.000Z", "America/New_York");
    assert.match(summer.html, /Sunday, 8 March 2026 at 14:00/, "EDT, UTC-4");
  });

  test("the owner's SUBJECT line carries the business-local time too", async () => {
    const [, owner] = await confirmation(NEW_YORK_2PM, "America/New_York");
    assert.match(owner.subject, /New booking: Brian Murphy — Thursday, 20 August 2026 at 14:00/);
    assert.doesNotMatch(owner.subject, /19:00/);
  });

  test("cancellation notification renders in the business's zone", async () => {
    const sent = captureEmails();
    await sendBookingSelfServiceChangeNotification({
      businessOwnerEmail: "owner@example.com",
      customerName: "Brian Murphy",
      customerEmail: "brian@example.com",
      customerPhone: null,
      serviceNeeded: "Boiler service",
      bookingReference: "ABC12345",
      action: "cancelled",
      previousDatetime: DUBAI_2PM,
      timezone: "Asia/Dubai",
    });

    assert.equal(sent.length, 1);
    assert.match(sent[0].html, /cancelled their booking for <strong>Thursday, 20 August 2026 at 14:00/);
    assert.match(sent[0].subject, /Thursday, 20 August 2026 at 14:00/);
    assert.doesNotMatch(sent[0].subject, /11:00/);
  });

  test("reschedule notification renders BOTH times in the business's zone", async () => {
    const sent = captureEmails();
    await sendBookingSelfServiceChangeNotification({
      businessOwnerEmail: "owner@example.com",
      customerName: "Brian Murphy",
      customerEmail: null,
      customerPhone: null,
      serviceNeeded: null,
      bookingReference: "ABC12345",
      action: "rescheduled",
      previousDatetime: NEW_YORK_2PM, // 14:00 New York
      newDatetime: NEW_YORK_8PM, // 20:00 New York, same day
      timezone: "America/New_York",
    });

    assert.equal(sent.length, 1);
    assert.match(sent[0].html, /from <strong>Thursday, 20 August 2026 at 14:00<\/strong>/);
    assert.match(sent[0].html, /to <strong>Thursday, 20 August 2026 at 20:00<\/strong>/);
    // Both London renderings (19:00 and Friday 01:00) must be absent.
    assert.doesNotMatch(sent[0].html, /19:00|Friday, 21 August/);
  });

  test("the call-summary time renders in the business's zone", async () => {
    const sent = captureEmails();
    await sendCallSummaryEmail({
      businessOwnerEmail: "owner@example.com",
      businessName: "Acme Plumbing",
      callerPhone: "+13125550123",
      callerName: "Brian Murphy",
      startedAt: NEW_YORK_2PM,
      durationSeconds: 95,
      summary: "Asked about a boiler service.",
      transcript: "…",
      leadCreated: true,
      timezone: "America/New_York",
    });

    assert.equal(sent.length, 1);
    assert.match(sent[0].html, /Thursday, 20 August 2026 at 14:00/);
    assert.doesNotMatch(sent[0].html, /19:00/);
  });
});

describe("EMAIL TIMEZONE — display fails SOFT, so the email always sends", () => {
  for (const [label, zone] of [
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["an abbreviation Intl would misresolve", "BST"],
    ["nonsense", "Mars/Olympus"],
  ]) {
    test(`${label} falls back to the column default and still sends`, async () => {
      const sent = await confirmation(DUBLIN_2PM, zone);
      assert.equal(sent.length, 2, "both emails must still go out");
      // Europe/London is the documented column default; for this
      // instant it reads the same as Dublin, which is the point — no
      // existing organisation changes behaviour.
      assert.match(sent[0].html, /Thursday, 20 August 2026 at 14:00/);
      assert.doesNotMatch(sent[0].html, /2026-08-20T13:00/, "never the raw ISO");
    });
  }
});

describe("EMAIL TIMEZONE — the zone rides on the owner lookup, not a new query", () => {
  test("getOrgOwnerEmail returns the org zone from ONE organisations read", async () => {
    const realFetch = globalThis.fetch;
    let orgReads = 0;
    let selected = "";
    globalThis.fetch = async (input, init = {}) => {
      const url = String(typeof input === "string" ? input : input.url);
      if (url.includes("/rest/v1/organisations")) {
        orgReads += 1;
        selected = new URL(url).searchParams.get("select") ?? "";
        return new Response(
          JSON.stringify({
            owner_id: "22222222-2222-4222-8222-222222222222",
            business_name: "Acme Plumbing",
            notification_email: "owner@example.com",
            timezone: "America/New_York",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return realFetch(input, init);
    };
    restore = () => {
      globalThis.fetch = realFetch;
    };

    const { getOrgOwnerEmail } = await import("@/lib/leadCapture");
    const info = await getOrgOwnerEmail(ORG_ID);

    assert.equal(info?.timezone, "America/New_York");
    assert.equal(info?.email, "owner@example.com");
    assert.equal(orgReads, 1, "the zone must not cost a second organisations query");
    assert.match(selected, /timezone/, "it rides on the existing select");
  });

  test("an org with no stored zone yields null, not a guess", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
      const url = String(typeof input === "string" ? input : input.url);
      if (url.includes("/rest/v1/organisations")) {
        return new Response(
          JSON.stringify({
            owner_id: "22222222-2222-4222-8222-222222222222",
            business_name: "Acme Plumbing",
            notification_email: "owner@example.com",
            timezone: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return realFetch(input, init);
    };
    restore = () => {
      globalThis.fetch = realFetch;
    };

    const { getOrgOwnerEmail } = await import("@/lib/leadCapture");
    assert.equal((await getOrgOwnerEmail(ORG_ID))?.timezone, null);
  });
});

// Structural fences: the behavioural tests above prove email.ts renders
// correctly WHEN GIVEN a zone; these prove every caller actually gives
// it one, which no assertion on a rendered string can show.
describe("EMAIL TIMEZONE — no London literal, and every sender is threaded", () => {
  async function sourceOf(relPath) {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    return readFile(path.resolve(process.cwd(), relPath), "utf8");
  }

  test("email.ts pins no formatter to Europe/London", async () => {
    const src = await sourceOf("src/lib/email.ts");
    assert.doesNotMatch(src, /timeZone:\s*"Europe\/London"/);
    assert.match(
      src,
      /timeZone:\s*zone/,
      "the formatter must take the zone it is given"
    );
  });

  test("every formatAppointmentDate call passes a zone", async () => {
    const src = await sourceOf("src/lib/email.ts");
    const calls = src.match(/formatAppointmentDate\([\s\S]{0,80}?\)/g) ?? [];
    // The definition plus four call sites.
    assert.ok(calls.length >= 5, `expected the call sites, found ${calls.length}`);
    for (const call of calls) {
      if (call.includes("iso: string")) continue; // the definition
      assert.match(call, /,\s*timezone\s*\)/, `${call} must pass the org zone`);
    }
  });

  test("each caller hands the sender ownerInfo's zone", async () => {
    for (const file of [
      "src/lib/leadCapture.ts",
      "src/app/api/bookings/manage/route.ts",
      "src/lib/voice/calls.ts",
    ]) {
      const src = await sourceOf(file);
      assert.match(
        src,
        /timezone:\s*ownerInfo[?.]*\.timezone/,
        `${file} must pass the organisation zone to the email`
      );
    }
  });
});
