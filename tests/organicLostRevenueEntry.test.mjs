// Organic Acquisition Engine — A-2b Lost Revenue entry page.
//
// A framing / entry page for /free-tools/lost-revenue that explains
// what the free Scan can and cannot size and sends the visitor into the
// UNCHANGED nine-question Scan. These tests prove the page calculates
// nothing, diagnoses nobody, carries no state, names no number, keeps
// the E1 assumption ideas pinned in prose, has exactly one CTA to the
// canonical Scan literal, is registered through the A-1 registry, and
// leaves the Scan contract, the A-2a pages and the anti-funnel
// behaviour exactly as they were.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  LOST_REVENUE_CTA_HREF,
  LOST_REVENUE_CTA_LABEL,
  LOST_REVENUE_DESCRIPTION,
  LOST_REVENUE_H1,
  LOST_REVENUE_HUB_LINK_LABEL,
  LOST_REVENUE_LEAD,
  LOST_REVENUE_PATH,
  LOST_REVENUE_PROBLEM_HEADLINE,
  LOST_REVENUE_PROBLEM_PAGE_PATH,
  LOST_REVENUE_PROMISE,
  LOST_REVENUE_SECTIONS,
  LOST_REVENUE_TITLE,
} from "@/lib/site/lostRevenuePage";
import { PUBLIC_ROUTES, isPrivatePath, publicUrl } from "@/lib/site/publicRoutes";
import { PROBLEM_PAGES, SCAN_PATH } from "@/lib/site/problemPages";
import { webPageJsonLd } from "@/lib/site/structuredData";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import LostRevenuePage, { metadata } from "@/app/free-tools/lost-revenue/page";
import FreeToolsPage from "@/app/free-tools/page";
import { SCAN_RECOMMENDATIONS } from "@/lib/freetools/scanRecommendations";
import { SCAN_QUESTIONS, SCAN_QUESTION_SET_VERSION } from "@/lib/freetools/scanQuestions";
import {
  SCAN_CLUSTER_RULE_SET_VERSION,
  SCAN_CONDITION_ORDER,
  SCAN_HYPOTHESIS_RULE_SET_VERSION,
  SCAN_PRIORITISATION_RULE_SET_VERSION,
  SCAN_RULE_SET_VERSION,
} from "@/lib/freetools/scanTypes";

const A2B_FILES = ["src/lib/site/lostRevenuePage.ts", "src/app/free-tools/lost-revenue/page.tsx"];

const read = (file) => readFileSync(file, "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const unescape = (html) =>
  html.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const render = () => unescape(renderToStaticMarkup(createElement(LostRevenuePage)));
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");

const ALL_TEXT = [
  LOST_REVENUE_TITLE,
  LOST_REVENUE_DESCRIPTION,
  LOST_REVENUE_H1,
  LOST_REVENUE_LEAD,
  LOST_REVENUE_PROMISE,
  LOST_REVENUE_HUB_LINK_LABEL,
  ...LOST_REVENUE_SECTIONS.flatMap((s) => [s.heading, ...s.paragraphs]),
];

const FABRICATED_CLAIM =
  /\d+\s*%|£\s*\d|€\s*\d|\$\s*\d|businesses like yours|on average|typically (lose|save|recover)|customers (saved|recovered|gained)|(save|saved|recover|recovered|lost|losing)\s+(up to\s+)?[£€$]?\d|\b\d[\d,]*\s+(businesses|customers|clients|users|owners)\b|proven|guaranteed|#1|number one|top[- ]rated|award|testimonial|case stud|customer reviews?|\breviews\b|star rating|\bratings?\b|near you|in (london|dublin|manchester|birmingham|galway|cork)\b|local(ly)? in\b|benchmark|industry average|most businesses/i;
const DIAGNOSIS =
  /you are losing|you're losing|you have (a|this) problem|your business (is|has|suffers)|because your|because you|root cause|is why you|the reason you|you are missing|you're missing|you told us|you will recover|you'll recover|you would recover|definitely/i;
const PRESSURE =
  /sign ?up|log ?in|pricing|free trial|start your trial|book a demo|limited time|act now|don't wait|only today|hurry|before it's too late|urgent|buy now|upgrade/i;

// ── 1. Route, registry, sitemap, robots ────────────────────────────

describe("the route exists, is registered publicly, and is discoverable through the A-1 foundation", () => {
  test("the path is /free-tools/lost-revenue and a page.tsx exists for it", () => {
    assert.equal(LOST_REVENUE_PATH, "/free-tools/lost-revenue");
    assert.ok(statSync("src/app/free-tools/lost-revenue/page.tsx").isFile());
  });

  test("registered in PUBLIC_ROUTES and present in the sitemap; not private", () => {
    assert.ok(PUBLIC_ROUTES.some((r) => r.path === LOST_REVENUE_PATH));
    assert.ok(sitemap().map((e) => e.url).includes(publicUrl(LOST_REVENUE_PATH)));
    assert.equal(isPrivatePath(LOST_REVENUE_PATH), false);
    assert.equal(PUBLIC_ROUTES.filter((r) => r.path.includes("lost-revenue")).length, 1);
  });

  test("no private route was exposed and robots is unchanged from A-1", () => {
    for (const e of sitemap()) {
      assert.equal(isPrivatePath(e.url.replace("https://niteowlhq.com", "") || "/"), false);
      assert.equal("lastModified" in e, false);
    }
    const r = robots();
    assert.deepEqual(r.rules.disallow, [
      "/dashboard", "/chat", "/leads", "/calendar", "/knowledge", "/settings", "/onboarding",
      "/admin", "/api", "/auth", "/login", "/signup", "/reset-password", "/forgot-password", "/booking",
    ]);
    assert.equal(r.rules.allow, "/");
    assert.equal(r.sitemap, "https://niteowlhq.com/sitemap.xml");
  });

  test("sitemap.ts and robots.ts were not given special logic", () => {
    for (const f of ["src/app/sitemap.ts", "src/app/robots.ts"]) {
      assert.doesNotMatch(stripComments(read(f)), /lost|revenue|LOST/i, f);
    }
  });

  test("it is not a fourth problem page: exactly three directories remain under problems/", () => {
    const dirs = readdirSync("src/app/free-tools/problems").filter((e) =>
      statSync(path.join("src/app/free-tools/problems", e)).isDirectory()
    );
    assert.equal(dirs.length, 3);
    assert.equal(Object.keys(PROBLEM_PAGES).length, 3);
  });
});

// ── 2. Server-only, stateless, identity-free, provider-free ────────

describe("the page is server-only, carries no state and reaches nothing", () => {
  test("no client directive, hooks, request API, storage, fetch, database, analytics, external host, form or clock", () => {
    for (const file of A2B_FILES) {
      const code = stripComments(read(file));
      assert.doesNotMatch(code, /["']use client["']/, `${file} is a client component`);
      assert.doesNotMatch(code, /useState|useEffect|useRouter|useSearchParams|searchParams|usePathname/, `${file} uses client hooks or request params`);
      assert.doesNotMatch(code, /cookies\(|headers\(|document\.|window\.|localStorage|sessionStorage|indexedDB|navigator\./, `${file} reaches a visitor mechanism`);
      assert.doesNotMatch(code, /fetch\(|XMLHttpRequest|WebSocket|@supabase|supabase|\.insert\(|after\(/i, `${file} reaches the network or a database`);
      assert.doesNotMatch(code, /gtag|analytics|plausible|posthog|segment|hotjar|mixpanel|googletagmanager|clarity|fbq|pixel/i, `${file} references analytics`);
      assert.doesNotMatch(code, /<script[^>]+src=|https?:\/\/(?!niteowlhq\.com|schema\.org)/i, `${file} loads or names an external host`);
      assert.doesNotMatch(code, /<form|<input|type="email"|mailto:/i, `${file} captures contact details`);
      assert.doesNotMatch(code, /Date\.now|new Date\(|Math\.random|crypto|randomUUID/i, `${file} reads a clock or generates ids`);
    }
  });

  test("no new package dependency", () => {
    const pkg = JSON.parse(read("package.json"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    assert.equal(deps.filter((d) => /seo|sitemap|analytics|tracking|gtag|posthog|plausible|mdx|markdown|cms|calculator/i.test(d)).length, 0);
  });
});

// ── 3. No Scan logic, no arithmetic, no thresholds ─────────────────

describe("the page calculates nothing and duplicates no Scan logic", () => {
  test("no engine call, no validator, no report builder, no engine-module import", () => {
    for (const file of A2B_FILES) {
      const code = stripComments(read(file));
      assert.doesNotMatch(code, /deriveFindings\(|computeLostRevenue\(|recommendFor\(|deriveHypotheses\(|buildScanReport\(|validateScanAnswers\(|prioritise\(|deriveClusters\(|deriveDependencies\(|deriveEvidenceGaps\(|classifyImpact\(/, `${file} calls a Scan engine`);
      assert.doesNotMatch(code, /scanLostRevenue|scanFindings|scanHypotheses|scanValidation|scanFunnel|scanClusters|scanPrioritisation|scanEvidenceGaps|scanImpactClass|E1_|CONVERSION_BUCKET|EstimateBasis/, `${file} imports or names sizing machinery`);
    }
  });

  test("no arithmetic, thresholds or answer comparisons", () => {
    // String literals (paths, prose) are removed first so a "/" inside a
    // route or a sentence is not mistaken for division.
    const stripStrings = (s) =>
      s.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
    for (const file of A2B_FILES) {
      const code = stripStrings(stripComments(read(file)));
      assert.doesNotMatch(
        code,
        /q[1-9]_[a-z_]+|answers\.|ScanAnswers|applies:|threshold|Math\.|[\w)\]]\s*[*\/%]\s*[\w(]|[\w)\]]\s+[+-]\s+[\w(]|>=\s*\d|<=\s*\d|===\s*\d/,
        `${file} computes or compares`
      );
    }
    // Reading the map twice yields the same static object.
    assert.deepEqual(LOST_REVENUE_SECTIONS, LOST_REVENUE_SECTIONS);
  });

  test("the content module imports only the recommendation constants and the site modules", () => {
    const specifiers = read("src/lib/site/lostRevenuePage.ts").match(/from\s+["']([^"']+)["']/g) ?? [];
    assert.deepEqual(specifiers.sort(), [
      'from "@/lib/freetools/scanRecommendations"',
      'from "@/lib/site/problemPages"',
    ]);
    const pageSpecifiers = read("src/app/free-tools/lost-revenue/page.tsx").match(/from\s+["']([^"']+)["']/g) ?? [];
    for (const s of pageSpecifiers) {
      assert.match(s, /["'](next|next\/link|@\/lib\/site\/(lostRevenuePage|publicRoutes|structuredData))["']/, s);
    }
  });
});

// ── 4. The Scan is untouched ───────────────────────────────────────

describe("the Scan contract, versions and surface are exactly as they were", () => {
  test("nine questions, six required, all versions v1", () => {
    assert.equal(SCAN_QUESTIONS.length, 9);
    assert.deepEqual(
      SCAN_QUESTIONS.filter((q) => q.required).map((q) => q.id),
      ["q1_channels", "q2_reachable", "q3_enquiries_per_week", "q5_miss_visibility", "q6_followup", "q7_messages_to_book"]
    );
    assert.equal(SCAN_QUESTION_SET_VERSION, "v1");
    assert.equal(SCAN_RULE_SET_VERSION, "v1");
    assert.equal(SCAN_PRIORITISATION_RULE_SET_VERSION, "v1");
    assert.equal(SCAN_CLUSTER_RULE_SET_VERSION, "v1");
    assert.equal(SCAN_HYPOTHESIS_RULE_SET_VERSION, "v1");
  });

  test("validateScanAnswers and buildScanReport are called from the Scan surface only", () => {
    const callers = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir)) {
        const full = path.join(dir, e);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(e) && /validateScanAnswers\(|buildScanReport\(/.test(stripComments(read(full)))) callers.push(full.replace(/\\/g, "/"));
      }
    };
    walk("src/app");
    walk("src/lib/site");
    assert.deepEqual(callers, ["src/app/free-tools/business-opportunity-scan/ScanClient.tsx"]);
  });

  test("the Scan surface still reads no entry mode, query or prefill", () => {
    const client = stripComments(read("src/app/free-tools/business-opportunity-scan/ScanClient.tsx"));
    assert.doesNotMatch(client, /useSearchParams|searchParams|prefill|[?&](mode|entry|problem|from|source|ref)=/i);
  });
});

// ── 5. CTA ─────────────────────────────────────────────────────────

describe("exactly one CTA, to the canonical Scan literal", () => {
  test("href deep-equals the Scan path with no query or hash", () => {
    assert.equal(LOST_REVENUE_CTA_HREF, "/free-tools/business-opportunity-scan");
    assert.equal(LOST_REVENUE_CTA_HREF, SCAN_PATH);
    assert.equal(LOST_REVENUE_CTA_LABEL, "Start the free Scan");
    const html = render();
    assert.equal((html.match(/data-scan-cta/g) ?? []).length, 1);
    assert.ok(html.includes(`href="${SCAN_PATH}"`));
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    const allowed = new Set([SCAN_PATH, "/free-tools", PROBLEM_PAGES["enquiry.unanswered"].path]);
    for (const h of hrefs) {
      assert.ok(allowed.has(h), `unexpected href ${h}`);
      assert.ok(!h.includes("?") && !h.includes("#"), `href carries state: ${h}`);
    }
    assert.equal(LOST_REVENUE_PROBLEM_PAGE_PATH, PROBLEM_PAGES["enquiry.unanswered"].path);
  });
});

// ── 6. Truthfulness ────────────────────────────────────────────────

describe("the page claims nothing, diagnoses nobody and presses nobody", () => {
  test("no fabricated statistic, benchmark, result, review or location; no diagnosis; no pressure", () => {
    const html = render();
    const text = textOf(html);
    for (const s of [text, ...ALL_TEXT]) {
      assert.doesNotMatch(s, FABRICATED_CLAIM, s.slice(0, 120));
      assert.doesNotMatch(s, DIAGNOSIS, s.slice(0, 120));
      assert.doesNotMatch(s, PRESSURE, s.slice(0, 120));
    }
    // No digit anywhere on the page: the only number a visitor sees is on the report.
    assert.doesNotMatch(text, /\d/, "the entry page states a number");
    // Never a "calculator" and never a measurement claim about the result.
    assert.doesNotMatch(text, /calculator|we measure|measured your|measures your/i);
    // Names no product, no purchase.
    assert.equal((text.match(/Remy/g) ?? []).length, 0);
    assert.doesNotMatch(html, /data-product|data-handoff|data-attribution/);
  });

  test("the H1 and lead are the approved framing", () => {
    assert.equal(LOST_REVENUE_H1, "Lost revenue from missed enquiries — what the free Scan can and can’t size");
    assert.match(LOST_REVENUE_LEAD, /never gets the chance to convert/);
    assert.match(LOST_REVENUE_LEAD, /range worked out from your own answers/);
    assert.match(LOST_REVENUE_LEAD, /says plainly when it cannot/);
    const html = render();
    assert.ok(html.includes(LOST_REVENUE_H1));
    assert.ok(html.includes(LOST_REVENUE_LEAD));
  });

  test("UNKNOWN is explicit and framed as a real answer", () => {
    const text = textOf(render());
    assert.match(text, /UNKNOWN/);
    assert.match(text, /a real answer, not a failure/);
    assert.match(text, /“Not sure” is a fine answer/);
    assert.match(text, /never counts against you/);
  });

  test("estimate-not-measurement is explicit", () => {
    const text = textOf(render());
    assert.match(text, /An estimate, not a measurement/);
    assert.match(text, /not a measurement of your business/);
    assert.match(text, /not a comparison with anyone else/);
    assert.match(text, /not a promise of what would come back/);
    assert.match(text, /assumptions behind it are shown alongside the number/);
  });

  test("the E1 assumption ideas are pinned in prose and cannot drift into a different economic claim", () => {
    const prose = LOST_REVENUE_SECTIONS.flatMap((s) => s.paragraphs).join(" ");
    // 1. Missed enquiries assumed to convert at about the same rate — and that this is generous.
    assert.match(prose, /assumed to have converted at about the same rate as the ones you answered/);
    assert.match(prose, /likely to be generous/);
    // 2. The visitor's own typical job value.
    assert.match(prose, /the value used is the typical job value you gave/);
    // 3. An estimate from the visitor's own answers, not a measurement.
    assert.match(prose, /works out a range from those answers alone/);
    assert.match(prose, /an estimate from what you told it/);
    // No rival economics: never "average", "typical business", a rate, a multiplier or a per-unit figure.
    assert.doesNotMatch(prose, /average (job|business|customer)|typical business|conversion rate of|multiplied|per (call|enquiry|lead)|times the/i);
    // The gates are described only in the terms §88.3 uses.
    assert.match(prose, /no way of knowing when an enquiry was missed/);
    assert.match(prose, /the counts do not fit together/);
    assert.match(prose, /so wide that it would tell you nothing/);
  });

  test("the problem it sizes is named by its canonical headline only", () => {
    assert.equal(LOST_REVENUE_PROBLEM_HEADLINE, SCAN_RECOMMENDATIONS["enquiry.unanswered"].headline);
    assert.ok(render().includes(SCAN_RECOMMENDATIONS["enquiry.unanswered"].headline));
    for (const c of SCAN_CONDITION_ORDER) {
      assert.ok(!render().includes(SCAN_RECOMMENDATIONS[c].why_it_matters), "why_it_matters must not be echoed");
    }
  });
});

// ── 7. Structured data and metadata ────────────────────────────────

describe("truthful WebPage JSON-LD and the A-1 metadata pattern", () => {
  test("one parseable WebPage block, brand publisher, no forbidden fields", () => {
    const html = renderToStaticMarkup(createElement(LostRevenuePage));
    const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
    assert.equal(blocks.length, 1);
    const parsed = JSON.parse(blocks[0].replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""));
    assert.equal(parsed["@type"], "WebPage");
    assert.equal(parsed.url, publicUrl(LOST_REVENUE_PATH));
    assert.equal(parsed.isAccessibleForFree, true);
    assert.deepEqual(parsed.publisher, { "@type": "Organization", name: "NiteOwl AI", url: "https://niteowlhq.com" });
    assert.doesNotMatch(blocks[0], /aggregateRating|"review|ratingValue|FAQPage|Question|address|areaServed|geo|Ltd|Holdings|\d/);
    assert.deepEqual(parsed, webPageJsonLd({ name: LOST_REVENUE_TITLE, path: LOST_REVENUE_PATH, description: LOST_REVENUE_DESCRIPTION }));
  });

  test("canonical, OpenGraph and Twitter agree with the title and description", () => {
    assert.equal(metadata.title, LOST_REVENUE_TITLE);
    assert.equal(metadata.description, LOST_REVENUE_DESCRIPTION);
    assert.equal(metadata.alternates.canonical, LOST_REVENUE_PATH);
    assert.equal(metadata.openGraph.url, publicUrl(LOST_REVENUE_PATH));
    assert.equal(metadata.openGraph.type, "website");
    assert.equal(metadata.openGraph.siteName, "NiteOwl HQ");
    assert.equal(metadata.openGraph.title, LOST_REVENUE_TITLE);
    assert.equal(metadata.openGraph.description, LOST_REVENUE_DESCRIPTION);
    assert.equal(metadata.twitter.title, LOST_REVENUE_TITLE);
    assert.equal(metadata.twitter.description, LOST_REVENUE_DESCRIPTION);
    assert.doesNotMatch(LOST_REVENUE_TITLE + LOST_REVENUE_DESCRIPTION, /\bRemy\b|\d/);
  });
});

// ── 8. Hub: one link line, no fourth card ──────────────────────────

describe("the hub gains only the approved internal link", () => {
  test("one Lost Revenue link beneath Common problems; the tool cards and problem links are unchanged", () => {
    const html = unescape(renderToStaticMarkup(createElement(FreeToolsPage)));
    assert.equal((html.match(/data-lost-revenue-link/g) ?? []).length, 1);
    assert.ok(html.includes(`href="${LOST_REVENUE_PATH}"`));
    assert.ok(html.includes(LOST_REVENUE_HUB_LINK_LABEL));
    // Still exactly two tool cards and three problem links.
    assert.equal((html.match(/Start the scan →|Start setup →/g) ?? []).length, 2);
    assert.equal((html.match(/data-problem-link=/g) ?? []).length, 3);
    // The link sits inside the Common problems section.
    const section = html.slice(html.indexOf("data-common-problems"), html.indexOf("Why these are free"));
    assert.ok(section.includes("data-lost-revenue-link"));
    // No capture, no pressure, and the hub JSON-LD still lists the two tools only.
    assert.doesNotMatch(html, /<form|<input|type="email"|\/signup|\/login|\/pricing|trial/i);
    const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
    assert.equal(JSON.parse(block).hasPart.length, 2);
  });
});
