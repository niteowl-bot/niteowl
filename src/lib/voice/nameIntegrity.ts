// ── Caller-name integrity ──────────────────────────────────────────
// One narrow job: stop an email address manufacturing a caller name.
//
// From the 2026-08-31 production call. The caller gave the name
// "Ernesto" and the call summary recorded it correctly, but the
// STRUCTURED Caller field in the owner email read "Ernie Sephora" — a
// person who does not exist, whose name is the local part of the email
// address spoken later in the same call.
//
// No code derives a name from an email. The model does. Read-only
// reproduction against the real extractor established the mechanism:
// when a caller name is absent or unclear in the transcript, extraction
// fabricates a plausible one from the adjacent email local part —
// "jameshartley@gmail.com" came back as name "James Hartley" on 3 of 3
// runs, and the thinner provider-side schema wording did the same even
// when a name HAD been asked for and the answer was garbled.
//
// Which extractor produced the bad name on the live call was NOT
// established: the provider's structured data and this codebase's
// transcript fallback are both possible and the logs no longer reach
// back. This guard therefore sits downstream of both, in
// toExtractedLead, where the two paths converge — the same place
// normaliseSpokenEmail and sanitisePreferredDatetime already sit.
//
// It is the third deterministic backstop under a model instruction, and
// the reason is the one spokenEmail.ts already gives: the prompts say
// the right thing, and a model that ignores them writes straight into
// the lead. `name` was the only caller-supplied field with no such
// backstop.
//
// NOT a name parser and not an NLP layer. It answers one question —
// "is there caller-spoken support for this name?" — and uses the answer
// only to break a tie the model got wrong.

/** A literal address, so it can be removed before reading a turn. */
const LITERAL_EMAIL = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi;

/**
 * A spoken address: "james hartley at gmail dot com". Removed as a span
 * so the words inside it can never be read as a spoken name, while the
 * rest of the turn survives — "I'm John, john@gmail.com" must still
 * yield "John".
 */
const SPOKEN_EMAIL =
  /\b[\w' -]{1,40}\s+(?:at|@)\s+[\w' -]{1,20}\s+dot\s+[a-z]{2,}\b/gi;

/**
 * How a receptionist asks for a name. Deliberately a short, explicit
 * list: this decides whether the NEXT turn is treated as an answer, and
 * a loose pattern would start reading arbitrary replies as names.
 */
const NAME_REQUEST =
  /\byour name\b|\bwho am i speaking\b|\bname (?:please|is that)\b|\bcan i take your\b.{0,12}\bname\b|\bmay i (?:have|take)\b.{0,12}\bname\b/i;

/** Openers people put in front of a name, stripped before reading it. */
const ANSWER_PREFIX =
  /^(?:it(?:'|’)?s|its|i(?:'|’)?m|im|my name(?:'|’)?s|my name is|this is|the name(?:'|’)?s|yes,?|sure,?|hi,?|hello,?)\s+/i;

/** Words that are never a name, however the turn is punctuated. */
const NOT_A_NAME =
  /^(?:yes|no|yeah|yep|nope|ok|okay|sure|thanks|thank you|correct|that(?:'|’)?s right|speaking|hello|hi|hey)$/i;

/** Letters only, lowercased — the comparison form for a NAME. */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * The comparison form for an email's LOCAL PART. Separators go — one
 * name is written "john.smith", "john_smith" or "john-smith" — but
 * DIGITS STAY.
 *
 * They stay because of the 2026-09-02 production call. The caller was
 * "Jason Test", their local part was "jasontest141", and the shared
 * normalise() above deleted the digits, collapsing the local part to
 * exactly "jasontest" — the caller's own name. looksDerivedFromEmail
 * then reported an EXACT match and declared a real person's real name
 * manufactured from their own address. Building an email out of your
 * name plus a few digits is what ordinary people do, so that false
 * positive was aimed squarely at the normal case.
 *
 * Keeping the digits leaves the two strings the different lengths they
 * honestly are, and costs nothing elsewhere: a local part with no
 * digits normalises exactly as it did before.
 */
function normaliseLocalPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Restricted Levenshtein; bails out as soon as it exceeds `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (row[j] < best) best = row[j];
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/**
 * Whether a name candidate looks manufactured from an email's local
 * part.
 *
 * **Exact-normalised first**: "James Hartley" against
 * "jameshartley@gmail.com" is the whole observed failure shape and
 * needs nothing cleverer.
 *
 * A narrow edit-distance rule follows it, and exists for one measured
 * reason: on the live call the fabricated name and the local part
 * differed by a single vowel ("erniesephora" vs "erniesophura"), which
 * an exact test misses. It is deliberately restricted — at least 6
 * letters, and at most 2 edits — so ordinary distinct names cannot
 * collide, and it is only ever consulted as a NEGATIVE guard when no
 * caller-spoken support exists (see resolveCallerName). Similarity is
 * never on its own treated as proof that a name is invalid.
 *
 * **Digits in the local part are significant** — see
 * normaliseLocalPart. "Jason Test" against "jasontest141" is NOT a
 * match, because the digits make it a longer string that the name does
 * not account for.
 *
 * The deliberate trade that follows, recorded rather than glossed
 * over: a name a model genuinely DID manufacture from a local part
 * containing digits no longer trips this guard either. The evidence
 * for the two cases is identical — "Jason Test" from "jasontest141"
 * looks the same whether a person or a model wrote it — and nothing
 * available here separates them.
 *
 * The costs are not symmetric, and that is what settles it. A false
 * positive DESTROYS a correct name the extractor got right, which is
 * what happened in production on 2026-09-02. A false negative only
 * leaves the candidate standing, exactly as it stood before this guard
 * existed. So this fails toward keeping the caller's own data, and the
 * all-letter local part that PR #39 was actually built on — including
 * the observed "erniesophura" — is untouched.
 */
export function looksDerivedFromEmail(
  name: string | null | undefined,
  email: string | null | undefined
): boolean {
  const n = normalise(name ?? "");
  const local = normaliseLocalPart((email ?? "").split("@")[0] ?? "");
  if (!n || !local || n.length < 3) return false;
  if (n === local) return true;
  // A local part carrying DIGITS is settled by the exact test alone.
  // The edit-distance rule below measures one thing — the vowel drift
  // between two spellings of the same word — and an appended digit run
  // is not that. Left in, it silently re-admits the whole defect for
  // shorter suffixes: "johnsmith" against "johnsmith82" is two edits,
  // so a real John Smith would be destroyed exactly as Jason Test was.
  // The three digits in the observed call were incidental.
  if (/\d/.test(local)) return false;
  if (n.length < 6 || local.length < 6) return false;
  return editDistance(n, local, 2) <= 2;
}

interface Turn {
  speaker: "ai" | "user";
  text: string;
}

/**
 * Splits a transcript into speaker turns. Handles both the newline form
 * and the inline form ("AI: ... User: ...") that appears in this
 * codebase's own fixtures, because the provider sends a plain string
 * and neither shape is guaranteed.
 */
function toTurns(transcript: string): Turn[] {
  const parts = transcript.split(/\b(AI|Assistant|User|Customer)\s*:\s*/i);
  const turns: Turn[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const label = parts[i].toLowerCase();
    const text = (parts[i + 1] ?? "").trim();
    if (!text) continue;
    turns.push({
      speaker: label === "user" || label === "customer" ? "user" : "ai",
      text,
    });
  }
  return turns;
}

/** Removes anything that is an address, spoken or written. */
function stripEmails(text: string): string {
  return text.replace(LITERAL_EMAIL, " ").replace(SPOKEN_EMAIL, " ");
}

/**
 * Reads a caller's answer to a name question. Conservative by design:
 * anything it is unsure about yields null, which simply means "no
 * spoken support" and leaves the model's candidate to be judged on the
 * email test instead.
 */
function readNameAnswer(answer: string): string | null {
  // First clause only: "Ernesto. E R N E S T O." and "Brian, with an i"
  // both carry the name before the punctuation.
  const firstClause = stripEmails(answer).split(/[.,;!?]/)[0]?.trim() ?? "";
  const cleaned = firstClause.replace(ANSWER_PREFIX, "").trim();
  if (!cleaned || NOT_A_NAME.test(cleaned)) return null;

  const words = cleaned.split(/\s+/);
  // A spelled-out answer — "E R N E S T O" — joins into one name.
  if (words.length >= 3 && words.every((w) => /^[A-Za-z]$/.test(w))) {
    return words.join("");
  }
  if (words.length > 3) return null;
  if (!words.every((w) => /^[A-Za-z][A-Za-z'’-]{1,19}$/.test(w))) return null;
  return words.join(" ");
}

/**
 * The caller's own name, when they were asked for one and gave a usable
 * answer. Null whenever that is not clearly the case — this is evidence,
 * not a guess.
 */
export function findSpokenName(transcript: string | null | undefined): string | null {
  const text = transcript?.trim();
  if (!text) return null;
  const turns = toTurns(text);
  for (let i = 0; i < turns.length - 1; i++) {
    if (turns[i].speaker !== "ai" || !NAME_REQUEST.test(turns[i].text)) continue;
    const next = turns[i + 1];
    if (next.speaker !== "user") continue;
    const name = readNameAnswer(next.text);
    if (name) return name;
  }
  return null;
}

/** True when the candidate and the spoken name are the same person. */
function namesAgree(candidate: string, spoken: string): boolean {
  const c = normalise(candidate);
  const s = normalise(spoken);
  if (!c || !s) return false;
  return c === s || c.includes(s) || s.includes(c);
}

/**
 * The caller name to record, given what the model produced and what the
 * caller actually said.
 *
 * **A caller-supplied identity outranks a model inference, and an email
 * outranks nothing at all.** The order:
 *
 * 1. The candidate agrees with what the caller said — keep the
 *    candidate. It may legitimately be the fuller form ("John Smith"
 *    where the turn caught "John").
 * 2. The candidate disagrees with what the caller said AND looks
 *    manufactured from the email — take the caller's own word. This is
 *    the observed defect, and the ONLY case where spoken evidence
 *    overrides the model.
 * 3. The candidate disagrees for any other reason — keep the candidate.
 *    A later correction ("it's Ernest, not Ernesto") is exactly this,
 *    and the extractor is told corrections win; this guard must not
 *    resurrect a stale first answer.
 * 4. No spoken support at all, and the candidate looks manufactured
 *    from the email — reject it. The owner sees the caller's phone
 *    number, which is true, instead of a person who does not exist.
 * 5. Otherwise the candidate stands, exactly as before this existed.
 *
 * A legitimate name that merely resembles its owner's address —
 * "John Smith" with johnsmith@gmail.com — is protected by step 1 and
 * never reaches the email test.
 */
export function resolveCallerName(
  candidate: string | null | undefined,
  email: string | null | undefined,
  transcript: string | null | undefined
): string | null {
  const name = candidate?.trim() || null;
  const spoken = findSpokenName(transcript);

  if (spoken) {
    if (!name) return spoken;
    if (namesAgree(name, spoken)) return name;
    return looksDerivedFromEmail(name, email) ? spoken : name;
  }

  if (name && looksDerivedFromEmail(name, email)) return null;
  return name;
}
