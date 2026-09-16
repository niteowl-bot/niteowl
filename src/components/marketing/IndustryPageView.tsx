import Link from "next/link";
import type {
  IndustryEnquiryPanel,
  IndustryJobTicket,
  IndustryPage,
  IndustryTheme,
} from "@/lib/site/industryPages";
import { webPageJsonLd } from "@/lib/site/structuredData";

// ── Industry landing page view — marketing only ─────────────────────
//
// A SERVER COMPONENT THAT RENDERS ONE STATIC CONTENT OBJECT. No client
// directive, state, effect, request API, storage, network, Remy import
// or provider. Everything on the page comes from the IndustryPage it is
// given (src/lib/site/industryPages.ts); the view decides nothing and
// configures nothing — there is still one Remy.
//
// THE HOMEPAGE'S VISUAL LANGUAGE, NOT A NEW ONE. The same slate/indigo
// tokens, section rhythm (dark hero → white and slate-50 sections →
// indigo closing strip), eyebrow / heading / lead pattern, card and
// <details> FAQ markup as src/app/page.tsx. The nav and footer are
// inlined exactly as the homepage and legal pages inline theirs; the
// homepage itself is untouched.
//
// RESPONSIVE BY TAILWIND BREAKPOINTS ONLY — no custom media query, no
// fixed width, no fixed height, no device hack. Phones (<640) get one
// column, full-width tappable CTAs, a stacked call-summary card and
// 16px gutters; sm/md reflow to two columns; the hero splits into two
// columns only from xl (1280), because at lg the split leaves neither
// column enough room for a one-line CTA pair. Card grids use a
// six-track lg grid so a short last row is centred rather than left
// with an empty slot. Every container is a max-w-* centred block, so
// 1920 and 2560 keep the same measure as 1440.
//
// STRUCTURED DATA follows the two patterns the site already has: the
// A-1 WebPage builder for the page itself, and the homepage's inline
// FAQPage built from the SAME array the visible FAQ renders, so the two
// can never disagree. It states no rating, review, count or figure.

function CheckIcon() {
  return (
    <svg
      className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

// ── Presentation — Slice 1 ─────────────────────────────────────────
//
// STATIC CLASS MAPS. Every class Tailwind needs is written out here as a
// literal, keyed by the closed IndustryTheme union; nothing is built from
// a string at runtime. A theme tints only the hero's SECONDARY cues —
// the eyebrow pill, the visual's ring and badges, the decorative stroke.
// The CTA classes above are untouched by it: indigo is the brand and
// the action colour on every page.
const THEME: Record<
  IndustryTheme,
  { pill: string; dot: string; ring: string; badge: string; accent: string; stroke: string; chip: string }
> = {
  indigo: {
    pill: "bg-indigo-950 border-indigo-800 text-indigo-300",
    dot: "bg-indigo-400",
    ring: "ring-indigo-500/20",
    badge: "text-indigo-300 bg-indigo-950 border-indigo-800",
    accent: "text-indigo-300",
    stroke: "text-indigo-400",
    chip: "bg-indigo-500/15 border-indigo-400/60 text-indigo-200",
  },
  cyan: {
    pill: "bg-cyan-950 border-cyan-800 text-cyan-300",
    dot: "bg-cyan-400",
    ring: "ring-cyan-400/30",
    badge: "text-cyan-300 bg-cyan-950 border-cyan-800",
    accent: "text-cyan-300",
    stroke: "text-cyan-400",
    chip: "bg-cyan-500/15 border-cyan-400/60 text-cyan-200",
  },
  amber: {
    pill: "bg-amber-950 border-amber-800 text-amber-300",
    dot: "bg-amber-400",
    ring: "ring-amber-400/30",
    badge: "text-amber-300 bg-amber-950 border-amber-800",
    accent: "text-amber-300",
    stroke: "text-amber-400",
    chip: "bg-amber-500/15 border-amber-400/60 text-amber-200",
  },
};

/** The default hero visual: the owner's structured call-summary rows. Unchanged from before Slice 1. */
function SummaryCard({ page, theme }: { page: IndustryPage; theme: (typeof THEME)[IndustryTheme] }) {
  return (
    <div
      className={`w-full max-w-2xl mx-auto xl:max-w-none bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 shadow-xl ring-1 ${theme.ring}`}
      data-summary-card
      data-hero-visual="summary_card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4 sm:mb-5">
        <p className="text-white font-semibold">{page.hero.summary_card.title}</p>
        <span className={`text-xs font-medium uppercase tracking-wider border px-2 py-1 rounded-full whitespace-nowrap ${theme.badge}`}>
          Call summary
        </span>
      </div>
      <dl className="divide-y divide-slate-800">
        {page.hero.summary_card.rows.map((row) => (
          <div key={row.label} className="py-3 grid grid-cols-1 gap-0.5 sm:grid-cols-[9rem_1fr] sm:gap-3 text-sm">
            <dt className="text-slate-500">{row.label}</dt>
            <dd className="text-slate-200">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-slate-500 text-xs leading-relaxed mt-4 sm:mt-5">{page.hero.summary_card.note}</p>
    </div>
  );
}

/**
 * The plumbers-style visual: one incoming job as it reaches the owner —
 * soft geometry (rounded ticket, a curved decorative flow line), an
 * urgency chip attributed to the caller, the problem as a quotation, the
 * captured rows, and the REQUEST state as its footer. The flow line is
 * inline SVG, decorative, hidden from assistive tech and hidden below
 * `sm` so it never affects layout.
 */
function JobTicket({ ticket, theme }: { ticket: IndustryJobTicket; theme: (typeof THEME)[IndustryTheme] }) {
  return (
    <div
      className={`relative overflow-hidden w-full max-w-2xl mx-auto xl:max-w-none bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-xl ring-1 ${theme.ring}`}
      data-hero-visual="job_ticket"
    >
      <svg
        className={`hidden sm:block pointer-events-none absolute -top-10 -right-12 w-56 h-28 opacity-25 ${theme.stroke}`}
        viewBox="0 0 256 160"
        fill="none"
        aria-hidden="true"
      >
        <path d="M0 120 C 60 120, 70 30, 130 30 S 200 120, 256 40" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M0 140 C 60 140, 70 50, 130 50 S 200 140, 256 60" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
      </svg>

      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <p className={`text-xs font-semibold uppercase tracking-widest ${theme.accent}`}>{ticket.title}</p>
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium border px-2.5 py-1 rounded-full whitespace-nowrap ${theme.badge}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${theme.dot}`} aria-hidden="true" />
            {ticket.urgency_label}
          </span>
        </div>

        <blockquote className="border-l-2 border-slate-700 pl-4 mb-5">
          <p className="text-white text-lg sm:text-xl font-medium leading-snug">“{ticket.problem}”</p>
          <p className="text-slate-500 text-xs mt-1.5">{ticket.problem_caption}</p>
        </blockquote>

        <dl className="divide-y divide-slate-800 border-y border-slate-800">
          {ticket.rows.map((row) => (
            <div key={row.label} className="py-2.5 grid grid-cols-1 gap-0.5 sm:grid-cols-[8.5rem_1fr] sm:gap-3 text-sm">
              <dt className="text-slate-500">{row.label}</dt>
              <dd className="text-slate-200">{row.value}</dd>
            </div>
          ))}
        </dl>

        <p className="flex items-start gap-2 text-sm text-slate-200 mt-4" data-visual-status>
          <svg className={`w-4 h-4 mt-0.5 shrink-0 ${theme.stroke}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h12m0 0l-4-4m4 4l-4 4" />
          </svg>
          {ticket.status}
        </p>
        <p className="text-slate-500 text-xs leading-relaxed mt-3">{ticket.illustrative_note}</p>
      </div>
    </div>
  );
}

/**
 * The electricians-style visual: the enquiry types a caller may describe,
 * one highlighted, above the structured details — square geometry (a
 * panel, square-cornered chips, an orthogonal circuit trace) against the
 * ticket's curves. The chips are caller-described service context; the
 * caption says so, and the footer is a neutral capture state. The trace
 * is inline SVG, decorative, hidden from assistive tech and below `sm`.
 */
function EnquiryPanel({ panel, theme }: { panel: IndustryEnquiryPanel; theme: (typeof THEME)[IndustryTheme] }) {
  return (
    <div
      className={`relative overflow-hidden w-full max-w-2xl mx-auto xl:max-w-none bg-slate-900 border border-slate-800 rounded-xl p-5 sm:p-7 shadow-xl ring-1 ${theme.ring}`}
      data-hero-visual="enquiry_panel"
    >
      <svg
        className={`hidden sm:block pointer-events-none absolute -top-2 -right-2 w-40 h-20 opacity-25 ${theme.stroke}`}
        viewBox="0 0 224 144"
        fill="none"
        aria-hidden="true"
      >
        <path d="M224 20 H150 V60 H100 V100 H40 V144" stroke="currentColor" strokeWidth="2" />
        <path d="M224 44 H170 V84 H120 V124 H80 V144" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        <rect x="146" y="16" width="8" height="8" fill="currentColor" />
        <rect x="96" y="56" width="8" height="8" fill="currentColor" />
        <rect x="36" y="96" width="8" height="8" fill="currentColor" />
      </svg>

      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <p className={`text-xs font-semibold uppercase tracking-widest ${theme.accent}`}>{panel.title}</p>
          <span className={`text-xs font-medium uppercase tracking-wider border px-2 py-1 rounded whitespace-nowrap ${theme.badge}`}>
            Enquiry
          </span>
        </div>

        <p className="text-slate-500 text-xs mb-2">{panel.types_caption}</p>
        <ul className="flex flex-wrap gap-1.5 mb-5" data-enquiry-types>
          {panel.enquiry_types.map((type) => {
            const active = type === panel.highlighted_type;
            return (
              <li
                key={type}
                className={`text-xs font-medium border px-2 py-1 rounded ${active ? theme.chip : "border-slate-700 text-slate-400"}`}
                data-active={active ? "true" : undefined}
              >
                {type}
              </li>
            );
          })}
        </ul>

        <dl className="border border-slate-800 rounded-lg divide-y divide-slate-800">
          {panel.rows.map((row) => (
            <div key={row.label} className="px-3 py-2.5 grid grid-cols-1 gap-0.5 sm:grid-cols-[9rem_1fr] sm:gap-3 text-sm">
              <dt className="text-slate-500">{row.label}</dt>
              <dd className="text-slate-200">{row.value}</dd>
            </div>
          ))}
        </dl>

        <p className="flex items-start gap-2 text-sm text-slate-200 mt-4" data-visual-status>
          <svg className={`w-4 h-4 mt-0.5 shrink-0 ${theme.stroke}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {panel.status}
        </p>
        <p className="text-slate-500 text-xs leading-relaxed mt-3">{panel.illustrative_note}</p>
      </div>
    </div>
  );
}

/** Picks the hero visual. Absent presentation, or a variant without its data, is the summary card. */
function HeroVisual({ page, theme }: { page: IndustryPage; theme: (typeof THEME)[IndustryTheme] }) {
  const variant = page.presentation?.hero_visual ?? "summary_card";
  if (variant === "job_ticket" && page.hero.job_ticket) return <JobTicket ticket={page.hero.job_ticket} theme={theme} />;
  if (variant === "enquiry_panel" && page.hero.enquiry_panel) return <EnquiryPanel panel={page.hero.enquiry_panel} theme={theme} />;
  return <SummaryCard page={page} theme={theme} />;
}

function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <p
      className={`${dark ? "text-indigo-400" : "text-indigo-600"} text-sm font-semibold uppercase tracking-widest mb-3`}
    >
      {children}
    </p>
  );
}

/**
 * Placement of card `index` of `count` in a grid that is one column on
 * phones, two from sm and three from lg (six tracks, two per card).
 * A short last row is centred on lg: one leftover card starts at track
 * 3, two leftover cards start at track 2. Static class strings only, so
 * Tailwind can see every one.
 */
function cardPlacement(index: number, count: number): string {
  const remainder = count % 3;
  const firstOfLastRow = count - remainder;
  // One card left over: full width on sm, centred on lg.
  if (remainder === 1 && index === firstOfLastRow) return "sm:col-span-2 lg:col-span-2 lg:col-start-3";
  if (remainder === 2 && index === firstOfLastRow) return "sm:col-span-1 lg:col-span-2 lg:col-start-2";
  return "sm:col-span-1 lg:col-span-2";
}

const CARD_GRID = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 sm:gap-5";

const CTA_PRIMARY =
  "inline-flex items-center justify-center w-full sm:w-auto bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-6 sm:px-7 py-3.5 rounded-lg transition-colors text-[15px] sm:text-base text-center sm:whitespace-nowrap";
const CTA_SECONDARY =
  "inline-flex items-center justify-center w-full sm:w-auto bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold px-6 sm:px-7 py-3.5 rounded-lg transition-colors text-[15px] sm:text-base text-center sm:whitespace-nowrap";

export default function IndustryPageView({ page }: { page: IndustryPage }) {
  const theme = THEME[page.presentation?.theme ?? "indigo"];
  // The builder carries its own @context; inside a @graph the outer one
  // applies, so the inner copy is dropped rather than repeated.
  const { "@context": _context, ...webPage } = webPageJsonLd({
    name: page.title,
    path: page.path,
    description: page.description,
  });
  void _context;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      webPage,
      {
        "@type": "FAQPage",
        mainEntity: page.faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };

  return (
    <div className="min-h-screen bg-white font-sans" data-industry={page.slug}>
      {/* JSON-LD as a string child: React renders script text verbatim, and
          "<" is written as < so the content can never close the tag. */}
      <script type="application/ld+json">
        {JSON.stringify(structuredData).replace(/</g, "\\u003c")}
      </script>

      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-900 focus:shadow-lg"
      >
        Skip to content
      </a>

      {/* ── NAV ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-slate-950/90 backdrop-blur-sm border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Link href="/" className="text-white font-bold text-xl tracking-tight shrink-0">
            niteowl<span className="text-indigo-400">.</span>
          </Link>
          <div className="flex items-center gap-3 sm:gap-4">
            {/* Also in the footer, so it can yield on the narrowest phones. */}
            <Link
              href="/free-tools"
              className="hidden sm:inline text-slate-400 hover:text-white text-sm transition-colors whitespace-nowrap py-2"
            >
              Free tools
            </Link>
            <Link
              href="/login"
              className="text-slate-400 hover:text-white text-sm transition-colors whitespace-nowrap py-2"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-3.5 sm:px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
            >
              Start free trial
            </Link>
          </div>
        </div>
      </nav>

      <main id="main-content">
        {/* ── HERO ── */}
        <section className="bg-slate-950 pt-28 sm:pt-32 pb-16 sm:pb-24 px-4 sm:px-6" data-hero>
          <div className="max-w-6xl mx-auto grid xl:grid-cols-[1.1fr_0.9fr] gap-10 sm:gap-12 xl:gap-16 items-center">
            <div className="text-center xl:text-left">
              <div className={`inline-flex items-center gap-2 border text-xs font-semibold uppercase tracking-widest px-3 py-1.5 rounded-full mb-6 sm:mb-8 ${theme.pill}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${theme.dot}`} aria-hidden="true" />
                {page.hero.eyebrow}
              </div>

              <h1 className="text-4xl sm:text-5xl xl:text-6xl font-bold text-white leading-tight tracking-tight mb-5 sm:mb-6 text-balance">
                {page.hero.headline} <span className="text-indigo-400">{page.hero.headline_accent}</span>
              </h1>

              <p className="text-base sm:text-lg lg:text-xl text-slate-400 max-w-2xl mx-auto xl:mx-0 mb-8 leading-relaxed">
                {page.hero.lead}
              </p>

              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-left max-w-xl mx-auto xl:mx-0 mb-8 sm:mb-10">
                {page.hero.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-2.5 text-slate-300 text-sm">
                    <CheckIcon />
                    {bullet}
                  </li>
                ))}
              </ul>

              <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 justify-center xl:justify-start">
                <Link href={page.hero.primary_cta.href} className={CTA_PRIMARY} data-primary-cta>
                  {page.hero.primary_cta.label}
                </Link>
                <Link href={page.hero.secondary_cta.href} className={CTA_SECONDARY} data-secondary-cta>
                  {page.hero.secondary_cta.label}
                </Link>
              </div>
            </div>

            {/* Product-led visual: the summary card by default, or the industry's opted-in ticket / panel. */}
            <HeroVisual page={page} theme={theme} />
          </div>
        </section>

        {/* ── PAIN POINTS ── */}
        <section className="bg-white py-16 sm:py-20 px-4 sm:px-6" data-pain-points>
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-10 sm:mb-14">
              <Eyebrow>{page.pain_points.eyebrow}</Eyebrow>
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight mb-4 text-balance">
                {page.pain_points.heading}
              </h2>
              <p className="text-slate-500 text-base sm:text-lg max-w-2xl mx-auto">{page.pain_points.lead}</p>
            </div>
            <div className={CARD_GRID}>
              {page.pain_points.items.map((item, index) => (
                <div
                  key={item.title}
                  className={`bg-slate-50 border border-slate-200 rounded-2xl p-5 sm:p-6 h-full ${cardPlacement(index, page.pain_points.items.length)}`}
                >
                  <h3 className="text-slate-900 font-semibold text-base mb-2">{item.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CAPABILITIES ── */}
        <section className="bg-slate-50 border-y border-slate-200 py-16 sm:py-20 px-4 sm:px-6" data-capabilities>
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-10 sm:mb-14">
              <Eyebrow>{page.capabilities.eyebrow}</Eyebrow>
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight mb-4 text-balance">
                {page.capabilities.heading}
              </h2>
              <p className="text-slate-500 text-base sm:text-lg max-w-2xl mx-auto">{page.capabilities.lead}</p>
            </div>
            <div className={CARD_GRID}>
              {page.capabilities.items.map((item, index) => (
                <div
                  key={item.title}
                  className={`bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 h-full ${cardPlacement(index, page.capabilities.items.length)}`}
                >
                  <p className="text-slate-300 font-bold text-3xl mb-3 font-mono">
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <h3 className="text-slate-900 font-semibold text-base mb-2">{item.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">{item.body}</p>
                  {item.condition && (
                    <p className="text-slate-500 text-xs leading-relaxed mt-3 border-l-2 border-indigo-200 pl-3" data-condition>
                      {item.condition}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── ILLUSTRATIVE CALL EXAMPLE ── */}
        <section className="bg-white py-16 sm:py-20 px-4 sm:px-6" data-example>
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-8 sm:mb-10">
              <Eyebrow>{page.example.eyebrow}</Eyebrow>
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight mb-4 text-balance">
                {page.example.heading}
              </h2>
              <p className="text-slate-500 text-sm max-w-xl mx-auto" data-disclaimer>
                {page.example.disclaimer}
              </p>
            </div>
            <div className="bg-slate-950 rounded-2xl p-5 sm:p-8 shadow-xl ring-1 ring-indigo-500/30">
              <p className="text-indigo-300 text-xs font-semibold uppercase tracking-widest mb-2">Customer</p>
              <p className="text-white text-base sm:text-lg leading-relaxed mb-6">“{page.example.customer_says}”</p>
              <p className="text-indigo-300 text-xs font-semibold uppercase tracking-widest mb-3">Remy</p>
              <ol className="space-y-2.5">
                {page.example.remy_does.map((step, index) => (
                  <li key={step} className="flex items-start gap-3 text-slate-300 text-sm leading-relaxed">
                    <span className="text-slate-500 font-mono text-xs mt-1 shrink-0">{index + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ── BUSINESS OPPORTUNITY SCAN ── */}
        <section className="bg-slate-950 py-16 sm:py-20 px-4 sm:px-6" data-scan>
          <div className="max-w-3xl mx-auto text-center">
            <Eyebrow dark>{page.scan.eyebrow}</Eyebrow>
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-4 text-balance">
              {page.scan.heading}
            </h2>
            <p className="text-slate-400 text-base sm:text-lg leading-relaxed mb-4">{page.scan.lead}</p>
            <p className="text-slate-500 text-sm leading-relaxed mb-8">{page.scan.promise}</p>
            <Link href={page.scan.cta.href} className={CTA_PRIMARY} data-scan-cta>
              {page.scan.cta.label}
            </Link>
            <p className="text-slate-500 text-sm mt-10 mb-2">Read about the problems the scan looks for:</p>
            <ul className="flex flex-col sm:flex-row sm:flex-wrap justify-center items-center gap-x-6 gap-y-1">
              {page.scan.problem_links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-block py-2.5 text-indigo-400 hover:text-indigo-300 text-sm font-medium"
                  >
                    {link.label}&nbsp;→
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── HOW IT WORKS ── */}
        <section className="bg-slate-50 border-b border-slate-200 py-16 sm:py-20 px-4 sm:px-6" data-how-it-works>
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-10 sm:mb-14">
              <Eyebrow>{page.how_it_works.eyebrow}</Eyebrow>
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight text-balance">
                {page.how_it_works.heading}
              </h2>
            </div>
            <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
              {page.how_it_works.steps.map((step, index) => (
                <li key={step.title} className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 h-full">
                  <p className="text-slate-300 font-bold text-3xl mb-3 font-mono">
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <h3 className="text-slate-900 font-semibold text-base mb-2">{step.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="bg-white py-16 sm:py-24 px-4 sm:px-6" data-faq>
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-10 sm:mb-12">
              <Eyebrow>FAQ</Eyebrow>
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight text-balance">
                {page.faq_heading}
              </h2>
            </div>
            <div className="divide-y divide-slate-200 border-y border-slate-200">
              {page.faqs.map((item) => (
                <details key={item.q} className="group py-3">
                  {/* py-2.5 on the summary itself keeps the tap target ≥ 44px. */}
                  <summary className="flex cursor-pointer items-center justify-between gap-4 list-none py-2.5 text-slate-900 font-semibold text-[15px] sm:text-base marker:content-none">
                    {item.q}
                    <svg
                      className="w-5 h-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                    </svg>
                  </summary>
                  <p className="mt-1 pb-2 text-slate-500 text-sm sm:text-[15px] leading-relaxed">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── FINAL CTA ── */}
        <section className="bg-indigo-600 py-14 sm:py-16 px-4 sm:px-6" data-final-cta>
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-4 text-balance">
              {page.final_cta.heading}
            </h2>
            <p className="text-indigo-200 text-base sm:text-lg mb-8">{page.final_cta.lead}</p>
            <Link
              href={page.final_cta.cta.href}
              className="inline-flex items-center justify-center w-full sm:w-auto bg-white text-indigo-700 font-semibold px-6 sm:px-8 py-3.5 rounded-lg hover:bg-indigo-50 transition-colors text-[15px] sm:text-base text-center sm:whitespace-nowrap"
              data-final-cta-link
            >
              {page.final_cta.cta.label}
            </Link>
          </div>
        </section>
      </main>

      {/* ── FOOTER ── */}
      <footer className="bg-slate-950 border-t border-slate-800 py-10 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-center">
          <Link href="/" className="text-white font-bold text-lg tracking-tight">
            niteowl<span className="text-indigo-400">.</span>
          </Link>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-slate-400 text-sm">
            <Link href="/free-tools" className="hover:text-white transition-colors py-2">
              Free tools
            </Link>
            <Link href="/privacy" className="hover:text-white transition-colors py-2">
              Privacy policy
            </Link>
            <Link href="/terms" className="hover:text-white transition-colors py-2">
              Terms
            </Link>
          </div>
          <p className="text-slate-600 text-sm">© {new Date().getFullYear()} Niteowl AI Ltd</p>
        </div>
      </footer>
    </div>
  );
}
