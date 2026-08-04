import { randomBytes } from "node:crypto";

import type {
  AuthStrategy,
  AuthStrategyId,
  IntegrationCredentials,
  OAuth2Strategy,
} from "@/lib/integrations/types";

// ── Auth strategy helpers ─────────────────────────────────────────
//
// Provider-independent logic shared by every authentication style. The
// per-provider parts (endpoint URLs, scope names, token response shapes)
// live in the provider files; everything here is pure and testable.

/** Refresh this long before expiry, so a request never races the clock. */
const REFRESH_SKEW_SECONDS = 120;

export function isOAuth2Strategy(strategy: AuthStrategy): strategy is OAuth2Strategy {
  return strategy.id === "oauth2";
}

/** Narrowing helper so providers can assert the shape they were handed. */
export function assertStrategy<T extends AuthStrategyId>(
  credentials: IntegrationCredentials,
  strategy: T
): Extract<IntegrationCredentials, { strategy: T }> {
  if (credentials.strategy !== strategy) {
    throw new Error(
      `Expected ${strategy} credentials but received ${credentials.strategy}.`
    );
  }
  return credentials as Extract<IntegrationCredentials, { strategy: T }>;
}

/**
 * Whether stored credentials need refreshing before use.
 *
 * Only OAuth credentials expire. An API key or app password is valid
 * until the owner revokes it, which surfaces as an auth_expired error
 * from the provider rather than as a clock comparison here.
 *
 * Credentials with no recorded expiry are treated as needing a refresh
 * when a refresh token exists: not knowing when a token dies is not the
 * same as knowing it is alive, and a needless refresh is cheap next to
 * a failed customer booking.
 */
export function needsRefresh(
  credentials: IntegrationCredentials,
  now: Date = new Date(),
  skewSeconds: number = REFRESH_SKEW_SECONDS
): boolean {
  if (credentials.strategy !== "oauth2") return false;
  if (!credentials.refreshToken) return false;
  if (!credentials.expiresAtIso) return true;

  const expiresAt = new Date(credentials.expiresAtIso).getTime();
  if (Number.isNaN(expiresAt)) return true;

  return expiresAt - now.getTime() <= skewSeconds * 1000;
}

/**
 * Merges a refresh response over the stored credentials.
 *
 * Google returns no refresh token when refreshing, so a naive
 * replacement would wipe the only long-lived credential the connection
 * has and force the owner to reconnect. The existing token is kept
 * whenever the provider does not supply a new one.
 */
export function mergeRefreshedCredentials(
  existing: IntegrationCredentials,
  refreshed: IntegrationCredentials
): IntegrationCredentials {
  if (existing.strategy !== "oauth2" || refreshed.strategy !== "oauth2") {
    return refreshed;
  }
  return {
    strategy: "oauth2",
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? existing.refreshToken,
    expiresAtIso: refreshed.expiresAtIso ?? existing.expiresAtIso,
    scopes: refreshed.scopes ?? existing.scopes,
  };
}

/**
 * Converts an OAuth "expires_in" (seconds from now) into the absolute
 * instant stored on the connection, so nothing downstream has to know
 * when the response was received.
 */
export function expiryFromSeconds(
  expiresInSeconds: unknown,
  now: Date = new Date()
): string | null {
  const seconds = Number(expiresInSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

/**
 * A CSRF value for an OAuth redirect. 32 bytes of randomness, URL-safe.
 * Stored server-side against the org before the redirect and compared
 * with crypto.safeEquals on the way back, so a callback cannot attach
 * someone else's account to a business.
 */
export function generateOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Whether the granted scopes cover everything the integration asked
 * for. Providers can silently grant a subset — Google lets a user
 * untick individual permissions on the consent screen — which would
 * otherwise surface much later as a confusing 403 mid-booking.
 */
export function hasRequiredScopes(
  granted: string | null,
  required: string[]
): boolean {
  if (required.length === 0) return true;
  if (!granted) return false;
  const grantedSet = new Set(granted.split(/[\s,]+/).filter(Boolean));
  return required.every((scope) => grantedSet.has(scope));
}

/** Scopes that were asked for but not granted, for the error message. */
export function missingScopes(
  granted: string | null,
  required: string[]
): string[] {
  const grantedSet = new Set((granted ?? "").split(/[\s,]+/).filter(Boolean));
  return required.filter((scope) => !grantedSet.has(scope));
}
