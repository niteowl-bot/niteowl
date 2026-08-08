import { checkBookingSlot, getOrgTimezone } from "@/lib/bookingAvailability";
import {
  createOrgEvent,
  resolveOrgCalendar,
} from "@/lib/integrations/capabilities/calendarService";
import {
  findAppointmentLink,
  recordAppointmentLink,
} from "@/lib/integrations/connections";
import { isCalendarEventCreationEnabled } from "@/lib/integrations/flags";

// ── Writing a confirmed appointment into the business's calendar ──
//
// Milestone 5, and the first thing Remy does that changes something in
// someone else's Google account. Everything before this was a question;
// this is a consequence, so the whole module is written around one rule:
//
//   AN APPOINTMENT IS "BOOKED" ONLY IF GOOGLE SAYS SO.
//
// The caller decides the lead's status FROM the outcome below rather
// than deciding it first and writing afterwards. A failed, conflicted or
// unverifiable write therefore leaves a truthful pending request that
// the owner sees — never a confirmation nobody can honour.
//
// Composed on top of the existing pieces, not around them:
// resolveOrgCalendar picks the connection, checkBookingSlot re-verifies,
// createOrgEvent does the write. Nothing here knows Google exists.

/** How the attempt ended. Only two of these may become "booked". */
export type CalendarConfirmOutcome =
  /**
   * No calendar to write to — the flag is off, nothing is connected, or
   * the owner disabled sync on the resource. The ordinary state for
   * every org today, and NOT a failure: booking proceeds exactly as it
   * did before this module existed.
   */
  | "no_calendar"
  /** The event was created. */
  | "created"
  /** An event for this exact appointment was already there. */
  | "already_linked"
  /** The calendar says that time is taken. */
  | "conflict"
  /** A calendar is connected but could not be read. Nothing was written. */
  | "unverified"
  /** The write itself failed. */
  | "failed"
  /**
   * A link exists, but for a DIFFERENT instant than this appointment now
   * holds — i.e. it was rescheduled after the event was created. Moving
   * the event is milestone 6; until then this is handed to a human
   * rather than silently confirmed against a stale event.
   */
  | "stale_link";

export interface CalendarConfirmResult {
  outcome: CalendarConfirmOutcome;
  /** Google's event id, when one exists. */
  externalEventId: string | null;
  /** Set on "conflict": the nearest slot the engine found instead. */
  suggestedIso: string | null;
}

/** Only these two mean the calendar genuinely holds the appointment. */
export function isCalendarConfirmed(outcome: CalendarConfirmOutcome): boolean {
  return outcome === "created" || outcome === "already_linked";
}

/**
 * Whether the booking may be confirmed to the customer.
 *
 * "no_calendar" is deliberately included: an org with no connection has
 * nothing to contradict, and refusing to book it would break every
 * business using Remy today. Everything else that is not a confirmed
 * write must NOT be called booked.
 */
export function mayConfirmBooking(outcome: CalendarConfirmOutcome): boolean {
  return outcome === "no_calendar" || isCalendarConfirmed(outcome);
}

export interface AppointmentDetails {
  orgId: string;
  /** The lead this appointment belongs to. Also its identity today. */
  leadId: string;
  startIso: string;
  durationMinutes: number;
  serviceNeeded: string | null;
  customerName: string | null;
  customerEmail: string | null;
  /** Where the work happens, when the caller gave one. */
  location: string | null;
}

/**
 * The stable id for THIS VERSION of THIS appointment.
 *
 * Deliberately includes the start instant. Google turns this into the
 * event's own id (toGoogleEventId), which makes creation idempotent: a
 * retry regenerates the same id and Google answers 409 rather than
 * making a second event.
 *
 * Keying on the lead alone would have been the obvious choice and a
 * trap — a rescheduled appointment would re-derive the same id, hit the
 * event still sitting at the OLD time, and be reported as an existing
 * event, i.e. success carrying the wrong hour. Including the instant
 * means a moved appointment can never collide with its own past.
 *
 * Both parts survive Google's base32hex alphabet: a UUID is hex, and
 * epoch milliseconds are digits.
 */
export function buildAppointmentIdempotencyKey(
  leadId: string,
  startIso: string
): string {
  const startMs = new Date(startIso).getTime();
  return `${leadId}${Number.isFinite(startMs) ? startMs : 0}`;
}

function summarise(details: AppointmentDetails): { title: string; description: string } {
  const service = details.serviceNeeded?.trim() || "Appointment";
  const who = details.customerName?.trim();
  const title = who ? `${service} — ${who}` : service;

  const lines = [
    `Booked by Remy, your AI receptionist.`,
    who ? `Customer: ${who}` : null,
    details.customerEmail ? `Email: ${details.customerEmail}` : null,
    details.location ? `Address: ${details.location}` : null,
  ].filter(Boolean);

  return { title, description: lines.join("\n") };
}

/**
 * Creates the calendar event for an appointment that has already passed
 * every internal check, and reports honestly what happened.
 *
 * Never throws: a booking flow must not die because a provider did. Every
 * failure path resolves to an outcome the caller can act on.
 */
export async function confirmAppointmentOnCalendar(
  details: AppointmentDetails
): Promise<CalendarConfirmResult> {
  const none = (outcome: CalendarConfirmOutcome): CalendarConfirmResult => ({
    outcome,
    externalEventId: null,
    suggestedIso: null,
  });

  // Checked first, so an org with no calendar — every org today — costs
  // nothing and behaves exactly as before.
  if (!isCalendarEventCreationEnabled()) return none("no_calendar");

  try {
    const calendar = await resolveOrgCalendar(details.orgId);
    if (!calendar || !calendar.syncEnabled) return none("no_calendar");

    // ── Duplicate defence 1: is it already mirrored? ──
    const existing = await findAppointmentLink(
      details.orgId,
      details.leadId,
      calendar.connectionId
    );
    const expectedEventId = buildAppointmentIdempotencyKey(
      details.leadId,
      details.startIso
    );

    if (existing) {
      // The stored external id is derived from the instant, so it only
      // matches while the appointment still sits where it did.
      const stillCurrent =
        existing.externalId.includes(String(new Date(details.startIso).getTime()));
      if (stillCurrent) {
        return {
          outcome: "already_linked",
          externalEventId: existing.externalId,
          suggestedIso: null,
        };
      }
      console.error(
        `[calendar-sync] lead ${details.leadId} has an event for a different time ` +
          `(${existing.externalId}); moving it is not implemented — sending for review`
      );
      return none("stale_link");
    }

    // ── Re-verify AT the write, not at conversation time ──
    // Minutes may have passed since the slot was offered: the owner can
    // have booked over it in Google, or another channel taken it. This
    // is the one place a second freeBusy call is worth its round trip.
    const decision = await checkBookingSlot(
      details.orgId,
      details.startIso,
      details.durationMinutes
    );

    if (decision.externalCheckFailed) {
      console.error(
        `[calendar-sync] cannot verify ${details.startIso} for org ${details.orgId} — not writing`
      );
      return none("unverified");
    }

    // An observed conflict blocks the WRITE whatever the blocking flag
    // says. That flag governs whether a customer is turned away; putting
    // an event on top of one Google has already reported is a double
    // booking in the business's own diary, and is never acceptable.
    if (!decision.available || decision.externalConflictObserved) {
      console.log(
        `[calendar-sync] ${details.startIso} is no longer free for org ${details.orgId} — not writing`
      );
      return {
        outcome: "conflict",
        externalEventId: null,
        suggestedIso: decision.suggestedIso,
      };
    }

    // Wall time plus an IANA zone — never an offset (the provider layer
    // depends on this for daylight saving).
    const timezone = await getOrgTimezone(details.orgId);
    const { title, description } = summarise(details);

    // ── Duplicate defence 2: the provider's own idempotency ──
    const write = await createOrgEvent(details.orgId, {
      title,
      description,
      location: details.location,
      startIso: details.startIso,
      durationMinutes: details.durationMinutes,
      timezone,
      idempotencyKey: expectedEventId,
      attendeeEmail: details.customerEmail,
      attendeeName: details.customerName,
    });

    if (!write.ok) {
      // "not_connected" cannot occur here — resolveOrgCalendar already
      // answered — so anything false is a genuine write failure.
      console.error(
        `[calendar-sync] event create failed for lead ${details.leadId}: ${write.reason}`
      );
      return none("failed");
    }

    // ── Duplicate defence 3: the table's own unique index ──
    const recorded = await recordAppointmentLink({
      orgId: details.orgId,
      connectionId: calendar.connectionId,
      resourceId: calendar.resourceId,
      subjectId: details.leadId,
      externalId: write.ref.eventId,
      externalEtag: write.ref.etag,
    });
    if (!recorded) {
      // The event exists; only our record of it is missing. The booking
      // is real and must still be confirmed — saying otherwise would be
      // the lie this module exists to prevent.
      console.error(
        `[calendar-sync] event ${write.ref.eventId} created but link not recorded for lead ${details.leadId}`
      );
    }

    return {
      outcome: write.ref.alreadyExisted ? "already_linked" : "created",
      externalEventId: write.ref.eventId,
      suggestedIso: null,
    };
  } catch (err) {
    // A booking path must never die on a provider. Unknown means not
    // booked, which is the safe direction.
    console.error(
      "[calendar-sync] unexpected failure:",
      err instanceof Error ? err.message : String(err)
    );
    return none("failed");
  }
}
