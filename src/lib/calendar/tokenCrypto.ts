import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// ── Calendar OAuth token encryption at rest ──────────────────────────
// Google refresh tokens are the one genuinely long-lived credential this
// app stores in the database (Stripe keeps only a customer id; Vapi
// secrets live in env). They're encrypted before being written to
// calendar_connections so a database dump alone can't be replayed against
// Google — decryption requires CALENDAR_TOKEN_ENC_KEY, which lives only in
// the server environment.
//
// AES-256-GCM (authenticated encryption). Serialized form is a single
// string: base64(iv).base64(authTag).base64(ciphertext) — self-contained,
// so a column value carries everything decrypt() needs. Any tampering
// fails the GCM auth check and throws rather than returning garbage.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce, the standard for GCM
const KEY_LENGTH = 32; // 256-bit key

function getKey(): Buffer {
  const raw = process.env.CALENDAR_TOKEN_ENC_KEY;
  if (!raw) {
    throw new Error("CALENDAR_TOKEN_ENC_KEY is not configured.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `CALENDAR_TOKEN_ENC_KEY must decode to ${KEY_LENGTH} bytes (got ${key.length}). Generate one with: openssl rand -base64 32`
    );
  }
  return key;
}

export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export function decryptToken(serialized: string): string {
  const key = getKey();
  const parts = serialized.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted token — expected iv.authTag.ciphertext.");
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
