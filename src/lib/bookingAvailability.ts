import {
  checkSlotCapacity,
  findNextAvailableSlot,
  getOrgTimezone,
  resolveOrgTimezone,
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
// WIRED FROM EVERY CHANNEL. voice/availabilityTool.ts calls this for
// each mid-call "is that time free?" question, calendarSync re-checks
// through it immediately before writing an event, and leadCapture —
// website chat, the embedded widget and post-call voice capture — asks
// it before deciding whether a requested time can be taken. A change
// here is felt on live calls immediately.
//
// The external branch is gated by CALENDAR_SYNC_ENABLED, checked inside
// resolveOrgCalendar. With that flag off the lookup short-circuits to
// not_connected before any query runs, and this function returns
// exactly what the internal engine alone would.
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
  /**
   * True when an INTERNAL check could not be made at all — the business
   * hours read failed, or the capacity count failed. `available` is
   * false either way, so nothing is confirmed; the distinction exists
   * so a caller can say "we could not check" instead of the untrue
   * "you are outside opening hours" or "that slot is fully booked".
   *
   * The engine has always known this (AvailabilityResult.reason
   * "lookup_failed" and SlotCapacityResult.failed) and this function
   * was discarding it, collapsing a database error into an ordinary
   * refusal. Chat and the widget carried the distinction themselves
   * before they were routed through here, and must not lose it.
   *
   * Additive: existing callers ignore it and are unaffected. `reason`
   * keeps exactly the values it has always returned.
   */
  internalCheckFailed: boolean;
  /** True when an external calendar actually answered. */
  externalChecked: boolean;
  /**
   * Set when the external calendar reported a conflict while blocking
   * is still off (log-only mode). The booking proceeds, but this is
   * what WOULD have been refused — the evidence used to decide whether
   * blocking is safe to enable.
   */
  externalConflictObserved: boolean;
  /**
   * The busy intervals this decision was made against, and the instant
   * up to which they are known to be complete.
   *
   * Exposed so a caller searching for ALTERNATIVES can reuse them
   * instead of asking the provider again. `gatherAlternatives` used to
   * call back into checkBookingSlot per candidate, and each of those
   * issued its own fresh 14-day freeBusy request — up to seven provider
   * round trips for one question.
   *
   * `externalBusyWindowEndIso` is null when no external calendar was
   * consulted (feature off, nothing connected, or availability disabled
   * on the resource). A caller must treat a candidate at or beyond that
   * instant as UNVERIFIED rather than free — the busy list says nothing
   * about times it never covered.
   */
  externalBusy: BusyInterval[];
  externalBusyWindowEndIso: string | null;
}

/** How far ahead to fetch busy windows, matching the slot search window. */
const BUSY_WINDOW_DAYS = 14;

export interface BookingSlotOptions {
  /**
   * A lead whose own booking must not count against it, forwarded
   * unchanged to the capacity check (see SlotCapacityOptions).
   *
   * Required by RESCHEDULES. Capacity is an OVERLAP test, so a lead
   * moving 10:00 → 10:30 meets its own existing row and every short
   * reschedule would otherwise be refused as a clash with itself.
   * Chat and the widget already passed this to checkSlotCapacity
   * directly; it exists here so routing them through this function
   * keeps that exemption rather than silently dropping it.
   *
   * Optional, and absent for every caller that existed before it: with
   * no id supplied the capacity query is byte-identical to what it has
   * always run.
   */
  excludeLeadId?: string | null;
  /**
   * The org's already-resolved IANA zone, when the caller has one.
   *
   * The voice tool resolves it before it can even build the requested
   * instant, so passing it here costs nothing and saves a duplicate
   * read on the one path with a measured latency budget. Omitted, this
   * function resolves it ONCE below and threads it into both the
   * business-hours check and the slot search — never one query each.
   */
  timezone?: string;
}

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
  appointmentDurationMinutes: number,
  options: BookingSlotOptions = {}
): Promise<BookingSlotDecision> {
  // ── The org's clock, resolved ONCE for the whole decision ────────
  //
  // Business hours are stored as wall-clock strings ("09:00"), so they
  // mean nothing until we know whose clock they are on. Resolving here
  // and threading downward is what keeps this to a single organisations
  // read rather than one per sub-check.
  //
  // FAIL CLOSED when it cannot be established. Falling back to
  // Europe/London would not be a neutral default — it is precisely what
  // let a New York business accept 06:00, three hours before it opened.
  // internalCheckFailed is the existing "we could not check" channel, so
  // the customer hears "we cannot confirm that time right now" rather
  // than the untrue "you are outside our opening hours".
  let timezone = options.timezone;
  if (!timezone) {
    const resolution = await resolveOrgTimezone(orgId);
    if (!resolution.resolved) {
      console.error(
        `[booking] org ${orgId} has no trustworthy timezone — slot not confirmed`
      );
      return {
        available: false,
        reason: null,
        suggestedIso: null,
        externalCheckFailed: false,
        internalCheckFailed: true,
        externalChecked: false,
        externalConflictObserved: false,
        externalBusy: [],
        externalBusyWindowEndIso: null,
      };
    }
    timezone = resolution.timezone;
  }

  const hours = await isWithinBusinessHours(orgId, isoDatetime, timezone);
  // checkSlotCapacity rather than isSlotAvailable: the boolean form is
  // literally `(await checkSlotCapacity(...)).available`, so the query
  // and the decision are unchanged — this only keeps the `failed` flag
  // that the boolean form throws away.
  const capacity = hours.isAvailable
    ? await checkSlotCapacity(orgId, isoDatetime, {
        excludeLeadId: options.excludeLeadId,
      })
    : { available: true, failed: false };

  const internal = internalDecision(hours, capacity.available);
  const internalCheckFailed =
    hours.reason === "lookup_failed" || capacity.failed;

  if (!internal.available) {
    return {
      available: false,
      reason: internal.reason,
      suggestedIso: await findNextAvailableSlot(orgId, isoDatetime, { timezone }),
      externalCheckFailed: false,
      internalCheckFailed,
      externalChecked: false,
      externalConflictObserved: false,
      externalBusy: [],
      externalBusyWindowEndIso: null,
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
        internalCheckFailed: false,
        externalChecked: false,
        externalConflictObserved: false,
        externalBusy: [],
        externalBusyWindowEndIso: null,
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
      internalCheckFailed: false,
      externalChecked: false,
      externalConflictObserved: false,
      // Nothing was verified, so nothing may be reused as if it had been.
      externalBusy: [],
      externalBusyWindowEndIso: null,
    };
  }

  const conflict = overlapsBusy(isoDatetime, appointmentDurationMinutes, lookup.busy);

  if (!conflict) {
    return {
      available: true,
      reason: null,
      suggestedIso: null,
      externalCheckFailed: false,
      internalCheckFailed: false,
      externalChecked: true,
      externalConflictObserved: false,
      externalBusy: lookup.busy,
      externalBusyWindowEndIso: windowEnd,
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
      internalCheckFailed: false,
      externalChecked: true,
      externalConflictObserved: true,
      externalBusy: lookup.busy,
      externalBusyWindowEndIso: windowEnd,
    };
  }

  return {
    available: false,
    reason: "external_conflict",
    suggestedIso: await findNextExternallyFreeSlot(
      orgId,
      isoDatetime,
      appointmentDurationMinutes,
      lookup.busy,
      timezone
    ),
    externalCheckFailed: false,
    internalCheckFailed: false,
    externalChecked: true,
    externalConflictObserved: true,
    externalBusy: lookup.busy,
    externalBusyWindowEndIso: windowEnd,
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
  busy: BusyInterval[],
  /** The org's resolved zone, forwarded so the walk costs no extra read. */
  timezone?: string
): Promise<string | null> {
  return findNextAvailableSlot(orgId, fromIso, {
    isAcceptable: (candidateIso: string) =>
      !overlapsBusy(candidateIso, appointmentDurationMinutes, busy),
    timezone,
  });
}

/**
 * The org's timezone, for anything that formats a time back to a
 * customer. Re-exported so callers never reach for a hardcoded zone.
 */
export { getOrgTimezone };
