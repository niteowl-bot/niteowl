import { createAdminClient } from "@/lib/supabase/admin";

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

  const hoursByDay = new Map(hours.map((h) => [h.day_of_week, h]));
  const stepMinutes = appointmentDurationMinutes > 0 ? appointmentDurationMinutes : 30;
  const maxIterations = Math.ceil((SEARCH_WINDOW_DAYS * 24 * 60) / stepMinutes);

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
        const hasCapacity = await isSlotAvailable(orgId, candidateIso);
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
