// Tests for the composed booking-availability engine.
//
// These cover the pure decision logic and the overlap maths. The parts
// that need a database (business hours, capacity, the external lookup)
// are exercised by the existing availability tests and by live testing;
// what is pinned here is the arithmetic that decides whether a slot
// collides, which is where an off-by-one silently double-books someone.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { overlapsBusy } from "@/lib/availability";
import { checkBookingSlot } from "@/lib/bookingAvailability";
import { isCalendarAvailabilityBlocking } from "@/lib/integrations/flags";
import { installStubs, ORG_ID, MONDAY_1600 } from "./support.mjs";

const busy = (startIso, endIso) => ({ startIso, endIso });

describe("overlap detection", () => {
  const WINDOW = [busy("2026-08-06T09:00:00.000Z", "2026-08-06T10:00:00.000Z")];

  test("an appointment inside a busy window collides", () => {
    assert.equal(overlapsBusy("2026-08-06T09:15:00.000Z", 30, WINDOW), true);
  });

  test("an appointment that starts before and runs into it collides", () => {
    assert.equal(overlapsBusy("2026-08-06T08:30:00.000Z", 60, WINDOW), true);
  });

  test("an appointment that starts inside and runs past it collides", () => {
    assert.equal(overlapsBusy("2026-08-06T09:45:00.000Z", 60, WINDOW), true);
  });

  test("an appointment that completely contains it collides", () => {
    assert.equal(overlapsBusy("2026-08-06T08:00:00.000Z", 180, WINDOW), true);
  });

  test("back-to-back is NOT a collision", () => {
    // Ending exactly when a busy window starts, and starting exactly
    // when one ends, are both legitimate. Rejecting these would refuse
    // half the bookable slots in a busy day.
    assert.equal(overlapsBusy("2026-08-06T08:00:00.000Z", 60, WINDOW), false);
    assert.equal(overlapsBusy("2026-08-06T10:00:00.000Z", 60, WINDOW), false);
  });

  test("a clearly separate time does not collide", () => {
    assert.equal(overlapsBusy("2026-08-06T14:00:00.000Z", 60, WINDOW), false);
    assert.equal(overlapsBusy("2026-08-05T09:15:00.000Z", 60, WINDOW), false);
  });

  test("an empty calendar never collides", () => {
    assert.equal(overlapsBusy("2026-08-06T09:15:00.000Z", 60, []), false);
  });

  test("only one of many windows needs to collide", () => {
    const many = [
      busy("2026-08-06T09:00:00.000Z", "2026-08-06T10:00:00.000Z"),
      busy("2026-08-06T13:00:00.000Z", "2026-08-06T14:00:00.000Z"),
      busy("2026-08-07T09:00:00.000Z", "2026-08-07T17:00:00.000Z"),
    ];
    assert.equal(overlapsBusy("2026-08-06T13:30:00.000Z", 30, many), true);
    assert.equal(overlapsBusy("2026-08-07T11:00:00.000Z", 30, many), true);
    assert.equal(overlapsBusy("2026-08-06T11:00:00.000Z", 30, many), false);
  });

  test("all-day and multi-day windows are respected", () => {
    const allDay = [busy("2026-08-06T00:00:00.000Z", "2026-08-08T00:00:00.000Z")];
    assert.equal(overlapsBusy("2026-08-07T11:00:00.000Z", 60, allDay), true);
  });

  test("durations are honoured — the same start can pass or fail", () => {
    const window = [busy("2026-08-06T10:00:00.000Z", "2026-08-06T11:00:00.000Z")];
    // 30 minutes from 09:30 finishes exactly as the window opens.
    assert.equal(overlapsBusy("2026-08-06T09:30:00.000Z", 30, window), false);
    // 60 minutes from 09:30 runs half an hour into it.
    assert.equal(overlapsBusy("2026-08-06T09:30:00.000Z", 60, window), true);
  });

  test("a busy window spanning a DST change is compared as instants", () => {
    // 25 October 2026: the clocks go back at 01:00 UTC. Comparing local
    // wall-clock times here would make the ambiguous hour look free.
    const window = [busy("2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z")];
    assert.equal(overlapsBusy("2026-10-25T01:00:00.000Z", 30, window), true);
    assert.equal(overlapsBusy("2026-10-25T01:30:00.000Z", 30, window), false);
  });

  test("malformed windows are ignored rather than throwing mid-booking", () => {
    const broken = [busy("not-a-date", "also-not"), ...WINDOW];
    assert.equal(overlapsBusy("2026-08-06T09:15:00.000Z", 30, broken), true);
    assert.equal(overlapsBusy("2026-08-06T14:00:00.000Z", 30, broken), false);
  });
});

describe("availability blocking flag", () => {
  test("blocking is off unless every gate above it is explicitly true", () => {
    // Log-only is the default: an external conflict is recorded but the
    // booking still goes through, until the log has been validated.
    assert.equal(isCalendarAvailabilityBlocking({}), false);
    assert.equal(
      isCalendarAvailabilityBlocking({ CALENDAR_AVAILABILITY_BLOCKING: "true" }),
      false,
      "must not block without the calendar capability enabled"
    );
    assert.equal(
      isCalendarAvailabilityBlocking({
        CALENDAR_SYNC_ENABLED: "true",
        CALENDAR_AVAILABILITY_BLOCKING: "true",
      }),
      false,
      "must not block without the framework enabled"
    );
    assert.equal(
      isCalendarAvailabilityBlocking({
        INTEGRATIONS_ENABLED: "true",
        CALENDAR_SYNC_ENABLED: "true",
        CALENDAR_AVAILABILITY_BLOCKING: "true",
      }),
      true
    );
  });

  test("anything other than the exact string \"true\" reads as off", () => {
    for (const value of ["1", "yes", "TRUE", "", undefined]) {
      assert.equal(
        isCalendarAvailabilityBlocking({
          INTEGRATIONS_ENABLED: "true",
          CALENDAR_SYNC_ENABLED: "true",
          CALENDAR_AVAILABILITY_BLOCKING: value,
        }),
        false,
        String(value)
      );
    }
  });
});

// ── excludeLeadId, forwarded to the capacity check ────────────────────
//
// checkBookingSlot is shared: the live phone call, the pre-write
// re-check in calendarSync, and (from this work on) chat and the
// widget all go through it. Chat and the widget need the reschedule
// self-exemption that checkSlotCapacity has always had; the phone must
// not notice that the option now exists.
//
// No calendar is connected in these tests (the integration flags are
// unset), so the external branch short-circuits to not_connected and
// what is pinned here is exactly the internal decision.

describe("checkBookingSlot — reschedule self-exemption", () => {
  const RESCHEDULING_LEAD = "11111111-1111-4111-8111-111111111111";
  const SOMEONE_ELSE = "22222222-2222-4222-8222-222222222222";

  // The lead's own confirmed booking, at the very instant it is asking
  // to be moved to. Under the overlap rule this collides with itself.
  const ownBooking = (id) => [
    {
      id,
      org_id: ORG_ID,
      status: "booked",
      appointment_datetime: new Date(MONDAY_1600).toISOString(),
    },
  ];

  test("without the option, an overlapping booking still refuses the slot", async () => {
    // The pre-existing behaviour every current caller relies on.
    const stubs = installStubs({ bookedLeads: ownBooking(RESCHEDULING_LEAD) });
    try {
      const decision = await checkBookingSlot(ORG_ID, MONDAY_1600, 60);
      assert.equal(decision.available, false);
      assert.equal(decision.reason, "capacity");
    } finally {
      stubs.restore();
    }
  });

  test("a lead moving its own appointment is not a clash with itself", async () => {
    const stubs = installStubs({ bookedLeads: ownBooking(RESCHEDULING_LEAD) });
    try {
      const decision = await checkBookingSlot(ORG_ID, MONDAY_1600, 60, {
        excludeLeadId: RESCHEDULING_LEAD,
      });
      assert.equal(decision.available, true);
      assert.equal(decision.reason, null);
    } finally {
      stubs.restore();
    }
  });

  test("it exempts ONLY that lead — someone else's booking still blocks", async () => {
    // The exemption must not become a way to book over other customers.
    const stubs = installStubs({ bookedLeads: ownBooking(SOMEONE_ELSE) });
    try {
      const decision = await checkBookingSlot(ORG_ID, MONDAY_1600, 60, {
        excludeLeadId: RESCHEDULING_LEAD,
      });
      assert.equal(decision.available, false);
      assert.equal(decision.reason, "capacity");
    } finally {
      stubs.restore();
    }
  });

  test("null and undefined behave exactly as omitting the option", async () => {
    // capturePartialLead passes `existing?.id`, which is undefined for a
    // new enquiry. That must not accidentally disable the capacity rule.
    for (const excludeLeadId of [null, undefined]) {
      const stubs = installStubs({ bookedLeads: ownBooking(RESCHEDULING_LEAD) });
      try {
        const decision = await checkBookingSlot(ORG_ID, MONDAY_1600, 60, {
          excludeLeadId,
        });
        assert.equal(decision.available, false, String(excludeLeadId));
        assert.equal(decision.reason, "capacity", String(excludeLeadId));
      } finally {
        stubs.restore();
      }
    }
  });

  test("the phone's three-argument call is unchanged on a free slot", async () => {
    // voice/availabilityTool.ts and calendarSync.ts both call with three
    // arguments. This is that exact shape, against an empty diary.
    const stubs = installStubs({ bookedLeads: [] });
    try {
      const decision = await checkBookingSlot(ORG_ID, MONDAY_1600, 60);
      assert.equal(decision.available, true);
      assert.equal(decision.reason, null);
      assert.equal(decision.externalChecked, false);
      assert.equal(decision.externalCheckFailed, false);
      assert.equal(decision.externalBusyWindowEndIso, null);
    } finally {
      stubs.restore();
    }
  });

  test("business hours are still decided before capacity is ever counted", async () => {
    // Sunday is closed in the fixture. The exemption must not smuggle a
    // booking past the hours check, which runs first and independently.
    const stubs = installStubs({ bookedLeads: [] });
    try {
      const decision = await checkBookingSlot(
        ORG_ID,
        "2026-08-02T14:00:00+01:00",
        60,
        { excludeLeadId: RESCHEDULING_LEAD }
      );
      assert.equal(decision.available, false);
      assert.equal(decision.reason, "hours");
    } finally {
      stubs.restore();
    }
  });
});
