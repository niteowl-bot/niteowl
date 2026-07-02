"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { streamChat, ChatMessage } from "@/lib/chat";
import { Conversation, Message } from "./ChatShell";
import MessageBubble from "./MessageBubble";

export default function ConversationView({
  orgId,
  orgName,
  conversationId,
  onNewConversation,
  onTitleUpdate,
}: {
  orgId: string;
  orgName: string;
  conversationId: string | null;
  onNewConversation: (convo: Conversation) => void;
  onTitleUpdate: (id: string, title: string) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Load history when conversation changes ───────────────────────
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setError(null);
      return;
    }

    let cancelled = false;

    async function loadHistory() {
      setLoadingHistory(true);
      setMessages([]);
      setError(null);

      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from("messages")
        .select("id, role, content, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (cancelled) return;

      if (fetchError) {
        setError("Failed to load conversation history.");
      } else {
        setMessages((data ?? []) as Message[]);
      }

      setLoadingHistory(false);
    }

    loadHistory();
    return () => { cancelled = true; };
  }, [conversationId]);

  // ── Auto-scroll on new content ───────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // ── Auto-resize textarea ─────────────────────────────────────────
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [input]);

  // ── Create a new conversation row in Supabase ────────────────────
  const createConversation = useCallback(async (): Promise<string | null> => {
    const supabase = createClient();
    const { data, error: insertError } = await supabase
      .from("conversations")
      .insert({ org_id: orgId, title: "New conversation" })
      .select("id, title, updated_at")
      .single();

    if (insertError || !data) return null;
    onNewConversation(data);
    return data.id;
  }, [orgId, onNewConversation]);

  // ── Persist a single message ─────────────────────────────────────
  const saveMessage = useCallback(
    async (
      convoId: string,
      role: "user" | "assistant",
      content: string
    ): Promise<Message | null> => {
      const supabase = createClient();
      const { data, error: insertError } = await supabase
        .from("messages")
        .insert({ conversation_id: convoId, org_id: orgId, role, content })
        .select("id, role, content, created_at")
        .single();

      if (insertError || !data) return null;
      return data as Message;
    },
    [orgId]
  );

  // ── Derive and persist a title from the first user message ───────
  const generateTitle = useCallback(
    async (convoId: string, firstMessage: string) => {
      const words = firstMessage.trim().split(/\s+/).slice(0, 6).join(" ");
      const title =
        words.length < firstMessage.trim().length ? `${words}…` : words;

      const supabase = createClient();
      await supabase
        .from("conversations")
        .update({ title })
        .eq("id", convoId);

      onTitleUpdate(convoId, title);
    },
    [onTitleUpdate]
  );

  // ── Send handler ─────────────────────────────────────────────────
  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setError(null);

    // Create conversation on first message if needed
    let convoId = conversationId;
    if (!convoId) {
      convoId = await createConversation();
      if (!convoId) {
        setError("Could not create conversation. Please try again.");
        return;
      }
    }

    // Persist and display user message
    const userMsg = await saveMessage(convoId, "user", text);
    if (!userMsg) {
      setError("Could not save your message. Please try again.");
      return;
    }
    setMessages((prev) => [...prev, userMsg]);

    // Auto-title on first message
    if (messages.length === 0) {
      generateTitle(convoId, text);
    }

    // Build context window (last 20 messages)
    const context: ChatMessage[] = [...messages, userMsg]
      .slice(-20)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    // Stream AI response
    setStreaming(true);
    setStreamingContent("");

   await streamChat({
        messages: context,
        conversationId: convoId,
        orgId,
        source: "dashboard_preview",
        onToken: (token) => {

        setStreamingContent((prev) => prev + token);
      },
      onDone: async (fullText) => {
        setStreaming(false);
        setStreamingContent("");

        const aiMsg = await saveMessage(convoId!, "assistant", fullText);
        if (aiMsg) setMessages((prev) => [...prev, aiMsg]);

        // Bump updated_at so conversation sorts to top of sidebar
        const supabase = createClient();
        await supabase
          .from("conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", convoId!);
      },
      onError: (err) => {
        setStreaming(false);
        setStreamingContent("");
        setError(`Something went wrong: ${err}`);
      },
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ── Empty / welcome state ────────────────────────────────────────
  const isEmpty = !conversationId && messages.length === 0;

  if (isEmpty) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600/15 text-blue-400">
            <WelcomeIcon />
          </div>
          <h2 className="text-lg font-semibold text-white">Hi, I'm Remy</h2>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-white/40">
            Your AI assistant for{" "}
            <span className="text-white/60">{orgName}</span>. Ask me anything
            about your business, customers, or how to grow.
          </p>

          {/* Prompt suggestions */}
          <div className="mt-8 grid w-full max-w-sm gap-2">
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                onClick={() => {
                  setInput(prompt);
                  setTimeout(() => textareaRef.current?.focus(), 0);
                }}
                className="rounded-xl border border-white/[0.07] bg-[#13151c] px-4 py-3 text-left text-sm text-white/45 transition hover:border-white/15 hover:text-white/75"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        {/* Input pinned at bottom even on empty state */}
        <InputArea
          textareaRef={textareaRef}
          input={input}
          streaming={streaming}
          error={null}
          onChange={setInput}
          onKeyDown={handleKeyDown}
          onSend={handleSend}
        />
      </div>
    );
  }

  // ── Main thread ──────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
        {loadingHistory ? (
          <div className="flex h-full items-center justify-center">
            <LoadingDots />
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-5">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}

            {/* Streaming bubble */}
            {streaming && (
              <MessageBubble
                message={{ role: "assistant", content: streamingContent }}
                streaming
              />
            )}

            {/* Error */}
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <InputArea
        textareaRef={textareaRef}
        input={input}
        streaming={streaming}
        error={error}
        onChange={setInput}
        onKeyDown={handleKeyDown}
        onSend={handleSend}
      />
    </div>
  );
}

// ── Shared input area ────────────────────────────────────────────

function InputArea({
  textareaRef,
  input,
  streaming,
  error,
  onChange,
  onKeyDown,
  onSend,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  input: string;
  streaming: boolean;
  error: string | null;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
}) {
  return (
    <div className="shrink-0 border-t border-white/[0.07] px-4 py-4 md:px-8">
      <div className="mx-auto max-w-2xl space-y-2">
        {error && (
          <p className="text-xs text-red-400 px-1">{error}</p>
        )}
        <div className="flex items-end gap-3 rounded-2xl border border-white/10 bg-[#13151c] px-4 py-3 transition focus-within:border-blue-500/50">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Message Remy…"
            disabled={streaming}
            className="flex-1 resize-none bg-transparent text-sm text-white placeholder:text-white/25 outline-none disabled:opacity-50 max-h-40"
          />
          <button
            onClick={onSend}
            disabled={!input.trim() || streaming}
            aria-label="Send message"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {streaming ? <StopIcon /> : <SendIcon />}
          </button>
        </div>
        <p className="text-center text-xs text-white/20">
          Remy can make mistakes. Verify important information.
        </p>
      </div>
    </div>
  );
}

// ── Constants ────────────────────────────────────────────────────

const SUGGESTED_PROMPTS = [
  "How should I respond to a missed call?",
  "Draft a follow-up message for a new lead",
  "What's the best way to ask for a Google review?",
];

// ── Small components ─────────────────────────────────────────────

function LoadingDots() {
  return (
    <div className="flex gap-1.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-2 w-2 rounded-full bg-white/20 animate-bounce"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

function WelcomeIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden>
      <path
        d="M14 3C7.92 3 3 7.92 3 14c0 2.83 1.05 5.42 2.78 7.39L3 25l3.7-2.73A10.96 10.96 0 0 0 14 25c6.08 0 11-4.92 11-11S20.08 3 14 3Z"
        fill="currentColor"
        opacity=".25"
      />
      <circle cx="10" cy="14.5" r="1.5" fill="currentColor" />
      <circle cx="14" cy="14.5" r="1.5" fill="currentColor" />
      <circle cx="18" cy="14.5" r="1.5" fill="currentColor" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M2 7h10M8 3l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
      <rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="currentColor" />
    </svg>
  );
}
