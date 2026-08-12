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

import {
  isWithinBusinessHours,
  findNextAvailableSlot,
  getBusinessHoursSummary,
} from "@/lib/availability";

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

describe("getBusinessHoursSummary — what the chat assistant is told", () => {
  test("exposes the configured hours, so Remy can answer closing-time questions", async () => {
    stubs = installStubs({ appointmentDurationMinutes: 60 });
    const summary = await getBusinessHoursSummary(ORG_ID);

    assert.equal(summary.hasConfiguredHours, true);
    assert.equal(summary.appointmentDurationMinutes, 60);
    // Monday's real close time must be stated, not a Knowledge Base value.
    assert.ok(
      summary.lines.some((l) => l === "Monday: 09:00 to 19:00"),
      `Monday's configured hours missing from: ${JSON.stringify(summary.lines)}`
    );
    assert.ok(summary.lines.some((l) => l === "Tuesday: 09:00 to 17:00"));
    assert.ok(summary.lines.some((l) => l === "Sunday: closed"));
  });

  test("reads the same business_hours rows the validator uses", async () => {
    stubs = installStubs({ appointmentDurationMinutes: 60 });
    await getBusinessHoursSummary(ORG_ID);
    assert.ok(stubs.calls.business_hours > 0, "business_hours was never queried");
  });

  test("lists days Monday first", async () => {
    stubs = installStubs({ appointmentDurationMinutes: 60 });
    const { lines } = await getBusinessHoursSummary(ORG_ID);
    assert.match(lines[0], /^Monday:/);
    assert.match(lines.at(-1), /^Sunday:/);
  });

  test("a changed closing time is reflected immediately", async () => {
    // Mirrors the owner editing Monday to 19:30 in Settings: no cache, so
    // the very next message sees it.
    stubs = installStubs({
      appointmentDurationMinutes: 60,
      hours: REPORTED_HOURS.map((h) =>
        h.day_of_week === 1 ? { ...h, close_time: "19:30:00" } : h
      ),
    });
    const { lines } = await getBusinessHoursSummary(ORG_ID);
    assert.ok(lines.some((l) => l === "Monday: 09:00 to 19:30"));
  });

  test("reports a lunch break", async () => {
    stubs = installStubs({
      hours: [
        {
          day_of_week: 1,
          is_closed: false,
          open_time: "09:00:00",
          close_time: "19:00:00",
          lunch_start: "13:00:00",
          lunch_end: "14:00:00",
        },
      ],
    });
    const { lines } = await getBusinessHoursSummary(ORG_ID);
    assert.equal(lines[0], "Monday: 09:00 to 19:00 (closed for lunch 13:00 to 14:00)");
  });

  test("a day with no row is stated as closed, matching the validator", async () => {
    // isWithinBusinessHours treats a missing row as closed_day. Omitting the
    // day instead would let the assistant invent hours for it.
    stubs = installStubs({
      hours: [
        { day_of_week: 1, is_closed: false, open_time: "09:00:00", close_time: "19:30:00" },
      ],
    });
    const { lines } = await getBusinessHoursSummary(ORG_ID);
    assert.equal(lines.length, 7, "every day should be accounted for");
    assert.equal(lines[0], "Monday: 09:00 to 19:30");
    for (const day of ["Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
      assert.ok(lines.includes(`${day}: closed`), `${day} should be stated as closed`);
    }

    // And the two must actually agree.
    const tuesday = await isWithinBusinessHours(ORG_ID, TUESDAY_1845);
    assert.equal(tuesday.reason, "closed_day");
  });

  test("emergency mode is surfaced so no time is called out-of-hours", async () => {
    stubs = installStubs({ emergencyModeEnabled: true });
    const summary = await getBusinessHoursSummary(ORG_ID);
    assert.equal(summary.emergencyModeEnabled, true);
  });

  test("an org with no configured hours is reported as such, not as closed", async () => {
    stubs = installStubs({ hours: [] });
    const summary = await getBusinessHoursSummary(ORG_ID);
    assert.equal(summary.hasConfiguredHours, false);
    assert.deepEqual(summary.lines, []);
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

// ══════════════════════════════════════════════════════════════════
//  REGRESSION — business hours belong to the BUSINESS's clock
// ══════════════════════════════════════════════════════════════════
//
// "09:00-17:00" is a wall-clock string. It means nothing until you know
// whose clock it is on, and the engine used to assume London's.
//
// getZonedParts (formerly getLondonParts) took a timezone parameter that
// defaulted to Europe/London, and NEITHER call site ever passed one. So
// the requested instant was parsed in the org's real zone — correctly —
// and then judged in London. For a London business the wrong zone is the
// right answer, which is exactly why this survived: production has only
// London orgs, and every existing test above is a London org.
//
// The concrete failure: a New York business asking for 06:00 local, three
// hours before it opens, resolves to 11:00 London, lands inside
// 09:00-17:00, and was ACCEPTED.

/** A New York business, open 09:00-17:00 on its OWN clock, Mon-Fri. */
const NY_HOURS = [
  { day_of_week: 0, is_closed: true, open_time: null, close_time: null },
  ...[1, 2, 3, 4, 5].map((day_of_week) => ({
    day_of_week,
    is_closed: false,
    open_time: "09:00:00",
    close_time: "17:00:00",
  })),
  { day_of_week: 6, is_closed: true, open_time: null, close_time: null },
];

// Monday 3 August 2026, given as explicit UTC so the instant is
// unambiguous. New York is UTC-4 that day (EDT), London UTC+1 (BST).
const NY_MON_0600 = "2026-08-03T10:00:00Z"; // 06:00 New York — BEFORE it opens
const NY_MON_1200 = "2026-08-03T16:00:00Z"; // 12:00 New York — mid-morning trade
const NY_MON_1630 = "2026-08-03T20:30:00Z"; // 16:30 New York — would end 17:30

describe("REGRESSION — business hours use the org timezone, not London", () => {
  test("A. a London org is completely unchanged", async () => {
    // The guard on the whole change: every existing assertion in this
    // file is a London org, and none of them may move.
    stubs = installStubs({ orgTimezone: "Europe/London" });
    assert.equal((await isWithinBusinessHours(ORG_ID, MONDAY_1600)).isAvailable, true);
    assert.equal((await isWithinBusinessHours(ORG_ID, MONDAY_0830)).isAvailable, false);
    assert.equal((await isWithinBusinessHours(ORG_ID, SUNDAY_1400)).isAvailable, false);
  });

  test("B/E. a New York org accepts its own 12:00", async () => {
    stubs = installStubs({ orgTimezone: "America/New_York", hours: NY_HOURS });
    const result = await isWithinBusinessHours(ORG_ID, NY_MON_1200);
    assert.equal(result.isAvailable, true, "midday in New York is inside 09:00-17:00 there");
  });

  test("D. THE BUG — 06:00 New York is refused, not accepted", async () => {
    // 06:00 New York = 11:00 London. Judged on London's clock this sat
    // inside 09:00-17:00 and was accepted, three hours before the
    // business opened.
    stubs = installStubs({ orgTimezone: "America/New_York", hours: NY_HOURS });
    const result = await isWithinBusinessHours(ORG_ID, NY_MON_0600);
    assert.equal(result.isAvailable, false, "06:00 is before this business opens");
    assert.equal(result.reason, "outside_hours");
  });

  test("F. an appointment finishing after closing is still refused", async () => {
    // 16:30 New York + 60 minutes runs past the 17:00 close. The reason
    // must stay distinguishable from "outside_hours" — the start time is
    // fine, it is the length that does not fit.
    stubs = installStubs({ orgTimezone: "America/New_York", hours: NY_HOURS });
    const result = await isWithinBusinessHours(ORG_ID, NY_MON_1630);
    assert.equal(result.isAvailable, false);
    assert.equal(result.reason, "ends_after_close");
  });

  test("C/H. the SAME instant is judged differently for two orgs", async () => {
    // The defect in one assertion, and the tenant-isolation proof: one
    // UTC instant, two businesses, two correct answers. 16:00Z is 17:00
    // London (closed on a Tuesday) and 12:00 New York (open).
    const instant = "2026-08-04T16:00:00Z";

    stubs = installStubs({ orgTimezone: "Europe/London" });
    const london = await isWithinBusinessHours(ORG_ID, instant);
    stubs.restore();

    stubs = installStubs({ orgTimezone: "America/New_York", hours: NY_HOURS });
    const newYork = await isWithinBusinessHours(ORG_ID, instant);

    assert.equal(london.isAvailable, false, "17:00 London is at the Tuesday close");
    assert.equal(newYork.isAvailable, true, "the same instant is 12:00 in New York");
    assert.notEqual(
      london.isAvailable,
      newYork.isAvailable,
      "one instant cannot have one answer for every tenant"
    );
  });

  test("G. DST — the SAME local time works either side of a transition", async () => {
    // New York leaves EDT on 1 November 2026, London leaves BST on 25
    // October. Between those dates the gap is 4 hours, not the usual 5 —
    // the window where hand-rolled offset arithmetic silently drifts.
    // 12:00 New York must be inside opening hours on both dates.
    stubs = installStubs({ orgTimezone: "America/New_York", hours: NY_HOURS });

    const beforeUsDst = await isWithinBusinessHours(ORG_ID, "2026-10-28T16:00:00Z"); // 12:00 EDT
    const afterUsDst = await isWithinBusinessHours(ORG_ID, "2026-11-04T17:00:00Z"); // 12:00 EST

    assert.equal(beforeUsDst.isAvailable, true, "12:00 New York under EDT");
    assert.equal(afterUsDst.isAvailable, true, "12:00 New York under EST");
  });

  test("G2. a half-hour zone is handled by IANA rules, not offset maths", async () => {
    // Asia/Kolkata is UTC+5:30. 09:30Z is 15:00 there — open — while the
    // same instant is 10:30 London. A whole-hour assumption breaks here.
    stubs = installStubs({ orgTimezone: "Asia/Kolkata", hours: NY_HOURS });
    const result = await isWithinBusinessHours(ORG_ID, "2026-08-03T09:30:00Z");
    assert.equal(result.isAvailable, true, "15:00 in Kolkata is inside 09:00-17:00");
  });
});

describe("REGRESSION — an unresolvable timezone never reports available", () => {
  test("I. a missing org timezone refuses rather than assuming London", async () => {
    // The whole point: Europe/London is not a safe default for a booking
    // DECISION. Substituting it is what accepted 06:00 in New York.
    stubs = installStubs({ orgTimezone: null });
    const result = await isWithinBusinessHours(ORG_ID, MONDAY_1600);
    assert.equal(result.isAvailable, false, "a slot we cannot judge is not a free slot");
    assert.equal(
      result.reason,
      "lookup_failed",
      "and it must say 'could not check', never 'outside opening hours'"
    );
  });

  test("I2. an unusable timezone value refuses too", async () => {
    // "BST" is an abbreviation Intl resolves to Asia/Dhaka — the exact
    // silent-wrong-zone failure isValidTimezone exists to catch.
    stubs = installStubs({ orgTimezone: "BST" });
    const result = await isWithinBusinessHours(ORG_ID, MONDAY_1600);
    assert.equal(result.isAvailable, false);
    assert.equal(result.reason, "lookup_failed");
  });

  test("I3. no alternative is suggested when the zone is unknown", async () => {
    // findNextAvailableSlot walks opening hours, so without a zone it
    // cannot honestly propose anything. Null means "offer nothing",
    // never a fabricated time.
    stubs = installStubs({ orgTimezone: null });
    assert.equal(await findNextAvailableSlot(ORG_ID, MONDAY_0830), null);
  });
});
