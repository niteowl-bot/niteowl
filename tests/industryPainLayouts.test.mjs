// Industry landing pages — Slice 2: pain layouts, capability priority,
// copy differentiation.
//
// Slice 2 gives each industry page its own pain STORY (a timeline for
// plumbers, a domestic / commercial contrast for electricians), reorders
// the same five Remy capabilities to match the trade, and replaces the
// generic shared body copy with trade-specific wording — all through the
// same typed IndustryPage contract and the same shared view. These tests
// pin the two layouts, their structural difference, the capability
// order, the absence of cross-trade wording, the truthfulness rules, the
// untouched Slice 1 heroes, CTAs, SEO and homepage links, and that Remy
// core knows nothing about any of it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
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
// One <section> by its data attribute: from the attribute to the section
// close. Slice 3 reorders sections, so the next section can no longer be
// assumed.
const section = (html, from) => {
  const s = html.indexOf(from);
  const e = html.indexOf("</section>", s);
  assert.ok(s > 0 && e > s, `${from} section present`);
  return html.slice(s, e);
};
const painOf = (html) => section(html, "data-pain-points");
const capsOf = (html) => section(html, "data-capabilities");
const heroOf = (html) => section(html, "data-hero");

const PLUMBING = /plumb|pipe|sink|drain|hot water|boiler|leak|bathroom|tap\b/i;
const ELECTRICAL = /electric|socket|switch|lighting|rewire|consumer[- ]unit|EV charger|fit-out|board (keeps|that) trip|tripping/i;
// Remy must never be shown to have acted on the trade problem.
const REMY_ACTED =
  /(?<!nothing |not a |doesn’t |does not |never |no )\b(booked|confirmed booking|booking confirmed|dispatched|diagnos(ed|is)|certif(ied|icate)|repaired|fixed the|made safe|isolated the|tested the)\b/i;

// ── 1 & 2. Each page renders its own pain layout ───────────────────

describe("plumbers render the timeline pain story", () => {
  const pain = painOf(renderPage(PlumbersPage));

  test("opted in, rendered, four stages in order, outcome line, supporting cards beneath", () => {
    assert.equal(PLUMBERS_PAGE.presentation.pain_layout, "timeline");
    assert.match(pain, /data-pain-layout-mode="timeline"/);
    assert.match(pain, /data-pain-layout="timeline"/);
    assert.doesNotMatch(pain, /data-pain-layout="contrast"|data-contrast-columns/);
    const stages = PLUMBERS_PAGE.pain_points.timeline.stages;
    assert.equal(stages.length, 4);
    let last = -1;
    for (const stage of stages) {
      const at = pain.indexOf(stage.title);
      assert.ok(at > last, `stage in order: ${stage.title}`);
      last = at;
    }
    assert.equal((pain.match(/<li /g) ?? []).length, 4);
    assert.match(pain, /data-timeline-outcome/);
    assert.ok(pain.includes(PLUMBERS_PAGE.pain_points.timeline.outcome));
    // The supporting cards follow the story.
    for (const item of PLUMBERS_PAGE.pain_points.items) assert.ok(pain.indexOf(item.title) > last, item.title);
    assert.equal(PLUMBERS_PAGE.pain_points.items.length, 3);
  });

  test("the story is the business's problem, not a Remy action, and uses the cyan light cues", () => {
    for (const stage of PLUMBERS_PAGE.pain_points.timeline.stages) {
      assert.doesNotMatch(stage.title + " " + stage.body, /\bRemy\b/, stage.title);
      assert.doesNotMatch(stage.body, REMY_ACTED, stage.body);
    }
    assert.match(pain, /bg-cyan-600/);
    assert.match(pain, /bg-cyan-200/);
    assert.doesNotMatch(pain, /amber/);
  });

  test("the numbered markers carry the sequence without colour; the rail is decorative", () => {
    assert.match(pain, /font-mono[^>]*>1</);
    assert.match(pain, /font-mono[^>]*>4</);
    assert.match(pain, /aria-hidden="true"/);
  });
});

describe("electricians render the contrast pain story", () => {
  const pain = painOf(renderPage(ElectriciansPage));

  test("opted in, rendered, two columns, four enquiries each, a shared truth, supporting cards beneath", () => {
    assert.equal(ELECTRICIANS_PAGE.presentation.pain_layout, "contrast");
    assert.match(pain, /data-pain-layout-mode="contrast"/);
    assert.match(pain, /data-pain-layout="contrast"/);
    assert.match(pain, /data-contrast-columns/);
    assert.doesNotMatch(pain, /data-pain-layout="timeline"|data-timeline-outcome/);
    const { left, right, shared_truth } = ELECTRICIANS_PAGE.pain_points.contrast;
    assert.equal(left.title, "Domestic");
    assert.equal(right.title, "Commercial");
    assert.equal(left.enquiries.length, 4);
    assert.equal(right.enquiries.length, 4);
    for (const q of [...left.enquiries, ...right.enquiries]) assert.ok(pain.includes(q), q);
    assert.ok(pain.indexOf(left.title) < pain.indexOf(right.title));
    assert.match(pain, /data-contrast-truth/);
    assert.ok(pain.includes(shared_truth));
    const truthAt = pain.indexOf("data-contrast-truth");
    for (const item of ELECTRICIANS_PAGE.pain_points.items) assert.ok(pain.indexOf(item.title) > truthAt, item.title);
    assert.equal(ELECTRICIANS_PAGE.pain_points.items.length, 3);
  });

  test("the enquiries are quotations of what callers say — no diagnosis, no Remy action — with the amber light cues", () => {
    const { left, right } = ELECTRICIANS_PAGE.pain_points.contrast;
    for (const q of [...left.enquiries, ...right.enquiries]) {
      assert.doesNotMatch(q, /\bRemy\b/, q);
      assert.doesNotMatch(q, REMY_ACTED, q);
    }
    assert.match(left.caption + right.caption, /tend to (describe|ask)/);
    assert.match(pain, /bg-amber-50 border-amber-200/);
    assert.match(pain, /text-amber-700/);
    assert.doesNotMatch(pain, /cyan/);
    // Column titles are plain text, so the contrast survives without colour.
    assert.match(pain, />Domestic</);
    assert.match(pain, />Commercial</);
  });
});

// ── 3. Structurally distinguishable ────────────────────────────────

describe("the two pain sections differ in structure, not just words", () => {
  test("timeline is an ordered list with numbered markers; contrast is a two-column grid of quoted lists", () => {
    const p = painOf(renderPage(PlumbersPage));
    const e = painOf(renderPage(ElectriciansPage));
    assert.match(p, /<ol class="relative grid grid-cols-1 lg:grid-cols-4/);
    assert.doesNotMatch(e, /<ol /);
    assert.match(e, /grid grid-cols-1 md:grid-cols-2[^"]*" data-contrast-columns/);
    assert.doesNotMatch(p, /md:grid-cols-2/);
    assert.match(e, /<ul class="space-y-2\.5"/);
    assert.doesNotMatch(p, /<ul class="space-y-2\.5"/);
  });

  test("a page with no pain_layout renders only the cards, as before", () => {
    const { presentation, ...rest } = PLUMBERS_PAGE;
    const cardsOnly = renderView({ ...rest, presentation: { theme: presentation.theme, hero_visual: presentation.hero_visual } });
    const pain = painOf(cardsOnly);
    assert.match(pain, /data-pain-layout-mode="cards"/);
    assert.doesNotMatch(pain, /data-pain-layout="|data-timeline-outcome|data-contrast-columns/);
    for (const item of PLUMBERS_PAGE.pain_points.items) assert.ok(pain.includes(item.title));
    // A variant without its data also falls back to cards.
    const { timeline: _t, ...painWithoutTimeline } = PLUMBERS_PAGE.pain_points;
    void _t;
    const fallback = painOf(renderView({ ...PLUMBERS_PAGE, pain_points: painWithoutTimeline }));
    assert.doesNotMatch(fallback, /data-pain-layout="timeline"/);
  });
});

// ── 4. Capability priority ─────────────────────────────────────────

describe("the same five capabilities, ordered for the trade", () => {
  const titles = (page) => page.capabilities.items.map((c) => c.title);

  test("plumbers: answer first, get a time checked second, capture third", () => {
    const t = titles(PLUMBERS_PAGE);
    assert.equal(t.length, 5);
    assert.match(t[0], /^Answers while your hands are full/);
    assert.match(t[1], /^Gets a time checked/);
    assert.match(t[2], /^Takes the job down/);
    assert.ok(PLUMBERS_PAGE.capabilities.items[1].condition, "the booking capability keeps its condition");
  });

  test("electricians: capture as described first, knowledge second, then answer, then a time checked", () => {
    const t = titles(ELECTRICIANS_PAGE);
    assert.equal(t.length, 5);
    assert.match(t[0], /^Captures the enquiry in the caller’s words/);
    assert.match(t[1], /^Answers the questions you get asked every day/);
    assert.match(t[2], /^Answers while you’re on site/);
    assert.match(t[3], /^Gets a time checked/);
    assert.ok(ELECTRICIANS_PAGE.capabilities.items[3].condition, "the booking capability keeps its condition");
  });

  test("the rendered order follows the data and the two orders differ", () => {
    const p = capsOf(renderPage(PlumbersPage));
    const e = capsOf(renderPage(ElectriciansPage));
    const rendered = (html, page) => titles(page).map((t) => html.indexOf(t));
    for (const positions of [rendered(p, PLUMBERS_PAGE), rendered(e, ELECTRICIANS_PAGE)]) {
      assert.ok(positions.every((x) => x > 0));
      assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
    }
    assert.notDeepEqual(titles(PLUMBERS_PAGE), titles(ELECTRICIANS_PAGE));
    // Exactly one capability per page carries the booking condition, and it is the same condition text.
    const cond = (page) => page.capabilities.items.filter((c) => c.condition);
    assert.equal(cond(PLUMBERS_PAGE).length, 1);
    assert.equal(cond(ELECTRICIANS_PAGE).length, 1);
    assert.equal(cond(PLUMBERS_PAGE)[0].condition, cond(ELECTRICIANS_PAGE)[0].condition);
  });

  test("no capability was invented: the five map onto answering, capture, booking request, knowledge base, lead capture", () => {
    for (const page of [PLUMBERS_PAGE, ELECTRICIANS_PAGE]) {
      const bodies = page.capabilities.items.map((c) => c.body + " " + (c.condition ?? "")).join("\n");
      assert.match(bodies, /dedicated phone number/);
      assert.match(bodies, /confirmed callback number/);
      assert.match(bodies, /submits a booking request after the call/);
      assert.match(bodies, /confirmation email once the booking is actually made/);
      assert.match(bodies, /Knowledge Base you write and edit/);
      assert.match(bodies, /saved as a lead in your dashboard/);
      assert.match(bodies, /flagged for review/);
      assert.doesNotMatch(bodies, REMY_ACTED);
    }
  });
});

// ── 5 & 6. No cross-trade wording in the body ──────────────────────

describe("body copy belongs to its own trade", () => {
  const body = (Page) => {
    const html = renderPage(Page);
    return textOf(html.slice(html.indexOf("data-pain-points"), html.indexOf("data-scan")));
  };

  test("plumbers pain + capabilities + example carry plumbing wording and no electrical wording", () => {
    const text = body(PlumbersPage);
    assert.match(text, PLUMBING);
    assert.doesNotMatch(text, ELECTRICAL, text.match(ELECTRICAL)?.[0]);
  });

  test("electricians pain + capabilities + example carry electrical wording and no plumbing wording", () => {
    const text = body(ElectriciansPage);
    assert.match(text, ELECTRICAL);
    assert.doesNotMatch(text, PLUMBING, text.match(PLUMBING)?.[0]);
  });

  test("the formerly shared pain and capability copy is now differentiated", () => {
    const lines = (page) => [
      page.pain_points.heading,
      page.pain_points.lead,
      ...page.pain_points.items.flatMap((i) => [i.title, i.body]),
      page.capabilities.heading,
      page.capabilities.lead,
      ...page.capabilities.items.flatMap((i) => [i.title, i.body]),
    ];
    const p = lines(PLUMBERS_PAGE);
    const e = lines(ELECTRICIANS_PAGE);
    const shared = e.filter((l) => p.includes(l));
    // Only the eyebrow-level universals may still be shared (the "What Remy does" eyebrow is not in this list).
    assert.deepEqual(shared, [], `still byte-identical: ${JSON.stringify(shared)}`);
  });
});

// ── 7 & 8. Slice 1 heroes and truthfulness intact ─────────────────

describe("Slice 1 heroes did not regress and the truthfulness guards hold", () => {
  test("plumbers hero: job_ticket, cyan, headline, booking-request state", () => {
    const hero = heroOf(renderPage(PlumbersPage));
    assert.match(hero, /data-hero-visual="job_ticket"/);
    assert.match(hero, /ring-cyan-400\/30/);
    assert.match(textOf(hero), /Never Miss Another\s+Plumbing Job/);
    assert.match(hero, /Booking request submitted — look out for the confirmation email/);
    assert.doesNotMatch(textOf(hero), REMY_ACTED);
  });

  test("electricians hero: enquiry_panel, amber, headline, chips, no diagnosis, captured state", () => {
    const hero = heroOf(renderPage(ElectriciansPage));
    assert.match(hero, /data-hero-visual="enquiry_panel"/);
    assert.match(hero, /ring-amber-400\/30/);
    assert.match(textOf(hero), /Every Electrical Enquiry,\s+Captured While You’re On Site/);
    assert.equal((hero.match(/data-active="true"/g) ?? []).length, 1);
    assert.match(hero, /not a diagnosis/);
    assert.match(hero, /Details captured and sent to you in the call summary/);
    assert.doesNotMatch(textOf(hero), REMY_ACTED);
  });

  test("nowhere on either page is Remy said to have booked, dispatched, diagnosed, certified, repaired or made safe", () => {
    for (const Page of [PlumbersPage, ElectriciansPage]) {
      const text = textOf(renderPage(Page));
      assert.doesNotMatch(text, REMY_ACTED, text.match(REMY_ACTED)?.[0]);
    }
    assert.match(ELECTRICIANS_PAGE.capabilities.items[0].body, /doesn’t diagnose the fault/);
    assert.match(ELECTRICIANS_PAGE.capabilities.items[1].body, /never invents an answer or gives electrical advice/);
  });
});

// ── 9–13. CTAs, SEO, homepage, page count, Remy core ──────────────

describe("everything outside the body is unchanged", () => {
  test("CTA destinations", () => {
    for (const [Page, page] of [[PlumbersPage, PLUMBERS_PAGE], [ElectriciansPage, ELECTRICIANS_PAGE]]) {
      const html = renderPage(Page);
      const hrefs = [...html.matchAll(/<a [^>]*data-(primary-cta|secondary-cta|scan-cta|final-cta-link)[^>]*>/g)].map((m) => [m[1], m[0].match(/href="([^"]+)"/)[1]]);
      assert.deepEqual(hrefs, [
        ["primary-cta", "/free-tools/business-opportunity-scan"],
        ["secondary-cta", "/"],
        ["scan-cta", "/free-tools/business-opportunity-scan"],
        ["final-cta-link", "/free-tools/business-opportunity-scan"],
      ]);
      assert.equal(page.hero.primary_cta.href, "/free-tools/business-opportunity-scan");
    }
  });

  test("metadata, canonical and JSON-LD", () => {
    assert.equal(plumbersMetadata.alternates.canonical, "/ai-receptionist-for-plumbers");
    assert.equal(electriciansMetadata.alternates.canonical, "/ai-receptionist-for-electricians");
    assert.match(plumbersMetadata.title, /^AI Receptionist for Plumbers/);
    assert.match(electriciansMetadata.title, /^AI Receptionist for Electricians/);
    for (const [Page, page] of [[PlumbersPage, PLUMBERS_PAGE], [ElectriciansPage, ELECTRICIANS_PAGE]]) {
      const html = renderPage(Page);
      const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
      assert.equal(blocks.length, 1);
      const [webPage, faq] = JSON.parse(blocks[0].replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""))["@graph"];
      assert.equal(webPage["@type"], "WebPage");
      assert.equal(webPage.url, `https://niteowlhq.com${page.path}`);
      assert.equal(faq["@type"], "FAQPage");
      assert.equal(faq.mainEntity.length, page.faqs.length);
      assert.doesNotMatch(blocks[0], /pain_layout|timeline|contrast/);
    }
  });

  test("homepage industry links: three per industry, nothing else", () => {
    const home = stripComments(read("src/app/page.tsx"));
    const hrefs = [...home.matchAll(/href(?:=|: )"(\/ai-receptionist-for-[^"]+)"/g)].map((m) => m[1]);
    assert.equal(hrefs.filter((h) => h === "/ai-receptionist-for-plumbers").length, 3);
    assert.equal(hrefs.filter((h) => h === "/ai-receptionist-for-electricians").length, 3);
    assert.equal(hrefs.length, 6);
    assert.doesNotMatch(home, /pain_layout|timeline|contrast/);
  });

  test("exactly two industry pages", () => {
    const dirs = readdirSync("src/app").filter((d) => d.startsWith("ai-receptionist-for-") && statSync(`src/app/${d}`).isDirectory());
    assert.deepEqual(dirs.sort(), ["ai-receptionist-for-electricians", "ai-receptionist-for-plumbers"]);
    assert.equal((stripComments(read("src/lib/site/industryPages.ts")).match(/: IndustryPage = \{/g) ?? []).length, 2);
  });

  test("no Remy runtime or core file knows about pain layouts, and the theme map stays literal", () => {
    for (const file of [
      "src/lib/voice/assistant.ts",
      "src/lib/voice/calls.ts",
      "src/lib/voice/vapi.ts",
      "src/lib/voice/handler.ts",
      "src/lib/site/publicRoutes.ts",
      "src/lib/site/structuredData.ts",
      "src/app/ai-receptionist-for-plumbers/page.tsx",
      "src/app/ai-receptionist-for-electricians/page.tsx",
    ]) {
      assert.doesNotMatch(stripComments(read(file)), /pain_layout|IndustryPainLayout|PainTimeline|PainContrast/, file);
    }
    const view = stripComments(read("src/components/marketing/IndustryPageView.tsx"));
    assert.doesNotMatch(view, /`(bg|text|ring|border)-\$\{/);
    assert.doesNotMatch(view, /"use client"|useState|useEffect/);
    for (const cls of ["bg-cyan-600", "bg-cyan-200", "bg-amber-50 border-amber-200", "text-amber-700", "bg-indigo-50 border-indigo-200"]) {
      assert.ok(view.includes(cls), cls);
    }
  });
});
