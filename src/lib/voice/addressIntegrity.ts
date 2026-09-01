// ── Service-address integrity ──────────────────────────────────────
// One narrow job: stop speech-to-text noise becoming the canonical
// service address.
//
// From the 2026-09-01 production call. The caller's house number was
// 81. The transcriber rendered it "K e 1" and then, on the caller's own
// correction, "A c 1" — mangling the DIGITS both times while the street
// name resolved. Remy read "A c 1 Oakland Drive" back and accepted it:
// an address no human would write, waved through because nothing in the
// prompt says a house number is a number. The caller had to volunteer
// "81 Oakland Drive" later, unprompted.
//
// The recap (restored by PR #40) gives a caller that second chance, but
// it is mitigation: it depends on the caller noticing. This is the
// deterministic backstop, and it is the fourth of its kind —
// normaliseSpokenEmail, sanitisePreferredDatetime and resolveCallerName
// exist for the same reason spokenEmail.ts already states: the prompts
// say the right thing, and a model that ignores them writes straight
// into the lead. `service_address` was the last caller-supplied voice
// field with no such backstop.
//
// CONSTRAIN-ONLY, and deliberately so. It may REFUSE a candidate or
// PREFER something the caller actually said. It never rewrites an
// address, never repairs one, never turns one street into another, and
// never invents one. There is no geocoding, no address service, no
// street list — an address this cannot vouch for is dropped, not
// guessed at, because the owner still has the caller's number and a
// wrong address is worse than none.
//
// NOT an address parser. It answers one question — "does the leading
// house/building identifier look like transcription noise?" — and uses
// the answer only to refuse a value or to prefer the caller's own
// later wording.

/** A turn in the transcript, as stored: "AI: …" / "User: …". */
interface Turn {
  speaker: "ai" | "user" | "other";
  text: string;
}

/**
 * Splits the stored transcript into speaker turns. Same shape the
 * transcript is written in by the provider adapter; anything that does
 * not start with a known speaker label continues the previous turn.
 */
function toTurns(transcript: string): Turn[] {
  const turns: Turn[] = [];
  for (const rawLine of transcript.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^(AI|Assistant|Bot|User|Customer|Caller)\s*:\s*(.*)$/i.exec(line);
    if (match) {
      const label = match[1].toLowerCase();
      turns.push({
        speaker: label === "ai" || label === "assistant" || label === "bot" ? "ai" : "user",
        text: match[2].trim(),
      });
    } else if (turns.length > 0) {
      turns[turns.length - 1].text += ` ${line}`;
    }
  }
  return turns;
}

/**
 * How a receptionist asks for the service address. Deliberately a
 * short, explicit list — this decides whether the NEXT turn is read as
 * an answer, and a loose pattern would start reading arbitrary replies
 * as addresses.
 */
const ADDRESS_REQUEST =
  /\baddress\b|\bwhere the work is needed\b|\bwhere.{0,20}\b(?:job|work|leak|repair|visit)\b.{0,20}\b(?:is|needed)\b/i;

/**
 * The caller volunteering it themselves — "My address is 81 Oakland
 * Drive". This is how the 2026-09-01 correction actually arrived, at
 * the very end of the call rather than as an answer to a question.
 */
const SELF_DECLARED =
  /\b(?:my|the)\s+address\s+(?:is|would be)\s+(.+)$/i;

/** Openers people put in front of an address, stripped before reading. */
const ANSWER_PREFIX =
  /^(?:it(?:'|’)?s|its|that(?:'|’)?s|yes,?|yeah,?|no,?|sure,?|erm,?|um,?|uh,?|ok(?:ay)?,?|so,?)\s+/i;

/** Replies that are plainly not an address, however punctuated. */
const NOT_AN_ADDRESS =
  /^(?:yes|yeah|no|nope|correct|that(?:'|’)?s right|sure|ok(?:ay)?|thanks?|thank you|hello|hi|sorry|pardon|what|nothing|none|n\/a)\b/i;

/**
 * A house/building identifier this module is willing to vouch for.
 *
 * Deliberately permissive — it exists to recognise ORDINARY forms, not
 * to define what an address may be:
 *   19, 81, 12A, 3-5, 221B
 * A token of two or more characters is always accepted, so "Flat",
 * "Apartment", "Unit", "Rose" and every named property pass untouched.
 */
function isPlausibleIdentifierToken(token: string): boolean {
  const t = token.replace(/[.,;:]+$/, "");
  if (!t) return false;
  return t.length >= 2 || /^\d$/.test(t);
}

/**
 * The one thing this module treats as transcription noise.
 *
 * The observed artefacts — "K e 1 Auckland Drive", "A c 1 Oakland
 * Drive" — share a shape no written address has: the address OPENS
 * with two or more isolated single LETTERS. That is what a
 * speech-to-text engine produces when it spells at a number it could
 * not hear, and it is the only pattern flagged here.
 *
 * Only the first three tokens are examined, so a single letter later in
 * an address ("Flat 2, A Block") is untouched. The test is narrow by
 * design: a false positive silently drops a real address, so it must
 * fire only on shapes that cannot be legitimate.
 *
 * Explicitly NOT flagged, and pinned by tests:
 *   "19 Auckland Avenue"   leading token is a number
 *   "81 Oakland Drive"     leading token is a number
 *   "12A Oak Road"         alphanumeric identifier
 *   "Flat 2, 14 Mill Road" leading token is a word
 *   "Rose Cottage"         named property, no number at all
 *   "B Block, Mill Road"   ONE single letter is not enough
 */
export function looksLikeTranscriptionNoise(
  address: string | null | undefined
): boolean {
  const text = address?.trim();
  if (!text) return false;

  const head = text.split(/\s+/).slice(0, 3);
  const singleLetters = head.filter((token) =>
    /^[A-Za-z][.,]?$/.test(token)
  ).length;

  // Two isolated single letters at the head of an address is the
  // artefact. One is not: it can be a block or stair letter.
  if (singleLetters >= 2) return true;

  // A leading identifier that is a lone letter followed immediately by
  // a bare digit — "A 1 Oakland Drive" — is the same failure with one
  // letter recovered. Requires the digit to be its own token, so "A1"
  // and "12A" are untouched.
  if (
    head.length >= 2 &&
    /^[A-Za-z][.,]?$/.test(head[0]) &&
    /^\d[.,]?$/.test(head[1])
  ) {
    return true;
  }

  return !head.some(isPlausibleIdentifierToken);
}

/**
 * Reads one turn as the caller's stated address, or null when it is not
 * clearly one. Evidence, not a guess.
 */
function readAddressAnswer(answer: string): string | null {
  const self = SELF_DECLARED.exec(answer);
  const raw = (self ? self[1] : answer).trim();
  if (!raw) return null;

  // First sentence only: "81 Oakland Drive. That's it." carries the
  // address before the full stop.
  const firstClause = raw.split(/(?<=\w)[.!?](?:\s|$)/)[0]?.trim() ?? raw;
  // Tested BEFORE the prefix is stripped as well as after: "That's
  // right." would otherwise strip to "right" and read as an address.
  if (NOT_AN_ADDRESS.test(firstClause)) return null;
  const cleaned = firstClause.replace(ANSWER_PREFIX, "").replace(/[.,;]+$/, "").trim();
  if (!cleaned || NOT_AN_ADDRESS.test(cleaned)) return null;
  // Long enough to be an address, short enough not to be a speech.
  if (cleaned.length < 4 || cleaned.length > 120) return null;
  if (!/[A-Za-z]/.test(cleaned)) return null;
  // A single bare word is an acknowledgement, not an address, unless it
  // carries a number. Structural rather than a stop-word list, which
  // would never stop growing: "Rose Cottage" and "14 Mill Road" both
  // pass, "right" and "grand" do not.
  if (!/\d/.test(cleaned) && cleaned.split(/\s+/).length < 2) return null;
  // Only vouch for something this module would accept from the model.
  if (looksLikeTranscriptionNoise(cleaned)) return null;
  return cleaned;
}

/**
 * The LAST well-formed address the caller actually gave — either as an
 * answer to an address question, or volunteered ("my address is …").
 *
 * Last, not first, because a later correction supersedes an earlier
 * candidate. On the 2026-09-01 call the good value arrived last, after
 * two mangled attempts, as an unprompted correction during the close.
 */
export function findSpokenAddress(
  transcript: string | null | undefined
): string | null {
  const text = transcript?.trim();
  if (!text) return null;

  const turns = toTurns(text);
  let latest: string | null = null;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (turn.speaker !== "user") continue;

    // Volunteered at any point in the call.
    if (SELF_DECLARED.test(turn.text)) {
      const declared = readAddressAnswer(turn.text);
      if (declared) latest = declared;
      continue;
    }

    // Otherwise only an answer to an address question counts.
    const previous = turns[i - 1];
    if (!previous || previous.speaker !== "ai") continue;
    if (!ADDRESS_REQUEST.test(previous.text)) continue;

    const answer = readAddressAnswer(turn.text);
    if (answer) latest = answer;
  }

  return latest;
}

/**
 * The service address to record, given what the model produced and what
 * the caller actually said.
 *
 * **Transcription noise must never become the canonical address, and a
 * value this cannot vouch for is dropped rather than guessed at.** The
 * order:
 *
 * 1. The candidate is ordinary — keep it, byte for byte. This is the
 *    overwhelming majority, including "12A", "Flat 2, 14 Mill Road" and
 *    every named property. The model is told corrections win, so a
 *    well-formed candidate is trusted and a stale earlier value is
 *    never resurrected.
 * 2. The candidate looks like transcription noise AND the caller was
 *    heard giving a well-formed address — take the caller's own words.
 *    This is the observed defect, and the ONLY case where the
 *    transcript overrides the model.
 * 3. The candidate looks like transcription noise and there is no such
 *    evidence — record nothing. The owner sees the caller's phone
 *    number, which is true, rather than an address that cannot exist.
 * 4. No candidate at all — fall back to what the caller was heard to
 *    say, if anything.
 *
 * Deterministic and self-contained: no model call, no network, no
 * imports.
 */
export function resolveServiceAddress(
  candidate: string | null | undefined,
  transcript: string | null | undefined
): string | null {
  const address = candidate?.trim() || null;

  if (address && !looksLikeTranscriptionNoise(address)) return address;

  const spoken = findSpokenAddress(transcript);
  if (spoken) return spoken;

  // Either a noisy candidate with nothing better, or no candidate at
  // all. Both record nothing rather than something untrue.
  return address && looksLikeTranscriptionNoise(address) ? null : address;
}
