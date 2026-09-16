// Industry landing pages — presentation contract, Slice 1.
//
// The two industry pages share one IndustryPageView; Slice 1 lets a page
// opt into a secondary accent and a hero visual from a CLOSED set. These
// tests pin the contract's guarantees: a page with no `presentation`
// renders exactly the pre-Slice-1 hero (the summary card, indigo cues);
// plumbers opts into the job ticket and electricians into the enquiry
// panel; each hero carries its own trade's wording and none of the
// other's; neither hero claims a state Remy cannot guarantee; the CTAs,
// metadata and JSON-LD are untouched by presentation; the theme never
// reaches the CTA colour; every theme class is a literal; and nothing
// under Remy core knows any of this exists.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { ELECTRICIANS_PAGE, PLUMBERS_PAGE } from "@/lib/site/industryPages";
import IndustryPageView from "@/components/marketing/IndustryPageView";
import PlumbersPage, { metadata as plumbersMetadata } from "@/app/ai-receptionist-for-plumbers/page";
import ElectriciansPage, { metadata as electriciansMetadata } from "@/app/ai-receptionist-for-electricians/page";

const read = (file) => readFileSync(file, "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const unescape = (html) =>
  html.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const renderPage = (Page) => unescape(renderToStaticMarkup(createElement(Page)));
const renderView = (page) => unescape(renderToStaticMarkup(createElement(IndustryPageView, { page })));
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");

/** The hero <section> only. */
const heroOf = (html) => {
  const start = html.indexOf("data-hero");
  const end = html.indexOf("data-pain-points");
  assert.ok(start > 0 && end > start, "hero and pain sections present");
  return html.slice(start, end);
};
/** The hero's right-hand visual only. */
const visualOf = (html) => {
  const hero = heroOf(html);
  const marker = hero.indexOf("data-hero-visual=");
  assert.ok(marker > 0, "hero visual present");
  // Back up to the opening tag of the visual's container so its class
  // attribute (ring, radius) is part of what we inspect.
  const start = hero.lastIndexOf("<div", marker);
  return hero.slice(start);
};

// A page that has NOT opted in: plumbers content with its presentation and
// ticket data removed — what a future industry looks like before it opts in.
const { presentation: _p, hero: plumbersHero, ...restOfPlumbers } = PLUMBERS_PAGE;
void _p;
const { job_ticket: _t, ...heroWithoutTicket } = plumbersHero;
void _t;
const DEFAULT_PAGE = { ...restOfPlumbers, hero: heroWithoutTicket };

// States Remy cannot guarantee from a call, and must never be shown as reached.
// Honest negations ("Nothing diagnosed", "not a diagnosis", "doesn’t diagnose") are allowed.
const UNSUPPORTED_STATE =
  /(?<!nothing |not a |doesn’t |does not |never |no )\b(booked|booking confirmed|confirmed booking|appointment confirmed|dispatched|diagnos(ed|is)|certif(ied|icate)|scheduled|reserved|in the diary|on the way|engineer assigned)\b/i;

// ── 1. Default rendering is preserved ──────────────────────────────

describe("an IndustryPage without presentation keeps the pre-Slice-1 rendering", () => {
  test("no presentation → summary card, indigo cues, no ticket or panel", () => {
    const html = renderView(DEFAULT_PAGE);
    const visual = visualOf(html);
    assert.match(visual, /data-hero-visual="summary_card"/);
    assert.match(visual, /data-summary-card/);
    assert.doesNotMatch(html, /data-hero-visual="(job_ticket|enquiry_panel)"/);
    assert.match(visual, /Call summary/);
    for (const row of DEFAULT_PAGE.hero.summary_card.rows) assert.ok(visual.includes(row.label), row.label);
    assert.ok(visual.includes(DEFAULT_PAGE.hero.summary_card.note));
    // Indigo cues, exactly as before.
    assert.match(visual, /ring-indigo-500\/20/);
    assert.match(heroOf(html), /bg-indigo-950 border-indigo-800 text-indigo-300/);
    assert.match(heroOf(html), /bg-indigo-400/);
    assert.doesNotMatch(heroOf(html), /cyan|amber/);
  });

  test("a variant without its data falls back to the summary card rather than rendering nothing", () => {
    const html = renderView({ ...DEFAULT_PAGE, presentation: { theme: "indigo", hero_visual: "job_ticket" } });
    assert.match(visualOf(html), /data-hero-visual="summary_card"/);
  });

  test("the hero variant changes ONLY the hero: everything after it renders identically with job_ticket or summary_card", () => {
    const after = (html) => html.slice(html.indexOf("data-pain-points"));
    const withTicket = renderView(PLUMBERS_PAGE);
    const withCard = renderView({ ...PLUMBERS_PAGE, presentation: { ...PLUMBERS_PAGE.presentation, hero_visual: "summary_card" } });
    assert.equal(after(withTicket), after(withCard));
    assert.notEqual(visualOf(withTicket), visualOf(withCard));
  });
});

// ── 2 & 3. The two pages opt in ────────────────────────────────────

describe("plumbers opts into the job ticket and electricians into the enquiry panel", () => {
  test("plumbers: cyan theme, job_ticket, ticket data present", () => {
    assert.equal(PLUMBERS_PAGE.presentation.theme, "cyan");
    assert.equal(PLUMBERS_PAGE.presentation.hero_visual, "job_ticket");
    assert.ok(PLUMBERS_PAGE.hero.job_ticket);
    const visual = visualOf(renderPage(PlumbersPage));
    assert.match(visual, /data-hero-visual="job_ticket"/);
    assert.doesNotMatch(visual, /data-summary-card|data-enquiry-types/);
    assert.match(visual, /ring-cyan-400\/30/);
    assert.match(visual, /Caller said: urgent/);
    assert.match(visual, /Leaking pipe under the kitchen sink/);
    assert.match(visual, /<blockquote/);
    assert.match(visual, /Booking request submitted — look out for the confirmation email/);
    assert.match(visual, /Illustrative — not a real caller/);
  });

  test("electricians: amber theme, enquiry_panel, panel data present and the highlighted type is one of the types", () => {
    assert.equal(ELECTRICIANS_PAGE.presentation.theme, "amber");
    assert.equal(ELECTRICIANS_PAGE.presentation.hero_visual, "enquiry_panel");
    const panel = ELECTRICIANS_PAGE.hero.enquiry_panel;
    assert.ok(panel);
    assert.ok(panel.enquiry_types.includes(panel.highlighted_type));
    const visual = visualOf(renderPage(ElectriciansPage));
    assert.match(visual, /data-hero-visual="enquiry_panel"/);
    assert.doesNotMatch(visual, /data-summary-card|<blockquote/);
    assert.match(visual, /ring-amber-400\/30/);
    assert.match(visual, /data-enquiry-types/);
    for (const type of panel.enquiry_types) assert.ok(visual.includes(type), type);
    assert.equal((visual.match(/data-active="true"/g) ?? []).length, 1);
    assert.match(visual, /as callers describe them — not a diagnosis/);
    assert.match(visual, /Details captured and sent to you in the call summary/);
    assert.match(visual, /Illustrative — not a real caller/);
  });

  test("the two heroes differ in geometry, not just colour: ticket vs panel markup", () => {
    const plumbers = visualOf(renderPage(PlumbersPage));
    const electricians = visualOf(renderPage(ElectriciansPage));
    assert.match(plumbers, /rounded-3xl/);
    assert.match(electricians, /rounded-xl/);
    assert.match(plumbers, /<blockquote/);
    assert.doesNotMatch(electricians, /<blockquote/);
    assert.match(electricians, /<ul[^>]*data-enquiry-types/);
    assert.doesNotMatch(plumbers, /data-enquiry-types/);
    // Different decorative strokes: a curve vs an orthogonal trace.
    assert.match(plumbers, /<path d="M0 120 C/);
    assert.match(electricians, /<path d="M224 20 H/);
  });

  test("the decorative SVGs are aria-hidden, pointer-inert and hidden below sm", () => {
    for (const html of [renderPage(PlumbersPage), renderPage(ElectriciansPage)]) {
      const visual = visualOf(html);
      const svgs = visual.match(/<svg[^>]*>/g) ?? [];
      assert.ok(svgs.length >= 2);
      for (const svg of svgs) assert.match(svg, /aria-hidden="true"/);
      assert.match(visual, /hidden sm:block pointer-events-none absolute/);
    }
  });
});

// ── 4 & 5. Trade-specific wording, no cross-leak ───────────────────

describe("each hero speaks for its own trade and never the other's", () => {
  const plumbersHeroText = textOf(heroOf(renderPage(PlumbersPage)));
  const electriciansHeroText = textOf(heroOf(renderPage(ElectriciansPage)));

  test("plumbers hero: plumbing wording present, electrician wording absent", () => {
    assert.match(plumbersHeroText, /Never Miss Another\s+Plumbing Job/);
    assert.match(plumbersHeroText, /burst-pipe/);
    assert.match(plumbersHeroText, /Leaking pipe under the kitchen sink/);
    assert.doesNotMatch(plumbersHeroText, /electric|socket|EV charger|rewire|consumer unit|Enquiry panel|On Site/i);
  });

  test("electricians hero: electrical wording present, plumbing wording absent", () => {
    assert.match(electriciansHeroText, /Every Electrical Enquiry,\s+Captured While You’re On Site/);
    assert.match(electriciansHeroText, /EV charger/);
    assert.match(electriciansHeroText, /Sockets & switches/);
    assert.match(electriciansHeroText, /Nothing diagnosed over the phone/);
    assert.doesNotMatch(electriciansHeroText, /plumb|pipe|sink|boiler|Incoming job|Caller said: urgent/i);
  });

  test("the two heroes share no bullet and no headline", () => {
    for (const b of PLUMBERS_PAGE.hero.bullets) assert.ok(!ELECTRICIANS_PAGE.hero.bullets.includes(b), b);
    assert.notEqual(PLUMBERS_PAGE.hero.headline, ELECTRICIANS_PAGE.hero.headline);
    assert.notEqual(PLUMBERS_PAGE.hero.headline_accent, ELECTRICIANS_PAGE.hero.headline_accent);
  });
});

// ── 6. Truthful state ──────────────────────────────────────────────

describe("neither hero claims a state Remy cannot guarantee", () => {
  test("no booked / confirmed / dispatched / diagnosed / certified in either rendered hero", () => {
    for (const Page of [PlumbersPage, ElectriciansPage]) {
      const hero = textOf(heroOf(renderPage(Page)));
      assert.doesNotMatch(hero, UNSUPPORTED_STATE, hero);
    }
  });

  test("each visual's status is a request or capture state, and the panel's caption disclaims diagnosis", () => {
    assert.match(PLUMBERS_PAGE.hero.job_ticket.status, /^Booking request submitted/);
    assert.match(ELECTRICIANS_PAGE.hero.enquiry_panel.status, /^Details captured/);
    assert.match(ELECTRICIANS_PAGE.hero.enquiry_panel.types_caption, /not a diagnosis/);
    assert.match(PLUMBERS_PAGE.hero.job_ticket.urgency_label, /^Caller said:/);
    // Premises is only ever what the caller said.
    const premises = ELECTRICIANS_PAGE.hero.enquiry_panel.rows.find((r) => r.label === "Premises");
    assert.match(premises.value, /only when the caller says so/);
  });

  test("no real person: no name-like row, no phone digits, no email address, no postcode", () => {
    for (const Page of [PlumbersPage, ElectriciansPage]) {
      const visual = textOf(visualOf(renderPage(Page)));
      assert.doesNotMatch(visual, /\b\d{3,}\b/, "no digit runs");
      assert.doesNotMatch(visual, /@|\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/, "no email or postcode");
      assert.doesNotMatch(visual, /\b(Mr|Mrs|Ms|Dr)\.? [A-Z]/);
    }
  });
});

// ── 7 & 8. CTAs, metadata and JSON-LD untouched by presentation ───

describe("presentation touches neither the CTAs nor SEO", () => {
  test("every CTA still points where it did, and stays indigo on both pages", () => {
    for (const [Page, page] of [[PlumbersPage, PLUMBERS_PAGE], [ElectriciansPage, ELECTRICIANS_PAGE]]) {
      const html = renderPage(Page);
      assert.equal(page.hero.primary_cta.href, "/free-tools/business-opportunity-scan");
      assert.equal(page.scan.cta.href, "/free-tools/business-opportunity-scan");
      assert.equal(page.final_cta.cta.href, "/free-tools/business-opportunity-scan");
      assert.equal(page.hero.secondary_cta.href, "/");
      const primary = html.match(/<a [^>]*data-primary-cta[^>]*>/)[0];
      assert.match(primary, /bg-indigo-600/);
      assert.doesNotMatch(primary, /cyan|amber/);
      const scanCta = html.match(/<a [^>]*data-scan-cta[^>]*>/)[0];
      assert.match(scanCta, /bg-indigo-600/);
    }
  });

  test("metadata and JSON-LD are unchanged in shape and content", () => {
    assert.equal(plumbersMetadata.alternates.canonical, "/ai-receptionist-for-plumbers");
    assert.equal(electriciansMetadata.alternates.canonical, "/ai-receptionist-for-electricians");
    for (const [Page, page] of [[PlumbersPage, PLUMBERS_PAGE], [ElectriciansPage, ELECTRICIANS_PAGE]]) {
      const html = renderPage(Page);
      const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
      assert.equal(blocks.length, 1);
      const parsed = JSON.parse(blocks[0].replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""));
      const [webPage, faq] = parsed["@graph"];
      assert.equal(webPage["@type"], "WebPage");
      assert.equal(webPage.url, `https://niteowlhq.com${page.path}`);
      assert.equal(faq["@type"], "FAQPage");
      assert.equal(faq.mainEntity.length, page.faqs.length);
      assert.doesNotMatch(blocks[0], /presentation|job_ticket|enquiry_panel|theme/);
    }
  });

  test("the theme map is literal classes only — no runtime-built class names", () => {
    const view = stripComments(read("src/components/marketing/IndustryPageView.tsx"));
    const themeBlock = view.match(/const THEME[\s\S]*?\n\};/)[0];
    for (const cls of ["bg-cyan-950", "ring-cyan-400/30", "bg-amber-950", "ring-amber-400/30", "bg-indigo-950", "ring-indigo-500/20"]) {
      assert.ok(themeBlock.includes(cls), cls);
    }
    assert.doesNotMatch(view, /`(bg|text|ring|border)-\$\{/, "no interpolated Tailwind class prefix");
    assert.doesNotMatch(view, /"use client"|useState|useEffect/);
  });
});

// ── 9 & 10. Isolation ──────────────────────────────────────────────

describe("nothing under Remy core knows about presentation; the temp file is untouched", () => {
  test("no presentation, theme or hero-visual reference outside the marketing surface", () => {
    for (const file of [
      "src/lib/voice/assistant.ts",
      "src/lib/voice/calls.ts",
      "src/lib/voice/vapi.ts",
      "src/lib/voice/handler.ts",
      "src/app/page.tsx",
      "src/lib/site/publicRoutes.ts",
      "src/lib/site/structuredData.ts",
    ]) {
      const code = stripComments(read(file));
      assert.doesNotMatch(code, /job_ticket|enquiry_panel|IndustryTheme|IndustryPresentation|hero_visual/, file);
    }
  });

  test("the route files are unchanged thin mounts", () => {
    for (const file of ["src/app/ai-receptionist-for-plumbers/page.tsx", "src/app/ai-receptionist-for-electricians/page.tsx"]) {
      const src = stripComments(read(file));
      assert.match(src, /<IndustryPageView page=\{PAGE\} \/>/);
      assert.doesNotMatch(src, /presentation|theme|job_ticket|enquiry_panel/);
    }
  });

  test("supabase/.temp/cli-latest is not referenced by anything in this slice", () => {
    for (const file of ["src/components/marketing/IndustryPageView.tsx", "src/lib/site/industryPages.ts"]) {
      assert.doesNotMatch(read(file), /supabase/);
    }
  });
});
