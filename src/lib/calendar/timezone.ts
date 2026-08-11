// ── Per-organisation timezones ────────────────────────────────────
//
// Until now "Europe/London" was a constant in a dozen files. Every
// helper here takes an explicit IANA zone instead — none of them has a
// default, so a caller cannot accidentally fall back to London for a
// business in Dublin, New York or Sydney.
//
// The rules this module exists to keep:
//   * The database stores UTC instants. Always.
//   * Providers receive LOCAL wall time plus the IANA zone name, never
//     a fixed UTC offset. "2026-10-25T01:30:00" + "Europe/London" is
//     unambiguous to Google and Microsoft; "+01:00" stops being true the
//     moment daylight saving ends, and a stored offset silently shifts
//     every recurring appointment after a transition.
//   * Nothing does arithmetic on local time. Adding minutes happens on
//     the UTC instant, so a slot that spans a DST boundary keeps its
//     real duration.

/** Mirrors the organisations.timezone column default. Not a fallback. */
export const DEFAULT_ORG_TIMEZONE = "Europe/London";

/**
 * Canonical IANA zone names this runtime knows, lowercased for lookup.
 *
 * Membership of this set — NOT "Intl accepted it" — is the validity
 * test, because Intl also accepts legacy abbreviations and resolves
 * them to something entirely different: "BST" is accepted and becomes
 * Asia/Dhaka (UTC+6), so an owner picking it for British Summer Time
 * would have every appointment six hours out with no error raised
 * anywhere. "EST" likewise becomes America/Panama. Only the ~418 zones
 * Intl itself lists as canonical are allowed through.
 */
const CANONICAL_ZONES: Set<string> = new Set(
  Intl.supportedValuesOf("timeZone").map((zone) => zone.toLowerCase())
);

// Intl omits UTC from supportedValuesOf on some ICU builds, and it is a
// legitimate choice for a business with no fixed locale.
CANONICAL_ZONES.add("utc");

/**
 * The Area/Location shape of a real IANA zone id — "Europe/London",
 * "America/Argentina/Buenos_Aires". At least one "/" is required, and
 * that single requirement is what keeps the legacy abbreviations out:
 * "BST", "EST", "PST", "CET", "GMT", "EST5EDT" and "PST8PDT" are all
 * accepted by Intl and all resolve somewhere else, and not one of them
 * contains a slash.
 */
const IANA_ID_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+$/;

/** Whether this runtime can actually compute with the zone. */
function isIntlComputable(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a string is a real IANA zone. Used to validate what an owner
 * picks in Settings before it is stored — a wrong-but-accepted zone
 * silently corrupts every subsequent date calculation for that org.
 *
 * Two ways to qualify, checked in that order:
 *
 *   1. Membership of this runtime's canonical list.
 *   2. Failing that, an Area/Location id this runtime can compute with.
 *
 * Rule 2 exists because `Intl.supportedValuesOf("timeZone")` omits IANA
 * LINK names, and WHICH names are links varies by ICU build: this one
 * lists "Asia/Calcutta" and not "Asia/Kolkata", newer builds do the
 * reverse. On the list alone, an owner in India picking the spelling
 * their runtime happens not to list had their zone rejected and
 * silently replaced with Europe/London — every appointment then 5½
 * hours out, with no error raised anywhere. That is the same class of
 * failure the list was introduced to prevent, arriving from the other
 * direction.
 *
 * It is a WIDENING, never a weakening: everything the list accepts is
 * still accepted, the abbreviations are still rejected (no slash), and
 * a zone this runtime cannot compute with is still rejected —
 * "Europe/Atlantis" and "Foo/Bar" have the right shape and both throw.
 *
 * Case-insensitive: "europe/london" is the same zone as "Europe/London".
 * Use canonicaliseTimezone before storing.
 */
export function isValidTimezone(timezone: string): boolean {
  if (typeof timezone !== "string" || !timezone.trim()) return false;
  const candidate = timezone.trim();
  if (CANONICAL_ZONES.has(candidate.toLowerCase())) return true;
  return IANA_ID_SHAPE.test(candidate) && isIntlComputable(candidate);
}

/**
 * The canonical spelling of a zone, for storage — so the database holds
 * "Europe/London" whatever case it arrived in. Returns null when the
 * zone is not one this runtime recognises, which callers must treat as
 * a validation failure rather than substituting a default.
 */
export function canonicaliseTimezone(timezone: string): string | null {
  if (!isValidTimezone(timezone)) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: timezone.trim() })
      .resolvedOptions()
      .timeZone;
  } catch {
    return null;
  }
}

/** Every selectable zone, sorted — the source for the Settings dropdown. */
export function listSupportedTimezones(): string[] {
  return [...Intl.supportedValuesOf("timeZone")].sort();
}

function assertValid(timezone: string): void {
  if (!isValidTimezone(timezone)) {
    throw new RangeError(`Unknown IANA timezone: ${String(timezone)}`);
  }
}

interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockParts(instant: Date, timezone: string): WallClockParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    parts[part.type] = part.value;
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // h23 renders midnight as "24" in some ICU versions; normalise it.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/**
 * The local wall-clock time of a UTC instant, formatted the way both
 * Google Calendar and Microsoft Graph expect alongside a timeZone field:
 * "YYYY-MM-DDTHH:mm:ss", with NO offset and NO trailing Z.
 *
 * Returning an offset here would defeat the point — the provider must
 * apply the zone itself so that daylight saving stays its problem.
 */
export function toProviderLocalTime(isoInstant: string, timezone: string): string {
  assertValid(timezone);
  const instant = new Date(isoInstant);
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError(`Invalid ISO instant: ${String(isoInstant)}`);
  }

  const p = wallClockParts(instant, timezone);
  return (
    `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}` +
    `T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
  );
}

/**
 * Adds minutes to a UTC instant. Deliberately arithmetic on the instant,
 * not on local time: 60 minutes after 01:30 on a spring-forward morning
 * is 03:30 local, and computing it locally would produce a time that
 * never happened.
 */
export function addMinutesIso(isoInstant: string, minutes: number): string {
  const instant = new Date(isoInstant);
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError(`Invalid ISO instant: ${String(isoInstant)}`);
  }
  if (!Number.isFinite(minutes)) {
    throw new RangeError(`Invalid minute offset: ${String(minutes)}`);
  }
  return new Date(instant.getTime() + minutes * 60_000).toISOString();
}

/**
 * The zone's UTC offset in minutes at a given instant — positive east of
 * Greenwich. Not used to build provider payloads; it exists so tests and
 * diagnostics can assert that a DST transition was handled, and so logs
 * can show which side of a transition a booking landed on.
 */
export function offsetMinutesAt(isoInstant: string, timezone: string): number {
  assertValid(timezone);
  const instant = new Date(isoInstant);
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError(`Invalid ISO instant: ${String(isoInstant)}`);
  }

  const p = wallClockParts(instant, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Second precision is enough: no IANA zone has a sub-minute offset.
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * True when a zone's offset changes across an appointment — i.e. the
 * booking straddles a daylight-saving transition. The event is still
 * written as local start time plus zone (the provider resolves it), but
 * this lets the sync layer log the case rather than discover it from a
 * confused customer.
 */
export function crossesDstTransition(
  startIso: string,
  durationMinutes: number,
  timezone: string
): boolean {
  const endIso = addMinutesIso(startIso, durationMinutes);
  return offsetMinutesAt(startIso, timezone) !== offsetMinutesAt(endIso, timezone);
}
