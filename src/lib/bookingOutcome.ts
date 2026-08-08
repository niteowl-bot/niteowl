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
