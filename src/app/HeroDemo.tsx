"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────
//  FINAL DEMO VIDEO URL GOES HERE
//
//  Paste the hosted 2-minute Remy demo video URL below when it is
//  ready. A direct file URL (.mp4 / .webm) is expected — it is played
//  in a native <video> element inside the modal.
//
//  While this is left empty, the hero shows a branded Remy demo
//  placeholder (poster + "coming soon" state) instead of a real video,
//  so nothing fake is ever presented to visitors.
// ─────────────────────────────────────────────────────────────
const REMY_DEMO_VIDEO_URL = "";

// ─────────────────────────────────────────────────────────────
//  "BOOK A LIVE DEMO" DESTINATION
//
//  Temporary placeholder until a scheduling flow (e.g. Cal.com /
//  Calendly) is live. Swap the value below for that booking URL when
//  ready — no other change is needed. Defaults to an email enquiry so
//  the button is genuinely functional today rather than a dead link.
// ─────────────────────────────────────────────────────────────
const BOOK_DEMO_URL =
  "mailto:contact@niteowlhq.com?subject=Book%20a%20live%20Remy%20demo";

const DEMO_LABEL = "Watch the 2-minute Remy demo video";

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
            <DemoPoster />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-indigo-600/95 shadow-lg ring-4 ring-white/10 transition-transform duration-200 group-hover:scale-105">
                <PlayIcon className="w-7 h-7 sm:w-8 sm:h-8 text-white translate-x-0.5" />
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
 * Branded, image-free poster for the demo preview. Built entirely from
 * markup + CSS so it costs no extra network request, causes no layout
 * shift, and keeps all text out of a flattened image (accessibility + SEO).
 */
function DemoPoster() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-950 to-indigo-950"
    >
      {/* subtle grid glow */}
      <span className="absolute -top-1/4 left-1/2 h-1/2 w-3/4 -translate-x-1/2 rounded-full bg-indigo-600/20 blur-3xl" />

      {/* Remy chip */}
      <span className="absolute top-4 left-4 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
          R
        </span>
        <span className="text-sm font-medium text-white">Remy</span>
      </span>

      {/* demo pill (neutral — no "live" status until the real video is ready) */}
      <span className="absolute top-4 right-4 inline-flex items-center rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-slate-200">
        2-Minute Demo
      </span>

      {/* caption */}
      <span className="absolute bottom-4 left-4 right-4 text-left">
        <span className="block text-sm font-semibold text-white">
          See Remy answer a customer enquiry
        </span>
        <span className="block text-xs text-slate-400">
          2-minute product demo
        </span>
      </span>
    </span>
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
        aria-label="Remy 2-minute demo video"
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

        <div className="aspect-video w-full overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl">
          {videoUrl ? (
            <video
              ref={videoRef}
              className="h-full w-full"
              src={videoUrl}
              controls
              autoPlay
              muted
              playsInline
              aria-label="Remy 2-minute product demo"
            >
              Your browser does not support embedded video.
            </video>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-900 via-slate-950 to-indigo-950 px-6 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-lg font-bold text-white">
                R
              </span>
              <p className="text-lg font-semibold text-white">
                See Remy in Action
              </p>
              <p className="max-w-md text-sm text-slate-400">
                Our full product walkthrough is currently being produced. In
                the meantime, start your free 14-day trial or book a live
                demonstration to see how Remy works for real businesses.
              </p>
              <div className="mt-2 flex flex-col sm:flex-row gap-3">
                <a
                  href="/signup"
                  className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
                >
                  Start Your Free 14-Day Trial
                </a>
                <a
                  href={BOOK_DEMO_URL}
                  className="rounded-lg bg-slate-800 px-5 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-700"
                >
                  Book a Live Demo
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
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
