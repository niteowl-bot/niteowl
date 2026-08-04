// Tests for the OAuth state (CSRF) check on the connect callback.
//
// The attack this prevents: tricking a signed-in owner into visiting a
// crafted callback URL that attaches the ATTACKER'S Google account to
// the owner's business. Remy would then read the attacker's calendar
// and write the business's customers into it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  verifyStateCookie,
  encodeStateCookie,
  stateCookieOptions,
  OAUTH_STATE_COOKIE,
} from "@/lib/integrations/oauthState";

describe("state verification", () => {
  test("a matching nonce and provider passes", () => {
    const cookie = encodeStateCookie("google", "nonce-abc");
    assert.deepEqual(verifyStateCookie(cookie, "nonce-abc", "google"), { valid: true });
  });

  test("a forged callback with no cookie is rejected", () => {
    const result = verifyStateCookie(undefined, "nonce-abc", "google");
    assert.equal(result.valid, false);
    assert.equal(result.reason, "missing_cookie");
  });

  test("a callback with no state is rejected", () => {
    const cookie = encodeStateCookie("google", "nonce-abc");
    assert.equal(verifyStateCookie(cookie, null, "google").valid, false);
    assert.equal(verifyStateCookie(cookie, "", "google").reason, "missing_state");
  });

  test("a wrong nonce is rejected", () => {
    const cookie = encodeStateCookie("google", "nonce-abc");
    const result = verifyStateCookie(cookie, "nonce-xyz", "google");
    assert.equal(result.valid, false);
    assert.equal(result.reason, "nonce_mismatch");
  });

  test("a nonce issued for one integration cannot be replayed at another", () => {
    // Otherwise a state obtained from a low-value integration's connect
    // flow could be spent on the calendar callback.
    const cookie = encodeStateCookie("google", "nonce-abc");
    const result = verifyStateCookie(cookie, "nonce-abc", "microsoft");
    assert.equal(result.valid, false);
    assert.equal(result.reason, "provider_mismatch");
  });

  test("a malformed cookie is rejected rather than parsed loosely", () => {
    assert.equal(verifyStateCookie("no-separator", "nonce", "google").valid, false);
    assert.equal(verifyStateCookie("google:", "nonce", "google").valid, false);
    assert.equal(verifyStateCookie("", "nonce", "google").valid, false);
  });

  test("a prefix of the real nonce does not pass", () => {
    const cookie = encodeStateCookie("google", "nonce-abc-long");
    assert.equal(verifyStateCookie(cookie, "nonce-abc", "google").valid, false);
  });

  test("a nonce containing the separator survives the round trip", () => {
    // base64url never produces ":", but the encoding must not corrupt
    // a value that does — the split is on the FIRST separator only.
    const cookie = encodeStateCookie("google", "a:b:c");
    assert.deepEqual(verifyStateCookie(cookie, "a:b:c", "google"), { valid: true });
  });
});

describe("cookie options", () => {
  test("httpOnly, so script on the page cannot read or forge it", () => {
    assert.equal(stateCookieOptions(true).httpOnly, true);
  });

  test("sameSite is lax, because the callback is a cross-site navigation", () => {
    // "strict" would stop the cookie being sent when Google redirects
    // back, breaking every connection attempt.
    assert.equal(stateCookieOptions(true).sameSite, "lax");
  });

  test("secure in production, relaxed locally so http://localhost works", () => {
    assert.equal(stateCookieOptions(true).secure, true);
    assert.equal(stateCookieOptions(false).secure, false);
  });

  test("it expires on its own, so an abandoned attempt leaves nothing usable", () => {
    const options = stateCookieOptions(true);
    assert.ok(options.maxAge > 0);
    assert.ok(options.maxAge <= 900, "a state nonce should not outlive one consent screen");
  });

  test("the cookie name is stable", () => {
    assert.equal(OAUTH_STATE_COOKIE, "niteowl_integration_state");
  });
});
