import { createAdminClient } from "@/lib/supabase/admin";
import {
  findNextAvailableSlot,
  getOrgSettings,
  getOrgTimezone,
  isWithinBusinessHours,
  overlapsBusy,
} from "@/lib/availability";
import { checkBookingSlot } from "@/lib/bookingAvailability";
import { offsetMinutesAt } from "@/lib/calendar/timezone";
import type { BusyInterval } from "@/lib/integrations/types";
import { startTimer, timed } from "@/lib/timing";

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

/**
 * Ceiling on slot-grid probes per lookup. Each probe advances a whole
 * slot, so this only bounds the work when the diary is densely booked.
 */
const MAX_ALTERNATIVE_PROBES = 6;

/**
 * A request that is over — the slot is free again. Everything else
 * (new, awaiting_confirmation, contacted, qualified, needs_review,
 * booked) is a live claim on the time.
 */
const RELEASED_STATUSES = ["cancelled", "lost"];

/**
 * Whether a slot is already spoken for by an appointment REQUEST that
 * has not yet been confirmed or rejected.
 *
 * The shared engine's capacity check counts only status='booked'
 * (availability.ts), which is right for it: a booking is the only thing
 * chat and the widget ever create. A phone call deliberately creates a
 * REQUEST instead — Remy is not allowed to confirm anything — so
 * without this a second caller is told the same slot is free while the
 * first request sits waiting for the business. That is exactly what
 * happened on the 2026-08-06 pair of production calls.
 *
 * Deliberately narrow, and voice-only:
 *   - `metadata.appointment_request` must be explicitly true. Callbacks,
 *     questions, general enquiries, needs_review records without an
 *     appointment, chat leads and widget leads never carry it and can
 *     never consume appointment capacity.
 *   - the row must sit at exactly this instant.
 *   - cancelled and lost are excluded, so rejecting a request releases
 *     the slot.
 *   - a request in the past holds nothing.
 *
 * Fails OPEN on a query error: an unreadable count must not invent a
 * conflict. The shared engine's own checks have already run by this
 * point, so the worst case is today's behaviour.
 */
async function isHeldByPendingRequest(
  orgId: string,
  isoDatetime: string,
  maxConcurrent: number
): Promise<boolean> {
  // A slot that has already passed cannot be held by anything.
  if (new Date(isoDatetime).getTime() < Date.now()) return false;

  const admin = createAdminClient();
  const { count, error } = await admin
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("appointment_datetime", isoDatetime)
    .eq("metadata->>appointment_request", "true")
    .not("status", "in", `(${RELEASED_STATUSES.join(",")})`);

  if (error) {
    console.error(
      "[voice] pending-request capacity check failed:",
      error.message
    );
    return false;
  }

  return (count ?? 0) >= maxConcurrent;
}

/**
 * How far ahead to load held slots. Matches the engine's own 14-day
 * slot-search window, so the predicate below covers every candidate
 * findNextAvailableSlot can return.
 */
const ALTERNATIVE_WINDOW_DAYS = 14;

/**
 * Every instant already held by a pending request in the search window,
 * as instant → number of requests holding it.
 *
 * Loaded in ONE query because findNextAvailableSlot's `isAcceptable`
 * hook is synchronous — the same reason findNextExternallyFreeSlot
 * pre-fetches the calendar's busy intervals and passes a sync
 * predicate. This is a range read for the alternatives search;
 * isHeldByPendingRequest above remains the point lookup for the slot
 * the caller actually asked for, and is deliberately left untouched
 * since that path has been verified in production.
 *
 * Fails OPEN, exactly as the point lookup does: an unreadable list must
 * not invent conflicts and start hiding real slots.
 */
async function fetchHeldSlots(
  orgId: string,
  fromIso: string
): Promise<Map<string, number>> {
  const held = new Map<string, number>();
  const toIso = new Date(
    new Date(fromIso).getTime() + ALTERNATIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("leads")
    .select("appointment_datetime")
    .eq("org_id", orgId)
    .eq("metadata->>appointment_request", "true")
    .not("status", "in", `(${RELEASED_STATUSES.join(",")})`)
    .gte("appointment_datetime", fromIso)
    .lte("appointment_datetime", toIso);

  if (error) {
    console.error("[voice] held-slot lookup failed:", error.message);
    return held;
  }

  for (const row of data ?? []) {
    const iso = row.appointment_datetime;
    if (typeof iso !== "string") continue;
    held.set(iso, (held.get(iso) ?? 0) + 1);
  }
  return held;
}

/** The org's concurrent-appointment limit, as the engine reads it. */
async function getMaxConcurrent(orgId: string): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("organisations")
    .select("max_concurrent_bookings")
    .eq("id", orgId)
    .maybeSingle();
  return data?.max_concurrent_bookings ?? 1;
}

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

/** The calendar day an instant falls on, in the business's zone. */
function localDay(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/**
 * How an alternative is offered. The clock time alone is enough while
 * it falls on the day the caller asked about; once the search crosses
 * into another day — which it can now that alternatives are whole slots
 * rather than the next minute — the day has to be said, or "9:00 am"
 * means nothing to the caller.
 */
function speakAlternative(
  iso: string,
  requestedIso: string,
  timezone: string
): string {
  return localDay(iso, timezone) === localDay(requestedIso, timezone)
    ? speakTime(iso, timezone)
    : speakInstant(iso, timezone);
}

/** Just the clock time — how a same-day alternative is offered. */
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
 * Real appointment slots the caller can actually be offered.
 *
 * Every candidate comes from findNextAvailableSlot — the existing
 * slot-grid walker, which steps by the org's configured
 * appointment_duration_minutes and already enforces opening hours,
 * closed days, lunch breaks, "must finish before closing" and capacity.
 * No spacing rule is defined here.
 *
 * This replaces a cursor that advanced by 60 SECONDS and then offered
 * the resulting instant if checkBookingSlot happened to accept it.
 * checkBookingSlot evaluates whatever instant it is handed and has no
 * notion of a slot grid, so a refused 3:00 PM produced "3:01 PM or
 * 3:02 PM" on the 2026-08-06 production call — times that were never
 * appointment slots, and that would have been recorded as the requested
 * time had the caller accepted one.
 *
 * Pending requests are excluded through the walker's own isAcceptable
 * hook, so a slot another caller has already asked for is skipped
 * rather than offered and withdrawn.
 */
async function gatherAlternatives(
  orgId: string,
  searchFromIso: string,
  durationMinutes: number,
  maxConcurrent: number,
  busy: BusyInterval[],
  busyWindowEndIso: string | null
): Promise<string[]> {
  const held = await fetchHeldSlots(orgId, searchFromIso);
  const busyWindowEndMs = busyWindowEndIso
    ? new Date(busyWindowEndIso).getTime()
    : null;

  // One synchronous predicate carrying every rule a candidate must
  // satisfy, so the walker can settle a slot without another await.
  //
  // This replaces a per-candidate call back into checkBookingSlot. That
  // call re-fetched a whole 14-day freeBusy window EVERY probe — up to
  // six extra provider round trips, plus a nested slot walk inside each
  // — for data already fetched by the decision that got us here. The
  // coverage is unchanged: findNextAvailableSlot still enforces opening
  // hours, closed days, lunch, "must finish before closing" and
  // internal capacity; held requests and the external calendar are
  // applied here.
  const isAcceptable = (candidateIso: string): boolean => {
    if ((held.get(candidateIso) ?? 0) >= maxConcurrent) return false;

    // No external calendar was consulted for this decision, so there is
    // nothing to filter against and behaviour is exactly as before.
    if (busyWindowEndMs === null) return true;

    const candidateMs = new Date(candidateIso).getTime();
    if (!Number.isFinite(candidateMs)) return false;

    // Past the end of the fetched window the busy list is silent, and
    // silence is not evidence of free. Refusing to offer is the
    // fail-closed choice — the same rule as "cannot check is not free".
    if (candidateMs >= busyWindowEndMs) return false;

    return !overlapsBusy(candidateIso, durationMinutes, busy);
  };

  const stepMs = Math.max(durationMinutes, 1) * 60_000;
  const found: string[] = [];
  let cursor: string | null = searchFromIso;

  // Bounded: each probe advances by a whole slot, so this cannot spin.
  for (let probe = 0; probe < MAX_ALTERNATIVE_PROBES; probe++) {
    if (!cursor || found.length >= MAX_ALTERNATIVES) break;

    const candidate: string | null = await findNextAvailableSlot(
      orgId,
      cursor,
      { isAcceptable }
    );
    if (!candidate) break;

    // Every rule was applied inside isAcceptable, so a returned
    // candidate is already offerable — no second decision needed.
    if (!found.includes(candidate)) found.push(candidate);

    cursor = new Date(new Date(candidate).getTime() + stepMs).toISOString();
  }

  return found;
}

async function lookup(
  orgId: string,
  date: string,
  time: string
): Promise<VoiceAvailabilityOutcome> {
  const timezone = await timed("lookup.timezone", () => getOrgTimezone(orgId));
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
  const hours = await timed("lookup.businessHours", () =>
    isWithinBusinessHours(orgId, requestedIso)
  );
  if (hours.reason === "no_hours_configured") {
    console.error(
      "[voice] availability unknown — no business hours resolved for org:",
      orgId
    );
    return unknownOutcome(requestedIso);
  }

  const { appointmentDurationMinutes } = await timed("lookup.orgSettings", () =>
    getOrgSettings(createAdminClient(), orgId)
  );

  const decision = await timed("lookup.checkBookingSlot", () =>
    checkBookingSlot(orgId, requestedIso, appointmentDurationMinutes)
  );

  // A calendar is connected but would not answer. The engine refuses to
  // call this free, and so does the call.
  if (decision.externalCheckFailed) return unknownOutcome(requestedIso);

  // The engine says free, but it only counts CONFIRMED bookings. A slot
  // another caller has already requested is not free to request again.
  const maxConcurrent = await getMaxConcurrent(orgId);
  const heldByRequest =
    decision.available &&
    (await isHeldByPendingRequest(orgId, requestedIso, maxConcurrent));

  if (heldByRequest) {
    console.log(
      "[voice] slot already held by a pending appointment request:",
      requestedIso
    );
  }

  if (decision.available && !heldByRequest) {
    return {
      status: "available",
      requestedIso,
      alternativeIsos: [],
      result: `AVAILABLE: ${speakInstant(requestedIso, timezone)} is free to request. Tell the caller that time is available. Do NOT say it is booked, confirmed or reserved — you are recording a request, and the team confirms it.`,
    };
  }

  // Where to start walking the slot grid. When the engine refused the
  // slot it has already found the nearest bookable alternative, and
  // that instant is itself on the grid, so the walk starts there and
  // will return it first if it is still acceptable. When only a pending
  // REQUEST held the slot the engine suggested nothing, so the walk
  // starts one whole slot after the requested time — never one minute
  // after it.
  const searchFromIso =
    decision.suggestedIso ??
    new Date(
      new Date(requestedIso).getTime() +
        Math.max(appointmentDurationMinutes, 1) * 60_000
    ).toISOString();

  const alternativeIsos = await timed("lookup.alternatives", () =>
    gatherAlternatives(
      orgId,
      searchFromIso,
      appointmentDurationMinutes,
      maxConcurrent,
      decision.externalBusy,
      decision.externalBusyWindowEndIso
    )
  );

  if (alternativeIsos.length === 0) {
    return {
      status: "unavailable",
      requestedIso,
      alternativeIsos: [],
      result: `NOT AVAILABLE: ${speakInstant(requestedIso, timezone)} cannot be offered, and nothing else is free nearby. Tell the caller, and ask whether another day would suit. Do NOT invent a time.`,
    };
  }

  const spoken = alternativeIsos.map((iso) =>
    speakAlternative(iso, requestedIso, timezone)
  );
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
  const elapsed = startTimer();
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
    // Logged for EVERY outcome, including the timeout — the 2026-08-07
    // failure had no total to compare its stages against.
    console.log(`[timing] lookup.total ${elapsed()}ms`);
  }
}
