"use client";

import { useState } from "react";

async function goToBillingUrl(endpoint: "/api/billing/checkout" | "/api/billing/portal") {
  const res = await fetch(endpoint, { method: "POST" });
  const json = await res.json();

  if (!res.ok || !json.url) {
    throw new Error(json.error ?? "Something went wrong.");
  }

  window.location.href = json.url;
}

function ActionButton({
  label,
  endpoint,
}: {
  label: string;
  endpoint: "/api/billing/checkout" | "/api/billing/portal";
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      await goToBillingUrl(endpoint);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={loading}
        className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
      >
        {loading ? "Redirecting…" : label}
      </button>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}

export function SubscribeButton() {
  return <ActionButton label="Subscribe now" endpoint="/api/billing/checkout" />;
}

export function ManageBillingButton() {
  return <ActionButton label="Manage billing" endpoint="/api/billing/portal" />;
}
