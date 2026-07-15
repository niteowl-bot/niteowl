"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: HomeIcon },
  { href: "/chat", label: "Chat Preview", icon: ChatIcon },
  { href: "/knowledge", label: "Knowledge Base", icon: DocumentIcon },
  { href: "/leads", label: "Leads", icon: UsersIcon },
  { href: "/calendar", label: "Calendar", icon: CalendarIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

function Logo() {
  return (
    <>
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white shadow-lg shadow-blue-600/30">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M8 1.5C4.41 1.5 1.5 4.41 1.5 8c0 1.74.65 3.33 1.72 4.54L1.5 14.5l2.04-1.69A6.48 6.48 0 0 0 8 14.5c3.59 0 6.5-2.91 6.5-6.5S11.59 1.5 8 1.5Z"
            fill="currentColor"
            opacity=".3"
          />
          <circle cx="5.5" cy="8.5" r="1" fill="currentColor" />
          <circle cx="8" cy="8.5" r="1" fill="currentColor" />
          <circle cx="10.5" cy="8.5" r="1" fill="currentColor" />
        </svg>
      </span>
      <span className="text-sm font-semibold tracking-tight text-white">
        Niteowl <span className="text-white/40">AI</span>
      </span>
    </>
  );
}

export default function DashboardNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile top bar — hidden at md and above, where the static sidebar takes over */}
      <div className="flex items-center justify-between border-b border-white/[0.07] bg-[#0d0f14] px-4 py-3 md:hidden">
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5"
          onClick={() => setOpen(false)}
        >
          <Logo />
        </Link>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>

      {/* Backdrop — mobile only, while the drawer is open */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar: slide-in drawer on mobile, static column at md and above */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col overflow-y-auto border-r border-white/[0.07] bg-[#0d0f14] p-4 transition-transform duration-200 md:static md:z-auto md:w-56 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Link
          href="/dashboard"
          className="mb-6 hidden items-center gap-2.5 px-1 md:flex"
        >
          <Logo />
        </Link>

        <nav className="space-y-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? "bg-blue-600/15 text-blue-400"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

// ── Icons (inline SVGs, no extra dependency) ──────────────────────

function MenuIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <path d="M2 13V5.5L7.5 2l5.5 3.5V13H9.5v-3h-4v3H2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <path d="M7.5 1.5C3.91 1.5 1 3.91 1 6.9c0 1.47.53 2.8 1.41 3.85L1.5 13.5l2.4-1.27a7.1 7.1 0 0 0 3.6.97c3.59 0 6.5-2.41 6.5-5.4s-2.91-5.3-6.5-5.3Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <path d="M4 1.5h4.5L11 4v9.5H4V1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8.5 1.5V4H11" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M6 7h3M6 9.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <circle cx="5.5" cy="5" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 13c0-2.5 1.79-4 4-4s4 1.5 4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M9.5 3.3c1.1.3 1.9 1.3 1.9 2.5s-.8 2.2-1.9 2.5M11 9.3c1.83.4 3 1.7 3 3.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <rect x="1.5" y="2.5" width="12" height="10.5" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 5.5h12M4.5 1v3M10.5 1v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <circle cx="7.5" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M7.5 1.5v1.3M7.5 12.2v1.3M13.5 7.5h-1.3M2.8 7.5H1.5M11.6 3.4l-.9.9M4.3 10.7l-.9.9M11.6 11.6l-.9-.9M4.3 4.3l-.9-.9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
