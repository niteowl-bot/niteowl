// Regression tests for the auth-callback defect found during the Remy V1
// Google OAuth verification (2026-09-14).
//
// The failure: Supabase answered a fresh magic link and a fresh password
// recovery link with an IMPLICIT-flow redirect — tokens in the URL
// fragment — and NiteOwl consumed them nowhere. Both landing routes read
// only `?code=` (a fragment never reaches the server), the browser client
// is PKCE-only and rejects an implicit fragment, and the homepage mounts
// no client at all. Result: /auth/confirm-reset bounced every fragment
// recovery to /forgot-password?error=link, and a magic link left the
// visitor signed out with live tokens in the address bar.
//
// Every token below is a synthetic placeholder. No live credential is
// used, printed, or persisted by these tests.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  parseAuthHash,
  postAuthHashPath,
  consumeAuthHashSession,
} from "@/lib/auth/hashSession";

// Synthetic, deliberately non-JWT-shaped so nothing could mistake them
// for real material. A three-part dotted form is used where a decoder
// might be involved; none of these decode to anything.
const ACCESS = "synthetic-access-token-AAA";
const REFRESH = "synthetic-refresh-token-RRR";

function fragment(params) {
  return "#" + new URLSearchParams(params).toString();
}

function fakeWindow(hash, pathname = "/", search = "") {
  const win = {
    location: { hash, pathname, search },
    history: {
      state: { marker: "kept" },
      calls: [],
      replaceState(state, unused, url) {
        this.calls.push({ state, url });
        // Mirror the browser: the visible fragment is gone afterwards.
        win.location.hash = "";
      },
    },
  };
  return win;
}

function fakeClient({ error = null, onSetSession } = {}) {
  const calls = [];
  return {
    calls,
    auth: {
      async setSession(session) {
        calls.push(session);
        if (onSetSession) onSetSession(session);
        return { error };
      },
    },
  };
}

// ── parsing ────────────────────────────────────────────────────────

describe("parseAuthHash", () => {
  test("an empty or absent fragment is nothing", () => {
    assert.deepEqual(parseAuthHash(""), { kind: "none" });
    assert.deepEqual(parseAuthHash("#"), { kind: "none" });
  });

  test("an ordinary in-page anchor is nothing", () => {
    assert.deepEqual(parseAuthHash("#pricing"), { kind: "none" });
  });

  test("a PKCE-style landing carries no fragment and is nothing", () => {
    // ?code= lives in the query string, which this parser never sees.
    assert.deepEqual(parseAuthHash(""), { kind: "none" });
  });

  test("a recovery fragment yields both tokens and the recovery type", () => {
    const parsed = parseAuthHash(
      fragment({
        access_token: ACCESS,
        refresh_token: REFRESH,
        expires_in: "3600",
        token_type: "bearer",
        type: "recovery",
      })
    );
    assert.deepEqual(parsed, {
      kind: "tokens",
      access_token: ACCESS,
      refresh_token: REFRESH,
      type: "recovery",
    });
  });

  test("a magic-link fragment is a non-recovery session", () => {
    const parsed = parseAuthHash(
      fragment({ access_token: ACCESS, refresh_token: REFRESH, type: "magiclink" })
    );
    assert.equal(parsed.kind, "tokens");
    assert.equal(parsed.type, "other");
  });

  test("a fragment with no type at all is a non-recovery session", () => {
    const parsed = parseAuthHash(fragment({ access_token: ACCESS, refresh_token: REFRESH }));
    assert.equal(parsed.kind, "tokens");
    assert.equal(parsed.type, "other");
  });

  test("an expired or already-used link reports its error and never tokens", () => {
    const parsed = parseAuthHash(
      fragment({
        error: "access_denied",
        error_code: "otp_expired",
        error_description: "Email link is invalid or has expired",
      })
    );
    assert.deepEqual(parsed, { kind: "error" });
  });

  test("an error beats tokens if both are somehow present", () => {
    const parsed = parseAuthHash(
      fragment({ access_token: ACCESS, refresh_token: REFRESH, error: "x" })
    );
    assert.deepEqual(parsed, { kind: "error" });
  });

  test("an access token without a refresh token is malformed, not trusted", () => {
    assert.deepEqual(parseAuthHash(fragment({ access_token: ACCESS })), { kind: "malformed" });
  });

  test("a refresh token without an access token is malformed, not trusted", () => {
    assert.deepEqual(parseAuthHash(fragment({ refresh_token: REFRESH })), { kind: "malformed" });
  });

  test("blank tokens are malformed", () => {
    assert.deepEqual(
      parseAuthHash(fragment({ access_token: "  ", refresh_token: REFRESH })),
      { kind: "malformed" }
    );
  });
});

// ── destination is fixed ───────────────────────────────────────────

describe("postAuthHashPath", () => {
  test("recovery goes to the choose-a-new-password form", () => {
    assert.equal(postAuthHashPath("recovery"), "/reset-password");
  });

  test("everything else goes to the dashboard, like /auth/callback", () => {
    assert.equal(postAuthHashPath("other"), "/dashboard");
  });
});

// ── consumption ────────────────────────────────────────────────────

describe("consumeAuthHashSession", () => {
  let captured;
  beforeEach(() => {
    captured = [];
  });

  function captureConsole(fn) {
    const orig = { error: console.error, warn: console.warn, log: console.log };
    for (const k of Object.keys(orig)) {
      console[k] = (...args) => captured.push(args.map(String).join(" "));
    }
    return fn().finally(() => {
      for (const k of Object.keys(orig)) console[k] = orig[k];
    });
  }

  test("FLOW A — a magic-link fragment becomes a session and leaves the URL", async () => {
    const win = fakeWindow(
      fragment({ access_token: ACCESS, refresh_token: REFRESH, type: "magiclink" }),
      "/",
      ""
    );
    let hashAtSetSession = "unread";
    const client = fakeClient({
      onSetSession: () => {
        hashAtSetSession = win.location.hash;
      },
    });

    const outcome = await consumeAuthHashSession(() => client, win);

    assert.deepEqual(outcome, { kind: "session", type: "other" });
    assert.deepEqual(client.calls, [{ access_token: ACCESS, refresh_token: REFRESH }]);
    // The token-bearing URL is replaced BEFORE the network call is made.
    assert.equal(hashAtSetSession, "");
    assert.equal(win.history.calls.length, 1);
    assert.equal(win.history.calls[0].url, "/");
    assert.deepEqual(win.history.calls[0].state, { marker: "kept" });
    assert.equal(win.location.hash, "");
  });

  test("FLOW B — a recovery fragment becomes a recovery session on the reset page", async () => {
    const win = fakeWindow(
      fragment({ access_token: ACCESS, refresh_token: REFRESH, type: "recovery" }),
      "/reset-password"
    );
    const client = fakeClient();

    const outcome = await consumeAuthHashSession(() => client, win);

    assert.deepEqual(outcome, { kind: "session", type: "recovery" });
    assert.equal(postAuthHashPath(outcome.type), "/reset-password");
    assert.equal(client.calls.length, 1);
    assert.equal(win.location.hash, "");
    assert.equal(win.history.calls[0].url, "/reset-password");
  });

  test("the query string survives the cleanup; only the fragment goes", async () => {
    const win = fakeWindow(
      fragment({ access_token: ACCESS, refresh_token: REFRESH }),
      "/forgot-password",
      "?error=link"
    );
    await consumeAuthHashSession(() => fakeClient(), win);
    assert.equal(win.history.calls[0].url, "/forgot-password?error=link");
  });

  test("a page with no fragment creates no client and does nothing", async () => {
    const win = fakeWindow("", "/dashboard");
    let clientRequested = false;
    const outcome = await consumeAuthHashSession(() => {
      clientRequested = true;
      return fakeClient();
    }, win);

    assert.deepEqual(outcome, { kind: "none" });
    assert.equal(clientRequested, false);
    assert.equal(win.history.calls.length, 0);
  });

  test("an ordinary anchor is left alone", async () => {
    const win = fakeWindow("#pricing", "/");
    const outcome = await consumeAuthHashSession(() => fakeClient(), win);
    assert.deepEqual(outcome, { kind: "none" });
    assert.equal(win.location.hash, "#pricing");
    assert.equal(win.history.calls.length, 0);
  });

  test("FAIL CLOSED — Supabase rejecting the token yields no session, and the URL is still cleaned", async () => {
    const win = fakeWindow(fragment({ access_token: ACCESS, refresh_token: REFRESH, type: "recovery" }));
    const client = fakeClient({ error: { message: "invalid claim" } });

    const outcome = await consumeAuthHashSession(() => client, win);

    assert.deepEqual(outcome, { kind: "rejected", reason: "session_rejected" });
    assert.equal(win.location.hash, "");
  });

  test("FAIL CLOSED — setSession throwing is contained", async () => {
    const win = fakeWindow(fragment({ access_token: ACCESS, refresh_token: REFRESH }));
    const client = {
      auth: {
        async setSession() {
          throw new Error("network down");
        },
      },
    };
    const outcome = await consumeAuthHashSession(() => client, win);
    assert.deepEqual(outcome, { kind: "rejected", reason: "session_rejected" });
    assert.equal(win.location.hash, "");
  });

  test("FAIL CLOSED — an expired-link error fragment never reaches setSession", async () => {
    const win = fakeWindow(
      fragment({ error: "access_denied", error_code: "otp_expired", error_description: "expired" })
    );
    const client = fakeClient();
    const outcome = await consumeAuthHashSession(() => client, win);

    assert.deepEqual(outcome, { kind: "rejected", reason: "error_in_url" });
    assert.equal(client.calls.length, 0);
    assert.equal(win.location.hash, "");
  });

  test("FAIL CLOSED — a malformed fragment never reaches setSession", async () => {
    const win = fakeWindow(fragment({ access_token: ACCESS }));
    const client = fakeClient();
    const outcome = await consumeAuthHashSession(() => client, win);

    assert.deepEqual(outcome, { kind: "rejected", reason: "malformed" });
    assert.equal(client.calls.length, 0);
    assert.equal(win.location.hash, "");
  });

  test("concurrent callers on one page load share one consumption", async () => {
    // The global handler and the reset page both ask; setSession must
    // run once, and the second caller must see the same answer rather
    // than a 'none' produced by the already-stripped hash.
    let release;
    const gate = new Promise((r) => (release = r));
    const client = {
      calls: 0,
      auth: {
        async setSession() {
          client.calls += 1;
          await gate;
          return { error: null };
        },
      },
    };
    const win = fakeWindow(fragment({ access_token: ACCESS, refresh_token: REFRESH, type: "recovery" }));

    const first = consumeAuthHashSession(() => client, win);
    const second = consumeAuthHashSession(() => client, win);
    assert.equal(first, second);
    release();

    const [a, b] = await Promise.all([first, second]);
    assert.deepEqual(a, { kind: "session", type: "recovery" });
    assert.deepEqual(b, a);
    assert.equal(client.calls, 1);
  });

  test("after consumption a later caller sees no fragment and does not re-consume", async () => {
    const client = fakeClient();
    const win = fakeWindow(fragment({ access_token: ACCESS, refresh_token: REFRESH }));
    await consumeAuthHashSession(() => client, win);
    const again = await consumeAuthHashSession(() => client, win);
    assert.deepEqual(again, { kind: "none" });
    assert.equal(client.calls.length, 1);
  });

  test("no token ever reaches the console on any path", async () => {
    await captureConsole(async () => {
      for (const hash of [
        fragment({ access_token: ACCESS, refresh_token: REFRESH, type: "recovery" }),
        fragment({ access_token: ACCESS, refresh_token: REFRESH }),
        fragment({ access_token: ACCESS }),
        fragment({ error: "access_denied", error_description: ACCESS }),
      ]) {
        await consumeAuthHashSession(() => fakeClient({ error: { message: "nope" } }), fakeWindow(hash));
        await consumeAuthHashSession(() => fakeClient(), fakeWindow(hash));
      }
    });
    const leaked = captured.filter((line) => line.includes(ACCESS) || line.includes(REFRESH));
    assert.deepEqual(leaked, []);
  });
});

// ── the recovery landing route ─────────────────────────────────────

describe("GET /auth/confirm-reset", () => {
  // The route only builds a Supabase client when a `?code=` is present,
  // so the no-code path is driven end-to-end with no network at all.
  test("a landing with no code is forwarded to /reset-password, not reported expired", async () => {
    const { GET } = await import("@/app/auth/confirm-reset/route");
    const res = await GET(new Request("https://niteowlhq.com/auth/confirm-reset"));

    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.pathname, "/reset-password");
    assert.equal(location.origin, "https://niteowlhq.com");
    // The Location carries no fragment of its own, which is what lets
    // the browser preserve the one Supabase attached.
    assert.equal(location.hash, "");
    assert.notEqual(location.pathname, "/forgot-password");
  });

  test("a failed code exchange still reports the link as expired", async () => {
    // A code IS present, so the route exchanges it. The stubbed fetch
    // refuses, exactly as Supabase does for a used or expired code.
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "invalid_grant", error_description: "expired" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    try {
      const { GET } = await import("@/app/auth/confirm-reset/route");
      const res = await GET(
        new Request("https://niteowlhq.com/auth/confirm-reset?code=synthetic-used-code")
      );
      assert.equal(res.status, 307);
      const location = new URL(res.headers.get("location"));
      assert.equal(location.pathname, "/forgot-password");
      assert.equal(location.searchParams.get("error"), "link");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("the reset page consumes the fragment BEFORE deciding whether a session exists", async () => {
    // Source-level pin of the ordering the race depends on: the page
    // awaits consumeAuthHashSession and only then calls getUser.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../src/app/(auth)/reset-password/page.tsx", import.meta.url),
      "utf8"
    );
    const consumeAt = src.indexOf("consumeAuthHashSession(");
    const getUserAt = src.indexOf("supabase.auth.getUser()");
    assert.ok(consumeAt > 0, "reset page must consume the fragment");
    assert.ok(getUserAt > consumeAt, "getUser must follow fragment consumption");
  });

  test("the global handler is mounted in the root layout", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
    assert.match(src, /<AuthHashSessionHandler \/>/);
  });
});
