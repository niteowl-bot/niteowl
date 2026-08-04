// Tests for the shared auth-strategy logic.
//
// The two that matter most in production:
//   * a refresh must not wipe the refresh token when the provider
//     declines to reissue one (Google's behaviour) — that would force
//     every owner to reconnect after an hour;
//   * a partial scope grant must be detected at connect time, not
//     discovered as a 403 in the middle of a customer's booking.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  needsRefresh,
  mergeRefreshedCredentials,
  expiryFromSeconds,
  generateOAuthState,
  hasRequiredScopes,
  missingScopes,
  assertStrategy,
  isOAuth2Strategy,
} from "@/lib/integrations/auth";

const NOW = new Date("2026-08-04T12:00:00.000Z");

function oauth(overrides = {}) {
  return {
    strategy: "oauth2",
    accessToken: "access",
    refreshToken: "refresh",
    expiresAtIso: "2026-08-04T13:00:00.000Z",
    scopes: "calendar.events",
    ...overrides,
  };
}

describe("refresh decisions", () => {
  test("a token with plenty of life left is left alone", () => {
    assert.equal(needsRefresh(oauth(), NOW), false);
  });

  test("an expired token is refreshed", () => {
    assert.equal(
      needsRefresh(oauth({ expiresAtIso: "2026-08-04T11:00:00.000Z" }), NOW),
      true
    );
  });

  test("a token expiring within the safety margin is refreshed early", () => {
    // 60s left, against a 120s skew — refreshing at the last moment
    // races the request that is about to use it.
    assert.equal(
      needsRefresh(oauth({ expiresAtIso: "2026-08-04T12:01:00.000Z" }), NOW),
      true
    );
    // Just outside the margin.
    assert.equal(
      needsRefresh(oauth({ expiresAtIso: "2026-08-04T12:05:00.000Z" }), NOW),
      false
    );
  });

  test("an unknown or unparseable expiry is treated as needing a refresh", () => {
    // Not knowing when a token dies is not the same as knowing it is alive.
    assert.equal(needsRefresh(oauth({ expiresAtIso: null }), NOW), true);
    assert.equal(needsRefresh(oauth({ expiresAtIso: "whenever" }), NOW), true);
  });

  test("a token with no refresh token cannot be refreshed", () => {
    // The connection is heading for needs_reauth; a refresh attempt
    // would just fail noisily.
    assert.equal(needsRefresh(oauth({ refreshToken: null }), NOW), false);
  });

  test("non-OAuth credentials never expire on a clock", () => {
    // An API key or app password is valid until revoked, which surfaces
    // as an auth_expired error from the provider, not a time comparison.
    assert.equal(needsRefresh({ strategy: "api_key", values: {} }, NOW), false);
    assert.equal(needsRefresh({ strategy: "basic", username: "u", password: "p" }, NOW), false);
    assert.equal(needsRefresh({ strategy: "none" }, NOW), false);
  });
});

describe("merging a refresh response", () => {
  test("a refresh that omits the refresh token keeps the stored one", () => {
    // Google does exactly this. Replacing naively would discard the only
    // long-lived credential and force a reconnect within the hour.
    const merged = mergeRefreshedCredentials(
      oauth({ refreshToken: "original-refresh" }),
      oauth({ accessToken: "new-access", refreshToken: null, expiresAtIso: null, scopes: null })
    );
    assert.equal(merged.accessToken, "new-access");
    assert.equal(merged.refreshToken, "original-refresh");
    // Falls back for the other fields too rather than nulling them.
    assert.equal(merged.expiresAtIso, "2026-08-04T13:00:00.000Z");
    assert.equal(merged.scopes, "calendar.events");
  });

  test("a rotated refresh token replaces the old one", () => {
    // Microsoft reissues on refresh; keeping the old one would break the
    // next refresh.
    const merged = mergeRefreshedCredentials(
      oauth({ refreshToken: "old" }),
      oauth({ accessToken: "new-access", refreshToken: "rotated" })
    );
    assert.equal(merged.refreshToken, "rotated");
  });

  test("a strategy change is taken wholesale", () => {
    const merged = mergeRefreshedCredentials(oauth(), { strategy: "none" });
    assert.deepEqual(merged, { strategy: "none" });
  });
});

describe("expiry conversion", () => {
  test("expires_in seconds becomes an absolute instant", () => {
    assert.equal(expiryFromSeconds(3600, NOW), "2026-08-04T13:00:00.000Z");
    assert.equal(expiryFromSeconds("3600", NOW), "2026-08-04T13:00:00.000Z");
  });

  test("a missing or nonsensical value yields null, not a bogus date", () => {
    for (const bad of [undefined, null, "", "soon", 0, -5, Number.NaN]) {
      assert.equal(expiryFromSeconds(bad, NOW), null, String(bad));
    }
  });
});

describe("scope checking", () => {
  test("all required scopes present passes", () => {
    assert.equal(
      hasRequiredScopes("calendar.events calendar.readonly", [
        "calendar.events",
        "calendar.readonly",
      ]),
      true
    );
  });

  test("a partial grant is caught at connect time", () => {
    // Google's consent screen lets a user untick individual permissions.
    // Without this the failure appears much later as a confusing 403.
    assert.equal(
      hasRequiredScopes("calendar.readonly", ["calendar.events", "calendar.readonly"]),
      false
    );
    assert.deepEqual(
      missingScopes("calendar.readonly", ["calendar.events", "calendar.readonly"]),
      ["calendar.events"]
    );
  });

  test("comma-separated and extra scopes are handled", () => {
    assert.equal(hasRequiredScopes("a,b,c", ["a", "c"]), true);
    assert.equal(hasRequiredScopes("a b c extra", ["a"]), true);
  });

  test("no granted scopes fails unless none were required", () => {
    assert.equal(hasRequiredScopes(null, ["calendar.events"]), false);
    assert.equal(hasRequiredScopes(null, []), true);
    assert.deepEqual(missingScopes(null, ["a", "b"]), ["a", "b"]);
  });
});

describe("state nonce", () => {
  test("is long, URL-safe and never repeats", () => {
    const a = generateOAuthState();
    const b = generateOAuthState();
    assert.notEqual(a, b);
    assert.ok(a.length >= 40, `expected a long nonce, got ${a.length}`);
    assert.match(a, /^[A-Za-z0-9_-]+$/);
  });
});

describe("strategy narrowing", () => {
  test("the expected strategy is returned", () => {
    const credentials = oauth();
    assert.equal(assertStrategy(credentials, "oauth2"), credentials);
  });

  test("a mismatched strategy throws rather than being coerced", () => {
    assert.throws(
      () => assertStrategy({ strategy: "api_key", values: {} }, "oauth2"),
      /Expected oauth2 credentials but received api_key/
    );
  });

  test("oauth strategies are identifiable", () => {
    assert.equal(isOAuth2Strategy({ id: "oauth2" }), true);
    assert.equal(isOAuth2Strategy({ id: "api_key" }), false);
  });
});
