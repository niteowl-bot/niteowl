import { OAuth2Client } from "google-auth-library";
import type { CalendarProvider, OAuthTokens } from "./provider";

// ── Google implementation of CalendarProvider ─────────────────────
// Everything Google-specific (the OAuth2 client, consent URL, code
// exchange, token refresh, revocation, account lookup) is isolated to
// this file — mirrors how src/lib/billing/stripe.ts isolates all
// Stripe-specific logic behind the PaymentProvider interface.
//
// Scopes are requested up front so later steps (read free/busy, write
// events) never trigger a re-consent:
//   calendar.events    — create/update/delete appointments (Step 3/4)
//   calendar.readonly   — free/busy availability reads (Step 2)
//   openid email        — identify the connected account for status display
// The first two are Google "sensitive" scopes; during alpha the pilot
// businesses are added as OAuth "test users" so no app verification is
// required (see docs/CALENDAR_SETUP_RUNBOOK.md).
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "openid",
  "email",
];

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const REDIRECT_URI = `${APP_URL}/api/calendar/google/callback`;

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo";

function getOAuthClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not configured.");
  }
  return new OAuth2Client(clientId, clientSecret, REDIRECT_URI);
}

function toTokens(raw: {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  expires_in?: number | null;
  scope?: string | null;
}): OAuthTokens {
  const expiresAt =
    typeof raw.expiry_date === "number"
      ? raw.expiry_date
      : typeof raw.expires_in === "number"
      ? Date.now() + raw.expires_in * 1000
      : null;

  return {
    accessToken: raw.access_token ?? "",
    refreshToken: raw.refresh_token ?? null,
    expiresAt,
    scopes: raw.scope ?? null,
  };
}

export const googleCalendarProvider: CalendarProvider = {
  name: "google",

  getAuthUrl(state: string): string {
    const client = getOAuthClient();
    // access_type=offline + prompt=consent guarantees a refresh token is
    // returned on first connect; without prompt=consent Google omits the
    // refresh token on any re-consent, leaving us unable to refresh later.
    return client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: SCOPES,
      state,
      include_granted_scopes: true,
    });
  },

  async exchangeCode(code: string): Promise<OAuthTokens> {
    const client = getOAuthClient();
    const { tokens } = await client.getToken(code);
    return toTokens(tokens);
  },

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not configured.");
    }

    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Google token refresh failed (${res.status}): ${detail.slice(0, 200)}`);
    }

    // A refresh response never includes a new refresh token — preserve the
    // caller's existing one by returning null here.
    const json = await res.json();
    return toTokens({ ...json, refresh_token: null });
  },

  async getAccountEmail(accessToken: string): Promise<string | null> {
    const res = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.error("[calendar/google] userinfo lookup failed:", res.status);
      return null;
    }
    const json = await res.json();
    return typeof json.email === "string" ? json.email : null;
  },

  async revoke(token: string): Promise<void> {
    // Best-effort — a failed revoke must never block disconnect, which
    // clears our own stored tokens regardless.
    try {
      await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    } catch (err) {
      console.error("[calendar/google] token revoke failed (non-fatal):", err);
    }
  },
};
