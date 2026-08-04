// Tests for integration credential encryption at rest.
//
// These hold the security properties every integration depends on: a
// stolen database row must not yield a usable credential, and an edited
// row must fail loudly rather than producing a corrupted bearer token
// that gets sent to a provider.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import {
  encryptSecret,
  decryptSecret,
  loadKeyringFromEnv,
  keyVersionOf,
  needsReEncryption,
  safeEquals,
  encryptCredentials,
  decryptCredentials,
  SecretCryptoError,
} from "@/lib/integrations/crypto";

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");

function keyring(currentVersion = 1, entries = [[1, KEY_A]]) {
  return {
    currentVersion,
    keys: new Map(entries.map(([v, k]) => [v, Buffer.from(k, "base64")])),
  };
}

const TOKEN = "1//0eXaMpLe-refresh-token_value.with~punctuation";

describe("encrypt / decrypt round trip", () => {
  test("a token survives a round trip unchanged", () => {
    const ring = keyring();
    assert.equal(decryptSecret(encryptSecret(TOKEN, ring), ring), TOKEN);
  });

  test("unicode and long tokens survive", () => {
    const ring = keyring();
    const awkward = "ключ-🔐-" + "x".repeat(4000);
    assert.equal(decryptSecret(encryptSecret(awkward, ring), ring), awkward);
  });

  test("the ciphertext does not contain the plaintext", () => {
    const blob = encryptSecret(TOKEN, keyring());
    assert.ok(!blob.includes(TOKEN));
    assert.ok(!blob.includes("refresh-token"));
  });

  test("the same token encrypts differently every time", () => {
    // A fresh nonce per call — otherwise identical tokens would be
    // visibly identical in the database.
    const ring = keyring();
    assert.notEqual(encryptSecret(TOKEN, ring), encryptSecret(TOKEN, ring));
  });

  test("an empty secret is refused rather than stored", () => {
    assert.throws(() => encryptSecret("", keyring()), SecretCryptoError);
  });
});

describe("tampering and wrong keys", () => {
  test("a modified ciphertext fails authentication", () => {
    const ring = keyring();
    const blob = encryptSecret(TOKEN, ring);
    const parts = blob.split(".");
    // Flip the final character of the ciphertext.
    const data = parts[3];
    parts[3] = data.slice(0, -1) + (data.endsWith("A") ? "B" : "A");
    assert.throws(() => decryptSecret(parts.join("."), ring), SecretCryptoError);
  });

  test("a swapped auth tag fails", () => {
    const ring = keyring();
    const a = encryptSecret(TOKEN, ring).split(".");
    const b = encryptSecret("another-token", ring).split(".");
    a[2] = b[2];
    assert.throws(() => decryptSecret(a.join("."), ring), SecretCryptoError);
  });

  test("the wrong key cannot decrypt", () => {
    const written = encryptSecret(TOKEN, keyring(1, [[1, KEY_A]]));
    const attacker = keyring(1, [[1, KEY_B]]);
    assert.throws(() => decryptSecret(written, attacker), SecretCryptoError);
  });

  test("malformed blobs are rejected, not guessed at", () => {
    const ring = keyring();
    for (const bad of ["", "not-a-blob", "v1.only.three", "1.a.b.c"]) {
      assert.throws(() => decryptSecret(bad, ring), SecretCryptoError, bad);
    }
  });

  test("a blob naming an unavailable key version says so", () => {
    const written = encryptSecret(TOKEN, keyring(2, [[2, KEY_B]]));
    // Keyring only holds version 1.
    assert.throws(
      () => decryptSecret(written, keyring(1, [[1, KEY_A]])),
      /No encryption key available for version 2/
    );
  });
});

describe("key rotation", () => {
  test("a blob records the key version that wrote it", () => {
    assert.equal(keyVersionOf(encryptSecret(TOKEN, keyring(1))), 1);
    assert.equal(keyVersionOf(encryptSecret(TOKEN, keyring(2, [[2, KEY_B]]))), 2);
    assert.equal(keyVersionOf("garbage"), null);
  });

  test("a retired key still decrypts rows written with it", () => {
    const old = keyring(1, [[1, KEY_A]]);
    const written = encryptSecret(TOKEN, old);

    // After rotation: version 2 is current, version 1 kept for reads.
    const rotated = keyring(2, [
      [2, KEY_B],
      [1, KEY_A],
    ]);
    assert.equal(decryptSecret(written, rotated), TOKEN);
    // New writes use the new key.
    assert.equal(keyVersionOf(encryptSecret(TOKEN, rotated)), 2);
  });

  test("rows on an old key are identifiable without decrypting", () => {
    const rotated = keyring(2, [
      [2, KEY_B],
      [1, KEY_A],
    ]);
    assert.equal(needsReEncryption(encryptSecret(TOKEN, keyring(1)), rotated), true);
    assert.equal(needsReEncryption(encryptSecret(TOKEN, rotated), rotated), false);
    assert.equal(needsReEncryption("garbage", rotated), true);
  });
});

describe("keyring from environment", () => {
  test("a valid key is loaded as version 1 by default", () => {
    const ring = loadKeyringFromEnv({ INTEGRATION_TOKEN_ENCRYPTION_KEY: KEY_A });
    assert.equal(ring.currentVersion, 1);
    assert.equal(ring.keys.size, 1);
  });

  test("retired keys are loaded for decryption", () => {
    const ring = loadKeyringFromEnv({
      INTEGRATION_TOKEN_ENCRYPTION_KEY: KEY_B,
      INTEGRATION_TOKEN_ENCRYPTION_KEY_VERSION: "2",
      INTEGRATION_TOKEN_ENCRYPTION_KEY_V1: KEY_A,
    });
    assert.equal(ring.currentVersion, 2);
    assert.deepEqual([...ring.keys.keys()].sort(), [1, 2]);
  });

  test("a missing key throws rather than defaulting to something guessable", () => {
    assert.throws(() => loadKeyringFromEnv({}), /is not set/);
    assert.throws(
      () => loadKeyringFromEnv({ INTEGRATION_TOKEN_ENCRYPTION_KEY: "   " }),
      /is not set/
    );
  });

  test("a key of the wrong length is refused with a usable message", () => {
    assert.throws(
      () =>
        loadKeyringFromEnv({
          INTEGRATION_TOKEN_ENCRYPTION_KEY: Buffer.from("too short").toString("base64"),
        }),
      /must decode to exactly 32 bytes/
    );
  });

  test("a non-integer key version is refused", () => {
    assert.throws(
      () =>
        loadKeyringFromEnv({
          INTEGRATION_TOKEN_ENCRYPTION_KEY: KEY_A,
          INTEGRATION_TOKEN_ENCRYPTION_KEY_VERSION: "latest",
        }),
      /positive integer/
    );
  });
});

describe("credential documents", () => {
  // The framework stores one encrypted blob per connection rather than
  // OAuth-shaped columns, because not every integration is OAuth. Each
  // strategy has to survive the trip.
  test("every auth strategy round trips", () => {
    const ring = keyring();
    const documents = [
      {
        strategy: "oauth2",
        accessToken: "ya29.access",
        refreshToken: "1//refresh",
        expiresAtIso: "2026-08-04T12:00:00.000Z",
        scopes: "calendar.events calendar.readonly",
      },
      // Twilio: an API key pair, which access/refresh columns could never hold.
      { strategy: "api_key", values: { accountSid: "AC123", authToken: "secret" } },
      // CalDAV: username and app password.
      { strategy: "basic", username: "owner@example.com", password: "app-pw" },
      // A public ICS feed needs no credential at all.
      { strategy: "none" },
    ];

    for (const document of documents) {
      const restored = decryptCredentials(encryptCredentials(document, ring), ring);
      assert.deepEqual(restored, document, document.strategy);
    }
  });

  test("credentials are not readable in the stored blob", () => {
    const blob = encryptCredentials(
      { strategy: "api_key", values: { accountSid: "AC123", authToken: "hunter2" } },
      keyring()
    );
    assert.ok(!blob.includes("hunter2"));
    assert.ok(!blob.includes("AC123"));
    assert.ok(!blob.includes("api_key"));
  });

  test("a blob naming an unknown strategy is refused, not half-typed", () => {
    const ring = keyring();
    const forged = encryptSecret(JSON.stringify({ strategy: "telepathy" }), ring);
    assert.throws(() => decryptCredentials(forged, ring), /unknown auth strategy/);
  });

  test("a blob that is not JSON is refused", () => {
    const ring = keyring();
    const notJson = encryptSecret("just a bare token", ring);
    assert.throws(() => decryptCredentials(notJson, ring), /not valid JSON/);
  });

  test("a tampered credential blob fails authentication rather than parsing", () => {
    const ring = keyring();
    const blob = encryptCredentials({ strategy: "none" }, ring);
    const parts = blob.split(".");
    parts[3] = parts[3].slice(0, -1) + (parts[3].endsWith("A") ? "B" : "A");
    assert.throws(() => decryptCredentials(parts.join("."), ring), SecretCryptoError);
  });
});

describe("safeEquals", () => {
  test("matches only identical strings", () => {
    assert.equal(safeEquals("state-nonce", "state-nonce"), true);
    assert.equal(safeEquals("state-nonce", "state-noncE"), false);
    assert.equal(safeEquals("short", "much longer value"), false);
    assert.equal(safeEquals("", ""), true);
  });
});
