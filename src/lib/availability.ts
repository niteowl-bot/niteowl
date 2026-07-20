import { createAdminClient } from "@/lib/supabase/admin";
import {
  getCalendarBusy,
  slotConflictsWithBusy,
  type CalendarBusyResult,
} from "@/lib/calendar/freebusy";

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
  reason?: "closed_day" | "outside_hours" | "lunch_break" | "no_hours_configured";
}

// Extract local Europe/London weekday (0=Sun) and minutes-since-midnight from an ISO datetime
function getLondonParts(isoDatetime: string): { dayOfWeek: number; minutesOfDay: number } {
  const date = new Date(isoDatetime);

  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
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

async function getOrgSettings(
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

// Read in its OWN query, tolerant of the column not existing yet, so this
// code is safe to deploy before docs/sql/2026-07-20_booking_buffer_minutes
// .sql is run: a missing column just reads as 0 (no buffer = today's
// behaviour) without failing the critical org-settings/capacity queries
// above, which deliberately never select this new column.
async function getBookingBufferMinutes(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string
): Promise<number> {
  const { data, error } = await supabase
    .from("organisations")
    .select("booking_buffer_minutes")
    .eq("id", orgId)
    .maybeSingle();

  if (error) return 0; // column not present yet, or transient error
  return data?.booking_buffer_minutes ?? 0;
}

/**
 * Checks whether a given ISO datetime falls within the org's configured
 * business hours (accounting for closed days and lunch breaks).
 * If emergency mode is on, or no hours are configured, treats everything
 * as available so this never blocks bookings unexpectedly.
 */
export async function isWithinBusinessHours(
  orgId: string,
  isoDatetime: string
): Promise<AvailabilityResult> {
  const supabase = createAdminClient();

  const { emergencyModeEnabled } = await getOrgSettings(supabase, orgId);
  if (emergencyModeEnabled) {
    return { isAvailable: true };
  }

  const hours = await getBusinessHoursForOrg(supabase, orgId);
  if (hours.length === 0) {
    return { isAvailable: true, reason: "no_hours_configured" };
  }

  const { dayOfWeek, minutesOfDay } = getLondonParts(isoDatetime);
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

  return { isAvailable: true };
}

/**
 * Walks forward from the requested time, in appointment-duration steps,
 * to find the next slot that falls within business hours.
 * Returns null if nothing is found within a 14-day search window.
 */
export async function findNextAvailableSlot(
  orgId: string,
  isoDatetime: string
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

  const bookingBufferMinutes = await getBookingBufferMinutes(supabase, orgId);

  const hoursByDay = new Map(hours.map((h) => [h.day_of_week, h]));
  const stepMinutes = appointmentDurationMinutes > 0 ? appointmentDurationMinutes : 30;
  const maxIterations = Math.ceil((SEARCH_WINDOW_DAYS * 24 * 60) / stepMinutes);

  // Fetch the connected calendar's busy list ONCE for the whole search
  // window (widened by duration + buffer so a candidate near the end of
  // the window is still fully covered) instead of one free/busy call per
  // candidate slot. Passed into each isSlotAvailable check below.
  const windowStart = new Date(isoDatetime);
  const windowEnd = new Date(
    windowStart.getTime() +
      SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000 +
      (appointmentDurationMinutes + bookingBufferMinutes) * 60 * 1000
  );
  const calendarBusy = await getCalendarBusy(
    orgId,
    windowStart.toISOString(),
    windowEnd.toISOString()
  );
  // A connected calendar we can't read must not yield a suggestion at all —
  // suggesting a slot we couldn't verify risks offering a busy time.
  if (calendarBusy.status === "error") {
    return null;
  }

  let cursor = new Date(isoDatetime);

  for (let i = 0; i < maxIterations; i++) {
    const { dayOfWeek, minutesOfDay } = getLondonParts(cursor.toISOString());
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

        if (minutesOfDay >= openMinutes && minutesOfDay < closeMinutes && !inLunch) {
          const candidateIso = cursor.toISOString();
        const hasCapacity = await isSlotAvailable(orgId, candidateIso, {
          calendarBusy,
          bufferMinutes: bookingBufferMinutes,
        });
        if (hasCapacity) {
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
 * Checks whether a slot is available. Two layered checks:
 *  1. Internal capacity — how many "booked" leads already occupy the exact
 *     same appointment_datetime, vs the org's max_concurrent_bookings.
 *     Unchanged from before; fails OPEN on a query error.
 *  2. Connected Google Calendar (Step 2) — only when the org has connected
 *     a calendar. The slot must additionally not clash with any real
 *     calendar event in [start - buffer, start + duration + buffer).
 *     Fails CLOSED: if a calendar is connected but can't be read, the slot
 *     is treated as unavailable, so a busy or unverifiable slot is never
 *     offered. Orgs with no connected calendar are completely unaffected —
 *     the calendar branch short-circuits to the capacity result.
 *
 * opts.calendarBusy lets a caller that already fetched the calendar's busy
 * list for a range (e.g. findNextAvailableSlot scanning many candidates)
 * pass it in, so the whole scan costs one free/busy call instead of one
 * per candidate.
 */
export async function isSlotAvailable(
  orgId: string,
  isoDatetime: string,
  opts?: { calendarBusy?: CalendarBusyResult; bufferMinutes?: number }
): Promise<boolean> {
  const supabase = createAdminClient();

  const { data: orgData } = await supabase
    .from("organisations")
    .select("max_concurrent_bookings, appointment_duration_minutes")
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

  const withinCapacity = (count ?? 0) < maxConcurrent;
  if (!withinCapacity) return false;

  // Prefetched no_connection (from findNextAvailableSlot) means calendar
  // plays no part — short-circuit before any further reads.
  if (opts?.calendarBusy?.status === "no_connection") return true;

  // ── Layer 2: connected Google Calendar free/busy (additive) ──────
  const durationMinutes = orgData?.appointment_duration_minutes ?? 60;
  const bufferMinutes = opts?.bufferMinutes ?? (await getBookingBufferMinutes(supabase, orgId));
  const slotStartMs = new Date(isoDatetime).getTime();
  const slotEndMs = slotStartMs + durationMinutes * 60 * 1000;
  const bufferMs = bufferMinutes * 60 * 1000;
  // Widen the tested window by the buffer on both sides so a new
  // appointment can't sit flush against an existing calendar event.
  const windowStartMs = slotStartMs - bufferMs;
  const windowEndMs = slotEndMs + bufferMs;

  const calendarBusy =
    opts?.calendarBusy ??
    (await getCalendarBusy(
      orgId,
      new Date(windowStartMs).toISOString(),
      new Date(windowEndMs).toISOString()
    ));

  if (calendarBusy.status === "no_connection") return true;
  if (calendarBusy.status === "error") return false; // fail closed — never offer an unverifiable slot
  return !slotConflictsWithBusy(windowStartMs, windowEndMs, calendarBusy.busy);
}
