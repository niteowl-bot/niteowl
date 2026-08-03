// ── Caller ID handling ─────────────────────────────────────────────
// A phone call carries one contact detail the caller cannot fake: the
// number the network says they are ringing from. Anything spoken
// during the call is transcribed speech — mishearable, and sometimes
// simply a different number ("call me back on the office line").
//
// The rule this module exists to enforce: network caller ID is the
// canonical phone contact for a voice lead; a spoken number is an
// ALTERNATE, never a replacement. See toExtractedLead in calls.ts.
//
// The only exception is a withheld number. Carriers do not send an
// empty field for these — they send a placeholder, and the shapes vary
// by carrier and by country. A placeholder must be treated as "no
// caller ID" or it ends up saved as the lead's phone number.

/**
 * Placeholder values carriers/providers send instead of a real number
 * when caller ID is withheld, blocked, or unavailable. Compared
 * case-insensitively against the digits/letters of the raw value.
 *
 * The numeric ones are the keypad spellings some US/EU carriers send
 * in the SIP From header: 266696687 = "ANONYMOUS", 2568378 = "BLOCKED",
 * 7378742833 = "RESTRICTED".
 */
const BLOCKED_CALLER_IDS = new Set([
  "anonymous",
  "unknown",
  "unavailable",
  "restricted",
  "private",
  "blocked",
  "withheld",
  "unidentified",
  "notavailable",
  "266696687",
  "2568378",
  "7378742833",
]);

/** Shortest thing that can plausibly be a real dialable number. */
const MIN_CALLER_ID_DIGITS = 7;

/**
 * Normalises a provider-supplied caller ID to a usable phone number,
 * or null when the number is withheld/blocked/absent.
 *
 * Returning null is what makes the assistant ask for a number (see
 * buildVoiceAssistantConfig) and what stops "anonymous" being written
 * into leads.phone. The raw provider payload is always kept intact in
 * voice_events, so normalising here loses nothing.
 */
export function normaliseCallerId(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const compact = trimmed.toLowerCase().replace(/[\s()\-.+]/g, "");
  if (BLOCKED_CALLER_IDS.has(compact)) return null;

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < MIN_CALLER_ID_DIGITS) return null;
  if (BLOCKED_CALLER_IDS.has(digits)) return null;

  return trimmed;
}

/**
 * Longest a real number can be: E.164 caps a subscriber number at 15
 * digits including the country code. Anything longer is two numbers
 * run together, a number with a spoken extension, or transcription
 * noise — not something to ring back.
 */
const MAX_SPOKEN_NUMBER_DIGITS = 15;

/**
 * Normalises a number the caller SPOKE during the call, or null when
 * what was heard cannot plausibly be a phone number.
 *
 * Speech arrives with the punctuation of speech: "oh eight six... one
 * two three, four five six seven" reaches us as "086 123 4567",
 * "086-123-4567" or "(086) 123 4567". Stripping that formatting is
 * safe. Judging the RESULT is what this adds: a transcript that
 * yielded four digits, a word, or two numbers run together used to be
 * written to the lead verbatim, giving the owner a number that cannot
 * be dialled — and, because the lead engine merges on phone, a junk
 * value shared by two callers could merge unrelated leads.
 *
 * Deliberately lenient: the only judgements made are "too few digits
 * to dial" and "more digits than any number has". Country codes, trunk
 * prefixes and international formats are none of this function's
 * business — rejecting a legitimate foreign number would lose a lead,
 * which is the exact failure this is meant to prevent.
 *
 * NEVER used for network caller ID — that keeps normaliseCallerId
 * above and its own rules. This is only for spoken numbers, which are
 * stored as the ALTERNATE contact.
 */
export function normaliseSpokenNumber(
  raw: string | null | undefined
): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // A leading "+" is the one piece of formatting worth preserving: it
  // marks the number as already international, so the owner knows not
  // to add a country code before dialling.
  const isInternational = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length < MIN_CALLER_ID_DIGITS) return null;
  if (digits.length > MAX_SPOKEN_NUMBER_DIGITS) return null;
  if (BLOCKED_CALLER_IDS.has(digits)) return null;

  return isInternational ? `+${digits}` : digits;
}

/**
 * True when two numbers refer to the same line despite different
 * formatting. A caller reading their own number aloud gives the
 * national form ("086 123 4567") while caller ID arrives in E.164
 * ("+353861234567"), so a plain string compare would file the caller's
 * own number as an "alternate". Comparing the last 9 significant
 * digits ignores country code and trunk prefix without needing a full
 * E.164 parser.
 */
export function isSameNumber(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const digitsA = (a ?? "").replace(/\D/g, "");
  const digitsB = (b ?? "").replace(/\D/g, "");
  if (digitsA.length < MIN_CALLER_ID_DIGITS || digitsB.length < MIN_CALLER_ID_DIGITS) {
    return false;
  }
  const tailLength = Math.min(9, digitsA.length, digitsB.length);
  return digitsA.slice(-tailLength) === digitsB.slice(-tailLength);
}
