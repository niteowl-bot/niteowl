import { expiryFromSeconds, assertStrategy } from "@/lib/integrations/auth";
import { IntegrationError, type IntegrationErrorKind } from "@/lib/integrations/errors";
import { integrationFetch, type FetchLike } from "@/lib/integrations/http";
import { addMinutesIso, toProviderLocalTime } from "@/lib/calendar/timezone";
import type {
  AuthUrlParams,
  BusyInterval,
  CalendarEventInput,
  ExternalEventRef,
  Integration,
  IntegrationAccount,
  IntegrationCredentials,
  IntegrationResource,
} from "@/lib/integrations/types";

// ── Google Calendar integration ───────────────────────────────────
//
// Every Google-specific fact lives in this file: endpoint URLs, scope
// names, the shape of a calendarList entry, the base32hex event-id
// alphabet. Nothing outside it knows Google exists — the booking engine
// receives a CalendarCapability from the registry and calls it.
//
// The provider is stateless: credentials arrive as an argument, already
// decrypted and refreshed by the connection layer.

const PROVIDER_ID = "google";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

/**
 * Least privilege that still works:
 *   calendar.events    create/update/delete Remy's own events
 *   calendar.readonly  list calendars, and query free/busy
 *   openid, email      identify which account was connected
 *
 * calendar.events and calendar.readonly are SENSITIVE scopes: an app
 * using them needs Google verification before external users can
 * consent at scale, and an unverified app left in Testing mode has
 * refresh tokens that expire after seven days.
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

/** The scopes a connection must actually hold to be usable. */
export const GOOGLE_REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  fetchImpl?: FetchLike;
}

export function loadGoogleConfig(
  env: Record<string, string | undefined> = process.env
): GoogleConfig | null {
  const clientId = env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

// ── Idempotent event ids ──────────────────────────────────────────

/**
 * Google accepts a client-supplied event id, which is the strongest
 * duplicate guard available: a retry that repeats a create returns 409
 * instead of making a second event.
 *
 * The id must be base32hex — digits 0-9 and letters a-v only, 5 to 1024
 * characters. A UUID's hex digits are already inside that alphabet, so
 * a lead id converts directly. The "rem" prefix marks Remy's events in
 * a shared calendar and is itself legal (r, e, m all precede v — "remy"
 * would not be, because y is outside the alphabet).
 */
export function toGoogleEventId(idempotencyKey: string): string {
  const cleaned = String(idempotencyKey).toLowerCase().replace(/[^0-9a-v]/g, "");
  if (cleaned.length < 2) {
    throw new IntegrationError(
      `Cannot derive a Google event id from "${idempotencyKey}".`,
      { kind: "permanent", provider: PROVIDER_ID }
    );
  }
  return `rem${cleaned}`.slice(0, 1024);
}

// ── Error refinement ──────────────────────────────────────────────

/**
 * Google overloads 403: it means "slow down" for rate limits and
 * "you cannot do that" for permissions, and only the body's reason code
 * separates them. Retrying a permissions failure forever would be
 * pointless; not retrying a rate limit would drop a booking.
 */
function refineGoogleError(status: number, body: unknown): IntegrationErrorKind | null {
  const record = body as { error?: unknown } | null;
  const error = record?.error;

  if (typeof error === "string") {
    // Token endpoint: a dead or revoked refresh token.
    if (error === "invalid_grant") return "auth_expired";
    return null;
  }

  if (status === 403 && error && typeof error === "object") {
    const errors = (error as { errors?: Array<{ reason?: string }> }).errors ?? [];
    const reason = errors[0]?.reason ?? "";
    if (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") {
      return "rate_limited";
    }
    return "forbidden";
  }

  return null;
}

// ── OAuth ─────────────────────────────────────────────────────────

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

function toCredentials(
  response: GoogleTokenResponse,
  now: Date = new Date()
): IntegrationCredentials {
  if (!response.access_token) {
    throw new IntegrationError("Google returned no access token.", {
      kind: "permanent",
      provider: PROVIDER_ID,
    });
  }
  return {
    strategy: "oauth2",
    accessToken: response.access_token,
    // Absent on refresh — the connection layer keeps the stored one.
    refreshToken: response.refresh_token ?? null,
    expiresAtIso: expiryFromSeconds(response.expires_in, now),
    scopes: response.scope ?? null,
  };
}

export function buildGoogleAuthUrl(
  config: GoogleConfig,
  params: AuthUrlParams
): string {
  const query = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    state: params.state,
    // Both are required to be handed a refresh token. Without
    // access_type=offline there is none at all; without prompt=consent
    // a reconnecting account gets an access token only, and the
    // connection dies silently an hour later.
    access_type: "offline",
    include_granted_scopes: "true",
  });
  if (params.forceConsent !== false) {
    query.set("prompt", "consent");
  }
  return `${AUTH_ENDPOINT}?${query.toString()}`;
}

// ── Calendar payloads ─────────────────────────────────────────────

interface GoogleCalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  accessRole?: string;
  primary?: boolean;
  timeZone?: string;
  deleted?: boolean;
}

export function toIntegrationResource(
  entry: GoogleCalendarListEntry
): IntegrationResource {
  return {
    externalId: entry.id,
    name: entry.summaryOverride || entry.summary || entry.id,
    resourceType: "calendar",
    // Only owner/writer can have events created on them; reader and
    // freeBusyReader can still be consulted for conflicts.
    writable: entry.accessRole === "owner" || entry.accessRole === "writer",
    isDefault: entry.primary === true,
    metadata: { timezone: entry.timeZone ?? null, accessRole: entry.accessRole ?? null },
  };
}

/**
 * Google's event body. Start and end are LOCAL wall time plus the IANA
 * zone — never a UTC offset, so daylight saving stays Google's problem
 * and a booking either side of a transition displays correctly.
 */
export function buildGoogleEventBody(
  input: CalendarEventInput
): Record<string, unknown> {
  const endIso = addMinutesIso(input.startIso, input.durationMinutes);
  const body: Record<string, unknown> = {
    summary: input.title,
    start: {
      dateTime: toProviderLocalTime(input.startIso, input.timezone),
      timeZone: input.timezone,
    },
    end: {
      dateTime: toProviderLocalTime(endIso, input.timezone),
      timeZone: input.timezone,
    },
  };

  if (input.description) body.description = input.description;
  if (input.location) body.location = input.location;
  if (input.attendeeEmail) {
    body.attendees = [
      {
        email: input.attendeeEmail,
        displayName: input.attendeeName ?? undefined,
      },
    ];
  }

  return body;
}

export function parseFreeBusyResponse(
  body: unknown,
  calendarId: string
): BusyInterval[] {
  const calendars = (body as { calendars?: Record<string, unknown> } | null)?.calendars;
  const entry = calendars?.[calendarId] as
    | { busy?: Array<{ start?: string; end?: string }>; errors?: Array<{ reason?: string }> }
    | undefined;

  if (entry?.errors?.length) {
    const reason = entry.errors[0]?.reason ?? "unknown";
    // A calendar we cannot read must NOT silently look free — that
    // would double-book a customer. Surfaced as an error so the caller
    // falls back to internal checks and flags the connection.
    throw new IntegrationError(
      `Google could not read calendar ${calendarId}: ${reason}`,
      {
        kind: reason === "notFound" ? "not_found" : "forbidden",
        provider: PROVIDER_ID,
        providerCode: reason,
      }
    );
  }

  return (entry?.busy ?? [])
    .filter((slot) => slot.start && slot.end)
    .map((slot) => ({
      startIso: new Date(slot.start as string).toISOString(),
      endIso: new Date(slot.end as string).toISOString(),
    }));
}

// ── The integration ───────────────────────────────────────────────

export function createGoogleIntegration(config: GoogleConfig): Integration {
  const fetchImpl = config.fetchImpl;

  const call = <T>(request: Parameters<typeof integrationFetch>[0]) =>
    integrationFetch<T>({
      ...request,
      provider: PROVIDER_ID,
      fetchImpl: request.fetchImpl ?? fetchImpl,
      refineError: refineGoogleError,
    });

  const accessTokenOf = (credentials: IntegrationCredentials): string =>
    assertStrategy(credentials, "oauth2").accessToken;

  return {
    manifest: {
      id: PROVIDER_ID,
      label: "Google Calendar",
      description:
        "Check availability against your Google Calendar and add confirmed appointments to it.",
      capabilities: ["calendar"],
      resourceType: "calendar",
      resourceLabel: "Calendar",
    },

    auth: {
      id: "oauth2",

      buildAuthUrl: (params) => buildGoogleAuthUrl(config, params),

      exchangeCode: async (code, redirectUri) => {
        const { body } = await call<GoogleTokenResponse>({
          url: TOKEN_ENDPOINT,
          method: "POST",
          provider: PROVIDER_ID,
          form: {
            code,
            client_id: config.clientId,
            client_secret: config.clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
          },
        });
        return toCredentials(body);
      },

      refresh: async (credentials) => {
        const oauth = assertStrategy(credentials, "oauth2");
        if (!oauth.refreshToken) {
          throw new IntegrationError("Google connection has no refresh token.", {
            kind: "auth_expired",
            provider: PROVIDER_ID,
          });
        }
        const { body } = await call<GoogleTokenResponse>({
          url: TOKEN_ENDPOINT,
          method: "POST",
          provider: PROVIDER_ID,
          form: {
            refresh_token: oauth.refreshToken,
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: "refresh_token",
          },
        });
        return toCredentials(body);
      },

      revoke: async (credentials) => {
        // Best effort: an already-revoked token is the desired end state.
        try {
          const oauth = assertStrategy(credentials, "oauth2");
          const token = oauth.refreshToken ?? oauth.accessToken;
          if (!token) return;
          await call({
            url: REVOKE_ENDPOINT,
            method: "POST",
            provider: PROVIDER_ID,
            form: { token },
          });
        } catch {
          // Disconnect must succeed locally even if Google refuses.
        }
      },
    },

    getAccount: async (credentials): Promise<IntegrationAccount> => {
      const { body } = await call<{ sub?: string; email?: string; name?: string }>({
        url: USERINFO_ENDPOINT,
        provider: PROVIDER_ID,
        accessToken: accessTokenOf(credentials),
      });
      if (!body.sub) {
        throw new IntegrationError("Google returned no account identifier.", {
          kind: "permanent",
          provider: PROVIDER_ID,
        });
      }
      return {
        accountId: body.sub,
        email: body.email ?? null,
        displayName: body.name ?? null,
      };
    },

    listResources: async (credentials): Promise<IntegrationResource[]> => {
      const { body } = await call<{ items?: GoogleCalendarListEntry[] }>({
        url: `${CALENDAR_API}/users/me/calendarList?minAccessRole=reader&showDeleted=false`,
        provider: PROVIDER_ID,
        accessToken: accessTokenOf(credentials),
      });
      return (body.items ?? [])
        .filter((entry) => entry.id && !entry.deleted)
        .map(toIntegrationResource);
    },

    calendar: {
      getBusyIntervals: async (credentials, calendarId, fromIso, toIso) => {
        // ONE request for the whole window — a caller scanning for a
        // free slot depends on that, or suggesting an alternative would
        // cost a round trip per candidate.
        const { body } = await call<unknown>({
          url: `${CALENDAR_API}/freeBusy`,
          method: "POST",
          provider: PROVIDER_ID,
          accessToken: accessTokenOf(credentials),
          json: {
            timeMin: new Date(fromIso).toISOString(),
            timeMax: new Date(toIso).toISOString(),
            items: [{ id: calendarId }],
          },
        });
        return parseFreeBusyResponse(body, calendarId);
      },

      createEvent: async (credentials, calendarId, input): Promise<ExternalEventRef> => {
        const eventId = toGoogleEventId(input.idempotencyKey);
        try {
          const { body } = await call<{ id?: string; etag?: string }>({
            url: `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
            method: "POST",
            provider: PROVIDER_ID,
            accessToken: accessTokenOf(credentials),
            json: { ...buildGoogleEventBody(input), id: eventId },
          });
          return {
            eventId: body.id ?? eventId,
            etag: body.etag ?? null,
            alreadyExisted: false,
          };
        } catch (error) {
          // 409 means this exact event id is already there — the retry
          // that produced it succeeded the first time. Reporting success
          // is what stops a duplicate appointment appearing.
          if (error instanceof IntegrationError && error.kind === "conflict") {
            return { eventId, etag: null, alreadyExisted: true };
          }
          throw error;
        }
      },

      updateEvent: async (credentials, calendarId, eventId, input) => {
        const { body } = await call<{ id?: string; etag?: string }>({
          url: `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
          method: "PATCH",
          provider: PROVIDER_ID,
          accessToken: accessTokenOf(credentials),
          json: buildGoogleEventBody(input),
        });
        return {
          eventId: body.id ?? eventId,
          etag: body.etag ?? null,
          alreadyExisted: false,
        };
      },

      cancelEvent: async (credentials, calendarId, eventId) => {
        try {
          await call({
            url: `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
            method: "DELETE",
            provider: PROVIDER_ID,
            accessToken: accessTokenOf(credentials),
          });
        } catch (error) {
          // Already gone is the outcome we wanted. Google answers 410
          // for a deleted event and 404 for one that never existed;
          // both map to not_found.
          if (error instanceof IntegrationError && error.kind === "not_found") return;
          throw error;
        }
      },
    },
  };
}
