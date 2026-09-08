import Link from "next/link";
import "./print.css";

// ── Free Tools chrome ──────────────────────────────────────────────
//
// A layout of its own rather than the homepage's inline nav, for one
// architectural reason: the free-product surface is the only NiteOwl
// surface that legitimately has no `org_id`
// (docs/ARCHITECTURE.md §26, docs/AGENT_ACCESS_LAYER.md §25.1). Its
// isolation has to be STRUCTURAL, because the "every query carries an
// explicit org_id" discipline that protects everything else has nothing
// to bind to here. Keeping this surface in its own segment, with its own
// chrome, is the first and cheapest expression of that separation.
//
// What is shared with the rest of the site is DESIGN ONLY — Tailwind
// classes and the same slate/indigo tokens the marketing pages use. No
// business logic, no data access, no Remy import, and nothing that
// reaches a tenant.
//
// PUBLIC BY DEFAULT. src/middleware.ts gates only /dashboard and the
// billing paths, so this segment needs no middleware change and must not
// acquire one: a free tool that asks a visitor to sign in before it has
// given them anything has stopped being a free tool.
//
// `ft-surface` and `ft-no-print` are the print hooks (see print.css).
// The site chrome carries no information a saved document needs, so it
// is marked screen-only rather than restyled for paper.

export default function FreeToolsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="ft-surface min-h-screen bg-slate-950 text-slate-300 font-sans flex flex-col">
      <nav className="ft-no-print border-b border-slate-800">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link
            href="/"
            className="text-white font-bold text-xl tracking-tight"
          >
            niteowl<span className="text-indigo-400">.</span>
          </Link>
          <div className="flex items-center gap-5">
            <Link
              href="/free-tools"
              className="text-slate-300 hover:text-white text-sm transition-colors"
            >
              Free tools
            </Link>
            <Link
              href="/"
              className="text-slate-400 hover:text-white text-sm transition-colors"
            >
              ← Back to home
            </Link>
          </div>
        </div>
      </nav>

      <main className="flex-1">{children}</main>

      <footer className="ft-no-print border-t border-slate-800 py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-500">
          <p>© {new Date().getFullYear()} NiteOwl AI</p>
          <div className="flex items-center gap-5">
            <Link href="/privacy" className="hover:text-white transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-white transition-colors">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
