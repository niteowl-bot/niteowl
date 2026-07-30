// Regression tests for business-hours availability validation.
//
// Guards the bug where Monday 18:45 was rejected as "outside business
// hours" against a 09:00-19:00 Monday, and the opposite latent bug where
// an appointment could be booked past closing time with no complaint.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  installStubs,
  ORG_ID,
  REPORTED_HOURS,
  SUNDAY_1400,
  MONDAY_0830,
  MONDAY_1600,
  MONDAY_1800,
  MONDAY_1830,
  MONDAY_1845,
  MONDAY_1900,
  TUESDAY_1845,
  londonWeekday,
  londonHhMm,
} from "./support.mjs";

import { isWithinBusinessHours, findNextAvailableSlot } from "@/lib/availability";

let stubs;
afterEach(() => stubs?.restore());

// Sanity-check the fixture dates themselves, so a wrong constant can never
// make a later assertion pass for the wrong reason.
describe("fixture dates", () => {
  test("the fixture dates really are Sunday, Monday and Tuesday", () => {
    assert.equal(londonWeekday(SUNDAY_1400), 0, "2026-08-02 should be Sunday");
    assert.equal(londonWeekday(MONDAY_1845), 1, "2026-08-03 should be Monday");
    assert.equal(londonWeekday(TUESDAY_1845), 2, "2026-08-04 should be Tuesday");
  });

  test("18:45 stays 18:45 in Europe/London under BST", () => {
    assert.equal(londonHhMm(MONDAY_1845), "18:45");
  });
});

describe("isWithinBusinessHours — Monday closes at 19:00", () => {
  test("Monday 16:00 with a 60-minute appointment is accepted", async () => {
    stubs = installStubs({ appointmentDurationMinutes: 60 });
    const result = await isWithinBusinessHours(ORG_ID, MONDAY_1600);
    assert.equal(result.isAvailable, true);
    assert.equal(result.reason, undefined);
  });

  test("Monday 18:00 with a 60-minute appointment is accepted (ends exactly at 19:00)", async () => {
    stubs = installStubs({ appointmentDurationMinutes: 60 });
    const result = await isWithinBusinessHours(ORG_ID, MONDAY_1800);
    assert.equal(result.isAvailable, true);
    assert.equal(result.reason, undefined);
  });

  test("Monday 18:30 with a 60-minute appointment is rejected for finishing after closing", async () => {
    stubs = installStubs({ appointmentDurationMinutes: 60 });
    const result = await isWithinBusinessHours(ORG_ID, MONDAY_1830);
    assert.equal(result.isAvailable, false);
    assert.equal(result.reason, "ends_after_close");
    assert.equal(result.minutesUntilClose, 30);
    assert.equal(result.appointmentDurationMinutes, 60);
  });

  test("Monday 18:45 with a 60-minute appointment is rejected for finishing after closing", async () => {
    stubs = installStubs({ appointmentDurationMinutes: 60 });
    const result = await isWithinBusinessHours(ORG_ID, MONDAY_1845);
    assert.equal(result.isAvailable, false);
    assert.equal(result.reason, "ends_after_close");
    assert.equal(result.minutesUntilClose, 15);
    assert.equal(result.appointmentDurationMinutes, 60);
  });

  test("Monday 18:45 with a 15-minute appointment is accepted (fits before 19:00)", async () => {
    stubs = installStubs({ appointmentDurationMinutes: 15 });
    const result = await isWithinBusinessHours(ORG_ID, MONDAY_1845);
    assert.equal(result.isAvailable, true);
    assert.equal(result.reason, undefined);
  });

  test("Monday 19:00 is rejected — at closing time, not within hours", async () => {
    stubs = installStubs({ appointmentDurationMinutes: 60 });
    const result = await isWithinBusinessHours(ORG_ID, MONDAY_1900);
    assert.equal(result.isAvailable, false);
    assert.equal(result.reason, "outside_hours");
  });

  test("Monday 08:30 is rejected — before opening", async () => {
    stubs = installStubs({ appointmentDurationMinutes: 60 });
    const result = await isWithinBusinessHours(ORG_ID, MONDAY_0830);
    assert.equal(result.isAvailable, false);
    assert.equal(result.reason, "outside_hours");
  });
});

describe("isWithinBusinessHours — other days keep their own hours", () => {
  test("Tuesday 18:45 is rejected because Tuesday closes at 17:00", async () => {
    stubs = installStubs({ appointmentDurationMinutes: 60 });
    const result = await isWithinBusinessHours(ORG_ID, TUESDAY_1845);
    assert.equal(result.isAvailable, false);
    assert.equal(result.reason, "outside_hours");
  });

  test("Sunday is rejected because Sunday is closed", async () => {
    stubs = installStubs({ appointmentDurationMinutes: 60 });
    const result = await isWithinBusinessHours(ORG_ID, SUNDAY_1400);
    assert.equal(result.isAvailable, false);
    assert.equal(result.reason, "closed_day");
  });

  test("the engine reads the business_hours table", async () => {
    stubs = installStubs({ appointmentDurationMinutes: 60 });
    await isWithinBusinessHours(ORG_ID, MONDAY_1600);
    assert.ok(stubs.calls.business_hours > 0, "business_hours was never queried");
  });

  test("Monday's later close is honoured only on Monday, from one shared config", async () => {
    // Same hours fixture for both calls: 18:45 differs between the two days
    // purely because each day's own row is read.
    stubs = installStubs({ appointmentDurationMinutes: 15 });
    const monday = await isWithinBusinessHours(ORG_ID, MONDAY_1845);
    const tuesday = await isWithinBusinessHours(ORG_ID, TUESDAY_1845);
    assert.equal(monday.isAvailable, true, "Monday closes 19:00, so 18:45 fits");
    assert.equal(tuesday.isAvailable, false, "Tuesday closes 17:00");
  });
});

describe("the two rejection reasons are distinguishable", () => {
  test("'outside business hours' and 'finishes after closing' are separate reasons", async () => {
    stubs = installStubs({ appointmentDurationMinutes: 60 });

    // Same wall-clock time, same duration — different reason, because on
    // Monday the start is inside opening hours and only the end overruns.
    const insideHoursButOverruns = await isWithinBusinessHours(ORG_ID, MONDAY_1845);
    const genuinelyOutsideHours = await isWithinBusinessHours(ORG_ID, TUESDAY_1845);

    assert.equal(insideHoursButOverruns.reason, "ends_after_close");
    assert.equal(genuinelyOutsideHours.reason, "outside_hours");
    assert.notEqual(insideHoursButOverruns.reason, genuinelyOutsideHours.reason);

    // The overrun case must carry the numbers needed to explain itself,
    // and must never be reported as the requested time being outside hours.
    assert.equal(insideHoursButOverruns.minutesUntilClose, 15);
    assert.equal(insideHoursButOverruns.appointmentDurationMinutes, 60);
    assert.equal(genuinelyOutsideHours.minutesUntilClose, undefined);
  });

  test("a closed day is not reported as an overrun", async () => {
    stubs = installStubs({ appointmentDurationMinutes: 60 });
    const result = await isWithinBusinessHours(ORG_ID, SUNDAY_1400);
    assert.equal(result.reason, "closed_day");
    assert.notEqual(result.reason, "ends_after_close");
  });
});

describe("findNextAvailableSlot", () => {
  test("never suggests a slot that would itself finish after closing", async () => {
    stubs = installStubs({ appointmentDurationMinutes: 60 });
    const suggested = await findNextAvailableSlot(ORG_ID, MONDAY_1845);
    assert.ok(suggested, "expected a suggestion within the search window");

    // Whatever it offers must pass the same validation Remy applies next.
    const revalidated = await isWithinBusinessHours(ORG_ID, suggested);
    assert.equal(
      revalidated.isAvailable,
      true,
      `suggested ${suggested} but that slot is not itself bookable (${revalidated.reason})`
    );
  });

  test("emergency mode bypasses the hours check entirely", async () => {
    // Guards the existing 24/7 escape hatch against the new end-time check.
    stubs = installStubs({ appointmentDurationMinutes: 60, emergencyModeEnabled: true });
    const result = await isWithinBusinessHours(ORG_ID, SUNDAY_1400);
    assert.equal(result.isAvailable, true);
  });

  test("no configured hours still fails open", async () => {
    stubs = installStubs({ hours: [], appointmentDurationMinutes: 60 });
    const result = await isWithinBusinessHours(ORG_ID, SUNDAY_1400);
    assert.equal(result.isAvailable, true);
    assert.equal(result.reason, "no_hours_configured");
  });
});

// Referenced so an accidental fixture edit is visible in one place.
test("fixture models the reported configuration", () => {
  const monday = REPORTED_HOURS.find((h) => h.day_of_week === 1);
  const tuesday = REPORTED_HOURS.find((h) => h.day_of_week === 2);
  const sunday = REPORTED_HOURS.find((h) => h.day_of_week === 0);
  assert.equal(monday.close_time, "19:00:00");
  assert.equal(tuesday.close_time, "17:00:00");
  assert.equal(sunday.is_closed, true);
});
