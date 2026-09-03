// ── Service integrity ──────────────────────────────────────────────
// One narrow job: stop a service the CALLER never asked for becoming
// the canonical one.
//
// `service` was the last caller-supplied voice field with no
// deterministic backstop. `normaliseSpokenEmail`, `sanitisePreferredDatetime`,
// `resolveCallerName` and `resolveServiceAddress` each exist because the
// prompts say the right thing and a model that ignores them writes
// straight into the lead. This is the fifth, and the failure it guards
// is a different shape from the other four.
//
// Name was corrupted by an ADJACENT FIELD (an email local part).
// Address was corrupted by the TRANSCRIBER. Timing was corrupted by the
// WRONG KIND OF VALUE (urgency arriving where a time belongs). In every
// one of those the model was relaying something real and getting it
// wrong. Here the model is ASKED FOR A LABEL and returns one, and
// nothing checked that the label came from the caller.
//
// The 2026-09-03 production call was correct — the caller said "I have
// a leaking radiator" and the canonical service read "leaking radiator"
// — but it was correct because the model obeyed its instruction, not
// because anything enforced it. Had it answered "radiator repair",
// "heating service" or "boiler repair", every downstream surface would
// have accepted it: the lead, the owner's email, the Knowledge Base
// check, the calendar event title, and the confirmation email the
// CUSTOMER reads. A wrong service there dispatches an engineer for the
// wrong job and tells the customer they booked it.
//
// THE INVARIANT THIS ENFORCES, and the whole of it:
//
//   Every word of the resolved service was spoken by the CALLER, on
//   this call, and not under a negation.
//
// CONSTRAIN-ONLY, and strictly so. The result is always a subsequence
// of the model's own candidate: this may KEEP a candidate, REDUCE it to
// the part the caller actually supports, or REFUSE it. It never
// reorders, never rewrites, never adds a word, and can therefore never
// resurrect a service the caller superseded — it has no way to produce
// a word the candidate did not already contain.
//
// NOT a classifier. It never decides what service a call was about,
// never maps a problem to a trade, and holds no vocabulary: there is no
// synonym list, no taxonomy, no trade names, no fuzzy matching, no
// embeddings, no model call and no network. The only domain knowledge
// it uses is the morphology table PR #28 already proved in production
// (`stemServiceWord`), so "leaking" and "leak" are recognised as the
// same word the same way the Knowledge Base matcher recognises them.
//
// The asymmetry is deliberate and is the reason it fails the way it
// does. A FALSE POSITIVE persists a service the caller never asked for,
// shows it to the owner, titles a diary entry with it and sends it to
// the customer. A FALSE NEGATIVE gives the owner the caller's own
// rougher wording, or no service at all — and absence is already
// rendered as absence everywhere (no Service row, a plain "Appointment"
// title, no service line in the customer's email). The caller's truth
// outranks a tidier label.

import { stemServiceWord } from "@/lib/leadCapture";

/** A turn in the transcript, as stored: "AI: …" / "User: …". */
interface Turn {
  speaker: "ai" | "user";
  text: string;
}

/**
 * Splits a transcript into speaker turns. Handles both the newline form
 * and the inline form ("AI: … User: …"), the same two shapes
 * `nameIntegrity` handles, because the provider sends a plain string
 * and neither is guaranteed.
 *
 * This is the load-bearing line of the whole guard: everything below
 * reads `user` turns and nothing else. An assistant turn is not caller
 * evidence, however plainly it names a service — and the assistant is
 * the one party on the call that has been handed the business's own
 * "Services Offered" vocabulary in its prompt.
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
 * Grammatical words only — articles, pronouns, copulas, prepositions,
 * conjunctions. Every one of them is a closed-class English function
 * word, and the list is closed for a reason: the moment a CONTENT word
 * is added ("repair", "service", "emergency"), the guard stops noticing
 * when the model supplies one the caller never said, which is the
 * entire failure being guarded. There is deliberately no trade
 * vocabulary here and none is to be added.
 */
const FUNCTION_WORDS = new Set([
  "a", "an", "the", "my", "our", "your", "their", "his", "her", "its",
  "i", "we", "you", "they", "it", "me", "us", "them",
  "this", "that", "these", "those",
  "is", "are", "was", "were", "be", "been", "am", "s",
  "of", "for", "to", "in", "on", "at", "with", "from", "by", "about",
  "and", "or", "so", "as", "if", "then",
  "have", "has", "had", "get", "got",
]);

/**
 * Negation cues. Narrow on purpose.
 *
 * Bare "no" is deliberately NOT a cue. "No hot water" is one of the
 * commonest ways a caller describes the thing they are ringing about,
 * and treating it as a negation would refuse a service the caller
 * genuinely gave — the guard destroying real caller information, which
 * is the failure it is supposed to be the opposite of.
 */
const NEGATION_CUES = new Set([
  "not", "never",
  "dont", "doesnt", "didnt", "isnt", "wasnt", "arent", "werent",
  "wont", "cant", "cannot", "havent", "hasnt",
]);

/** Splits a turn into clauses. A negation reaches to the clause end. */
function toClauses(text: string): string[] {
  return text.split(/[,.;:!?—–]+|\s+but\s+/i);
}

/** Word tokens, lower-cased, apostrophes closed up ("don't" → "dont"). */
function toWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * The canonical comparison form of one word.
 *
 * PR #28's `stemServiceWord` first, so the guard and the Knowledge Base
 * matcher agree about morphology rather than each having an opinion.
 * Its table covers -ian/-ing/-er/-al/-y and plurals; it has no past
 * participle rule, so "repaired" and "repairing" would otherwise stem
 * apart and a caller who said "my boiler needs repaired" would lose the
 * word.
 *
 * The "-ed" strip is applied HERE, locally, and never to
 * `stemServiceWord` itself: that table decides Knowledge Base matching
 * and booking permission, and widening it would change PR #28's proven
 * behaviour for a reason that has nothing to do with it. The minimum
 * stem length is the same safety mechanism the shared table uses —
 * "need" (4) is left alone rather than becoming "ne".
 */
function comparisonStem(word: string): string {
  const stem = stemServiceWord(word);
  if (stem.endsWith("ed") && stem.length - 2 >= 4) return stem.slice(0, -2);
  return stem;
}

/**
 * Every stem the CALLER supplied positively — assistant turns excluded,
 * negated clauses excluded.
 *
 * Exported for its own tests: "which words count as the caller's" is
 * the entire safety argument, so it is asserted directly and not only
 * through the resolver.
 */
export function callerSupportedStems(transcript: string | null | undefined): Set<string> {
  const stems = new Set<string>();
  if (!transcript?.trim()) return stems;

  for (const turn of toTurns(transcript)) {
    if (turn.speaker !== "user") continue;
    for (const clause of toClauses(turn.text)) {
      const words = toWords(clause);
      if (words.some((w) => NEGATION_CUES.has(w))) continue;
      for (const word of words) stems.add(comparisonStem(word));
    }
  }
  return stems;
}

/**
 * Reduces a candidate to the part the caller actually supports.
 *
 * Keeps the span between the first and last SUPPORTED significant word,
 * preserving the candidate's own order and its function words, and
 * drops the significant words inside that span the caller never said.
 * Returns null when the caller supported none of them.
 *
 * The output is always a subsequence of the input. That is what makes
 * "it cannot invent a service" a property of the code rather than a
 * claim about it.
 */
function reduceToSupported(candidate: string, supported: Set<string>): string | null {
  const tokens = candidate.split(/\s+/).filter(Boolean);

  const isSignificant = (token: string): boolean => {
    const words = toWords(token);
    return words.length > 0 && !words.every((w) => FUNCTION_WORDS.has(w));
  };
  const isSupported = (token: string): boolean =>
    toWords(token).every((w) => FUNCTION_WORDS.has(w) || supported.has(comparisonStem(w)));

  const keptIndexes = tokens
    .map((token, index) => (isSignificant(token) && isSupported(token) ? index : -1))
    .filter((index) => index >= 0);

  if (keptIndexes.length === 0) return null;

  const first = keptIndexes[0];
  const last = keptIndexes[keptIndexes.length - 1];
  const kept = tokens
    .slice(first, last + 1)
    .filter((token) => !isSignificant(token) || isSupported(token));

  const reduced = kept.join(" ").trim();
  return reduced || null;
}

/**
 * The canonical service for this call.
 *
 * Precedence, in order:
 *
 *   1. Every significant word of the candidate is caller-supported —
 *      KEEP the candidate exactly as the model wrote it. Harmless
 *      reordering and morphology survive: a caller saying "my radiator
 *      is leaking" fully supports "leaking radiator".
 *   2. Some are supported — REDUCE to the caller's own words, in the
 *      candidate's order. "radiator repair" against a caller who only
 *      said the radiator was leaking becomes "radiator".
 *   3. None are supported — REFUSE. Nothing is stored, and absence is
 *      already rendered as absence on every surface.
 *
 * With no transcript, or a transcript with no caller turns, there is
 * nothing to check against and the candidate stands. This is the same
 * posture `resolveCallerName` and `resolveServiceAddress` take: these
 * guards constrain a candidate against evidence, and the absence of
 * evidence is not itself evidence of invention. A call that reaches
 * here with no transcript at all has already lost the fallback
 * extractor too (PR #48), so in practice the candidate is a provider
 * structuredData value with no text to judge it by.
 */
export function resolveRequestedService(
  candidate: string | null | undefined,
  transcript: string | null | undefined
): string | null {
  const service = candidate?.trim() || null;
  if (!service) return null;

  const supported = callerSupportedStems(transcript);
  if (supported.size === 0) return service;

  return reduceToSupported(service, supported);
}
