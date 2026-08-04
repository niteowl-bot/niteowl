import {
  findNextAvailableSlot,
  getOrgTimezone,
  isSlotAvailable,
  isWithinBusinessHours,
  overlapsBusy,
} from "@/lib/availability";
import { getOrgBusyIntervals } from "@/lib/integrations/capabilities/calendarService";
import { isCalendarAvailabilityBlocking } from "@/lib/integrations/flags";
import type { BusyInterval } from "@/lib/integrations/types";

// ── The single source of truth for "can we book this slot?" ───────
//
// Composed ON TOP of availability.ts rather than inside it, so the
// existing engine keeps no knowledge of integrations and gains no new
// import in the live booking path. Every channel — website chat, the
// embedded widget, the phone AI's post-call capture, and any future
// API — is intended to call this one function, so a rule can never be
// enforced on one channel and missed on another.
//
// NOT YET WIRED. Nothing calls this. It is switched on by changing the
// call site in lead capture once the migration and credentials are
// verified, which keeps today's production behaviour untouched.
//
// ── Order of checks ──
// Business hours → internal capacity → external calendar. The external
// lookup runs last and only if the first two pass, so a request that
// was never bookable costs no provider call.
//
// ── The rule that matters most ──
// "We could not check" is NEVER "it is free". A provider outage, an
// expired token or an unreadable calendar produces
// externalCheckFailed, and the caller must then refuse to confirm the
// booking — it holds the requested slot and sends it for review
// instead. Silently treating an unknown as free is how a customer ends
// up double-booked.

export type UnavailableReason =
  | "hours"
  | "capacity"
  | "ends_after_close"
  | "external_conflict";

export interface BookingSlotDecision {
  /** Whether the slot may be confirmed to the customer. */
  available: boolean;
  reason: UnavailableReason | null;
  /** Nearest bookable alternative, when one was found. */
  suggestedIso: string | null;
  /**
   * True when an external calendar is connected but could not be
   * consulted. The slot is NOT confirmed; the caller marks the lead for
   * review and notifies the owner.
   */
  externalCheckFailed: boolean;
  /** True when an external calendar actually answered. */
  externalChecked: boolean;
  /**
   * Set when the external calendar reported a conflict while blocking
   * is still off (log-only mode). The booking proceeds, but this is
   * what WOULD have been refused — the evidence used to decide whether
   * blocking is safe to enable.
   */
  externalConflictObserved: boolean;
}

/** How far ahead to fetch busy windows, matching the slot search window. */
const BUSY_WINDOW_DAYS = 14;

function internalDecision(
  hours: Awaited<ReturnType<typeof isWithinBusinessHours>>,
  slotFree: boolean
): { available: boolean; reason: UnavailableReason | null } {
  if (!hours.isAvailable) {
    return {
      available: false,
      reason: hours.reason === "ends_after_close" ? "ends_after_close" : "hours",
    };
  }
  if (!slotFree) return { available: false, reason: "capacity" };
  return { available: true, reason: null };
}

/**
 * Decides whether a requested slot can be booked.
 *
 * With no calendar connected — every organisation today — the result is
 * exactly what the existing engine returns, computed from the same two
 * calls in the same order, and the external branch is never entered.
 */
export async function checkBookingSlot(
  orgId: string,
  isoDatetime: string,
  appointmentDurationMinutes: number
): Promise<BookingSlotDecision> {
  const hours = await isWithinBusinessHours(orgId, isoDatetime);
  const slotFree = hours.isAvailable ? await isSlotAvailable(orgId, isoDatetime) : true;

  const internal = internalDecision(hours, slotFree);

  if (!internal.available) {
    return {
      available: false,
      reason: internal.reason,
      suggestedIso: await findNextAvailableSlot(orgId, isoDatetime),
      externalCheckFailed: false,
      externalChecked: false,
      externalConflictObserved: false,
    };
  }

  // Internally bookable. Now, and only now, consult the calendar.
  const windowEnd = new Date(
    new Date(isoDatetime).getTime() + BUSY_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const lookup = await getOrgBusyIntervals(orgId, isoDatetime, windowEnd);

  if (!lookup.ok) {
    if (lookup.reason === "not_connected") {
      // The ordinary case: behave exactly as before this feature.
      return {
        available: true,
        reason: null,
        suggestedIso: null,
        externalCheckFailed: false,
        externalChecked: false,
        externalConflictObserved: false,
      };
    }

    // Connected but unreadable. The slot is internally free, yet we
    // cannot promise it — so it is not confirmed.
    console.error(
      `[booking] external calendar unreadable for org ${orgId} (${lookup.reason}); slot not confirmed`
    );
    return {
      available: false,
      reason: null,
      suggestedIso: null,
      externalCheckFailed: true,
      externalChecked: false,
      externalConflictObserved: false,
    };
  }

  const conflict = overlapsBusy(isoDatetime, appointmentDurationMinutes, lookup.busy);

  if (!conflict) {
    return {
      available: true,
      reason: null,
      suggestedIso: null,
      externalCheckFailed: false,
      externalChecked: true,
      externalConflictObserved: false,
    };
  }

  // Log-only mode: record what would have been refused, but let the
  // booking through, so the log can be compared with reality before
  // this is allowed to turn a customer away.
  if (!isCalendarAvailabilityBlocking()) {
    console.log(
      `[booking] LOG-ONLY external conflict for org ${orgId} at ${isoDatetime} — booking allowed`
    );
    return {
      available: true,
      reason: null,
      suggestedIso: null,
      externalCheckFailed: false,
      externalChecked: true,
      externalConflictObserved: true,
    };
  }

  return {
    available: false,
    reason: "external_conflict",
    suggestedIso: await findNextExternallyFreeSlot(
      orgId,
      isoDatetime,
      appointmentDurationMinutes,
      lookup.busy
    ),
    externalCheckFailed: false,
    externalChecked: true,
    externalConflictObserved: true,
  };
}

/**
 * The nearest slot that is free both internally and on the calendar.
 *
 * The busy list is fetched once by the caller and passed in, so
 * scanning candidates costs no further provider requests.
 */
export async function findNextExternallyFreeSlot(
  orgId: string,
  fromIso: string,
  appointmentDurationMinutes: number,
  busy: BusyInterval[]
): Promise<string | null> {
  return findNextAvailableSlot(orgId, fromIso, {
    isAcceptable: (candidateIso: string) =>
      !overlapsBusy(candidateIso, appointmentDurationMinutes, busy),
  });
}

/**
 * The org's timezone, for anything that formats a time back to a
 * customer. Re-exported so callers never reach for a hardcoded zone.
 */
export { getOrgTimezone };
