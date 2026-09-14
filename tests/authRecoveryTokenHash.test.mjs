// Cross-device password recovery: the token_hash link shape.
//
// The production failure this closes (2026-09-14): a PKCE `?code=` reset
// link only exchanges in the browser profile that REQUESTED the reset,
// because the code verifier lives in that profile's cookie jar. A customer
// who asks on their phone and opens the email on a laptop was told the
// link had expired. Supabase's documented server-side pattern puts the
// token hash in the link itself and verifies it with `verifyOtp`, which
// needs nothing from the requesting browser.
//
// Every token below is a synthetic placeholder. No live credential is
// used, printed or persisted by these tests.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  parseRecoveryLinkParams,
  isWellFormedTokenHash,
  MAX_TOKEN_HASH_LENGTH,
} from "@/lib/auth/recoveryLink";

const HASH = "synthetic-token-hash-HHH";
const CODE = "synthetic-pkce-code-CCC";

function params(obj) {
  return new URLSearchParams(obj);
}

// ── parser ─────────────────────────────────────────────────────────

describe("parseRecoveryLinkParams", () => {
  test("token_hash + type=recovery is the token_hash shape", () => {
    assert.deepEqual(parseRecoveryLinkParams(params({ token_hash: HASH, type: "recovery" })), {
      kind: "token_hash",
      token_hash: HASH,
    });
  });

  test("the hash is passed through untouched", () => {
    const odd = "abc.DEF_123-xyz~";
    const parsed = parseRecoveryLinkParams(params({ token_hash: odd, type: "recovery" }));
    assert.equal(parsed.kind, "token_hash");
    assert.equal(parsed.token_hash, odd);
  });

  test("token_hash with no type is refused", () => {
    assert.deepEqual(parseRecoveryLinkParams(params({ token_hash: HASH })), { kind: "invalid" });
  });

  test("type=recovery with no token_hash is refused", () => {
    assert.deepEqual(parseRecoveryLinkParams(params({ type: "recovery" })), { kind: "invalid" });
  });

  test("a token_hash of the wrong type is refused — magiclink, signup, email_change, invite", () => {
    for (const type of ["magiclink", "signup", "email_change", "invite", "email", "RECOVERY", ""]) {
      assert.deepEqual(
        parseRecoveryLinkParams(params({ token_hash: HASH, type })),
        { kind: "invalid" },
        `type=${JSON.stringify(type)} must be refused`
      );
    }
  });

  test("an empty token_hash is refused", () => {
    assert.deepEqual(parseRecoveryLinkParams(params({ token_hash: "", type: "recovery" })), {
      kind: "invalid",
    });
  });

  test("a whitespace or whitespace-bearing token_hash is refused", () => {
    for (const bad of ["   ", " abc", "abc ", "ab c", "ab\tc", "ab\nc"]) {
      assert.deepEqual(
        parseRecoveryLinkParams(params({ token_hash: bad, type: "recovery" })),
        { kind: "invalid" },
        `token_hash=${JSON.stringify(bad)} must be refused`
      );
    }
  });

  test("an over-length token_hash is refused; the cap itself is accepted", () => {
    const atCap = "a".repeat(MAX_TOKEN_HASH_LENGTH);
    const overCap = "a".repeat(MAX_TOKEN_HASH_LENGTH + 1);
    assert.equal(parseRecoveryLinkParams(params({ token_hash: atCap, type: "recovery" })).kind, "token_hash");
    assert.deepEqual(parseRecoveryLinkParams(params({ token_hash: overCap, type: "recovery" })), {
      kind: "invalid",
    });
    assert.equal(isWellFormedTokenHash(overCap), false);
  });

  test("token_hash and code together is ambiguous and refused", () => {
    assert.deepEqual(
      parseRecoveryLinkParams(params({ token_hash: HASH, type: "recovery", code: CODE })),
      { kind: "invalid" }
    );
    assert.deepEqual(parseRecoveryLinkParams(params({ token_hash: HASH, code: CODE })), {
      kind: "invalid",
    });
  });

  test("code alone is the existing PKCE shape", () => {
    assert.deepEqual(parseRecoveryLinkParams(params({ code: CODE })), { kind: "code", code: CODE });
  });

  test("a code accompanied by a type is refused, not treated as PKCE", () => {
    // `type` belongs to the token_hash shape; alongside a code it is a
    // recognisable-but-wrong link, not a PKCE one.
    assert.deepEqual(parseRecoveryLinkParams(params({ code: CODE, type: "recovery" })), {
      kind: "invalid",
    });
  });

  test("an empty code is treated as no code, exactly as the original truthiness check did", () => {
    assert.deepEqual(parseRecoveryLinkParams(params({ code: "" })), { kind: "none" });
  });

  test("no parameters is none", () => {
    assert.deepEqual(parseRecoveryLinkParams(params({})), { kind: "none" });
  });

  test("unrelated parameters alone are none", () => {
    assert.deepEqual(parseRecoveryLinkParams(params({ utm_source: "email" })), { kind: "none" });
  });
});

// ── the route, driven for real ─────────────────────────────────────

describe("GET /auth/confirm-reset", () => {
  const origFetch = globalThis.fetch;
  let requests;
  let captured;
  const origConsole = { error: console.error, warn: console.warn, log: console.log };

  function stubFetch(handler) {
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input.url;
      let body = null;
      if (init.body) {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      requests.push({ url, method: init.method ?? "GET", body });
      return handler(url, body);
    };
  }

  const sessionResponse = () =>
    new Response(
      JSON.stringify({
        access_token: "synthetic-access-token-AAA",
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: "synthetic-refresh-token-RRR",
        user: { id: "stub-user", aud: "authenticated", role: "authenticated", email: "x@example.com" },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  const otpExpiredResponse = () =>
    new Response(
      JSON.stringify({
        code: 403,
        error_code: "otp_expired",
        msg: "Email link is invalid or has expired",
      }),
      { status: 403, headers: { "content-type": "application/json" } }
    );

  beforeEach(() => {
    requests = [];
    captured = [];
    for (const k of Object.keys(origConsole)) {
      console[k] = (...args) => captured.push(args.map(String).join(" "));
    }
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    for (const k of Object.keys(origConsole)) console[k] = origConsole[k];
  });

  async function get(query) {
    const { GET } = await import("@/app/auth/confirm-reset/route");
    return GET(new Request(`https://niteowlhq.com/auth/confirm-reset${query}`));
  }

  function verifyCalls() {
    return requests.filter((r) => r.url.endsWith("/auth/v1/verify"));
  }

  function assertNoLeak(res) {
    const location = res.headers.get("location") ?? "";
    assert.ok(!location.includes(HASH), "token hash must not appear in Location");
    assert.ok(!location.includes(CODE), "code must not appear in Location");
    const leaked = captured.filter((line) => line.includes(HASH) || line.includes(CODE));
    assert.deepEqual(leaked, [], "no credential may reach the console");
  }

  test("valid token_hash → verifyOtp as type recovery → /reset-password", async () => {
    stubFetch((url) => (url.endsWith("/auth/v1/verify") ? sessionResponse() : new Response("{}", { status: 500 })));

    const res = await get(`?token_hash=${HASH}&type=recovery`);

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.origin, "https://niteowlhq.com");
    assert.equal(location.pathname, "/reset-password");
    assert.equal(location.search, "");

    const calls = verifyCalls();
    assert.equal(calls.length, 1, "exactly one verify call");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].body.type, "recovery");
    assert.equal(calls[0].body.token_hash, HASH);
    assertNoLeak(res);
  });

  test("the URL's type never reaches Supabase — the route fixes it to recovery itself", async () => {
    // Even a valid link only ever produces `type: "recovery"` in the
    // verify body; a relabelled token cannot select another flow.
    stubFetch((url) => (url.endsWith("/auth/v1/verify") ? sessionResponse() : new Response("{}", { status: 500 })));
    await get(`?token_hash=${HASH}&type=recovery`);
    assert.equal(verifyCalls()[0].body.type, "recovery");
  });

  test("expired or already-used token_hash → /forgot-password?error=link, no session", async () => {
    stubFetch((url) => (url.endsWith("/auth/v1/verify") ? otpExpiredResponse() : new Response("{}", { status: 500 })));

    const res = await get(`?token_hash=${HASH}&type=recovery`);

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.pathname, "/forgot-password");
    assert.equal(location.searchParams.get("error"), "link");
    assert.equal(verifyCalls().length, 1);
    assertNoLeak(res);
  });

  test("Supabase unreachable during verification fails closed", async () => {
    stubFetch(() => {
      throw new Error("network down");
    });
    const res = await get(`?token_hash=${HASH}&type=recovery`);
    assert.equal(res.status, 307);
    assert.equal(new URL(res.headers.get("location")).pathname, "/forgot-password");
    assertNoLeak(res);
  });

  test("a token_hash of the wrong type is refused BEFORE any Supabase call", async () => {
    stubFetch(() => sessionResponse());
    const res = await get(`?token_hash=${HASH}&type=magiclink`);

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.pathname, "/forgot-password");
    assert.equal(location.searchParams.get("error"), "link");
    assert.equal(requests.length, 0, "no network call for a refused link");
    assertNoLeak(res);
  });

  test("a token_hash with no type is refused before any Supabase call", async () => {
    stubFetch(() => sessionResponse());
    const res = await get(`?token_hash=${HASH}`);
    assert.equal(new URL(res.headers.get("location")).pathname, "/forgot-password");
    assert.equal(requests.length, 0);
    assertNoLeak(res);
  });

  test("token_hash and code together are refused before any Supabase call", async () => {
    stubFetch(() => sessionResponse());
    const res = await get(`?token_hash=${HASH}&type=recovery&code=${CODE}`);
    assert.equal(new URL(res.headers.get("location")).pathname, "/forgot-password");
    assert.equal(requests.length, 0);
    assertNoLeak(res);
  });

  test("existing code-only path is unchanged: PKCE exchange, never /verify", async () => {
    // The test cookie jar carries no code verifier, so auth-js refuses the
    // exchange locally (AuthPKCECodeVerifierMissingError) — the exact
    // outcome production had for a cross-browser link, and the branch
    // this PR leaves alone. What is pinned: the token_hash machinery is
    // not consulted for a code link.
    stubFetch((url) => (url.endsWith("/auth/v1/verify") ? sessionResponse() : otpExpiredResponse()));
    const res = await get(`?code=${CODE}`);

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.pathname, "/forgot-password");
    assert.equal(location.searchParams.get("error"), "link");
    assert.equal(verifyCalls().length, 0, "a code link must never hit /verify");
    assertNoLeak(res);
  });

  test("no-parameter path is unchanged: forwarded to /reset-password (PR #96)", async () => {
    stubFetch(() => sessionResponse());
    const res = await get("");
    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.pathname, "/reset-password");
    assert.equal(location.hash, "");
    assert.equal(requests.length, 0);
  });

  test("an empty code is still the no-parameter path", async () => {
    stubFetch(() => sessionResponse());
    const res = await get("?code=");
    assert.equal(new URL(res.headers.get("location")).pathname, "/reset-password");
    assert.equal(requests.length, 0);
  });
});
