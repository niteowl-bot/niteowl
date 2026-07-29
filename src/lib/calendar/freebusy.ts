import { createAdminClient } from "@/lib/supabase/admin";
import { getFreshAccessToken } from "./connection";

// ── Google Calendar free/busy reads (Step 2) ─────────────────────
// Reads real-time busy intervals from a business's connected Google
// Calendar so the shared availability engine (src/lib/availability.ts)
// can refuse a slot that clashes with a real calendar event. This module
// only READS — it never creates, updates, or deletes events (that's a
// later step). Uses the authenticated connection + token refresh from
// Step 1 (connection.ts).

const FREEBUSY_ENDPOINT = "https://www.googleapis.com/calendar/v3/freeBusy";

export interface BusyInterval {
  startMs: number;
  endMs: number;
}

// Three distinct outcomes the availability engine must treat differently:
//  - no_connection: org hasn't connected a calendar → calendar plays no
//    part, existing behaviour is fully preserved.
//  - ok: we have an authoritative busy list for the queried window.
//  - error: a calendar IS connected but we couldn't read it (expired/
//    revoked token, API down, calendar error). The engine treats this as
//    "cannot confirm free" and fails closed — it must never offer a slot
//    it couldn't verify against a connected calendar.
export type CalendarBusyResult =
  | { status: "no_connection" }
  | { status: "ok"; busy: BusyInterval[] }
  | { status: "error" };

async function getCalendarId(orgId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("calendar_connections")
    .select("calendar_id, connected")
    .eq("org_id", orgId)
    .maybeSingle();
  if (!data || !data.connected) return null;
  return data.calendar_id ?? "primary";
}

/**
 * Fetches the connected calendar's busy intervals overlapping
 * [startIso, endIso]. One network call regardless of how many slots the
 * caller intends to test against the result.
 */
export async function getCalendarBusy(
  orgId: string,
  startIso: string,
  endIso: string
): Promise<CalendarBusyResult> {
  const calendarId = await getCalendarId(orgId);
  if (!calendarId) return { status: "no_connection" };

  let accessToken: string | null;
  try {
    accessToken = await getFreshAccessToken(orgId);
  } catch (err) {
    console.error("[calendar/freebusy] token retrieval failed:", err);
    return { status: "error" };
  }
  if (!accessToken) {
    // Connected row exists but no usable token (e.g. refresh token revoked).
    // Fail closed rather than silently ignoring the calendar.
    return { status: "error" };
  }

  try {
    const res = await fetch(FREEBUSY_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin: startIso,
        timeMax: endIso,
        items: [{ id: calendarId }],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.error("[calendar/freebusy] HTTP error:", res.status);
      return { status: "error" };
    }

    const json = await res.json();
    const cal = json?.calendars?.[calendarId];
    // A per-calendar error (e.g. notFound, insufficient scope) means we
    // can't trust the empty busy list — treat as error, not "free".
    if (!cal || (Array.isArray(cal.errors) && cal.errors.length > 0)) {
      console.error("[calendar/freebusy] calendar error:", JSON.stringify(cal?.errors ?? "missing calendar"));
      return { status: "error" };
    }

    const busy: BusyInterval[] = Array.isArray(cal.busy)
      ? cal.busy
          .map((b: { start?: string; end?: string }) => ({
            startMs: b.start ? new Date(b.start).getTime() : NaN,
            endMs: b.end ? new Date(b.end).getTime() : NaN,
          }))
          .filter((b: BusyInterval) => Number.isFinite(b.startMs) && Number.isFinite(b.endMs))
      : [];

    return { status: "ok", busy };
  } catch (err) {
    console.error("[calendar/freebusy] request failed:", err);
    return { status: "error" };
  }
}

/**
 * Pure overlap test: does the proposed appointment window
 * [slotStartMs, slotEndMs) collide with any busy interval? Half-open
 * comparison so an event ending exactly when the slot starts (or starting
 * exactly when it ends) does NOT count as a clash — the buffer, applied by
 * the caller when it widens the window, is what enforces any gap.
 */
export function slotConflictsWithBusy(
  slotStartMs: number,
  slotEndMs: number,
  busy: BusyInterval[]
): boolean {
  return busy.some((b) => b.startMs < slotEndMs && b.endMs > slotStartMs);
}
