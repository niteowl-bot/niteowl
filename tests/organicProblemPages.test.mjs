// Organic Acquisition Engine — A-2a problem-led discovery pages.
//
// Three static pages, one per canonical Scan condition class, that
// explain a problem in general terms and send the visitor to the
// UNCHANGED nine-question Scan. These tests prove the pages hold no
// diagnosis logic, take their problem wording from the Scan's own
// recommendation data, never assert that the visitor has the problem,
// carry no statistic / benchmark / review / location / urgency, add no
// persistence, identity, analytics or provider, are registered in the
// A-1 route registry, preserve the anti-funnel truth of the follow-up
// class, and leave the Scan contract exactly as it was.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  PROBLEM_PAGES,
  PROBLEM_PAGE_LIST,
  PROBLEMS_SECTION_NOTE,
  PROBLEMS_SECTION_TITLE,
  SCAN_CTA_LABEL,
  SCAN_PATH,
  SCAN_PROMISE,
} from "@/lib/site/problemPages";
import { PUBLIC_ROUTES, isPrivatePath, publicUrl } from "@/lib/site/publicRoutes";
import { webPageJsonLd } from "@/lib/site/structuredData";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import ProblemPageView from "@/app/free-tools/problems/ProblemPageView";
import FreeToolsPage from "@/app/free-tools/page";
import { SCAN_RECOMMENDATIONS, SETUP_KIT_HANDOFF } from "@/lib/freetools/scanRecommendations";
import { SCAN_QUESTIONS, SCAN_QUESTION_SET_VERSION } from "@/lib/freetools/scanQuestions";
import {
  SCAN_CLUSTER_RULE_SET_VERSION,
  SCAN_CONDITION_ORDER,
  SCAN_HYPOTHESIS_RULE_SET_VERSION,
  SCAN_PRIORITISATION_RULE_SET_VERSION,
  SCAN_RULE_SET_VERSION,
} from "@/lib/freetools/scanTypes";

const PROBLEMS_DIR = "src/app/free-tools/problems";
const A2A_FILES = [
  "src/lib/site/problemPages.ts",
  `${PROBLEMS_DIR}/ProblemPageView.tsx`,
  `${PROBLEMS_DIR}/unanswered-enquiries/page.tsx`,
  `${PROBLEMS_DIR}/enquiries-that-do-not-book/page.tsx`,
  `${PROBLEMS_DIR}/booking-back-and-forth/page.tsx`,
  "src/app/free-tools/page.tsx",
];

const read = (file) => readFileSync(file, "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const unescape = (html) =>
  html.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const render = (condition) =>
  unescape(renderToStaticMarkup(createElement(ProblemPageView, { condition })));
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");

const EXPECTED = {
  "enquiry.unanswered": "/free-tools/problems/unanswered-enquiries",
  "enquiry.no_followup": "/free-tools/problems/enquiries-that-do-not-book",
  "booking.friction": "/free-tools/problems/booking-back-and-forth",
};

// Any claim about numbers, results, comparisons or places.
const FABRICATED_CLAIM =
  /\d+\s*%|£\s*\d|€\s*\d|\$\s*\d|businesses like yours|on average|typically (lose|save|recover)|customers (saved|recovered|gained)|(save|saved|recover|recovered|lost|losing)\s+(up to\s+)?[£€$]?\d|\b\d[\d,]*\s+(businesses|customers|clients|users|owners)\b|proven|guaranteed|#1|number one|top[- ]rated|award|testimonial|case stud|customer reviews?|reviews|star rating|ratings?|near you|in (london|dublin|manchester|birmingham|galway|cork)\b|local(ly)? in\b/i;
// Any sentence that diagnoses the reader.
const DIAGNOSIS =
  /you are losing|you're losing|you have (a|this) problem|your business (is|has|suffers)|because your|because you|root cause|is why you|the reason you|you are missing|you're missing|you told us/i;
// Funnel pressure.
const PRESSURE =
  /sign ?up|log ?in|pricing|free trial|start your trial|book a demo|limited time|act now|don't wait|only today|hurry|before it's too late|urgent/i;

// ── 1. Exactly three pages, one per canonical condition ────────────

describe("exactly the three canonical condition classes have problem pages", () => {
  test("keys are exactly SCAN_CONDITION_ORDER, and paths match the approved routes", () => {
    assert.deepEqual(Object.keys(PROBLEM_PAGES).sort(), [...SCAN_CONDITION_ORDER].sort());
    assert.equal(SCAN_CONDITION_ORDER.length, 3);
    for (const condition of SCAN_CONDITION_ORDER) {
      assert.equal(PROBLEM_PAGES[condition].condition, condition);
      assert.equal(PROBLEM_PAGES[condition].path, EXPECTED[condition]);
    }
    assert.deepEqual(
      PROBLEM_PAGE_LIST.map((p) => p.condition),
      [...SCAN_CONDITION_ORDER]
    );
  });

  test("exactly three page.tsx files exist under the problems segment, matching the map", () => {
    const dirs = readdirSync(PROBLEMS_DIR).filter((e) => statSync(path.join(PROBLEMS_DIR, e)).isDirectory());
    assert.deepEqual(
      dirs.sort(),
      Object.values(EXPECTED).map((p) => p.split("/").pop()).sort()
    );
    for (const dir of dirs) {
      const src = read(`${PROBLEMS_DIR}/${dir}/page.tsx`);
      const condition = Object.entries(EXPECTED).find(([, p]) => p.endsWith(`/${dir}`))[0];
      assert.match(src, new RegExp(`PROBLEM_PAGES\\["${condition.replace(".", "\\.")}"\\]`), dir);
      assert.match(src, new RegExp(`condition="${condition.replace(".", "\\.")}"`), dir);
    }
  });

  test("no location, industry or city variant exists", () => {
    const all = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir)) {
        const full = path.join(dir, e);
        if (statSync(full).isDirectory()) walk(full);
        else all.push(full);
      }
    };
    walk(PROBLEMS_DIR);
    assert.equal(all.length, 4, all.join(", ")); // view + three pages
    for (const f of all) assert.doesNotMatch(f, /london|dublin|city|near|industry|plumb|electric|dental|salon/i);
  });
});

// ── 2. Registry, sitemap, robots ───────────────────────────────────

describe("the pages are registered and discoverable through the A-1 foundation only", () => {
  test("each page is in PUBLIC_ROUTES and therefore in the sitemap", () => {
    const registry = PUBLIC_ROUTES.map((r) => r.path);
    const urls = sitemap().map((e) => e.url);
    for (const condition of SCAN_CONDITION_ORDER) {
      const p = PROBLEM_PAGES[condition].path;
      assert.ok(registry.includes(p), `${p} not registered`);
      assert.ok(urls.includes(publicUrl(p)), `${p} not in sitemap`);
      assert.equal(isPrivatePath(p), false);
    }
    assert.equal(registry.filter((p) => p.startsWith("/free-tools/problems/")).length, 3);
  });

  test("no private route was exposed and robots is unchanged from A-1", () => {
    for (const e of sitemap()) assert.equal(isPrivatePath(e.url.replace("https://niteowlhq.com", "") || "/"), false);
    const r = robots();
    assert.deepEqual(r.rules.disallow, [
      "/dashboard", "/chat", "/leads", "/calendar", "/knowledge", "/settings", "/onboarding",
      "/admin", "/api", "/auth", "/login", "/signup", "/reset-password", "/forgot-password", "/booking",
    ]);
    assert.equal(r.rules.allow, "/");
    assert.equal(r.sitemap, "https://niteowlhq.com/sitemap.xml");
    for (const e of sitemap()) assert.equal("lastModified" in e, false);
  });

  test("sitemap.ts and robots.ts were not given special logic", () => {
    for (const f of ["src/app/sitemap.ts", "src/app/robots.ts"]) {
      assert.doesNotMatch(stripComments(read(f)), /problem|PROBLEM|lost|Lost/, f);
    }
  });
});

// ── 3. No persistence, identity, analytics, provider, client code ──

describe("A-2a is static, identity-free and provider-free", () => {
  test("no client directive, state, effect, request API, storage, fetch, database, analytics or external host", () => {
    for (const file of A2A_FILES) {
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

  test("the content module imports only Scan constants and the site registry", () => {
    const specifiers = read("src/lib/site/problemPages.ts").match(/from\s+["']([^"']+)["']/g) ?? [];
    assert.deepEqual(specifiers.sort(), [
      'from "@/lib/freetools/scanRecommendations"',
      'from "@/lib/freetools/scanTypes"',
      'from "@/lib/site/publicRoutes"',
    ]);
  });

  test("no new package dependency", () => {
    const pkg = JSON.parse(read("package.json"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    assert.equal(deps.filter((d) => /seo|sitemap|analytics|tracking|gtag|posthog|plausible|mdx|markdown|cms/i.test(d)).length, 0);
  });
});

// ── 4. No duplicated Scan decision logic ───────────────────────────

describe("the pages hold no diagnosis logic and no answer-dependent condition", () => {
  test("no engine call, no validator, no report builder, no threshold, no answer read", () => {
    for (const file of A2A_FILES) {
      const code = stripComments(read(file));
      assert.doesNotMatch(code, /deriveFindings\(|computeLostRevenue\(|recommendFor\(|deriveHypotheses\(|buildScanReport\(|validateScanAnswers\(|prioritise\(|deriveClusters\(|deriveDependencies\(|deriveEvidenceGaps\(|classifyImpact\(/, `${file} calls a Scan engine`);
      assert.doesNotMatch(code, /scanFindings|scanLostRevenue|scanHypotheses|scanValidation|scanFunnel|scanClusters|scanPrioritisation|scanEvidenceGaps|scanImpactClass/, `${file} imports a Scan engine module`);
      assert.doesNotMatch(code, /q[1-9]_[a-z_]+|answers\.|ScanAnswers|applies:|threshold|>=\s*\d|<=\s*\d|===\s*"(working_hours|varies|no|sometimes|nothing_planned|more_than_three)"/, `${file} reads or compares an answer`);
    }
  });

  test("the map is a static object: same output on every read, keyed by condition only", () => {
    assert.deepEqual(PROBLEM_PAGES, PROBLEM_PAGES);
    for (const condition of SCAN_CONDITION_ORDER) {
      assert.equal(typeof PROBLEM_PAGES[condition].headline, "string");
      assert.ok(Array.isArray(PROBLEM_PAGES[condition].how_it_tends_to_happen));
    }
  });
});

// ── 5. Wording provenance ──────────────────────────────────────────

describe("problem wording comes from the Scan's own recommendation data", () => {
  for (const condition of SCAN_CONDITION_ORDER) {
    test(`${condition}: headline and next_step are SCAN_RECOMMENDATIONS verbatim`, () => {
      const page = PROBLEM_PAGES[condition];
      assert.equal(page.headline, SCAN_RECOMMENDATIONS[condition].headline);
      assert.equal(page.next_step, SCAN_RECOMMENDATIONS[condition].next_step);
      const html = render(condition);
      assert.ok(html.includes(SCAN_RECOMMENDATIONS[condition].headline));
      assert.ok(html.includes(SCAN_RECOMMENDATIONS[condition].next_step));
    });
  }

  test("why_it_matters and hypothesis language are absent from every page", () => {
    for (const condition of SCAN_CONDITION_ORDER) {
      const html = render(condition);
      for (const c of SCAN_CONDITION_ORDER) {
        assert.ok(!html.includes(SCAN_RECOMMENDATIONS[c].why_it_matters), `${condition} renders why_it_matters`);
      }
    }
    const contentSource = stripComments(read("src/lib/site/problemPages.ts"));
    assert.doesNotMatch(contentSource, /why_it_matters|display_text|hypothes/i);
    // The report's hypothesis sentences are not echoed as page prose.
    const hypothesisTexts = (read("src/lib/freetools/scanHypotheses.ts").match(/display_text:\s*\r?\n?\s*"([^"]+)"/g) ?? [])
      .map((m) => m.replace(/display_text:\s*\r?\n?\s*"/, "").replace(/"$/, ""));
    assert.equal(hypothesisTexts.length, 6);
    for (const condition of SCAN_CONDITION_ORDER) {
      const html = render(condition);
      for (const t of hypothesisTexts) assert.ok(!html.includes(t), `${condition} echoes a hypothesis`);
    }
  });
});

// ── 6. Truthfulness: no claims, no diagnosis, no pressure ──────────

describe("the pages diagnose nobody, claim nothing and press nobody", () => {
  for (const condition of SCAN_CONDITION_ORDER) {
    test(`${condition}: rendered text, metadata and JSON-LD carry no fabricated claim, diagnosis or funnel pressure`, () => {
      const page = PROBLEM_PAGES[condition];
      const html = render(condition);
      const text = textOf(html);
      for (const s of [text, page.title, page.description, ...page.how_it_tends_to_happen, page.what_the_scan_can_tell_you]) {
        assert.doesNotMatch(s, FABRICATED_CLAIM, s.slice(0, 120));
        assert.doesNotMatch(s, DIAGNOSIS, s.slice(0, 120));
        assert.doesNotMatch(s, PRESSURE, s.slice(0, 120));
      }
      // The only numeral on the page is the word "nine" (the question count) — no digits at all.
      assert.doesNotMatch(text, /\d/, "a problem page states a number");
      // Mechanism prose stays tentative.
      for (const p of page.how_it_tends_to_happen) assert.match(p, /\b(may|can|often|tends?|might|could)\b/, p);
    });
  }

  test("the estimate is described as a range from the visitor's own numbers, never a measurement", () => {
    const html = render("enquiry.unanswered");
    assert.match(html, /range worked out from your own numbers, never a measurement/);
    for (const c of ["enquiry.no_followup", "booking.friction"]) {
      assert.match(render(c), /does not put a number on this one/);
    }
  });
});

// ── 7. CTA: one destination, unchanged Scan ────────────────────────

describe("every page sends the visitor to the unchanged Scan, and nowhere else new", () => {
  test("SCAN_PATH is the bare Scan route", () => {
    assert.equal(SCAN_PATH, "/free-tools/business-opportunity-scan");
  });

  for (const condition of SCAN_CONDITION_ORDER) {
    test(`${condition}: the CTA href is the literal Scan path; every href is a known public literal`, () => {
      const html = render(condition);
      const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      assert.ok(hrefs.includes(SCAN_PATH));
      assert.equal((html.match(/data-scan-cta/g) ?? []).length, 1);
      const allowed = new Set([SCAN_PATH, "/free-tools", SETUP_KIT_HANDOFF.href]);
      for (const h of hrefs) {
        assert.ok(allowed.has(h), `unexpected href ${h}`);
        assert.ok(!h.includes("?") && !h.includes("#"), `href carries state: ${h}`);
      }
      assert.ok(html.includes(SCAN_CTA_LABEL));
      assert.ok(html.includes(SCAN_PROMISE));
    });
  }
});

// ── 8. Honest routing preserved per class ──────────────────────────

describe("honest routing is preserved, not restated as a pitch", () => {
  test("enquiry.no_followup: null product in canon, no product on the page, the honest sentence rendered", () => {
    assert.equal(SCAN_RECOMMENDATIONS["enquiry.no_followup"].recommended_product, null);
    assert.equal(SCAN_RECOMMENDATIONS["enquiry.no_followup"].free_tool_handoff, null);
    assert.equal(PROBLEM_PAGES["enquiry.no_followup"].routing.kind, "none");
    const html = render("enquiry.no_followup");
    assert.match(html, /data-no-product/);
    assert.match(html, /There is nothing to buy for this/);
    assert.doesNotMatch(html, /data-attribution|data-handoff/);
    assert.equal((textOf(html).match(/Remy/g) ?? []).length, 0);
    assert.ok(!html.includes(SETUP_KIT_HANDOFF.href));
  });

  test("booking.friction: the canonical Setup Kit handoff, verbatim, and Remy named once as attribution", () => {
    assert.deepEqual(SCAN_RECOMMENDATIONS["booking.friction"].free_tool_handoff, SETUP_KIT_HANDOFF);
    const page = PROBLEM_PAGES["booking.friction"];
    assert.equal(page.routing.kind, "setup_kit_then_remy");
    assert.deepEqual(page.routing.handoff, SETUP_KIT_HANDOFF);
    const html = render("booking.friction");
    assert.ok(html.includes(`href="${SETUP_KIT_HANDOFF.href}"`));
    assert.ok(html.includes(SETUP_KIT_HANDOFF.label));
    assert.equal((html.match(/data-handoff/g) ?? []).length, 1);
    assert.equal((textOf(html).match(/Remy/g) ?? []).length, 1);
    assert.doesNotMatch(textOf(html), /Remy (fixes|solves|will fix|will solve|handles this for you)/i);
    // Attribution follows the advice and the CTA, never precedes them.
    assert.ok(html.indexOf("data-next-step") < html.indexOf("data-attribution"));
    assert.ok(html.indexOf("data-scan-cta") < html.indexOf("data-attribution"));
  });

  test("enquiry.unanswered: Remy named once as attribution, no handoff, no claim", () => {
    const html = render("enquiry.unanswered");
    assert.equal((textOf(html).match(/Remy/g) ?? []).length, 1);
    assert.doesNotMatch(html, /data-handoff/);
    assert.doesNotMatch(textOf(html), /Remy (fixes|solves|will fix|will solve)/i);
    assert.ok(html.indexOf("data-scan-cta") < html.indexOf("data-attribution"));
  });

  test("metadata titles and descriptions name no product", () => {
    for (const condition of SCAN_CONDITION_ORDER) {
      const page = PROBLEM_PAGES[condition];
      assert.doesNotMatch(page.title + page.description, /\bRemy\b|receptionist software|AI receptionist(?! Setup Kit)/i);
    }
  });
});

// ── 9. Structured data and metadata pattern ────────────────────────

describe("each page carries truthful WebPage JSON-LD and the A-1 metadata pattern", () => {
  for (const condition of SCAN_CONDITION_ORDER) {
    test(`${condition}: one parseable WebPage block, brand publisher, no forbidden fields`, () => {
      const html = renderToStaticMarkup(createElement(ProblemPageView, { condition }));
      const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
      assert.equal(blocks.length, 1);
      const parsed = JSON.parse(blocks[0].replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""));
      assert.equal(parsed["@type"], "WebPage");
      assert.equal(parsed.url, publicUrl(PROBLEM_PAGES[condition].path));
      assert.equal(parsed.isAccessibleForFree, true);
      assert.deepEqual(parsed.publisher, { "@type": "Organization", name: "NiteOwl AI", url: "https://niteowlhq.com" });
      assert.doesNotMatch(blocks[0], /aggregateRating|"review|ratingValue|FAQPage|Question|address|areaServed|geo|Ltd|Holdings/);
      assert.deepEqual(parsed, webPageJsonLd({ name: PROBLEM_PAGES[condition].title, path: PROBLEM_PAGES[condition].path, description: PROBLEM_PAGES[condition].description }));
    });

    test(`${condition}: page.tsx follows the A-1 metadata pattern from the content map`, () => {
      const src = read(`${PROBLEMS_DIR}/${PROBLEM_PAGES[condition].slug}/page.tsx`);
      assert.match(src, /alternates: \{ canonical: PAGE\.path \}/);
      assert.match(src, /openGraph: \{[\s\S]*?type: "website",[\s\S]*?url: publicUrl\(PAGE\.path\),[\s\S]*?siteName: "NiteOwl HQ",[\s\S]*?title: PAGE\.title,[\s\S]*?description: PAGE\.description/);
      assert.match(src, /twitter: \{[\s\S]*?card: "summary",[\s\S]*?title: PAGE\.title,[\s\S]*?description: PAGE\.description/);
    });
  }
});

// ── 10. The hub section ────────────────────────────────────────────

describe("the hub links the three pages and stays free of pressure", () => {
  test("a Common problems section with exactly three links, in Scan order, and nothing captured", () => {
    const html = unescape(renderToStaticMarkup(createElement(FreeToolsPage)));
    assert.ok(html.includes(PROBLEMS_SECTION_TITLE));
    assert.ok(html.includes(PROBLEMS_SECTION_NOTE));
    const links = [...html.matchAll(/data-problem-link="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(links, [...SCAN_CONDITION_ORDER]);
    for (const condition of SCAN_CONDITION_ORDER) {
      assert.ok(html.includes(`href="${PROBLEM_PAGES[condition].path}"`));
      assert.ok(html.includes(PROBLEM_PAGES[condition].headline));
    }
    assert.doesNotMatch(html, /<form|<input|type="email"|\/signup|\/login|\/pricing|trial/i);
    assert.doesNotMatch(textOf(html), PRESSURE);
    // The hub JSON-LD still lists the two TOOLS only.
    const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
    assert.equal(JSON.parse(block).hasPart.length, 2);
  });
});

// ── 11. The Scan is untouched ──────────────────────────────────────

describe("the Scan contract and its surface are exactly as they were", () => {
  test("nine questions, six required, question-set and rule-set versions unchanged", () => {
    assert.equal(SCAN_QUESTIONS.length, 9);
    assert.equal(SCAN_QUESTIONS.filter((q) => q.required).length, 6);
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

  test("the Scan surface reads no entry mode, query or prefill", () => {
    const client = stripComments(read("src/app/free-tools/business-opportunity-scan/ScanClient.tsx"));
    assert.doesNotMatch(client, /useSearchParams|searchParams|prefill|[?&](mode|entry|problem|from|source|ref)=/i);
  });
});
