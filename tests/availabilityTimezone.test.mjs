// The organisation's timezone drives the slot grid, not Europe/London.
//
// getLondonParts has accepted a timezone since the calendar work, but
// its two callers — isWithinBusinessHours and findNextAvailableSlot —
// never passed one, so every business's opening hours were measured
// against a London clock. For a business in New York, "09:00–17:00"
// was silently being read as 09:00–17:00 London: 04:00–12:00 local.
//
// Both now resolve the zone through getOrgTimezone(orgId), which is the
// same lookup the voice availability tool already used, and which falls
// back to Europe/London when the column is missing, null or unusable.
//
// DST is handled by Intl throughout — no fixed offsets are added or
// subtracted anywhere in this path.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installStubs, ORG_ID } from "./support.mjs";
import {
  isWithinBusinessHours,
  findNextAvailableSlot,
} from "@/lib/availability";

let stubs;
afterEach(() => stubs?.restore());

/** Open 09:00–17:00 in the org's own local time, every day. */
const ALWAYS_OPEN_9_TO_5 = [0, 1, 2, 3, 4, 5, 6].map((day_of_week) => ({
  day_of_week,
  is_closed: false,
  open_time: "09:00",
  close_time: "17:00",
  lunch_start: null,
  lunch_end: null,
}));

/** The local wall-clock reading of an instant, in a given zone. */
function localTime(iso, timeZone) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function localDate(iso, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

describe("business hours are read in the organisation's zone", () => {
  // 2026-08-12T14:00Z is 15:00 in London/Dublin (BST/IST), 10:00 in
  // New York (EDT) and 21:00 in Bangkok (ICT, no DST).
  const INSTANT = "2026-08-12T14:00:00.000Z";

  test("Europe/London is unchanged — inside 09:00–17:00", async () => {
    stubs = installStubs({ hours: ALWAYS_OPEN_9_TO_5, timezone: "Europe/London" });
    const result = await isWithinBusinessHours(ORG_ID, INSTANT);
    assert.equal(result.isAvailable, true, "15:00 London is open");
  });

  test("no timezone configured behaves exactly like Europe/London", async () => {
    // The fallback path: column missing, null, or unusable.
    stubs = installStubs({ hours: ALWAYS_OPEN_9_TO_5 });
    const result = await isWithinBusinessHours(ORG_ID, INSTANT);
    assert.equal(result.isAvailable, true);
  });

  test("an unusable timezone falls back to Europe/London, not to an error", async () => {
    stubs = installStubs({ hours: ALWAYS_OPEN_9_TO_5, timezone: "BST" });
    const result = await isWithinBusinessHours(ORG_ID, INSTANT);
    assert.equal(result.isAvailable, true, "abbreviations are refused, London used");
  });

  test("Europe/Dublin matches London for this instant", async () => {
    stubs = installStubs({ hours: ALWAYS_OPEN_9_TO_5, timezone: "Europe/Dublin" });
    const result = await isWithinBusinessHours(ORG_ID, INSTANT);
    assert.equal(result.isAvailable, true, "15:00 Dublin is open");
  });

  test("America/New_York reads the same instant as 10:00 local — open", async () => {
    stubs = installStubs({ hours: ALWAYS_OPEN_9_TO_5, timezone: "America/New_York" });
    assert.equal(localTime(INSTANT, "America/New_York"), "10:00");
    const result = await isWithinBusinessHours(ORG_ID, INSTANT);
    assert.equal(result.isAvailable, true);
  });

  test("Asia/Bangkok reads it as 21:00 local — closed", async () => {
    // The case that proves the zone is really being used: identical
    // instant, identical hours, opposite answer.
    stubs = installStubs({ hours: ALWAYS_OPEN_9_TO_5, timezone: "Asia/Bangkok" });
    assert.equal(localTime(INSTANT, "Asia/Bangkok"), "21:00");
    const result = await isWithinBusinessHours(ORG_ID, INSTANT);
    assert.equal(result.isAvailable, false);
    assert.equal(result.reason, "outside_hours");
  });

  test("and London would call that same instant open — the two now differ", async () => {
    stubs = installStubs({ hours: ALWAYS_OPEN_9_TO_5, timezone: "Europe/London" });
    const london = await isWithinBusinessHours(ORG_ID, INSTANT);
    stubs.restore();
    stubs = installStubs({ hours: ALWAYS_OPEN_9_TO_5, timezone: "Asia/Bangkok" });
    const bangkok = await isWithinBusinessHours(ORG_ID, INSTANT);
    assert.notEqual(london.isAvailable, bangkok.isAvailable);
  });

  test("opening and closing edges are the org's local clock", async () => {
    // 13:00Z is 09:00 New York — exactly opening.
    stubs = installStubs({ hours: ALWAYS_OPEN_9_TO_5, timezone: "America/New_York" });
    const atOpen = await isWithinBusinessHours(ORG_ID, "2026-08-12T13:00:00.000Z");
    assert.equal(atOpen.isAvailable, true, "09:00 local is open");
    stubs.restore();

    // 20:00Z is 16:00 New York; a 60-minute appointment ends at 17:00,
    // exactly closing — allowed. 21:00Z (17:00 local) is not.
    stubs = installStubs({ hours: ALWAYS_OPEN_9_TO_5, timezone: "America/New_York" });
    const lastSlot = await isWithinBusinessHours(ORG_ID, "2026-08-12T20:00:00.000Z");
    assert.equal(lastSlot.isAvailable, true, "16:00 local finishes at close");
    stubs.restore();

    stubs = installStubs({ hours: ALWAYS_OPEN_9_TO_5, timezone: "America/New_York" });
    const past = await isWithinBusinessHours(ORG_ID, "2026-08-12T21:00:00.000Z");
    assert.equal(past.isAvailable, false, "17:00 local is closed");
  });
});

describe("the slot grid is walked in the organisation's zone", () => {
  test("a New York org gets slots on New York business hours", async () => {
    // 02:00Z is 22:00 the previous evening in New York — shut. The next
    // slot must land inside 09:00–17:00 New York time.
    stubs = installStubs({
      hours: ALWAYS_OPEN_9_TO_5,
      timezone: "America/New_York",
    });
    const slot = await findNextAvailableSlot(ORG_ID, "2026-08-12T02:00:00.000Z");
    assert.ok(slot, "a slot should be found");
    const local = localTime(slot, "America/New_York");
    const hour = Number(local.slice(0, 2));
    assert.ok(hour >= 9 && hour < 17, `${local} New York is outside 09:00–17:00`);
  });

  test("the same instant for a London org lands on London hours", async () => {
    stubs = installStubs({ hours: ALWAYS_OPEN_9_TO_5, timezone: "Europe/London" });
    const slot = await findNextAvailableSlot(ORG_ID, "2026-08-12T02:00:00.000Z");
    assert.ok(slot);
    const hour = Number(localTime(slot, "Europe/London").slice(0, 2));
    assert.ok(hour >= 9 && hour < 17, "inside London hours");
  });

  test("Asia/Bangkok slots land on Bangkok hours, not London ones", async () => {
    stubs = installStubs({ hours: ALWAYS_OPEN_9_TO_5, timezone: "Asia/Bangkok" });
    const slot = await findNextAvailableSlot(ORG_ID, "2026-08-12T14:00:00.000Z");
    assert.ok(slot);
    const hour = Number(localTime(slot, "Asia/Bangkok").slice(0, 2));
    assert.ok(hour >= 9 && hour < 17, "inside Bangkok hours");
  });

  test("next-day rollover uses the org's local date", async () => {
    // 21:00Z on 12 August is 17:00 New York — past the last slot, so
    // the search must roll into New York's 13 August, not London's.
    stubs = installStubs({
      hours: ALWAYS_OPEN_9_TO_5,
      timezone: "America/New_York",
    });
    const slot = await findNextAvailableSlot(ORG_ID, "2026-08-12T21:00:00.000Z");
    assert.ok(slot);
    assert.equal(localDate(slot, "America/New_York"), "2026-08-13");
  });

  test("a slot is never offered that would run past closing", async () => {
    stubs = installStubs({
      hours: ALWAYS_OPEN_9_TO_5,
      timezone: "America/New_York",
      appointmentDurationMinutes: 60,
    });
    const slot = await findNextAvailableSlot(ORG_ID, "2026-08-12T20:30:00.000Z");
    assert.ok(slot);
    const [h, m] = localTime(slot, "America/New_York").split(":").map(Number);
    assert.ok(h * 60 + m + 60 <= 17 * 60, "must finish by 17:00 local");
  });

  test("the returned value is a UTC instant that maps back correctly", async () => {
    // Storage stays in UTC; only the interpretation is local.
    stubs = installStubs({
      hours: ALWAYS_OPEN_9_TO_5,
      timezone: "America/New_York",
    });
    const slot = await findNextAvailableSlot(ORG_ID, "2026-08-12T13:00:00.000Z");
    assert.match(slot, /Z$/, "an ISO UTC instant");
    assert.equal(new Date(slot).toISOString(), slot, "round-trips exactly");
    assert.equal(localTime(slot, "America/New_York"), "09:00");
  });
});

describe("DST is handled by the zone, never by fixed offsets", () => {
  // London: BST ends 25 October 2026, clocks go back at 02:00.
  test("the same wall-clock hour holds either side of a transition", async () => {
    stubs = installStubs({ hours: ALWAYS_OPEN_9_TO_5, timezone: "Europe/London" });
    // 23 October (BST, UTC+1): 09:00 local is 08:00Z.
    const before = await isWithinBusinessHours(ORG_ID, "2026-10-23T08:00:00.000Z");
    assert.equal(before.isAvailable, true, "09:00 BST is open");
    stubs.restore();

    stubs = installStubs({ hours: ALWAYS_OPEN_9_TO_5, timezone: "Europe/London" });
    // 27 October (GMT, UTC+0): 09:00 local is 09:00Z. If a fixed +1
    // offset were being applied, this would be read as 10:00.
    const after = await isWithinBusinessHours(ORG_ID, "2026-10-27T09:00:00.000Z");
    assert.equal(after.isAvailable, true, "09:00 GMT is open");
  });

  test("the same UTC time answers differently either side of the change", async () => {
    // 15:30Z, with 60-minute appointments and a 17:00 close:
    //   23 October (BST, +1) -> 16:30 local, ends 17:30 — refused.
    //   27 October (GMT, +0) -> 15:30 local, ends 16:30 — allowed.
    // Identical UTC clock time, opposite answers. A frozen offset could
    // not produce this.
    stubs = installStubs({ hours: ALWAYS_OPEN_9_TO_5, timezone: "Europe/London" });
    const bst = await isWithinBusinessHours(ORG_ID, "2026-10-23T15:30:00.000Z");
    assert.equal(bst.isAvailable, false, "16:30 BST would run past close");
    assert.equal(bst.reason, "ends_after_close");
    stubs.restore();

    stubs = installStubs({ hours: ALWAYS_OPEN_9_TO_5, timezone: "Europe/London" });
    const gmt = await isWithinBusinessHours(ORG_ID, "2026-10-27T15:30:00.000Z");
    assert.equal(gmt.isAvailable, true, "15:30 GMT finishes inside hours");
  });

  test("a DST-free zone is unaffected by either date", async () => {
    for (const iso of ["2026-10-23T04:00:00.000Z", "2026-10-27T04:00:00.000Z"]) {
      stubs = installStubs({ hours: ALWAYS_OPEN_9_TO_5, timezone: "Asia/Bangkok" });
      const result = await isWithinBusinessHours(ORG_ID, iso);
      assert.equal(result.isAvailable, true, `11:00 Bangkok on ${iso}`);
      stubs.restore();
    }
    stubs = installStubs({ hours: ALWAYS_OPEN_9_TO_5, timezone: "Asia/Bangkok" });
  });
});
