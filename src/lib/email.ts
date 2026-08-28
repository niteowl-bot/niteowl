import { Resend } from "resend";
import { DEFAULT_ORG_TIMEZONE, isValidTimezone } from "@/lib/calendar/timezone";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";

// All values below originate from customer/visitor chat input (directly
// or via AI extraction) and are interpolated into HTML email bodies sent
// to real business owners' inboxes — escape before interpolating, or a
// message like `Need a quote<a href="...">Sign in</a>` renders as live
// HTML in a notification email the recipient trusts.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Shared branded layout ─────────────────────────────────────────
// Every email below renders its own <p> markup through this wrapper, so
// all customer- and owner-facing emails share one consistent look
// (wordmark, card, footer) instead of five slightly different bare
// templates. Light theme and inline styles are deliberate — email
// clients (Outlook especially) render inline styles far more reliably
// than embedded <style> blocks or dark-background HTML, regardless of
// the product's own dark dashboard theme.
function renderEmailLayout(bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:520px;margin:0 auto;padding:32px 16px;">
      <div style="text-align:center;margin-bottom:20px;">
        <span style="display:inline-block;width:26px;height:26px;border-radius:8px;background:#2563eb;color:#ffffff;line-height:26px;font-weight:700;font-size:13px;vertical-align:middle;">N</span>
        <span style="font-size:15px;font-weight:600;color:#111827;margin-left:8px;vertical-align:middle;">Niteowl <span style="color:#9ca3af;">AI</span></span>
      </div>
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:28px;color:#1f2937;font-size:14px;line-height:1.65;">
        ${bodyHtml}
      </div>
      <p style="text-align:center;color:#9ca3af;font-size:12px;line-height:1.6;margin-top:20px;">
        Sent by Remy, your AI receptionist.<br/>
        <a href="https://niteowlhq.com/privacy" style="color:#9ca3af;text-decoration:underline;">Privacy Policy</a>
      </p>
    </div>
  </body>
</html>`;
}

// Small reusable pieces so every email's "details" block reads the
// same way instead of five subtly different <p><strong> layouts.
function emailButton(url: string, label: string): string {
  return `<p style="margin:20px 0 4px;"><a href="${url}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 20px;border-radius:10px;">${label}</a></p>`;
}

function detailsBlock(rows: Array<[string, string] | null>): string {
  const cells = rows
    .filter((r): r is [string, string] => r !== null)
    .map(
      ([label, value]) =>
        `<tr><td style="padding:3px 12px 3px 0;color:#6b7280;white-space:nowrap;">${label}</td><td style="padding:3px 0;color:#111827;font-weight:500;">${value}</td></tr>`
    )
    .join("");
  return `<table style="border-collapse:collapse;font-size:14px;margin:14px 0;">${cells}</table>`;
}

// The Resend SDK resolves with { data, error } on API-level failures
// (invalid key, unverified sender, etc.) rather than throwing — a bare
// `await resend.emails.send(...)` inside try/catch silently treats
// those as success, since nothing ever throws. Every call site must
// check `error` explicitly and surface it as a real thrown error so
// the existing try/catch (and any caller relying on it) actually sees
// the failure instead of assuming it was sent.
async function sendChecked(params: Parameters<typeof resend.emails.send>[0]) {
  const { data, error } = await resend.emails.send(params);
  if (error) {
    throw new Error(`Resend API error: ${error.name} — ${error.message}`);
  }
  return data;
}

interface BookingConfirmationParams {
  customerName: string | null;
  customerEmail: string | null;
  businessName: string;
  businessOwnerEmail: string | null;
  appointmentDatetime: string; // ISO string
  bookingReference: string;
  serviceNeeded?: string | null;
  manageToken?: string | null;
  /**
   * The organisation's IANA zone, from getOrgOwnerEmail — which already
   * reads `organisations` for the recipient, so this costs no query.
   * Optional so every existing caller keeps its exact behaviour.
   */
  timezone?: string | null;
}

/**
 * Renders a stored UTC instant on the BUSINESS's clock.
 *
 * The zone was hardcoded to Europe/London, which is right for a UK or
 * Irish business and wrong for every other one: a Dubai booking stored
 * (correctly) as 10:00Z was announced to the customer as 11:00 rather
 * than 14:00, and a New York evening appointment shifted onto the wrong
 * DAY. The instant itself has always been right — only this rendering
 * of it was not.
 *
 * FAILS SOFT, deliberately, and unlike the booking write paths. Those
 * refuse rather than store a time nobody can vouch for; this is a
 * notification, and an email in the default zone beats no email telling
 * a business someone booked. An unusable zone therefore falls back to
 * the column default, and the try/catch stays as a last resort so no
 * send can fail on a formatting problem.
 *
 * Locale stays "en-GB": that is date WORDING (day before month, 24-hour
 * clock), not a timezone, and every existing email reads that way.
 */
function formatAppointmentDate(iso: string, timezone?: string | null): string {
  const zone =
    timezone && isValidTimezone(timezone) ? timezone : DEFAULT_ORG_TIMEZONE;
  try {
    return new Date(iso).toLocaleString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: zone,
    });
  } catch {
    return iso;
  }
}

export async function sendBookingConfirmationEmails(
  params: BookingConfirmationParams
): Promise<void> {
  const {
    customerName,
    customerEmail,
    businessName,
    businessOwnerEmail,
    appointmentDatetime,
    bookingReference,
    serviceNeeded,
    manageToken,
    timezone,
  } = params;

  const formattedDate = formatAppointmentDate(appointmentDatetime, timezone);
  const displayName = escapeHtml(customerName?.trim() || "there");
  const safeBusinessName = escapeHtml(businessName);
  const safeService = serviceNeeded ? escapeHtml(serviceNeeded) : null;
  const safeCustomerEmail = customerEmail ? escapeHtml(customerEmail) : null;
  const manageUrl = manageToken
    ? `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/booking/manage?token=${manageToken}`
    : null;

  // Customer confirmation
  if (customerEmail) {
    try {
      await sendChecked({
        from: FROM_EMAIL,
        to: customerEmail,
        subject: `Booking confirmed with ${businessName}`,
        html: renderEmailLayout(`
          <p style="margin:0 0 14px;">Hi ${displayName},</p>
          <p style="margin:0 0 4px;">Good news — your booking with <strong>${safeBusinessName}</strong> is confirmed.</p>
          ${detailsBlock([
            ["Date & time", formattedDate],
            safeService ? ["Service", safeService] : null,
            ["Reference", bookingReference],
          ])}
          ${
            manageUrl
              ? emailButton(manageUrl, "Cancel or reschedule")
              : `<p style="margin:14px 0 0;">Need to make changes? Contact ${safeBusinessName} directly.</p>`
          }
        `),
      });
    } catch (err) {
      console.error("[email] Failed to send customer confirmation:", err);
    }
  } else {
    console.error(
      "[email] No customer email available — skipped customer confirmation."
    );
  }

  // Business owner notification
  if (businessOwnerEmail) {
    try {
      await sendChecked({
        from: FROM_EMAIL,
        to: businessOwnerEmail,
        subject: `New booking: ${displayName} — ${formattedDate}`,
        html: renderEmailLayout(`
          <p style="margin:0 0 4px;">You've got a new booking via Remy.</p>
          ${detailsBlock([
            ["Customer", displayName],
            safeCustomerEmail ? ["Email", safeCustomerEmail] : null,
            ["Date & time", formattedDate],
            safeService ? ["Service", safeService] : null,
            ["Reference", bookingReference],
          ])}
        `),
      });
    } catch (err) {
      console.error("[email] Failed to send business notification:", err);
    }
  } else {
    console.error(
      "[email] No business owner email available — skipped business notification."
    );
  }
}
interface NeedsReviewNotificationParams {
  businessOwnerEmail: string | null;
  businessName: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  question: string;
  escalationReason?: string | null;
  conversationContext?: string | null;
  leadId: string | null;
}

/**
 * Returns true only when the email was accepted by Resend, so callers
 * can safely record that the notification has been sent.
 */
export async function sendNeedsReviewNotification(
  params: NeedsReviewNotificationParams
): Promise<boolean> {
  const {
    businessOwnerEmail,
    customerName,
    customerEmail,
    customerPhone,
    question,
    escalationReason,
    conversationContext,
  } = params;

  if (!businessOwnerEmail) {
    console.error(
      "[email] No business owner email available — skipped needs-review notification."
    );
    return false;
  }

  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/leads`;
  const displayName = escapeHtml(customerName?.trim() || "A customer");
  const safeEmail = customerEmail ? escapeHtml(customerEmail) : null;
  const safePhone = customerPhone ? escapeHtml(customerPhone) : null;
  const safeQuestion = escapeHtml(question);
  const safeReason = escapeHtml(
    escalationReason?.trim() || "Confidence below threshold — Remy could not confidently answer this customer."
  );
  const safeTranscript = conversationContext
    ? escapeHtml(conversationContext).replace(/\n/g, "<br/>")
    : null;

  try {
    await sendChecked({
      from: FROM_EMAIL,
      to: businessOwnerEmail,
      subject: `A customer needs your input${customerName ? ` — ${customerName.trim()}` : ""}`,
      html: renderEmailLayout(`
        <p style="margin:0 0 4px;">Remy couldn't confidently answer a customer's question, so it's been flagged for you to follow up personally.</p>
        <p style="margin:8px 0 0;"><strong>Why Remy escalated:</strong> ${safeReason}</p>
        ${detailsBlock([
          ["From", displayName],
          safeEmail ? ["Email", safeEmail] : null,
          safePhone ? ["Phone", safePhone] : null,
        ])}
        <p style="margin:14px 0 0;"><strong>Their question:</strong><br/>${safeQuestion}</p>
        ${
          safeTranscript
            ? `<p style="margin:16px 0 0;padding-top:14px;border-top:1px solid #e5e7eb;"><strong>Conversation transcript:</strong><br/>${safeTranscript}</p>`
            : ""
        }
        ${emailButton(dashboardUrl, "View in your dashboard")}
      `),
    });
    return true;
  } catch (err) {
    console.error("[email] Failed to send needs-review notification:", err);
    return false;
  }
}

interface BookingSelfServiceChangeParams {
  businessOwnerEmail: string | null;
  /**
   * For the CUSTOMER's copy, which names the business it is about.
   * Null when the organisation could not be resolved — the customer
   * still gets a truthful email, worded without the name rather than
   * withheld over a missing label.
   */
  businessName?: string | null;
  /**
   * The manage-link token, so a RESCHEDULED customer gets a working
   * link again and the new email supersedes the stale one. Deliberately
   * unused for a cancellation: that lead is no longer "booked", so the
   * route refuses the link and offering it would be a dead end.
   */
  manageToken?: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  serviceNeeded?: string | null;
  bookingReference: string;
  action: "cancelled" | "rescheduled";
  previousDatetime: string;
  newDatetime?: string; // required when action is "rescheduled"
  /** The organisation's IANA zone — see BookingConfirmationParams. */
  timezone?: string | null;
}

/**
 * Tells BOTH sides that a customer changed their own booking through the
 * self-service manage-booking link.
 *
 * - the CUSTOMER gets confirmation of what they just did. Until this
 *   existed they saw an on-screen message and nothing else, and after a
 *   reschedule the only email they held still stated the OLD time.
 * - the BUSINESS OWNER gets the same notice as before, so the calendar
 *   change isn't a surprise they only discover by checking the dashboard.
 *
 * THE TWO SENDS ARE INDEPENDENT. Each has its own try/catch, so one
 * recipient's failure never suppresses the other's — a customer inbox
 * rejecting mail must not cost the owner their notification, and vice
 * versa.
 *
 * This is a NOTIFICATION, sent after settlement. It is never what makes
 * a change true: the caller has already persisted the cancellation, or
 * completed the calendar move and the local write, before calling here.
 * A send failure is logged and swallowed — it must never roll back
 * booking or calendar state.
 */
export async function sendBookingSelfServiceChangeNotification(
  params: BookingSelfServiceChangeParams
): Promise<{ customer: boolean; owner: boolean }> {
  const {
    businessOwnerEmail,
    businessName,
    manageToken,
    customerName,
    customerEmail,
    customerPhone,
    serviceNeeded,
    bookingReference,
    action,
    previousDatetime,
    newDatetime,
    timezone,
  } = params;

  const result = { customer: false, owner: false };

  const displayName = escapeHtml(customerName?.trim() || "A customer");
  const safeEmail = customerEmail ? escapeHtml(customerEmail) : null;
  const safePhone = customerPhone ? escapeHtml(customerPhone) : null;
  const safeService = serviceNeeded ? escapeHtml(serviceNeeded) : null;
  const formattedPrevious = formatAppointmentDate(previousDatetime, timezone);
  const subject =
    action === "cancelled"
      ? `Booking cancelled: ${customerName?.trim() || "A customer"} — ${formattedPrevious}`
      : `Booking rescheduled: ${customerName?.trim() || "A customer"}`;

  const bodyDetail =
    action === "cancelled"
      ? `<p style="margin:0 0 4px;"><strong>${displayName}</strong> has cancelled their booking for <strong>${formattedPrevious}</strong>.</p>`
      : `<p style="margin:0 0 4px;"><strong>${displayName}</strong> has rescheduled their booking from <strong>${formattedPrevious}</strong> to <strong>${formatAppointmentDate(
          newDatetime ?? previousDatetime,
          timezone
        )}</strong>.</p>`;

  // ── The customer's copy ──────────────────────────────────────────
  //
  // Skipped cleanly when there is no address to send to: a booking taken
  // by phone often has none, and that is not an error.
  if (customerEmail) {
    const greetName = escapeHtml(customerName?.trim() || "there");
    const safeBusiness = businessName?.trim()
      ? escapeHtml(businessName.trim())
      : null;
    const withBusiness = safeBusiness ? ` with <strong>${safeBusiness}</strong>` : "";
    const subjectSuffix = safeBusiness ? ` — ${businessName!.trim()}` : "";
    const formattedNew =
      action === "rescheduled"
        ? formatAppointmentDate(newDatetime ?? previousDatetime, timezone)
        : null;

    // The manage link is offered ONLY on a reschedule. After a
    // cancellation the lead is no longer "booked" and the route refuses
    // it (bookings/manage rejects any status but booked), so the link
    // would be a dead end.
    const manageUrl =
      action === "rescheduled" && manageToken
        ? `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/booking/manage?token=${manageToken}`
        : null;

    const customerBody =
      action === "cancelled"
        ? `
          <p style="margin:0 0 14px;">Hi ${greetName},</p>
          <p style="margin:0 0 4px;">Your booking${withBusiness} has been cancelled.</p>
          ${detailsBlock([
            ["Cancelled appointment", formattedPrevious],
            safeService ? ["Service", safeService] : null,
            ["Reference", bookingReference],
          ])}
        `
        : `
          <p style="margin:0 0 14px;">Hi ${greetName},</p>
          <p style="margin:0 0 4px;">Your booking${withBusiness} has been moved. This replaces the time we sent you previously.</p>
          ${detailsBlock([
            ["New date & time", formattedNew!],
            ["Previous time", formattedPrevious],
            safeService ? ["Service", safeService] : null,
            ["Reference", bookingReference],
          ])}
          ${manageUrl ? emailButton(manageUrl, "Cancel or reschedule") : ""}
        `;

    try {
      await sendChecked({
        from: FROM_EMAIL,
        to: customerEmail,
        subject:
          action === "cancelled"
            ? `Booking cancelled${subjectSuffix}`
            : `Booking rescheduled${subjectSuffix} — ${formattedNew}`,
        html: renderEmailLayout(customerBody),
      });
      result.customer = true;
    } catch (err) {
      console.error("[email] Failed to send customer self-service change email:", err);
    }
  }

  // ── The owner's copy — unchanged behaviour ───────────────────────
  if (!businessOwnerEmail) {
    console.error(
      "[email] No business owner email available — skipped self-service change notification."
    );
    return result;
  }

  try {
    await sendChecked({
      from: FROM_EMAIL,
      to: businessOwnerEmail,
      subject,
      html: renderEmailLayout(`
        ${bodyDetail}
        ${detailsBlock([
          safeEmail ? ["Email", safeEmail] : null,
          safePhone ? ["Phone", safePhone] : null,
          safeService ? ["Service", safeService] : null,
          ["Reference", bookingReference],
        ])}
      `),
    });
    result.owner = true;
  } catch (err) {
    console.error("[email] Failed to send self-service change notification:", err);
  }

  return result;
}

interface SalesLeadNotificationParams {
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  industry: string | null;
  preferredDemoTime: string | null;
}

/**
 * Notifies the NiteOwl team when a sales-chat prospect completes all
 * required fields. Separate from sendNeedsReviewNotification, which
 * notifies a TENANT business owner about their own customer — this
 * always goes to the NiteOwl team, not a business's owner_id.
 */
export async function sendSalesLeadNotification(
  params: SalesLeadNotificationParams
): Promise<boolean> {
  const { name, email, phone, company, industry, preferredDemoTime } = params;
  const notifyEmail = process.env.SALES_NOTIFICATION_EMAIL;

  console.log(
    "[sales notification diagnostic] recipient:",
    notifyEmail ?? "(unset)",
    "| from:",
    FROM_EMAIL
  );

  if (!notifyEmail) {
    console.error("[email] SALES_NOTIFICATION_EMAIL not set — skipped sales lead notification.");
    return false;
  }

  const displayName = escapeHtml(name?.trim() || "A prospect");
  const safeEmail = email ? escapeHtml(email) : null;
  const safePhone = phone ? escapeHtml(phone) : null;
  const safeCompany = company ? escapeHtml(company) : null;
  const safeIndustry = industry ? escapeHtml(industry) : null;
  const safeDemoTime = preferredDemoTime ? escapeHtml(preferredDemoTime) : null;

  try {
    const data = await sendChecked({
      from: FROM_EMAIL,
      to: notifyEmail,
      subject: `New sales lead: ${name?.trim() || "A prospect"}${company ? ` — ${company}` : ""}`,
      html: renderEmailLayout(`
        <p style="margin:0 0 4px;">A visitor completed the sales chat on the marketing site.</p>
        ${detailsBlock([
          ["Name", displayName],
          safeEmail ? ["Email", safeEmail] : null,
          safePhone ? ["Phone", safePhone] : null,
          safeCompany ? ["Company", safeCompany] : null,
          safeIndustry ? ["Industry", safeIndustry] : null,
          safeDemoTime ? ["Preferred demo time", safeDemoTime] : null,
        ])}
      `),
    });
    console.log("[sales notification diagnostic] sendChecked succeeded — resend id:", data?.id ?? "(no id)");
    return true;
  } catch (err) {
    console.error("[email] Failed to send sales lead notification:", err);
    return false;
  }
}

// ── Owner-facing booking status ───────────────────────────────────
//
// What the OWNER is told about an appointment the call produced. Voice
// settles the calendar AFTER the call ends, so until PR #23 the summary
// email read identically whether the appointment reached the business's
// diary or was only ever a request. Once a phone call could genuinely
// book (proven in production 2026-08-26), that ambiguity became a
// business risk in the expensive direction: an owner who assumes a
// booking is a request may ring a customer who is already in the diary,
// and one who assumes the reverse misses the job entirely.
export type OwnerBookingStatus =
  | "booked"
  | "awaiting_confirmation"
  | "requires_review";

/**
 * The owner-facing status for a lead's SETTLED status.
 *
 * Deliberately a total function over `string | null | undefined` and
 * deliberately FAIL CLOSED: only the literal "booked" — the status
 * settleCalendarBacking writes when the calendar actually accepted the
 * event — may ever be reported as booked. Every other value, including
 * one this build does not recognise, a read that failed, and null,
 * lands on a wording that asks the owner to check.
 *
 * This is the same rule the booking engine already runs on ("we could
 * not check" is never "it is free"), applied to what the owner is told:
 * an unknown outcome is never a confirmation.
 */
export function ownerBookingStatus(
  leadStatus: string | null | undefined
): OwnerBookingStatus {
  if (leadStatus === "booked") return "booked";
  if (leadStatus === "awaiting_confirmation") return "awaiting_confirmation";
  // needs_review (which is what a conflict, an unreadable calendar or a
  // failed create all settle to), anything unrecognised, and null.
  return "requires_review";
}

const BOOKING_STATUS_COPY: Record<
  OwnerBookingStatus,
  { label: string; note: string; colour: string }
> = {
  booked: {
    label: "BOOKED",
    note: "Booked in the calendar — no manual confirmation needed.",
    colour: "#047857",
  },
  awaiting_confirmation: {
    label: "AWAITING CONFIRMATION",
    note: "This appointment has not been confirmed in the calendar yet.",
    colour: "#b45309",
  },
  requires_review: {
    label: "REQUIRES REVIEW",
    note: "The requested appointment was not confirmed in the calendar.",
    colour: "#b91c1c",
  },
};

interface CallSummaryParams {
  businessOwnerEmail: string | null;
  businessName: string;
  /** Network caller ID — the number the call actually came from. */
  callerPhone: string | null;
  /** A different number the caller asked to be reached on, if any. */
  alternatePhone?: string | null;
  /**
   * What the caller said when asked WHEN to ring them back, in cases
   * where that answer carried urgency and no usable day or time —
   * "as soon as possible" and the like. Never a date and never a time:
   * sanitisePreferredDatetime (voice/callbackTiming.ts) returns either
   * a real timing OR an urgency phrase, never both, so this is only
   * ever set when there is no callback time to show.
   */
  callbackUrgency?: string | null;
  callerName: string | null;
  startedAt: string | null; // ISO string
  durationSeconds: number | null;
  summary: string | null;
  transcript: string | null;
  leadCreated: boolean;
  /**
   * The SETTLED outcome of an appointment this call produced, or null
   * when the call produced no appointment at all (a question, a
   * callback request, an enquiry with no time).
   *
   * Null omits the status block entirely rather than defaulting to a
   * wording: a callback has no booking to report, and telling its owner
   * an appointment "requires review" would invent one. Callers must
   * derive this from the lead's settled status — never from whether an
   * appointment date exists.
   */
  bookingStatus?: OwnerBookingStatus | null;
  /** The organisation's IANA zone — see BookingConfirmationParams. */
  timezone?: string | null;
}

function formatCallDuration(durationSeconds: number | null): string | null {
  if (durationSeconds === null || durationSeconds < 0) return null;
  const mins = Math.floor(durationSeconds / 60);
  const secs = Math.round(durationSeconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

/**
 * Emails the business owner a summary of a completed Remy phone call
 * (Voice AI). Same recipient-resolution model as the needs-review
 * notification: the caller passes the owner email from
 * getOrgOwnerEmail. Summary and transcript are AI/caller-derived
 * text, so everything is escaped. Returns true only when Resend
 * accepted the email.
 */
export async function sendCallSummaryEmail(
  params: CallSummaryParams
): Promise<boolean> {
  const {
    businessOwnerEmail,
    businessName,
    callerPhone,
    alternatePhone,
    callerName,
    startedAt,
    durationSeconds,
    summary,
    transcript,
    leadCreated,
    callbackUrgency,
    bookingStatus,
    timezone,
  } = params;

  if (!businessOwnerEmail) {
    console.error(
      "[email] No business owner email available — skipped call summary."
    );
    return false;
  }

  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/leads`;
  const displayCaller = escapeHtml(
    callerName?.trim() || callerPhone?.trim() || "Unknown caller"
  );
  const safePhone = callerPhone ? escapeHtml(callerPhone) : null;
  const safeAlternatePhone = alternatePhone?.trim()
    ? escapeHtml(alternatePhone.trim())
    : null;
  // The caller's own words, never reinterpreted into a time. Escaped
  // like every other caller-supplied value: detailsBlock interpolates
  // raw.
  const safeCallbackUrgency = callbackUrgency?.trim()
    ? escapeHtml(callbackUrgency.trim())
    : null;
  const formattedTime = startedAt
    ? formatAppointmentDate(startedAt, timezone)
    : null;
  const formattedDuration = formatCallDuration(durationSeconds);
  const safeSummary = summary
    ? escapeHtml(summary)
    : "No summary was generated for this call.";

  // Keep long transcripts from bloating the email — the full text is
  // stored in voice_calls; this is just the owner's quick read.
  const TRANSCRIPT_LIMIT = 4000;
  const truncated =
    transcript && transcript.length > TRANSCRIPT_LIMIT
      ? `${transcript.slice(0, TRANSCRIPT_LIMIT)}…`
      : transcript;
  const safeTranscript = truncated
    ? escapeHtml(truncated).replace(/\n/g, "<br/>")
    : null;

  // Absent for every call that produced no appointment, which is what
  // keeps callbacks and general enquiries reading exactly as before.
  const statusCopy = bookingStatus ? BOOKING_STATUS_COPY[bookingStatus] : null;

  try {
    await sendChecked({
      from: FROM_EMAIL,
      to: businessOwnerEmail,
      subject: `Remy answered a call from ${callerName?.trim() || callerPhone?.trim() || "an unknown number"}`,
      html: renderEmailLayout(`
        <p style="margin:0 0 4px;">Remy answered a phone call for ${escapeHtml(businessName)}.</p>
        ${detailsBlock([
          ["Caller", displayCaller],
          // The number the call came from, not one spoken on the call —
          // labelled so the owner knows which they are looking at when
          // both are present.
          safePhone ? ["Caller ID", safePhone] : ["Caller ID", "Withheld"],
          safeAlternatePhone ? ["Alternate number", safeAlternatePhone] : null,
          // Only present when the caller gave urgency INSTEAD of a
          // callback time. Labelled as urgency, never as a time, so it
          // cannot be read as a slot anyone can be rung at.
          safeCallbackUrgency
            ? ["Callback urgency", safeCallbackUrgency]
            : null,
          formattedTime ? ["Time", formattedTime] : null,
          formattedDuration ? ["Duration", formattedDuration] : null,
          statusCopy ? ["Booking status", statusCopy.label] : null,
        ])}
        ${
          statusCopy
            ? `<p style="margin:12px 0 0;color:${statusCopy.colour};"><strong>${statusCopy.note}</strong></p>`
            : ""
        }
        <p style="margin:14px 0 0;"><strong>Summary:</strong><br/>${safeSummary}</p>
        ${
          leadCreated
            ? emailButton(dashboardUrl, "View this lead in your dashboard")
            : `<p style="margin:14px 0 0;color:#6b7280;">No lead was created from this call.</p>`
        }
        ${
          safeTranscript
            ? `<p style="margin:16px 0 0;padding-top:14px;border-top:1px solid #e5e7eb;"><strong>Transcript:</strong><br/>${safeTranscript}</p>`
            : ""
        }
      `),
    });
    return true;
  } catch (err) {
    console.error("[email] Failed to send call summary:", err);
    return false;
  }
}
