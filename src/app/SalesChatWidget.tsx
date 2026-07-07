"use client";

import { useEffect, useRef, useState } from "react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const CONVERSATION_STORAGE_KEY = "niteowl_sales_chat_conversation";

function getConversationId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(CONVERSATION_STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CONVERSATION_STORAGE_KEY, id);
  }
  return id;
}

export default function SalesChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const conversationIdRef = useRef<string | null>(null);

  function scrollToBottom() {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  // Keeps the latest message in view as content streams in. A direct
  // scrollTop assignment (rather than scrollIntoView({behavior:
  // "smooth"})) can't be interrupted by the next rapid token update,
  // and running it from an effect keyed on `messages` guarantees the
  // DOM has already committed the new content before we measure it.
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Mobile browsers resize the visible viewport (address bar
  // collapsing, on-screen keyboard opening/closing) independently of
  // when message content updates. Re-asserting scroll position on
  // every visualViewport resize prevents the newest reply from being
  // left outside the visible area if that resize settles after the
  // last scroll-to-bottom call.
  useEffect(() => {
    if (!isOpen || typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    vv.addEventListener("resize", scrollToBottom);
    return () => vv.removeEventListener("resize", scrollToBottom);
  }, [isOpen]);

  async function handleSend() {
    const text = input.trim();
    if (!text || isStreaming) return;

    if (!conversationIdRef.current) {
      conversationIdRef.current = getConversationId();
    }

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setIsStreaming(true);

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/sales/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, conversationId: conversationIdRef.current }),
      });

      if (!res.ok || !res.body) {
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: "Sorry, something went wrong. Please try again." };
          return copy;
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        if (chunk.includes("__DONE__")) {
          fullText += chunk.split("__DONE__")[0];
          break;
        }

        if (chunk.includes("__ERROR__:")) {
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { role: "assistant", content: "Sorry, something went wrong. Please try again." };
            return copy;
          });
          return;
        }

        fullText += chunk;
        const textSoFar = fullText;
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: textSoFar };
          return copy;
        });
      }
    } catch (err) {
      console.error("[SalesChatWidget] fetch error:", err);
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: "Sorry, something went wrong. Please try again." };
        return copy;
      });
    } finally {
      setIsStreaming(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setIsOpen((v) => !v)}
        aria-label="Open chat"
        className="fixed bottom-5 right-5 w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-500 shadow-2xl flex items-center justify-center z-50 transition-transform hover:scale-105"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M21 11.5C21 16.75 16.75 21 11.5 21C10.06 21 8.7 20.68 7.48 20.1L3 21L4.14 16.9C3.42 15.6 3 14.1 3 12.5C3 7.25 7.25 3 12.5 3C17.75 3 21 6.75 21 11.5Z"
            stroke="white"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {isOpen && (
        <div className="fixed inset-0 sm:inset-auto sm:bottom-24 sm:right-5 w-full sm:w-[360px] sm:max-w-[calc(100vw-40px)] h-dvh sm:h-[500px] sm:max-h-[calc(100vh-120px)] bg-white sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden z-[60]">
          <div className="bg-indigo-600 text-white px-4 py-4 flex items-center justify-between">
            <span className="text-sm font-semibold">Chat with us about Remy</span>
            <button
              onClick={() => setIsOpen(false)}
              aria-label="Close chat"
              className="text-white text-lg leading-none px-1"
            >
              &times;
            </button>
          </div>

          <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5">
            {messages.length === 0 && (
              <p className="text-slate-500 text-sm">
                Hi! Ask me anything about Remy, your AI receptionist — or tell me about your business and I&apos;ll show you how it fits.
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm leading-snug whitespace-pre-wrap ${
                  m.role === "user"
                    ? "self-end bg-indigo-600 text-white rounded-tr-sm"
                    : "self-start bg-slate-100 text-slate-900 rounded-tl-sm"
                }`}
              >
                {m.content}
              </div>
            ))}
          </div>

          <div className="px-3 pt-3 border-t border-slate-200">
            <a
              href="/signup"
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg py-2.5"
            >
              Start free trial — 14 days free, no card required
            </a>
          </div>

          <div className="flex gap-2 p-3 border-t border-slate-200">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSend();
              }}
              placeholder="Type a message…"
              disabled={isStreaming}
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2.5 text-base sm:text-sm outline-none focus:border-indigo-500"
            />
            <button
              onClick={handleSend}
              disabled={isStreaming}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-4"
            >
              Send
            </button>
          </div>
          <p className="px-3 pb-2.5 text-[11px] text-slate-400 text-center">
            By chatting, you agree to our{" "}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-600">
              Privacy Policy
            </a>
            .
          </p>
        </div>
      )}
    </>
  );
}
