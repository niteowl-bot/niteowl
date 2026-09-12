import Link from "next/link";
import type { Metadata } from "next";

// ── The Free Tools hub ─────────────────────────────────────────────
//
// Phase 1 is the SHELL ONLY: a public hub page that says what the free
// tools are for and names the first one. No tool is implemented here, and
// deliberately so — the whole point of shipping the shell first is that
// it carries zero persistence, zero authentication and zero data.
//
// ZERO PERSISTENCE. This page is static. It writes nothing, reads
// nothing, sets no cookie, stores no anonymous identifier and calls no
// API route. There is no database table behind it and no event is
// emitted. Every one of those is a later, separately approved phase.
//
// NOTHING HERE TOUCHES REMY. No import from src/lib/voice, leadCapture,
// availability, calendarSync or integrations — and none may be added.
// The free-product surface produces provider-neutral business
// information; anything it eventually hands to Remy goes through an
// explicit, recorded, consented import step (docs/ARCHITECTURE.md §26),
// never as a side effect of somebody using a tool.

export const metadata: Metadata = {
  title: "Free Business Tools — NiteOwl AI",
  description:
    "Free, practical tools for small businesses from NiteOwl AI. Get something useful in minutes — no account needed.",
  alternates: { canonical: "/free-tools" },
};

/**
 * The tools shown on the hub.
 *
 * A tool with an `href` renders as a link; one without stays a preview
 * card marked "Coming soon". Listing a tool before it exists is more
 * honest than a placeholder that pretends to be finished — and the flag
 * flips by adding the route, so the card can never link somewhere that
 * has not been built.
 */
const TOOLS = [
  {
    name: "Business Opportunity Scan",
    summary:
      "Answer nine short questions about how enquiries reach your business and what happens to them, and get a plain report on where you may be missing work, what you could do about it, and how you would know it worked.",
    detail:
      "Nothing is stored and nothing is sent — the report is complete without an account.",
    href: "/free-tools/business-opportunity-scan",
    cta: "Start the scan →",
  },
  {
    name: "AI Receptionist Business Setup Kit",
    summary:
      "Answer a few questions about how your business handles enquiries, and get a clear, structured setup you can act on — opening hours, services, common questions, and what should happen when someone calls out of hours.",
    detail:
      "Useful on its own, whether or not you ever use an AI receptionist.",
    href: "/free-tools/ai-receptionist-setup-kit",
    cta: "Start setup →",
  },
] as const;

export default function FreeToolsPage() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-16 sm:py-20">
      <header className="max-w-2xl">
        <p className="text-indigo-400 text-sm font-medium mb-3">
          Free tools
        </p>
        <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-4">
          Practical tools for small businesses
        </h1>
        <p className="text-slate-400 text-[15px] leading-relaxed">
          Free tools that give you something genuinely useful in a few minutes.
          No account, no card, no sales call — use one, keep the result, and
          decide about the rest later.
        </p>
      </header>

      <section className="mt-12 grid gap-5 sm:grid-cols-2">
        {TOOLS.map((tool) => (
          <article
            key={tool.name}
            className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 flex flex-col"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <h2 className="text-white font-semibold text-lg leading-snug">
                {tool.name}
              </h2>
              {!tool.href && (
                <span className="shrink-0 text-[11px] uppercase tracking-wide font-medium text-indigo-300 border border-indigo-500/30 bg-indigo-500/10 rounded-full px-2.5 py-1">
                  Coming soon
                </span>
              )}
            </div>
            <p className="text-slate-400 text-sm leading-relaxed">
              {tool.summary}
            </p>
            <p className="text-slate-500 text-sm leading-relaxed mt-3">
              {tool.detail}
            </p>
            {tool.href && (
              <Link
                href={tool.href}
                className="mt-5 inline-block self-start rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2.5 transition-colors"
              >
                {tool.cta}
              </Link>
            )}
          </article>
        ))}
      </section>

      <section className="mt-14 border-t border-slate-800 pt-8 max-w-2xl">
        <h2 className="text-white font-semibold mb-2">
          Why these are free
        </h2>
        <p className="text-slate-400 text-sm leading-relaxed">
          NiteOwl builds Remy, an AI receptionist that answers enquiries and
          books appointments for small businesses. These tools are useful on
          their own, and they are the easiest way to see how we think about
          the problem. If one of them helps, that is the point — there is no
          obligation to go further.
        </p>
        <Link
          href="/"
          className="inline-block mt-5 text-indigo-400 hover:text-indigo-300 text-sm font-medium transition-colors"
        >
          Learn about Remy →
        </Link>
      </section>
    </div>
  );
}
