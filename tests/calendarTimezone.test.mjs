// Tests for per-organisation timezone handling.
//
// The dangerous case these exist for: an appointment written to Google
// as a fixed UTC offset instead of local time plus an IANA zone. It
// looks correct until a daylight-saving transition, after which every
// affected booking is an hour out. The 2026 Europe/London transitions
// (29 March, 25 October) are used as the worked examples.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  isValidTimezone,
  canonicaliseTimezone,
  listSupportedTimezones,
  toProviderLocalTime,
  addMinutesIso,
  offsetMinutesAt,
  crossesDstTransition,
  DEFAULT_ORG_TIMEZONE,
} from "@/lib/calendar/timezone";

describe("timezone validation", () => {
  test("real IANA zones are accepted", () => {
    for (const zone of [
      "Europe/London",
      "Europe/Dublin",
      "America/New_York",
      "Asia/Tokyo",
      "Australia/Sydney",
      "UTC",
    ]) {
      assert.equal(isValidTimezone(zone), true, zone);
    }
  });

  test("nonsense is rejected before it can be stored", () => {
    for (const bad of ["", "   ", "GMT+1", "Europe/Atlantis", null, undefined, 42]) {
      assert.equal(isValidTimezone(bad), false, String(bad));
    }
  });

  test("legacy abbreviations are rejected — Intl resolves them to the wrong place", () => {
    // The trap this guards: Intl ACCEPTS "BST" and silently resolves it
    // to Asia/Dhaka (UTC+6), and "EST" to America/Panama. An owner
    // picking "BST" for British Summer Time would have every appointment
    // six hours out, with no error raised anywhere. Validity is therefore
    // membership of Intl's canonical list, not "Intl accepted it".
    for (const abbreviation of ["BST", "EST", "PST", "CET", "GMT", "EST5EDT"]) {
      assert.equal(isValidTimezone(abbreviation), false, abbreviation);
    }
    // Proof of the underlying hazard, so this test explains itself if the
    // implementation is ever loosened back to a try/catch.
    const resolved = new Intl.DateTimeFormat("en-GB", { timeZone: "BST" })
      .resolvedOptions().timeZone;
    assert.equal(resolved, "Asia/Dhaka");
  });

  test("zone names are canonicalised for storage", () => {
    assert.equal(canonicaliseTimezone("europe/london"), "Europe/London");
    assert.equal(canonicaliseTimezone("  Europe/Dublin  "), "Europe/Dublin");
    assert.equal(canonicaliseTimezone("America/New_York"), "America/New_York");
    // An invalid zone returns null rather than quietly defaulting.
    assert.equal(canonicaliseTimezone("BST"), null);
    assert.equal(canonicaliseTimezone("Europe/Atlantis"), null);
  });

  test("the Settings dropdown has a usable list of real zones", () => {
    const zones = listSupportedTimezones();
    assert.ok(zones.length > 300, `expected hundreds of zones, got ${zones.length}`);
    assert.ok(zones.includes("Europe/London"));
    assert.ok(zones.includes("Europe/Dublin"));
    assert.ok(!zones.includes("BST"));
    // Sorted, so the dropdown renders predictably.
    assert.deepEqual(zones, [...zones].sort());
  });

  test("case-insensitive input is still valid", () => {
    assert.equal(isValidTimezone("europe/london"), true);
    assert.equal(isValidTimezone("EUROPE/LONDON"), true);
    assert.equal(isValidTimezone("UTC"), true);
    assert.equal(isValidTimezone("utc"), true);
  });

  test("the default mirrors the column default", () => {
    assert.equal(DEFAULT_ORG_TIMEZONE, "Europe/London");
    assert.equal(isValidTimezone(DEFAULT_ORG_TIMEZONE), true);
  });
});

describe("local time sent to providers", () => {
  test("no offset and no Z — the zone travels separately", () => {
    const local = toProviderLocalTime("2026-08-06T13:00:00.000Z", "Europe/London");
    assert.equal(local, "2026-08-06T14:00:00");
    assert.ok(!local.endsWith("Z"));
    assert.ok(!/[+-]\d\d:\d\d$/.test(local));
  });

  test("British Summer Time is applied in summer", () => {
    // 13:00 UTC in August is 14:00 in London (BST, UTC+1).
    assert.equal(
      toProviderLocalTime("2026-08-06T13:00:00.000Z", "Europe/London"),
      "2026-08-06T14:00:00"
    );
  });

  test("Greenwich Mean Time is applied in winter", () => {
    assert.equal(
      toProviderLocalTime("2026-01-15T13:00:00.000Z", "Europe/London"),
      "2026-01-15T13:00:00"
    );
  });

  test("the same instant renders correctly in other zones", () => {
    const instant = "2026-08-06T13:00:00.000Z";
    assert.equal(toProviderLocalTime(instant, "America/New_York"), "2026-08-06T09:00:00");
    assert.equal(toProviderLocalTime(instant, "Asia/Tokyo"), "2026-08-06T22:00:00");
    assert.equal(toProviderLocalTime(instant, "UTC"), "2026-08-06T13:00:00");
  });

  test("midnight renders as 00, never 24", () => {
    assert.equal(
      toProviderLocalTime("2026-01-15T00:00:00.000Z", "Europe/London"),
      "2026-01-15T00:00:00"
    );
  });

  test("invalid input is refused rather than silently shifted", () => {
    assert.throws(() => toProviderLocalTime("not-a-date", "Europe/London"), RangeError);
    assert.throws(() => toProviderLocalTime("2026-08-06T13:00:00Z", "Mars/Olympus"), RangeError);
  });
});

describe("daylight saving transitions (Europe/London 2026)", () => {
  // BST begins 29 March 2026 at 01:00 UTC; ends 25 October at 01:00 UTC.
  test("spring forward: the offset changes at the transition", () => {
    assert.equal(offsetMinutesAt("2026-03-29T00:30:00.000Z", "Europe/London"), 0);
    assert.equal(offsetMinutesAt("2026-03-29T02:30:00.000Z", "Europe/London"), 60);
  });

  test("spring forward: 01:30 local never happens, and is not invented", () => {
    // 00:30 UTC is 00:30 GMT; 01:30 UTC is 02:30 BST. Local 01:30 is skipped.
    assert.equal(
      toProviderLocalTime("2026-03-29T00:30:00.000Z", "Europe/London"),
      "2026-03-29T00:30:00"
    );
    assert.equal(
      toProviderLocalTime("2026-03-29T01:30:00.000Z", "Europe/London"),
      "2026-03-29T02:30:00"
    );
  });

  test("autumn back: the ambiguous local hour maps from two instants", () => {
    // Both of these are 01:30 local — this is precisely why a local time
    // alone is not enough and the zone must travel with it.
    assert.equal(
      toProviderLocalTime("2026-10-25T00:30:00.000Z", "Europe/London"),
      "2026-10-25T01:30:00"
    );
    assert.equal(
      toProviderLocalTime("2026-10-25T01:30:00.000Z", "Europe/London"),
      "2026-10-25T01:30:00"
    );
    assert.equal(offsetMinutesAt("2026-10-25T00:30:00.000Z", "Europe/London"), 60);
    assert.equal(offsetMinutesAt("2026-10-25T01:30:00.000Z", "Europe/London"), 0);
  });

  test("an appointment straddling a transition is detected", () => {
    // 00:30 UTC + 60 min crosses the autumn transition at 01:00 UTC.
    assert.equal(
      crossesDstTransition("2026-10-25T00:30:00.000Z", 60, "Europe/London"),
      true
    );
    assert.equal(
      crossesDstTransition("2026-03-29T00:30:00.000Z", 60, "Europe/London"),
      true
    );
    assert.equal(
      crossesDstTransition("2026-08-06T13:00:00.000Z", 60, "Europe/London"),
      false
    );
  });

  test("zones without daylight saving never report a crossing", () => {
    assert.equal(offsetMinutesAt("2026-03-29T00:30:00.000Z", "Asia/Tokyo"), 540);
    assert.equal(offsetMinutesAt("2026-10-25T01:30:00.000Z", "Asia/Tokyo"), 540);
    assert.equal(crossesDstTransition("2026-10-25T00:30:00.000Z", 60, "Asia/Tokyo"), false);
  });

  test("southern-hemisphere transitions go the other way", () => {
    // Sydney is UTC+11 in January (AEDT) and UTC+10 in July (AEST).
    assert.equal(offsetMinutesAt("2026-01-15T00:00:00.000Z", "Australia/Sydney"), 660);
    assert.equal(offsetMinutesAt("2026-07-15T00:00:00.000Z", "Australia/Sydney"), 600);
  });
});

describe("duration arithmetic", () => {
  test("minutes are added to the instant, not the wall clock", () => {
    // Across spring forward: 00:30 UTC + 60 min = 01:30 UTC = 02:30 local.
    // A wall-clock addition would have produced the non-existent 01:30.
    const end = addMinutesIso("2026-03-29T00:30:00.000Z", 60);
    assert.equal(end, "2026-03-29T01:30:00.000Z");
    assert.equal(toProviderLocalTime(end, "Europe/London"), "2026-03-29T02:30:00");
  });

  test("a one-hour appointment is always 3,600,000 ms long", () => {
    for (const start of [
      "2026-03-29T00:30:00.000Z",
      "2026-10-25T00:30:00.000Z",
      "2026-08-06T13:00:00.000Z",
    ]) {
      const end = addMinutesIso(start, 60);
      assert.equal(new Date(end).getTime() - new Date(start).getTime(), 3_600_000, start);
    }
  });

  test("negative and zero offsets work", () => {
    assert.equal(addMinutesIso("2026-08-06T13:00:00.000Z", 0), "2026-08-06T13:00:00.000Z");
    assert.equal(addMinutesIso("2026-08-06T13:00:00.000Z", -90), "2026-08-06T11:30:00.000Z");
  });

  test("invalid input is refused", () => {
    assert.throws(() => addMinutesIso("nope", 30), RangeError);
    assert.throws(() => addMinutesIso("2026-08-06T13:00:00Z", Number.NaN), RangeError);
  });
});
