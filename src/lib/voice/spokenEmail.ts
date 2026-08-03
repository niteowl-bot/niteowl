// ── Spoken email handling ──────────────────────────────────────────
// An email address given over the phone arrives as words: "michael
// ryan at hotmail dot com". The assistant is told to convert and
// confirm it (rule 5 step 4), and the transcript extractor is told to
// record a normal address — but both are model instructions, and a
// model that ignores them writes the spoken wording straight into
// leads.email. That is not merely untidy: leads.email is the address
// sendBookingConfirmationEmails writes to, so a spoken form there is a
// confirmation the customer never receives.
//
// This is the deterministic backstop, and the exact counterpart of
// normaliseSpokenNumber in callerId.ts — same place in the pipeline
// (toExtractedLead), same rule: convert what can be converted, and
// keep nothing that cannot be used.

/**
 * Shape of a usable address. Mirrors EMAIL_PATTERN in
 * salesLeadCapture.ts — deliberately duplicated rather than imported,
 * to avoid coupling the voice pipeline to the sales-chat module. If a
 * third consumer ever needs it, promote it to a shared helper then.
 */
const EMAIL_PATTERN = /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i;

/**
 * Spoken punctuation, longest phrase first so "dash" inside
 * "underscore dash" can never win over a longer match.
 *
 * Matched only as whole words: "pat at gmail dot com" must not lose
 * the "at" inside "pat", and "dorothy dot smith" must keep dorothy
 * intact. That word-boundary requirement is the whole reason this is a
 * table of anchored patterns rather than a string replace.
 */
const SPOKEN_TOKENS: Array<[RegExp, string]> = [
  [/\bat sign\b/gi, "@"],
  [/\bunderscore\b/gi, "_"],
  [/\bhyphen\b/gi, "-"],
  [/\bdash\b/gi, "-"],
  [/\bminus\b/gi, "-"],
  [/\bplus\b/gi, "+"],
  [/\bdot\b/gi, "."],
  [/\bpoint\b/gi, "."],
  [/\bat\b/gi, "@"],
];

/**
 * Converts an email address as SPOKEN into a usable one, or null when
 * what was heard cannot be made into a valid address.
 *
 * Returning null is deliberate: a half-heard address saved to the lead
 * looks real and bounces. The wording the caller actually used is
 * never lost — it stays in the call transcript and the owner's summary
 * email — so nothing is destroyed by declining to store it here.
 *
 * An address that already arrives well-formed is passed through
 * unchanged apart from trimming and lowercasing.
 */
export function normaliseSpokenEmail(
  raw: string | null | undefined
): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Already a real address — the common case once the model has done
  // its job. Never run the spoken-token pass over it, or an address
  // whose local part legitimately contains "dot" would be rewritten.
  const direct = trimmed.toLowerCase();
  if (EMAIL_PATTERN.test(direct)) return direct;

  let converted = direct;
  for (const [pattern, replacement] of SPOKEN_TOKENS) {
    converted = converted.replace(pattern, replacement);
  }

  // "michael ryan@hotmail.com" — the caller said their name as two
  // words. Spaces cannot appear in an address, so what remains of them
  // is speech, not structure.
  converted = converted.replace(/\s+/g, "");

  // A caller who says "dot" where the transcript already has "." leaves
  // a double separator behind; collapse those rather than reject an
  // otherwise good address.
  converted = converted.replace(/\.{2,}/g, ".").replace(/@{2,}/g, "@");

  return EMAIL_PATTERN.test(converted) ? converted : null;
}
