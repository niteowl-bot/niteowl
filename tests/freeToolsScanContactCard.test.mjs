// Business Opportunity Scan, Phase B — the contact card (BC-3).
//
// What this suite proves:
//
//   1. The card is handed nothing and can reach nothing of the Scan: no
//      props, no Scan import but the BC-1 contract, no storage, cookie,
//      query string, identifier, analytics or environment access.
//   2. It renders blank, with neither contact method chosen, with
//      labels, a fieldset/legend, and the approved wording — and none of
//      the anti-funnel or urgency vocabulary.
//   3. What is sent is `validation.contact` only, in one request, to the
//      literal BC-2 path — proved by driving submitScanContact with a
//      stubbed fetch, not by reading the source.
//   4. Every response BC-2 can give maps to the right visitor outcome,
//      and a thrown fetch is a failure, never a retry.
//
// Like the surface suite, it does not click: the repository has no DOM
// harness, so the parts that decide anything are exported and tested
// directly.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { SCAN_CONTACT_LIMITS, validateScanContact } from "@/lib/freetools/scanContact";
import ScanContactCard, {
  SCAN_CONTACT_ENDPOINT,
  SCAN_CONTACT_ERROR_LABELS,
  SCAN_CONTACT_WORDING,
  blankScanContactForm,
  scanContactErrorMessage,
  scanContactInput,
  scanContactOutcome,
  submitScanContact,
} from "@/app/free-tools/business-opportunity-scan/ScanContactCard";

const CARD = "src/app/free-tools/business-opportunity-scan/ScanContactCard.tsx";
const read = (f) => readFileSync(f, "utf8");
/** Source with comment lines removed, so prose about the code is never mistaken for the code. */
const code = (f) =>
  read(f)
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
const count = (s, re) => (s.match(re) ?? []).length;
const unescape = (s) =>
  s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

// Every code in the BC-1 union, listed here so a code added there
// without a label here fails the exhaustiveness test below as well as
// the type check.
const ALL_CODES = [
  "not_an_object",
  "unexpected_field",
  "required",
  "malformed",
  "too_short",
  "too_long",
  "invalid_email",
  "invalid_phone",
  "looks_like_contact_detail",
  "contact_method_required",
  "contact_method_conflict",
];

// ── fetch stub ────────────────────────────────────────────────────

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(respond) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return respond();
  };
  return calls;
}

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const textResponse = (status, text) => new Response(text, { status });

function validContact(form) {
  const v = validateScanContact(scanContactInput({ ...blankScanContactForm(), ...form }));
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  return v.contact;
}

// ── 1. The boundary ───────────────────────────────────────────────

describe("the card is handed nothing and can reach nothing of the Scan", () => {
  test("the default export takes no props", () => {
    assert.equal(ScanContactCard.length, 0);
    assert.match(code(CARD), /export default function ScanContactCard\(\)/);
  });

  test("its only imports are React and the BC-1 contract", () => {
    const specifiers = (read(CARD).match(/from\s+["']([^"']+)["']/g) ?? []).map((s) =>
      s.replace(/from\s+["']|["']/g, "")
    );
    assert.ok(specifiers.length > 0);
    for (const s of specifiers) {
      assert.match(s, /^(react|@\/lib\/freetools\/scanContact)$/, `ScanContactCard imports ${s}`);
    }
  });

  test("no Scan answer, report, finding or recommendation is named in the code", () => {
    assert.doesNotMatch(
      code(CARD),
      // Identifiers only: the approved wording itself says "not your answers or your report".
      /ScanReport|ScanAnswers|ScanDraft|buildScanReport|validateScanAnswers|scanPresentation|recommendation|finding|answers[.[]|result\.report|question_set|rule_set|\bdraft\b/i
    );
  });

  test("no storage, cookie, query string, identifier, analytics or environment access", () => {
    const src = code(CARD);
    assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|document\.cookie|caches\./);
    assert.doesNotMatch(src, /useSearchParams|useRouter|searchParams|next\/navigation|URLSearchParams|history\.(push|replace)State|window\.location/);
    assert.doesNotMatch(src, /crypto\.|randomUUID|Math\.random|nanoid|uuid/i);
    assert.doesNotMatch(src, /analytics|gtag|dataLayer|posthog|segment|plausible|sendBeacon|XMLHttpRequest|WebSocket|EventSource/i);
    assert.doesNotMatch(src, /"use server"|server-only|process\.env/);
    assert.doesNotMatch(src, /dangerouslySetInnerHTML|innerHTML|eval\(|new Function/);
  });

  test("exactly one fetch, to the literal BC-2 path, and no retry", () => {
    const src = code(CARD);
    assert.equal(count(src, /fetch\(/g), 1);
    assert.equal(SCAN_CONTACT_ENDPOINT, "/api/free-tools/scan-contact");
    assert.match(src, /SCAN_CONTACT_ENDPOINT = "\/api\/free-tools\/scan-contact"/);
    assert.doesNotMatch(src, /retry|setTimeout|setInterval/i);
  });

  test("the request body is the validated contact, and the submit path validates first", () => {
    const src = code(CARD);
    assert.equal(count(src, /JSON\.stringify\(/g), 1);
    assert.match(src, /body: JSON\.stringify\(contact\)/);
    assert.match(src, /submitScanContact\(contact: ScanContact\)/);
    assert.match(src, /submitScanContact\(validation\.contact\)/);
  });

  test("no maxLength anywhere — BC-1 refuses, it never truncates", () => {
    assert.doesNotMatch(code(CARD), /maxLength/);
  });

  test("no preselected or prefilled control", () => {
    assert.doesNotMatch(code(CARD), /defaultChecked|defaultValue|checked=\{true\}/);
  });
});

// ── 2. The blank render ───────────────────────────────────────────

describe("the card renders blank, labelled, and in the approved words", () => {
  const html = renderToStaticMarkup(createElement(ScanContactCard));
  const text = unescape(html);

  test("the approved heading, body and button", () => {
    assert.match(text, /Want to talk it through\?/);
    assert.ok(text.includes(SCAN_CONTACT_WORDING.body));
    assert.equal(
      SCAN_CONTACT_WORDING.body,
      "Optional. If you'd like someone from NiteOwl to get in touch about this, leave your details. Your report stays exactly as it is either way — we receive only what you type below, not your answers or your report."
    );
    assert.match(text, />Send my details</);
  });

  test("the approved success and error sentences", () => {
    assert.equal(SCAN_CONTACT_WORDING.success_email, "Thanks — we've got your details and will reply by email.");
    assert.equal(SCAN_CONTACT_WORDING.success_phone, "Thanks — we've got your details and will reply by phone.");
    assert.equal(SCAN_CONTACT_WORDING.rate_limited, "Too many attempts from this connection — please try again later.");
    assert.equal(SCAN_CONTACT_WORDING.failed, "We couldn't send your details — please try again in a little while.");
  });

  test("a real form, every text field labelled, autocomplete as approved", () => {
    assert.equal(count(html, /<form\b/g), 1);
    for (const [id, auto] of [["name", "name"], ["business_name", "organization"]]) {
      assert.match(html, new RegExp(`<label for="scan-contact-${id}"`));
      assert.match(html, new RegExp(`id="scan-contact-${id}"[^>]*autoComplete="${auto}"|autoComplete="${auto}"[^>]*id="scan-contact-${id}"`, "i"));
    }
    assert.match(html, /<label for="scan-contact-message"/);
    assert.match(html, /<textarea[^>]*id="scan-contact-message"/);
    assert.match(html, /<button type="submit"/);
    // The email and phone boxes, with their autocomplete, are in the source:
    // neither is rendered until a method is chosen.
    assert.match(code(CARD), /autoComplete="email"/);
    assert.match(code(CARD), /autoComplete="tel"/);
  });

  test("the contact-method choice is a fieldset with a legend and two unchecked radios", () => {
    assert.match(html, /<fieldset[^>]*>\s*<legend[^>]*>How should we reach you\?<\/legend>/);
    assert.match(html, /role="radiogroup" aria-labelledby="scan-contact-method-legend" aria-invalid="false"/);
    assert.equal(count(html, /type="radio"/g), 2);
    assert.equal(count(html, /\bchecked=""/g), 0);
    assert.match(html, />Email</);
    assert.match(html, />Phone</);
  });

  test("blank: no value, no email or phone box, no error, no status, not busy", () => {
    assert.equal(count(html, /value="[^"]+"/g), 0);
    assert.doesNotMatch(html, /id="scan-contact-email"|id="scan-contact-phone"/);
    assert.doesNotMatch(html, /role="alert"|role="status"/);
    assert.match(html, /aria-busy="false"/);
    assert.doesNotMatch(html, /\bdisabled=""/);
  });

  test("no source field and no hidden input", () => {
    assert.doesNotMatch(html, /source|type="hidden"/i);
  });

  test("no anti-funnel or urgency vocabulary in the card", () => {
    const all = [text, ...Object.values(SCAN_CONTACT_WORDING), ...Object.values(SCAN_CONTACT_ERROR_LABELS)].join("\n");
    assert.doesNotMatch(all, /sign up|create an account|start your free trial|enter your card|book a demo|talk to sales/i);
    assert.doesNotMatch(
      all,
      /\bact now\b|\bimmediately\b|\bdon'?t delay\b|\bdon'?t wait\b|\bevery day you wait\b|\bcosting you\b|\bhurry\b|\bbefore it'?s too late\b|\blimited time\b|\bright away\b|\bonly \d+ left\b|\bspots?\b|\bcountdown\b|\bwithin \d+ (hours?|days?|minutes?)\b/i
    );
  });

  test("the state-dependent attributes are wired in the source", () => {
    const src = code(CARD);
    assert.match(src, /aria-invalid=\{Boolean\(methodError\)\}/);
    assert.match(src, /"aria-invalid": Boolean\(error\)/);
    assert.match(src, /"aria-describedby": error \? errorId : undefined/);
    assert.match(src, /role="status"/);
    assert.match(src, /aria-busy=\{submitting\}/);
    assert.match(src, /disabled=\{submitting\}/);
    assert.match(src, /statusRef\.current\?\.focus\(\)/);
  });
});

// ── 3. From form to validator input ───────────────────────────────

describe("scanContactInput passes the visitor's values through and invents nothing", () => {
  test("a blank form becomes an empty object — required and method errors, nothing malformed", () => {
    assert.deepEqual(scanContactInput(blankScanContactForm()), {});
    const codes = validateScanContact({}).errors.map((e) => e.code).sort();
    assert.deepEqual(codes, ["contact_method_required", "required"]);
  });

  test("only the CHOSEN method's box is included", () => {
    const form = { ...blankScanContactForm(), name: "Ann", method: "email", email: "a@b.co", phone: "0871234567" };
    assert.deepEqual(scanContactInput(form), { name: "Ann", email: "a@b.co" });
    assert.deepEqual(scanContactInput({ ...form, method: "phone" }), { name: "Ann", phone: "0871234567" });
    assert.deepEqual(scanContactInput({ ...form, method: null }), { name: "Ann" });
  });

  test("an empty optional box is omitted; whitespace goes through for BC-1 to refuse", () => {
    const form = { ...blankScanContactForm(), name: "Ann", method: "email", email: "a@b.co" };
    assert.deepEqual(Object.keys(scanContactInput(form)).sort(), ["email", "name"]);
    const input = scanContactInput({ ...form, business_name: "   " });
    assert.equal(input.business_name, "   ");
    assert.deepEqual(validateScanContact(input).errors.map((e) => [e.field, e.code]), [["business_name", "malformed"]]);
  });

  test("the validated contact has exactly the five BC-1 keys and nothing else", () => {
    const contact = validContact({ name: "Ann", method: "phone", phone: "087 123 4567", message: "Hi" });
    assert.deepEqual(Object.keys(contact).sort(), ["business_name", "email", "message", "name", "phone"]);
  });
});

// ── 4. Error wording ──────────────────────────────────────────────

describe("every BC-1 refusal code has visitor wording", () => {
  test("exhaustive, and no developer text leaks through", () => {
    assert.deepEqual(Object.keys(SCAN_CONTACT_ERROR_LABELS).sort(), [...ALL_CODES].sort());
    for (const label of Object.values(SCAN_CONTACT_ERROR_LABELS)) {
      assert.ok(label.length > 0);
      assert.doesNotMatch(label, /^\w+:/);
    }
  });

  test("length errors carry the BC-1 limit", () => {
    assert.match(
      scanContactErrorMessage({ field: "name", code: "too_short", message: "x" }),
      new RegExp(`at least ${SCAN_CONTACT_LIMITS.name.min} characters`)
    );
    assert.match(
      scanContactErrorMessage({ field: "message", code: "too_long", message: "x" }),
      new RegExp(`at most ${SCAN_CONTACT_LIMITS.message.max} characters`)
    );
  });

  test("the validator's own messages are never shown", () => {
    const { errors } = validateScanContact({ name: "a", email: "nope" });
    for (const e of errors) {
      assert.notEqual(scanContactErrorMessage(e), e.message);
    }
  });
});

// ── 5. Responses ──────────────────────────────────────────────────

describe("scanContactOutcome maps every BC-2 response", () => {
  test("201 is sent", () => {
    assert.deepEqual(scanContactOutcome(201, null), { kind: "sent" });
  });

  test("400 with BC-1 errors is invalid, carrying those errors", () => {
    const errors = [{ field: "email", code: "invalid_email", message: "email: not a valid email address" }];
    assert.deepEqual(scanContactOutcome(400, { errors }), { kind: "invalid", errors });
  });

  test("400 without a usable error list is a generic failure", () => {
    assert.deepEqual(scanContactOutcome(400, null), { kind: "failed" });
    assert.deepEqual(scanContactOutcome(400, { errors: [] }), { kind: "failed" });
    assert.deepEqual(scanContactOutcome(400, { errors: [{ code: "made_up" }] }), { kind: "failed" });
  });

  test("429 is rate-limited", () => {
    assert.deepEqual(scanContactOutcome(429, null), { kind: "rate_limited" });
  });

  test("413, 500, 200 and anything else is the generic failure", () => {
    for (const status of [413, 500, 502, 200, 204, 404]) {
      assert.deepEqual(scanContactOutcome(status, { error: "internal detail" }), { kind: "failed" }, String(status));
    }
  });
});

describe("submitScanContact sends the validated contact, once", () => {
  test("201: one POST, to the literal path, JSON body equal to the contact", async () => {
    const contact = validContact({ name: "Ann Byrne", method: "email", email: "Ann@Example.ie", business_name: "Byrne Plumbing" });
    const calls = stubFetch(() => jsonResponse(201, { ok: true }));
    assert.deepEqual(await submitScanContact(contact), { kind: "sent" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/free-tools/scan-contact");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(calls[0].init.body), contact);
    assert.deepEqual(Object.keys(JSON.parse(calls[0].init.body)).sort(), ["business_name", "email", "message", "name", "phone"]);
    assert.equal(calls[0].init.credentials, undefined);
  });

  test("400: the BC-1 errors come back for the fields", async () => {
    const errors = [{ field: "phone", code: "invalid_phone", message: "phone: not a valid phone number" }];
    const calls = stubFetch(() => jsonResponse(400, { errors }));
    const outcome = await submitScanContact(validContact({ name: "Ann", method: "phone", phone: "0871234567" }));
    assert.deepEqual(outcome, { kind: "invalid", errors });
    assert.equal(calls.length, 1);
  });

  test("429 (plain text): rate-limited, one request, no retry", async () => {
    const calls = stubFetch(() => textResponse(429, "Too many requests"));
    assert.deepEqual(await submitScanContact(validContact({ name: "Ann", method: "email", email: "a@b.co" })), { kind: "rate_limited" });
    assert.equal(calls.length, 1);
  });

  test("413 (plain text): generic failure", async () => {
    const calls = stubFetch(() => textResponse(413, "Payload too large"));
    assert.deepEqual(await submitScanContact(validContact({ name: "Ann", method: "email", email: "a@b.co" })), { kind: "failed" });
    assert.equal(calls.length, 1);
  });

  test("500: generic failure, server detail not surfaced", async () => {
    const calls = stubFetch(() => jsonResponse(500, { error: "Could not record your details. Please try again." }));
    const outcome = await submitScanContact(validContact({ name: "Ann", method: "email", email: "a@b.co" }));
    assert.deepEqual(outcome, { kind: "failed" });
    assert.equal(calls.length, 1);
  });

  test("a network failure is a generic failure, never thrown, never retried", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new TypeError("Failed to fetch");
    };
    assert.deepEqual(await submitScanContact(validContact({ name: "Ann", method: "email", email: "a@b.co" })), { kind: "failed" });
    assert.equal(calls, 1);
  });

  test("a 400 with an unreadable body is a generic failure", async () => {
    stubFetch(() => textResponse(400, "not json"));
    assert.deepEqual(await submitScanContact(validContact({ name: "Ann", method: "email", email: "a@b.co" })), { kind: "failed" });
  });
});

describe("success wording follows the visitor's chosen method only", () => {
  test("the card chooses email or phone from the validated contact", () => {
    const src = code(CARD);
    assert.match(src, /setSentBy\(validation\.contact\.email !== null \? "email" : "phone"\)/);
    assert.match(src, /sentBy === "email" \? SCAN_CONTACT_WORDING\.success_email : SCAN_CONTACT_WORDING\.success_phone/);
  });

  test("the success state renders no form, so it cannot be resubmitted", () => {
    const src = code(CARD);
    const successBlock = src.slice(src.indexOf("if (sentBy !== null) {"), src.indexOf("const field = ("));
    assert.ok(successBlock.length > 0);
    assert.doesNotMatch(successBlock, /<form|<button|onSubmit/);
    assert.match(successBlock, /role="status"/);
    assert.match(successBlock, /tabIndex=\{-1\}/);
  });
});
