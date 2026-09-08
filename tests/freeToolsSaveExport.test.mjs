// Phase 3: the visitor must be able to KEEP the generated setup.
//
// The property that matters is not that a button exists. It is that the
// thing which reaches paper is the derived setup and nothing else:
//
//   IT MUST CARRY the branding, the document title, the business name,
//   every derived section, and the notice saying none of it is verified.
//   A saved PDF outlives its tab and gets read out of context, which is
//   exactly when unverified form input is mistaken for a record.
//
//   IT MUST NOT CARRY the wizard's furniture — progress bars, Back,
//   Start again, All free tools, or instructions about which button to
//   press. A document that prints its own UI is a screenshot.
//
//   IT MUST NOT INVENT. Phase 2's rule is that the derivation derives
//   and never recommends. Phase 3 adds a rendering, and a rendering is
//   a new place invention could enter, so the document is checked
//   against the derivation's own output rather than eyeballed.
//
// These render the REAL exported document through react-dom/server, on
// a REAL profile put through the REAL derivation. Asserting over the
// source text would only prove the file mentions a heading — the PR #34
// lesson, which generalises past Remy: a test that inspects the code
// cannot prove what the code produces.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildReceptionistSetup } from "@/lib/freetools/setupKit";
import { SetupDocument } from "@/app/free-tools/ai-receptionist-setup-kit/SetupKitClient";

const CLIENT = "src/app/free-tools/ai-receptionist-setup-kit/SetupKitClient.tsx";
const LAYOUT = "src/app/free-tools/layout.tsx";
const PRINT_CSS = "src/app/free-tools/print.css";

const read = (f) => readFileSync(f, "utf8");

/** CSS with block comments removed. The file's own header comment
 *  discusses "@media print", and would otherwise be found instead of
 *  the rule — a parse bug that reads exactly like a source defect. */
const cssRules = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, "");
/** Source with comments removed, so prose about the code is never
 *  mistaken for the code. */
const code = (f) =>
  read(f)
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

const printBlockOf = (f) => {
  const css = cssRules(f);
  return css.slice(css.indexOf("@media print"));
};

/** A fully answered profile — the document at its richest. */
const fullProfile = () => ({
  businessName: "Oakland Plumbing",
  businessType: "Plumber",
  description: "Domestic plumbing and heating across the west of the city.",
  openingHours: "Monday to Friday 8am to 6pm, Saturday mornings by arrangement",
  services: ["Leak repair", "Boiler servicing", "Bathroom installation"],
  commonQuestions: [
    { question: "Do you charge a call-out fee?", answer: "Yes, 45 euro." },
    { question: "How fast can you come out?", answer: "Same day for leaks." },
  ],
  collectFields: ["name", "phone", "address", "reason"],
  acceptsAppointments: true,
  appointmentRules: "Never book the last slot on a Friday without asking Tom.",
  outOfHours: "Take a message and text Tom if there is water coming in.",
  urgentCriteria: "Burst pipes, no heating for an elderly customer.",
  escalation: "Anything involving a commercial contract goes to Tom.",
});

const renderDoc = (profile) => {
  const setup = buildReceptionistSetup(profile);
  return { setup, html: renderToStaticMarkup(createElement(SetupDocument, { setup })) };
};

/** Visible text, with markup and entities out of the way. */
const textOf = (html) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

describe("the saved document carries what a business document must", () => {
  test("NiteOwl branding and the document title", () => {
    const { html } = renderDoc(fullProfile());
    const text = textOf(html);
    assert.match(text, /niteowl/i, "no NiteOwl branding in the document");
    assert.match(
      text,
      /AI Receptionist Business Setup/,
      "the document does not name what it is"
    );
  });

  test("the business name", () => {
    const { html } = renderDoc(fullProfile());
    assert.match(textOf(html), /Oakland Plumbing/);
  });

  test("every derived section title and every derived line", () => {
    const { setup, html } = renderDoc(fullProfile());
    const text = textOf(html);

    assert.ok(setup.sections.length >= 7, "fixture should fill most sections");
    for (const section of setup.sections) {
      assert.ok(
        text.includes(section.title),
        `section "${section.title}" is missing from the document`
      );
      for (const line of section.lines) {
        assert.ok(
          text.includes(line.replace(/\s+/g, " ")),
          `line "${line}" is missing from the document`
        );
      }
      if (section.note) {
        assert.ok(text.includes(section.note), `note missing: ${section.note}`);
      }
    }
  });

  test("the unverified notice prints — it is not marked screen-only", () => {
    const { html } = renderDoc(fullProfile());
    assert.match(textOf(html), /Nothing here has been\s+verified/);

    // The notice must not sit inside a screen-only element. Find its
    // element and prove the print stylesheet will not hide it.
    const notice = html.match(/<p class="([^"]*ft-doc-notice[^"]*)"/);
    assert.ok(notice, "the notice carries no ft-doc-notice hook");
    assert.doesNotMatch(
      notice[1],
      /ft-no-print/,
      "the unverified notice would be dropped from the saved copy"
    );
  });

  test("an empty profile still produces a document, and still warns", () => {
    // The floor case: a visitor who typed only a name. The branding,
    // title and notice are structural and must survive it.
    const { html } = renderDoc({
      ...fullProfile(),
      businessType: "",
      description: "",
      openingHours: "",
      services: [],
      commonQuestions: [],
      collectFields: [],
      acceptsAppointments: false,
      appointmentRules: "",
      outOfHours: "",
      urgentCriteria: "",
      escalation: "",
    });
    const text = textOf(html);
    assert.match(text, /AI Receptionist Business Setup/);
    assert.match(text, /Oakland Plumbing/);
    assert.match(text, /Nothing here has been\s+verified/);
  });
});

describe("the saved document carries none of the web UI", () => {
  test("no wizard navigation, progress bar or free-tools links", () => {
    const { html } = renderDoc(fullProfile());
    const text = textOf(html);

    for (const control of [
      "Back to answers",
      "Start again",
      "All free tools",
      "Generate my setup",
      "Save as PDF",
      "Step 1 of",
    ]) {
      assert.ok(
        !text.includes(control),
        `"${control}" is web-UI furniture and must not be in the document`
      );
    }
    assert.doesNotMatch(html, /role="progressbar"/);
    assert.doesNotMatch(html, /<button/, "a printed document has no buttons");
    assert.doesNotMatch(html, /<a\s/, "a printed document has no navigation");
  });

  test("no instruction about how to use the browser", () => {
    // "Choose Save as PDF in the destination list" is help for someone
    // at a keyboard. On paper it is noise.
    const { html } = renderDoc(fullProfile());
    assert.doesNotMatch(
      textOf(html),
      /print window|destination|browser|click|press/i
    );
  });

  test("the screen-only eyebrow is marked, and the print masthead is", () => {
    const { html } = renderDoc(fullProfile());
    assert.match(
      html,
      /class="ft-no-print[^"]*"[^>]*>\s*Your receptionist setup/,
      "the on-screen eyebrow would print"
    );
    assert.match(html, /ft-print-only ft-print-header/);
    assert.match(html, /ft-print-only ft-print-footer/);
  });
});

describe("the document renders the derivation and adds nothing to it", () => {
  test("every list item is a line the derivation produced", () => {
    // The invention check. Phase 2 proves the derivation invents
    // nothing; this proves the RENDERING does not either, which is a
    // separate claim now that a second layer exists.
    const { setup, html } = renderDoc(fullProfile());
    const derived = new Set(setup.sections.flatMap((s) => s.lines));

    const items = [...html.matchAll(/<li[^>]*>(.*?)<\/li>/gs)].map((m) =>
      textOf(m[1])
    );
    assert.ok(items.length > 0, "no lines rendered at all");
    for (const item of items) {
      assert.ok(
        [...derived].some((line) => textOf(line) === item),
        `the document shows a line the derivation never produced: "${item}"`
      );
    }
  });

  test("no advice, recommendation or invented policy in the chrome", () => {
    const { html } = renderDoc(fullProfile());
    assert.doesNotMatch(
      textOf(html),
      /we recommend|you should|best practice|most businesses|treat it as urgent unless|consider adding/i
    );
  });
});

describe("saving uses the browser, not a library and not a server", () => {
  test("the action calls the browser's own print pipeline", () => {
    // Comment-stripped, because the file's own header explains the
    // window.print() decision and would otherwise be counted as a
    // second call site — a parse bug that reads like a source defect.
    const src = code(CLIENT);
    assert.match(
      src,
      /onClick=\{\(\) => window\.print\(\)\}/,
      "the save action does not call window.print()"
    );
    assert.equal(
      (src.match(/window\.print\(\)/g) || []).length,
      1,
      "exactly one print entry point is expected"
    );
    assert.match(src, />\s*Save as PDF\s*</, "the action is not labelled");
  });

  test("the action block itself never prints", () => {
    // The buttons and the how-to-save help live in the result view, not
    // in SetupDocument, so only the source can show they are marked
    // screen-only. If this container lost its hook, the saved PDF would
    // end with "Save as PDF / Back to answers / Start again".
    const src = code(CLIENT);
    assert.match(
      src,
      /<div className="ft-no-print border-t border-slate-800 mt-10 pt-6">/,
      "the action block would print"
    );
    assert.match(
      src,
      /<div className="ft-doc max-w-3xl/,
      "the result container lost its document hook"
    );
  });

  test("no PDF library was added as a dependency", () => {
    const pkg = JSON.parse(read("package.json"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const banned of [
      "jspdf",
      "html2pdf.js",
      "html2canvas",
      "pdfmake",
      "pdf-lib",
      "@react-pdf/renderer",
      "puppeteer",
      "playwright",
    ]) {
      assert.ok(!(banned in deps), `${banned} was added for one button`);
    }
  });

  test("the client still imports only React, next/link and the derivation", () => {
    const imports = read(CLIENT)
      .split(/\r?\n/)
      .filter((l) => /^\s*import\s/.test(l) || /^\s*}?\s*from\s+["']/.test(l))
      .join("\n");
    assert.doesNotMatch(
      imports,
      /leadCapture|lib\/voice|availability|calendarSync|integrations|supabase|@supabase|lib\/email|jspdf|html2|pdf/i
    );
    assert.match(imports, /@\/lib\/freetools\/setupKit/);
  });
});

describe("the print stylesheet does what the document assumes", () => {
  test("print-only content is hidden on screen", () => {
    const beforeMedia = cssRules(PRINT_CSS).split("@media print")[0];
    assert.match(
      beforeMedia,
      /\.ft-print-only\s*\{\s*display:\s*none/,
      "the print masthead would show on screen"
    );
  });

  test("screen-only content is hidden in print", () => {
    const printBlock = printBlockOf(PRINT_CSS);
    assert.match(printBlock, /\.ft-no-print\s*\{\s*display:\s*none\s*!important/);
    assert.match(printBlock, /\.ft-print-only\s*\{\s*display:\s*block\s*!important/);
  });

  test("the page is restyled as a document rather than printed dark", () => {
    const printBlock = printBlockOf(PRINT_CSS);
    assert.match(printBlock, /\.ft-surface\s*\{[^}]*background:\s*#ffffff/i);
    assert.match(printBlock, /@page\s*\{[^}]*margin/);
    // BOTH spellings, checked separately. `break-inside` is the modern
    // property and `page-break-inside` the legacy one print engines
    // still honour. A regex for the former alone silently matches the
    // latter, so dropping the modern property looked like a pass —
    // caught by mutation, and the test is what was wrong.
    const section = printBlock.match(/\.ft-doc-section\s*\{([^}]*)\}/s);
    assert.ok(section, "no .ft-doc-section rule at all");
    assert.match(section[1], /(^|[^-])break-inside:\s*avoid/m);
    assert.match(section[1], /page-break-inside:\s*avoid/);
  });

  test("every rule is scoped so it cannot leak to another route", () => {
    // Next keeps a nested layout's stylesheet loaded after navigation,
    // so an unscoped rule would follow the visitor into the rest of the
    // site. @page is the one document-level rule, and it sets margins.
    const printBlock = printBlockOf(PRINT_CSS);
    const selectors = [...printBlock.matchAll(/^\s{2}([^{@\s][^{]*)\{/gm)].map(
      (m) => m[1].trim()
    );
    assert.ok(selectors.length > 0, "no selectors found — check the parse");
    for (const selector of selectors) {
      assert.match(
        selector,
        /\.ft-/,
        `"${selector}" is unscoped and would affect the whole site`
      );
    }
  });

  test("the site chrome is marked as screen-only in the layout", () => {
    const layout = read(LAYOUT);
    assert.match(layout, /<nav className="ft-no-print/);
    assert.match(layout, /<footer className="ft-no-print/);
    assert.match(layout, /className="ft-surface/);
    assert.match(layout, /import "\.\/print\.css"/);
  });
});

describe("Phase 3 keeps the Phase 2 privacy boundary", () => {
  const CHANGED = [CLIENT, LAYOUT];

  test("no persistence, no network, no identifiers in the changed files", () => {
    for (const file of CHANGED) {
      const src = read(file)
        .split(/\r?\n/)
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n");
      assert.doesNotMatch(
        src,
        /localStorage|sessionStorage|document\.cookie|indexedDB|fetch\(|XMLHttpRequest|randomUUID|process\.env|navigator\.sendBeacon/,
        `${file} reaches for storage, network or an identifier`
      );
    }
  });

  test("no analytics or conversion tracking rode along", () => {
    for (const file of [...CHANGED, PRINT_CSS]) {
      assert.doesNotMatch(
        read(file),
        /gtag|googletagmanager|dataLayer|posthog|mixpanel|segment\.io|plausible|hotjar|fbq/i,
        `${file} carries tracking`
      );
    }
  });

  test("the stylesheet fetches nothing from outside", () => {
    // A webfont @import or a remote background image is an external
    // network call made on the visitor's behalf, which this surface
    // does not make — and printing must not be the exception.
    const css = read(PRINT_CSS);
    assert.doesNotMatch(css, /@import/);
    assert.doesNotMatch(css, /url\(\s*['"]?(https?:)?\/\//i);
  });

  test("no account, sign-in or email-it-to-me crept into the result", () => {
    const src = read(CLIENT).replace(/^\s*(\/\/|\*).*$/gm, "");
    assert.doesNotMatch(src, /sign in|sign up|create an account|email me a copy/i);
  });
});
