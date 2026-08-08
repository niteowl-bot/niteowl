// Regression tests for OVERLAP-aware booking capacity (2026-08-08).
//
// The bug: the capacity check counted only bookings starting at the
// SAME instant —
//
//   .eq("appointment_datetime", isoDatetime)
//
// so with 60-minute appointments and max_concurrent_bookings = 1, a
// booking at 10:00 and another at 10:30 BOTH passed: neither timestamp
// equalled the other, each saw a count of zero, and the business was
// double-booked. `overlapsBusy` in the same file already had correct
// half-open interval logic, but it was only ever applied to the
// EXTERNAL calendar's busy windows, never to the org's own bookings.
//
// These pin the semantics rather than the examples: any shared minute
// is a conflict, and appointments that merely touch are not.
//
// ── A note on "containment" ──
// An appointment's length is the org's single
// `appointment_duration_minutes`, so every interval is the same width
// and one can never strictly contain another. The containment cases
// therefore reduce to partial overlap and are asserted as such; the
// duration tests below show the window really is driven by length, so
// a longer appointment swallows times a shorter one would not.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installStubs, ORG_ID } from "./support.mjs";
import {
  isSlotAvailable,
  checkSlotCapacity,
  isWithinBusinessHours,
  findNextAvailableSlot,
  appointmentOverlapWindow,
  appointmentsOverlap,
} from "@/lib/availability";

let stubs;
afterEach(() => stubs?.restore());

// Monday 3 August 2026, Europe/London (BST, UTC+1) — the same fixture
// day the rest of the availability suite uses. Hours are 09:00–19:00.
const at = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 7, 3, h - 1, m)).toISOString();
};

const bookedAt = (iso, id = `lead-${iso}`) => ({
  id,
  org_id: ORG_ID,
  status: "booked",
  appointment_datetime: iso,
});

describe("the rule itself — appointmentsOverlap", () => {
  test("identical starts overlap", () => {
    assert.equal(appointmentsOverlap(at("10:00"), at("10:00"), 60), true);
  });

  test("a partial overlap is a conflict, whichever came first", () => {
    assert.equal(appointmentsOverlap(at("10:00"), at("10:30"), 60), true);
    assert.equal(appointmentsOverlap(at("10:30"), at("10:00"), 60), true);
  });

  test("one shared minute is still a conflict", () => {
    assert.equal(appointmentsOverlap(at("10:00"), at("10:59"), 60), true);
  });

  test("back-to-back does NOT overlap — half-open, both directions", () => {
    // The rule that keeps adjacent appointments legal: one ending
    // exactly as the next begins shares no time at all.
    assert.equal(appointmentsOverlap(at("10:00"), at("11:00"), 60), false);
    assert.equal(appointmentsOverlap(at("11:00"), at("10:00"), 60), false);
  });

  test("well-separated appointments do not overlap", () => {
    assert.equal(appointmentsOverlap(at("10:00"), at("14:00"), 60), false);
  });

  test("a longer appointment widens the conflict window", () => {
    // The containment-equivalent: at 120 minutes 10:00 and 11:00 are no
    // longer adjacent — they genuinely share an hour.
    assert.equal(appointmentsOverlap(at("10:00"), at("11:00"), 120), true);
    assert.equal(appointmentsOverlap(at("10:00"), at("12:00"), 120), false);
  });

  test("a shorter appointment narrows it — no rule is hardcoded to 60", () => {
    assert.equal(appointmentsOverlap(at("10:00"), at("10:30"), 30), false);
    assert.equal(appointmentsOverlap(at("10:00"), at("10:30"), 60), true);
  });

  test("an unparseable instant never invents an overlap", () => {
    assert.equal(appointmentsOverlap("not-a-date", at("10:00"), 60), false);
  });
});

describe("the query window — appointmentOverlapWindow", () => {
  test("it spans one appointment length either side", () => {
    const w = appointmentOverlapWindow(at("10:00"), 60);
    assert.equal(w.afterIso, at("09:00"));
    assert.equal(w.beforeIso, at("11:00"));
  });

  test("its bounds are STRICT, so the touching rows fall outside", () => {
    // 09:00 and 11:00 are the boundaries themselves; a booking starting
    // exactly there is back-to-back, not overlapping. The database
    // filter uses gt/lt precisely so those rows are not counted.
    const w = appointmentOverlapWindow(at("10:00"), 60);
    assert.equal(appointmentsOverlap(w.afterIso, at("10:00"), 60), false);
    assert.equal(appointmentsOverlap(w.beforeIso, at("10:00"), 60), false);
  });

  test("an unparseable instant yields no window", () => {
    assert.equal(appointmentOverlapWindow("nonsense", 60), null);
  });
});

describe("isSlotAvailable — overlap against real booked rows", () => {
  test("an identical start is refused", async () => {
    stubs = installStubs({ bookedLeads: [bookedAt(at("10:00"))] });
    assert.equal(await isSlotAvailable(ORG_ID, at("10:00")), false);
  });

  test("a partial overlap is refused — the original double-booking bug", async () => {
    stubs = installStubs({ bookedLeads: [bookedAt(at("10:00"))] });
    assert.equal(await isSlotAvailable(ORG_ID, at("10:30")), false);
  });

  test("an overlap from the other direction is refused too", async () => {
    stubs = installStubs({ bookedLeads: [bookedAt(at("10:30"))] });
    assert.equal(await isSlotAvailable(ORG_ID, at("10:00")), false);
  });

  test("back-to-back stays bookable, before and after", async () => {
    stubs = installStubs({ bookedLeads: [bookedAt(at("10:00"))] });
    assert.equal(await isSlotAvailable(ORG_ID, at("11:00")), true);
    stubs.restore();
    stubs = installStubs({ bookedLeads: [bookedAt(at("11:00"))] });
    assert.equal(await isSlotAvailable(ORG_ID, at("10:00")), true);
  });

  test("a distant booking is irrelevant", async () => {
    stubs = installStubs({ bookedLeads: [bookedAt(at("15:00"))] });
    assert.equal(await isSlotAvailable(ORG_ID, at("10:00")), true);
  });

  test("max_concurrent_bookings is still honoured, now across overlaps", async () => {
    stubs = installStubs({
      maxConcurrentBookings: 2,
      bookedLeads: [bookedAt(at("10:00"), "a")],
    });
    assert.equal(await isSlotAvailable(ORG_ID, at("10:30")), true);

    stubs.restore();
    stubs = installStubs({
      maxConcurrentBookings: 2,
      bookedLeads: [bookedAt(at("10:00"), "a"), bookedAt(at("10:30"), "b")],
    });
    assert.equal(await isSlotAvailable(ORG_ID, at("10:15")), false);
  });

  test("a longer org duration refuses what a 60-minute org allows", async () => {
    stubs = installStubs({
      appointmentDurationMinutes: 120,
      bookedLeads: [bookedAt(at("10:00"))],
    });
    assert.equal(await isSlotAvailable(ORG_ID, at("11:00")), false);
  });

  test("only CONFIRMED bookings consume capacity", async () => {
    stubs = installStubs({
      bookedLeads: [{ ...bookedAt(at("10:00")), status: "needs_review" }],
    });
    assert.equal(await isSlotAvailable(ORG_ID, at("10:00")), true);
  });
});

describe("a reschedule must not clash with itself", () => {
  // Introduced BY the overlap change: under exact-match a lead moving
  // 10:00 → 10:30 never met itself, because the timestamps differed.
  // Under overlap it does, so without the exclusion every short
  // reschedule would be refused as a clash with its own booking.
  test("its own booking blocks it without the exclusion", async () => {
    stubs = installStubs({ bookedLeads: [bookedAt(at("10:00"), "lead-1")] });
    assert.equal(await isSlotAvailable(ORG_ID, at("10:30")), false);
  });

  test("excluding the lead lets its own move through", async () => {
    stubs = installStubs({ bookedLeads: [bookedAt(at("10:00"), "lead-1")] });
    assert.equal(
      await isSlotAvailable(ORG_ID, at("10:30"), { excludeLeadId: "lead-1" }),
      true
    );
  });

  test("but a DIFFERENT clashing lead is still respected", async () => {
    stubs = installStubs({
      bookedLeads: [
        bookedAt(at("10:00"), "lead-1"),
        bookedAt(at("10:15"), "lead-2"),
      ],
    });
    assert.equal(
      await isSlotAvailable(ORG_ID, at("10:30"), { excludeLeadId: "lead-1" }),
      false
    );
  });
});

describe("fail closed — an unchecked slot is never a free one", () => {
  test("a failed capacity read refuses the slot", async () => {
    // Was `return true` — "don't block bookings on a query error" —
    // which turned a database blip into a confirmed booking.
    stubs = installStubs({ leadsFail: true });
    assert.equal(await isSlotAvailable(ORG_ID, at("10:00")), false);
  });

  test("and says WHY, so nobody is told a slot is fully booked", async () => {
    stubs = installStubs({ leadsFail: true });
    assert.deepEqual(await checkSlotCapacity(ORG_ID, at("10:00")), {
      available: false,
      failed: true,
    });
  });

  test("a genuine clash is reported as a clash, not a failure", async () => {
    stubs = installStubs({ bookedLeads: [bookedAt(at("10:00"))] });
    assert.deepEqual(await checkSlotCapacity(ORG_ID, at("10:00")), {
      available: false,
      failed: false,
    });
  });

  test("a free slot reads clean", async () => {
    stubs = installStubs({ bookedLeads: [] });
    assert.deepEqual(await checkSlotCapacity(ORG_ID, at("10:00")), {
      available: true,
      failed: false,
    });
  });

  test("an unparseable instant is refused, not waved through", async () => {
    stubs = installStubs();
    assert.equal(await isSlotAvailable(ORG_ID, "not-a-real-instant"), false);
  });

  test("a failed business-hours read refuses, and is distinguishable", async () => {
    stubs = installStubs({ hoursFail: true });
    const result = await isWithinBusinessHours(ORG_ID, at("10:00"));
    assert.equal(result.isAvailable, false);
    assert.equal(result.reason, "lookup_failed");
  });

  test("no hours CONFIGURED still fails OPEN — that is a real state", async () => {
    // The distinction the whole fix rests on: an empty table is a
    // business that has not finished setup and must still take
    // bookings; a failed read tells us nothing at all.
    stubs = installStubs({ hours: [] });
    const result = await isWithinBusinessHours(ORG_ID, at("10:00"));
    assert.equal(result.isAvailable, true);
    assert.equal(result.reason, "no_hours_configured");
  });

  test("a failed hours read offers no alternative rather than a made-up one", async () => {
    stubs = installStubs({ hoursFail: true });
    assert.equal(await findNextAvailableSlot(ORG_ID, at("10:00")), null);
  });

  test("an unconfigured diary still suggests the requested time", async () => {
    stubs = installStubs({ hours: [] });
    assert.equal(
      await findNextAvailableSlot(ORG_ID, at("10:00")),
      at("10:00")
    );
  });
});
