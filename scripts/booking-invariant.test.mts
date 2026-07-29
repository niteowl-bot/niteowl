// Unit tests for the booking/calendar invariant. Run directly with Node 24+:
//   node scripts/booking-invariant.test.mts
//
// Covers the scenarios required for the "booked ⇒ valid appointment" fix.
// Excluded from the app tsconfig/eslint (see tsconfig "exclude" + eslint
// globalIgnores) — it's an out-of-band script, not part of the build.

import assert from "node:assert/strict";
import {
  enforceBookedInvariant,
  isValidAppointmentIso,
  type LeadStatusValue,
} from "../src/lib/bookingInvariant.ts";

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log("  ✓ " + name);
    passed++;
  } catch (e) {
    console.error("  ✗ " + name + " -> " + (e as Error).message);
    process.exitCode = 1;
  }
}

const validIso = "2026-07-30T13:00:00.000Z";

console.log("1. Successful booking -> stays booked, appears on calendar");
check("booked + valid appointment stays booked", () =>
  assert.equal(enforceBookedInvariant("booked", validIso), "booked")
);
check("valid ISO is recognised (=> passes the calendar not-null filter)", () =>
  assert.equal(isValidAppointmentIso(validIso), true)
);

console.log("2. Missing / invalid appointment time -> NOT booked");
check("booked + null -> needs_review", () =>
  assert.equal(enforceBookedInvariant("booked", null), "needs_review")
);
check("booked + empty string -> needs_review", () =>
  assert.equal(enforceBookedInvariant("booked", ""), "needs_review")
);
check("booked + unparseable -> needs_review", () =>
  assert.equal(enforceBookedInvariant("booked", "not-a-date"), "needs_review")
);
check("unparseable ISO rejected", () =>
  assert.equal(isValidAppointmentIso("not-a-date"), false)
);

console.log("3. Calendar/appointment write failure -> lead not left booked");
// If the appointment timestamp did not persist (null / unknown after a failed
// write), the same guard prevents the lead from being left as booked.
check("no persisted appointment -> needs_review", () =>
  assert.equal(enforceBookedInvariant("booked", null), "needs_review")
);

console.log("4. Non-booked statuses pass through unchanged");
const others: LeadStatusValue[] = [
  "new",
  "awaiting_confirmation",
  "contacted",
  "qualified",
  "lost",
  "cancelled",
  "needs_review",
];
for (const s of others) {
  check(`${s} unchanged even with null appointment`, () =>
    assert.equal(enforceBookedInvariant(s, null), s)
  );
}

console.log("5. Timezone handling (Europe/London)");
const londonHHMM = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
// Summer date (BST = UTC+1): a 2pm-London appointment is stored as 13:00Z.
check("BST: 13:00Z displays as 14:00 London", () =>
  assert.equal(londonHHMM("2026-07-30T13:00:00.000Z"), "14:00")
);
// Winter date (GMT = UTC+0): a 2pm-London appointment is stored as 14:00Z.
check("GMT: 14:00Z displays as 14:00 London", () =>
  assert.equal(londonHHMM("2026-01-30T14:00:00.000Z"), "14:00")
);

console.log(`\n${passed} checks passed.`);
if (process.exitCode) console.error("SOME CHECKS FAILED");
