import {
  getPrimaryResourceWithConnection,
  getValidCredentials,
  setConnectionStatus,
} from "@/lib/integrations/connections";
import { isIntegrationError } from "@/lib/integrations/errors";
import { isCalendarSyncEnabled } from "@/lib/integrations/flags";
import { initialiseIntegrations } from "@/lib/integrations/providers";
import { getCalendarCapability } from "@/lib/integrations/registry";
import { timed } from "@/lib/timing";
import type {
  BusyInterval,
  CalendarEventInput,
  ExternalEventRef,
} from "@/lib/integrations/types";

// ── Organisation-level calendar service ───────────────────────────
//
// The booking engine's only door to an external calendar. It resolves
// which connection and calendar an org uses, obtains valid credentials,
// and calls the capability — so nothing upstream knows whether Google,
// Microsoft or something not yet written is on the other end.
//
// Two rules the whole design turns on:
//
//   1. NOT CONNECTED IS NOT AN ERROR. Every org today has no calendar,
//      and their behaviour must be byte-identical to before this
//      feature existed. The flag is checked first, so the common case
//      costs zero database queries.
//
//   2. CANNOT CHECK IS NOT THE SAME AS FREE. A provider outage, an
//      expired token or an unreadable calendar returns `unavailable`,
//      never an empty busy list. Treating "we could not look" as "there
//      is nothing there" is how a customer gets double-booked.

/**
 * How long a provider call may take when it is part of an availability
 * lookup, where someone is on the phone and `checkVoiceAvailability`
 * races an 8s timer.
 *
 * Sized so a credential refresh AND a freeBusy call can both complete
 * inside that budget with room for the database round trips either
 * side. Scoped to this one operation on purpose — the same 3.5s applied
 * to OAuth connect or to listing an account's calendars would turn a
 * slow-but-working response into a failure that never used to happen.
 */
export const AVAILABILITY_REQUEST_TIMEOUT_MS = 3_500;

/** Why an external lookup produced no answer. */
export type CalendarUnavailableReason =
  /** No calendar connected, or the feature is off. Normal. */
  | "not_connected"
  /** Connected but the owner must reconnect. */
  | "needs_reauth"
  /** Connected, but the lookup failed. Retryable. */
  | "lookup_failed";

export type BusyLookup =
  | { ok: true; busy: BusyInterval[]; provider: string }
  | { ok: false; reason: CalendarUnavailableReason; provider: string | null };

export interface ResolvedCalendar {
  orgId: string;
  connectionId: string;
  provider: string;
  calendarId: string;
  syncEnabled: boolean;
  availabilityEnabled: boolean;
}

/**
 * The org's calendar, or null when there is nothing to consult.
 *
 * Deliberately returns null — not a thrown error — for the flag being
 * off or nothing being connected, because both are ordinary states.
 */
export async function resolveOrgCalendar(
  orgId: string
): Promise<ResolvedCalendar | null> {
  // Checked before any query: with the feature off this function is
  // free, and the booking path is exactly what it was before.
  if (!isCalendarSyncEnabled()) return null;

  const pair = await getPrimaryResourceWithConnection(orgId, "calendar");
  if (!pair) return null;

  return {
    orgId,
    connectionId: pair.connection.id,
    provider: pair.connection.provider,
    calendarId: pair.resource.externalId,
    syncEnabled: pair.resource.syncEnabled,
    availabilityEnabled: pair.resource.availabilityEnabled,
  };
}

/**
 * Busy windows on the org's calendar between two UTC instants.
 *
 * ONE provider request covers the whole window, so scanning for a free
 * slot costs one round trip rather than one per candidate.
 */
export async function getOrgBusyIntervals(
  orgId: string,
  fromIso: string,
  toIso: string
): Promise<BusyLookup> {
  const calendar = await resolveOrgCalendar(orgId);
  if (!calendar) return { ok: false, reason: "not_connected", provider: null };
  if (!calendar.availabilityEnabled) {
    // The owner chose not to have this calendar consulted for conflicts.
    return { ok: false, reason: "not_connected", provider: calendar.provider };
  }

  initialiseIntegrations();

  try {
    // The availability budget is applied HERE and nowhere else: this is
    // the one calendar operation with a caller waiting on the line.
    // createOrgEvent, updateOrgEvent, cancelOrgEvent and the Settings
    // resource listing deliberately keep the generous default.
    const budget = { timeoutMs: AVAILABILITY_REQUEST_TIMEOUT_MS };

    const credentials = await timed("calendar.credentials", () =>
      getValidCredentials(orgId, calendar.connectionId, budget)
    );
    const capability = getCalendarCapability(calendar.provider);
    const busy = await timed("calendar.freeBusy", () =>
      capability.getBusyIntervals(
        credentials,
        calendar.calendarId,
        fromIso,
        toIso,
        budget
      )
    );
    return { ok: true, busy, provider: calendar.provider };
  } catch (err) {
    const needsReauth =
      isIntegrationError(err) && err.kind === "auth_expired";

    console.error(
      `[calendar] busy lookup failed for org ${orgId} (${calendar.provider}):`,
      err instanceof Error ? err.message : String(err)
    );

    if (needsReauth) {
      await setConnectionStatus(
        orgId,
        calendar.connectionId,
        "needs_reauth",
        err instanceof Error ? err.message : String(err)
      );
    }

    return {
      ok: false,
      reason: needsReauth ? "needs_reauth" : "lookup_failed",
      provider: calendar.provider,
    };
  }
}

export type EventWriteResult =
  | { ok: true; ref: ExternalEventRef; provider: string; calendarId: string }
  | { ok: false; reason: CalendarUnavailableReason; provider: string | null };

/**
 * Creates the appointment in the org's calendar.
 *
 * Idempotent through input.idempotencyKey: a retry that repeats a
 * create is reported by the provider as an existing event rather than
 * making a second one.
 */
export async function createOrgEvent(
  orgId: string,
  input: CalendarEventInput
): Promise<EventWriteResult> {
  const calendar = await resolveOrgCalendar(orgId);
  if (!calendar) return { ok: false, reason: "not_connected", provider: null };
  if (!calendar.syncEnabled) {
    return { ok: false, reason: "not_connected", provider: calendar.provider };
  }

  initialiseIntegrations();

  try {
    const credentials = await getValidCredentials(orgId, calendar.connectionId);
    const capability = getCalendarCapability(calendar.provider);
    const ref = await capability.createEvent(credentials, calendar.calendarId, input);
    return { ok: true, ref, provider: calendar.provider, calendarId: calendar.calendarId };
  } catch (err) {
    return handleWriteFailure(orgId, calendar, err, "create");
  }
}

export async function updateOrgEvent(
  orgId: string,
  eventId: string,
  input: CalendarEventInput
): Promise<EventWriteResult> {
  const calendar = await resolveOrgCalendar(orgId);
  if (!calendar) return { ok: false, reason: "not_connected", provider: null };

  initialiseIntegrations();

  try {
    const credentials = await getValidCredentials(orgId, calendar.connectionId);
    const capability = getCalendarCapability(calendar.provider);
    const ref = await capability.updateEvent(
      credentials,
      calendar.calendarId,
      eventId,
      input
    );
    return { ok: true, ref, provider: calendar.provider, calendarId: calendar.calendarId };
  } catch (err) {
    return handleWriteFailure(orgId, calendar, err, "update");
  }
}

export async function cancelOrgEvent(
  orgId: string,
  eventId: string
): Promise<{ ok: boolean; reason?: CalendarUnavailableReason }> {
  const calendar = await resolveOrgCalendar(orgId);
  if (!calendar) return { ok: false, reason: "not_connected" };

  initialiseIntegrations();

  try {
    const credentials = await getValidCredentials(orgId, calendar.connectionId);
    const capability = getCalendarCapability(calendar.provider);
    await capability.cancelEvent(credentials, calendar.calendarId, eventId);
    return { ok: true };
  } catch (err) {
    const result = await handleWriteFailure(orgId, calendar, err, "cancel");
    return { ok: false, reason: result.ok ? undefined : result.reason };
  }
}

async function handleWriteFailure(
  orgId: string,
  calendar: ResolvedCalendar,
  err: unknown,
  operation: string
): Promise<EventWriteResult> {
  const needsReauth = isIntegrationError(err) && err.kind === "auth_expired";
  const message = err instanceof Error ? err.message : String(err);

  console.error(
    `[calendar] ${operation} failed for org ${orgId} (${calendar.provider}):`,
    message
  );

  if (needsReauth) {
    await setConnectionStatus(orgId, calendar.connectionId, "needs_reauth", message);
  }

  return {
    ok: false,
    reason: needsReauth ? "needs_reauth" : "lookup_failed",
    provider: calendar.provider,
  };
}
