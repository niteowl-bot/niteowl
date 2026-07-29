// ─────────────────────────────────────────────────────────────
//  Booking status invariant (dependency-free, unit-testable)
//
//  The calendar renders a lead as an appointment ONLY when its
//  appointment_datetime is set — src/app/(dashboard)/calendar/page.tsx
//  filters `.not("appointment_datetime", "is", null)`. So a lead whose
//  status is "booked" but whose appointment_datetime is null is a
//  booking the customer/owner believe is confirmed, yet which never
//  appears on the calendar.
//
//  Rule enforced everywhere: **booked ⇒ a valid appointment timestamp.**
//  This module is the single source of truth, used by the chat
//  lead-capture flow and mirrored by the leads API + a DB CHECK
//  constraint (docs/sql/2026-07-29_leads_booked_requires_appointment.sql).
// ─────────────────────────────────────────────────────────────

export type LeadStatusValue =
  | "new"
  | "awaiting_confirmation"
  | "contacted"
  | "qualified"
  | "booked"
  | "lost"
  | "cancelled"
  | "needs_review";

/** True only for a non-empty string that parses to a real date. */
export function isValidAppointmentIso(iso: string | null | undefined): boolean {
  if (!iso || typeof iso !== "string") return false;
  return !Number.isNaN(new Date(iso).getTime());
}

/**
 * Enforces "booked ⇒ valid appointment timestamp". If a computed status
 * is "booked" without a valid appointment ISO, it is downgraded to
 * "needs_review" so a human confirms the time — the stored status and the
 * calendar can never disagree.
 */
export function enforceBookedInvariant<S extends LeadStatusValue>(
  status: S,
  appointmentIso: string | null | undefined
): S | "needs_review" {
  if (status === "booked" && !isValidAppointmentIso(appointmentIso)) {
    return "needs_review";
  }
  return status;
}
