import { createAdminClient } from "@/lib/supabase/admin";
import { getCalendarProvider } from "./provider";
import type { OAuthTokens } from "./provider";
import { encryptToken, decryptToken } from "./tokenCrypto";

// ── Calendar connection store ─────────────────────────────────────
// The single place that reads/writes the calendar_connections table.
// Every query manually scopes by org_id (the table is service-role only,
// RLS is not enforced for this client) — same trust model as the voice
// and widget code paths. Tokens are encrypted (tokenCrypto) before they
// ever touch the database and decrypted only here, server-side.

export interface CalendarConnection {
  orgId: string;
  provider: string;
  accountEmail: string | null;
  calendarId: string;
  connected: boolean;
  tokenExpiresAt: string | null;
}

// A refresh-lead time: treat an access token expiring within this window
// as already stale, so we refresh proactively rather than mid-request.
const EXPIRY_SKEW_MS = 60_000;

// Shape returned to the Settings page — never includes tokens.
export async function loadConnection(orgId: string): Promise<CalendarConnection | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("calendar_connections")
    .select("org_id, provider, account_email, calendar_id, connected, token_expires_at")
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) {
    console.error("[calendar] loadConnection failed:", error.message);
    return null;
  }
  if (!data || !data.connected) return null;

  return {
    orgId: data.org_id,
    provider: data.provider,
    accountEmail: data.account_email,
    calendarId: data.calendar_id,
    connected: data.connected,
    tokenExpiresAt: data.token_expires_at,
  };
}

// Persist a freshly-obtained token set for an org, marking it connected.
// A null refreshToken (Google's behaviour on re-consent, or on a plain
// refresh) preserves whatever refresh token is already stored.
export async function saveConnection(params: {
  orgId: string;
  provider: string;
  accountEmail: string | null;
  tokens: OAuthTokens;
}): Promise<void> {
  const admin = createAdminClient();
  const { orgId, provider, accountEmail, tokens } = params;

  const row: Record<string, unknown> = {
    org_id: orgId,
    provider,
    connected: true,
    access_token_enc: tokens.accessToken ? encryptToken(tokens.accessToken) : null,
    token_expires_at: tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : null,
    scopes: tokens.scopes,
    updated_at: new Date().toISOString(),
  };
  if (accountEmail !== null) row.account_email = accountEmail;
  if (tokens.refreshToken) row.refresh_token_enc = encryptToken(tokens.refreshToken);

  const { error } = await admin
    .from("calendar_connections")
    .upsert(row, { onConflict: "org_id" });

  if (error) {
    throw new Error(`Failed to save calendar connection: ${error.message}`);
  }
}

// Returns a valid access token for the org's connected calendar,
// refreshing (and persisting the refreshed token) if the stored one is
// expired or nearly so. Returns null if the org has no usable connection.
// Used by later steps (free/busy reads, event writes), not by Step 1's
// connect flow itself.
export async function getFreshAccessToken(orgId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("calendar_connections")
    .select("provider, access_token_enc, refresh_token_enc, token_expires_at, connected")
    .eq("org_id", orgId)
    .maybeSingle();

  if (error || !data || !data.connected) return null;

  const expiresAt = data.token_expires_at ? new Date(data.token_expires_at).getTime() : 0;
  const stillValid =
    data.access_token_enc && expiresAt > Date.now() + EXPIRY_SKEW_MS;

  if (stillValid) {
    try {
      return decryptToken(data.access_token_enc as string);
    } catch (err) {
      console.error("[calendar] failed to decrypt access token, will refresh:", err);
    }
  }

  if (!data.refresh_token_enc) return null;

  let refreshToken: string;
  try {
    refreshToken = decryptToken(data.refresh_token_enc as string);
  } catch (err) {
    console.error("[calendar] failed to decrypt refresh token:", err);
    return null;
  }

  const provider = getCalendarProvider(data.provider);
  const refreshed = await provider.refreshAccessToken(refreshToken);

  await admin
    .from("calendar_connections")
    .update({
      access_token_enc: refreshed.accessToken ? encryptToken(refreshed.accessToken) : null,
      token_expires_at: refreshed.expiresAt ? new Date(refreshed.expiresAt).toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", orgId);

  return refreshed.accessToken || null;
}

// Revokes tokens at the provider (best-effort) and removes the stored
// connection row entirely.
export async function disconnect(orgId: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("calendar_connections")
    .select("provider, refresh_token_enc, access_token_enc")
    .eq("org_id", orgId)
    .maybeSingle();

  if (data) {
    const provider = getCalendarProvider(data.provider);
    const encToken = data.refresh_token_enc ?? data.access_token_enc;
    if (encToken) {
      try {
        await provider.revoke(decryptToken(encToken as string));
      } catch (err) {
        console.error("[calendar] revoke during disconnect failed (non-fatal):", err);
      }
    }
  }

  const { error } = await admin.from("calendar_connections").delete().eq("org_id", orgId);
  if (error) {
    throw new Error(`Failed to disconnect calendar: ${error.message}`);
  }
}
