// Industry landing page — AI Receptionist for Plumbers.
//
// A MARKETING surface for the one unchanged Remy. These tests prove the
// page is registered through the A-1 registry and discoverable, that
// every call to action resolves to a real existing route (the Scan's
// bare path, the homepage, the three problem pages), that it invents no
// customer, testimonial, statistic, figure or guarantee, that the
// illustrative call is labelled as such, that the FAQ JSON-LD is built
// from the same array the visible FAQ renders, and that nothing under
// it reaches Remy, a provider, a store or the Scan engines.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { PLUMBERS_PAGE } from "@/lib/site/industryPages";
import { PUBLIC_ROUTES, isPrivatePath, publicUrl } from "@/lib/site/publicRoutes";
import { PROBLEM_PAGES, SCAN_PATH } from "@/lib/site/problemPages";
import sitemap from "@/app/sitemap";
import PlumbersPage, { metadata } from "@/app/ai-receptionist-for-plumbers/page";

const FILES = [
  "src/lib/site/industryPages.ts",
  "src/components/marketing/IndustryPageView.tsx",
  "src/app/ai-receptionist-for-plumbers/page.tsx",
];

const read = (file) => readFileSync(file, "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const unescape = (html) =>
  html.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const render = () => unescape(renderToStaticMarkup(createElement(PlumbersPage)));
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");

const page = PLUMBERS_PAGE;
const ALL_TEXT = [
  page.title,
  page.description,
  page.hero.eyebrow,
  page.hero.headline,
  page.hero.headline_accent,
  page.hero.lead,
  ...page.hero.bullets,
  page.hero.summary_card.title,
  page.hero.summary_card.note,
  ...page.hero.summary_card.rows.flatMap((r) => [r.label, r.value]),
  ...(page.hero.job_ticket
    ? [page.hero.job_ticket.title, page.hero.job_ticket.urgency_label, page.hero.job_ticket.problem, page.hero.job_ticket.problem_caption, page.hero.job_ticket.status, page.hero.job_ticket.illustrative_note, ...page.hero.job_ticket.rows.flatMap((r) => [r.label, r.value])]
    : []),
  page.pain_points.heading,
  page.pain_points.lead,
  ...page.pain_points.items.flatMap((i) => [i.title, i.body]),
  ...(page.pain_points.timeline ? [...page.pain_points.timeline.stages.flatMap((s) => [s.title, s.body]), page.pain_points.timeline.outcome] : []),
  page.capabilities.heading,
  page.capabilities.lead,
  ...page.capabilities.items.flatMap((i) => [i.title, i.body, i.condition ?? ""]),
  page.example.heading,
  page.example.disclaimer,
  page.example.customer_says,
  ...page.example.remy_does,
  page.scan.heading,
  page.scan.lead,
  page.scan.promise,
  page.how_it_works.heading,
  ...page.how_it_works.steps.flatMap((s) => [s.title, s.body]),
  ...page.faqs.flatMap((f) => [f.q, f.a]),
  page.final_cta.heading,
  page.final_cta.lead,
];

// The same fabricated-claim guard the free-product pages are held to,
// plus the marketing-specific inventions this page must not contain.
const FABRICATED_CLAIM =
  /\d+\s*%|£\s*\d|€\s*\d|\$\s*\d|businesses like yours|on average|typically (lose|save|recover)|customers (saved|recovered|gained)|(save|saved|recover|recovered|lost|losing)\s+(up to\s+)?[£€$]?\d|\b\d[\d,]*\s+(businesses|customers|clients|users|owners|plumbers|jobs|calls)\b|proven|guaranteed|guarantee|#1|number one|top[- ]rated|award|testimonial|case stud|customer reviews?|\breviews\b|star rating|\bratings?\b|near you|in (london|dublin|manchester|birmingham|galway|cork)\b|benchmark|industry average|most (businesses|plumbers)|jobs recovered|calls recovered|trusted by|used by|join \d/i;
const REAL_PERSON_OR_COMPANY = /\b(Ltd|Limited|Plumbing Ltd|& Sons?|Services Ltd)\b|"[^"]*"\s*[-—–]\s*[A-Z][a-z]+ [A-Z]/;
const UNSUPPORTED_FEATURE =
  /(?<!doesn’t |does not |never )transfers? (the|your|live) calls?|(?<!no )live transfer|call transfer|sms (reminder|confirmation)|text(s|ing)? (the )?customer|takes? payment|card payment|invoic|quote(s|d)? (the|a) (job|price)|dispatch|gps|tracks? (your )?van|multi-?staff|outlook|whatsapp|instagram|facebook messenger|integrat(es|ion) with (xero|quickbooks|servicem8|jobber)|24\/7 support|response time of|within \d+ (minutes|seconds)|instantly books|books? (it )?instantly|confirmed on the spot|booked on the spot/i;

// ── 1. Route, registry, sitemap ────────────────────────────────────

describe("the route exists and is registered publicly through the A-1 foundation", () => {
  test("the path is /ai-receptionist-for-plumbers and a page.tsx exists for it", () => {
    assert.equal(page.path, "/ai-receptionist-for-plumbers");
    assert.equal(page.slug, "ai-receptionist-for-plumbers");
    assert.ok(statSync("src/app/ai-receptionist-for-plumbers/page.tsx").isFile());
  });

  test("registered once in PUBLIC_ROUTES, present in the sitemap, not private", () => {
    assert.equal(PUBLIC_ROUTES.filter((r) => r.path === page.path).length, 1);
    assert.ok(sitemap().map((e) => e.url).includes(publicUrl(page.path)));
    assert.equal(isPrivatePath(page.path), false);
  });

  test("exactly two industry pages exist — plumbers and electricians — with no dynamic segment or CMS", () => {
    const src = stripComments(read("src/lib/site/industryPages.ts"));
    assert.equal((src.match(/: IndustryPage = \{/g) ?? []).length, 2);
    assert.doesNotMatch(src, /hvac|locksmith|garage|dentist|roofer/i);
    assert.equal(statSync("src/app/ai-receptionist-for-plumbers").isDirectory(), true);
    assert.equal(statSync("src/app/ai-receptionist-for-electricians").isDirectory(), true);
    assert.throws(() => statSync("src/app/industries"));
    assert.throws(() => statSync("src/app/ai-receptionist-for-[industry]"));
  });
});

// ── 2. Metadata ────────────────────────────────────────────────────

describe("metadata follows the site pattern and is truthful", () => {
  test("canonical, OpenGraph and Twitter agree with the title and description", () => {
    assert.equal(metadata.title, page.title);
    assert.equal(metadata.description, page.description);
    assert.equal(metadata.alternates.canonical, page.path);
    assert.equal(metadata.openGraph.url, publicUrl(page.path));
    assert.equal(metadata.openGraph.type, "website");
    assert.equal(metadata.openGraph.siteName, "NiteOwl HQ");
    assert.equal(metadata.openGraph.title, page.title);
    assert.equal(metadata.openGraph.description, page.description);
    assert.equal(metadata.twitter.title, page.title);
    assert.equal(metadata.twitter.description, page.description);
    assert.ok(page.description.length > 40 && page.description.length < 320);
  });

  test("the primary search theme is present and the keywords are the natural related terms only", () => {
    assert.match(page.title, /AI Receptionist for Plumbers/i);
    assert.ok(page.keywords.includes("AI receptionist for plumbers"));
    assert.ok(page.keywords.length <= 10, "no keyword stuffing");
    for (const k of page.keywords) assert.doesNotMatch(k, FABRICATED_CLAIM);
  });
});

// ── 3. Every CTA resolves to a real existing route ─────────────────

describe("every call to action resolves to a real, existing, public route", () => {
  const realPage = (p) => {
    const dir = p === "/" ? "src/app" : `src/app${p}`;
    return statSync(`${dir}/page.tsx`).isFile();
  };

  test("the Scan CTAs are the Scan's bare path — no query string, fragment or prefill", () => {
    for (const href of [page.hero.primary_cta.href, page.scan.cta.href, page.final_cta.cta.href]) {
      assert.equal(href, SCAN_PATH);
      assert.equal(href, "/free-tools/business-opportunity-scan");
      assert.ok(!href.includes("?") && !href.includes("#"));
    }
    assert.ok(realPage(SCAN_PATH));
  });

  test("the walkthrough CTA points at the homepage, where the walkthrough player lives", () => {
    assert.equal(page.hero.secondary_cta.href, "/");
    assert.ok(realPage("/"));
    assert.match(read("src/app/HeroDemo.tsx"), /RemyWalkthrough/);
  });

  test("the problem links are exactly the three A-2a pages", () => {
    assert.deepEqual(
      page.scan.problem_links.map((l) => l.href),
      Object.values(PROBLEM_PAGES).map((p) => p.path)
    );
    for (const l of page.scan.problem_links) assert.ok(realPage(l.href), l.href);
  });

  test("every href the rendered page emits is a real page or an in-page anchor", () => {
    const html = render();
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(hrefs.length > 0);
    for (const href of hrefs) {
      if (href.startsWith("#")) continue;
      assert.ok(href.startsWith("/"), `${href} is not a site-relative link`);
      assert.ok(!/^https?:|mailto:|tel:/.test(href));
      const bare = href.replace(/[?#].*$/, "");
      const isAuth = ["/login", "/signup"].includes(bare);
      assert.ok(
        isAuth ||
          statSync(`src/app${bare === "/" ? "" : bare}/page.tsx`).isFile() ||
          statSync(`src/app/(auth)${bare}/page.tsx`).isFile(),
        `${href} has no page`
      );
    }
    // Sign in / Start free trial live in the (auth) route group.
    assert.ok(statSync("src/app/(auth)/login/page.tsx").isFile());
    assert.ok(statSync("src/app/(auth)/signup/page.tsx").isFile());
  });
});

// ── 4. No invented proof, statistic, guarantee or unsupported feature ──

describe("the page invents nothing", () => {
  test("no statistic, figure, benchmark, testimonial, review, superlative or guarantee in any copy", () => {
    for (const text of ALL_TEXT) assert.doesNotMatch(text, FABRICATED_CLAIM, text);
    assert.doesNotMatch(textOf(render()), FABRICATED_CLAIM);
  });

  test("no customer name, plumbing company, logo or photo", () => {
    for (const text of ALL_TEXT) assert.doesNotMatch(text, REAL_PERSON_OR_COMPANY, text);
    const html = render();
    assert.doesNotMatch(html, /<img|<picture|<video|background-image|\.(png|jpe?g|webp|svg|mp4)"/i);
    assert.doesNotMatch(textOf(html), /\b(what our customers say|customer stories|trusted by|as seen in)\b/i);
  });

  test("no unsupported Remy feature is claimed", () => {
    for (const text of ALL_TEXT) assert.doesNotMatch(text, UNSUPPORTED_FEATURE, text);
  });

  test("Remy is never said to transfer a live call, promise a response time, or confirm a booking on the call", () => {
    const joined = ALL_TEXT.join("\n");
    assert.match(joined, /doesn’t transfer live calls/);
    assert.match(joined, /rather than promising a response time/);
    assert.match(joined, /booking request/);
    assert.match(joined, /once the booking is actually made/);
    assert.doesNotMatch(joined, /books? (the|your) (job|appointment) (there and then|on the call|immediately)/i);
  });

  test("conditional capabilities are stated as conditional", () => {
    const booking = page.capabilities.items.find((i) => i.condition);
    assert.ok(booking?.condition, "booking capability must carry its condition");
    assert.match(booking.condition, /Knowledge Base/);
    assert.match(booking.condition, /when your calendar is connected/);
    assert.match(page.hero.lead, /where booking is set up for your business/);
  });

  test("the call example is marked illustrative, names nobody, and is not presented as a transcript", () => {
    assert.match(page.example.eyebrow, /illustrative/i);
    assert.match(page.example.disclaimer, /not a real transcript/);
    assert.match(page.example.disclaimer, /not a real person/);
    assert.doesNotMatch(page.example.customer_says, /\b(my name is|it's [A-Z][a-z]+|this is [A-Z][a-z]+)\b/);
    const html = render();
    assert.match(html, /data-disclaimer/);
  });
});

// ── 5. Structured data ─────────────────────────────────────────────

describe("structured data is one block, built from the same content the page renders", () => {
  test("exactly one JSON-LD block: a WebPage plus a FAQPage from the visible FAQ array", () => {
    const html = render();
    const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
    assert.equal(blocks.length, 1);
    const parsed = JSON.parse(blocks[0].replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""));
    assert.equal(parsed["@context"], "https://schema.org");
    const [webPage, faq] = parsed["@graph"];
    assert.equal(webPage["@type"], "WebPage");
    assert.equal(webPage.url, publicUrl(page.path));
    assert.equal(webPage.isAccessibleForFree, true);
    assert.equal(webPage.publisher.name, "NiteOwl AI");
    assert.equal("@context" in webPage, false, "no nested @context inside @graph");
    assert.equal(faq["@type"], "FAQPage");
    assert.deepEqual(
      faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text]),
      page.faqs.map((f) => [f.q, f.a])
    );
    // The visible FAQ renders every question.
    for (const f of page.faqs) assert.ok(html.includes(f.q), f.q);
  });

  test("no rating, review, count, address, location or price about a business", () => {
    const html = render();
    const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
    assert.doesNotMatch(block, /"(aggregateRating|review|reviews|ratingValue|ratingCount|reviewCount|interactionStatistic|address|areaServed|geo|location|price|offers)"/);
    assert.doesNotMatch(block, /"@type":\s*"(AggregateRating|Review|Rating|LocalBusiness|Place|PostalAddress|Offer|SoftwareApplication)"/);
  });
});

// ── 6. Isolation: marketing only, one Remy ─────────────────────────

describe("the page reaches nothing that serves a tenant and changes nothing about Remy", () => {
  test("no client directive, state, clock beyond the footer year, request, storage, network, database or provider", () => {
    for (const file of FILES) {
      const code = stripComments(read(file));
      assert.doesNotMatch(code, /"use client"|useState|useEffect|useRef/, `${file} is client-side`);
      assert.doesNotMatch(code, /cookies\(|headers\(|document\.cookie|localStorage|sessionStorage|indexedDB|navigator\./, file);
      assert.doesNotMatch(code, /useSearchParams|searchParams|fetch\(|XMLHttpRequest|WebSocket/, file);
      assert.doesNotMatch(code, /@supabase|supabase|from\("|\.insert\(|\.select\(|after\(/i, file);
      assert.doesNotMatch(code, /gtag|analytics|plausible|posthog|hotjar|mixpanel|googletagmanager|clarity|fbq|pixel/i, file);
      assert.doesNotMatch(code, /<script[^>]+src=|https?:\/\/(?!niteowlhq\.com|schema\.org)/i, file);
      assert.doesNotMatch(code, /process\.env/, file);
    }
  });

  test("no Remy, voice, booking, lead, calendar, integration, auth or Scan-engine import", () => {
    for (const file of FILES) {
      const specifiers = (stripComments(read(file)).match(/from\s+["']([^"']+)["']/g) ?? []).join("\n");
      assert.doesNotMatch(
        specifiers,
        /lib\/(voice|leadCapture|booking|availability|calendar|integrations|auth|freetools|supabase|email|openai)|@\/app\//,
        `${file}: ${specifiers}`
      );
    }
    const content = stripComments(read("src/lib/site/industryPages.ts"));
    assert.match(content, /from "@\/lib\/site\/problemPages"/);
    assert.equal((content.match(/^import /gm) ?? []).length, 1, "the content module imports only the site's problem-page constants");
  });

  test("nothing is keyed by industry anywhere outside the marketing surface", () => {
    // ONE REMY: no voice, booking, lead, prompt, schema or settings code
    // knows the word "plumber" as a configuration key.
    for (const file of [
      "src/lib/voice/assistant.ts",
      "src/lib/voice/calls.ts",
      "src/lib/voice/vapi.ts",
      "src/lib/site/publicRoutes.ts",
    ]) {
      const code = stripComments(read(file));
      assert.doesNotMatch(code, /industry|vertical|PLUMBERS_PAGE|industryPages/i, file);
    }
  });

  test("no sign-up gate, form, input or contact capture on the page", () => {
    const html = render();
    assert.doesNotMatch(html, /<form|<input|<textarea|type="email"/i);
  });

  test("the page is deterministic apart from the footer year", () => {
    const strip = (h) => h.replace(/© \d{4}/, "© YEAR");
    assert.equal(strip(render()), strip(render()));
  });
});

// ── 7. Discoverability from the existing site ──────────────────────

describe("the homepage links to the page, and to no industry page that does not exist", () => {
  // The homepage mounts client components through extensionless relative
  // imports the test loader does not resolve, so it is read from SOURCE.
  const home = stripComments(read("src/app/page.tsx"));

  test("the Plumbers industry card and the footer both link to the live route", () => {
    assert.match(home, /label: "Plumbers", href: "\/ai-receptionist-for-plumbers"/);
    assert.match(home, /href="\/ai-receptionist-for-plumbers"/);
  });

  test("the high-visibility industry section below the hero lists exactly the live industry pages", () => {
    const block = home.match(/const INDUSTRY_PAGES = \[([\s\S]*?)\r?\n\];/);
    assert.ok(block, "INDUSTRY_PAGES constant present");
    const entries = [...block[1].matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
    // Plumbers first and unchanged, electricians second, nothing else.
    assert.deepEqual(entries, ["/ai-receptionist-for-plumbers", "/ai-receptionist-for-electricians"]);
    assert.match(block[1], /name: "Plumbers"/);
    assert.match(block[1], /cta: "Explore Remy for Plumbers"/);
    assert.match(block[1], /name: "Electricians"/);
    assert.match(block[1], /cta: "Explore Remy for Electricians"/);
    assert.doesNotMatch(block[1], /HVAC|Dentist|Roofer|Locksmith/i);
    assert.match(home, /Built for your industry/);
    assert.match(home, /INDUSTRY_PAGES\.map\(/);
    // The section sits directly after the hero and before "Perfect For".
    const hero = home.indexOf("<HeroDemo />");
    const section = home.indexOf("Built for your industry");
    const perfectFor = home.indexOf("Built for local businesses");
    assert.ok(hero < section && section < perfectFor);
  });

  test("no other industry is linked until its page exists — no placeholder routes", () => {
    const industryHrefs = [...home.matchAll(/href(?:=|: )"(\/ai-receptionist-for-[^"]+)"/g)].map((m) => m[1]);
    // Three links each: the industry section, the Perfect For card, the footer.
    assert.equal(industryHrefs.filter((h) => h === "/ai-receptionist-for-plumbers").length, 3);
    assert.equal(industryHrefs.filter((h) => h === "/ai-receptionist-for-electricians").length, 3);
    for (const href of industryHrefs) {
      assert.ok(["/ai-receptionist-for-plumbers", "/ai-receptionist-for-electricians"].includes(href), href);
      assert.ok(statSync(`src/app${href}/page.tsx`).isFile(), `${href} has no page`);
    }
    assert.match(home, /label: "Electricians", href: "\/ai-receptionist-for-electricians"/);
    assert.doesNotMatch(home, /label: "(HVAC|Dentists|Physiotherapists|Veterinary Clinics|Landscapers|Cleaning Services)", href/);
  });
});

// ── 8. FAQ heading — rendered from content, not the shared view ────

describe("the FAQ heading is the plumbers one, rendered from the content object", () => {
  test("the rendered plumbers page carries its own FAQ heading and not the electricians one", () => {
    const html = textOf(render());
    assert.match(html, /Questions plumbers ask about Remy/);
    assert.doesNotMatch(html, /Questions electricians ask about Remy/);
    assert.equal(page.faq_heading, "Questions plumbers ask about Remy");
  });

  test("the rendered plumbers page contains no electrical wording anywhere", () => {
    assert.doesNotMatch(textOf(render()), /electric/i);
  });
});

// ── 9. How-it-works — Slice 4a, trade-specific copy ───────────────
//
// Slice 4a differentiates the how-it-works section through the EXISTING
// per-page `how_it_works` field — no presentation variant, no union, no
// view branch. Step 1 stays canonical on both pages because the Scan it
// describes is the same unchanged nine questions for every visitor.

describe("the how-it-works section speaks to plumbers", () => {
  test("the heading and steps 2-4 carry plumbing vocabulary", () => {
    assert.match(page.how_it_works.heading, /plumbing/i);
    const [, ...rest] = page.how_it_works.steps;
    const joined = rest.flatMap((s) => [s.title, s.body]).join(" ");
    assert.match(joined, /plumbing/i);
    assert.match(joined, /call-outs?/i);
    assert.match(joined, /repairs|installations|servicing/i);
    assert.match(joined, /sink|roof|tools/i);
  });

  test("step 1 is the canonical Scan step, unchanged", () => {
    const [first] = page.how_it_works.steps;
    assert.match(first.title, /Run the free Business Opportunity Scan/);
    assert.match(first.body, /Nine questions, nothing stored, no account/);
  });

  test("there are exactly four steps and the eyebrow is the shared one", () => {
    assert.equal(page.how_it_works.steps.length, 4);
    assert.equal(page.how_it_works.eyebrow, "How it works");
  });

  test("no electrical vocabulary leaks into any plumbers copy", () => {
    for (const text of ALL_TEXT) {
      assert.doesNotMatch(text, /electric|consumer unit|EICR|rewire|EV charger/i, text);
    }
  });

  test("the steps claim nothing Remy does not do", () => {
    const joined = page.how_it_works.steps.flatMap((s) => [s.title, s.body]).join(" ");
    assert.doesNotMatch(joined, UNSUPPORTED_FEATURE);
    assert.doesNotMatch(joined, FABRICATED_CLAIM);
    // A booking is a REQUEST here; nothing is booked, confirmed or dispatched.
    assert.doesNotMatch(
      joined,
      /(?<!nothing |not a |doesn.t |does not |never |no )\b(booked|confirmed|dispatched|diagnos(ed|is)|certif(ied|icate)|scheduled|on the way|will attend|guaranteed)\b/i
    );
    assert.match(joined, /booking request/i);
  });

  test("the FAQ is untouched by Slice 4a — seven entries, unchanged booking clauses", () => {
    assert.equal(page.faqs.length, 7);
    const booking = page.faqs.find((f) => /book/i.test(f.q));
    assert.match(booking.a, /submits a booking request after the call/);
    assert.match(booking.a, /once the booking is actually made/);
    assert.match(booking.a, /rather than confirming it/);
  });

  test("the rendered page shows the plumbing how-it-works heading", () => {
    assert.match(textOf(render()), /From free scan to answered plumbing calls/);
  });
});

// ── 10. FAQ — Slice 4b, trade-specific copy ──────────────────
//
// Slice 4b differentiates FAQ 1, 3 and 6 through the EXISTING per-page
// `faqs` field. FAQ 2 keeps its trade-specific safety wording; FAQ 4, 5
// and 7 stay byte-identical across pages on purpose, because each
// describes ONE product behaviour. The capability clauses inside the
// differentiated answers are MOVED, never rewritten.

// The canonical clause blocks Slice 4b moved VERBATIM rather than rewrote.
// A paraphrase here is the defect these constants exist to catch.
const BOOKING_CLAUSES =
  "Once a caller gives a day and time, Remy checks it against your business hours and availability, offers alternatives if that slot is taken, and submits a booking request after the call. The customer receives a confirmation email once the booking is actually made, and it appears in your dashboard — and in Google Calendar when your calendar is connected. If a caller asks for something you don’t list, Remy takes the details and passes the request to you rather than confirming it.";
const HOURS_CLAUSES =
  "Remy answers whenever the call comes in, day or night. The appointment times it offers respect the business hours you set, and any after-hours enquiry is waiting in your dashboard and your summary email. Remy doesn’t transfer live calls and doesn’t promise a response time — it tells the caller the team will be in touch as quickly as possible.";
// Remy submits a booking REQUEST. It never books, confirms, holds or reserves.
const BOOKS_IT_ITSELF =
  /Remy books|books the job|books it for you|confirms the (booking|appointment)|holds? the slot|reserves the (slot|time)|guarantees? (a|the) (slot|visit|time)/i;

describe("the plumbers FAQ is trade-specific where it should be, and truthful throughout", () => {
  test("there are exactly seven FAQs, in the established order", () => {
    assert.equal(page.faqs.length, 7);
    const stems = page.faqs.map((f) => f.q);
    assert.match(stems[0], /answer the phone|answer calls/i);
    assert.match(stems[1], /urgent plumbing problem/i);
    assert.match(stems[2], /booking requests/i);
    assert.match(stems[3], /control what Remy tells customers/i);
    assert.match(stems[4], /cannot answer something/i);
    assert.match(stems[5], /outside normal hours/i);
    assert.match(stems[6], /existing business phone number/i);
  });

  test("the canonical booking clauses are present character-for-character", () => {
    const booking = page.faqs[2];
    assert.ok(booking.a.includes(BOOKING_CLAUSES), "booking clauses were paraphrased");
  });

  test("the booking FAQ asks about booking REQUESTS and never claims Remy books or confirms", () => {
    const booking = page.faqs[2];
    assert.match(booking.q, /booking requests/i);
    assert.doesNotMatch(booking.q, BOOKS_IT_ITSELF);
    assert.doesNotMatch(booking.a, BOOKS_IT_ITSELF);
    assert.match(booking.a, /submits a booking request after the call/);
    assert.match(booking.a, /once the booking is actually made/);
    assert.match(booking.a, /rather than confirming it/);
  });

  test("the out-of-hours answer carries the no-transfer / no-response-time clause", () => {
    const hours = page.faqs[5];
    assert.ok(hours.a.includes(HOURS_CLAUSES), "out-of-hours clauses were paraphrased");
    assert.match(hours.a, /doesn’t transfer live calls/);
    assert.match(hours.a, /doesn’t promise a response time/);
  });

  test("the emergency wording survives — 999 is still told to hang up and call", () => {
    assert.ok(page.faqs.some((f) => /hang up and call 999/.test(f.a)));
  });

  test("the dedicated-number answer takes DETAILS, never the job itself", () => {
    const first = page.faqs[0];
    assert.match(first.a, /takes the job details and customer details/);
    assert.doesNotMatch(first.a, /takes the job and customer details/);
    assert.match(first.a, /a dedicated phone number set up for your business/);
  });

  test("the differentiated answers carry plumbing framing", () => {
    const joined = [page.faqs[0], page.faqs[2], page.faqs[5]].map((f) => f.q + " " + f.a).join(" ");
    assert.match(joined, /burst-pipe|sink|leak|call-out/i);
  });

  test("no electrical vocabulary appears anywhere in the plumbers FAQ", () => {
    for (const f of page.faqs) {
      assert.doesNotMatch(f.q + " " + f.a, /electric|consumer unit|EICR|rewire|EV charger|switchboard/i, f.q);
    }
  });

  test("no FAQ answer claims diagnosis, certification, dispatch, attendance or a confirmed booking", () => {
    const joined = page.faqs.map((f) => f.q + " " + f.a).join(" ");
    assert.doesNotMatch(joined, FABRICATED_CLAIM);
    assert.doesNotMatch(joined, UNSUPPORTED_FEATURE);
    assert.doesNotMatch(
      joined,
      /(?<!nothing |not a |doesn.t |does not |never |no |than )\b(booked|booking confirmed|confirmed booking|appointment confirmed|dispatched|diagnos(ed|is)|certif(ied|icate)|made safe|on the way|will attend|engineer assigned|guaranteed)\b/i
    );
  });

  test("FAQ 2, 4, 5 and 7 were not touched by Slice 4b", () => {
    assert.match(page.faqs[1].q, /Can Remy collect information about an urgent plumbing problem\?/);
    assert.match(page.faqs[1].a, /^Yes\. Remy asks what the problem is in the caller’s own words/);
    assert.equal(page.faqs[3].q, "Can I control what Remy tells customers?");
    assert.equal(page.faqs[4].q, "What happens if Remy cannot answer something?");
    assert.equal(page.faqs[6].q, "Do I need to change my existing business phone number?");
  });

  test("the rendered FAQ and its JSON-LD both carry the differentiated questions", () => {
    const html = render();
    for (const f of page.faqs) assert.ok(textOf(html).includes(f.q), f.q);
    assert.match(textOf(html), /booking requests for jobs in my week/);
  });
});
