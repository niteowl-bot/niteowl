// BC-1: the Scan contact contract must refuse, never repair — and must
// be unable to carry anything but the five approved fields.
//
// docs/ARCHITECTURE.md §26.1 fixes the shape: name (required), exactly
// one of email or phone (the visitor's choice), business_name and
// message (optional). §26 fixes the rule the shape serves: NO FREE-TOOL
// OUTPUT TRAVELS WITH A CONTACT, AND NONE IS EVER JOINED TO ONE. The
// properties worth pinning are therefore:
//
//   AN UNKNOWN KEY IS REFUSED, NOT DROPPED — the only way a Scan answer,
//   report, version stamp or identifier could reach a request body is
//   as an extra key nothing objected to.
//
//   NOTHING IS REPAIRED — no truncation, no digit extraction, no
//   stringifying, no case change on the email. A refused value is a
//   form error the visitor can see; a repaired one is a lead nobody
//   can reach.
//
//   THE MODULE IS A LEAF — no import, no network, no storage, no
//   default or initial state a surface could seed from a Scan answer.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  SCAN_CONTACT_FIELDS,
  SCAN_CONTACT_LIMITS,
  validateScanContact,
} from "@/lib/freetools/scanContact";

const MODULE = "src/lib/freetools/scanContact.ts";

const codes = (result) => result.errors.map((e) => e.code);
const codesFor = (result, field) =>
  result.errors.filter((e) => e.field === field).map((e) => e.code);

const EMAIL_ONLY = { name: "Ada Lovelace", email: "ada@example.com" };
const PHONE_ONLY = { name: "Ada Lovelace", phone: "+44 7700 900000" };

// ── 1. Happy paths ─────────────────────────────────────────────────

describe("a well-formed contact validates", () => {
  test("email only, no optionals", () => {
    const r = validateScanContact(EMAIL_ONLY);
    assert.equal(r.valid, true);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.contact, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: null,
      business_name: null,
      message: null,
    });
  });

  test("phone only, no optionals", () => {
    const r = validateScanContact(PHONE_ONLY);
    assert.equal(r.valid, true);
    assert.deepEqual(r.contact, {
      name: "Ada Lovelace",
      email: null,
      phone: "+44 7700 900000",
      business_name: null,
      message: null,
    });
  });

  test("with both optionals", () => {
    const r = validateScanContact({
      ...EMAIL_ONLY,
      business_name: "Lovelace Plumbing",
      message: "Please call after 4pm.",
    });
    assert.equal(r.valid, true);
    assert.equal(r.contact.business_name, "Lovelace Plumbing");
    assert.equal(r.contact.message, "Please call after 4pm.");
  });

  test("the validated contact carries exactly the five fields, in order", () => {
    const r = validateScanContact({ ...EMAIL_ONLY, business_name: "X Ltd", message: "hi" });
    assert.deepEqual(Object.keys(r.contact), [...SCAN_CONTACT_FIELDS]);
  });

  test("optionals passed as null are null, not errors", () => {
    const r = validateScanContact({ ...EMAIL_ONLY, business_name: null, message: null });
    assert.equal(r.valid, true);
    assert.equal(r.contact.business_name, null);
    assert.equal(r.contact.message, null);
  });
});

// ── 2. Exactly one contact method ──────────────────────────────────

describe("exactly one of email or phone — the visitor's choice", () => {
  test("both supplied is a conflict, even when both are valid", () => {
    const r = validateScanContact({ ...EMAIL_ONLY, phone: "+44 7700 900000" });
    assert.equal(r.valid, false);
    assert.ok(codes(r).includes("contact_method_conflict"));
    assert.equal(r.contact, null);
  });

  test("neither supplied is refused", () => {
    const r = validateScanContact({ name: "Ada Lovelace" });
    assert.equal(r.valid, false);
    assert.ok(codes(r).includes("contact_method_required"));
    assert.equal(r.contact, null);
  });

  test("the method rule is judged on what was supplied, so a conflict is still reported alongside a malformed value", () => {
    const r = validateScanContact({ ...EMAIL_ONLY, phone: "abc" });
    assert.ok(codes(r).includes("contact_method_conflict"));
    assert.ok(codes(r).includes("invalid_phone"));
  });

  test("the module never picks one for the visitor", () => {
    // A tempting repair: both present, drop the phone, keep the email.
    const r = validateScanContact({ ...EMAIL_ONLY, phone: "+44 7700 900000" });
    assert.equal(r.contact, null);
  });
});

// ── 3. name ────────────────────────────────────────────────────────

describe("name is required and is a name", () => {
  test("absent is `required`", () => {
    for (const name of [undefined, null]) {
      const r = validateScanContact({ name, email: "ada@example.com" });
      assert.deepEqual(codesFor(r, "name"), ["required"]);
    }
  });

  test("blank is `malformed`, not absent", () => {
    for (const name of ["", "   ", "\t\n"]) {
      const r = validateScanContact({ name, email: "ada@example.com" });
      assert.deepEqual(codesFor(r, "name"), ["malformed"], JSON.stringify(name));
    }
  });

  test("a non-string is `malformed`, never stringified", () => {
    for (const name of [123, true, ["Ada"], { first: "Ada" }]) {
      const r = validateScanContact({ name, email: "ada@example.com" });
      assert.deepEqual(codesFor(r, "name"), ["malformed"]);
      assert.equal(r.contact, null);
    }
  });

  test("one character is too short", () => {
    const r = validateScanContact({ name: "A", email: "ada@example.com" });
    assert.deepEqual(codesFor(r, "name"), ["too_short"]);
  });

  test("over the limit is refused, not truncated", () => {
    const r = validateScanContact({
      name: "A".repeat(SCAN_CONTACT_LIMITS.name.max + 1),
      email: "ada@example.com",
    });
    assert.deepEqual(codesFor(r, "name"), ["too_long"]);
    assert.equal(r.contact, null);
  });

  test("exactly the limit is accepted", () => {
    const r = validateScanContact({
      name: "A".repeat(SCAN_CONTACT_LIMITS.name.max),
      email: "ada@example.com",
    });
    assert.equal(r.valid, true);
  });

  test("an email address or phone number in the name box is refused, not moved", () => {
    for (const name of ["ada@example.com", "07700 900000", "+44 7700 900000"]) {
      const r = validateScanContact({ name, phone: "+44 7700 900000" });
      assert.deepEqual(codesFor(r, "name"), ["looks_like_contact_detail"], name);
      assert.equal(r.contact, null);
    }
  });

  test("surrounding whitespace is trimmed and internal runs collapse", () => {
    const r = validateScanContact({ name: "  Ada   \t Lovelace \n", email: "ada@example.com" });
    assert.equal(r.contact.name, "Ada Lovelace");
  });
});

// ── 4. email ───────────────────────────────────────────────────────

describe("email is validated and preserved as typed", () => {
  test("malformed addresses are refused", () => {
    for (const email of ["ada", "ada@", "@example.com", "ada@example", "ada at example dot com", "ada@example.c"]) {
      const r = validateScanContact({ name: "Ada Lovelace", email });
      assert.deepEqual(codesFor(r, "email"), ["invalid_email"], email);
    }
  });

  test("blank is malformed", () => {
    const r = validateScanContact({ name: "Ada Lovelace", email: "   " });
    assert.deepEqual(codesFor(r, "email"), ["malformed"]);
  });

  test("a non-string is malformed", () => {
    const r = validateScanContact({ name: "Ada Lovelace", email: 42 });
    assert.deepEqual(codesFor(r, "email"), ["malformed"]);
  });

  test("casing is the visitor's — NOT lower-cased (owner decision, BC-1 approval)", () => {
    const r = validateScanContact({ name: "Ada Lovelace", email: "  Ada.Lovelace@Example.COM " });
    assert.equal(r.valid, true);
    assert.equal(r.contact.email, "Ada.Lovelace@Example.COM");
  });

  test("a spoken-style address is refused, not repaired", () => {
    const r = validateScanContact({ name: "Ada Lovelace", email: "ada at gmail.com" });
    assert.equal(r.valid, false);
    assert.equal(r.contact, null);
  });

  test("over the limit is refused", () => {
    const local = "a".repeat(SCAN_CONTACT_LIMITS.email.max - "@example.com".length + 1);
    const r = validateScanContact({ name: "Ada Lovelace", email: `${local}@example.com` });
    assert.deepEqual(codesFor(r, "email"), ["too_long"]);
  });
});

// ── 5. phone ───────────────────────────────────────────────────────

describe("phone is validated and stored as typed", () => {
  test("a run of punctuation with no digits is refused despite matching the character class", () => {
    for (const phone of ["-------", "+ () - ", "(((((((("]) {
      const r = validateScanContact({ name: "Ada Lovelace", phone });
      assert.deepEqual(codesFor(r, "phone"), ["invalid_phone"], phone);
    }
  });

  test("fewer than the digit floor is refused", () => {
    const r = validateScanContact({ name: "Ada Lovelace", phone: "12-34-56" });
    assert.deepEqual(codesFor(r, "phone"), ["invalid_phone"]);
  });

  test("letters are refused", () => {
    const r = validateScanContact({ name: "Ada Lovelace", phone: "07700 9000oo" });
    assert.deepEqual(codesFor(r, "phone"), ["invalid_phone"]);
  });

  test("accepted as typed — trimmed, internal whitespace collapsed, nothing reformatted", () => {
    const r = validateScanContact({ name: "Ada Lovelace", phone: "  +44  (0)7700   900 000 " });
    assert.equal(r.valid, true);
    assert.equal(r.contact.phone, "+44 (0)7700 900 000");
  });

  test("not converted to E.164 or stripped of punctuation", () => {
    const r = validateScanContact({ name: "Ada Lovelace", phone: "07700-900-000" });
    assert.equal(r.contact.phone, "07700-900-000");
  });

  test("a number passed as a number is malformed, never stringified", () => {
    const r = validateScanContact({ name: "Ada Lovelace", phone: 447700900000 });
    assert.deepEqual(codesFor(r, "phone"), ["malformed"]);
  });

  test("over the limit is refused", () => {
    const r = validateScanContact({
      name: "Ada Lovelace",
      phone: "1".repeat(SCAN_CONTACT_LIMITS.phone.max + 1),
    });
    assert.deepEqual(codesFor(r, "phone"), ["too_long"]);
  });
});

// ── 6. Optionals ───────────────────────────────────────────────────

describe("business_name and message are optional, and blank is not absent", () => {
  test("business_name blank is malformed", () => {
    const r = validateScanContact({ ...EMAIL_ONLY, business_name: "  " });
    assert.deepEqual(codesFor(r, "business_name"), ["malformed"]);
  });

  test("business_name bounds", () => {
    assert.deepEqual(
      codesFor(validateScanContact({ ...EMAIL_ONLY, business_name: "X" }), "business_name"),
      ["too_short"]
    );
    assert.deepEqual(
      codesFor(
        validateScanContact({
          ...EMAIL_ONLY,
          business_name: "X".repeat(SCAN_CONTACT_LIMITS.business_name.max + 1),
        }),
        "business_name"
      ),
      ["too_long"]
    );
  });

  test("message blank is malformed", () => {
    const r = validateScanContact({ ...EMAIL_ONLY, message: "\n\n  \n" });
    assert.deepEqual(codesFor(r, "message"), ["malformed"]);
  });

  test("message keeps line breaks, normalised to \\n, and collapses horizontal runs", () => {
    const r = validateScanContact({
      ...EMAIL_ONLY,
      message: "  Line one  \r\nLine\t\ttwo\rLine three  \n",
    });
    assert.equal(r.contact.message, "Line one\nLine two\nLine three");
  });

  test("message at the limit is accepted and one over is refused, not truncated", () => {
    const ok = validateScanContact({ ...EMAIL_ONLY, message: "m".repeat(SCAN_CONTACT_LIMITS.message.max) });
    assert.equal(ok.valid, true);
    const over = validateScanContact({
      ...EMAIL_ONLY,
      message: "m".repeat(SCAN_CONTACT_LIMITS.message.max + 1),
    });
    assert.deepEqual(codesFor(over, "message"), ["too_long"]);
    assert.equal(over.contact, null);
  });

  test("a non-string optional is malformed", () => {
    assert.deepEqual(codesFor(validateScanContact({ ...EMAIL_ONLY, message: 7 }), "message"), ["malformed"]);
    assert.deepEqual(
      codesFor(validateScanContact({ ...EMAIL_ONLY, business_name: [] }), "business_name"),
      ["malformed"]
    );
  });
});

// ── 7. Nothing else may enter ──────────────────────────────────────

describe("no Scan output, identifier or metadata can ride along", () => {
  const SMUGGLED = [
    "answers",
    "report",
    "findings",
    "recommendation",
    "recommendations",
    "estimate",
    "estimate_basis",
    "condition",
    "funnel",
    "clusters",
    "hypotheses",
    "question_set_version",
    "rule_set_version",
    "answered_at",
    "computed_at",
    "run_id",
    "session_id",
    "visitor_id",
    "org_id",
    "source",
    "company",
    "metadata",
  ];

  for (const key of SMUGGLED) {
    test(`"${key}" is refused as an unexpected field`, () => {
      const r = validateScanContact({ ...EMAIL_ONLY, [key]: "x" });
      assert.equal(r.valid, false);
      assert.ok(
        r.errors.some((e) => e.code === "unexpected_field" && e.field === null && e.message.includes(`"${key}"`)),
        `${key} was not refused`
      );
      assert.equal(r.contact, null);
    });
  }

  test("an unexpected key is refused even when its value is empty or null", () => {
    for (const value of [null, undefined, "", {}, []]) {
      const r = validateScanContact({ ...EMAIL_ONLY, answers: value });
      assert.ok(codes(r).includes("unexpected_field"));
    }
  });

  test("a non-object payload is refused outright", () => {
    for (const input of [null, undefined, "ada@example.com", 1, true, [], [EMAIL_ONLY]]) {
      const r = validateScanContact(input);
      assert.equal(r.valid, false);
      assert.deepEqual(codes(r), ["not_an_object"]);
      assert.equal(r.contact, null);
    }
  });
});

// ── 8. Result shape discipline ─────────────────────────────────────

describe("the result never hands back a partial contact", () => {
  test("any error at all means contact is null", () => {
    const r = validateScanContact({ name: "Ada Lovelace", email: "ada@example.com", message: "" });
    assert.equal(r.valid, false);
    assert.equal(r.contact, null);
  });

  test("errors accumulate across fields in one pass", () => {
    const r = validateScanContact({ name: "", email: "nope", business_name: "X", message: 1, extra: 1 });
    const seen = new Set(codes(r));
    for (const c of ["malformed", "invalid_email", "too_short", "unexpected_field"]) {
      assert.ok(seen.has(c), `missing ${c}`);
    }
  });

  test("the field list is the approved five, in the approved order", () => {
    assert.deepEqual([...SCAN_CONTACT_FIELDS], ["name", "email", "phone", "business_name", "message"]);
  });

  test("the limits are the approved values", () => {
    assert.deepEqual(SCAN_CONTACT_LIMITS, {
      name: { min: 2, max: 100 },
      email: { max: 254 },
      phone: { max: 30, min_digits: 7 },
      business_name: { min: 2, max: 150 },
      message: { min: 1, max: 2000 },
    });
  });
});

// ── 9. The module is a leaf ────────────────────────────────────────

describe("scanContact.ts imports nothing and offers no prefill", () => {
  const src = readFileSync(MODULE, "utf8");
  const code = src
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

  test("no import statement of any kind — not even a sibling Scan module", () => {
    assert.doesNotMatch(src, /^\s*import\s/m);
    assert.doesNotMatch(src, /\brequire\s*\(/);
    assert.doesNotMatch(code, /from\s+["']/);
  });

  test("no network, storage, cookie, browser or request access", () => {
    assert.doesNotMatch(
      code,
      /fetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|axios|localStorage|sessionStorage|document\.|window\.|navigator\.|cookie|indexedDB|Request\b|Response\b|headers/i
    );
  });

  test("no environment, clock, randomness or identifier generation", () => {
    assert.doesNotMatch(code, /process\.env|Date\.now|new Date\(|toISOString|Math\.random|randomUUID|crypto\./);
  });

  test("no default, initial state, prefill or factory export", () => {
    const exported = [...src.matchAll(/^export\s+(?:const|function|type|interface)\s+(\w+)/gm)].map((m) => m[1]);
    assert.deepEqual(exported.sort(), [
      "SCAN_CONTACT_FIELDS",
      "SCAN_CONTACT_LIMITS",
      "ScanContact",
      "ScanContactErrorCode",
      "ScanContactField",
      "ScanContactValidationError",
      "ScanContactValidationResult",
      "validateScanContact",
    ]);
    assert.doesNotMatch(code, /default|initial|prefill|empty(Contact|Form)|blank(Contact|Form)/i);
  });

  test("no Scan vocabulary in code — the module cannot name what it must not carry", () => {
    assert.doesNotMatch(
      code,
      /ScanAnswers|ScanReport|ScanFinding|ScanRecommendation|buildScanReport|validateScanAnswers|SCAN_QUESTION|estimate_basis|condition/
    );
  });
});
