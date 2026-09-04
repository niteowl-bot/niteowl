// ── Caller email evidence ──────────────────────────────────────────
// One narrow job: stop a caller's email being lost when the provider's
// structured data omits it.
//
// `normaliseSpokenEmail` is a NORMALISER — it converts and validates a
// candidate somebody else already chose, and is null-in/null-out. So
// `normaliseSpokenEmail(details.email)` resolves to null whenever the
// provider omitted the field, even on a call whose transcript plainly
// carries the address the caller spelled out. The transcript is passed
// into `toExtractedLead` and read there as evidence for the caller's
// name and their service address; `email` was the field with the
// evidence available and no reader for it.
//
// The consequence is not cosmetic. `leads.email` is what
// sendBookingConfirmationEmails writes to, and that send is guarded by
// `if (customerEmail)` — so a null address means the customer
// confirmation is not failed, it is never attempted. A replay of the
// real `processCallEnded` proved a booking completing with a calendar
// event created, an owner notification sent, and the customer told
// nothing.
//
// LOCATE, then normalise. Those are separate responsibilities and stay
// separate: this module chooses a candidate from caller speech and
// hands it to the existing `normaliseSpokenEmail` unchanged. It never
// assembles, repairs, completes or invents an address, and anything the
// normaliser refuses is recovered as nothing.
//
// WHY THIS IS NOT A SPAN SEARCH. The investigation prototyped a greedy
// locator over the transcript and it manufactured well-formed but WRONG
// addresses in both directions — shortest-first turned "john dot smith
// at gmail dot com" into `smith@gmail.com`, longest-first absorbed
// surrounding speech into the local part. A wrong address is worse than
// none here: it is deliverable, so a confirmation goes to a real
// stranger and the actual customer still hears nothing. This module
// therefore never hunts for a substring that happens to validate. It
// only reads places where the CONVERSATION establishes that the caller
// is giving their address — an answer to an explicit email question, or
// an explicit self-declaration whose cue supplies the left boundary.
//
// NOT an NLP layer and not a general email finder. It answers one
// question — "did the caller supply their email here?" — and hands what
// they said to the normaliser.

import { normaliseSpokenEmail } from "@/lib/voice/spokenEmail";

/** A turn in the transcript, as stored: "AI: …" / "User: …". */
interface Turn {
  speaker: "ai" | "user";
  text: string;
}

/**
 * Splits a transcript into speaker turns. Same shape as
 * nameIntegrity.ts, which handles both the newline form and the inline
 * form because the provider sends a plain string and neither is
 * guaranteed.
 */
function toTurns(transcript: string): Turn[] {
  const parts = transcript.split(/\b(AI|Assistant|Bot|User|Customer|Caller)\s*:\s*/i);
  const turns: Turn[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const label = parts[i].toLowerCase();
    const text = (parts[i + 1] ?? "").trim();
    if (!text) continue;
    turns.push({
      speaker: label === "user" || label === "customer" || label === "caller" ? "user" : "ai",
      text,
    });
  }
  return turns;
}

/**
 * How a receptionist asks for the email. Deliberately a short, explicit
 * list — this decides whether the NEXT turn is read as the caller
 * giving their address, and a loose pattern ("mentions the word email")
 * would start reading arbitrary replies.
 *
 * A read-back — "Is your email john@example.com?" — matches, and that
 * is harmless: the caller's reply still has to contain an address of
 * its own, so a bare "yes" recovers nothing.
 */
const EMAIL_REQUEST =
  /\byour\s+e[-\s]?mail\b|\be[-\s]?mail\s+address\b|\b(?:have|take|get|confirm)\b[^.?!]{0,20}\be[-\s]?mail\b|\bwhat(?:'|’)?s\s+the\s+e[-\s]?mail\b/i;

/**
 * The caller volunteering it — "my email is …", "you can email me at
 * …". The cue is what makes this safe: it marks where the address
 * BEGINS, so nothing has to be guessed about the left boundary.
 *
 * Closed and small on purpose. This is a list of recognised wordings,
 * never a general "the caller said something about email" test.
 */
const SELF_DECLARED: RegExp[] = [
  /\b(?:my|the|our)\s+e[-\s]?mail(?:\s+address)?\s+(?:is|would\s+be|it(?:'|’)?s)\s+(.+)$/i,
  /\b(?:you\s+can\s+)?(?:e[-\s]?mail|contact|reach)\s+me\s+(?:at|on)\s+(.+)$/i,
];

/**
 * Openers people put in front of an answer, stripped before reading it.
 * Same idea as addressIntegrity.ts — "No, john at example dot com" is
 * the caller correcting a read-back, and the "No," is not part of the
 * address.
 */
const ANSWER_PREFIX =
  /^(?:no|nope|yes|yeah|yep|sure|erm|um|uh|ok(?:ay)?|so|well|right|sorry|actually)\b[,.]?\s+/i;

/**
 * Replies that are plainly not an address, however punctuated. A bare
 * acknowledgement is the important one: the caller agreeing with a
 * read-back is NOT the caller supplying an address, and treating it as
 * one would launder the assistant's own model-generated value into
 * caller evidence.
 */
const NOT_AN_EMAIL =
  /^(?:yes|yeah|yep|no|nope|correct|that(?:'|’)?s\s+right|that(?:'|’)?s\s+it|sure|ok(?:ay)?|thanks?|thank\s+you|perfect|great|sorry|pardon|what|nothing|none|n\/a)\b/i;

/**
 * The clauses of a turn, in order. Commas and sentence terminators are
 * the boundaries, so each candidate handed on is a WHOLE clause — never
 * a fragment of one.
 *
 * That distinction is the whole safety argument against the rejected
 * span search: a clause boundary is something the caller actually
 * uttered, so a local part can never be cut through the middle. "john
 * dot smith at gmail dot com" contains no clause boundary and is
 * therefore indivisible here.
 */
function toClauses(text: string): string[] {
  return text
    .split(/[,;]|(?<=\w)[.!?](?:\s|$)/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

/**
 * Reads one caller turn as the email they supplied, or null.
 *
 * The LAST clause that the normaliser accepts wins, so a caller who
 * names themselves first ("John Smith, john dot smith at example dot
 * com") is read correctly, a trailing aside ("…, if that's easier") is
 * ignored, and a correction made inside a single turn still lands on
 * the corrected value.
 */
function readEmailAnswer(text: string): string | null {
  let latest: string | null = null;
  for (const clause of toClauses(text)) {
    const cleaned = clause.replace(ANSWER_PREFIX, "").trim();
    if (!cleaned || NOT_AN_EMAIL.test(cleaned)) continue;
    const normalised = normaliseSpokenEmail(cleaned);
    if (normalised) latest = normalised;
  }
  return latest;
}

/**
 * The LAST email the caller actually supplied — either as an answer to
 * an explicit email question, or volunteered behind an explicit cue.
 *
 * Last, not first, because a later correction supersedes an earlier
 * value. The caller's turns are ordered, so "john at example dot com …
 * sorry, my email is john dot smith at example dot com" resolves to the
 * correction with no inference: this is the same ordering authority the
 * address guard already relies on.
 *
 * ASSISTANT TURNS ARE NEVER READ. The assistant is the one party on the
 * call speaking a model-generated address back, and reading its turns
 * would make the model's own guess look like the caller's evidence.
 */
export function findSpokenEmail(
  transcript: string | null | undefined
): string | null {
  const text = transcript?.trim();
  if (!text) return null;

  const turns = toTurns(text);
  let latest: string | null = null;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (turn.speaker !== "user") continue;

    // Volunteered at any point in the call. The cue is the left
    // boundary, so what follows is read as the address itself.
    let declared: string | null = null;
    for (const cue of SELF_DECLARED) {
      const match = cue.exec(turn.text);
      if (match) {
        declared = match[1];
        break;
      }
    }
    if (declared !== null) {
      const volunteered = readEmailAnswer(declared);
      if (volunteered) latest = volunteered;
      continue;
    }

    // Otherwise only an answer to an explicit email question counts.
    const previous = turns[i - 1];
    if (!previous || previous.speaker !== "ai") continue;
    if (!EMAIL_REQUEST.test(previous.text)) continue;

    const answer = readEmailAnswer(turn.text);
    if (answer) latest = answer;
  }

  return latest;
}

/**
 * The email to record, given what the provider produced and what the
 * caller actually said.
 *
 * **The provider's value is authoritative whenever it survives
 * normalisation.** The order:
 *
 * 1. The provider supplied an address the normaliser accepts — use it,
 *    and do not look at the transcript at all. A transcript address is
 *    never compared with it and never replaces it: structured-versus-
 *    transcript conflict is a separate question, deliberately out of
 *    scope, and nothing here is "the transcript wins".
 * 2. Nothing usable came from the provider — the field was absent, or
 *    what it held could not be made into a valid address — then read
 *    the caller's own evidence. Those two collapse into one case on
 *    purpose: after normalisation, an unusable value and a missing one
 *    are the same absence, and inventing a separate authority class for
 *    malformed input would add a rule with no evidence behind it.
 * 3. No usable evidence either — record nothing, exactly as before.
 *
 * Deterministic and self-contained: no model call and no network. The
 * only import is the existing normaliser, which is unchanged — this
 * module never widens what counts as a valid address, it only decides
 * what to offer it.
 */
export function resolveCallerEmail(
  candidate: string | null | undefined,
  transcript: string | null | undefined
): string | null {
  const structured = normaliseSpokenEmail(candidate);
  if (structured) return structured;

  return findSpokenEmail(transcript);
}
