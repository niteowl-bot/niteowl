// ── Kill switches ─────────────────────────────────────────────────
//
// Mirrors the VOICE_ENABLED pattern: nothing is live unless a flag is
// explicitly "true". Anything else — unset, empty, "1", "yes", a typo —
// reads as off, so the failure mode of a misconfigured environment is
// "no integrations", never "half an integration against production
// customers".
//
// Three levels, so a problem can be contained without turning
// everything off:
//
//   INTEGRATIONS_ENABLED           the framework itself. Off ⇒ OAuth
//                                  routes 404, no jobs drain, Settings
//                                  hides the section.
//   CALENDAR_SYNC_ENABLED          the calendar capability. Off ⇒ no
//                                  availability lookups, no events
//                                  written, booking behaves as today.
//   CALENDAR_AVAILABILITY_BLOCKING whether a busy calendar may actually
//                                  refuse a slot. Off ⇒ log-only mode.
//
// Each is gated by the one above it, so turning the framework off is
// always sufficient.

function isTrue(value: string | undefined): boolean {
  return value === "true";
}

export function isIntegrationsEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return isTrue(env.INTEGRATIONS_ENABLED);
}

export function isCalendarSyncEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return isIntegrationsEnabled(env) && isTrue(env.CALENDAR_SYNC_ENABLED);
}

/**
 * Availability blocking is flagged separately so it can run in log-only
 * mode first (milestone 3): busy intervals are fetched and what WOULD
 * have been refused is logged, while every booking still goes through.
 * Only once that log agrees with reality does blocking turn on
 * (milestone 4).
 */
export function isCalendarAvailabilityBlocking(
  env: Record<string, string | undefined> = process.env
): boolean {
  return isCalendarSyncEnabled(env) && isTrue(env.CALENDAR_AVAILABILITY_BLOCKING);
}
