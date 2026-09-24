// BC-2: the Scan contact intake must store the contact and nothing else.
//
// docs/ARCHITECTURE.md §26.1 fixes what a Scan contact is — name, one
// of email or phone, optional business name, optional message — and
// §26 fixes what it may never carry: any Scan answer, finding,
// recommendation, estimate, version stamp, or run / session / visitor /
// organisation identifier. The route is the one place a request body
// meets a database row, so the properties worth pinning are:
//
//   THE ROW IS ASSEMBLED FROM THE VALIDATED CONTACT ONLY. `source` is a
//   server constant, `conversation_id` is null, and no header — the
//   client address in particular — ever reaches the insert or the
//   notification.
//
//   AN UNKNOWN KEY IS 400, WITH ZERO SIDE EFFECTS. No insert and no
//   email for a body that carries anything beyond the five fields,
//   including a client-supplied `source`.
//
//   A FAILED NOTIFICATION DOES NOT LOSE THE LEAD. The row is written
//   with notification_sent: false and the visitor still gets 201.
//
//   NOTHING IS ECHOED. A 201 carries no id and none of the contact.
//
// The route is driven end to end through the real admin client: PostgREST
// and Resend are intercepted at globalThis.fetch, so every insert payload
// and every email body is observed exactly as it would leave the process.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import { SCAN_CONTACT_SOURCE, recordScanContact } from "@/lib/salesLeadCapture";
import { sendSalesLeadNotification } from "@/lib/email";

const ROUTE_FILE = "src/app/api/free-tools/scan-contact/route.ts";
const TEAM_EMAIL = "team@example.com";

// ── Network capture ────────────────────────────────────────────────

/**
 * Intercepts PostgREST (the admin client) and Resend. Records every
 * sales_leads insert payload and every email body; anything else is a
 * test bug and throws.
 */
function captureNetwork({ failEmail = false, failInsert = false } = {}) {
  const realFetch = globalThis.fetch;
  const inserts = [];
  const emails = [];
  const other = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(typeof input === "string" ? input : input.url);
    const method = init.method ?? "GET";
    if (url.includes("api.resend.com")) {
      const body = init.body ? JSON.parse(init.body) : {};
      if (failEmail) {
        return new Response(JSON.stringify({ message: "rejected" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        });
      }
      emails.push(body);
      return new Response(JSON.stringify({ id: `email-${emails.length}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/sales_leads") && method === "POST") {
      const body = init.body ? JSON.parse(init.body) : {};
      inserts.push(body);
      if (failInsert) {
        return new Response(JSON.stringify({ message: "insert failed", code: "PGRST204" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ id: `lead-${inserts.length}` }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    other.push({ url, method });
    throw new Error(`Unstubbed fetch in test: ${method} ${url}`);
  };
  const handle = { inserts, emails, other };
  handle.restore = () => {
    globalThis.fetch = realFetch;
  };
  return handle;
}

let net = null;
let ipCounter = 0;

// The limiter (src/lib/rateLimit.ts) is one in-memory bucket map per
// process, keyed on Date.now(), and the route's GLOBAL cap is 30 per
// hour — fewer requests than this file makes. Rather than add a
// test-only reset to production code, each test starts more than a
// window later than the last, so every bucket has expired and the real
// expiry path is what is exercised. The per-IP tests below then prove
// the cap inside a single window.
const realDateNow = Date.now;
let clock = realDateNow();
beforeEach(() => {
  process.env.SALES_NOTIFICATION_EMAIL = TEAM_EMAIL;
  clock += 2 * 60 * 60_000;
  const frozen = clock;
  Date.now = () => frozen;
});
afterEach(() => {
  Date.now = realDateNow;
  net?.restore?.();
  net = null;
});

/** A fresh client address per call, so the per-IP limit never bleeds between tests. */
const freshIp = () => `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

async function post(body, { ip = freshIp(), raw = null, headers = {} } = {}) {
  const { POST } = await import("@/app/api/free-tools/scan-contact/route");
  const { NextRequest } = await import("./stubs/next-server.mjs");
  const payload = raw ?? JSON.stringify(body);
  return POST(
    new NextRequest("http://localhost/api/free-tools/scan-contact", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
        ...headers,
      },
      body: payload,
    })
  );
}

const EMAIL_ONLY = { name: "Ada Lovelace", email: "ada@example.com" };
const PHONE_ONLY = { name: "Ada Lovelace", phone: "+44 7700 900000" };

const EXPECTED_COLUMNS = [
  "conversation_id",
  "name",
  "email",
  "phone",
  "company",
  "industry",
  "preferred_demo_time",
  "preferred_demo_datetime",
  "message",
  "status",
  "notification_sent",
  "source",
  "updated_at",
];

// ── 1. The stored row ──────────────────────────────────────────────

describe("a valid contact is stored through sales_leads with the contact and nothing else", () => {
  test("email-only: one insert, the twelve columns, source server-assigned", async () => {
    net = captureNetwork();
    const res = await post({ ...EMAIL_ONLY, business_name: "Lovelace Plumbing", message: "Call after 4pm." });
    assert.equal(res.status, 201);
    assert.equal(net.inserts.length, 1);
    const row = net.inserts[0];
    assert.deepEqual(Object.keys(row).sort(), [...EXPECTED_COLUMNS].sort());
    assert.equal(row.conversation_id, null);
    assert.equal(row.name, "Ada Lovelace");
    assert.equal(row.email, "ada@example.com");
    assert.equal(row.phone, null);
    assert.equal(row.company, "Lovelace Plumbing");
    assert.equal(row.industry, null);
    assert.equal(row.preferred_demo_time, null);
    assert.equal(row.preferred_demo_datetime, null);
    assert.equal(row.message, "Call after 4pm.");
    assert.equal(row.status, "new");
    assert.equal(row.notification_sent, true);
    assert.equal(row.source, "scan_contact");
    assert.equal(row.source, SCAN_CONTACT_SOURCE);
    assert.match(row.updated_at, /^\d{4}-\d{2}-\d{2}T/);
  });

  test("phone-only: email null, phone as typed", async () => {
    net = captureNetwork();
    const res = await post(PHONE_ONLY);
    assert.equal(res.status, 201);
    const row = net.inserts[0];
    assert.equal(row.email, null);
    assert.equal(row.phone, "+44 7700 900000");
    assert.equal(row.company, null);
    assert.equal(row.message, null);
  });

  test("business_name maps to the existing `company` column — no new column for it", async () => {
    net = captureNetwork();
    await post({ ...EMAIL_ONLY, business_name: "X Ltd" });
    assert.equal(net.inserts[0].company, "X Ltd");
    assert.equal("business_name" in net.inserts[0], false);
  });

  test("the row never carries a run, session, visitor, organisation or Scan reference", async () => {
    net = captureNetwork();
    await post({ ...EMAIL_ONLY, message: "hello" });
    const serialised = JSON.stringify(net.inserts[0]);
    assert.doesNotMatch(serialised, /org_id|run_id|session_id|visitor|answers|report|finding|estimate|condition|version/);
  });

  test("no lookup precedes the insert — a Scan contact is never merged with a chat lead", async () => {
    net = captureNetwork();
    await post(EMAIL_ONLY);
    assert.deepEqual(net.other, [], "only the insert and the email may leave the process");
    assert.equal(net.inserts.length, 1);
  });

  test("the response echoes nothing", async () => {
    net = captureNetwork();
    const res = await post({ ...EMAIL_ONLY, business_name: "Lovelace Plumbing" });
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { ok: true });
    assert.doesNotMatch(text, /lead-1|Ada|ada@example|Lovelace/);
    assert.equal(res.headers.get("cache-control"), "no-store");
  });
});

// ── 2. The notification ────────────────────────────────────────────

describe("the team notification", () => {
  test("is sent once, to SALES_NOTIFICATION_EMAIL, with the Scan intro and the message", async () => {
    net = captureNetwork();
    await post({ ...EMAIL_ONLY, business_name: "Lovelace Plumbing", message: "Line one\nLine two" });
    assert.equal(net.emails.length, 1);
    const mail = net.emails[0];
    assert.equal(mail.to, TEAM_EMAIL);
    assert.match(mail.subject, /New sales lead: Ada Lovelace — Lovelace Plumbing/);
    assert.match(mail.html, /after running the free Business Opportunity Scan/);
    assert.doesNotMatch(mail.html, /completed the sales chat/);
    assert.match(mail.html, /Message<\/td>.*Line one<br>Line two/s);
    assert.match(mail.html, /Company<\/td>.*Lovelace Plumbing/s);
  });

  test("the message is escaped, never rendered as markup", async () => {
    net = captureNetwork();
    await post({ ...EMAIL_ONLY, message: "<script>alert(1)</script>" });
    assert.doesNotMatch(net.emails[0].html, /<script>/);
    assert.match(net.emails[0].html, /&lt;script&gt;/);
  });

  test("a failed send does NOT lose the lead: row stored with notification_sent false, still 201", async () => {
    net = captureNetwork({ failEmail: true });
    const res = await post(EMAIL_ONLY);
    assert.equal(res.status, 201);
    assert.equal(net.inserts.length, 1);
    assert.equal(net.inserts[0].notification_sent, false);
    assert.equal(net.inserts[0].source, "scan_contact");
  });

  test("an unset SALES_NOTIFICATION_EMAIL behaves the same as a failed send", async () => {
    delete process.env.SALES_NOTIFICATION_EMAIL;
    net = captureNetwork();
    const res = await post(EMAIL_ONLY);
    assert.equal(res.status, 201);
    assert.equal(net.emails.length, 0);
    assert.equal(net.inserts[0].notification_sent, false);
  });

  test("the existing sales-chat call shape is unaffected — no origin, no message", async () => {
    net = captureNetwork();
    const ok = await sendSalesLeadNotification({
      name: "Chat Prospect",
      email: "chat@example.com",
      phone: null,
      company: "Chat Co",
      industry: "plumber",
      preferredDemoTime: "Tuesday 3pm",
    });
    assert.equal(ok, true);
    const mail = net.emails[0];
    assert.match(mail.html, /completed the sales chat on the marketing site/);
    assert.doesNotMatch(mail.html, /Business Opportunity Scan/);
    assert.doesNotMatch(mail.html, /Message<\/td>/);
    assert.match(mail.html, /Industry<\/td>.*plumber/s);
    assert.match(mail.html, /Preferred demo time<\/td>.*Tuesday 3pm/s);
  });
});

// ── 3. Refusals have no side effects ───────────────────────────────

describe("a refused body produces no insert and no email", () => {
  const SMUGGLED = [
    "source",
    "org_id",
    "answers",
    "report",
    "findings",
    "recommendation",
    "estimate",
    "estimate_basis",
    "condition",
    "question_set_version",
    "run_id",
    "session_id",
    "visitor_id",
    "company",
    "metadata",
  ];

  for (const key of SMUGGLED) {
    test(`"${key}" in the body → 400, zero inserts, zero emails`, async () => {
      net = captureNetwork();
      const res = await post({ ...EMAIL_ONLY, [key]: "x" });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.ok(body.errors.some((e) => e.code === "unexpected_field"));
      assert.equal(net.inserts.length, 0);
      assert.equal(net.emails.length, 0);
    });
  }

  test("a client-supplied source can never reach the row, and the constant always does", async () => {
    net = captureNetwork();
    const refused = await post({ ...EMAIL_ONLY, source: "chat" });
    assert.equal(refused.status, 400);
    assert.equal(net.inserts.length, 0);
    const ok = await post(EMAIL_ONLY);
    assert.equal(ok.status, 201);
    assert.equal(net.inserts[0].source, "scan_contact");
  });

  test("BC-1 refusals surface as 400 with the BC-1 error shape", async () => {
    net = captureNetwork();
    const cases = [
      [{ email: "ada@example.com" }, "required"],
      [{ name: "Ada Lovelace" }, "contact_method_required"],
      [{ ...EMAIL_ONLY, phone: "+44 7700 900000" }, "contact_method_conflict"],
      [{ name: "Ada Lovelace", email: "nope" }, "invalid_email"],
      [{ name: "Ada Lovelace", phone: "-------" }, "invalid_phone"],
      [{ name: "ada@example.com", phone: "+44 7700 900000" }, "looks_like_contact_detail"],
      [{ ...EMAIL_ONLY, message: "m".repeat(2001) }, "too_long"],
    ];
    for (const [body, code] of cases) {
      const res = await post(body);
      assert.equal(res.status, 400, code);
      const json = await res.json();
      assert.ok(json.errors.some((e) => e.code === code), `expected ${code}`);
    }
    assert.equal(net.inserts.length, 0);
    assert.equal(net.emails.length, 0);
  });

  test("non-JSON, empty and non-object bodies → 400 not_an_object", async () => {
    net = captureNetwork();
    for (const raw of ["not json", "", "[]", "\"ada\"", "null", "42"]) {
      const res = await post(null, { raw });
      assert.equal(res.status, 400, JSON.stringify(raw));
      const json = await res.json();
      assert.deepEqual(json.errors.map((e) => e.code), ["not_an_object"]);
    }
    assert.equal(net.inserts.length, 0);
  });

  test("an oversize body → 413 before parsing", async () => {
    net = captureNetwork();
    const big = JSON.stringify({ ...EMAIL_ONLY, message: "m".repeat(9000) });
    const res = await post(null, { raw: big });
    assert.equal(res.status, 413);
    const declared = await post(null, { raw: "{}", headers: { "content-length": "9000" } });
    assert.equal(declared.status, 413);
    assert.equal(net.inserts.length, 0);
  });

  test("an insert failure → 500, nothing thrown, nothing echoed", async () => {
    net = captureNetwork({ failInsert: true });
    const res = await post(EMAIL_ONLY);
    assert.equal(res.status, 500);
    const json = await res.json();
    assert.deepEqual(Object.keys(json), ["error"]);
    assert.doesNotMatch(JSON.stringify(json), /Ada|ada@example/);
  });
});

// ── 4. Rate limiting ───────────────────────────────────────────────

describe("rate limiting is per client address, transient, and never stored", () => {
  test("the sixth request from one address in the window → 429 with no insert", async () => {
    net = captureNetwork();
    const ip = freshIp();
    for (let i = 0; i < 5; i++) {
      const res = await post(EMAIL_ONLY, { ip });
      assert.equal(res.status, 201, `request ${i + 1}`);
    }
    const sixth = await post(EMAIL_ONLY, { ip });
    assert.equal(sixth.status, 429);
    assert.equal(net.inserts.length, 5);
    assert.equal(net.emails.length, 5);
  });

  test("the address is refused before the body is read — a 429 never validates or inserts", async () => {
    net = captureNetwork();
    const ip = freshIp();
    for (let i = 0; i < 5; i++) await post(EMAIL_ONLY, { ip });
    const res = await post({ ...EMAIL_ONLY, source: "chat" }, { ip });
    assert.equal(res.status, 429);
  });

  test("the client address never appears in any insert or email", async () => {
    net = captureNetwork();
    const ip = "203.0.113.77";
    await post({ ...EMAIL_ONLY, message: "hi" }, { ip });
    assert.doesNotMatch(JSON.stringify(net.inserts), /203\.0\.113\.77/);
    assert.doesNotMatch(JSON.stringify(net.emails), /203\.0\.113\.77/);
  });

  test("x-real-ip is the fallback key when x-forwarded-for is absent", async () => {
    net = captureNetwork();
    const headers = { "x-forwarded-for": "", "x-real-ip": "198.51.100.9" };
    // Build without the default x-forwarded-for by overriding it with an empty value.
    for (let i = 0; i < 5; i++) {
      const res = await post(EMAIL_ONLY, { ip: "", headers });
      assert.equal(res.status, 201);
    }
    const res = await post(EMAIL_ONLY, { ip: "", headers });
    assert.equal(res.status, 429);
  });
});

// ── 5. recordScanContact directly ──────────────────────────────────

describe("recordScanContact", () => {
  test("returns the new id and the notification outcome", async () => {
    net = captureNetwork();
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const result = await recordScanContact(createAdminClient(), {
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: null,
      business_name: null,
      message: null,
    });
    assert.deepEqual(result, { leadId: "lead-1", notified: true });
  });

  test("returns leadId null when the insert fails, but still reports the notification", async () => {
    net = captureNetwork({ failInsert: true });
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const result = await recordScanContact(createAdminClient(), {
      name: "Ada Lovelace",
      email: null,
      phone: "+44 7700 900000",
      business_name: null,
      message: null,
    });
    assert.deepEqual(result, { leadId: null, notified: true });
  });
});

// ── 6. Structural pins on the route ────────────────────────────────

describe("the route file is structurally unable to carry anything else", () => {
  const src = readFileSync(ROUTE_FILE, "utf8");
  const code = src
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
  const specifiers = (src.match(/from\s+["']([^"']+)["']/g) ?? []).map((s) => s.replace(/from\s+["']|["']/g, ""));

  test("imports are exactly the five it needs", () => {
    assert.deepEqual(specifiers.sort(), [
      "@/lib/freetools/scanContact",
      "@/lib/rateLimit",
      "@/lib/salesLeadCapture",
      "@/lib/supabase/admin",
      "next/server",
    ]);
  });

  test("no Scan module other than scanContact — the route cannot read a report", () => {
    for (const s of specifiers) {
      if (s.includes("freetools")) assert.equal(s, "@/lib/freetools/scanContact");
    }
    assert.doesNotMatch(code, /buildScanReport|validateScanAnswers|SCAN_QUESTION|scanFindings|scanTypes/);
  });

  test("no cookie, query string, storage, identifier or tenant access", () => {
    assert.doesNotMatch(code, /cookies\(|set-cookie|\.cookies|searchParams|nextUrl|localStorage|sessionStorage|randomUUID|crypto\./i);
    assert.doesNotMatch(code, /org_id|orgId|organisations|\.from\(["']leads["']\)|\.from\(["']organisations["']\)/);
  });

  test("the only header reads are the client-address and content-length ones", () => {
    const reads = code.match(/headers\.get\(["']([^"']+)["']\)/g) ?? [];
    assert.deepEqual(
      reads.map((r) => r.replace(/headers\.get\(["']|["']\)/g, "")).sort(),
      ["content-length", "x-forwarded-for", "x-real-ip"]
    );
  });

  test("the route validates nothing itself — validateScanContact is the sole refusal authority", () => {
    assert.match(code, /validateScanContact\(body\)/);
    assert.doesNotMatch(code, /EMAIL_PATTERN|PHONE_PATTERN|\.trim\(\)\.length|typeof body\.(name|email|phone)/);
  });

  test("the approved limits", () => {
    assert.match(code, /PER_IP_LIMIT = 5\b/);
    assert.match(code, /GLOBAL_LIMIT = 30\b/);
    assert.match(code, /WINDOW_MS = 60 \* 60_000/);
    assert.match(code, /MAX_BODY_BYTES = 8 \* 1024/);
  });

  test("no `after()` — the notification gates a stored boolean and must be awaited", () => {
    assert.doesNotMatch(code, /\bafter\(/);
  });
});
