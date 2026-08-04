// ── Calendar provider abstraction ─────────────────────────────────
//
// The booking engine must never import google.ts or microsoft.ts. It
// talks to CalendarProvider and nothing else, and obtains an instance
// only through the registry. Adding Apple, CalDAV or an ICS feed later
// means writing one file that satisfies this interface and registering
// it — no change to availability checking, lead capture, or the sync
// queue.
//
// Two rules shape the interface:
//
//  1. Providers are STATELESS. Every method takes the access token it
//     should use. Token storage, decryption and refresh are the
//     connection layer's job, so a provider never touches the database
//     and can be unit-tested against a fake fetch.
//
//  2. Times cross this boundary as UTC instants (ISO strings) plus an
//     explicit IANA timezone. No provider is trusted to guess a zone,
//     and no caller is allowed to send a bare local time.

/**
 * Registered provider identifiers. This is the app-side allowlist —
 * the database deliberately does not constrain the column, so adding a
 * provider never needs a migration.
 */
export type CalendarProviderId = "google" | "microsoft";

/** A window the calendar is already occupied for. Half-open: [start, end). */
export interface BusyInterval {
  startIso: string;
  endIso: string;
}

/** A calendar the connected account can see. */
export interface ExternalCalendar {
  id: string;
  name: string;
  /** False for calendars the account can read but not write to. */
  writable: boolean;
  /** The provider's default calendar for this account, when it says so. */
  isDefault: boolean;
  /** IANA zone the provider reports for the calendar, when it reports one. */
  timezone: string | null;
}

/** OAuth tokens as returned by a provider. Never persisted in this shape. */
export interface ProviderTokenSet {
  accessToken: string;
  /**
   * Absent on refresh for providers that only issue one at first grant
   * (Google). The caller keeps the existing refresh token in that case.
   */
  refreshToken: string | null;
  /** Absolute expiry, so callers never have to reason about "expires_in". */
  expiresAtIso: string | null;
  scopes: string | null;
}

/** Who the tokens belong to, for display and for account identity. */
export interface ProviderAccount {
  /** Stable provider-side id. Google "sub", Microsoft "id". */
  accountId: string;
  email: string | null;
  displayName: string | null;
}

/** Everything needed to write an appointment into a calendar. */
export interface CalendarEventInput {
  title: string;
  description: string | null;
  location: string | null;
  /** UTC instant the appointment starts. */
  startIso: string;
  durationMinutes: number;
  /** IANA zone the event should display in. Never optional. */
  timezone: string;
  /**
   * Stable per-appointment key. Providers that accept a client-supplied
   * id or transaction id use it to make creation idempotent, so a retry
   * cannot produce a second event.
   */
  idempotencyKey: string;
  attendeeEmail: string | null;
  attendeeName: string | null;
}

/** What the provider gave back after a write. */
export interface ExternalEventRef {
  eventId: string;
  /** Concurrency token, when the provider issues one. */
  etag: string | null;
  /** True when the event already existed and was returned as-is. */
  alreadyExisted: boolean;
}

/** Where a provider should send the user back after consent. */
export interface AuthUrlParams {
  redirectUri: string;
  /** Opaque CSRF value the callback must echo back. */
  state: string;
  /**
   * Hints the provider to re-prompt for consent. Required on Google to
   * guarantee a refresh token on a repeat connect.
   */
  forceConsent?: boolean;
}

/**
 * The contract every calendar provider satisfies.
 *
 * Implementations must throw CalendarProviderError (see errors.ts) so
 * the sync queue can decide between retrying, re-authorising and giving
 * up without knowing which provider failed.
 */
export interface CalendarProvider {
  readonly id: CalendarProviderId;
  /** Shown in Settings, e.g. "Google Calendar". */
  readonly label: string;

  // ── OAuth ──
  buildAuthUrl(params: AuthUrlParams): string;
  exchangeCode(code: string, redirectUri: string): Promise<ProviderTokenSet>;
  refreshAccessToken(refreshToken: string): Promise<ProviderTokenSet>;
  /** Best-effort revocation on disconnect. Must not throw on failure. */
  revokeAccess(tokens: ProviderTokenSet): Promise<void>;

  // ── Account and calendars ──
  getAccount(accessToken: string): Promise<ProviderAccount>;
  listCalendars(accessToken: string): Promise<ExternalCalendar[]>;

  // ── Availability ──
  /**
   * Busy windows between two UTC instants. Implementations should make
   * ONE request for the whole window; callers scanning for a free slot
   * rely on that to avoid a request per candidate.
   */
  getBusyIntervals(
    accessToken: string,
    calendarId: string,
    fromIso: string,
    toIso: string
  ): Promise<BusyInterval[]>;

  // ── Events ──
  createEvent(
    accessToken: string,
    calendarId: string,
    input: CalendarEventInput
  ): Promise<ExternalEventRef>;

  updateEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    input: CalendarEventInput
  ): Promise<ExternalEventRef>;

  /** Idempotent: an already-deleted event is a success, not an error. */
  cancelEvent(
    accessToken: string,
    calendarId: string,
    eventId: string
  ): Promise<void>;
}

/** Persisted connection state, as the sync layer sees it. */
export type CalendarConnectionStatus =
  | "connected"
  | "needs_reauth"
  | "error"
  | "disconnected";

/** Per-appointment sync state, mirrored on the lead. */
export type CalendarSyncStatus =
  | "pending"
  | "synced"
  | "failed"
  | "skipped"
  | "deleted";

export type CalendarSyncOperation = "create" | "update" | "cancel";
