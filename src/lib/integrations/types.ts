// ── Integration Framework ─────────────────────────────────────────
//
// Every external service this product connects to — Google Calendar,
// Microsoft, CRMs, WhatsApp, Instagram, SMS — plugs in here. None of
// them brings its own authentication, settings page or connection
// management, because all of that is identical between them and only
// two things actually differ:
//
//   CAPABILITY   what the integration can do (calendar, messaging, crm)
//   AUTH STRATEGY how it authenticates (oauth2, api_key, basic, none)
//
// Both are values here and interfaces below, never new tables and never
// new routes.
//
// The domain layer asks the registry for a CAPABILITY and receives
// something it can call. It never learns which vendor answered, so
// adding a provider cannot require a change to the booking engine, lead
// capture or the job queue.

// ── Capabilities ──────────────────────────────────────────────────
//
// Deliberately only 'calendar' today. Messaging and CRM interfaces get
// defined when there is a real requirement to shape them — inventing
// message-threading or deal-pipeline semantics with no product spec
// behind them would bake a guess into the framework, and a wrong guess
// is worse than no abstraction because everything then fights it.
export type CapabilityId = "calendar";

// ── Auth strategies ───────────────────────────────────────────────
//
// Not everything is OAuth, and assuming it was would have failed at the
// first SMS provider:
//   oauth2  Google, Microsoft, Meta, HubSpot
//   api_key Twilio (account SID + auth token)
//   basic   CalDAV (username + app password)
//   none    a public ICS feed URL
export type AuthStrategyId = "oauth2" | "api_key" | "basic" | "none";

/**
 * The credential document stored — encrypted — in
 * integration_connections.credentials_encrypted. Its shape is chosen by
 * the strategy, which is why the column is one blob rather than
 * OAuth-shaped columns.
 */
export type IntegrationCredentials =
  | {
      strategy: "oauth2";
      accessToken: string;
      /** Absent on providers that only issue one at first grant (Google). */
      refreshToken: string | null;
      /** Absolute expiry, so nothing has to reason about "expires_in". */
      expiresAtIso: string | null;
      scopes: string | null;
    }
  | { strategy: "api_key"; values: Record<string, string> }
  | { strategy: "basic"; username: string; password: string }
  | { strategy: "none" };

/** A field the owner fills in for non-OAuth strategies. */
export interface IntegrationConfigField {
  key: string;
  label: string;
  /** Rendered as a password input and never echoed back to the browser. */
  secret: boolean;
  placeholder?: string;
  required: boolean;
}

/** Who the credentials belong to, for display and account identity. */
export interface IntegrationAccount {
  /** Stable provider-side id. Google "sub", Microsoft "id". */
  accountId: string;
  email: string | null;
  displayName: string | null;
}

/**
 * A remote object the business selects to act on: a calendar, a
 * WhatsApp number, an Instagram page, a CRM pipeline. One table
 * (integration_resources) holds all of them, keyed by resourceType.
 */
export interface IntegrationResource {
  externalId: string;
  name: string;
  resourceType: string;
  /** False for resources the account can read but not write to. */
  writable: boolean;
  /** The provider's default for this account, when it says so. */
  isDefault: boolean;
  /** Free-form provider detail (a calendar's IANA zone, a number's country). */
  metadata: Record<string, string | null>;
}

// ── Auth strategy interfaces ──────────────────────────────────────

export interface AuthUrlParams {
  redirectUri: string;
  /** Opaque CSRF value the callback must echo back. */
  state: string;
  /**
   * Force a consent re-prompt. Required on Google to guarantee a refresh
   * token when the same account reconnects.
   */
  forceConsent?: boolean;
}

/**
 * Per-operation overrides for a provider call.
 *
 * Exists so an operation with a caller waiting — the availability
 * lookup, which races an 8s timer with someone on the phone — can
 * impose its own deadline WITHOUT tightening it for connect, resource
 * listing or event writes, which have no such caller and a different
 * latency profile.
 */
export interface ProviderCallOptions {
  /** Deadline for the underlying HTTP request(s). */
  timeoutMs?: number;
}

export interface OAuth2Strategy {
  readonly id: "oauth2";
  buildAuthUrl(params: AuthUrlParams): string;
  exchangeCode(code: string, redirectUri: string): Promise<IntegrationCredentials>;
  refresh(
    credentials: IntegrationCredentials,
    options?: ProviderCallOptions
  ): Promise<IntegrationCredentials>;
  /** Best effort on disconnect. Must not throw — a revoked token is fine. */
  revoke(credentials: IntegrationCredentials): Promise<void>;
}

export interface ApiKeyStrategy {
  readonly id: "api_key";
  readonly fields: IntegrationConfigField[];
  /** Proves the key works before it is stored, so a typo fails loudly. */
  validate(values: Record<string, string>): Promise<IntegrationCredentials>;
}

export interface BasicAuthStrategy {
  readonly id: "basic";
  readonly fields: IntegrationConfigField[];
  validate(username: string, password: string): Promise<IntegrationCredentials>;
}

export interface NoAuthStrategy {
  readonly id: "none";
  readonly fields: IntegrationConfigField[];
}

export type AuthStrategy =
  | OAuth2Strategy
  | ApiKeyStrategy
  | BasicAuthStrategy
  | NoAuthStrategy;

// ── The integration itself ────────────────────────────────────────

/** What Settings renders a card from. No per-integration page exists. */
export interface IntegrationManifest {
  /** Registry id, and the value stored in integration_connections.provider. */
  id: string;
  label: string;
  description: string;
  capabilities: CapabilityId[];
  /** The kind of remote object the owner picks after connecting. */
  resourceType: string | null;
  /** Copy for the Settings card when no resource has been chosen yet. */
  resourceLabel: string | null;
}

/**
 * Everything an integration must provide. Capabilities hang off it as
 * optional slots, so a Twilio integration simply has no `calendar` and
 * the type system stops the booking engine reaching for one.
 *
 * Implementations are STATELESS: every method takes the credentials it
 * should use, so an integration never touches the database and can be
 * unit-tested against a fake fetch. Decryption, refresh and status
 * transitions belong to the connection layer.
 */
export interface Integration {
  readonly manifest: IntegrationManifest;
  readonly auth: AuthStrategy;

  getAccount(credentials: IntegrationCredentials): Promise<IntegrationAccount>;
  listResources(credentials: IntegrationCredentials): Promise<IntegrationResource[]>;

  /** Present only when manifest.capabilities includes "calendar". */
  calendar?: CalendarCapability;
}

// ── Calendar capability ───────────────────────────────────────────
//
// The only capability defined today. Lives here rather than in the
// calendar feature because the framework's registry must be able to
// type the slot above.

/** A window the calendar is already occupied for. Half-open: [start, end). */
export interface BusyInterval {
  startIso: string;
  endIso: string;
}

/** Everything needed to write an appointment into a calendar. */
export interface CalendarEventInput {
  title: string;
  description: string | null;
  location: string | null;
  /** UTC instant the appointment starts. */
  startIso: string;
  durationMinutes: number;
  /**
   * IANA zone the event should display in. Never optional and never
   * defaulted — providers receive local wall time plus this name, so
   * daylight saving stays the provider's problem.
   */
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

export interface CalendarCapability {
  /**
   * Busy windows between two UTC instants. Implementations must make ONE
   * request for the whole window — a caller scanning for a free slot
   * relies on that to avoid a request per candidate.
   */
  getBusyIntervals(
    credentials: IntegrationCredentials,
    calendarId: string,
    fromIso: string,
    toIso: string,
    options?: ProviderCallOptions
  ): Promise<BusyInterval[]>;

  createEvent(
    credentials: IntegrationCredentials,
    calendarId: string,
    input: CalendarEventInput
  ): Promise<ExternalEventRef>;

  updateEvent(
    credentials: IntegrationCredentials,
    calendarId: string,
    eventId: string,
    input: CalendarEventInput
  ): Promise<ExternalEventRef>;

  /** Idempotent: an already-deleted event is a success, not an error. */
  cancelEvent(
    credentials: IntegrationCredentials,
    calendarId: string,
    eventId: string
  ): Promise<void>;
}

// ── Persisted state ───────────────────────────────────────────────

export type ConnectionStatus =
  | "connected"
  | "needs_reauth"
  | "error"
  | "disconnected";

export type LinkSyncStatus =
  | "pending"
  | "synced"
  | "failed"
  | "skipped"
  | "deleted";
