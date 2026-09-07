// ── Caller timing evidence ─────────────────────────────────────────
// One narrow job: stop the caller's requested day and time being lost
// when the provider's structured data omits it.
//
// `sanitisePreferredDatetime` is a FILTER — it keeps an urgency-only
// phrase out of a field that means WHEN, and is null-in/null-out. So
// `sanitisePreferredDatetime(details.preferred_datetime)` resolves to
// null whenever a partial payload omitted the field, on a call whose
// transcript plainly carries the day and time the caller was asked for
// and gave. The transcript already reaches `toExtractedLead` and is
// read there for the caller's name, their service address and their
// email; timing was the field with evidence available and no reader.
//
// The consequence is a downgraded booking, not a wrong one. With no
// timing there is no instant, `isBookingConfirmed` cannot confirm, no
// calendar event is written, and the owner is told neither what was
// asked for nor that anything was attempted — on a call where the
// caller said when they wanted the visit.
//
// LOCATE, then sanitise. Those stay separate responsibilities: this
// module chooses a candidate from caller speech and hands it to the
// existing `sanitisePreferredDatetime` unchanged, so the PR #35 rule
// (urgency is never a time) applies to a recovered value exactly as it
// applies to the provider's. Nothing here parses, completes, resolves
// or converts a datetime: the recovered value is the caller's PHRASE,
// and `parseDatetimeToIso` turns phrases into instants — with the
// organisation's timezone, DST and weekday correction — exactly as it
// already does for the provider's phrase.
//
// WHY A DAY IS REQUIRED AND A CLOCK IS NOT ENOUGH. "AI: what time on
// Friday? / User: 3 PM." carries a caller-spoken clock whose DAY came
// from the assistant. Recovering "3 PM" alone would resolve against
// today and book the wrong day, so evidence must pin a day, a date or
// a relative day of its own. A clock with no day recovers nothing —
// the same absence as before, which is safe.
//
// NOT an NLP layer and not a general datetime finder. It answers one
// question — "did the caller state the day they want here?" — and
// hands what they said to the sanitiser.

import {
  sanitisePreferredDatetime,
  type CallbackTiming,
} from "@/lib/voice/callbackTiming";

/** A turn in the transcript, as stored: "AI: …" / "User: …". */
interface Turn {
  speaker: "ai" | "user";
  text: string;
}

/**
 * Splits a transcript into speaker turns. Same shape as
 * emailIntegrity.ts, which handles both the newline form and the inline
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
      speaker:
        label === "user" || label === "customer" || label === "caller"
          ? "user"
          : "ai",
      text,
    });
  }
  return turns;
}

/**
 * How a receptionist asks WHEN. Deliberately a short, explicit list —
 * this decides whether the NEXT turn is read as the caller stating a
 * time, and a loose pattern ("mentions a day") would start reading
 * arbitrary replies.
 *
 * A suggestion — "Does Tuesday at 2 suit you?" — matches, and that is
 * harmless: the caller's reply still has to state a day of its own, so
 * a bare "yes" recovers nothing and the assistant's suggestion cannot
 * become the caller's evidence.
 */
const TIMING_REQUEST =
  /\bwhen\b[^.?!]{0,40}\b(?:suits?|works?|free|available|like|want|prefer|come|call)\b|\bwhat\s+(?:day|time|date)\b|\bwhich\s+(?:day|time|date)\b|\bday\s+and\s+time\b|\bare\s+you\s+free\b|\bdoes\s+[^.?!]{0,40}\bsuit\b|\bwould\s+[^.?!]{0,40}\bsuit\b/i;

/**
 * The caller volunteering it — "can you come Friday at 2", "I'm free
 * Thursday morning". The cue is what makes this safe: it marks where
 * the answer BEGINS, so nothing has to be guessed about the left
 * boundary.
 *
 * Closed and small on purpose. This is a list of recognised wordings,
 * never a general "the caller mentioned a day" test.
 */
const SELF_DECLARED: RegExp[] = [
  /\b(?:can|could|would)\s+(?:you|someone|somebody|anyone)\s+(?:come|call|ring|visit)\s+(?:out\s+)?(.+)$/i,
  /\b(?:can|could)\s+we\s+(?:do|say|make\s+it)\s+(.+)$/i,
  /\bi(?:'|’)?m\s+(?:free|available|around)\s+(.+)$/i,
  /\bi(?:'|’)?d\s+like\s+(?:it\s+|someone\s+|an\s+appointment\s+)?(?:for|on|at)\s+(.+)$/i,
  /\b(?:i\s+)?(?:want|need)\s+(?:someone|somebody|it|an\s+appointment)\s+(?:to\s+come\s+)?(?:on|at|for)\s+(.+)$/i,
  /\blet(?:'|’)?s\s+(?:say|do|make\s+it)\s+(.+)$/i,
  /\bhow\s+about\s+(.+)$/i,
];

/**
 * Openers people put in front of an answer, stripped before reading it.
 * Same idea as addressIntegrity.ts and emailIntegrity.ts — "No, Friday
 * at 2" is the caller correcting a read-back, and the "No," is not part
 * of the answer.
 */
const ANSWER_PREFIX =
  /^(?:no|nope|yes|yeah|yep|sure|erm|um|uh|ok(?:ay)?|so|well|right|sorry|actually|it(?:'|’)?s|that(?:'|’)?s|make\s+it)\b[,.]?\s+/i;

/**
 * Replies that are plainly not the caller stating a time, however
 * punctuated. The bare acknowledgement is the important one: a caller
 * agreeing with a suggestion or a read-back is NOT the caller supplying
 * a time, and treating it as one would launder the assistant's own
 * model-generated value into caller evidence.
 */
const NOT_A_TIME =
  /^(?:yes|yeah|yep|no|nope|correct|that(?:'|’)?s\s+right|that(?:'|’)?s\s+it|that(?:'|’)?s\s+fine|sure|ok(?:ay)?|fine|perfect|great|grand|lovely|thanks?|thank\s+you|sorry|pardon|what|nothing|none|n\/a)\b[.!]?$/i;

const WEEKDAY =
  "monday|tuesday|tues|wednesday|weds|thursday|thurs|friday|saturday|sunday";
const MONTH =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec";
const SPELLED_ORDINAL =
  "first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty[- ]?first|twenty[- ]?second|twenty[- ]?third|twenty[- ]?fourth|twenty[- ]?fifth|twenty[- ]?sixth|twenty[- ]?seventh|twenty[- ]?eighth|twenty[- ]?ninth|thirtieth|thirty[- ]?first";

/**
 * A DAY the caller pinned themselves. One of these must be present for
 * anything to be recovered — see the module note on why a clock alone
 * is not enough.
 *
 * Each alternative names a day, a date or a relative day:
 *   a weekday                      "Friday", "Thursday afternoon"
 *   a relative day                 "tomorrow", "today", "tonight"
 *   a day part bound to a day      "this afternoon", "tomorrow morning"
 *   a calendar date with a month   "20 August", "August 20th"
 *   a spelled date with a month    "the twelfth of July"
 *   a numeric date                 "20/08/26"
 *   an ordinal day                 "the 10th"
 *
 * Deliberately NOT here: a bare day part ("the afternoon"), a bare
 * clock ("3 PM") and a spelled ordinal with no month ("the twelfth").
 * Each of those leaves the day to be guessed, and this module guesses
 * nothing.
 */
const DAY_ANCHORS: RegExp[] = [
  new RegExp(`\\b(?:${WEEKDAY})\\b`, "i"),
  /\b(?:today|tomorrow|tonight)\b/i,
  /\b(?:this|next)\s+(?:morning|afternoon|evening|night)\b/i,
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTH})\\b`, "i"),
  new RegExp(`\\b(?:${MONTH})\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, "i"),
  new RegExp(`\\b(?:${SPELLED_ORDINAL})\\s+of\\s+(?:${MONTH})\\b`, "i"),
  /\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/,
  /\b(?:the\s+)?\d{1,2}(?:st|nd|rd|th)\b/i,
];

/**
 * Any word that carries timing at all — weaker than a DAY_ANCHOR, and
 * used only to trim a clause span down to the part that is about time.
 * "John Smith, Friday at 2" keeps "Friday at 2"; "Friday at 2, if
 * that's easier" keeps "Friday at 2".
 */
const TIMING_TOKEN = new RegExp(
  `\\b(?:${WEEKDAY}|${MONTH}|today|tomorrow|tonight|morning|afternoon|evening|night|noon|midday|midnight|lunchtime|o'?clock|am|pm)\\b|\\b\\d{1,2}(?:[:.]\\d{2})?\\s*(?:am|pm|o'?clock)\\b|\\b\\d{1,2}(?:st|nd|rd|th)\\b|\\b\\d{1,2}[/.-]\\d{1,2}\\b`,
  "i"
);

/** A run of digits no clock or date has — a phone number, not a time. */
const LONG_DIGIT_RUN = /\d[\d\s-]{4,}/;

/**
 * Street words. An answer naming a street is an ADDRESS, and an address
 * carrying a number must never be read as a date — "3 Sunday Close" is
 * where the work is, not when.
 */
const LOOKS_LIKE_ADDRESS =
  /\b(?:street|road|avenue|drive|lane|close|court|crescent|terrace|place|park|way|square|grove|gardens?|estate|apartment|flat|eircode|postcode)\b/i;

/** "for three days", "for 2 weeks" — how long, never when. */
const DURATION =
  /\bfor\s+(?:\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:minute|hour|day|week|month|year)s?\b/i;

/** The longest a stated day and time plausibly is. */
const MAX_CANDIDATE_LENGTH = 80;

function hasDayAnchor(text: string): boolean {
  return DAY_ANCHORS.some((anchor) => anchor.test(text));
}

/** Sentences of a turn, in order. */
function toSentences(text: string): string[] {
  return text
    .split(/(?<=\w)[.!?](?:\s|$)/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * Trims a sentence to the span that is actually about time: from its
 * first clause carrying a timing word to its last. Clause boundaries
 * are the caller's own commas, so the span is always whole clauses —
 * "Thursday, 20 August, at 3 PM" survives intact rather than being cut
 * down to its final clause.
 */
function timingSpan(sentence: string): string | null {
  const clauses = sentence
    .split(/[,;]/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  if (clauses.length === 0) return null;

  const first = clauses.findIndex((clause) => TIMING_TOKEN.test(clause));
  if (first === -1) return null;
  let last = first;
  for (let i = clauses.length - 1; i > first; i--) {
    if (TIMING_TOKEN.test(clauses[i])) {
      last = i;
      break;
    }
  }
  return clauses.slice(first, last + 1).join(", ");
}

/**
 * Reads one stretch of caller speech as the day and time they stated,
 * or null.
 *
 * The LAST qualifying sentence wins, so a correction made inside a
 * single turn ("Thursday. Actually, make it Friday at 2.") lands on the
 * corrected value.
 */
function readTimingAnswer(text: string): string | null {
  let latest: string | null = null;

  for (const sentence of toSentences(text)) {
    const stripped = sentence.replace(ANSWER_PREFIX, "").trim();
    if (!stripped || NOT_A_TIME.test(stripped)) continue;

    const span = timingSpan(stripped);
    if (!span) continue;

    const candidate = span.replace(ANSWER_PREFIX, "").replace(/[.,;]+$/, "").trim();
    if (!candidate || candidate.length > MAX_CANDIDATE_LENGTH) continue;
    if (!hasDayAnchor(candidate)) continue;
    if (LONG_DIGIT_RUN.test(candidate)) continue;
    if (LOOKS_LIKE_ADDRESS.test(candidate)) continue;
    if (DURATION.test(candidate)) continue;

    // The same filter the provider's value passes. A phrase that is only
    // urgency can never become a time, whichever source it came from —
    // that is the PR #35 rule, and it is not weakened by being reached
    // from here.
    //
    // Recorded honestly: today this line is UNREACHABLE by construction,
    // and its mutation is inert. Every DAY_ANCHOR above is also a
    // CONCRETE_TIMING token, so a candidate that reaches here can never
    // be urgency-only. It stays as the invariant it states — widening
    // the anchors (a bare day part, say) is exactly the change that
    // would make it load-bearing, and it should be here already when
    // that happens rather than being remembered.
    if (!sanitisePreferredDatetime(candidate).preferredDatetime) continue;

    latest = candidate;
  }

  return latest;
}

/**
 * The LAST day and time the caller actually stated — either as an
 * answer to an explicit timing question, or volunteered behind an
 * explicit cue.
 *
 * Last, not first, because a later correction supersedes an earlier
 * value. The caller's turns are ordered, so "Thursday … actually, can
 * you come Friday at 2" resolves to the correction with no inference:
 * this is the same ordering authority the address and email guards
 * already rely on.
 *
 * ASSISTANT TURNS ARE NEVER READ. The assistant is the one party on the
 * call that proposes times and reads them back, and reading its turns
 * would make its own suggestion look like the caller's evidence.
 */
export function findSpokenDatetime(
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
    // boundary, so what follows is read as the answer itself.
    let declared: string | null = null;
    for (const cue of SELF_DECLARED) {
      const match = cue.exec(turn.text);
      if (match) {
        declared = match[1];
        break;
      }
    }
    if (declared !== null) {
      const volunteered = readTimingAnswer(declared);
      if (volunteered) latest = volunteered;
      continue;
    }

    // Otherwise only an answer to an explicit timing question counts.
    const previous = turns[i - 1];
    if (!previous || previous.speaker !== "ai") continue;
    if (!TIMING_REQUEST.test(previous.text)) continue;

    const answer = readTimingAnswer(turn.text);
    if (answer) latest = answer;
  }

  return latest;
}

/**
 * The requested timing to record, given what the provider produced and
 * what the caller actually said.
 *
 * **The provider's value is authoritative whenever it survives the
 * sanitiser.** The order:
 *
 * 1. The provider supplied a real timing — use it, byte for byte, and
 *    do not look at the transcript at all. A transcript timing is never
 *    compared with it and never replaces it: structured-versus-
 *    transcript conflict is a separate question, deliberately out of
 *    scope, and nothing here is "the transcript wins".
 * 2. The provider supplied URGENCY — that is an ANSWER, not an absence.
 *    The caller was asked when and said "as soon as possible"; a day
 *    mentioned elsewhere on the call must not outrank their own answer,
 *    and the urgency is preserved for the owner exactly as before.
 * 3. Nothing at all came from the provider — the field was omitted by a
 *    partial payload, or held only blank text — then read the caller's
 *    own evidence.
 * 4. No usable evidence either — record nothing, exactly as before.
 *
 * Deterministic and self-contained: no model call and no network. The
 * only import is the existing sanitiser, which is unchanged — this
 * module never widens what counts as a timing, it only decides what to
 * offer it.
 */
export function resolveRequestedDatetime(
  candidate: string | null | undefined,
  transcript: string | null | undefined
): CallbackTiming {
  const structured = sanitisePreferredDatetime(candidate);
  if (structured.preferredDatetime || structured.urgency) return structured;

  const spoken = findSpokenDatetime(transcript);
  return spoken ? { preferredDatetime: spoken, urgency: null } : structured;
}
