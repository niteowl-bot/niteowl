import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

// ── OAuth token encryption ────────────────────────────────────────
//
// Refresh tokens are long-lived credentials to a customer's calendar.
// A leak of the database alone must not be enough to read them, so they
// are encrypted at rest with AES-256-GCM before they ever reach
// Postgres. GCM (not CBC) because it authenticates as well as encrypts:
// a tampered ciphertext fails to decrypt rather than silently yielding
// rubbish that then gets sent to Google as a bearer token.
//
// The key lives in CALENDAR_TOKEN_ENCRYPTION_KEY, which must never be
// prefixed NEXT_PUBLIC_ and is only ever read in server code paths that
// already hold the service-role client.
//
// Every blob records the key version that produced it, so keys can be
// rotated without a migration: set a new current key, keep the old one
// as CALENDAR_TOKEN_ENCRYPTION_KEY_V<n>, and rows re-encrypt lazily as
// they are touched. Rotation is not implemented in this milestone, but
// the format cannot be changed later without re-encrypting everything —
// so the version is written from day one.

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96-bit nonce, the size GCM is specified for
const BLOB_PREFIX = "v";

export interface CalendarKeyring {
  /** The key new ciphertext is written with. */
  currentVersion: number;
  /** Every key available for decryption, including the current one. */
  keys: Map<number, Buffer>;
}

export class CalendarCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarCryptoError";
  }
}

function decodeKey(raw: string, label: string): Buffer {
  let key: Buffer;
  try {
    key = Buffer.from(raw.trim(), "base64");
  } catch {
    throw new CalendarCryptoError(`${label} is not valid base64.`);
  }
  if (key.length !== KEY_BYTES) {
    throw new CalendarCryptoError(
      `${label} must decode to exactly ${KEY_BYTES} bytes (got ${key.length}). ` +
        `Generate one with: openssl rand -base64 32`
    );
  }
  return key;
}

/**
 * Builds the keyring from environment variables.
 *
 * CALENDAR_TOKEN_ENCRYPTION_KEY          — current key, base64, 32 bytes
 * CALENDAR_TOKEN_ENCRYPTION_KEY_VERSION  — integer, defaults to 1
 * CALENDAR_TOKEN_ENCRYPTION_KEY_V<n>     — optional retired keys, decrypt only
 *
 * Throws rather than falling back to a default key: silently encrypting
 * customer credentials with a guessable key is worse than not starting.
 */
export function loadKeyringFromEnv(
  env: Record<string, string | undefined> = process.env
): CalendarKeyring {
  const raw = env.CALENDAR_TOKEN_ENCRYPTION_KEY;
  if (!raw || !raw.trim()) {
    throw new CalendarCryptoError(
      "CALENDAR_TOKEN_ENCRYPTION_KEY is not set — calendar tokens cannot be stored."
    );
  }

  const versionRaw = env.CALENDAR_TOKEN_ENCRYPTION_KEY_VERSION?.trim();
  const currentVersion = versionRaw ? Number(versionRaw) : 1;
  if (!Number.isInteger(currentVersion) || currentVersion < 1) {
    throw new CalendarCryptoError(
      "CALENDAR_TOKEN_ENCRYPTION_KEY_VERSION must be a positive integer."
    );
  }

  const keys = new Map<number, Buffer>();
  keys.set(currentVersion, decodeKey(raw, "CALENDAR_TOKEN_ENCRYPTION_KEY"));

  for (const [name, value] of Object.entries(env)) {
    const match = /^CALENDAR_TOKEN_ENCRYPTION_KEY_V(\d+)$/.exec(name);
    if (!match || !value || !value.trim()) continue;
    const version = Number(match[1]);
    // The current key wins if both forms are set for the same version.
    if (keys.has(version)) continue;
    keys.set(version, decodeKey(value, name));
  }

  return { currentVersion, keys };
}

function keyFor(keyring: CalendarKeyring, version: number): Buffer {
  const key = keyring.keys.get(version);
  if (!key) {
    throw new CalendarCryptoError(
      `No encryption key available for version ${version}. ` +
        `Set CALENDAR_TOKEN_ENCRYPTION_KEY_V${version} to decrypt existing rows.`
    );
  }
  return key;
}

/**
 * Encrypts a secret, returning a self-describing blob:
 *   v<version>.<iv>.<authTag>.<ciphertext>   (each part base64url)
 *
 * The version travels with the data rather than being inferred from the
 * column, so a row is decryptable even if the DB copy of the version
 * disagrees.
 */
export function encryptSecret(
  plaintext: string,
  keyring: CalendarKeyring
): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new CalendarCryptoError("Refusing to encrypt an empty secret.");
  }

  const key = keyFor(keyring, keyring.currentVersion);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    `${BLOB_PREFIX}${keyring.currentVersion}`,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Reverses encryptSecret. Throws if the blob is malformed, if the key
 * for its version is missing, or if it has been tampered with — never
 * returns a partially-trusted value.
 */
export function decryptSecret(blob: string, keyring: CalendarKeyring): string {
  if (typeof blob !== "string" || !blob) {
    throw new CalendarCryptoError("Encrypted value is empty.");
  }

  const parts = blob.split(".");
  if (parts.length !== 4) {
    throw new CalendarCryptoError("Encrypted value is malformed.");
  }

  const [versionPart, ivPart, tagPart, dataPart] = parts;
  if (!versionPart.startsWith(BLOB_PREFIX)) {
    throw new CalendarCryptoError("Encrypted value has no key version.");
  }

  const version = Number(versionPart.slice(BLOB_PREFIX.length));
  if (!Number.isInteger(version) || version < 1) {
    throw new CalendarCryptoError("Encrypted value has an invalid key version.");
  }

  const key = keyFor(keyring, version);
  const iv = Buffer.from(ivPart, "base64url");
  const authTag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(dataPart, "base64url");

  if (iv.length !== IV_BYTES) {
    throw new CalendarCryptoError("Encrypted value has an invalid nonce.");
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key, edited ciphertext, or a swapped auth tag all land here.
    // The reason is deliberately not distinguished to the caller.
    throw new CalendarCryptoError(
      "Encrypted value failed authentication — wrong key or tampered data."
    );
  }
}

/** The key version a blob was written with, without decrypting it. */
export function keyVersionOf(blob: string): number | null {
  const versionPart = blob.split(".")[0];
  if (!versionPart?.startsWith(BLOB_PREFIX)) return null;
  const version = Number(versionPart.slice(BLOB_PREFIX.length));
  return Number.isInteger(version) && version >= 1 ? version : null;
}

/** True when a blob was not written with the keyring's current key. */
export function needsReEncryption(
  blob: string,
  keyring: CalendarKeyring
): boolean {
  const version = keyVersionOf(blob);
  return version === null || version !== keyring.currentVersion;
}

/**
 * Constant-time comparison for OAuth state nonces and cron secrets.
 * Lives here so no route hand-rolls a `===` on a security token.
 */
export function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a ?? "", "utf8");
  const bufB = Buffer.from(b ?? "", "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
