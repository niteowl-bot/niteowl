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
    // never "Intl accepted it" alone: a zone must either be on Intl's
    // canonical list or carry a real Area/Location id. Not one of these
    // abbreviations contains a slash, which is what excludes them.
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

// ── IANA link names, across ICU builds ────────────────────────────
//
// Intl.supportedValuesOf("timeZone") lists canonical zones but omits
// LINK names, and which name is the link varies by ICU build: the build
// this was written on lists "Asia/Calcutta" and rejects "Asia/Kolkata";
// newer builds do the reverse. Validating on the list alone meant an
// owner picking the spelling their runtime happened not to list had it
// silently replaced with Europe/London — every appointment 5½ hours
// out, no error anywhere.
//
// These tests must hold on EITHER kind of build, so they assert the
// property rather than the list.

describe("zone names absent from this runtime's list", () => {
  const LIST = new Set(Intl.supportedValuesOf("timeZone"));

  test("BOTH spellings of the India zone are accepted", () => {
    // Whichever one this build omits is exactly the case that used to
    // fail. Asserting both makes the test build-independent.
    assert.equal(isValidTimezone("Asia/Kolkata"), true);
    assert.equal(isValidTimezone("Asia/Calcutta"), true);
  });

  test("at least one of them really is missing from the list here", () => {
    // Proof this suite is exercising the gap rather than passing
    // vacuously. If a future runtime lists both, this is worth knowing.
    const missing = ["Asia/Kolkata", "Asia/Calcutta"].filter((z) => !LIST.has(z));
    assert.ok(
      missing.length > 0,
      "this runtime lists both spellings — the link-name gap is not being exercised"
    );
  });

  test("both spellings compute the same instant", () => {
    // The reason accepting the link name is safe: it is the same zone.
    const both = ["Asia/Kolkata", "Asia/Calcutta"].map((zone) =>
      toProviderLocalTime("2026-08-20T08:30:00.000Z", zone)
    );
    assert.equal(both[0], both[1]);
    assert.equal(both[0], "2026-08-20T14:00:00");
  });

  test("other link names are accepted too", () => {
    for (const zone of ["US/Eastern", "Asia/Saigon", "Europe/Kiev"]) {
      if (LIST.has(zone)) continue; // already covered by the list
      assert.equal(isValidTimezone(zone), true, zone);
    }
  });

  test("a shaped-but-unreal zone is STILL rejected", () => {
    // The widening must not become "anything with a slash".
    for (const bad of [
      "Europe/Atlantis",
      "Foo/Bar",
      "Etc/Unknown",
      "Asia/Kolkatta", // plausible misspelling
      "//",
      "/London",
      "Europe/",
    ]) {
      assert.equal(isValidTimezone(bad), false, bad);
    }
  });

  test("the abbreviations are still rejected", () => {
    // Re-asserted here because the widening is where they could slip in.
    for (const bad of ["BST", "EST", "PST", "CET", "GMT", "EST5EDT", "PST8PDT"]) {
      assert.equal(isValidTimezone(bad), false, bad);
    }
  });

  test("an accepted link name canonicalises rather than returning null", () => {
    const canonical = canonicaliseTimezone("Asia/Kolkata");
    assert.ok(canonical, "must not be null");
    assert.equal(
      toProviderLocalTime("2026-08-20T08:30:00.000Z", canonical),
      "2026-08-20T14:00:00"
    );
  });
});

// ══════════════════════════════════════════════════════════════════
//  The database CHECK and the application must agree
// ══════════════════════════════════════════════════════════════════
//
// docs/sql/2026-08-12_organisations_timezone_shape.sql adds:
//
//   check (timezone = btrim(timezone)
//          and btrim(timezone) <> ''
//          and (timezone = 'UTC' or timezone like '%/%'))
//
// It is preventative only — PR #9's runtime rule still fails closed when a
// stored zone cannot be resolved, and nothing here relaxes that.
//
// The constraint deliberately avoids a frozen list of IANA names, because
// Postgres cannot keep one in step with the runtime's ICU build. The price
// of that choice is an ASSUMPTION: every zone the application would
// canonicalise and store must satisfy the SQL predicate. If some future ICU
// build lists a slashless canonical zone, that assumption breaks and the
// constraint would start rejecting a legitimate write.
//
// This is the test that catches that drift in CI rather than in production.

/** The SQL predicate, expressed exactly, so the two cannot silently diverge. */
function satisfiesDbConstraint(stored) {
  return (
    stored === stored.trim() &&
    stored.trim() !== "" &&
    (stored === "UTC" || stored.includes("/"))
  );
}

describe("the organisations.timezone CHECK agrees with the application", () => {
  test("every zone the app can canonicalise satisfies the SQL predicate", () => {
    // The whole supported set, not a sample — this is the assumption the
    // constraint rests on, so it is checked exhaustively.
    const offenders = listSupportedTimezones()
      .map((zone) => canonicaliseTimezone(zone))
      .filter((stored) => stored !== null && !satisfiesDbConstraint(stored));

    assert.deepEqual(
      offenders,
      [],
      `these zones would be stored by the app but REJECTED by the DB check: ${offenders.join(", ")}`
    );
  });

  test("UTC is storable — the one legitimate slashless zone", () => {
    // Allowed by hand in the SQL, because CANONICAL_ZONES adds it by hand
    // too: some ICU builds omit it from supportedValuesOf.
    const stored = canonicaliseTimezone("utc");
    assert.equal(stored, "UTC");
    assert.equal(satisfiesDbConstraint(stored), true);
  });

  test("what the app rejects outright, the DB rejects too", () => {
    // Neither layer may be the only one holding the line.
    for (const bad of ["", "   ", "BST", "EST"]) {
      assert.equal(canonicaliseTimezone(bad), null, `app must reject ${JSON.stringify(bad)}`);
      assert.equal(
        satisfiesDbConstraint(bad),
        false,
        `DB check must reject ${JSON.stringify(bad)}`
      );
    }
  });

  test("padding is NORMALISED by the app, and refused by the DB if it survives", () => {
    // The two layers do different jobs here, and conflating them is a
    // mistake worth pinning. canonicaliseTimezone does not reject
    // " Europe/London" — it TRIMS it, which is the desirable behaviour for
    // a value arriving from a picker or an API payload.
    assert.equal(canonicaliseTimezone(" Europe/London"), "Europe/London");
    // So what the app would actually STORE passes the constraint...
    assert.equal(satisfiesDbConstraint("Europe/London"), true);
    // ...while the raw padded string does not. That asymmetry is the whole
    // point of the `timezone = btrim(timezone)` clause: it catches a write
    // that reached the database WITHOUT going through canonicalisation.
    assert.equal(satisfiesDbConstraint(" Europe/London"), false);
  });

  test("the default the column carries is itself valid", () => {
    // A default that violated its own constraint would break every
    // organisation created without the column — the only creation path.
    assert.equal(satisfiesDbConstraint(DEFAULT_ORG_TIMEZONE), true);
    assert.equal(canonicaliseTimezone(DEFAULT_ORG_TIMEZONE), "Europe/London");
  });
});
