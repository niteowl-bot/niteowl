import type { Metadata } from "next";
import Link from "next/link";
import {
  LOST_REVENUE_CTA_HREF,
  LOST_REVENUE_CTA_LABEL,
  LOST_REVENUE_DESCRIPTION,
  LOST_REVENUE_H1,
  LOST_REVENUE_LEAD,
  LOST_REVENUE_PATH,
  LOST_REVENUE_PROBLEM_HEADLINE,
  LOST_REVENUE_PROBLEM_LINK_LABEL,
  LOST_REVENUE_PROBLEM_PAGE_PATH,
  LOST_REVENUE_PROMISE,
  LOST_REVENUE_SECTIONS,
  LOST_REVENUE_TITLE,
} from "@/lib/site/lostRevenuePage";
import { publicUrl } from "@/lib/site/publicRoutes";
import { webPageJsonLd } from "@/lib/site/structuredData";

// ── Lost Revenue entry — A-2b ──────────────────────────────────────
//
// A SERVER COMPONENT THAT RENDERS STATIC CONTENT. No client directive,
// state, effect, request API, storage or network. Everything on the
// page comes from src/lib/site/lostRevenuePage.ts; the one call to
// action is the Scan's bare path, and the Scan — unchanged — is where
// any number is worked out.

export const metadata: Metadata = {
  title: LOST_REVENUE_TITLE,
  description: LOST_REVENUE_DESCRIPTION,
  alternates: { canonical: LOST_REVENUE_PATH },
  openGraph: {
    type: "website",
    url: publicUrl(LOST_REVENUE_PATH),
    siteName: "NiteOwl HQ",
    title: LOST_REVENUE_TITLE,
    description: LOST_REVENUE_DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: LOST_REVENUE_TITLE,
    description: LOST_REVENUE_DESCRIPTION,
  },
};

const structuredData = webPageJsonLd({
  name: LOST_REVENUE_TITLE,
  path: LOST_REVENUE_PATH,
  description: LOST_REVENUE_DESCRIPTION,
});

export default function LostRevenuePage() {
  return (
    <article className="max-w-2xl mx-auto px-6 py-12 sm:py-16" data-lost-revenue-entry>
      {/* JSON-LD as a string child: React renders script text verbatim, and
          "<" is written as < so the constant can never close the tag. */}
      <script type="application/ld+json">
        {JSON.stringify(structuredData).replace(/</g, "\\u003c")}
      </script>

      <p className="text-indigo-400 text-sm font-medium mb-3">Free tool</p>
      <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-4">
        {LOST_REVENUE_H1}
      </h1>
      <p className="text-slate-300 text-[15px] leading-relaxed" data-lead>
        {LOST_REVENUE_LEAD}
      </p>
      <p className="text-slate-500 text-sm leading-relaxed mt-3" data-problem-headline>
        The scan attaches this estimate to one finding only: <em>{LOST_REVENUE_PROBLEM_HEADLINE}</em>.
      </p>

      {LOST_REVENUE_SECTIONS.map((section) => (
        <section key={section.heading} data-section>
          <h2 className="text-white font-semibold text-xl mt-10 mb-3">{section.heading}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} className="text-slate-300 text-[15px] leading-relaxed mb-4">
              {paragraph}
            </p>
          ))}
        </section>
      ))}

      <p className="text-slate-400 text-sm leading-relaxed mt-6">{LOST_REVENUE_PROMISE}</p>
      <p className="mt-6">
        <Link
          href={LOST_REVENUE_CTA_HREF}
          className="inline-block rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-5 py-2.5 transition-colors"
          data-scan-cta
        >
          {LOST_REVENUE_CTA_LABEL} →
        </Link>
      </p>

      <p className="mt-8 flex flex-wrap gap-x-5 gap-y-2">
        <Link
          href={LOST_REVENUE_PROBLEM_PAGE_PATH}
          className="text-indigo-400 hover:text-indigo-300 text-sm font-medium"
          data-problem-link
        >
          {LOST_REVENUE_PROBLEM_LINK_LABEL} →
        </Link>
        <Link href="/free-tools" className="text-slate-400 hover:text-white text-sm transition-colors">
          ← All free tools
        </Link>
      </p>
    </article>
  );
}
