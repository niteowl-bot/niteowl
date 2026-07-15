"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Central editor for the organisation's business name. Every surface
// (dashboard welcome, voice greeting, booking/needs-review/call-summary
// emails) already reads organisations.business_name, so saving here is
// the single source of truth — no other file needs to change.
export default function BusinessForm({
  orgId,
  initialBusinessName,
}: {
  orgId: string;
  initialBusinessName: string;
}) {
  const [businessName, setBusinessName] = useState(initialBusinessName);
  const [baseline, setBaseline] = useState(initialBusinessName);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const trimmed = businessName.trim();
  const nameError = trimmed.length === 0 ? "Business name is required." : null;
  const dirty = trimmed !== baseline.trim();

  async function handleSave() {
    if (nameError) {
      setSaveError(nameError);
      return;
    }

    setSaving(true);
    setSaveError(null);

    const supabase = createClient();
    const { error } = await supabase
      .from("organisations")
      .update({ business_name: trimmed })
      .eq("id", orgId);

    if (error) {
      setSaveError("Failed to save. Please try again.");
      setSaving(false);
      return;
    }

    setBaseline(trimmed);
    setSaving(false);
    setSavedAt(Date.now());
  }

  const inputCls =
    "w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-blue-500 transition";

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold text-white">Business information</h1>
      <p className="mb-8 text-sm text-slate-400">
        Your business name is used everywhere Remy speaks for you — the phone
        greeting, email notifications, booking confirmations, and call summaries.
      </p>

      <div className="rounded-xl border border-slate-800 bg-slate-800/50 p-4">
        <label
          htmlFor="business-name"
          className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400"
        >
          Business name
        </label>
        <input
          id="business-name"
          type="text"
          value={businessName}
          onChange={(e) => {
            setBusinessName(e.target.value);
            setSavedAt(null);
            setSaveError(null);
          }}
          placeholder="e.g. Dublin Plumbing Co."
          className={inputCls}
        />
        {nameError && businessName.length > 0 && (
          <p className="mt-2 text-xs text-red-400">{nameError}</p>
        )}
      </div>

      {saveError && <p className="mt-4 text-sm text-red-400">{saveError}</p>}

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !!nameError || !dirty}
          className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {savedAt !== null && !dirty && (
          <span className="text-sm text-emerald-400">Saved</span>
        )}
      </div>
    </div>
  );
}
