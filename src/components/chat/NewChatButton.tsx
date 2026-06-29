"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Conversation } from "./ChatShell";

export default function NewChatButton({
  orgId,
  onCreated,
}: {
  orgId: string;
  onCreated: (convo: Conversation) => void;
}) {
  const [loading, setLoading] = useState(false);

  async function handleNew() {
    if (loading) return;
    setLoading(true);

    const supabase = createClient();
    const { data, error } = await supabase
      .from("conversations")
      .insert({ org_id: orgId, title: "New conversation" })
      .select("id, title, updated_at")
      .single();

    if (!error && data) onCreated(data);
    setLoading(false);
  }

  return (
    <button
      onClick={handleNew}
      disabled={loading}
      className="flex w-full items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white/50 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {loading ? <SpinnerIcon /> : <PlusIcon />}
      </span>
      <span>{loading ? "Creating…" : "New conversation"}</span>
    </button>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M7 2v10M2 7h10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      className="animate-spin"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden
    >
      <circle
        cx="7"
        cy="7"
        r="5.5"
        stroke="currentColor"
        strokeOpacity=".2"
        strokeWidth="1.5"
      />
      <path
        d="M7 1.5A5.5 5.5 0 0 1 12.5 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

