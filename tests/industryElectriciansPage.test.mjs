// Industry landing page — AI Receptionist for Electricians.
//
// The second industry MARKETING page for the one unchanged Remy, built
// as one more content constant rendered by the same IndustryPageView
// the plumbers page uses. These tests prove the page is registered and
// discoverable, that its copy is electrician-specific, that every CTA
// resolves to a real route with the Scan as the primary acquisition
// path, that it invents no proof, guarantee or unsupported feature —
// in particular that it never claims Remy diagnoses electrical faults —
// that its JSON-LD is built from the visible FAQ, and that the plumbers
// page is untouched by its existence.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { ELECTRICIANS_PAGE, PLUMBERS_PAGE } from "@/lib/site/industryPages";
import { PUBLIC_ROUTES, isPrivatePath, publicUrl } from "@/lib/site/publicRoutes";
import { PROBLEM_PAGES, SCAN_PATH } from "@/lib/site/problemPages";
import sitemap from "@/app/sitemap";
import ElectriciansPage, { metadata } from "@/app/ai-receptionist-for-electricians/page";

const read = (file) => readFileSync(file, "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const unescape = (html) =>
  html.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const render = () => unescape(renderToStaticMarkup(createElement(ElectriciansPage)));
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");

const page = ELECTRICIANS_PAGE;
const allText = (p) => [
  p.title,
  p.description,
  p.hero.eyebrow,
  p.hero.headline,
  p.hero.headline_accent,
  p.hero.lead,
  ...p.hero.bullets,
  p.hero.summary_card.title,
  p.hero.summary_card.note,
  ...p.hero.summary_card.rows.flatMap((r) => [r.label, r.value]),
  ...(p.hero.job_ticket
    ? [p.hero.job_ticket.title, p.hero.job_ticket.urgency_label, p.hero.job_ticket.problem, p.hero.job_ticket.problem_caption, p.hero.job_ticket.status, p.hero.job_ticket.illustrative_note, ...p.hero.job_ticket.rows.flatMap((r) => [r.label, r.value])]
    : []),
  ...(p.hero.enquiry_panel
    ? [p.hero.enquiry_panel.title, p.hero.enquiry_panel.types_caption, ...p.hero.enquiry_panel.enquiry_types, p.hero.enquiry_panel.status, p.hero.enquiry_panel.illustrative_note, ...p.hero.enquiry_panel.rows.flatMap((r) => [r.label, r.value])]
    : []),
  p.pain_points.heading,
  p.pain_points.lead,
  ...p.pain_points.items.flatMap((i) => [i.title, i.body]),
  ...(p.pain_points.timeline ? [...p.pain_points.timeline.stages.flatMap((s) => [s.title, s.body]), p.pain_points.timeline.outcome] : []),
  ...(p.pain_points.contrast
    ? [p.pain_points.contrast.left.title, p.pain_points.contrast.left.caption, ...p.pain_points.contrast.left.enquiries, p.pain_points.contrast.right.title, p.pain_points.contrast.right.caption, ...p.pain_points.contrast.right.enquiries, p.pain_points.contrast.shared_truth]
    : []),
  p.capabilities.heading,
  p.capabilities.lead,
  ...p.capabilities.items.flatMap((i) => [i.title, i.body, i.condition ?? ""]),
  p.example.heading,
  p.example.disclaimer,
  p.example.customer_says,
  ...p.example.remy_does,
  p.scan.heading,
  p.scan.lead,
  p.scan.promise,
  p.how_it_works.heading,
  ...p.how_it_works.steps.flatMap((s) => [s.title, s.body]),
  ...p.faqs.flatMap((f) => [f.q, f.a]),
  p.final_cta.heading,
  p.final_cta.lead,
];
const ALL_TEXT = allText(page);

// The same guards the plumbers page is held to.
const FABRICATED_CLAIM =
  /\d+\s*%|£\s*\d|€\s*\d|\$\s*\d|businesses like yours|on average|typically (lose|save|recover)|customers (saved|recovered|gained)|(save|saved|recover|recovered|lost|losing)\s+(up to\s+)?[£€$]?\d|\b\d[\d,]*\s+(businesses|customers|clients|users|owners|electricians|jobs|calls)\b|proven|guaranteed|guarantee|#1|number one|top[- ]rated|award|testimonial|case stud|customer reviews?|\breviews\b|star rating|\bratings?\b|near you|in (london|dublin|manchester|birmingham|galway|cork)\b|benchmark|industry average|most (businesses|electricians)|jobs recovered|calls recovered|trusted by|used by|join \d/i;
const UNSUPPORTED_FEATURE =
  /(?<!doesn’t |does not |never )transfers? (the|your|live) calls?|(?<!no )live transfer|call transfer|sms (reminder|confirmation)|text(s|ing)? (the )?customer|takes? payment|card payment|invoic|quote(s|d)? (the|a) (job|price)|dispatch|gps|tracks? (your )?van|multi-?staff|outlook|whatsapp|instagram|facebook messenger|integrat(es|ion) with (xero|quickbooks|servicem8|jobber)|24\/7 support|response time of|within \d+ (minutes|seconds)|instantly books|books? (it )?instantly|confirmed on the spot|booked on the spot|emergency (call-?out|response) (guaranteed|within)/i;
// Remy must never be said to diagnose, test, certify or make safe electrical work.
const ELECTRICAL_EXPERTISE_CLAIM =
  /(?<!doesn’t |does not |never |not |try to |or )(diagnos(es|e|ing) (the|your|electrical) fault|tells? (the caller|you|them) what(’|')s wrong|identif(y|ies) the fault|fault[- ]find|EICR|certif(y|ies|icate)|make(s)? (it )?safe|part p|isolat(es|e) the (supply|circuit)|test(s|ing) the (circuit|installation))/i;

// ── 1. Route, registry, sitemap ────────────────────────────────────

describe("the electricians route exists and is registered through the A-1 foundation", () => {
  test("the path is /ai-receptionist-for-electricians and a page.tsx exists for it", () => {
    assert.equal(page.path, "/ai-receptionist-for-electricians");
    assert.equal(page.slug, "ai-receptionist-for-electricians");
    assert.ok(statSync("src/app/ai-receptionist-for-electricians/page.tsx").isFile());
  });

  test("registered once in PUBLIC_ROUTES, in the sitemap, not private; robots is untouched", () => {
    assert.equal(PUBLIC_ROUTES.filter((r) => r.path === page.path).length, 1);
    assert.ok(sitemap().map((e) => e.url).includes(publicUrl(page.path)));
    assert.equal(isPrivatePath(page.path), false);
    assert.doesNotMatch(stripComments(read("src/app/robots.ts")), /electric/i);
  });

  test("the page mounts the shared IndustryPageView with the electricians constant and nothing bespoke", () => {
    const src = stripComments(read("src/app/ai-receptionist-for-electricians/page.tsx"));
    assert.match(src, /import IndustryPageView from "@\/components\/marketing\/IndustryPageView"/);
    assert.match(src, /ELECTRICIANS_PAGE/);
    assert.match(src, /<IndustryPageView page=\{PAGE\} \/>/);
    assert.ok(src.split("\n").length < 60, "the route file is a thin mount");
  });
});

// ── 2. Metadata ────────────────────────────────────────────────────

describe("metadata follows the site pattern and is electrician-specific", () => {
  test("canonical, OpenGraph and Twitter agree with the title and description", () => {
    assert.equal(metadata.title, page.title);
    assert.equal(metadata.description, page.description);
    assert.equal(metadata.alternates.canonical, page.path);
    assert.equal(metadata.openGraph.url, publicUrl(page.path));
    assert.equal(metadata.openGraph.type, "website");
    assert.equal(metadata.openGraph.siteName, "NiteOwl HQ");
    assert.equal(metadata.openGraph.title, page.title);
    assert.equal(metadata.twitter.title, page.title);
    assert.ok(page.description.length > 40 && page.description.length < 320);
  });

  test("the primary search theme is present, keywords are few and truthful", () => {
    assert.match(page.title, /AI Receptionist for Electricians/i);
    assert.ok(page.keywords.includes("AI receptionist for electricians"));
    assert.ok(page.keywords.length <= 10);
    for (const k of page.keywords) assert.doesNotMatch(k, FABRICATED_CLAIM);
  });
});

// ── 3. Electrician-specific content ────────────────────────────────

describe("the copy speaks to electrical contractors, not plumbers", () => {
  test("hero, pain points, example and FAQ are electrician-specific", () => {
    assert.match(page.hero.eyebrow, /electricians/i);
    assert.match(page.hero.headline + " " + page.hero.headline_accent, /Electrical Enquiry/);
    assert.match(page.hero.headline_accent, /On Site/);
    assert.match(page.pain_points.heading, /Electrical Enquiries/);
    assert.match(page.example.customer_says, /sockets|board|tripping/i);
    assert.ok(page.faqs.some((f) => /electrical fault/i.test(f.q)));
    assert.match(page.scan.heading, /Electrical Business/);
    assert.match(page.final_cta.heading, /Electrical Business/);
  });

  test("no plumbing wording leaked in from the pattern", () => {
    for (const text of ALL_TEXT) assert.doesNotMatch(text, /plumb|boiler|leaking pipe|kitchen sink/i, text);
  });

  test("the service categories named are general and expressed as the caller's own words", () => {
    const capture = page.capabilities.items.find((i) => /Captures the enquiry/i.test(i.title));
    assert.match(capture.body, /as the caller describes it/);
    for (const term of ["tripping board", "dead socket", "flickering light", "rewire", "consumer-unit", "EV charger"]) {
      assert.match(capture.body, new RegExp(term, "i"), term);
    }
  });

  test("the structure is identical to the plumbers page — same sections, same counts", () => {
    assert.equal(page.hero.bullets.length, PLUMBERS_PAGE.hero.bullets.length);
    assert.equal(page.hero.summary_card.rows.length, PLUMBERS_PAGE.hero.summary_card.rows.length);
    assert.equal(page.capabilities.items.length, PLUMBERS_PAGE.capabilities.items.length);
    assert.equal(page.how_it_works.steps.length, PLUMBERS_PAGE.how_it_works.steps.length);
    assert.equal(page.faqs.length, PLUMBERS_PAGE.faqs.length);
    assert.deepEqual(page.scan.problem_links, PLUMBERS_PAGE.scan.problem_links);
  });
});

// ── 4. CTAs ────────────────────────────────────────────────────────

describe("every call to action resolves to a real route; the Scan is the primary path", () => {
  test("the Scan CTAs are the Scan's bare path", () => {
    for (const href of [page.hero.primary_cta.href, page.scan.cta.href, page.final_cta.cta.href]) {
      assert.equal(href, SCAN_PATH);
      assert.equal(href, "/free-tools/business-opportunity-scan");
    }
    assert.ok(statSync("src/app/free-tools/business-opportunity-scan/page.tsx").isFile());
  });

  test("the walkthrough CTA reuses the plumbers page's destination — no new mechanism", () => {
    assert.equal(page.hero.secondary_cta.href, PLUMBERS_PAGE.hero.secondary_cta.href);
    assert.equal(page.hero.secondary_cta.href, "/");
  });

  test("the problem links are exactly the three A-2a pages", () => {
    assert.deepEqual(
      page.scan.problem_links.map((l) => l.href),
      Object.values(PROBLEM_PAGES).map((p) => p.path)
    );
  });

  test("every href the rendered page emits is a real page", () => {
    const html = render();
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(hrefs.length > 0);
    for (const href of hrefs) {
      if (href.startsWith("#")) continue;
      const bare = href.replace(/[?#].*$/, "");
      const ok =
        ["/login", "/signup"].includes(bare) ||
        statSync(`src/app${bare === "/" ? "" : bare}/page.tsx`).isFile();
      assert.ok(ok, `${href} has no page`);
    }
  });
});

// ── 5. Truthfulness ────────────────────────────────────────────────

describe("the page invents nothing and claims no electrical expertise", () => {
  test("no statistic, figure, testimonial, review, superlative or guarantee", () => {
    for (const text of ALL_TEXT) assert.doesNotMatch(text, FABRICATED_CLAIM, text);
    assert.doesNotMatch(textOf(render()), FABRICATED_CLAIM);
  });

  test("no unsupported Remy feature is claimed", () => {
    for (const text of ALL_TEXT) assert.doesNotMatch(text, UNSUPPORTED_FEATURE, text);
  });

  test("Remy is never said to diagnose, test, certify or make safe electrical work", () => {
    for (const text of ALL_TEXT) assert.doesNotMatch(text, ELECTRICAL_EXPERTISE_CLAIM, text);
    const joined = ALL_TEXT.join("\n");
    assert.match(joined, /doesn’t diagnose/);
    assert.match(joined, /doesn’t try to diagnose the fault/);
  });

  test("booking is a request, urgency is not a promise, live calls are not transferred, 999 for emergencies", () => {
    const joined = ALL_TEXT.join("\n");
    assert.match(joined, /booking request/);
    assert.match(joined, /once the booking is actually made/);
    assert.match(joined, /doesn’t transfer live calls/);
    assert.match(joined, /doesn’t promise a response time/);
    assert.match(joined, /hang up and call 999/);
    const booking = page.capabilities.items.find((i) => i.condition);
    assert.match(booking.condition, /Knowledge Base/);
    assert.match(booking.condition, /when your calendar is connected/);
  });

  test("the call example is marked illustrative and names nobody; no images", () => {
    assert.match(page.example.eyebrow, /illustrative/i);
    assert.match(page.example.disclaimer, /not a real transcript/);
    assert.match(page.example.disclaimer, /not a real person/);
    const html = render();
    assert.match(html, /data-disclaimer/);
    assert.doesNotMatch(html, /<img|<picture|<video|<form|<input/i);
  });
});

// ── 6. Structured data ─────────────────────────────────────────────

describe("structured data is one block built from the visible FAQ", () => {
  test("WebPage plus FAQPage from the same array; no rating, review, offer or location", () => {
    const html = render();
    const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
    assert.equal(blocks.length, 1);
    const parsed = JSON.parse(blocks[0].replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""));
    const [webPage, faq] = parsed["@graph"];
    assert.equal(webPage["@type"], "WebPage");
    assert.equal(webPage.url, publicUrl(page.path));
    assert.equal(faq["@type"], "FAQPage");
    assert.deepEqual(
      faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text]),
      page.faqs.map((f) => [f.q, f.a])
    );
    assert.doesNotMatch(blocks[0], /"(aggregateRating|review|ratingValue|address|areaServed|geo|location|price|offers)"/);
  });
});

// ── 7. Isolation — one Remy, plumbers untouched ────────────────────

describe("one Remy: nothing is keyed by industry, and the plumbers page is unchanged", () => {
  test("no Remy, voice, booking, lead, calendar, integration or auth code knows the industry", () => {
    for (const file of [
      "src/lib/voice/assistant.ts",
      "src/lib/voice/calls.ts",
      "src/lib/voice/vapi.ts",
      "src/components/marketing/IndustryPageView.tsx",
    ]) {
      const code = stripComments(read(file));
      assert.doesNotMatch(code, /electrician|ELECTRICIANS_PAGE|PLUMBERS_PAGE/i, file);
    }
  });

  test("the plumbers constant still reads as the plumbers page", () => {
    assert.equal(PLUMBERS_PAGE.path, "/ai-receptionist-for-plumbers");
    assert.match(PLUMBERS_PAGE.hero.headline_accent, /Plumbing/);
    for (const text of allText(PLUMBERS_PAGE)) assert.doesNotMatch(text, /electric/i, text);
  });
});

// ── 8. FAQ heading — rendered per industry, never hard-coded ───────
//
// The defect this pins: the shared view once carried the literal
// "Questions plumbers ask about Remy", so the electricians page rendered
// plumbing wording that no content-level test could see. The checks
// below read the RENDERED HTML of both pages and the view's source.

describe("the FAQ heading is rendered from each industry's content object", () => {
  test("the electricians page renders its own FAQ heading and no plumbing one", () => {
    const html = textOf(render());
    assert.match(html, /Questions electricians ask about Remy/);
    assert.doesNotMatch(html, /Questions plumbers ask about Remy/);
    assert.equal(page.faq_heading, "Questions electricians ask about Remy");
  });

  test("the rendered electricians page contains no plumbing wording anywhere", () => {
    assert.doesNotMatch(textOf(render()), /plumb|boiler|leaking pipe|kitchen sink/i);
  });

  test("the shared view carries no industry-specific FAQ heading — it reads page.faq_heading", () => {
    const view = stripComments(read("src/components/marketing/IndustryPageView.tsx"));
    assert.match(view, /\{page\.faq_heading\}/);
    assert.doesNotMatch(view, /Questions (plumbers|electricians|[a-z]+) ask about Remy/);
    assert.doesNotMatch(view, /plumb|electric/i);
  });
});
