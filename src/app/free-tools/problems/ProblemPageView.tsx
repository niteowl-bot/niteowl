import Link from "next/link";
import type { ScanConditionCode } from "@/lib/freetools/scanTypes";
import {
  PROBLEM_PAGES,
  SCAN_CTA_LABEL,
  SCAN_PATH,
  SCAN_PROMISE,
} from "@/lib/site/problemPages";
import { webPageJsonLd } from "@/lib/site/structuredData";

// ── A problem-led discovery page — A-2a ────────────────────────────
//
// A SERVER COMPONENT THAT RENDERS A STATIC MAP. No client state, no
// effect, no request API, no storage. Everything on the page comes from
// src/lib/site/problemPages.ts, which in turn takes the problem's name
// and the advice from the Scan's own recommendation data — so this page
// cannot say anything about the problem that the report would not.
//
// IT DIAGNOSES NOBODY. The mechanism paragraphs explain how a problem
// tends to arise in general; the one thing a visitor is invited to do
// is run the unchanged nine-question Scan, which is where any statement
// about THEIR business is made — from their answers, by the engine.
//
// ONE DESTINATION, ONE FORM OF IT. The call to action is the Scan's
// bare path: no query string, no fragment, no prefill. The Setup Kit
// link on the booking-friction page is the report's own canonical
// handoff, rendered exactly as the report renders it.

export default function ProblemPageView({ condition }: { condition: ScanConditionCode }) {
  const page = PROBLEM_PAGES[condition];
  const structuredData = webPageJsonLd({
    name: page.title,
    path: page.path,
    description: page.description,
  });

  return (
    <article className="max-w-2xl mx-auto px-6 py-12 sm:py-16" data-problem={page.condition}>
      {/* JSON-LD as a string child: React renders script text verbatim, and
          "<" is written as < so the constant can never close the tag. */}
      <script type="application/ld+json">
        {JSON.stringify(structuredData).replace(/</g, "\\u003c")}
      </script>

      <p className="text-indigo-400 text-sm font-medium mb-3">Common problems</p>
      <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-4">
        {page.headline}
      </h1>
      <p className="text-slate-400 text-[15px] leading-relaxed">{page.description}</p>

      <h2 className="text-white font-semibold text-xl mt-10 mb-3">How this tends to happen</h2>
      <div className="space-y-4" data-mechanisms>
        {page.how_it_tends_to_happen.map((paragraph) => (
          <p key={paragraph} className="text-slate-300 text-[15px] leading-relaxed">
            {paragraph}
          </p>
        ))}
      </div>

      <h2 className="text-white font-semibold text-xl mt-10 mb-3">One thing you can do</h2>
      <p className="text-slate-300 text-[15px] leading-relaxed" data-next-step>
        {page.next_step}
      </p>

      {page.routing.kind === "setup_kit_then_remy" && (
        <p className="mt-4" data-handoff>
          <Link
            href={page.routing.handoff.href}
            className="text-indigo-400 hover:text-indigo-300 text-[15px] font-medium"
          >
            {page.routing.handoff.label} →
          </Link>
        </p>
      )}

      <h2 className="text-white font-semibold text-xl mt-10 mb-3">Find out where you stand</h2>
      <p className="text-slate-300 text-[15px] leading-relaxed" data-scan-scope>
        {page.what_the_scan_can_tell_you}
      </p>
      <p className="text-slate-400 text-sm leading-relaxed mt-3">{SCAN_PROMISE}</p>
      <p className="mt-6">
        <Link
          href={SCAN_PATH}
          className="inline-block rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-5 py-2.5 transition-colors"
          data-scan-cta
        >
          {SCAN_CTA_LABEL} →
        </Link>
      </p>

      {page.routing.kind === "none" && (
        <p className="text-slate-500 text-sm leading-relaxed mt-10" data-no-product>
          {page.routing.wording}
        </p>
      )}
      {page.routing.kind !== "none" && (
        <p className="text-slate-500 text-sm leading-relaxed mt-10" data-attribution>
          {page.routing.attribution}
        </p>
      )}

      <p className="mt-8">
        <Link href="/free-tools" className="text-slate-400 hover:text-white text-sm transition-colors">
          ← All free tools
        </Link>
      </p>
    </article>
  );
}
