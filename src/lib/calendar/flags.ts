// ── Kill switch ───────────────────────────────────────────────────
//
// Mirrors the VOICE_ENABLED pattern: the entire calendar integration is
// dark unless the flag is explicitly "true". Anything else — unset,
// empty, "1", "yes", a typo — reads as off, so the failure mode of a
// misconfigured environment is "no calendar sync", never "half a
// calendar sync against production customers".
//
// Every calendar entry point checks this. With it off:
//   * OAuth routes 404
//   * availability falls back to the internal engine alone
//   * no sync jobs are enqueued or drained
//   * Settings hides the Integrations section
// which is exactly the behaviour of the build before this feature.

export function isCalendarSyncEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.CALENDAR_SYNC_ENABLED === "true";
}

/**
 * Availability blocking is flagged separately from the rest of the
 * feature so it can run in log-only mode first (milestone 3): busy
 * intervals are fetched and what WOULD have been refused is logged,
 * while every booking still goes through. Only once that log agrees
 * with reality does blocking turn on (milestone 4).
 *
 * Off unless "true", and meaningless unless isCalendarSyncEnabled().
 */
export function isCalendarAvailabilityBlocking(
  env: Record<string, string | undefined> = process.env
): boolean {
  return isCalendarSyncEnabled(env) && env.CALENDAR_AVAILABILITY_BLOCKING === "true";
}
