"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import RemyWalkthrough from "./RemyWalkthrough";

// ─────────────────────────────────────────────────────────────
//  PUBLIC DEMO CONFIG — public URLs only, no secrets.
//
//  Both values are safe to expose to the browser, so they use the
//  NEXT_PUBLIC_ prefix (inlined at build time). Set them in `.env.local`
//  for local dev and in Vercel → Project → Settings → Environment
//  Variables for deployments (see the notes at the bottom of this file).
//
//  NEXT_PUBLIC_REMY_DEMO_VIDEO_URL  (optional override)
//    A direct, PUBLIC video file URL (.mp4 / .webm) — played in the
//    native <video> element for any signed-out visitor, no account
//    required. This is NOT a YouTube/Vimeo watch-page URL. Use it to
//    serve the demo from a CDN/blob store instead of this repo.
//
//    When it is unset (the normal case) the demo is served from the
//    local file below, committed under `public/`. If neither the URL
//    nor the local file resolves — which is the situation today, since no
//    recording is committed — the player falls back to the animated
//    RemyWalkthrough rather than showing a broken/black box.
//
//  NEXT_PUBLIC_REMY_BOOKING_URL
//    A public scheduling page (e.g. Cal.com / Calendly), opened in a new
//    tab by "Book a Live Demo". While unset, that button renders clearly
//    disabled as "Live Demo Booking Coming Soon" — never a dead "#" link
//    and never a sign-in redirect.
// ─────────────────────────────────────────────────────────────
// Local demo file, served straight out of `public/`. `public/videos/remy-demo.mp4`
// is reachable at `/videos/remy-demo.mp4`. The path is case-sensitive on Vercel
// (Linux) even though it is not on Windows — keep the file lowercase-hyphenated
// exactly as written here.
const REMY_DEMO_VIDEO_FILE = "/videos/remy-demo.mp4";

const REMY_DEMO_VIDEO_URL =
  process.env.NEXT_PUBLIC_REMY_DEMO_VIDEO_URL || REMY_DEMO_VIDEO_FILE;
const REMY_BOOKING_URL = process.env.NEXT_PUBLIC_REMY_BOOKING_URL ?? "";

const DEMO_LABEL = "Watch the Remy 2-minute product demo";

export default function HeroDemo() {
  const [open, setOpen] = useState(false);

  const openModal = useCallback(() => setOpen(true), []);
  const closeModal = useCallback(() => setOpen(false), []);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
        {/* ── Left column: message + actions ── */}
        <div className="text-center lg:text-left">
          <div className="inline-flex items-center gap-2 bg-indigo-950 border border-indigo-800 text-indigo-300 text-xs font-medium px-3 py-1.5 rounded-full mb-8">
            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-pulse" />
            AI receptionist — always on, never misses an enquiry
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight tracking-tight mb-6">
            Never Miss Another{" "}
            <span className="text-indigo-400">Customer Enquiry</span>
          </h1>

          <p className="text-lg sm:text-xl text-slate-400 max-w-2xl mx-auto lg:mx-0 mb-10 leading-relaxed">
            Remy answers customer questions instantly, captures every enquiry,
            books appointments, and helps your business win more customers—even
            while you&apos;re working or after hours.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
            <a
              href="/signup"
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-8 py-3.5 rounded-lg transition-colors text-base"
            >
              Start Your Free 14-Day Trial
            </a>
            <button
              type="button"
              onClick={openModal}
              aria-haspopup="dialog"
              aria-label={DEMO_LABEL}
              className="inline-flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold px-8 py-3.5 rounded-lg transition-colors text-base"
            >
              <PlayIcon className="w-4 h-4" />
              Watch 2-Minute Demo
            </button>
          </div>

          <p className="text-slate-500 text-sm mt-5">
            14-day free trial · No credit card required · Cancel anytime
          </p>
        </div>

        {/* ── Right column: demo video preview ── */}
        <div className="w-full">
          <button
            type="button"
            onClick={openModal}
            aria-haspopup="dialog"
            aria-label={DEMO_LABEL}
            className="group relative block w-full aspect-video overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl ring-1 ring-white/5 transition-shadow hover:shadow-indigo-950/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <DemoVideo src={REMY_DEMO_VIDEO_URL} variant="preview" />
            <span className="pointer-events-none absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
              <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-slate-900 shadow-lg">
                <PlayIcon className="h-3.5 w-3.5" />
                Watch full demo
              </span>
            </span>
          </button>
        </div>
      </div>

      {open && (
        <DemoModal videoUrl={REMY_DEMO_VIDEO_URL} onClose={closeModal} />
      )}
    </div>
  );
}

/**
 * The hero's inline demo player.
 *
 * Renders the real recorded demo — responsive (fills its 16:9 parent at every
 * breakpoint), autoplaying, muted, looping and inline on mobile Safari, which
 * refuses to autoplay without both `muted` and `playsInline`.
 *
 * The video is layered over the animated product walkthrough: the walkthrough
 * is what a visitor sees until the file reports `canplay`, and it stays put if
 * the file is missing or the codec is unsupported (`onError`). No recording is
 * committed today, so the walkthrough is what actually plays — the video path
 * exists so a real screen recording can be dropped in later with no code
 * change.
 */
function DemoVideo({
  src,
  variant,
  videoRef,
  onFallbackChange,
}: {
  src: string;
  variant: "preview" | "modal";
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  /** Called with `false` once the real video plays, `true` if it can't load. */
  onFallbackChange?: (showingFallback: boolean) => void;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );

  const isModal = variant === "modal";

  return (
    <>
      {/* The preview is wrapped in a <button> by its caller, so the
          walkthrough must not render one of its own there. */}
      {status !== "ready" && <RemyWalkthrough sound={isModal} />}

      {status !== "error" && (
        <video
          // `key` keeps React from reusing a previously-errored element if the
          // source ever changes at runtime.
          key={src}
          ref={videoRef}
          src={src}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          // In the modal the video is the content, so it is focusable and
          // labelled. In the hero preview it is decoration inside a button
          // that already carries the accessible name, so it is hidden from
          // assistive tech and lets clicks fall through to that button.
          {...(isModal
            ? { controls: true, "aria-label": "Remy 2-minute product demo" }
            : { "aria-hidden": true, tabIndex: -1 })}
          onCanPlay={() => {
            setStatus("ready");
            onFallbackChange?.(false);
          }}
          onError={() => {
            setStatus("error");
            onFallbackChange?.(true);
          }}
          className={`absolute inset-0 h-full w-full transition-opacity duration-500 ${
            isModal ? "object-contain" : "pointer-events-none object-cover"
          } ${status === "ready" ? "opacity-100" : "opacity-0"}`}
        >
          Your browser does not support embedded video.
        </video>
      )}
    </>
  );
}

function DemoModal({
  videoUrl,
  onClose,
}: {
  videoUrl: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // True until a recorded demo actually plays — drives the caption below,
  // which describes the animated walkthrough rather than a real video.
  const [showingFallback, setShowingFallback] = useState(true);

  // Lock background scroll while the modal is open, restore on close.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // Move focus into the dialog on open, restore it to the trigger on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    const firstFocusable = node?.querySelector<HTMLElement>(
      'button, [href], video, [tabindex]:not([tabindex="-1"])'
    );
    firstFocusable?.focus();

    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  // Ensure the video is stopped when the modal unmounts (belt-and-braces —
  // unmounting the <video> already tears down playback).
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (video) {
        video.pause();
      }
    };
  }, []);

  // Escape to close + a simple keyboard focus trap within the dialog.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key !== "Tab") return;

      const node = dialogRef.current;
      if (!node) return;

      const focusable = Array.from(
        node.querySelectorAll<HTMLElement>(
          'button, [href], video, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("disabled"));

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        // Click on the backdrop (outside the dialog panel) closes.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Remy product demo"
        onKeyDown={onKeyDown}
        className="relative w-full max-w-4xl"
      >
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close demo video"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <CloseIcon className="h-4 w-4" />
            Close
          </button>
        </div>

        <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl">
          <DemoVideo
            src={videoUrl}
            variant="modal"
            videoRef={videoRef}
            onFallbackChange={setShowingFallback}
          />
        </div>

        {/* Offer both choices — book a live demo + an optional, non-required
            trial link — alongside whichever demo is playing above. */}
        <div className="mt-4 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <BookDemoButton />
          <a
            href="/signup"
            className="text-sm font-medium text-slate-300 underline-offset-4 transition-colors hover:text-white hover:underline"
          >
            Or start your free 14-day trial
          </a>
        </div>

        {showingFallback && (
          <p className="mt-3 text-center text-xs text-slate-500">
            An animated walkthrough of the real Remy product.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * "Book a Live Demo" action.
 *
 * Renders a real link that opens the public booking page in a new tab
 * when NEXT_PUBLIC_REMY_BOOKING_URL is configured; otherwise renders a
 * clearly-disabled button labelled "Live Demo Booking Coming Soon".
 * Never a dead "#" link, a fake destination, or a sign-in redirect.
 */
function BookDemoButton({ className = "" }: { className?: string }) {
  const base = "rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors";

  if (REMY_BOOKING_URL) {
    return (
      <a
        href={REMY_BOOKING_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={`${base} bg-slate-800 text-slate-200 hover:bg-slate-700 ${className}`}
      >
        Book a Live Demo
      </a>
    );
  }

  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title="Live demo booking will be available soon"
      className={`${base} cursor-not-allowed bg-slate-800/60 text-slate-500 ${className}`}
    >
      Live Demo Booking Coming Soon
    </button>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
