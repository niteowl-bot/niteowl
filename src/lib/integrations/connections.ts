import { createAdminClient } from "@/lib/supabase/admin";
import {
  decryptCredentials,
  encryptCredentials,
  loadKeyringFromEnv,
} from "@/lib/integrations/crypto";
import { mergeRefreshedCredentials, needsRefresh } from "@/lib/integrations/auth";
import { IntegrationError, requiresReauth } from "@/lib/integrations/errors";
import { getIntegration } from "@/lib/integrations/registry";
import type {
  ConnectionStatus,
  Integration,
  IntegrationAccount,
  IntegrationCredentials,
  IntegrationResource,
} from "@/lib/integrations/types";

// ── Connection lifecycle ──────────────────────────────────────────
//
// Connect, disconnect, store, refresh, reconnect, status — once, for
// every integration there will ever be. A provider never touches the
// database; this layer never knows which provider it is serving.
//
// TENANT ISOLATION. integration_connections is deny-all under RLS, so
// only the service-role client can read it. That client bypasses RLS
// entirely, which means every query here MUST carry an explicit
// org_id — never one taken from a request body or URL, always one
// resolved from the authenticated session by the caller. Each function
// therefore takes orgId as its first argument and filters on it even
// when a row id alone would be unique: a leaked or guessed connection
// id must not be enough to read another business's credentials.

/** A connection as the app sees it. Never carries decrypted secrets. */
export interface StoredConnection {
  id: string;
  orgId: string;
  provider: string;
  capabilities: string[];
  authStrategy: string;
  accountId: string;
  accountEmail: string | null;
  accountName: string | null;
  status: ConnectionStatus;
  lastError: string | null;
  tokenExpiresAt: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
}

export interface StoredResource {
  id: string;
  connectionId: string;
  resourceType: string;
  externalId: string;
  name: string | null;
  isPrimary: boolean;
  syncEnabled: boolean;
  availabilityEnabled: boolean;
}

const CONNECTION_COLUMNS =
  "id, org_id, provider, capabilities, auth_strategy, account_id, account_email, " +
  "account_name, status, last_error, token_expires_at, last_verified_at, created_at";

const RESOURCE_COLUMNS =
  "id, connection_id, resource_type, external_id, name, is_primary, sync_enabled, availability_enabled";

type ConnectionRow = {
  id: string;
  org_id: string;
  provider: string;
  capabilities: string[] | null;
  auth_strategy: string;
  account_id: string;
  account_email: string | null;
  account_name: string | null;
  status: string;
  last_error: string | null;
  token_expires_at: string | null;
  last_verified_at: string | null;
  created_at: string;
};

function toStoredConnection(row: ConnectionRow): StoredConnection {
  return {
    id: row.id,
    orgId: row.org_id,
    provider: row.provider,
    capabilities: row.capabilities ?? [],
    authStrategy: row.auth_strategy,
    accountId: row.account_id,
    accountEmail: row.account_email,
    accountName: row.account_name,
    status: row.status as ConnectionStatus,
    lastError: row.last_error,
    tokenExpiresAt: row.token_expires_at,
    lastVerifiedAt: row.last_verified_at,
    createdAt: row.created_at,
  };
}

type Admin = ReturnType<typeof createAdminClient>;

// ── Reads ─────────────────────────────────────────────────────────

export async function listConnections(orgId: string): Promise<StoredConnection[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("integration_connections")
    .select(CONNECTION_COLUMNS)
    .eq("org_id", orgId)
    .neq("status", "disconnected")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[integrations] failed to list connections:", error.message);
    return [];
  }
  return (data ?? []).map((row) => toStoredConnection(row as unknown as ConnectionRow));
}

export async function getConnection(
  orgId: string,
  provider: string
): Promise<StoredConnection | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("integration_connections")
    .select(CONNECTION_COLUMNS)
    .eq("org_id", orgId)
    .eq("provider", provider)
    .neq("status", "disconnected")
    .maybeSingle();

  if (error) {
    console.error("[integrations] failed to load connection:", error.message);
    return null;
  }
  return data ? toStoredConnection(data as unknown as ConnectionRow) : null;
}

export async function listResources(
  orgId: string,
  connectionId: string
): Promise<StoredResource[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("integration_resources")
    .select(RESOURCE_COLUMNS)
    .eq("org_id", orgId)
    .eq("connection_id", connectionId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[integrations] failed to list resources:", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    connectionId: row.connection_id as string,
    resourceType: row.resource_type as string,
    externalId: row.external_id as string,
    name: row.name as string | null,
    isPrimary: row.is_primary as boolean,
    syncEnabled: row.sync_enabled as boolean,
    availabilityEnabled: row.availability_enabled as boolean,
  }));
}

// ── Writes ────────────────────────────────────────────────────────

export interface SaveConnectionInput {
  orgId: string;
  integration: Integration;
  account: IntegrationAccount;
  credentials: IntegrationCredentials;
  createdBy: string | null;
}

/**
 * Stores a freshly authorised connection, or updates the existing row
 * when the same account reconnects. Reconnecting must UPDATE rather
 * than insert, or a re-auth would leave the old broken row behind and
 * the unique (org_id, provider, account_id) index would reject it.
 */
export async function saveOAuthConnection(
  input: SaveConnectionInput
): Promise<StoredConnection> {
  const { orgId, integration, account, credentials, createdBy } = input;
  const supabase = createAdminClient();
  const keyring = loadKeyringFromEnv();

  const encrypted = encryptCredentials(credentials, keyring);
  const expiresAt =
    credentials.strategy === "oauth2" ? credentials.expiresAtIso : null;

  const { data, error } = await supabase
    .from("integration_connections")
    .upsert(
      {
        org_id: orgId,
        provider: integration.manifest.id,
        capabilities: integration.manifest.capabilities,
        auth_strategy: integration.auth.id,
        account_id: account.accountId,
        account_email: account.email,
        account_name: account.displayName,
        credentials_encrypted: encrypted,
        credentials_key_version: keyring.currentVersion,
        token_expires_at: expiresAt,
        status: "connected",
        last_error: null,
        last_verified_at: new Date().toISOString(),
        created_by: createdBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id,provider,account_id" }
    )
    .select(CONNECTION_COLUMNS)
    .single();

  if (error || !data) {
    throw new IntegrationError(
      `Failed to save ${integration.manifest.id} connection: ${error?.message ?? "no row returned"}`,
      { kind: "permanent", provider: integration.manifest.id }
    );
  }

  return toStoredConnection(data as unknown as ConnectionRow);
}

export async function setConnectionStatus(
  orgId: string,
  connectionId: string,
  status: ConnectionStatus,
  lastError: string | null = null
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("integration_connections")
    .update({ status, last_error: lastError, updated_at: new Date().toISOString() })
    .eq("id", connectionId)
    .eq("org_id", orgId);

  if (error) {
    console.error("[integrations] failed to set connection status:", error.message);
  }
}

/**
 * Returns credentials that are valid right now, refreshing and
 * persisting them first if they are close to expiry.
 *
 * This is the ONLY way callers obtain credentials — no route or job
 * decrypts a row itself, so refresh-on-use and the needs_reauth
 * transition are guaranteed to happen everywhere.
 */
export async function getValidCredentials(
  orgId: string,
  connectionId: string
): Promise<IntegrationCredentials> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("integration_connections")
    .select("id, org_id, provider, status, credentials_encrypted")
    .eq("id", connectionId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (error || !data) {
    throw new IntegrationError("Integration connection not found.", {
      kind: "not_found",
    });
  }
  if (!data.credentials_encrypted) {
    throw new IntegrationError("Integration connection has no stored credentials.", {
      kind: "auth_expired",
      provider: data.provider as string,
    });
  }

  const keyring = loadKeyringFromEnv();
  const stored = decryptCredentials(data.credentials_encrypted as string, keyring);

  if (!needsRefresh(stored)) return stored;

  const integration = getIntegration(data.provider as string);
  if (integration.auth.id !== "oauth2") return stored;

  try {
    const refreshed = await integration.auth.refresh(stored);
    const merged = mergeRefreshedCredentials(stored, refreshed);

    await supabase
      .from("integration_connections")
      .update({
        credentials_encrypted: encryptCredentials(merged, keyring),
        credentials_key_version: keyring.currentVersion,
        token_expires_at: merged.strategy === "oauth2" ? merged.expiresAtIso : null,
        status: "connected",
        last_error: null,
        last_verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectionId)
      .eq("org_id", orgId);

    return merged;
  } catch (err) {
    const kind = err instanceof IntegrationError ? err.kind : "transient";
    const message = err instanceof Error ? err.message : String(err);

    // A dead refresh token cannot be retried out of — the owner has to
    // reconnect, so the connection is parked rather than hammered.
    if (requiresReauth(kind)) {
      await setConnectionStatus(orgId, connectionId, "needs_reauth", message);
    } else {
      await setConnectionStatus(orgId, connectionId, "error", message);
    }
    throw err;
  }
}

/**
 * Replaces the org's primary resource for a type with the given one.
 *
 * Version 1 exposes a single calendar, and the schema enforces one
 * primary per resource type per org — so the previous primary is
 * cleared first, in the same logical step, or the partial unique index
 * would reject the insert.
 */
export async function setPrimaryResource(
  orgId: string,
  connectionId: string,
  resource: IntegrationResource
): Promise<void> {
  const supabase = createAdminClient();

  await supabase
    .from("integration_resources")
    .update({ is_primary: false, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("resource_type", resource.resourceType)
    .is("staff_id", null);

  const { error } = await supabase.from("integration_resources").upsert(
    {
      org_id: orgId,
      connection_id: connectionId,
      resource_type: resource.resourceType,
      external_id: resource.externalId,
      name: resource.name,
      is_primary: true,
      sync_enabled: true,
      availability_enabled: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "connection_id,resource_type,external_id" }
  );

  if (error) {
    throw new IntegrationError(`Failed to select resource: ${error.message}`, {
      kind: "permanent",
    });
  }
}

/**
 * Disconnects an integration: revokes with the provider where possible,
 * then removes the stored credentials and the selected resources so
 * nothing can sync afterwards.
 *
 * The connection row is KEPT with status 'disconnected', and
 * integration_links are left alone, so the history of what was once
 * synced survives. Credentials are nulled, not merely marked — a
 * disconnect that leaves usable tokens in the database is not a
 * disconnect.
 */
export async function disconnectConnection(
  orgId: string,
  connectionId: string
): Promise<void> {
  const supabase: Admin = createAdminClient();

  const { data } = await supabase
    .from("integration_connections")
    .select("id, provider, credentials_encrypted")
    .eq("id", connectionId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (!data) return;

  if (data.credentials_encrypted) {
    try {
      const integration = getIntegration(data.provider as string);
      if (integration.auth.id === "oauth2") {
        const credentials = decryptCredentials(
          data.credentials_encrypted as string,
          loadKeyringFromEnv()
        );
        await integration.auth.revoke(credentials);
      }
    } catch (err) {
      // Local disconnect must succeed even if the provider refuses or
      // the integration is no longer registered in this build.
      console.error(
        "[integrations] revoke failed during disconnect:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  await supabase
    .from("integration_resources")
    .delete()
    .eq("org_id", orgId)
    .eq("connection_id", connectionId);

  await supabase
    .from("integration_connections")
    .update({
      credentials_encrypted: null,
      token_expires_at: null,
      status: "disconnected",
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectionId)
    .eq("org_id", orgId);
}
