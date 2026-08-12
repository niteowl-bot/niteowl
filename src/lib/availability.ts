import { createAdminClient } from "@/lib/supabase/admin";
// Pure helpers only — no integration module is imported here, so the
// live booking path gains no new dependency and no new failure mode.
// The external-calendar layer composes ON TOP of this file, in
// bookingAvailability.ts, rather than reaching into it.
import { isValidTimezone } from "@/lib/calendar/timezone";

// Every function here is called from both authenticated contexts (the
// dashboard preview chat) and fully unauthenticated ones (the public
// website widget, and the public booking-manage page). The RLS-scoped
// server client only works when there's a logged-in session — with no
// session, RLS silently returns zero rows rather than an error, and
// every check below fails open on empty data (no hours configured →
// treat as always open; no leads found → treat as always available).
// That means business hours and capacity limits were never actually
// enforced for the widget. Every query here already manually scopes by
// an explicit orgId parameter (never derived from a session), so the
// admin client is safe and correctly scoped either way.

// Historical default. Every org row now carries its own IANA zone
// (organisations.timezone, defaulted to this value), so existing
// businesses are unaffected; this constant survives only as the
// fallback for a row that predates the column or fails to load.
const TIMEZONE = "Europe/London";
const SEARCH_WINDOW_DAYS = 14;

export interface BusinessHoursRow {
  day_of_week: number; // 0 = Sunday
  is_closed: boolean;
  open_time: string | null; // "HH:MM:SS"
  close_time: string | null;
  lunch_start: string | null;
  lunch_end: string | null;
}

export interface AvailabilityResult {
  isAvailable: boolean;
  reason?:
    | "closed_day"
    | "outside_hours"
    | "lunch_break"
    | "no_hours_configured"
    // The business-hours query itself failed. Distinct from
    // "no_hours_configured" — which is a real, configured state that
    // deliberately fails OPEN — because a failed read tells us nothing,
    // and "we could not check" must never be treated as "it is free".
    | "lookup_failed"
    // Start time is inside opening hours, but the appointment would run
    // past closing (e.g. 18:45 + 60 min against a 19:00 close). Kept
    // distinct from "outside_hours" so Remy can explain that it's the
    // length that doesn't fit, not the requested time itself.
    | "ends_after_close";
  /** Only set for "ends_after_close" — lets the reply state both numbers. */
  appointmentDurationMinutes?: number;
  /** Minutes between the requested start and closing time. */
  minutesUntilClose?: number;
}

// Extract the local weekday (0=Sun) and minutes-since-midnight from an
// ISO datetime, in the business's own timezone.
//
// The timezone is REQUIRED, deliberately. It used to default to the
// Europe/London constant, and both call sites simply never passed one —
// so every business-hours decision was judged on London's clock while
// the requested instant had been parsed in the org's real zone. A New
// York business asking for 06:00 local (before it opens) resolves to
// 11:00 London, landed inside 09:00-17:00, and was ACCEPTED. Removing
// the default is what makes that mistake unrepresentable rather than
// merely fixed once.
//
// Intl is given an explicit timeZone, so the answer never depends on
// the server's own clock or locale, and IANA rules (BST/GMT, US DST,
// half-hour zones) are applied by the platform rather than by hand.
function getZonedParts(
  isoDatetime: string,
  timezone: string
): { dayOfWeek: number; minutesOfDay: number } {
  const date = new Date(isoDatetime);

  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  const dayOfWeek = weekdayMap[map.weekday];
  const minutesOfDay = parseInt(map.hour, 10) * 60 + parseInt(map.minute, 10);

  return { dayOfWeek, minutesOfDay };
}

function timeStringToMinutes(time: string | null): number | null {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * The org's configured hours, and whether the read actually succeeded.
 *
 * `failed` exists because an empty array used to mean two completely
 * different things: "this business has configured no hours" — a real
 * state the checks below deliberately fail OPEN on, so a business that
 * has not finished setup can still take bookings — and "the query
 * failed", which tells us nothing at all. Collapsing them meant a
 * transient database error read as "no hours configured" and produced a
 * CONFIRMED booking for a time nothing had validated.
 */
interface BusinessHoursLookup {
  rows: BusinessHoursRow[];
  failed: boolean;
}

async function getBusinessHoursForOrg(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string
): Promise<BusinessHoursLookup> {
  const { data, error } = await supabase
    .from("business_hours")
    .select("day_of_week, is_closed, open_time, close_time, lunch_start, lunch_end")
    .eq("org_id", orgId);

  if (error) {
    console.error("[availability] failed to fetch business hours:", error.message);
    return { rows: [], failed: true };
  }
  return { rows: data ?? [], failed: false };
}

// Exported (2026-08-06) only so the voice availability tool can obtain
// the SAME appointment length this engine uses, rather than querying
// the column itself and risking a second, drifting default. Body and
// behaviour unchanged.
export async function getOrgSettings(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string
): Promise<{ appointmentDurationMinutes: number; emergencyModeEnabled: boolean }> {
  const { data } = await supabase
    .from("organisations")
    .select("appointment_duration_minutes, emergency_mode_enabled")
    .eq("id", orgId)
    .maybeSingle();

  return {
    appointmentDurationMinutes: data?.appointment_duration_minutes ?? 60,
    emergencyModeEnabled: data?.emergency_mode_enabled ?? false,
  };
}

/**
 * The organisation's IANA timezone.
 *
 * Queried separately from getOrgSettings, and failing soft, on purpose:
 * the column arrives with the integration-framework migration, and this
 * code must keep working on a database where that has not been run yet.
 * Folding it into the main settings select would make one missing column
 * take `appointment_duration_minutes` down with it, silently resetting
 * every org's appointment length to the 60-minute default.
 *
 * Never returns an abbreviation — those are ambiguous and Intl resolves
 * several of them to the wrong place ("BST" is Asia/Dhaka).
 */
export async function getOrgTimezone(orgId: string): Promise<string> {
  return (await resolveOrgTimezone(orgId)).timezone;
}

/** What a timezone lookup actually established. */
export interface OrgTimezoneResolution {
  /** Always usable — the org's own zone, or the fallback. */
  timezone: string;
  /**
   * True ONLY when the organisation's own valid zone was read.
   *
   * False for a failed query, an org with no timezone set, or a stored
   * value Intl cannot use — three different causes, one meaning: we do
   * not know what "09:00" means for this business.
   */
  resolved: boolean;
}

/**
 * The same lookup as getOrgTimezone, reporting whether it succeeded.
 *
 * ONE query, ONE column, ONE validation — this is not a second source of
 * truth, it is the same read with the outcome no longer discarded.
 * getOrgTimezone delegates here and flattens the result, so its
 * fail-soft contract is byte-for-byte what it always was and no existing
 * caller changes behaviour.
 *
 * The distinction exists because availability cannot afford it.
 * Formatting a time back to a customer in the wrong zone is cosmetic and
 * self-evident; DECIDING that a slot is bookable in the wrong zone is
 * silent and wrong, and can offer a business a slot before it opens. So
 * the booking path asks for `resolved` and refuses when it is false,
 * while everything that merely renders a time keeps the soft fallback.
 */
export async function resolveOrgTimezone(
  orgId: string
): Promise<OrgTimezoneResolution> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("organisations")
    .select("timezone")
    .eq("id", orgId)
    .maybeSingle();

  if (error) {
    console.error(
      `[availability] could not read the timezone for org ${orgId}: ${error.message}`
    );
    return { timezone: TIMEZONE, resolved: false };
  }
  if (!data?.timezone) return { timezone: TIMEZONE, resolved: false };

  const timezone = String(data.timezone);
  if (!isValidTimezone(timezone)) {
    console.error(
      `[availability] org ${orgId} has an unusable timezone (${timezone}); falling back to ${TIMEZONE}`
    );
    return { timezone: TIMEZONE, resolved: false };
  }
  return { timezone, resolved: true };
}

/**
 * Whether an appointment overlaps any busy window.
 *
 * Half-open intervals: an appointment starting exactly when a busy
 * window ends does NOT overlap, so back-to-back bookings are allowed
 * rather than being rejected as conflicts.
 */
export function overlapsBusy(
  startIso: string,
  durationMinutes: number,
  busy: { startIso: string; endIso: string }[]
): boolean {
  const start = new Date(startIso).getTime();
  const end = start + durationMinutes * 60_000;
  if (Number.isNaN(start)) return false;

  return busy.some((window) => {
    const busyStart = new Date(window.startIso).getTime();
    const busyEnd = new Date(window.endIso).getTime();
    if (Number.isNaN(busyStart) || Number.isNaN(busyEnd)) return false;
    return start < busyEnd && end > busyStart;
  });
}

/**
 * The window an EXISTING appointment must start inside to overlap a
 * candidate one.
 *
 * Appointments have no per-appointment length — every one is the org's
 * configured `appointment_duration_minutes` — so both intervals are the
 * same width D. [existingStart, existingStart+D) then overlaps
 * [start, start+D) exactly when existingStart lies strictly inside
 * (start-D, start+D).
 *
 * STRICT at both ends, which is what preserves the half-open semantics
 * `overlapsBusy` already uses: an appointment finishing exactly when
 * this one begins (existingStart = start-D), or beginning exactly when
 * this one finishes (existingStart = start+D), does NOT overlap. That
 * is the rule that keeps back-to-back bookings legal.
 *
 * Exported so the capacity check and the voice held-slot check are
 * provably the same rule rather than two implementations that can drift.
 */
export function appointmentOverlapWindow(
  startIso: string,
  durationMinutes: number
): { afterIso: string; beforeIso: string } | null {
  const start = new Date(startIso).getTime();
  if (Number.isNaN(start)) return null;

  const span = Math.max(durationMinutes, 1) * 60_000;
  return {
    afterIso: new Date(start - span).toISOString(),
    beforeIso: new Date(start + span).toISOString(),
  };
}

/**
 * Whether two same-length appointments overlap. The in-memory twin of
 * appointmentOverlapWindow, for callers holding the instants already.
 */
export function appointmentsOverlap(
  startIsoA: string,
  startIsoB: string,
  durationMinutes: number
): boolean {
  const a = new Date(startIsoA).getTime();
  const b = new Date(startIsoB).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) < Math.max(durationMinutes, 1) * 60_000;
}

// ── Business hours as knowledge for the chat assistant ───────────────
// The booking validator reads the business_hours table, but the chat
// system prompt was built only from business_knowledge (the Knowledge
// Base). So Remy had no access to the hours configured in Settings: it
// could not answer "what time do you close on Monday?", and when the
// Knowledge Base happened to contain its own (often out-of-date) hours
// text, Remy quoted that instead — contradicting the hours the booking
// engine actually enforces. This exposes the same rows the validator
// uses, formatted for the prompt, so both read one source of truth.

const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

export interface BusinessHoursSummary {
  /** False when the org has no business_hours rows at all. */
  hasConfiguredHours: boolean;
  emergencyModeEnabled: boolean;
  appointmentDurationMinutes: number;
  /** One human-readable line per configured day, Monday first. */
  lines: string[];
}

/** Trims a "HH:MM:SS" time to "HH:MM". */
function toHhMm(time: string): string {
  return time.slice(0, 5);
}

/**
 * The org's configured opening hours, formatted for the chat system
 * prompt. Reuses the same queries as the availability checks above, so
 * what Remy says and what the booking engine enforces cannot diverge.
 */
export async function getBusinessHoursSummary(
  orgId: string
): Promise<BusinessHoursSummary> {
  const supabase = createAdminClient();

  const [settings, lookup] = await Promise.all([
    getOrgSettings(supabase, orgId),
    getBusinessHoursForOrg(supabase, orgId),
  ]);
  const hours = lookup.rows;

  // No rows at all is the "no hours configured" case, which the checks
  // above deliberately fail open on. Listing seven closed days here would
  // contradict that, so nothing is stated and the prompt omits the section.
  // A FAILED read lands here too, and must: stating nothing lets the
  // assistant say it does not know the hours, where inventing a list
  // from an unread table would have it quote hours that do not exist.
  if (lookup.failed || hours.length === 0) {
    return {
      hasConfiguredHours: false,
      emergencyModeEnabled: settings.emergencyModeEnabled,
      appointmentDurationMinutes: settings.appointmentDurationMinutes,
      lines: [],
    };
  }

  const lines: string[] = [];

  // Monday-first ordering, which is how a UK business states its hours.
  for (let offset = 1; offset <= 7; offset++) {
    const dayOfWeek = offset % 7;
    const row = hours.find((h) => h.day_of_week === dayOfWeek);
    const name = DAY_NAMES[dayOfWeek];

    // A day with no row is what isWithinBusinessHours treats as closed, so
    // it is stated as closed rather than omitted — an omitted day invites
    // the assistant to fill the gap with an invented time.
    if (!row || row.is_closed || !row.open_time || !row.close_time) {
      lines.push(`${name}: closed`);
      continue;
    }

    let line = `${name}: ${toHhMm(row.open_time)} to ${toHhMm(row.close_time)}`;
    if (row.lunch_start && row.lunch_end) {
      line += ` (closed for lunch ${toHhMm(row.lunch_start)} to ${toHhMm(row.lunch_end)})`;
    }
    lines.push(line);
  }

  return {
    hasConfiguredHours: hours.length > 0,
    emergencyModeEnabled: settings.emergencyModeEnabled,
    appointmentDurationMinutes: settings.appointmentDurationMinutes,
    lines,
  };
}

/**
 * Checks whether a given ISO datetime falls within the org's configured
 * business hours (accounting for closed days and lunch breaks).
 * If emergency mode is on, or no hours are configured, treats everything
 * as available so this never blocks bookings unexpectedly.
 */
export async function isWithinBusinessHours(
  orgId: string,
  isoDatetime: string,
  /**
   * The org's already-resolved IANA zone, when the caller has one.
   *
   * Supplying it is what keeps this fix free: checkBookingSlot and the
   * voice tool both resolve the zone once for the whole operation and
   * pass it down, so no additional organisations read is introduced on
   * either live path. Omitted, this resolves it itself — correct, just
   * one query dearer, which suits the low-frequency manage-link route.
   */
  timezone?: string
): Promise<AvailabilityResult> {
  const supabase = createAdminClient();

  const { emergencyModeEnabled, appointmentDurationMinutes } =
    await getOrgSettings(supabase, orgId);
  if (emergencyModeEnabled) {
    return { isAvailable: true };
  }

  // FAIL CLOSED on an unresolvable zone, for the same reason the unread
  // hours table below fails closed: "09:00-17:00" is meaningless without
  // knowing whose clock it is on. Substituting Europe/London would not
  // be a neutral guess — it is what let a New York business accept a
  // booking three hours before it opened.
  let zone = timezone;
  if (!zone) {
    const resolution = await resolveOrgTimezone(orgId);
    if (!resolution.resolved) {
      console.error(
        `[availability] org ${orgId} has no trustworthy timezone — not confirming any slot`
      );
      return { isAvailable: false, reason: "lookup_failed" };
    }
    zone = resolution.timezone;
  }

  const lookup = await getBusinessHoursForOrg(supabase, orgId);

  // FAIL CLOSED. An unread table is not an open diary: confirming a
  // booking here would promise a time nothing ever validated, which is
  // the same mistake as treating an unreadable calendar as free.
  if (lookup.failed) {
    return { isAvailable: false, reason: "lookup_failed" };
  }

  const hours = lookup.rows;
  if (hours.length === 0) {
    return { isAvailable: true, reason: "no_hours_configured" };
  }

  const { dayOfWeek, minutesOfDay } = getZonedParts(isoDatetime, zone);
  const dayConfig = hours.find((h) => h.day_of_week === dayOfWeek);

  if (!dayConfig || dayConfig.is_closed) {
    return { isAvailable: false, reason: "closed_day" };
  }

  const openMinutes = timeStringToMinutes(dayConfig.open_time);
  const closeMinutes = timeStringToMinutes(dayConfig.close_time);

  if (openMinutes === null || closeMinutes === null) {
    return { isAvailable: false, reason: "closed_day" };
  }

  if (minutesOfDay < openMinutes || minutesOfDay >= closeMinutes) {
    return { isAvailable: false, reason: "outside_hours" };
  }

  const lunchStart = timeStringToMinutes(dayConfig.lunch_start);
  const lunchEnd = timeStringToMinutes(dayConfig.lunch_end);

  if (lunchStart !== null && lunchEnd !== null) {
    if (minutesOfDay >= lunchStart && minutesOfDay < lunchEnd) {
      return { isAvailable: false, reason: "lunch_break" };
    }
  }

  // The start time is open; check the appointment also finishes by closing.
  // A 15-minute slot at 18:45 against a 19:00 close is fine; a 60-minute one
  // is not — and that distinction is reported, rather than pretending the
  // requested time was outside business hours.
  if (minutesOfDay + appointmentDurationMinutes > closeMinutes) {
    return {
      isAvailable: false,
      reason: "ends_after_close",
      appointmentDurationMinutes,
      minutesUntilClose: closeMinutes - minutesOfDay,
    };
  }

  return { isAvailable: true };
}

/**
 * Walks forward from the requested time, in appointment-duration steps,
 * to find the next slot that falls within business hours.
 * Returns null if nothing is found within a 14-day search window.
 */
export interface SlotSearchOptions {
  /**
   * Extra condition a candidate must satisfy, checked after business
   * hours and capacity. Used to skip slots that are busy on an external
   * calendar, with the busy list fetched once by the caller so scanning
   * costs no additional provider requests.
   *
   * Omitted by default, which leaves this function's behaviour exactly
   * as it was before external calendars existed.
   */
  isAcceptable?: (candidateIso: string) => boolean;
  /**
   * The org's already-resolved IANA zone, when the caller has one.
   *
   * Resolved ONCE here and reused for every candidate — the walk below
   * runs up to maxIterations times, so looking the zone up inside the
   * loop would turn one query into hundreds.
   */
  timezone?: string;
}

export async function findNextAvailableSlot(
  orgId: string,
  isoDatetime: string,
  options: SlotSearchOptions = {}
): Promise<string | null> {
  const supabase = createAdminClient();

  const { emergencyModeEnabled, appointmentDurationMinutes } = await getOrgSettings(supabase, orgId);
  if (emergencyModeEnabled) {
    return isoDatetime;
  }

  // Same rule as isWithinBusinessHours: without a trustworthy zone there
  // is no honest answer to "when do they open?", and null here means the
  // caller offers no alternative rather than a fabricated one.
  let zone = options.timezone;
  if (!zone) {
    const resolution = await resolveOrgTimezone(orgId);
    if (!resolution.resolved) {
      console.error(
        `[availability] org ${orgId} has no trustworthy timezone — suggesting no alternative`
      );
      return null;
    }
    zone = resolution.timezone;
  }

  const lookup = await getBusinessHoursForOrg(supabase, orgId);

  // FAIL CLOSED, mirroring isWithinBusinessHours: a suggestion built on
  // an unread table is a time nobody checked. Returning null means the
  // caller offers no alternative rather than a fabricated one.
  if (lookup.failed) return null;

  const hours = lookup.rows;
  if (hours.length === 0) {
    return isoDatetime;
  }

  const hoursByDay = new Map(hours.map((h) => [h.day_of_week, h]));
  const stepMinutes = appointmentDurationMinutes > 0 ? appointmentDurationMinutes : 30;
  const maxIterations = Math.ceil((SEARCH_WINDOW_DAYS * 24 * 60) / stepMinutes);

  let cursor = new Date(isoDatetime);

  for (let i = 0; i < maxIterations; i++) {
    const { dayOfWeek, minutesOfDay } = getZonedParts(cursor.toISOString(), zone);
    const dayConfig = hoursByDay.get(dayOfWeek);

    if (dayConfig && !dayConfig.is_closed) {
      const openMinutes = timeStringToMinutes(dayConfig.open_time);
      const closeMinutes = timeStringToMinutes(dayConfig.close_time);
      const lunchStart = timeStringToMinutes(dayConfig.lunch_start);
      const lunchEnd = timeStringToMinutes(dayConfig.lunch_end);

      if (openMinutes !== null && closeMinutes !== null) {
        const inLunch =
          lunchStart !== null &&
          lunchEnd !== null &&
          minutesOfDay >= lunchStart &&
          minutesOfDay < lunchEnd;

        // Mirrors isWithinBusinessHours: a suggested alternative must also
        // finish before closing, or Remy would offer a slot it would then
        // have to refuse.
        const fitsBeforeClose =
          minutesOfDay + appointmentDurationMinutes <= closeMinutes;

        if (minutesOfDay >= openMinutes && fitsBeforeClose && !inLunch) {
          const candidateIso = cursor.toISOString();
        const hasCapacity = await isSlotAvailable(orgId, candidateIso);
        // The extra condition is checked last and only when the slot is
        // otherwise bookable, so omitting it leaves this loop identical.
        if (hasCapacity && (options.isAcceptable?.(candidateIso) ?? true)) {
          return candidateIso;
        }
        }
      }
    }

    cursor = new Date(cursor.getTime() + stepMinutes * 60 * 1000);
  }

  return null;
}
export interface SlotCapacityOptions {
  /**
   * A lead whose own booking must not count against it.
   *
   * Required for RESCHEDULES. Under the old exact-match rule a lead
   * moving from 10:00 to 10:30 never met itself, because the two
   * timestamps differed. Under overlap it does: its existing 10:00
   * booking overlaps the 10:30 it is moving to, so without this the
   * engine would refuse every short reschedule as a clash with itself.
   */
  excludeLeadId?: string | null;
}

/**
 * Whether an appointment starting at `isoDatetime` fits within the org's
 * configured `max_concurrent_bookings`.
 *
 * Counts every CONFIRMED booking whose interval OVERLAPS this one, not
 * merely those starting at the same instant. With 60-minute
 * appointments and a limit of one, 10:00 and 10:30 used to both pass:
 * neither timestamp equalled the other, so each saw a count of zero and
 * the business was double-booked. Overlap is expressed as a range on
 * `appointment_datetime` (see appointmentOverlapWindow) so the database
 * can still answer it with an index range scan rather than a table scan.
 *
 * Half-open, so genuinely adjacent appointments remain bookable: one
 * finishing exactly as this begins is not a conflict.
 *
 * FAILS CLOSED. A failed count used to return true — "don't block
 * bookings on a query error" — which meant a database blip produced a
 * confirmed booking nothing had validated. An unknown is not a free
 * slot, and the caller already treats false as "offer an alternative".
 */
export interface SlotCapacityResult {
  available: boolean;
  /**
   * True when the count could not be made at all. `available` is false
   * either way — the distinction exists so a caller can say "we could
   * not check" instead of the untrue "that slot is fully booked".
   */
  failed: boolean;
}

/**
 * The detailed form of isSlotAvailable, for callers that must tell a
 * genuine clash apart from an unreadable one.
 */
export async function checkSlotCapacity(
  orgId: string,
  isoDatetime: string,
  options: SlotCapacityOptions = {}
): Promise<SlotCapacityResult> {
  const supabase = createAdminClient();

  const { data: orgData } = await supabase
    .from("organisations")
    .select("max_concurrent_bookings, appointment_duration_minutes")
    .eq("id", orgId)
    .maybeSingle();

  const maxConcurrent = orgData?.max_concurrent_bookings ?? 1;
  const durationMinutes = orgData?.appointment_duration_minutes ?? 60;

  const window = appointmentOverlapWindow(isoDatetime, durationMinutes);
  if (!window) {
    console.error("[availability] unparseable appointment instant:", isoDatetime);
    return { available: false, failed: true };
  }

  let query = supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "booked")
    .gt("appointment_datetime", window.afterIso)
    .lt("appointment_datetime", window.beforeIso);

  if (options.excludeLeadId) {
    query = query.neq("id", options.excludeLeadId);
  }

  const { count, error } = await query;

  if (error) {
    console.error("[availability] failed to check slot capacity:", error.message);
    // Fail CLOSED — an unchecked slot is not a free one.
    return { available: false, failed: true };
  }

  return { available: (count ?? 0) < maxConcurrent, failed: false };
}

/**
 * Whether the slot has capacity. Boolean form, kept for the callers
 * that only need a yes/no — the slot-grid walker and the voice path.
 */
export async function isSlotAvailable(
  orgId: string,
  isoDatetime: string,
  options: SlotCapacityOptions = {}
): Promise<boolean> {
  return (await checkSlotCapacity(orgId, isoDatetime, options)).available;
}
