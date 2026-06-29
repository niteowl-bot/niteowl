"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Conversation } from "./ChatShell";
import NewChatButton from "./NewChatButton";

export default function Sidebar({
  orgId,
  activeId,
  onSelect,
  onLoaded,
  onNewConversation,
  conversations,
}: {
  orgId: string;
  activeId: string | null;
  onSelect: (id: string) => void;
  onLoaded: (convos: Conversation[]) => void;
  onNewConversation: (convo: Conversation) => void;
  conversations: Conversation[];
}) {
  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("conversations")
        .select("id, title, updated_at")
        .eq("org_id", orgId)
        .order("updated_at", { ascending: false })
        .limit(50);

      if (data) onLoaded(data);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  function groupByDate(convos: Conversation[]): Record<string, Conversation[]> {
    const now = new Date();

    const groups: Record<string, Conversation[]> = {
      Today: [],
      Yesterday: [],
      "Past 7 days": [],
      Older: [],
    };

    for (const c of convos) {
      const updated = new Date(c.updated_at);
      const diffDays = Math.floor(
        (now.getTime() - updated.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (diffDays === 0) groups["Today"].push(c);
      else if (diffDays === 1) groups["Yesterday"].push(c);
      else if (diffDays <= 7) groups["Past 7 days"].push(c);
      else groups["Older"].push(c);
    }

    return groups;
  }

  const groups = groupByDate(conversations);
  const hasAny = conversations.length > 0;

  return (
    <aside className="flex h-full w-64 flex-col border-r border-white/[0.07] bg-[#0d0f14]">
      {/* Logo */}
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white shadow-lg shadow-blue-600/30">
          <LogoIcon />
        </span>
        <span className="text-sm font-semibold tracking-tight text-white">
          Niteowl <span className="text-white/40">AI</span>
        </span>
      </div>

      {/* New chat button */}
      <div className="shrink-0 px-3 pb-3">
        <NewChatButton orgId={orgId} onCreated={onNewConversation} />
      </div>

      {/* Conversation list */}
      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {!hasAny && (
          <p className="mt-8 px-2 text-center text-xs leading-relaxed text-white/20">
            No conversations yet.
            <br />
            Start one above.
          </p>
        )}

        <ul className="space-y-4">
          {Object.entries(groups).map(([label, items]) => {
            if (items.length === 0) return null;
            return (
              <li key={label}>
                <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-white/20">
                  {label}
                </p>
                <ul className="space-y-0.5">
                  {items.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => onSelect(c.id)}
                        title={c.title}
                        className={`group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                          c.id === activeId
                            ? "bg-white/8 text-white"
                            : "text-white/45 hover:bg-white/5 hover:text-white/75"
                        }`}
                      >
                        <span className="shrink-0 text-white/20">
                          <ChatIcon />
                        </span>
                        <span className="truncate">{c.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="shrink-0 border-t border-white/[0.07] px-4 py-3">
        <a
          href="/dashboard"
          className="flex items-center gap-2 text-xs text-white/25 transition hover:text-white/50"
        >
          <ChevronLeftIcon />
          Back to dashboard
        </a>
      </div>
    </aside>
  );
}

function LogoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <path
        d="M6.5 1C3.74 1 1.5 3.24 1.5 6c0 1.3.49 2.49 1.29 3.4L1.5 11l1.65-1.24A4.97 4.97 0 0 0 6.5 11c2.76 0 5-2.24 5-5S9.26 1 6.5 1Z"
        fill="currentColor"
        opacity=".3"
      />
      <circle cx="4.5" cy="6.5" r=".8" fill="currentColor" />
      <circle cx="6.5" cy="6.5" r=".8" fill="currentColor" />
      <circle cx="8.5" cy="6.5" r=".8" fill="currentColor" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M1 2.5A1.5 1.5 0 0 1 2.5 1h7A1.5 1.5 0 0 1 11 2.5v5A1.5 1.5 0 0 1 9.5 9H7l-2 2V9H2.5A1.5 1.5 0 0 1 1 7.5v-5Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <path
        d="M8 3L5 6.5 8 10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
