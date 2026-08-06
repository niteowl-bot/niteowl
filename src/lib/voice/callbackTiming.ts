// ── Callback timing sanity ─────────────────────────────────────────
// One narrow job: keep an URGENCY phrase out of the fields that mean
// WHEN.
//
// From the 2026-08-06 test call. The caller asked for someone to ring
// them back, Remy asked "which day and time would suit you best?", the
// caller said "as soon as possible" — and that phrase came back out of
// the call as both the callback date and the callback time:
//
//   Callback date: as soon as possible
//   Callback time: as soon as possible
//
// "As soon as possible" says how urgent the caller is, not when they
// can take a call. Nobody can ring a customer at "as soon as possible",
// and parseDatetimeToIso cannot resolve it either, so it lands in the
// owner's inbox looking like a collected detail when nothing was
// collected at all.
//
// The prompt tells Remy not to accept it (assistant.ts rules 6 and 13),
// and the extraction schema tells the model not to record it — but both
// are instructions to a language model. This is the deterministic
// backstop underneath them: whatever the model returns, an urgency-only
// phrase never reaches preferred_datetime. The caller's own words are
// handed back to the caller (calls.ts records them as callback_urgency)
// so nothing is lost — it simply stops being a date.

export interface CallbackTiming {
  /** The timing the caller gave, or null when they gave only urgency. */
  preferredDatetime: string | null;
  /** The urgency phrase, in the caller's words, when that is all it was. */
  urgency: string | null;
}

/**
 * Anything that pins the request to a real point in the calendar or the
 * clock. One of these present means the phrase carries genuine timing
 * and must be left exactly as the caller said it — "Thursday as soon as
 * possible" is a Thursday request, and "any time between 2 and 5" is a
 * usable window (digits are matched for exactly this reason).
 */
const CONCRETE_TIMING =
  /\b(mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday|today|tonight|tomorrow|weekend|week|fortnight|month|morning|afternoon|evening|night|noon|midday|midnight|lunchtime|jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december|o'?clock|am|pm)\b|\d/i;

/**
 * How callers express urgency or indifference when asked WHEN. Only
 * consulted once CONCRETE_TIMING has ruled out a real day or time, so
 * these can stay broad without swallowing a genuine answer.
 */
const URGENCY_ONLY =
  /\b(asap|as soon as (?:possible|you can|they can|someone can|somebody can)|soon|soonest|earliest|first available|next available|immediately|urgent|urgently|emergency|right away|straight away|any ?time|when ?ever|at your convenience|no preference|don'?t mind|doesn'?t matter|whatever suits|whenever suits)\b/i;

/**
 * True when the phrase says how SOON the caller wants something and
 * nothing about when they are actually free.
 */
export function isUrgencyOnlyTiming(value: string | null | undefined): boolean {
  const text = value?.trim() ?? "";
  if (!text) return false;
  if (CONCRETE_TIMING.test(text)) return false;
  return URGENCY_ONLY.test(text);
}

/**
 * Splits a raw preferred-datetime string into the part that is a real
 * timing preference and the part that is only urgency. Anything that is
 * not urgency-only passes through untouched — vague-but-real answers
 * ("tomorrow", "Thursday afternoon") are still the caller's words and
 * are still stored, exactly as they were before this existed.
 */
export function sanitisePreferredDatetime(
  value: string | null | undefined
): CallbackTiming {
  const text = value?.trim() ?? "";
  if (!text) return { preferredDatetime: null, urgency: null };
  if (isUrgencyOnlyTiming(text)) {
    return { preferredDatetime: null, urgency: text };
  }
  return { preferredDatetime: text, urgency: null };
}
