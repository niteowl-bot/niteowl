"use client";

import { useState } from "react";
import Sidebar from "./Sidebar";
import ConversationView from "./ConversationView";

export interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export default function ChatShell({
  orgId,
  orgName,
}: {
  orgId: string;
  orgName: string;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const activeConversation =
    conversations.find((c) => c.id === activeId) ?? null;

  function handleNewConversation(convo: Conversation) {
    setConversations((prev) => [
      convo,
      ...prev.filter((c) => c.id !== convo.id),
    ]);
    setActiveId(convo.id);
  }

  function handleConversationsLoaded(convos: Conversation[]) {
    setConversations(convos);
    if (!activeId && convos.length > 0) setActiveId(convos[0].id);
  }

  function handleTitleUpdate(id: string, title: string) {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c))
    );
  }

  return (
    <div className="flex h-screen bg-[#0d0f14] overflow-hidden">
      {/* Sidebar overlay for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar */}
      <div
        className={`
          fixed inset-y-0 left-0 z-30 flex-shrink-0 transition-transform duration-200
          md:relative md:z-auto md:translate-x-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          w-64
        `}
      >
        <Sidebar
          orgId={orgId}
          activeId={activeId}
          onSelect={(id) => {
            setActiveId(id);
            // Close sidebar on mobile after selecting
            if (window.innerWidth < 768) setSidebarOpen(false);
          }}
          onLoaded={handleConversationsLoaded}
          onNewConversation={handleNewConversation}
          conversations={conversations}
        />
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Top bar */}
        <header className="flex h-14 items-center gap-3 border-b border-white/[0.07] px-4 flex-shrink-0 bg-[#0d0f14]">
          {/* Sidebar toggle */}
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/40 hover:bg-white/5 hover:text-white/70 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          >
            <MenuIcon />
          </button>

          {/* Breadcrumb */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white">
              <RemyIcon />
            </span>
            <span className="text-sm font-medium text-white/80 shrink-0">
              Remy
            </span>
            <span className="text-white/20 shrink-0">·</span>
            <span className="text-xs text-white/40 truncate">
              {activeConversation?.title ?? "AI Assistant"}
            </span>
          </div>

          {/* Right actions */}
          <div className="ml-auto flex items-center gap-3 shrink-0">
            {/* New chat — visible on mobile when sidebar is closed */}
            <button
              onClick={async () => {
                // Trigger new conversation via Sidebar's NewChatButton logic
                // by clearing activeId so ConversationView shows empty state
                setActiveId(null);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-white/40 hover:bg-white/5 hover:text-white/70 transition md:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label="New conversation"
            >
              <PencilIcon />
            </button>

            <a
              href="/dashboard"
              className="hidden sm:flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition"
            >
              <ChevronLeftIcon />
              Dashboard
            </a>
          </div>
        </header>

        {/* Conversation area — remounts when activeId changes */}
        <div className="flex-1 overflow-hidden">
          <ConversationView
            key={activeId ?? "empty"}
            orgId={orgId}
            orgName={orgName}
            conversationId={activeId}
            onNewConversation={handleNewConversation}
            onTitleUpdate={handleTitleUpdate}
          />
        </div>
      </div>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────

function MenuIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2 4h12M2 8h12M2 12h12"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RemyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M6 1C3.24 1 1 3.24 1 6c0 1.3.49 2.49 1.29 3.4L1 11l1.65-1.24A4.97 4.97 0 0 0 6 11c2.76 0 5-2.24 5-5S8.76 1 6 1Z"
        fill="currentColor"
        opacity=".4"
      />
      <circle cx="4" cy="6.5" r=".75" fill="currentColor" />
      <circle cx="6" cy="6.5" r=".75" fill="currentColor" />
      <circle cx="8" cy="6.5" r=".75" fill="currentColor" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <path
        d="M10.5 2.5l2 2-8 8H2.5v-2l8-8Z"
        stroke="currentColor"
        strokeWidth="1.3"
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
