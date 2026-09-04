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
// NOT an address parser. It answers two narrow questions — "does the
// leading house/building identifier look like transcription noise?"
// and "do these two strings name the same place or two different
// ones?" — and uses the answers only to refuse a value or to prefer
// the caller's own wording.
//
// The second question was added after the partial-structuredData
// investigation. Until then a well-formed provider candidate was
// returned without the transcript ever being read, so a plausible but
// WRONG extracted address outranked the caller's explicit words and
// reached the lead, the owner's email and the calendar event location
// unchallenged. That is information corruption driving a real-world
// action, and it is worse than the noise this module was built for: an
// impossible address is at least visibly wrong.

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
 * Every well-formed address the caller gave, in the order they gave
 * them — each either an answer to an address question or volunteered
 * ("my address is …").
 *
 * The ORDER is the evidence. The last entry is the caller's final word,
 * and an earlier entry is something they superseded out loud, which is
 * the only deterministic way to tell a caller's own correction apart
 * from an ordinary source disagreement.
 */
function findSpokenAddresses(transcript: string | null | undefined): string[] {
  const text = transcript?.trim();
  if (!text) return [];

  const turns = toTurns(text);
  const spoken: string[] = [];

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (turn.speaker !== "user") continue;

    // Volunteered at any point in the call.
    if (SELF_DECLARED.test(turn.text)) {
      const declared = readAddressAnswer(turn.text);
      if (declared) spoken.push(declared);
      continue;
    }

    // Otherwise only an answer to an address question counts.
    const previous = turns[i - 1];
    if (!previous || previous.speaker !== "ai") continue;
    if (!ADDRESS_REQUEST.test(previous.text)) continue;

    const answer = readAddressAnswer(turn.text);
    if (answer) spoken.push(answer);
  }

  return spoken;
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
  const spoken = findSpokenAddresses(transcript);
  return spoken.length > 0 ? spoken[spoken.length - 1] : null;
}

/**
 * The alphabetic tokens of an address — the part that names WHERE, with
 * the house/building identifier and all punctuation removed.
 *
 * "81 Oakland Drive" and "18 Oakland Drive" both reduce to
 * {oakland, drive}; "12 Meadow Court" reduces to {meadow, court}.
 */
function placeTokens(address: string): Set<string> {
  return new Set(
    address
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((token) => /^[a-z]{2,}$/.test(token))
  );
}

/**
 * Whether two addresses are two renderings of the SAME place, rather
 * than two different places.
 *
 * Containment, not overlap, and deliberately: every place word of one
 * must appear in the other. The fuller form therefore agrees with the
 * shorter one — "81 Oakland Drive" with "81 Oakland Drive, Galway",
 * "14 Mill Road" with "Flat 2, 14 Mill Road" — while "Oakland Drive"
 * and "Meadow Drive" disagree despite sharing a street type.
 *
 * A HOUSE-NUMBER disagreement on the same street is deliberately NOT a
 * different place. That is exactly where the transcript is known to be
 * least trustworthy: on the 2026-09-01 call the transcriber mangled the
 * house number twice while the street name resolved correctly both
 * times. Letting the transcript's digits outrank the model's would
 * re-open that failure from the other side.
 *
 * When either address yields no place word at all, this answers "same"
 * — the conservative direction, because it leaves the candidate
 * standing rather than replacing it on evidence it cannot read.
 *
 * NOT an address parser. No street vocabulary, no abbreviation table,
 * no geocoding, no similarity scoring, no threshold. It compares two
 * token sets and nothing else.
 */
export function addressesDescribeSamePlace(a: string, b: string): boolean {
  const left = placeTokens(a);
  const right = placeTokens(b);
  if (left.size === 0 || right.size === 0) return true;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const token of small) {
    if (!large.has(token)) return false;
  }
  return true;
}

/**
 * The leading house/building NUMBER, when the address opens with one
 * this module can compare — "81 Oakland Drive" → "81", "12a Oak Road"
 * → "12a".
 *
 * Null whenever there is nothing comparable, and that is the important
 * half. "Oakland Drive" has no number. "Flat 2, 14 Mill Road" opens
 * with a word, so its number is not in the position this reads.
 * "eighty one Oakland Drive" spells the number out, and turning that
 * into 81 would need a number-word table — inference this module does
 * not do. Each of those yields null and leaves the surrounding
 * behaviour exactly as it was: conservative, not clever.
 */
function houseNumber(address: string): string | null {
  const first = address.trim().split(/\s+/)[0]?.replace(/[.,;:]+$/, "") ?? "";
  return /\d/.test(first) ? first.toLowerCase() : null;
}

/**
 * Two comparable house numbers that disagree, on what is otherwise the
 * same street.
 *
 * "81 Oakland Drive" and "12 Oakland Drive" are not two renderings of
 * one address. They are two front doors, and a van sent to the wrong
 * one is the real-world harm this whole module exists to prevent.
 *
 * Only fires when BOTH sides carry a number in the readable position.
 * A missing or unspelt number is not a conflict — it is an absence,
 * handled elsewhere.
 */
function houseNumbersConflict(spoken: string, candidate: string): boolean {
  const a = houseNumber(spoken);
  const b = houseNumber(candidate);
  return a !== null && b !== null && a !== b;
}

/**
 * The provider is holding a number the caller SUPERSEDED out loud.
 *
 * "12 Oakland Drive… sorry, 81 Oakland Drive" leaves both values in the
 * caller's own turns, in order. If the candidate matches an earlier one
 * and the caller's final word says something else about the same place,
 * the disagreement is not two sources guessing differently — it is the
 * model having missed a correction the caller made explicitly, and the
 * caller's last word is authoritative.
 *
 * Evidence, not inference: it reads only addresses the caller actually
 * spoke, and only their order.
 */
function callerSupersededCandidate(
  candidate: string,
  spokenAddresses: string[]
): boolean {
  const candidateNumber = houseNumber(candidate);
  if (candidateNumber === null || spokenAddresses.length < 2) return false;

  const earlier = spokenAddresses.slice(0, -1);
  return earlier.some(
    (address) =>
      addressesDescribeSamePlace(address, candidate) &&
      houseNumber(address) === candidateNumber
  );
}

/**
 * The caller gave a house number the candidate simply does not carry,
 * and the candidate is otherwise contained in what they said —
 * "Oakland Drive" against a spoken "81 Oakland Drive".
 *
 * Containment as a substring is required, so taking the caller's
 * wording can only ADD the number and can never drop anything the
 * candidate held: a candidate of "Oakland Drive, Galway" is not
 * contained in "81 Oakland Drive" and is therefore left alone.
 */
function callerSuppliesMissingNumber(spoken: string, candidate: string): boolean {
  if (houseNumber(candidate) !== null || houseNumber(spoken) === null) return false;
  const normalise = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return normalise(spoken).includes(normalise(candidate));
}

/**
 * The service address to record, given what the model produced and what
 * the caller actually said.
 *
 * **Transcription noise must never become the canonical address, and a
 * value this cannot vouch for is dropped rather than guessed at.** The
 * order:
 *
 * 1. The candidate is ordinary and the caller was not heard naming a
 *    DIFFERENT place — keep it, byte for byte. This is the
 *    overwhelming majority, including "12A", "Flat 2, 14 Mill Road" and
 *    every named property, and it covers a candidate that is merely the
 *    fuller form of what the caller said. A later correction still
 *    wins, because findSpokenAddress reads the LAST address the caller
 *    gave and never an earlier one, so a stale value is not resurrected.
 * 2. The candidate is ordinary, but the caller was explicitly heard
 *    giving a well-formed address naming a DIFFERENT place — take the
 *    caller's own words. A syntactically tidy extraction is not
 *    authority over what the caller actually said, and a plausible
 *    wrong address is worse than a rough right one: it books an
 *    engineer to somewhere real that nobody asked for, and reads as
 *    correct on every surface that shows it.
 * 3. Same street, two different HOUSE NUMBERS, both comparable — a
 *    genuine conflict, because those are two front doors and not two
 *    renderings of one. If the caller superseded the candidate's number
 *    out loud, their final word wins. Otherwise record NOTHING: one of
 *    the two sources is wrong about which house and no deterministic
 *    evidence here says which, so the engineer is sent nowhere rather
 *    than confidently to a stranger's door.
 * 4. Same street and the caller gave a number the candidate lacks —
 *    take the caller's wording, which only ADDS the number.
 * 5. The candidate looks like transcription noise AND the caller was
 *    heard giving a well-formed address — take the caller's own words.
 *    This is the originally observed defect.
 * 6. The candidate looks like transcription noise and there is no such
 *    evidence — record nothing. The owner sees the caller's phone
 *    number, which is true, rather than an address that cannot exist.
 * 7. No candidate at all — fall back to what the caller was heard to
 *    say, if anything.
 *
 * This is NOT "the transcript always wins", and it is not "the provider
 * always wins" either. The transcript replaces a well-formed candidate
 * only on evidence clearing every structural bar in this module — an
 * answer to an explicit address question or a self-declaration, well
 * formed, and not itself noise — and then only when it names a
 * different place, corrects a number the caller themselves superseded,
 * or supplies a number the candidate lacks. Silence, an ambiguous
 * reply, a fragment, a spelt-out number, or a candidate that is simply
 * the fuller form all leave the candidate exactly as the model wrote
 * it. An unresolved numeric conflict picks NEITHER.
 *
 * Deterministic and self-contained: no model call, no network, no
 * imports. There is no second extraction and no merging of two
 * readings — one value is chosen, whole, from one of two sources.
 */
export function resolveServiceAddress(
  candidate: string | null | undefined,
  transcript: string | null | undefined
): string | null {
  const address = candidate?.trim() || null;
  const spokenAddresses = findSpokenAddresses(transcript);
  const spoken =
    spokenAddresses.length > 0 ? spokenAddresses[spokenAddresses.length - 1] : null;

  if (address && !looksLikeTranscriptionNoise(address)) {
    // A well-formed candidate is not, by itself, authority. Explicit
    // caller speech naming a different place outranks it — otherwise a
    // plausible but wrong extraction reaches the lead, the owner's
    // email and the engineer's diary with nothing able to contradict
    // it. Absent, ambiguous or same-place evidence changes nothing.
    if (spoken && !addressesDescribeSamePlace(spoken, address)) return spoken;

    if (spoken && houseNumbersConflict(spoken, address)) {
      // Same street, two different front doors. One of these two
      // sources is wrong about which house, and nothing here can say
      // which — unless the caller settled it themselves.
      if (callerSupersededCandidate(address, spokenAddresses)) return spoken;
      return null;
    }

    // The caller gave a number the candidate lacks, and taking their
    // wording drops nothing the candidate held.
    if (spoken && callerSuppliesMissingNumber(spoken, address)) return spoken;

    return address;
  }

  if (spoken) return spoken;

  // Either a noisy candidate with nothing better, or no candidate at
  // all. Both record nothing rather than something untrue.
  return address && looksLikeTranscriptionNoise(address) ? null : address;
}
