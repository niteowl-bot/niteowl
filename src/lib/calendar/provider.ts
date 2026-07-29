import { googleCalendarProvider } from "./google";

// ── Calendar provider abstraction ─────────────────────────────────
// Step 1 only registers Google. Adding Outlook (or any other calendar)
// later means writing an outlook.ts that implements this same interface
// and adding one line to PROVIDERS below — nothing else (the OAuth
// routes, the connection store, the Settings page, and later the
// availability/booking hooks) needs to change. Mirrors the shape of the
// payment-provider abstraction in src/lib/billing/provider.ts.
//
// Step 1 needs only the OAuth lifecycle + account identification below.
// Free/busy reads and event create/update/delete get added to this
// interface in later steps, alongside their Google implementations.

export interface OAuthTokens {
  accessToken: string;
  // Google only returns a refresh token on the FIRST consent (with
  // access_type=offline + prompt=consent). Null on re-consent when the
  // user has already granted access — callers must keep the previously
  // stored refresh token in that case rather than overwriting it with null.
  refreshToken: string | null;
  // Epoch ms at which the access token expires.
  expiresAt: number | null;
  scopes: string | null;
}

export interface CalendarProvider {
  name: string;
  // Builds the provider consent URL the owner is redirected to. `state`
  // is an opaque CSRF token the callback validates.
  getAuthUrl(state: string): string;
  // Exchanges the authorization code from the callback for tokens.
  exchangeCode(code: string): Promise<OAuthTokens>;
  // Refreshes an expired access token using a stored refresh token.
  refreshAccessToken(refreshToken: string): Promise<OAuthTokens>;
  // The email address of the connected account, for status display.
  getAccountEmail(accessToken: string): Promise<string | null>;
  // Best-effort revocation of a token at the provider on disconnect.
  revoke(token: string): Promise<void>;
}

const PROVIDERS: Record<string, CalendarProvider> = {
  google: googleCalendarProvider,
};

export function getCalendarProvider(name: string = "google"): CalendarProvider {
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`Unknown calendar provider: ${name}`);
  return provider;
}
