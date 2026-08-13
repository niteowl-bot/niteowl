import { appointmentsOverlap } from "@/lib/availability";
import { checkBookingSlot, getOrgTimezone } from "@/lib/bookingAvailability";
import {
  cancelOrgEvent,
  createOrgEvent,
  resolveOrgCalendar,
  updateOrgEvent,
} from "@/lib/integrations/capabilities/calendarService";
import {
  findAppointmentLink,
  recordAppointmentLink,
  updateAppointmentLink,
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
   * A link exists and the event was moved to match this appointment.
   * Reached when the time changed outside the reschedule path.
   */
  | "realigned";

export interface CalendarConfirmResult {
  outcome: CalendarConfirmOutcome;
  /** Google's event id, when one exists. */
  externalEventId: string | null;
  /** Set on "conflict": the nearest slot the engine found instead. */
  suggestedIso: string | null;
}

/** These mean the calendar genuinely holds the appointment, at this time. */
export function isCalendarConfirmed(outcome: CalendarConfirmOutcome): boolean {
  return (
    outcome === "created" ||
    outcome === "already_linked" ||
    outcome === "realigned"
  );
}

/**
 * Whether the booking may be confirmed to the customer.
 *
 * Identical to isCalendarConfirmed, and kept as a separate name because
 * it answers a different question: not "does an event exist" but "may we
 * SAY so". Nothing that failed to write an event may be called booked.
 *
 * "no_calendar" used to be included here, on the reasoning that an org
 * with no connection has nothing to contradict. That reasoning described
 * a call this code never makes. The only caller — settleCalendarBacking
 * in lib/leadCapture — is reached exclusively through
 * requiresCalendarBacking(), which gates on the same
 * isCalendarEventCreationEnabled(orgId) checked at the top of
 * confirmAppointmentOnCalendar. An org with no calendar integration
 * therefore never reaches this function at all: it books in a single
 * write, exactly as it always has, and that path is what preserves the
 * existing behaviour.
 *
 * So the only outcome this exclusion ever changed was the one case it
 * must not: an ALLOWLISTED org whose calendar is disconnected or has
 * sync switched off. That produced status "booked", a confirmation email
 * and "your appointment IS NOW BOOKED" in the chat reply, with no event
 * in anyone's calendar — the precise lie this module exists to prevent.
 */
export function mayConfirmBooking(outcome: CalendarConfirmOutcome): boolean {
  return isCalendarConfirmed(outcome);
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
 * Points an existing event at the appointment's current time.
 *
 * Idempotent by nature — an update that sets an event to the time it
 * already holds is a no-op at the provider — which is why the caller
 * never has to know where the event currently sits. `changed` is only
 * ever a hint for logging; correctness does not depend on it.
 */
async function moveEventToMatch(
  details: AppointmentDetails,
  linkId: string,
  eventId: string
): Promise<{ ok: boolean; changed: boolean }> {
  const timezone = await getOrgTimezone(details.orgId);
  const { title, description } = summarise(details);

  const write = await updateOrgEvent(details.orgId, eventId, {
    title,
    description,
    location: details.location,
    startIso: details.startIso,
    durationMinutes: details.durationMinutes,
    timezone,
    idempotencyKey: buildAppointmentIdempotencyKey(details.leadId, details.startIso),
    attendeeEmail: details.customerEmail,
    attendeeName: details.customerName,
  });

  if (!write.ok) {
    console.error(
      `[calendar-sync] could not move event ${eventId} for lead ${details.leadId}: ${write.reason}`
    );
    await updateAppointmentLink(details.orgId, linkId, {
      syncStatus: "failed",
      lastError: write.reason,
    });
    return { ok: false, changed: false };
  }

  await updateAppointmentLink(details.orgId, linkId, {
    syncStatus: "synced",
    externalEtag: write.ref.etag,
    lastError: null,
  });
  return { ok: true, changed: true };
}

/** How a reschedule or cancellation ended. */
export type CalendarChangeOutcome =
  /** Nothing to change — no calendar, or this appointment has no event. */
  | "no_calendar"
  /** The calendar was updated. */
  | "synced"
  /** The slot is not free on the calendar. Nothing was moved. */
  | "conflict"
  /** The provider refused or could not be reached. */
  | "failed";

export interface CalendarChangeResult {
  outcome: CalendarChangeOutcome;
  suggestedIso: string | null;
}

/**
 * Moves an appointment's calendar event to a new time.
 *
 * The caller must NOT tell the customer the appointment moved unless
 * this returns "no_calendar" or "synced". Updating the local time while
 * the event stays put is exactly the desync milestone 6 exists to close.
 *
 * The new slot is re-verified first — with one deliberate exception. If
 * the new time OVERLAPS the old one (moving 10:00 to 10:30), the org's
 * OWN event is sitting in that window and free/busy cannot tell it apart
 * from anyone else's, so the external check is skipped and the internal
 * ones stand. Without that, every short reschedule would be refused as a
 * clash with the very event it is about to move.
 */
export async function rescheduleAppointmentOnCalendar(
  details: AppointmentDetails,
  previousStartIso: string | null
): Promise<CalendarChangeResult> {
  try {
    if (!isCalendarEventCreationEnabled(details.orgId)) {
      return { outcome: "no_calendar", suggestedIso: null };
    }

    const calendar = await resolveOrgCalendar(details.orgId);
    if (!calendar || !calendar.syncEnabled) {
      return { outcome: "no_calendar", suggestedIso: null };
    }

    const link = await findAppointmentLink(
      details.orgId,
      details.leadId,
      calendar.connectionId
    );
    // ── A MISSING LINK IS NOT "NO CALENDAR" ──────────────────────────
    //
    // Execution only reaches here with the write flag on, a calendar
    // connected, and sync enabled — so this org demonstrably HAS a
    // calendar. What is missing is our record of THIS appointment's
    // event, and that has two possible causes we cannot tell apart from
    // here:
    //
    //   1. no event was ever written (the booking predates the
    //      connection), so there is genuinely nothing to move; or
    //   2. the event WAS created and recordAppointmentLink failed —
    //      confirmAppointmentOnCalendar logs that and still confirms the
    //      booking, correctly, because the event really exists.
    //
    // Returning "no_calendar" collapsed both into "nothing to move", and
    // the callers then moved the LOCAL time and told the customer their
    // appointment had moved — while the Google event sat at the old
    // time. That is the exact silent desync milestone 6 closed, reached
    // through lost data rather than a missing code path.
    //
    // "failed" is returned rather than a new outcome deliberately: it
    // already carries precisely the contract this case needs — do not
    // move, keep the original time, say so honestly, invite a retry —
    // and BOTH callers (leadCapture's chat/widget reschedule and
    // /api/bookings/manage) already implement it correctly. A new member
    // would have required changing them to handle it, for identical
    // behaviour. The log line below is what keeps the two causes
    // distinguishable in diagnosis.
    //
    // The cost is honest: a booking made before the calendar was
    // connected can no longer be rescheduled automatically for an
    // allowlisted org — it is refused rather than risked. Removing that
    // cost needs a read-back of the deterministic event id to establish
    // which case this is (and to repair the link), which is deliberately
    // NOT in this change.
    if (!link) {
      console.error(
        `[calendar-sync] no appointment link for lead ${details.leadId} on a connected calendar — refusing to move a time we cannot verify`
      );
      return { outcome: "failed", suggestedIso: null };
    }

    const movingWithinItself =
      previousStartIso !== null &&
      appointmentsOverlap(previousStartIso, details.startIso, details.durationMinutes);

    if (!movingWithinItself) {
      const decision = await checkBookingSlot(
        details.orgId,
        details.startIso,
        details.durationMinutes
      );
      if (decision.externalCheckFailed) {
        return { outcome: "failed", suggestedIso: null };
      }
      if (!decision.available || decision.externalConflictObserved) {
        return { outcome: "conflict", suggestedIso: decision.suggestedIso };
      }
    }

    const moved = await moveEventToMatch(details, link.id, link.externalId);
    return {
      outcome: moved.ok ? "synced" : "failed",
      suggestedIso: null,
    };
  } catch (err) {
    console.error(
      "[calendar-sync] unexpected failure moving an event:",
      err instanceof Error ? err.message : String(err)
    );
    return { outcome: "failed", suggestedIso: null };
  }
}

/**
 * Removes an appointment's calendar event.
 *
 * DELIBERATELY ASYMMETRIC with reschedule: a customer must always be
 * able to cancel. The caller cancels locally whatever this returns, and
 * a failure here leaves the link marked `failed` with its error on
 * integration_links.
 *
 * That record is for DIAGNOSIS ONLY as things stand: no dashboard,
 * endpoint or reconciliation pass reads sync_status or last_error, so a
 * stranded event is not currently surfaced to the owner anywhere. It is
 * found by whoever next looks at the calendar — in practice prompted by
 * the cancellation email the owner already receives. Surfacing it
 * properly is future work and deliberately not claimed here.
 *
 * Even so, a business clearing one ghost event is a far better outcome
 * than a customer trapped in an appointment because Google was
 * unreachable.
 *
 * Already-gone is success, not failure — the provider layer maps 404 and
 * 410 to the same place, so a repeated cancel is safe.
 */
export async function cancelAppointmentOnCalendar(
  orgId: string,
  leadId: string
): Promise<CalendarChangeResult> {
  try {
    if (!isCalendarEventCreationEnabled(orgId)) {
      return { outcome: "no_calendar", suggestedIso: null };
    }

    const calendar = await resolveOrgCalendar(orgId);
    if (!calendar || !calendar.syncEnabled) {
      return { outcome: "no_calendar", suggestedIso: null };
    }

    const link = await findAppointmentLink(orgId, leadId, calendar.connectionId);
    // ── A MISSING LINK IS DIAGNOSED HERE, NOT ESCALATED ──────────────
    //
    // Execution only reaches this line with the write flag on, a
    // calendar connected and sync enabled — so this org demonstrably HAS
    // a calendar. What is missing is our record of THIS appointment's
    // event, with the same two indistinguishable causes the reschedule
    // path documents: either no event was ever written (the booking
    // predates the connection), or one WAS written and
    // recordAppointmentLink failed, leaving a real event we can no
    // longer address.
    //
    // Unlike reschedule, the outcome is deliberately NOT escalated to
    // "failed". Cancellation is local-first: the caller has already
    // persisted the cancellation and branches on nothing but a log, so
    // "failed" would change no customer-visible behaviour while claiming
    // a provider refusal that never happened and marking links failed
    // for appointments that never had an event. The log line IS the
    // whole fix — it is what makes the second cause diagnosable at all,
    // where previously this returned silently.
    if (!link) {
      console.error(
        `[calendar-sync] no appointment link for lead ${leadId} on a connected, ` +
          `sync-enabled calendar — cannot verify or remove an external event; ` +
          `leaving the cancellation as no_calendar`
      );
      return { outcome: "no_calendar", suggestedIso: null };
    }

    const removed = await cancelOrgEvent(orgId, link.externalId);

    await updateAppointmentLink(orgId, link.id, {
      syncStatus: removed.ok ? "deleted" : "failed",
      lastError: removed.ok ? null : (removed.reason ?? "cancel failed"),
    });

    if (!removed.ok) {
      console.error(
        `[calendar-sync] event ${link.externalId} could not be removed for lead ${leadId}: ${removed.reason}`
      );
    }

    return { outcome: removed.ok ? "synced" : "failed", suggestedIso: null };
  } catch (err) {
    console.error(
      "[calendar-sync] unexpected failure cancelling an event:",
      err instanceof Error ? err.message : String(err)
    );
    return { outcome: "failed", suggestedIso: null };
  }
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
  if (!isCalendarEventCreationEnabled(details.orgId)) return none("no_calendar");

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
      // An event already mirrors this appointment. Whether it sits at
      // the right time can no longer be inferred from its id — a moved
      // event keeps the id it was created with (milestone 6 PATCHes in
      // place rather than recreating). So instead of guessing, make it
      // true: an update is idempotent, and setting an event to the time
      // it already holds costs one request and changes nothing.
      const realigned = await moveEventToMatch(
        details,
        existing.id,
        existing.externalId
      );
      return realigned.ok
        ? {
            outcome: realigned.changed ? "realigned" : "already_linked",
            externalEventId: existing.externalId,
            suggestedIso: null,
          }
        : none("failed");
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
