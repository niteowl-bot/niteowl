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
 * Conversational lead-ins a caller says before the address itself.
 * Anchored to the start and matched only as whole phrases — this is a
 * closed list of recognised wordings, never a general "drop unknown
 * words" pass, because deleting a word that turned out to be part of
 * the address would produce a plausible but wrong address, which is
 * worse than returning nothing.
 *
 * The lead-ins that END in "at" or "on" must consume that word too:
 * "you can email me AT michael dot ryan AT hotmail dot com" has two,
 * and only the second is the @. Leaving the first behind would strip
 * to "@michael.ryan@hotmail.com" and be rejected.
 */
const SPOKEN_EMAIL_PREFIXES: RegExp[] = [
  /^(?:you\s+can|please|feel\s+free\s+to)?\s*(?:e[-\s]?mail|contact|reach)\s+me\s+(?:at|on)\s+/i,
  /^(?:my|the|our|his|her|their)\s+(?:e[-\s]?mail)(?:\s+address)?\s+(?:is|would\s+be)\s+/i,
  /^(?:e[-\s]?mail)(?:\s+address)?\s+is\s+/i,
  /^(?:the\s+)?address\s+is\s+/i,
  /^(?:my|the)\s+(?:e[-\s]?mail)(?:\s+address)?\s+/i,
  /^(?:it'?s|that'?s|this\s+is)\s+/i,
];

/** Removes recognised lead-ins, longest chain first. Bounded. */
function stripSpokenPrefix(value: string): string {
  let result = value;
  for (let pass = 0; pass < 3; pass += 1) {
    const before = result;
    for (const pattern of SPOKEN_EMAIL_PREFIXES) {
      result = result.replace(pattern, "");
    }
    if (result === before) break;
  }
  return result.trim();
}

/**
 * Most words a spoken local part can plausibly be. "michael ryan" is
 * two; "mary jane smith jones" is four. Beyond that it is a sentence.
 */
const MAX_LOCAL_PART_WORDS = 4;

/**
 * True when what sits before the @ still looks like a name rather than
 * a run of speech. Counts only tokens carrying a letter or digit, so
 * the separators already substituted in (".", "_", "-") do not count.
 */
function hasPlausibleLocalPart(value: string): boolean {
  const atIndex = value.indexOf("@");
  if (atIndex === -1) return true; // no @ yet — validation will reject it

  const words = value
    .slice(0, atIndex)
    .split(/\s+/)
    .filter((token) => /[a-z0-9]/i.test(token));

  return words.length <= MAX_LOCAL_PART_WORDS;
}

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

  // The extraction prompts ask for the address alone, but a model that
  // hands over the whole sentence would otherwise fold the filler into
  // the local part — "my email is michael dot ryan at hotmail dot com"
  // becoming myemailismichael.ryan@hotmail.com, wrong but well-formed
  // enough to be saved and emailed.
  const withoutPrefix = stripSpokenPrefix(direct);
  if (EMAIL_PATTERN.test(withoutPrefix)) return withoutPrefix;

  let converted = withoutPrefix;
  for (const [pattern, replacement] of SPOKEN_TOKENS) {
    converted = converted.replace(pattern, replacement);
  }

  // The lead-in list above is closed, so filler phrased some other way
  // survives to here — and closing up its spaces would bury it in the
  // local part ("erm hang on it is probably michael dot ryan at ..."
  // becoming ermhangonitisprobablymichael.ryan@hotmail.com, wrong but
  // well-formed). A spoken local part is a name: one or two words, four
  // at the outside. More than that is a sentence, and a sentence is not
  // something to guess an address out of.
  if (!hasPlausibleLocalPart(converted)) return null;

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
