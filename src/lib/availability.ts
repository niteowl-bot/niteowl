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
// ISO datetime, in the business's own timezone. The parameter defaults
// to the historical constant so every existing caller behaves exactly
// as it did before per-org timezones existed.
function getLondonParts(
  isoDatetime: string,
  timezone: string = TIMEZONE
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

async function getBusinessHoursForOrg(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string
): Promise<BusinessHoursRow[]> {
  const { data, error } = await supabase
    .from("business_hours")
    .select("day_of_week, is_closed, open_time, close_time, lunch_start, lunch_end")
    .eq("org_id", orgId);

  if (error) {
    console.error("[availability] failed to fetch business hours:", error.message);
    return [];
  }
  return data ?? [];
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
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("organisations")
    .select("timezone")
    .eq("id", orgId)
    .maybeSingle();

  if (error || !data?.timezone) return TIMEZONE;

  const timezone = String(data.timezone);
  if (!isValidTimezone(timezone)) {
    console.error(
      `[availability] org ${orgId} has an unusable timezone (${timezone}); falling back to ${TIMEZONE}`
    );
    return TIMEZONE;
  }
  return timezone;
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

  const [settings, hours] = await Promise.all([
    getOrgSettings(supabase, orgId),
    getBusinessHoursForOrg(supabase, orgId),
  ]);

  // No rows at all is the "no hours configured" case, which the checks
  // above deliberately fail open on. Listing seven closed days here would
  // contradict that, so nothing is stated and the prompt omits the section.
  if (hours.length === 0) {
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
   * The zone the org's opening hours are stated in. Resolved from the
   * organisation when omitted, so every existing caller becomes
   * timezone-correct without changing. Passed explicitly only by a
   * caller that already holds it and wants to avoid the extra lookup.
   */
  timezone?: string
): Promise<AvailabilityResult> {
  const supabase = createAdminClient();

  const { emergencyModeEnabled, appointmentDurationMinutes } =
    await getOrgSettings(supabase, orgId);
  if (emergencyModeEnabled) {
    return { isAvailable: true };
  }

  const hours = await getBusinessHoursForOrg(supabase, orgId);
  if (hours.length === 0) {
    return { isAvailable: true, reason: "no_hours_configured" };
  }

  const zone = timezone ?? (await getOrgTimezone(orgId));
  const { dayOfWeek, minutesOfDay } = getLondonParts(isoDatetime, zone);
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
   * The zone the org's opening hours are stated in. Resolved from the
   * organisation when omitted, so every existing caller becomes
   * timezone-correct without changing. Passed explicitly only by a
   * caller that already holds it and wants to avoid the extra lookup.
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

  const hours = await getBusinessHoursForOrg(supabase, orgId);
  if (hours.length === 0) {
    return isoDatetime;
  }

  const zone = options.timezone ?? (await getOrgTimezone(orgId));
  const hoursByDay = new Map(hours.map((h) => [h.day_of_week, h]));
  const stepMinutes = appointmentDurationMinutes > 0 ? appointmentDurationMinutes : 30;
  const maxIterations = Math.ceil((SEARCH_WINDOW_DAYS * 24 * 60) / stepMinutes);

  let cursor = new Date(isoDatetime);

  for (let i = 0; i < maxIterations; i++) {
    const { dayOfWeek, minutesOfDay } = getLondonParts(
      cursor.toISOString(),
      zone
    );
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
/**
 * Checks how many "booked" leads already occupy the same appointment slot
 * (based on exact appointment_datetime match) and compares against the
 * org's configured max_concurrent_bookings.
 */
export async function isSlotAvailable(
  orgId: string,
  isoDatetime: string
): Promise<boolean> {
  const supabase = createAdminClient();

  const { data: orgData } = await supabase
    .from("organisations")
    .select("max_concurrent_bookings")
    .eq("id", orgId)
    .maybeSingle();

  const maxConcurrent = orgData?.max_concurrent_bookings ?? 1;

  const { count, error } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "booked")
    .eq("appointment_datetime", isoDatetime);

  if (error) {
    console.error("[availability] failed to check slot capacity:", error.message);
    return true; // fail open — don't block bookings on a query error
  }

  return (count ?? 0) < maxConcurrent;
}
