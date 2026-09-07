// The Setup Kit derivation must DERIVE, never invent.
//
// `buildReceptionistSetup` turns what a visitor typed into the setup
// they read. Everything it produces is a real-world instruction someone
// may act on — who to call, what counts as urgent, what to collect — so
// the property that matters is not that it looks good but that **every
// line traces back to an answer the visitor actually gave.**
//
// Two failure modes are worth more than the rest combined:
//
//   INVENTION — a default opening-hours block, an assumed service, a
//   plausible "most businesses also…" filler. That is a fabricated fact
//   about a real business, presented to its owner as their own setup.
//
//   FALSE AUTHORITY — wording that reads as verified. Everything here is
//   text typed into a public form by an unauthenticated visitor; §26
//   requires it to stay `business_provided` and never become `verified`.
//
// The boundary tests at the end are structural rather than behavioural:
// they assert what the free-tools namespace is allowed to IMPORT. A
// pure function that cannot reach a tenant cannot leak one, and that
// property is only worth anything if something enforces it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  COLLECT_FIELD_LABELS,
  buildReceptionistSetup,
  cleanQuestions,
  emptyProfile,
} from "@/lib/freetools/setupKit";

/** A fully answered profile — the happy path. */
const FULL = {
  businessName: "Bright Spark Electrical",
  businessType: "Electrician",
  description: "Domestic and small commercial electrical work in Galway.",
  openingHours: "Monday to Friday 8am–6pm, Saturday mornings by arrangement",
  services: ["Rewiring", "Fault finding", "EV charger installation"],
  commonQuestions: [
    { question: "Do you charge for a callout?", answer: "First 15 minutes free." },
    { question: "Do you work weekends?", answer: "Saturday mornings only." },
  ],
  collectFields: ["name", "phone", "address", "reason"],
  acceptsAppointments: true,
  appointmentRules: "At least one day's notice. Never book same-day rewiring.",
  outOfHours: "Take a message and call back the next working morning.",
  urgentCriteria: "Anything sparking, burning or with no power at all.",
  escalation: "Ring Dave directly on the mobile for anything urgent.",
};

const sectionById = (setup, id) =>
  setup.sections.find((s) => s.id === id) ?? null;
const allText = (setup) =>
  setup.sections
    .flatMap((s) => [s.title, ...s.lines, s.note ?? ""])
    .join("\n");

// ── 1. It derives what was given ───────────────────────────────────

describe("the setup reflects what the visitor entered", () => {
  test("a fully answered profile produces every section", () => {
    const setup = buildReceptionistSetup(FULL);
    for (const id of [
      "overview",
      "hours",
      "services",
      "questions",
      "collect",
      "appointments",
      "out-of-hours",
      "escalation",
    ]) {
      assert.ok(sectionById(setup, id), `missing section: ${id}`);
    }
    assert.equal(setup.completedSections, 8);
    assert.equal(setup.totalSections, 8);
  });

  test("the business name is echoed, not reworded", () => {
    const setup = buildReceptionistSetup(FULL);
    assert.equal(setup.businessName, "Bright Spark Electrical");
  });

  test("services appear exactly as typed, in order", () => {
    const setup = buildReceptionistSetup(FULL);
    assert.deepEqual(sectionById(setup, "services").lines, [
      "Rewiring",
      "Fault finding",
      "EV charger installation",
    ]);
  });

  test("opening hours are preserved verbatim, not parsed into a schedule", () => {
    const setup = buildReceptionistSetup(FULL);
    assert.deepEqual(sectionById(setup, "hours").lines, [FULL.openingHours]);
  });

  test("questions pair with their own answers", () => {
    const lines = sectionById(buildReceptionistSetup(FULL), "questions").lines;
    assert.equal(lines[0], "Do you charge for a callout? — First 15 minutes free.");
    assert.equal(lines.length, 2);
  });

  test("collected details render in a stable order, not tick order", () => {
    const shuffled = { ...FULL, collectFields: ["reason", "phone", "name", "address"] };
    assert.deepEqual(
      sectionById(buildReceptionistSetup(shuffled), "collect").lines,
      [
        COLLECT_FIELD_LABELS.name,
        COLLECT_FIELD_LABELS.phone,
        COLLECT_FIELD_LABELS.address,
        COLLECT_FIELD_LABELS.reason,
      ]
    );
  });

  test("whitespace-only answers are treated as absent", () => {
    const padded = {
      ...emptyProfile(),
      businessName: "  Acme  ",
      openingHours: "   ",
      services: ["  Rewiring  ", "   ", ""],
    };
    const setup = buildReceptionistSetup(padded);
    assert.equal(setup.businessName, "Acme");
    assert.equal(sectionById(setup, "hours"), null, "blank hours produce no section");
    assert.deepEqual(sectionById(setup, "services").lines, ["Rewiring"]);
  });

  test("a half-finished question pair is dropped, never half-rendered", () => {
    assert.deepEqual(
      cleanQuestions([
        { question: "Do you charge?", answer: "" },
        { question: "", answer: "Yes" },
        { question: "Weekends?", answer: "Saturday mornings." },
      ]),
      [{ question: "Weekends?", answer: "Saturday mornings." }]
    );
  });

  test("the same profile always yields the same setup — pure", () => {
    assert.deepEqual(
      buildReceptionistSetup(FULL),
      buildReceptionistSetup(FULL),
      "no clock, no randomness, no hidden state"
    );
  });

  test("it does not mutate the profile it was given", () => {
    const before = JSON.parse(JSON.stringify(FULL));
    buildReceptionistSetup(FULL);
    assert.deepEqual(FULL, before);
  });
});

// ── 2. It invents nothing ──────────────────────────────────────────

describe("an unanswered question produces no answer", () => {
  test("an empty profile invents no hours, services or questions", () => {
    const setup = buildReceptionistSetup(emptyProfile());
    for (const id of ["overview", "hours", "services", "questions", "collect", "escalation"]) {
      assert.equal(sectionById(setup, id), null, `${id} was invented from nothing`);
    }
  });

  test("an empty profile still says something true about appointments", () => {
    // The one always-present section, because BOTH answers are
    // meaningful — "we don't take bookings" is real guidance.
    const setup = buildReceptionistSetup(emptyProfile());
    assert.equal(setup.sections.length, 1);
    assert.equal(setup.sections[0].id, "appointments");
    assert.match(setup.sections[0].lines[0], /does not take appointment/i);
    assert.equal(setup.completedSections, 1);
  });

  test("no output line contains text the visitor never supplied", () => {
    // The strongest anti-invention check: every LINE (notes excluded,
    // they are NiteOwl's own advice) must be built from profile input.
    const setup = buildReceptionistSetup(FULL);
    const supplied = [
      FULL.businessName,
      FULL.businessType,
      FULL.description,
      FULL.openingHours,
      ...FULL.services,
      ...FULL.commonQuestions.flatMap((q) => [q.question, q.answer]),
      ...FULL.collectFields.map((f) => COLLECT_FIELD_LABELS[f]),
      FULL.appointmentRules,
      FULL.outOfHours,
      FULL.urgentCriteria,
      FULL.escalation,
    ];
    for (const section of setup.sections) {
      for (const line of section.lines) {
        const traced =
          supplied.some((v) => line.includes(v)) ||
          // The one generated line, and it is a statement about the
          // ANSWER given, not a claim about the business.
          /takes appointment and booking enquiries/i.test(line);
        assert.ok(traced, `untraceable line: ${line}`);
      }
    }
  });

  test("a missing booking rule is reported as missing, never filled in", () => {
    const setup = buildReceptionistSetup({
      ...emptyProfile(),
      acceptsAppointments: true,
    });
    const section = sectionById(setup, "appointments");
    assert.equal(section.lines.length, 1, "no invented rule");
    assert.match(section.note, /did not give any booking rules/i);
  });

  test("no note ever asserts a fact about the business", () => {
    const setup = buildReceptionistSetup(FULL);
    for (const section of setup.sections) {
      if (!section.note) continue;
      assert.doesNotMatch(
        section.note,
        /your business is|we found|we detected|verified/i,
        `note asserts something: ${section.note}`
      );
    }
  });
});

// ── 3. Nothing is presented as verified ────────────────────────────

describe("the setup never claims verification or benchmarks", () => {
  test("no verification language anywhere in the output", () => {
    const text = allText(buildReceptionistSetup(FULL));
    assert.doesNotMatch(
      text,
      /verified|confirmed by|we checked|validated|authenticated/i
    );
  });

  test("no cohort or benchmark claim", () => {
    // §26 forbids "businesses like yours report X" over unverified
    // form input — the "sales figure, not a finding" failure.
    const text = allText(buildReceptionistSetup(FULL));
    assert.doesNotMatch(
      text,
      /businesses like|compared to|industry average|benchmark|better than|score/i
    );
  });

  test("completeness is a plain count, not a grade", () => {
    const setup = buildReceptionistSetup(FULL);
    assert.equal(typeof setup.completedSections, "number");
    assert.ok(!("score" in setup) && !("grade" in setup) && !("rating" in setup));
  });
});

// ── 4. The architectural boundary ──────────────────────────────────

describe("the free-tools namespace cannot reach Remy or a tenant", () => {
  const FREE_TOOL_FILES = [
    "src/lib/freetools/types.ts",
    "src/lib/freetools/setupKit.ts",
    "src/app/free-tools/page.tsx",
    "src/app/free-tools/layout.tsx",
    "src/app/free-tools/ai-receptionist-setup-kit/page.tsx",
    "src/app/free-tools/ai-receptionist-setup-kit/SetupKitClient.tsx",
  ];

  /** Import statements only — comments discussing Remy are fine. */
  const importsOf = (file) =>
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((l) => /^\s*import\s/.test(l) || /^\s*}?\s*from\s+["']/.test(l))
      .join("\n");

  test("no Remy, provider or database import", () => {
    for (const file of FREE_TOOL_FILES) {
      assert.doesNotMatch(
        importsOf(file),
        /leadCapture|lib\/voice|availability|bookingAvailability|calendarSync|integrations|supabase|@supabase|lib\/email|parseDatetime/,
        `${file} imports something it must not`
      );
    }
  });

  test("no persistence, no network, no identifiers", () => {
    for (const file of FREE_TOOL_FILES) {
      const src = readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)) // strip comments
        .join("\n");
      assert.doesNotMatch(
        src,
        /localStorage|sessionStorage|document\.cookie|indexedDB|fetch\(|XMLHttpRequest|randomUUID|process\.env/,
        `${file} reaches for storage, network or an identifier`
      );
    }
  });

  test("the derivation carries no org_id concept at all", () => {
    // The free-product surface is the only NiteOwl surface that
    // legitimately has no org_id. If one appears here, the structural
    // isolation has quietly become a query-discipline problem instead.
    for (const file of ["src/lib/freetools/types.ts", "src/lib/freetools/setupKit.ts"]) {
      const src = readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n");
      assert.doesNotMatch(src, /org_id|orgId|tenant/i, `${file} introduces a tenant concept`);
    }
  });

  test("the profile type stays provider-neutral", () => {
    const src = readFileSync("src/lib/freetools/types.ts", "utf8");
    assert.doesNotMatch(
      src.replace(/^\s*(\/\/|\*).*$/gm, ""),
      /google|vapi|openai|resend|stripe|calendar_id|structuredData/i
    );
  });
});
