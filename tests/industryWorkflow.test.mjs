// Industry landing pages — Slice 3: workflow motifs, controlled section
// order, mid-page Scan CTA.
//
// Each industry page gains a workflow section (plumbers: four nodes on a
// flowing curve; electricians: four nodes on an orthogonal circuit
// trace), its own section order from a CLOSED set of existing section
// ids, and a trade-framed mid-page Scan CTA placed where its story
// wants it — through the same typed IndustryPage contract and the same
// shared view. These tests pin the two motifs and their labels, that
// the pages do not share a workflow presentation, the intended section
// orders and CTA positions, the unchanged Scan destination and indigo
// CTA styling, the absence of cross-trade wording and of unsupported
// state claims, the untouched Slice 1 and Slice 2 variants, the default
// order for a page that has not opted in, and that nothing outside the
// marketing surface changed.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { DEFAULT_SECTION_ORDER, ELECTRICIANS_PAGE, PLUMBERS_PAGE } from "@/lib/site/industryPages";
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
const section = (html, attr) => {
  const s = html.indexOf(attr);
  const e = html.indexOf("</section>", s);
  assert.ok(s > 0 && e > s, `${attr} section present`);
  return html.slice(s, e);
};
/** The order of sections as they appear in the rendered <main>. */
const renderedOrder = (html) => {
  const main = html.slice(html.indexOf('<main id="main-content">'), html.indexOf("</main>"));
  const ids = [];
  // Non-greedy so the FIRST data attribute of each section is taken.
  for (const m of main.matchAll(/<section[^>]*?\sdata-([a-z-]+)(?:=|\s|>)/g)) {
    const id = m[1];
    if (["hero", "pain-points", "workflow", "mid-cta", "capabilities", "example", "scan", "how-it-works", "faq", "final-cta"].includes(id)) ids.push(id);
  }
  return ids;
};

const PLUMBING = /plumb|pipe|sink|drain|hot water|boiler|leak|bathroom/i;
const ELECTRICAL = /electric|socket|switch|lighting|rewire|consumer[- ]unit|EV charger|fit-out|tripping|circuit|board/i;
const REMY_ACTED =
  /(?<!nothing |not a |doesn’t |does not |never |no )\b(booked|confirmed booking|booking confirmed|dispatched|diagnos(ed|is)|certif(ied|icate)|repaired|fixed the|made safe|engineer will attend|will attend|guaranteed)\b/i;

// ── 1–4. Motifs and labels ─────────────────────────────────────────

describe("plumbers render the flowing-curve workflow", () => {
  const html = renderPage(PlumbersPage);
  const wf = section(html, "data-workflow");

  test("variant is flow_curve, rendered with four numbered nodes and the approved labels", () => {
    assert.equal(PLUMBERS_PAGE.presentation.workflow, "flow_curve");
    assert.match(wf, /data-workflow-variant="flow_curve"/);
    assert.match(wf, /data-workflow-motif="flow_curve"/);
    assert.deepEqual(
      PLUMBERS_PAGE.workflow.nodes.map((n) => n.title),
      ["Call answered", "Job & address captured", "Time checked against your calendar", "Booking request submitted"]
    );
    assert.equal((wf.match(/<li /g) ?? []).length, 4);
    for (const [i, node] of PLUMBERS_PAGE.workflow.nodes.entries()) {
      assert.ok(wf.includes(node.title), node.title);
      assert.match(wf, new RegExp(`font-mono[^>]*>${i + 1}<`));
    }
    let last = -1;
    for (const node of PLUMBERS_PAGE.workflow.nodes) {
      const at = wf.indexOf(node.title);
      assert.ok(at > last);
      last = at;
    }
  });

  test("the curve is an S-path, decorative, aria-hidden, desktop-only; round markers; cyan cues", () => {
    assert.match(wf, /<path d="M0 32 C /);
    assert.match(wf, /hidden lg:block pointer-events-none absolute[^"]*"[^>]*aria-hidden="true"/);
    assert.match(wf, /rounded-full border-2 border-white/);
    assert.match(wf, /bg-cyan-600/);
    assert.doesNotMatch(wf, /amber/);
    assert.match(wf, /data-workflow-footnote/);
    assert.ok(wf.includes(PLUMBERS_PAGE.workflow.footnote));
  });

  test("the endpoint is a request: 'Booking request submitted' and 'look out for the confirmation email'", () => {
    const last = PLUMBERS_PAGE.workflow.nodes[3];
    assert.equal(last.title, "Booking request submitted");
    assert.match(last.body, /look out for the confirmation email/);
    assert.match(last.body, /only once the booking is actually made/);
    assert.match(PLUMBERS_PAGE.workflow.footnote, /never promises that a plumber will be there/);
    assert.match(PLUMBERS_PAGE.workflow.footnote, /never diagnoses/);
  });
});

describe("electricians render the circuit-trace workflow", () => {
  const html = renderPage(ElectriciansPage);
  const wf = section(html, "data-workflow");

  test("variant is flow_circuit, rendered with four numbered nodes and the approved labels", () => {
    assert.equal(ELECTRICIANS_PAGE.presentation.workflow, "flow_circuit");
    assert.match(wf, /data-workflow-variant="flow_circuit"/);
    assert.match(wf, /data-workflow-motif="flow_circuit"/);
    assert.deepEqual(ELECTRICIANS_PAGE.workflow.nodes.map((n) => n.title), ["Call", "Classify", "Capture", "Route"]);
    assert.equal((wf.match(/<li /g) ?? []).length, 4);
    for (const [i] of ELECTRICIANS_PAGE.workflow.nodes.entries()) assert.match(wf, new RegExp(`font-mono[^>]*>${i + 1}<`));
  });

  test("the trace is orthogonal with node squares, decorative, aria-hidden, desktop-only; square markers; amber cues", () => {
    assert.match(wf, /<path d="M0 16 H125 V48/);
    assert.equal((wf.match(/<rect /g) ?? []).length, 4);
    assert.match(wf, /hidden lg:block pointer-events-none absolute[^"]*"[^>]*aria-hidden="true"/);
    assert.match(wf, /rounded border-2 border-white/);
    assert.doesNotMatch(wf, /rounded-full border-2 border-white/);
    assert.match(wf, /bg-amber-500/);
    assert.doesNotMatch(wf, /cyan/);
  });

  test("routing wording is truthful: KB-listed + time checked → booking request, otherwise flagged for review; classify is not a diagnosis", () => {
    const [, classify, , route] = ELECTRICIANS_PAGE.workflow.nodes;
    assert.match(classify.body, /as the caller describes it/);
    assert.match(classify.body, /not a diagnosis/);
    assert.match(route.body, /Knowledge Base lists and a time has been checked/);
    assert.match(route.body, /submits a booking request after the call/);
    assert.match(route.body, /flagged for your review/);
    assert.match(route.body, /never guesses whether you can take the job/);
    assert.match(ELECTRICIANS_PAGE.workflow.footnote, /doesn’t diagnose faults, certify work, decide what is safe, or send an electrician anywhere/);
  });
});

// ── 5. Not the same presentation ───────────────────────────────────

describe("the two workflows do not share a presentation", () => {
  test("different variant, different path geometry, different marker shape, different labels", () => {
    const p = section(renderPage(PlumbersPage), "data-workflow");
    const e = section(renderPage(ElectriciansPage), "data-workflow");
    assert.notEqual(PLUMBERS_PAGE.presentation.workflow, ELECTRICIANS_PAGE.presentation.workflow);
    assert.match(p, / C /);
    assert.doesNotMatch(p, /<rect /);
    assert.match(e, / H\d+ V\d+/);
    assert.doesNotMatch(e, / C /);
    assert.notDeepEqual(PLUMBERS_PAGE.workflow.nodes.map((n) => n.title), ELECTRICIANS_PAGE.workflow.nodes.map((n) => n.title));
    for (const node of PLUMBERS_PAGE.workflow.nodes) assert.ok(!ELECTRICIANS_PAGE.workflow.nodes.some((o) => o.body === node.body));
  });
});

// ── 6 & 7. Section order and CTA position ──────────────────────────

describe("section order is controlled, closed, and differs intentionally", () => {
  test("plumbers: hero → pain → workflow → mid CTA → capabilities → example → scan → how it works → FAQ → final", () => {
    assert.deepEqual(PLUMBERS_PAGE.presentation.section_order, ["pain", "workflow", "mid_cta", "capabilities", "example", "scan", "how_it_works", "faq"]);
    assert.deepEqual(renderedOrder(renderPage(PlumbersPage)), ["hero", "pain-points", "workflow", "mid-cta", "capabilities", "example", "scan", "how-it-works", "faq", "final-cta"]);
  });

  test("electricians: hero → workflow explainer → mid CTA → pain → capabilities → example → scan → how it works → FAQ → final", () => {
    assert.deepEqual(ELECTRICIANS_PAGE.presentation.section_order, ["workflow", "mid_cta", "pain", "capabilities", "example", "scan", "how_it_works", "faq"]);
    assert.deepEqual(renderedOrder(renderPage(ElectriciansPage)), ["hero", "workflow", "mid-cta", "pain-points", "capabilities", "example", "scan", "how-it-works", "faq", "final-cta"]);
  });

  test("the orders differ; hero is always first and the final CTA always last; every shared section still renders once", () => {
    assert.notDeepEqual(PLUMBERS_PAGE.presentation.section_order, ELECTRICIANS_PAGE.presentation.section_order);
    for (const Page of [PlumbersPage, ElectriciansPage]) {
      const order = renderedOrder(renderPage(Page));
      assert.equal(order[0], "hero");
      assert.equal(order[order.length - 1], "final-cta");
      for (const id of ["pain-points", "capabilities", "example", "scan", "how-it-works", "faq"]) {
        assert.equal(order.filter((x) => x === id).length, 1, id);
      }
    }
  });

  test("a page with no section_order renders the default order, no workflow and no mid CTA — exactly the pre-Slice-3 page", () => {
    const { presentation, workflow: _w, mid_cta: _m, ...rest } = PLUMBERS_PAGE;
    void _w; void _m;
    const html = renderView({ ...rest, presentation: { theme: presentation.theme, hero_visual: presentation.hero_visual, pain_layout: presentation.pain_layout } });
    assert.deepEqual(renderedOrder(html), ["hero", "pain-points", "capabilities", "example", "scan", "how-it-works", "faq", "final-cta"]);
    assert.doesNotMatch(html, /data-workflow|data-mid-cta/);
    assert.deepEqual([...DEFAULT_SECTION_ORDER], ["pain", "capabilities", "example", "scan", "how_it_works", "faq"]);
  });

  test("an order that omits a shared section still renders it (appended), and a motif without data renders no workflow", () => {
    const html = renderView({ ...PLUMBERS_PAGE, presentation: { ...PLUMBERS_PAGE.presentation, section_order: ["workflow", "pain"] } });
    assert.deepEqual(renderedOrder(html), ["hero", "workflow", "pain-points", "capabilities", "example", "scan", "how-it-works", "faq", "final-cta"]);
    const { workflow: _w, ...noData } = PLUMBERS_PAGE;
    void _w;
    assert.doesNotMatch(renderView(noData), /data-workflow/);
  });

  test("the mid-page Scan CTA sits immediately after the workflow on both pages, with trade framing", () => {
    for (const [Page, page, framing] of [
      [PlumbersPage, PLUMBERS_PAGE, "See where your plumbing jobs are being lost"],
      [ElectriciansPage, ELECTRICIANS_PAGE, "See which enquiries your electrical business is losing"],
    ]) {
      const html = renderPage(Page);
      const order = renderedOrder(html);
      assert.equal(order[order.indexOf("workflow") + 1], "mid-cta");
      assert.equal(page.mid_cta.heading, framing);
      const mid = section(html, "data-mid-cta");
      assert.ok(mid.includes(framing));
      assert.match(mid, /data-mid-cta-link/);
    }
    // Plumbers: after the pain timeline; electricians: before the pain contrast (the higher position).
    const p = renderedOrder(renderPage(PlumbersPage));
    const e = renderedOrder(renderPage(ElectriciansPage));
    assert.ok(p.indexOf("mid-cta") > p.indexOf("pain-points"));
    assert.ok(e.indexOf("mid-cta") < e.indexOf("pain-points"));
  });
});

// ── 8 & 9. Scan href and indigo CTA unchanged ─────────────────────

describe("the Scan destination and CTA styling are unchanged", () => {
  test("every Scan CTA — hero, mid-page, scan section, final — points at the bare Scan path", () => {
    for (const [Page, page] of [[PlumbersPage, PLUMBERS_PAGE], [ElectriciansPage, ELECTRICIANS_PAGE]]) {
      const html = renderPage(Page);
      assert.equal(page.mid_cta.href, "/free-tools/business-opportunity-scan");
      const hrefs = [...html.matchAll(/<a [^>]*data-(primary-cta|mid-cta-link|scan-cta|final-cta-link)[^>]*>/g)].map((m) => [m[1], m[0].match(/href="([^"]+)"/)[1]]);
      assert.deepEqual(hrefs, [
        ["primary-cta", "/free-tools/business-opportunity-scan"],
        ["mid-cta-link", "/free-tools/business-opportunity-scan"],
        ["scan-cta", "/free-tools/business-opportunity-scan"],
        ["final-cta-link", "/free-tools/business-opportunity-scan"],
      ]);
      for (const [, href] of hrefs) assert.ok(!href.includes("?") && !href.includes("#"));
    }
  });

  test("the mid-page CTA uses the same indigo primary button; no theme colour reaches any CTA", () => {
    for (const Page of [PlumbersPage, ElectriciansPage]) {
      const html = renderPage(Page);
      for (const attr of ["data-primary-cta", "data-mid-cta-link", "data-scan-cta"]) {
        const a = html.match(new RegExp(`<a [^>]*${attr}[^>]*>`))[0];
        assert.match(a, /bg-indigo-600/, attr);
        assert.doesNotMatch(a, /cyan|amber/, attr);
      }
    }
  });
});

// ── 10–12. Wording and truthfulness ────────────────────────────────

describe("workflow and mid-CTA copy belongs to its trade and claims no completed outcome", () => {
  test("plumbers workflow + mid CTA: plumbing wording, no electrical wording", () => {
    const html = renderPage(PlumbersPage);
    const text = textOf(section(html, "data-workflow") + section(html, "data-mid-cta"));
    assert.match(text, PLUMBING);
    assert.doesNotMatch(text, ELECTRICAL, text.match(ELECTRICAL)?.[0]);
  });

  test("electricians workflow + mid CTA: electrical wording, no plumbing wording", () => {
    const html = renderPage(ElectriciansPage);
    const text = textOf(section(html, "data-workflow") + section(html, "data-mid-cta"));
    assert.match(text, ELECTRICAL);
    assert.doesNotMatch(text, PLUMBING, text.match(PLUMBING)?.[0]);
  });

  test("nowhere on either whole page is Remy said to have booked, dispatched, diagnosed, certified, repaired, made safe or guaranteed attendance", () => {
    for (const Page of [PlumbersPage, ElectriciansPage]) {
      const text = textOf(renderPage(Page));
      assert.doesNotMatch(text, REMY_ACTED, text.match(REMY_ACTED)?.[0]);
    }
  });
});

// ── 13 & 14. Slice 1 and Slice 2 intact ────────────────────────────

describe("Slice 1 heroes and Slice 2 pain stories are untouched", () => {
  test("plumbers: job_ticket + cyan hero, timeline pain with four stages", () => {
    const html = renderPage(PlumbersPage);
    const hero = section(html, "data-hero");
    assert.match(hero, /data-hero-visual="job_ticket"/);
    assert.match(hero, /ring-cyan-400\/30/);
    assert.match(textOf(hero), /Never Miss Another\s+Plumbing Job/);
    assert.match(hero, /Booking request submitted — look out for the confirmation email/);
    const pain = section(html, "data-pain-points");
    assert.match(pain, /data-pain-layout-mode="timeline"/);
    assert.equal((pain.match(/<li /g) ?? []).length, 4);
    assert.match(pain, /data-timeline-outcome/);
  });

  test("electricians: enquiry_panel + amber hero, contrast pain with two panels", () => {
    const html = renderPage(ElectriciansPage);
    const hero = section(html, "data-hero");
    assert.match(hero, /data-hero-visual="enquiry_panel"/);
    assert.match(hero, /ring-amber-400\/30/);
    assert.match(textOf(hero), /Every Electrical Enquiry,\s+Captured While You’re On Site/);
    assert.equal((hero.match(/data-active="true"/g) ?? []).length, 1);
    assert.match(hero, /not a diagnosis/);
    const pain = section(html, "data-pain-points");
    assert.match(pain, /data-pain-layout-mode="contrast"/);
    assert.match(pain, /data-contrast-columns/);
    assert.match(pain, />Domestic</);
    assert.match(pain, />Commercial</);
  });
});

// ── 15 & 16. Isolation ─────────────────────────────────────────────

describe("nothing outside the marketing surface knows about Slice 3", () => {
  test("no workflow, section-order or mid-CTA reference in Remy core, routes, registry, structured data or the homepage", () => {
    for (const file of [
      "src/lib/voice/assistant.ts",
      "src/lib/voice/calls.ts",
      "src/lib/voice/vapi.ts",
      "src/lib/voice/handler.ts",
      "src/lib/site/publicRoutes.ts",
      "src/lib/site/structuredData.ts",
      "src/app/page.tsx",
      "src/app/ai-receptionist-for-plumbers/page.tsx",
      "src/app/ai-receptionist-for-electricians/page.tsx",
    ]) {
      assert.doesNotMatch(stripComments(read(file)), /flow_curve|flow_circuit|section_order|mid_cta|IndustryWorkflow|WorkflowSection|DEFAULT_SECTION_ORDER/, file);
    }
  });

  test("metadata, canonical and JSON-LD unchanged; no client JS; theme classes literal", () => {
    assert.equal(plumbersMetadata.alternates.canonical, "/ai-receptionist-for-plumbers");
    assert.equal(electriciansMetadata.alternates.canonical, "/ai-receptionist-for-electricians");
    for (const [Page, page] of [[PlumbersPage, PLUMBERS_PAGE], [ElectriciansPage, ELECTRICIANS_PAGE]]) {
      const html = renderPage(Page);
      const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
      assert.equal(blocks.length, 1);
      const [webPage, faq] = JSON.parse(blocks[0].replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""))["@graph"];
      assert.equal(webPage.url, `https://niteowlhq.com${page.path}`);
      assert.equal(faq.mainEntity.length, page.faqs.length);
      assert.doesNotMatch(blocks[0], /workflow|mid_cta|section_order/);
    }
    const view = stripComments(read("src/components/marketing/IndustryPageView.tsx"));
    assert.doesNotMatch(view, /"use client"|useState|useEffect/);
    assert.doesNotMatch(view, /`(bg|text|ring|border)-\$\{/);
  });
});
