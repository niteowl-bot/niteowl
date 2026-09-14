// Organic Acquisition Engine — A-1 Discoverability Foundation.
//
// Makes the free-product surfaces that already exist discoverable
// WITHOUT changing their intelligence, behaviour, data model, routing
// or zero-persistence posture. These tests pin the properties the
// reconciliation named: only public routes are exposed, private
// families are protected, the output is deterministic, no visitor
// identity or storage mechanism is introduced, the structured data and
// metadata carry no fabricated claims, no Scan intelligence is
// duplicated under src/app, and the existing anti-funnel behaviour is
// untouched.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  PRIVATE_ROUTE_PREFIXES,
  PUBLIC_ROUTES,
  SITE_URL,
  isPrivatePath,
  publicUrl,
} from "@/lib/site/publicRoutes";
import {
  freeToolApplicationJsonLd,
  freeToolsHubJsonLd,
} from "@/lib/site/structuredData";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import FreeToolsPage, { metadata as hubMetadata } from "@/app/free-tools/page";

// The two tool pages mount client components through extensionless
// relative imports the test loader does not resolve, so their metadata
// is read from SOURCE: the PATH / TITLE / DESCRIPTION constants and the
// metadata literal that must reference them by name.
function metadataFromSource(file) {
  const src = readFileSync(file, "utf8");
  const grab = (name) => {
    const m = src.match(new RegExp("const " + name + " =\\s*\\r?\\n?\\s*\"([^\"]+)\";"));
    if (!m) throw new Error(file + ": const " + name + " not found");
    return m[1];
  };
  const block = src.match(/export const metadata: Metadata = \{([\s\S]*?)\r?\n\};/);
  if (!block) throw new Error(file + ": metadata block not found");
  const b = block[1];
  const has = (re) => re.test(b);
  const title = grab("TITLE");
  const description = grab("DESCRIPTION");
  const p = grab("PATH");
  return {
    title,
    description,
    alternates: { canonical: has(/alternates: \{ canonical: PATH \}/) ? p : null },
    openGraph: {
      type: has(/type: "website"/) ? "website" : null,
      url: has(/url: publicUrl\(PATH\)/) ? publicUrl(p) : null,
      siteName: (b.match(/siteName: "([^"]+)"/) ?? [])[1] ?? null,
      title: has(/openGraph: \{[\s\S]*?title: TITLE/) ? title : null,
      description: has(/openGraph: \{[\s\S]*?description: DESCRIPTION/) ? description : null,
    },
    twitter: {
      title: has(/twitter: \{[\s\S]*?title: TITLE/) ? title : null,
      description: has(/twitter: \{[\s\S]*?description: DESCRIPTION/) ? description : null,
    },
  };
}
const scanMetadata = metadataFromSource("src/app/free-tools/business-opportunity-scan/page.tsx");
const kitMetadata = metadataFromSource("src/app/free-tools/ai-receptionist-setup-kit/page.tsx");

const A1_FILES = [
  "src/lib/site/publicRoutes.ts",
  "src/lib/site/structuredData.ts",
  "src/app/sitemap.ts",
  "src/app/robots.ts",
  "src/app/free-tools/page.tsx",
  "src/app/free-tools/business-opportunity-scan/page.tsx",
  "src/app/free-tools/ai-receptionist-setup-kit/page.tsx",
];

const read = (file) => readFileSync(file, "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/**
 * The REAL route inventory: every page.tsx under src/app, with route
 * groups stripped and dynamic segments kept as written. This is the
 * authority the public/private lists are pinned against.
 */
function pageRoutes() {
  const routes = [];
  const walk = (dir, segments) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        const seg = /^\(.*\)$/.test(entry) ? null : entry;
        walk(full, seg ? [...segments, seg] : segments);
      } else if (entry === "page.tsx") {
        routes.push("/" + segments.join("/"));
      }
    }
  };
  walk("src/app", []);
  return routes.map((r) => (r === "/" ? r : r.replace(/\/$/, ""))).sort();
}

function routeHandlerRoutes() {
  const routes = [];
  const walk = (dir, segments) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        const seg = /^\(.*\)$/.test(entry) ? null : entry;
        walk(full, seg ? [...segments, seg] : segments);
      } else if (entry === "route.ts") {
        routes.push("/" + segments.join("/"));
      }
    }
  };
  walk("src/app", []);
  return routes.sort();
}

const PUBLIC_PATHS = PUBLIC_ROUTES.map((r) => r.path);

// ── 1. Sitemap ─────────────────────────────────────────────────────

describe("the sitemap exposes only the intended public routes", () => {
  test("exactly the ten public pages, absolute, on the canonical origin", () => {
    // A-1 shipped six. A-2a added the three problem-led pages — one per
    // canonical Scan condition class. A-2b added the Lost Revenue entry
    // page, and nothing else. Extended, not loosened: the list stays exact.
    const entries = sitemap();
    assert.deepEqual(
      entries.map((e) => e.url),
      [
        "https://niteowlhq.com",
        "https://niteowlhq.com/free-tools",
        "https://niteowlhq.com/free-tools/business-opportunity-scan",
        "https://niteowlhq.com/free-tools/ai-receptionist-setup-kit",
        "https://niteowlhq.com/free-tools/problems/unanswered-enquiries",
        "https://niteowlhq.com/free-tools/problems/enquiries-that-do-not-book",
        "https://niteowlhq.com/free-tools/problems/booking-back-and-forth",
        "https://niteowlhq.com/free-tools/lost-revenue",
        "https://niteowlhq.com/privacy",
        "https://niteowlhq.com/terms",
      ]
    );
    for (const e of entries) {
      assert.ok(e.url.startsWith(SITE_URL));
      assert.ok(!e.url.includes("?") && !e.url.includes("#"), "no query or fragment");
    }
  });

  test("every public path is a real page.tsx that exists today", () => {
    const real = pageRoutes();
    for (const p of PUBLIC_PATHS) assert.ok(real.includes(p), `${p} is not a page`);
  });

  test("no private, auth, admin, api or tokened route is in the sitemap", () => {
    for (const e of sitemap()) {
      const p = e.url.replace(SITE_URL, "") || "/";
      assert.equal(isPrivatePath(p), false, `${p} is private`);
    }
  });

  test("the public and private lists PARTITION the real page inventory — a new page must be classified", () => {
    // If someone adds a page that is neither listed as public nor under
    // a private family, this fails: a crawler must never be the first to
    // classify a route.
    for (const p of pageRoutes()) {
      const isPublic = PUBLIC_PATHS.includes(p);
      const isPrivate = isPrivatePath(p);
      assert.ok(isPublic !== isPrivate, `${p} is ${isPublic ? "both public and private" : "unclassified"}`);
    }
  });

  test("every route handler falls under a private family", () => {
    for (const p of routeHandlerRoutes()) {
      assert.equal(isPrivatePath(p), true, `${p} is a route handler not covered by robots`);
    }
  });

  test("the manage-booking link is private despite needing no login", () => {
    assert.equal(isPrivatePath("/booking/manage"), true);
    assert.ok(!PUBLIC_PATHS.includes("/booking/manage"));
  });

  test("no lastModified is stated: no reliable per-route date exists and none is invented", () => {
    for (const e of sitemap()) {
      assert.equal("lastModified" in e, false, `${e.url} claims a modification date`);
    }
    assert.doesNotMatch(stripComments(read("src/app/sitemap.ts")), /lastModified/);
  });
});

// ── 2. Robots ──────────────────────────────────────────────────────

describe("robots protects the private route families", () => {
  test("allows / and disallows every private prefix", () => {
    const r = robots();
    assert.equal(r.rules.userAgent, "*");
    assert.equal(r.rules.allow, "/");
    assert.deepEqual(r.rules.disallow, [...PRIVATE_ROUTE_PREFIXES]);
    for (const required of [
      "/dashboard", "/chat", "/leads", "/calendar", "/knowledge", "/settings", "/onboarding",
      "/admin", "/api", "/auth", "/login", "/signup", "/reset-password", "/forgot-password", "/booking",
    ]) {
      assert.ok(r.rules.disallow.includes(required), `${required} not disallowed`);
    }
    assert.equal(r.sitemap, "https://niteowlhq.com/sitemap.xml");
  });

  test("no public route is disallowed", () => {
    for (const p of PUBLIC_PATHS) assert.equal(isPrivatePath(p), false, p);
  });

  test("isPrivatePath is prefix-by-segment, not substring", () => {
    assert.equal(isPrivatePath("/dashboard/anything"), true);
    assert.equal(isPrivatePath("/free-tools"), false);
    // A public path that merely CONTAINS a private word is not private.
    assert.equal(isPrivatePath("/free-tools/chat-tips"), false);
  });
});

// ── 3. Determinism and the absence of identity/persistence ────────

describe("A-1 is deterministic and introduces no identity, storage or provider", () => {
  test("sitemap and robots return identical output on every call", () => {
    assert.deepEqual(sitemap(), sitemap());
    assert.deepEqual(robots(), robots());
    assert.deepEqual(JSON.stringify(sitemap()), JSON.stringify(sitemap()));
  });

  test("no clock, randomness, request, cookie, storage, fetch, database or provider in any A-1 file", () => {
    for (const file of A1_FILES) {
      const code = stripComments(read(file));
      assert.doesNotMatch(code, /Date\.now|new Date\(|performance\.now|toISOString/, `${file} reads a clock`);
      assert.doesNotMatch(code, /Math\.random|crypto|randomUUID|uuid|nanoid/i, `${file} generates identifiers`);
      assert.doesNotMatch(code, /cookies\(|headers\(|document\.cookie|localStorage|sessionStorage|indexedDB|navigator\./, `${file} reaches a visitor mechanism`);
      assert.doesNotMatch(code, /useSearchParams|searchParams|fetch\(|XMLHttpRequest|WebSocket/, `${file} reads a request or the network`);
      assert.doesNotMatch(code, /@supabase|supabase|from\("|\.insert\(|\.select\(|after\(/i, `${file} reaches a database`);
      assert.doesNotMatch(code, /gtag|analytics|plausible|posthog|segment|hotjar|mixpanel|googletagmanager|clarity|fbq|pixel/i, `${file} references an analytics provider`);
      assert.doesNotMatch(code, /<script[^>]+src=|https?:\/\/(?!niteowlhq\.com|schema\.org)/i, `${file} loads or names an external host`);
    }
  });

  test("the site modules import nothing but each other", () => {
    for (const file of ["src/lib/site/publicRoutes.ts", "src/lib/site/structuredData.ts", "src/app/sitemap.ts", "src/app/robots.ts"]) {
      const specifiers = read(file).match(/from\s+["']([^"']+)["']/g) ?? [];
      for (const s of specifiers) {
        assert.match(s, /["'](next|@\/lib\/site\/publicRoutes)["']/, `${file} imports ${s}`);
      }
    }
  });

  test("no new package dependency was introduced", () => {
    const pkg = JSON.parse(read("package.json"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    assert.equal(deps.filter((d) => /seo|sitemap|analytics|tracking|gtag|posthog|plausible/i.test(d)).length, 0);
  });
});

// ── 4. Structured data and metadata carry no fabricated claims ─────

const FORBIDDEN_JSONLD_KEYS = /"(aggregateRating|review|reviews|ratingValue|ratingCount|reviewCount|bestRating|worstRating|interactionStatistic|userInteractionCount|address|areaServed|geo|location)"/;
const FORBIDDEN_JSONLD_TYPES = /"@type":\s*"(AggregateRating|Review|Rating|FAQPage|Question|Answer|LocalBusiness|Place|PostalAddress|Testimonial|EndorsementRating)"/;
const FABRICATED_CLAIM = /\d+\s*%|£\s*\d|€\s*\d|\$\s*\d|businesses like yours|on average|typically (lose|save|recover)|customers (saved|recovered|gained)|(save|saved|recover|recovered|lost|losing)\s+(up to\s+)?[£€$]?\d|\b\d[\d,]*\s+(businesses|customers|clients|users)\b|proven|guaranteed|#1|number one|top[- ]rated|award/i;

describe("structured data contains only truthful, claim-free facts about the tools", () => {
  const scanJsonLd = freeToolApplicationJsonLd({
    name: "Business Opportunity Scan",
    path: "/free-tools/business-opportunity-scan",
    description: scanMetadata.description,
  });
  const hubJsonLd = freeToolsHubJsonLd([
    { name: "A", path: "/free-tools/business-opportunity-scan", description: "x" },
  ]);

  test("a free tool is a WebApplication that is free, with NiteOwl as publisher", () => {
    assert.equal(scanJsonLd["@type"], "WebApplication");
    assert.equal(scanJsonLd.isAccessibleForFree, true);
    assert.deepEqual(scanJsonLd.offers, { "@type": "Offer", price: "0", priceCurrency: "GBP" });
    // The BRAND, as the free-tools footer already states it — structured
    // data introduces no legal-entity claim.
    assert.equal(scanJsonLd.publisher.name, "NiteOwl AI");
    assert.equal(scanJsonLd.publisher.url, "https://niteowlhq.com");
    assert.doesNotMatch(JSON.stringify(scanJsonLd), /\bLtd\b|Limited|Holdings|company number|registered/i);
    assert.equal(scanJsonLd.url, "https://niteowlhq.com/free-tools/business-opportunity-scan");
    assert.equal(hubJsonLd["@type"], "CollectionPage");
    assert.equal(hubJsonLd.hasPart.length, 1);
  });

  test("no AggregateRating, Review, ratingValue, FAQPage, location or interaction statistic can be expressed", () => {
    for (const obj of [scanJsonLd, hubJsonLd]) {
      const json = JSON.stringify(obj);
      assert.doesNotMatch(json, FORBIDDEN_JSONLD_KEYS);
      assert.doesNotMatch(json, FORBIDDEN_JSONLD_TYPES);
    }
    // And the builder source cannot produce them.
    const src = stripComments(read("src/lib/site/structuredData.ts"));
    assert.doesNotMatch(src, /aggregateRating|Review|ratingValue|FAQPage|Question|LocalBusiness|address|areaServed|geo/);
  });

  test("the only numeral in the tool JSON-LD is the zero price", () => {
    const json = JSON.stringify(scanJsonLd).replace(/"price":"0"/, "").replace(/https?:\/\/[^"]+/g, "");
    assert.doesNotMatch(json, /\d/, "structured data must state no number about a business");
  });

  test("every rendered free-tool page carries exactly one JSON-LD block, parseable and claim-free", () => {
    // The hub renders here (server component, static). The tool pages
    // mount client components; their JSON-LD is asserted from the same
    // builder plus a source-level pin that each page emits it.
    const html = renderToStaticMarkup(createElement(FreeToolsPage));
    const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
    assert.equal(blocks.length, 1);
    const parsed = JSON.parse(blocks[0].replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""));
    assert.equal(parsed["@type"], "CollectionPage");
    assert.equal(parsed.hasPart.length, 2);
    assert.deepEqual(
      parsed.hasPart.map((p) => p.url),
      ["https://niteowlhq.com/free-tools/business-opportunity-scan", "https://niteowlhq.com/free-tools/ai-receptionist-setup-kit"]
    );
    assert.doesNotMatch(blocks[0], FORBIDDEN_JSONLD_KEYS);
    assert.doesNotMatch(blocks[0], FORBIDDEN_JSONLD_TYPES);
    for (const file of [
      "src/app/free-tools/business-opportunity-scan/page.tsx",
      "src/app/free-tools/ai-receptionist-setup-kit/page.tsx",
    ]) {
      const src = read(file);
      assert.equal((src.match(/application\/ld\+json/g) ?? []).length, 1, file);
      assert.match(src, /freeToolApplicationJsonLd\(/, file);
    }
  });
});

describe("metadata is truthful, consistent and free of fabricated claims", () => {
  const pages = [
    ["/free-tools", hubMetadata],
    ["/free-tools/business-opportunity-scan", scanMetadata],
    ["/free-tools/ai-receptionist-setup-kit", kitMetadata],
  ];

  for (const [p, m] of pages) {
    test(`${p}: canonical, OpenGraph and Twitter agree with the page title and description`, () => {
      assert.equal(m.alternates.canonical, p);
      assert.equal(m.openGraph.url, publicUrl(p));
      assert.equal(m.openGraph.type, "website");
      assert.equal(m.openGraph.siteName, "NiteOwl HQ");
      assert.equal(m.openGraph.title, m.title);
      assert.equal(m.openGraph.description, m.description);
      assert.equal(m.twitter.title, m.title);
      assert.equal(m.twitter.description, m.description);
      assert.ok(m.description.length > 40 && m.description.length < 320);
    });

    test(`${p}: no statistic, benchmark, currency-loss, customer-count or superlative claim`, () => {
      for (const text of [m.title, m.description, m.openGraph.title, m.openGraph.description]) {
        assert.doesNotMatch(text, FABRICATED_CLAIM, text);
      }
    });

    test(`${p}: metadata does not sell Remy as the answer`, () => {
      for (const text of [m.title, m.description]) {
        assert.doesNotMatch(text, /\bRemy\b|receptionist software|buy|upgrade|pricing|sign up/i, text);
      }
    });
  }

  test("the sitemap, canonicals and JSON-LD urls all agree", () => {
    const urls = new Set(sitemap().map((e) => e.url));
    for (const [p, m] of pages) {
      assert.ok(urls.has(publicUrl(m.alternates.canonical)), p);
    }
  });
});

// ── 5. Internal linking, unchanged routing ────────────────────────

describe("internal linking exists and no funnel was added", () => {
  test("the hub links to both existing tools and back to home", () => {
    const html = renderToStaticMarkup(createElement(FreeToolsPage));
    assert.match(html, /href="\/free-tools\/business-opportunity-scan"/);
    assert.match(html, /href="\/free-tools\/ai-receptionist-setup-kit"/);
    assert.match(html, /href="\/"/);
  });

  test("the free-tools layout gives every tool a route back to the hub and home", () => {
    const layout = read("src/app/free-tools/layout.tsx");
    assert.match(layout, /href="\/free-tools"/);
    assert.match(layout, /href="\/"/);
    assert.match(layout, /href="\/privacy"/);
    assert.match(layout, /href="\/terms"/);
  });

  test("the hub page contains no sign-up gate, pricing push or contact capture", () => {
    const html = renderToStaticMarkup(createElement(FreeToolsPage));
    assert.doesNotMatch(html, /<form|<input|type="email"|\/signup|\/login|\/pricing|Start free trial/i);
  });

  test("the layout and pages under free-tools acquired no routing service, handoff or middleware", () => {
    for (const file of ["src/app/free-tools/layout.tsx", ...A1_FILES.filter((f) => f.includes("free-tools"))]) {
      const code = stripComments(read(file));
      assert.doesNotMatch(code, /middleware|redirect\(|recommended_product|free_tool_handoff|routing/i, file);
    }
  });
});

// ── 6. No Scan intelligence duplicated; semantics untouched ────────

describe("no Scan rule or intelligence lives under src/app or src/lib/site", () => {
  test("the Scan engines are called from nowhere but src/lib/freetools and the Scan surface", () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry)) {
          if (full.includes(path.join("free-tools", "business-opportunity-scan"))) continue;
          if (full.includes(path.join("free-tools", "ai-receptionist-setup-kit"))) continue;
          const code = stripComments(read(full));
          if (/deriveFindings\(|computeLostRevenue\(|recommendFor\(|deriveHypotheses\(|buildScanReport\(|SCAN_CONDITION_ORDER\s*=|scanLostRevenue|scanFindings|scanHypotheses/.test(code)) {
            offenders.push(full);
          }
        }
      }
    };
    walk("src/app");
    walk("src/lib/site");
    assert.deepEqual(offenders, []);
  });

  test("A-1 changed nothing under src/lib/freetools", () => {
    // Pinned by the boundary suite's module list and by the untouched
    // exports; here, simply: the site modules do not import it.
    for (const file of A1_FILES) {
      const imports = (stripComments(read(file)).match(/from\s+["'][^"']+["']/g) ?? []).join("\n");
      assert.doesNotMatch(imports, /@\/lib\/freetools/, `${file} imports Scan logic`);
    }
  });
});
