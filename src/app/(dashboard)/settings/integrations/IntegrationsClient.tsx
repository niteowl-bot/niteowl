"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

// ── Integrations settings UI ──────────────────────────────────────
//
// Renders one card per registered integration from data the server
// prepared. It contains no vendor-specific branching: a new integration
// appears here by being registered, and its Connect button points at
// the same generic route every other one uses.

export interface IntegrationCardData {
  id: string;
  label: string;
  description: string;
  capabilities: string[];
  resourceLabel: string | null;
  connection: {
    status: "connected" | "needs_reauth" | "error" | "disconnected";
    accountEmail: string | null;
    accountName: string | null;
    lastError: string | null;
    connectedAt: string;
  } | null;
  selectedResource: { externalId: string; name: string | null } | null;
}

interface RemoteResource {
  externalId: string;
  name: string;
  writable: boolean;
  isDefault: boolean;
}

const STATUS_STYLES: Record<string, string> = {
  connected: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  needs_reauth: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  error: "bg-red-500/15 text-red-300 border-red-500/30",
  disconnected: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

const STATUS_LABELS: Record<string, string> = {
  connected: "Connected",
  needs_reauth: "Reconnect needed",
  error: "Error",
  disconnected: "Not connected",
};

/** Callback outcomes, translated into something an owner can act on. */
const ERROR_MESSAGES: Record<string, string> = {
  cancelled: "Connection cancelled — nothing was changed.",
  state_mismatch:
    "That connection attempt expired or could not be verified. Please try again.",
  missing_scopes:
    "Some permissions were not granted. Remy needs access to both read your calendar and manage events.",
  no_refresh_token:
    "The provider did not return a long-lived token. Please try connecting again and accept all permissions.",
  missing_code: "The provider did not return an authorisation code.",
  provider_error: "The provider reported an error. Please try again.",
  unknown_integration: "That integration is not available.",
  connect_failed: "Could not complete the connection. Please try again.",
};

export default function IntegrationsClient({
  integrations,
}: {
  integrations: IntegrationCardData[];
}) {
  const searchParams = useSearchParams();
  const connected = searchParams.get("connected");
  const errorCode = searchParams.get("error");

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-xl font-semibold text-white">Integrations</h1>
      <p className="mb-8 text-sm text-slate-400">
        Connect the tools your business already uses. Remy checks your calendar
        before offering a time, and adds confirmed appointments to it.
      </p>

      {connected && (
        <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          Connected successfully.
        </div>
      )}

      {errorCode && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {ERROR_MESSAGES[errorCode] ?? "Something went wrong. Please try again."}
        </div>
      )}

      {integrations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 py-12 text-center">
          <p className="text-sm text-slate-500">
            No integrations are available in this environment.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {integrations.map((integration) => (
            <IntegrationCard key={integration.id} integration={integration} />
          ))}
        </div>
      )}
    </div>
  );
}

function IntegrationCard({ integration }: { integration: IntegrationCardData }) {
  const { connection } = integration;
  const status = connection?.status ?? "disconnected";
  const isConnected = status === "connected" || status === "needs_reauth";

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleDisconnect() {
    if (
      !window.confirm(
        `Disconnect ${integration.label}? Remy will stop checking it for conflicts and will no longer add appointments to it.`
      )
    ) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/integrations/${integration.id}/disconnect`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("disconnect failed");
      window.location.reload();
    } catch {
      setActionError("Could not disconnect. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-white">{integration.label}</h2>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-xs ${
                STATUS_STYLES[status] ?? STATUS_STYLES.disconnected
              }`}
            >
              {STATUS_LABELS[status] ?? "Not connected"}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-400">{integration.description}</p>
          {connection?.accountEmail && (
            <p className="mt-2 text-xs text-slate-500">
              Connected as {connection.accountEmail}
            </p>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          {!isConnected && (
            <a
              href={`/api/integrations/${integration.id}/connect`}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition"
            >
              Connect
            </a>
          )}
          {status === "needs_reauth" && (
            <a
              href={`/api/integrations/${integration.id}/connect`}
              className="rounded-lg bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-500 transition"
            >
              Reconnect
            </a>
          )}
          {isConnected && (
            <button
              onClick={handleDisconnect}
              disabled={busy}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50 transition"
            >
              {busy ? "Working…" : "Disconnect"}
            </button>
          )}
        </div>
      </div>

      {status === "needs_reauth" && (
        <p className="mt-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300">
          Access has expired or been revoked. Remy has stopped syncing with this
          account until you reconnect.
        </p>
      )}

      {status === "error" && connection?.lastError && (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          Last error: {connection.lastError}
        </p>
      )}

      {actionError && (
        <p className="mt-4 text-xs text-red-400">{actionError}</p>
      )}

      {isConnected && integration.resourceLabel && (
        <ResourcePicker
          provider={integration.id}
          label={integration.resourceLabel}
          selected={integration.selectedResource}
        />
      )}
    </div>
  );
}

/**
 * Which remote object this integration acts on. Generic: the label
 * comes from the manifest, so the same component serves a calendar
 * today and a WhatsApp number later.
 */
function ResourcePicker({
  provider,
  label,
  selected,
}: {
  provider: string;
  label: string;
  selected: { externalId: string; name: string | null } | null;
}) {
  const [resources, setResources] = useState<RemoteResource[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState(selected?.externalId ?? "");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/integrations/${provider}/resources`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(body?.error ?? "Could not load.");
          return;
        }
        setResources(body.resources ?? []);
      } catch {
        if (!cancelled) setLoadError("Could not load.");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [provider]);

  async function handleChange(externalId: string) {
    setSaving(true);
    setLoadError(null);
    const previous = current;
    setCurrent(externalId);
    try {
      const res = await fetch(`/api/integrations/${provider}/resources`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ externalId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setLoadError(body?.error ?? "Could not save your selection.");
        setCurrent(previous);
      }
    } catch {
      setLoadError("Could not save your selection.");
      setCurrent(previous);
    } finally {
      setSaving(false);
    }
  }

  const writable = (resources ?? []).filter((resource) => resource.writable);

  return (
    <div className="mt-5 border-t border-slate-800 pt-4">
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </label>

      {loadError && <p className="text-xs text-red-400">{loadError}</p>}

      {resources === null && !loadError && (
        <p className="text-xs text-slate-500">Loading…</p>
      )}

      {resources !== null && writable.length === 0 && !loadError && (
        <p className="text-xs text-slate-500">
          This account has no writable {label.toLowerCase()}.
        </p>
      )}

      {writable.length > 0 && (
        <>
          <select
            value={current}
            disabled={saving}
            onChange={(e) => handleChange(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500 disabled:opacity-50 transition"
          >
            <option value="" disabled className="bg-slate-900">
              Choose…
            </option>
            {writable.map((resource) => (
              <option
                key={resource.externalId}
                value={resource.externalId}
                className="bg-slate-900"
              >
                {resource.name}
                {resource.isDefault ? " (default)" : ""}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-slate-500">
            {saving
              ? "Saving…"
              : "Remy checks this for conflicts and adds confirmed appointments to it."}
          </p>
        </>
      )}
    </div>
  );
}
