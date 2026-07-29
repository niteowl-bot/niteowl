"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// ─────────────────────────────────────────────────────────────
//  Remy animated product demo
//
//  A self-contained, image-free, auto-playing "recorded conversation"
//  that runs inside the demo player (hero preview + modal) whenever no
//  real NEXT_PUBLIC_REMY_DEMO_VIDEO_URL is configured. It depicts ONLY
//  behaviour Remy actually has today, verified in the codebase:
//   - answers customer questions from the business Knowledge Base
//   - books an appointment using business hours + capacity
//   - captures the lead's contact details
//   - confirms the booking and notifies the business by email
//  Nothing here implies a feature that isn't implemented (no calendar
//  sync, no SMS, no voice). It is a scripted illustration of a real
//  conversation — not a screen recording — framed clearly as a demo.
//
//  Loops on a fixed 2-minute cycle. Respects prefers-reduced-motion by
//  rendering the completed conversation statically (no animation).
// ─────────────────────────────────────────────────────────────

const LOOP_MS = 120_000; // 2-minute loop, per spec

const BUSINESS_NAME = "Northside Plumbing";

type Speaker = "customer" | "remy";

type Step =
  | {
      kind: "message";
      role: Speaker;
      text: string;
      typingMs: number; // "typing…" shown before the message appears
      holdMs: number; // pause after the message, before the next step
    }
  | {
      kind: "summary";
      items: string[];
      revealMs: number; // stagger between each chip
      holdMs: number;
    };

// A realistic customer ↔ Remy exchange for a plumbing business. Every
// answer is something Remy can genuinely produce from a configured
// Knowledge Base + booking engine.
const SCRIPT: Step[] = [
  {
    kind: "message",
    role: "remy",
    text: "Hi 👋 I'm Remy, the receptionist for Northside Plumbing. How can I help?",
    typingMs: 1600,
    holdMs: 2400,
  },
  {
    kind: "message",
    role: "customer",
    text: "Hi! Do you cover the North Leeds area?",
    typingMs: 1600,
    holdMs: 2200,
  },
  {
    kind: "message",
    role: "remy",
    text: "Yes — we cover all of North Leeds and the surrounding villages.",
    typingMs: 2200,
    holdMs: 2600,
  },
  {
    kind: "message",
    role: "customer",
    text: "Great. Do you repair boilers, and what's the call-out fee?",
    typingMs: 2400,
    holdMs: 2400,
  },
  {
    kind: "message",
    role: "remy",
    text: "We repair all boiler makes. The call-out is £75, covering the first 30 minutes.",
    typingMs: 3000,
    holdMs: 3000,
  },
  {
    kind: "message",
    role: "customer",
    text: "Perfect — can I book a boiler repair for tomorrow at 2pm?",
    typingMs: 2400,
    holdMs: 2600,
  },
  {
    kind: "message",
    role: "remy",
    text: "Tomorrow at 2:00 PM is available. Could I take your name and the best email to confirm?",
    typingMs: 3000,
    holdMs: 3000,
  },
  {
    kind: "message",
    role: "customer",
    text: "Sarah Jones — sarah.jones@gmail.com",
    typingMs: 2200,
    holdMs: 2400,
  },
  {
    kind: "message",
    role: "remy",
    text: "Thanks Sarah! You're booked for a boiler repair tomorrow at 2:00 PM. I've sent a confirmation to your email 👍",
    typingMs: 3200,
    holdMs: 2400,
  },
  {
    kind: "summary",
    items: ["Lead captured", "Appointment booked", "Business notified by email"],
    revealMs: 900,
    holdMs: 4000,
  },
];

// Total scripted activity, then a tail hold so the whole cycle is exactly
// LOOP_MS (the completed conversation rests on screen before replaying —
// like a finished recording looping back to the start).
const ACTIVE_MS = SCRIPT.reduce((sum, step) => {
  if (step.kind === "message") return sum + step.typingMs + step.holdMs;
  return sum + step.items.length * step.revealMs + step.holdMs;
}, 0);
const TAIL_HOLD_MS = Math.max(6000, LOOP_MS - ACTIVE_MS);

interface ShownMessage {
  role: Speaker;
  text: string;
}

// Fully-populated end state, used for the reduced-motion fallback.
function finalMessages(): ShownMessage[] {
  return SCRIPT.filter((s): s is Extract<Step, { kind: "message" }> => s.kind === "message").map(
    (s) => ({ role: s.role, text: s.text })
  );
}
const SUMMARY_STEP = SCRIPT.find(
  (s): s is Extract<Step, { kind: "summary" }> => s.kind === "summary"
);

// Subscribe to the reduced-motion media query without setState-in-effect,
// so the animation cleanly falls back to a static, fully-resolved chat for
// visitors who prefer reduced motion.
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false
  );
}

export default function RemyDemoAnimation({ compact = false }: { compact?: boolean }) {
  const [messages, setMessages] = useState<ShownMessage[]>([]);
  const [typingRole, setTypingRole] = useState<Speaker | null>(null);
  const [summaryCount, setSummaryCount] = useState(0);
  const [cycle, setCycle] = useState(0);
  const reducedMotion = usePrefersReducedMotion();

  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the latest message in view as the conversation grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typingRole, summaryCount]);

  useEffect(() => {
    // Reduced-motion visitors get the static, fully-resolved conversation
    // rendered directly below — no timers, no animation.
    if (reducedMotion) return;

    let cancelled = false;
    const timers: number[] = [];
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timers.push(window.setTimeout(resolve, ms));
      });

    async function playCycle() {
      // Reset to an empty chat at the start of each loop.
      setMessages([]);
      setSummaryCount(0);
      setTypingRole(null);

      for (const step of SCRIPT) {
        if (cancelled) return;

        if (step.kind === "message") {
          setTypingRole(step.role);
          await wait(step.typingMs);
          if (cancelled) return;
          setTypingRole(null);
          setMessages((prev) => [...prev, { role: step.role, text: step.text }]);
          await wait(step.holdMs);
        } else {
          for (let i = 0; i < step.items.length; i++) {
            if (cancelled) return;
            setSummaryCount(i + 1);
            await wait(step.revealMs);
          }
          await wait(step.holdMs);
        }
      }

      // Rest on the completed state, then the outer loop restarts.
      await wait(TAIL_HOLD_MS);
    }

    async function run() {
      while (!cancelled) {
        setCycle((c) => c + 1);
        await playCycle();
      }
    }

    run();

    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [reducedMotion]);

  const textSize = compact ? "text-[11px] leading-snug" : "text-xs sm:text-sm";
  const summaryItems = SUMMARY_STEP?.items ?? [];

  // Reduced motion → render the whole conversation resolved; otherwise use
  // the animated state that the effect above advances over time.
  const displayMessages = reducedMotion ? finalMessages() : messages;
  const displayTyping = reducedMotion ? null : typingRole;
  const displaySummaryCount = reducedMotion ? summaryItems.length : summaryCount;

  return (
    <div
      role="img"
      aria-label="Animated demo: a customer asks Remy about a plumbing business, then books a boiler repair. Remy answers from the business knowledge base, captures the customer's details, confirms the appointment, and notifies the business."
      className="relative flex h-full w-full flex-col bg-gradient-to-br from-slate-900 via-slate-950 to-indigo-950"
    >
      {/* scrubber keyframes (scoped by name; harmless if duplicated) */}
      <style>{`@keyframes remyDemoScrub { from { transform: scaleX(0) } to { transform: scaleX(1) } }`}</style>

      <div aria-hidden="true" className="flex h-full w-full flex-col">
        {/* ── Header (chat window chrome) ── */}
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 sm:px-4 sm:py-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white sm:h-8 sm:w-8">
            R
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-white sm:text-sm">
              Remy <span className="font-normal text-slate-400">· {BUSINESS_NAME}</span>
            </p>
            <p className="flex items-center gap-1 text-[10px] text-slate-400 sm:text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
              AI receptionist · online
            </p>
          </div>
          <span className="ml-auto shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-slate-200 sm:text-[11px]">
            Demo
          </span>
        </div>

        {/* scrubber line — reinforces the "recorded" feel; restarts each loop */}
        <div className="h-0.5 w-full bg-white/10">
          {!reducedMotion && (
            <div
              key={cycle}
              className="h-full origin-left bg-indigo-500"
              style={{ animation: `remyDemoScrub ${LOOP_MS}ms linear` }}
            />
          )}
        </div>

        {/* ── Messages ── */}
        <div
          ref={scrollRef}
          className="flex flex-1 flex-col justify-end gap-2 overflow-hidden px-3 py-3 sm:gap-2.5 sm:px-4 sm:py-4"
        >
          {displayMessages.map((m, i) => (
            <MessageBubble key={i} role={m.role} text={m.text} textSize={textSize} />
          ))}

          {displayTyping && <TypingBubble role={displayTyping} />}

          {displaySummaryCount > 0 && (
            <div className="mt-1 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5">
              <div className="space-y-1.5">
                {summaryItems.slice(0, displaySummaryCount).map((item) => (
                  <div
                    key={item}
                    className="flex items-center gap-2 text-[11px] font-medium text-emerald-300 sm:text-xs"
                  >
                    <CheckIcon className="h-3.5 w-3.5 shrink-0" />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  role,
  text,
  textSize,
}: {
  role: Speaker;
  text: string;
  textSize: string;
}) {
  const isRemy = role === "remy";
  return (
    <div className={`flex ${isRemy ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[82%] rounded-2xl px-3 py-2 ${textSize} ${
          isRemy
            ? "rounded-tl-sm bg-slate-800 text-slate-100"
            : "rounded-tr-sm bg-indigo-600 text-white"
        }`}
      >
        {text}
      </div>
    </div>
  );
}

function TypingBubble({ role }: { role: Speaker }) {
  const isRemy = role === "remy";
  return (
    <div className={`flex ${isRemy ? "justify-start" : "justify-end"}`}>
      <div
        className={`flex items-center gap-1 rounded-2xl px-3 py-2.5 ${
          isRemy ? "rounded-tl-sm bg-slate-800" : "rounded-tr-sm bg-indigo-600/80"
        }`}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/70"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
