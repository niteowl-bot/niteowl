// Regression tests for weekday resolution in booking-date parsing.
//
// The original bug: the model was handed the whole conversion and resolved
// "Monday" to Saturday 1 August 2026. Business-hours validation then ran
// against Saturday, so a time inside Monday's 09:00-19:00 hours was
// refused as outside them.
//
// The model's reply is stubbed, so these tests pin OUR handling of it
// rather than the model's accuracy: given a wrong weekday, the parser must
// still return the weekday the customer named.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  installStubs,
  londonWeekday,
  londonHhMm,
  nextLondonWeekdayIso,
} from "./support.mjs";

import { parseDatetimeToIso } from "@/lib/parseDatetime";

const MONDAY = 1;
const SATURDAY = 6;

let stubs;
afterEach(() => stubs?.restore());

describe("weekday correction", () => {
  test("'Monday at 18:45' resolves to a Monday, not the Saturday the model returned", async () => {
    // Exactly the observed failure: the model answers with a Saturday.
    const modelAnswer = nextLondonWeekdayIso(SATURDAY, 18, 45);
    assert.equal(londonWeekday(modelAnswer), SATURDAY, "stub should be a Saturday");

    stubs = installStubs({ modelIso: modelAnswer });
    const { iso, failed } = await parseDatetimeToIso("Monday at 18:45", "Europe/London");

    assert.equal(failed, false);
    assert.ok(iso, "expected a parsed datetime");
    assert.equal(londonWeekday(iso), MONDAY, `expected a Monday, got ${iso}`);
    assert.equal(londonHhMm(iso), "18:45", "the requested wall-clock time must survive");
  });

  test("'Monday at 6:45pm' — same correction for 12-hour phrasing", async () => {
    stubs = installStubs({ modelIso: nextLondonWeekdayIso(SATURDAY, 18, 45) });
    const { iso } = await parseDatetimeToIso("Monday at 6:45pm", "Europe/London");
    assert.equal(londonWeekday(iso), MONDAY);
    assert.equal(londonHhMm(iso), "18:45");
  });

  test("the corrected date is in the future, not a past Monday", async () => {
    stubs = installStubs({ modelIso: nextLondonWeekdayIso(SATURDAY, 18, 45) });
    const { iso } = await parseDatetimeToIso("Monday at 18:45", "Europe/London");
    assert.ok(
      new Date(iso).getTime() > Date.now(),
      `corrected date ${iso} should be in the future`
    );
  });

  test("a correct weekday is passed through untouched", async () => {
    // Guards against over-correcting: when the model is right, the instant
    // it returned must be preserved exactly.
    const correctMonday = nextLondonWeekdayIso(MONDAY, 18, 45);
    stubs = installStubs({ modelIso: correctMonday });

    const { iso } = await parseDatetimeToIso("Monday at 18:45", "Europe/London");
    assert.equal(iso, new Date(correctMonday).toISOString());
  });

  test("expressions naming no weekday are left alone", async () => {
    // "tomorrow" must not be snapped to any particular weekday.
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    stubs = installStubs({ modelIso: tomorrow });

    const { iso } = await parseDatetimeToIso("tomorrow at 4pm", "Europe/London");
    assert.equal(iso, new Date(tomorrow).toISOString());
  });

  test("each named weekday is honoured", async () => {
    // Tuesday was mis-resolved to Sunday by the same underlying fault.
    for (const [text, expected] of [
      ["Tuesday at 18:45", 2],
      ["Wednesday at 10am", 3],
      ["Sunday at 2pm", 0],
    ]) {
      stubs = installStubs({ modelIso: nextLondonWeekdayIso(SATURDAY, 18, 45) });
      const { iso } = await parseDatetimeToIso(text, "Europe/London");
      assert.equal(londonWeekday(iso), expected, `${text} → ${iso}`);
      stubs.restore();
    }
  });
});

describe("parser failure handling is unchanged", () => {
  test("a 'null' answer is not a failure, just no datetime", async () => {
    stubs = installStubs({ modelIso: "null" });
    const { iso, failed } = await parseDatetimeToIso("sometime next week", "Europe/London");
    assert.equal(iso, null);
    assert.equal(failed, false);
  });

  test("empty input never calls the model", async () => {
    stubs = installStubs({});
    const { iso, failed } = await parseDatetimeToIso(null, "Europe/London");
    assert.equal(iso, null);
    assert.equal(failed, false);
    assert.equal(stubs.calls.openai, 0);
  });

  test("an API error is reported as a failure", async () => {
    stubs = installStubs({ modelStatus: 500 });
    const { iso, failed } = await parseDatetimeToIso("Monday at 18:45", "Europe/London");
    assert.equal(iso, null);
    assert.equal(failed, true);
  });
});
