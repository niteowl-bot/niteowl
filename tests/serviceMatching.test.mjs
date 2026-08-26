// A caller says "plumber"; the Knowledge Base says "plumbing".
//
// Those are the same trade, and the booking gate used to refuse the
// call — `"plumbing".includes("plumber")` is false, because the two
// words diverge at the sixth character. Proven in production on
// 2026-08-26: a live caller asking for a plumber was correctly told
// 10:00 was free, then never reached the calendar-backed booking path,
// and the lead settled at awaiting_confirmation with no calendar event.
//
// The fix is MORPHOLOGY ONLY — a fixed suffix table with per-rule
// minimum stem lengths. These tests pin down both halves of that:
// the stems themselves (where the safety argument lives), and the
// matcher's behaviour against a realistic Knowledge Base.
//
// The stem table's minimums are what stop this becoming fuzzy matching.
// "shower" must never become "show", and "dental" must never become
// "dent", or a trade would start matching Knowledge Base text that has
// nothing to do with it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  isServiceConfirmedByKnowledge,
  stemServiceWord,
} from "@/lib/leadCapture";

const ORG_ID = "11111111-1111-4111-8111-111111111111";

/** The live Niteowl Test "Plumbing" record, verbatim. */
const PLUMBING_RECORD = {
  title: "Plumbing",
  content:
    "We provide plumbing call-outs and plumbing repair services, including " +
    "general plumbing problems, leaks, burst pipes and related plumbing work. " +
    "Customers can request an appointment for plumbing services.\n\n" +
    "Common plumbing problems we attend to include leaking and leaky pipes, " +
    "dripping or broken taps, blocked or leaking toilets, showers that leak or " +
    "will not run, radiators that leak or will not heat up, and boilers that " +
    "leak or lose pressure. We cover radiators, pipes, taps, toilets, showers " +
    "and boilers.",
};

/** A second trade, to prove one business's terms cannot claim another's. */
const ELECTRICAL_RECORD = {
  title: "Electrical",
  content:
    "We carry out electrical work, including sockets, lighting and consumer units.",
};

/** Minimal Supabase double: only what isServiceConfirmedByKnowledge uses. */
function knowledgeBase(records, { fail = false } = {}) {
  return {
    from() {
      const result = fail
        ? { data: null, error: { message: "boom" } }
        : { data: records, error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        then: (resolve) => resolve(result),
      };
      return chain;
    },
  };
}

const plumbingKb = () => knowledgeBase([PLUMBING_RECORD]);

async function matches(phrase, kb = plumbingKb()) {
  return isServiceConfirmedByKnowledge(kb, ORG_ID, phrase);
}

describe("stemServiceWord — the safety table", () => {
  test("the plumbing family collapses to one stem", () => {
    for (const w of ["plumber", "plumbers", "plumbing"]) {
      assert.equal(stemServiceWord(w), "plumb", `${w} → plumb`);
    }
  });

  test("the electrical family collapses to one stem", () => {
    for (const w of ["electrician", "electricians", "electrical", "electric"]) {
      assert.equal(stemServiceWord(w), "electric", `${w} → electric`);
    }
  });

  test("the leak family collapses to one stem", () => {
    for (const w of ["leak", "leaks", "leaking", "leaky"]) {
      assert.equal(stemServiceWord(w), "leak", `${w} → leak`);
    }
  });

  test("plurals and their singulars agree", () => {
    const pairs = [
      ["radiators", "radiator"],
      ["boilers", "boiler"],
      ["toilets", "toilet"],
      ["showers", "shower"],
      ["pipes", "pipe"],
      ["taps", "tap"],
      ["cleaners", "cleaner"],
    ];
    for (const [plural, singular] of pairs) {
      assert.equal(
        stemServiceWord(plural),
        stemServiceWord(singular),
        `${plural} and ${singular} must share a stem`
      );
    }
  });

  test("minimum stem lengths stop dangerous over-stemming", () => {
    // Each of these WOULD be chopped by a naive suffix stripper, and
    // each would then collide with an unrelated word.
    assert.equal(stemServiceWord("shower"), "shower", "must not become 'show'");
    assert.equal(stemServiceWord("water"), "water", "must not become 'wat'");
    assert.equal(stemServiceWord("boiler"), "boiler", "must not become 'boil'");
    assert.equal(stemServiceWord("dental"), "dental", "must not become 'dent'");
    assert.equal(stemServiceWord("gas"), "gas", "must not become 'ga'");
    assert.equal(stemServiceWord("glass"), "glass", "'ss' is not a plural");
  });

  test("words with no applicable suffix are returned unchanged", () => {
    for (const w of ["dentist", "roof", "burst", "tap", "heat"]) {
      assert.equal(stemServiceWord(w), w);
    }
  });

  test("stemming is deterministic and idempotent on its own output", () => {
    for (const w of ["plumber", "electricians", "leaky", "shower", "dentist"]) {
      const once = stemServiceWord(w);
      assert.equal(stemServiceWord(w), once, "same input, same output");
      assert.equal(stemServiceWord(once), once, "stem of a stem is itself");
    }
  });
});

describe("service matching — SHOULD match Plumbing", () => {
  const shouldMatch = [
    "plumber",
    "plumbers",
    "plumbing",
    "need a plumber",
    "plumber for a leak",
    "plumbing appointment",
    "need plumbing service",
  ];

  for (const phrase of shouldMatch) {
    test(`"${phrase}"`, async () => {
      assert.equal(await matches(phrase), true);
    });
  }

  test("the exact string from the failed production call", async () => {
    // lead 20d574df-…, call 01a03f2f-…, 2026-08-26 18:48 BST
    assert.equal(await matches("plumber"), true);
  });
});

describe("service matching — SHOULD NOT match Plumbing", () => {
  const shouldNotMatch = ["electrician", "roofing", "dentist", "cleaning"];

  for (const phrase of shouldNotMatch) {
    test(`"${phrase}"`, async () => {
      assert.equal(await matches(phrase), false);
    });
  }

  test("an empty or whitespace request is never confirmed", async () => {
    assert.equal(await matches(""), false);
    assert.equal(await matches("   "), false);
  });

  test("a request of only stop words is never confirmed", async () => {
    assert.equal(await matches("book an appointment please"), false);
  });

  test("fails closed when the Knowledge Base cannot be read", async () => {
    const failing = knowledgeBase(null, { fail: true });
    assert.equal(await matches("plumbing", failing), false);
    assert.equal(await matches("plumber", failing), false);
  });

  test("an empty Knowledge Base confirms nothing", async () => {
    assert.equal(await matches("plumber", knowledgeBase([])), false);
  });
});

describe("one trade's terms cannot claim another's", () => {
  const bothTrades = () => knowledgeBase([PLUMBING_RECORD, ELECTRICAL_RECORD]);

  test("an electrician request matches the electrical record", async () => {
    assert.equal(await matches("electrician", bothTrades()), true);
  });

  test("an electrician request does not match a plumbing-only business", async () => {
    assert.equal(await matches("electrician", plumbingKb()), false);
    assert.equal(await matches("electricians", plumbingKb()), false);
    assert.equal(await matches("electrical work", plumbingKb()), false);
  });

  test("a plumber request does not match an electrical-only business", async () => {
    const electricalOnly = knowledgeBase([ELECTRICAL_RECORD]);
    assert.equal(await matches("plumber", electricalOnly), false);
    assert.equal(await matches("plumbing", electricalOnly), false);
  });
});

describe("extra descriptive words do not break a valid service", () => {
  // The caller who describes their problem in full must not be worse
  // off than the one who says a single word. Each of these carries the
  // service term plus real detail.
  const withDetail = [
    "plumber for a leak",
    "plumbing for a leaking radiator",
    "plumber for a leaking radiator",
    "plumbing appointment for a leaky radiator",
    "plumber for a dripping tap",
    "plumbers for blocked toilets",
    "emergency plumber",
    "leaking radiator",
    "burst pipe",
  ];

  for (const phrase of withDetail) {
    test(`"${phrase}"`, async () => {
      assert.equal(await matches(phrase), true);
    });
  }

  test("a bare service word and the same word with detail both match", async () => {
    assert.equal(await matches("plumber"), true);
    assert.equal(await matches("plumber for a leaking radiator"), true);
  });
});

describe("backward compatibility — nothing that matched before regresses", () => {
  // The substring test is still applied first and unchanged, so these
  // pre-existing behaviours must be untouched by the stem layer.
  const previouslyMatching = [
    "plumbing",
    "plumbing appointment",
    "leaky radiator",
    "burst pipe",
    "dripping tap",
    "blocked toilet",
    "boiler leak",
    "shower not working",
  ];

  for (const phrase of previouslyMatching) {
    test(`"${phrase}" still matches`, async () => {
      assert.equal(await matches(phrase), true);
    });
  }
});
