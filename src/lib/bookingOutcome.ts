import type { LeadIntent, UnavailableReason } from "@/lib/leadCapture";

// ── Telling the reply model what actually happened ────────────────
//
// The chat routes run TWO independent model calls: one extracts the
// intent (which drives the mutation), and one writes the customer's
// reply. Only the first ever learned the outcome.
//
// Everything the reply model was given about a booking was NEGATIVE:
// `unavailableReason` and `suggestedAlternativeIso` — i.e. why it could
// NOT be done. On the success path it was told nothing at all: not that
// an appointment existed, not that it had just been moved, not to what
// time. It was left to infer the outcome from the customer's own words,
// with a rule saying "never say you cannot change a booking".
//
// A negative constraint is not a fact. On 2026-08-08 a live widget
// reschedule proved it: the appointment moved, the Google event moved,
// and the reply said "I'm sorry, but I can't change or update
// appointments." The customer was told the opposite of what happened.
//
// This module produces the missing fact. It states what was actually
// persisted, so the reply is grounded in the mutation rather than
// guessing at it.

export interface BookingOutcome {
  /** The intent the mutation was carried out under. */
  intent: LeadIntent;
  /** Whether the lead genuinely ended up confirmed. */
  booked: boolean;
  /** The appointment instant now stored, when there is one. */
  appointmentIso: string | null;
  /** Set when the request could NOT be honoured. Suppresses the note. */
  unavailableReason: UnavailableReason;
  /** The business's IANA zone. */
  timezone?: string;
}

function formatWhen(iso: string, timezone: string): string | null {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(when);
}

/**
 * The prompt section stating what was actually done, or null when there
 * is nothing truthful to state.
 *
 * Returns null — deliberately — whenever the outcome is anything other
 * than a completed booking or reschedule. It must never manufacture a
 * confirmation:
 *
 *   - `unavailableReason` set  the request was refused. The existing
 *                              Availability Note already tells the model
 *                              what to say, and it must not be
 *                              contradicted here.
 *   - `booked` false           nothing was confirmed, so nothing is
 *                              claimed.
 *   - no appointment instant   there is no time to state, and inventing
 *                              one is the failure mode this exists to
 *                              prevent.
 *
 * Only `new_booking` and `reschedule` produce a note. `contact_update`
 * deliberately does not: it can complete a booking begun in an earlier
 * turn, but the customer's message was about their details, and an
 * unprompted "your appointment is confirmed" reads as a non-sequitur.
 * Under-stating is safe; over-stating is not.
 */
export function buildBookingOutcomeNote(
  outcome: BookingOutcome
): string | null {
  if (outcome.unavailableReason) return null;
  if (!outcome.booked) return null;
  if (!outcome.appointmentIso) return null;
  if (outcome.intent !== "new_booking" && outcome.intent !== "reschedule") {
    return null;
  }

  const when = formatWhen(
    outcome.appointmentIso,
    outcome.timezone || "Europe/London"
  );
  if (!when) return null;

  const moved = outcome.intent === "reschedule";

  return [
    "## What has just happened",
    moved
      ? `The customer's appointment HAS BEEN MOVED and is now ${when}. This change is already saved.`
      : `The customer's appointment IS NOW BOOKED for ${when}. This is already saved.`,
    moved
      ? "Confirm the NEW time back to them warmly and briefly. You DID change their appointment — never apologise for being unable to, never say you cannot change or update a booking, and never suggest a team member has to do it instead."
      : "Confirm that time back to them warmly and briefly.",
    "State this time exactly as written above. Do not restate it in another timezone, and do not offer a different time.",
  ].join("\n");
}

// ── Asking for the one detail that is missing ─────────────────────
//
// The deterministic parser refuses to guess: "20/08/26" with no time,
// or an impossible date like 32/08, resolves to no instant at all and
// raises needsClarification. That flag was produced and then dropped on
// the floor, so the customer got whatever the reply model improvised —
// usually a generic question, sometimes a confirmation of a booking
// that did not exist.
//
// This states the gap precisely. It is deliberately NOT built from an
// availability, calendar or lookup outcome: those are refusals of a
// time we did understand, and the Availability Note above speaks for
// them. This one means we never had a time at all.

export interface DatetimeClarification {
  /** Set by the datetime parser alone. */
  needsClarification: boolean;
  /** The date we understood, when only the time is missing. */
  clarificationDate: string | null;
}

/**
 * The prompt section asking for the missing piece, or null when nothing
 * needs asking.
 *
 * The date is stated as the PARSER resolved it, never left to the reply
 * model to restate: "20/08/26" is exactly the string a model re-reads as
 * 26 August or 2020, and having refused to guess it in code we must not
 * hand it back for guessing in prose.
 */
export function buildDatetimeClarificationNote(
  clarification: DatetimeClarification
): string | null {
  if (!clarification.needsClarification) return null;

  if (clarification.clarificationDate) {
    return [
      "## Missing appointment detail",
      `The customer named a date — ${clarification.clarificationDate} — but no time of day. Nothing has been booked and no availability has been checked, because there is no time to check.`,
      `In your reply, ask ONLY which time on ${clarification.clarificationDate} they would like.`,
      `State that date exactly as written here. Do not re-read, re-format or recalculate it from anything earlier in the conversation, and do not state a year, weekday or month that differs from it.`,
      "Do not suggest, assume or default to a time. Do not say the appointment is booked, confirmed or held.",
      "Do not ask for their name, phone number, email or address in this reply — the time comes first, and those details make no difference to whether a slot is free.",
    ].join("\n");
  }

  return [
    "## Missing appointment detail",
    "The customer gave a date that could not be read as a real calendar date, so nothing has been booked and no availability has been checked.",
    "In your reply, ask them politely to confirm the date they meant, and the time of day, as one short question.",
    "Do not guess which date they meant, and do not offer one. Do not say the appointment is booked, confirmed or held.",
    "Do not ask for their name, phone number, email or address in this reply.",
  ].join("\n");
}
