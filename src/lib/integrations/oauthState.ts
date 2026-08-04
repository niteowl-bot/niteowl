import { safeEquals } from "@/lib/integrations/crypto";

// ── OAuth state (CSRF) ────────────────────────────────────────────
//
// The state value is kept in an httpOnly cookie rather than a database
// table: it lives for one redirect, and a table would mean a migration
// plus a sweep for abandoned rows.
//
// What state does and does not protect:
//   * It proves the callback belongs to the browser that started the
//     flow, so an attacker cannot trick an owner into attaching the
//     attacker's Google account to the owner's business.
//   * It is NOT how the org is identified. The org always comes from the
//     authenticated session at callback time, never from the state or
//     any query parameter, so a forged state cannot redirect a
//     connection into another tenant.

export const OAUTH_STATE_COOKIE = "niteowl_integration_state";

/** One redirect's worth. Long enough for a slow consent screen. */
export const OAUTH_STATE_MAX_AGE_SECONDS = 600;

export interface StateCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
}

/**
 * sameSite "lax" — not "strict" — because the callback arrives as a
 * top-level navigation from the provider's domain, and a strict cookie
 * would not be sent, breaking every connection attempt.
 */
export function stateCookieOptions(isProduction: boolean): StateCookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  };
}

/** The cookie value binds the nonce to the provider it was issued for. */
export function encodeStateCookie(provider: string, nonce: string): string {
  return `${provider}:${nonce}`;
}

export interface StateVerification {
  valid: boolean;
  reason?: "missing_cookie" | "missing_state" | "provider_mismatch" | "nonce_mismatch";
}

/**
 * Verifies a callback's state against the cookie issued at the start.
 *
 * Compared in constant time, and the provider is checked too: a nonce
 * issued for one integration must not be replayable against another's
 * callback.
 */
export function verifyStateCookie(
  cookieValue: string | undefined,
  returnedState: string | undefined | null,
  provider: string
): StateVerification {
  if (!cookieValue) return { valid: false, reason: "missing_cookie" };
  if (!returnedState) return { valid: false, reason: "missing_state" };

  const separator = cookieValue.indexOf(":");
  if (separator === -1) return { valid: false, reason: "provider_mismatch" };

  const cookieProvider = cookieValue.slice(0, separator);
  const cookieNonce = cookieValue.slice(separator + 1);

  if (!safeEquals(cookieProvider, provider)) {
    return { valid: false, reason: "provider_mismatch" };
  }
  if (!cookieNonce || !safeEquals(cookieNonce, returnedState)) {
    return { valid: false, reason: "nonce_mismatch" };
  }

  return { valid: true };
}
