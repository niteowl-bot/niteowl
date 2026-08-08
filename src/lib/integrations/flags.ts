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

/**
 * Which organisations may have events WRITTEN to their calendar.
 *
 * The fourth level, and the first that changes anything in someone's
 * Google account. Reading is a question; writing is a consequence — so
 * unlike the three switches above, this one is an ALLOWLIST rather than
 * a boolean.
 *
 * A global boolean could not express "the test org only". It would have
 * been safe today purely because one org happens to have connected a
 * calendar, and that is a property of the DATA, not of the flag:
 * selecting a calendar sets sync_enabled = true automatically, so any
 * org connecting one during a rollout would start receiving writes with
 * no further action. An allowlist makes the blast radius something you
 * state rather than something you infer.
 *
 * Format: comma-separated org UUIDs. Whitespace is ignored and matching
 * is case-insensitive, so a copy-pasted id cannot fail silently.
 *
 * UNSET OR EMPTY MEANS NOBODY. Same failure direction as the switches
 * above: a misconfigured environment writes to no calendar at all,
 * never to the wrong one.
 */
export function isCalendarEventCreationEnabled(
  orgId: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (!isCalendarSyncEnabled(env)) return false;
  if (!orgId) return false;

  const allowed = (env.CALENDAR_EVENT_CREATION_ORG_IDS ?? "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);

  return allowed.includes(orgId.trim().toLowerCase());
}
