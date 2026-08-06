import { createAdminClient } from "@/lib/supabase/admin";
import {
  getOrgSettings,
  getOrgTimezone,
  isWithinBusinessHours,
} from "@/lib/availability";
import { checkBookingSlot } from "@/lib/bookingAvailability";
import { offsetMinutesAt } from "@/lib/calendar/timezone";

// ── Live availability, for the phone call only ─────────────────────
//
// The bridge between a call in progress and the EXISTING availability
// engine. It owns no rules of its own: every decision comes from
// checkBookingSlot (business hours → internal capacity → external
// calendar, in that order), which is the same engine chat and the
// widget are intended to use. Nothing here duplicates it.
//
// READ ONLY. This module never inserts, updates or deletes anything,
// and never creates a calendar event or reserves a slot. Booking
// creation is a separate phase; until it exists, an available answer
// means "free to REQUEST", never "booked".
//
// The two failure rules, both inherited from the engine:
//   1. "Could not check" is NEVER "it is free". Anything unexpected
//      returns `unknown`, and the call falls back to the existing
//      take-a-preference behaviour.
//   2. A slot is only ever spoken aloud if the engine returned it.
//      There is no path here that invents a time.

/**
 * Hard ceiling on the whole lookup. A caller is waiting in silence, so
 * a slow database or a slow calendar provider must degrade to "I can't
 * check right now" rather than dead air. Comfortably under the 20s
 * server timeout the tool is registered with.
 */
const LOOKUP_TIMEOUT_MS = 8_000;

/** How many alternatives to offer when the requested time is taken. */
const MAX_ALTERNATIVES = 2;

export type VoiceAvailabilityStatus = "available" | "unavailable" | "unknown";

export interface VoiceAvailabilityOutcome {
  status: VoiceAvailabilityStatus;
  /** The requested instant, once resolved. Null when unresolvable. */
  requestedIso: string | null;
  /** Genuine alternatives from the engine. Never fabricated. */
  alternativeIsos: string[];
  /** The text handed back to the model as the tool result. */
  result: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * A wall-clock date and time in the business's zone → the UTC instant.
 *
 * Two passes, because the offset itself depends on the instant: the
 * first guess can land on the wrong side of a DST boundary. Same
 * technique parseDatetimeToIso already uses; the offset lookup is the
 * existing calendar helper rather than a second implementation.
 */
function zonedWallClockToUtc(
  date: string,
  time: string,
  timezone: string
): string | null {
  if (!DATE_PATTERN.test(date) || !TIME_PATTERN.test(time)) return null;

  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  if (!Number.isFinite(naive)) return null;

  try {
    const firstGuess = new Date(
      naive - offsetMinutesAt(new Date(naive).toISOString(), timezone) * 60_000
    );
    const settled = new Date(
      naive - offsetMinutesAt(firstGuess.toISOString(), timezone) * 60_000
    );
    return Number.isNaN(settled.getTime()) ? null : settled.toISOString();
  } catch {
    return null;
  }
}

/** "3:00 PM on Wednesday 12 August", in the business's own zone. */
function speakInstant(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(iso))
    .replace(/ /g, " ");
}

/** Just the clock time — how an alternative is offered. */
function speakTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(iso))
    .replace(/ /g, " ");
}

/**
 * The one outcome that must never look like a slot. Used for a bad
 * argument, a timeout, an unreadable calendar and an unexpected throw
 * alike — the caller cannot tell the difference and does not need to.
 */
function unknownOutcome(requestedIso: string | null): VoiceAvailabilityOutcome {
  return {
    status: "unknown",
    requestedIso,
    alternativeIsos: [],
    result:
      "AVAILABILITY UNKNOWN. The live calendar could not be checked. Do NOT say the time is available and do NOT offer any time. Say you cannot confirm availability right now, take their preferred time, and tell them the team will confirm it.",
  };
}

/**
 * Collects alternatives the engine actually returned. The first comes
 * from the decision itself; any further one is a fresh search starting
 * a minute later, so the same slot is never offered twice. Stops at the
 * first gap — an empty list is a valid, honest answer.
 */
async function gatherAlternatives(
  orgId: string,
  firstSuggestion: string | null,
  durationMinutes: number
): Promise<string[]> {
  if (!firstSuggestion) return [];
  const found = [firstSuggestion];

  while (found.length < MAX_ALTERNATIVES) {
    const searchFrom = new Date(
      new Date(found[found.length - 1]).getTime() + 60_000
    ).toISOString();
    const next = await checkBookingSlot(orgId, searchFrom, durationMinutes);
    const candidate = next.available ? searchFrom : next.suggestedIso;
    if (!candidate || found.includes(candidate)) break;
    found.push(candidate);
  }

  return found;
}

async function lookup(
  orgId: string,
  date: string,
  time: string
): Promise<VoiceAvailabilityOutcome> {
  const timezone = await getOrgTimezone(orgId);
  const requestedIso = zonedWallClockToUtc(date, time, timezone);
  if (!requestedIso) return unknownOutcome(null);

  // "No hours configured" must not be spoken as "available".
  //
  // getBusinessHoursForOrg fails SOFT — a failed query returns an empty
  // list, which isWithinBusinessHours reads as no_hours_configured and
  // treats as open. That is right for post-call lead capture, where the
  // alternative is refusing every booking a business ever makes. It is
  // wrong on a live call: it would have Remy tell a customer 3 PM is
  // free on the strength of a database error, which is exactly what the
  // engine's own "could not check is never it is free" rule forbids.
  //
  // The two cases are indistinguishable from here — a genuinely
  // unconfigured business and a failed query produce the same reason —
  // so voice treats both as unknown and falls back to taking a
  // preference. Deliberately a voice-layer guard: availability.ts is
  // shared with chat, the widget and post-call capture, and its
  // behaviour there is unchanged.
  const hours = await isWithinBusinessHours(orgId, requestedIso);
  if (hours.reason === "no_hours_configured") {
    console.error(
      "[voice] availability unknown — no business hours resolved for org:",
      orgId
    );
    return unknownOutcome(requestedIso);
  }

  const { appointmentDurationMinutes } = await getOrgSettings(
    createAdminClient(),
    orgId
  );

  const decision = await checkBookingSlot(
    orgId,
    requestedIso,
    appointmentDurationMinutes
  );

  // A calendar is connected but would not answer. The engine refuses to
  // call this free, and so does the call.
  if (decision.externalCheckFailed) return unknownOutcome(requestedIso);

  if (decision.available) {
    return {
      status: "available",
      requestedIso,
      alternativeIsos: [],
      result: `AVAILABLE: ${speakInstant(requestedIso, timezone)} is free to request. Tell the caller that time is available. Do NOT say it is booked, confirmed or reserved — you are recording a request, and the team confirms it.`,
    };
  }

  const alternativeIsos = await gatherAlternatives(
    orgId,
    decision.suggestedIso,
    appointmentDurationMinutes
  );

  if (alternativeIsos.length === 0) {
    return {
      status: "unavailable",
      requestedIso,
      alternativeIsos: [],
      result: `NOT AVAILABLE: ${speakInstant(requestedIso, timezone)} cannot be offered, and nothing else is free nearby. Tell the caller, and ask whether another day would suit. Do NOT invent a time.`,
    };
  }

  const spoken = alternativeIsos.map((iso) => speakTime(iso, timezone));
  return {
    status: "unavailable",
    requestedIso,
    alternativeIsos,
    result: `NOT AVAILABLE: ${speakInstant(requestedIso, timezone)} cannot be offered. These ARE free: ${spoken.join(", ")}. Offer ONLY these and let the caller choose. Do NOT offer any other time.`,
  };
}

/**
 * Answers "is this time available?" for a call in progress.
 *
 * Never throws and never rejects: every failure path resolves to
 * `unknown`, because an exception here would leave a caller listening
 * to silence. Read-only — see the module note.
 */
export async function checkVoiceAvailability(
  orgId: string,
  args: { date?: unknown; time?: unknown }
): Promise<VoiceAvailabilityOutcome> {
  const date = typeof args?.date === "string" ? args.date.trim() : "";
  const time = typeof args?.time === "string" ? args.time.trim() : "";
  if (!date || !time) return unknownOutcome(null);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup(orgId, date, time),
      new Promise<VoiceAvailabilityOutcome>((resolve) => {
        timer = setTimeout(() => {
          console.error("[voice] availability lookup timed out for org:", orgId);
          resolve(unknownOutcome(null));
        }, LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    console.error("[voice] availability lookup failed:", err);
    return unknownOutcome(null);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
