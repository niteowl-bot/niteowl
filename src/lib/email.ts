import { Resend } from "resend";

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
}

function formatAppointmentDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/London",
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
  } = params;

  const formattedDate = formatAppointmentDate(appointmentDatetime);
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
  const safeContext = conversationContext ? escapeHtml(conversationContext) : null;

  try {
    await sendChecked({
      from: FROM_EMAIL,
      to: businessOwnerEmail,
      subject: `A customer needs your input${customerName ? ` — ${customerName.trim()}` : ""}`,
      html: renderEmailLayout(`
        <p style="margin:0 0 4px;">Remy couldn't confidently answer a customer's question, so it's been flagged for you to follow up personally.</p>
        ${detailsBlock([
          ["From", displayName],
          safeEmail ? ["Email", safeEmail] : null,
          safePhone ? ["Phone", safePhone] : null,
        ])}
        <p style="margin:14px 0 0;"><strong>Their question:</strong><br/>${safeQuestion}</p>
        ${safeContext ? `<p style="margin:10px 0 0;"><strong>Context:</strong><br/>${safeContext}</p>` : ""}
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
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  serviceNeeded?: string | null;
  bookingReference: string;
  action: "cancelled" | "rescheduled";
  previousDatetime: string;
  newDatetime?: string; // required when action is "rescheduled"
}

/**
 * Notifies the business owner when a customer cancels or reschedules
 * their own booking via the self-service manage-booking link, so the
 * owner's calendar change isn't a surprise they only discover by
 * checking the dashboard.
 */
export async function sendBookingSelfServiceChangeNotification(
  params: BookingSelfServiceChangeParams
): Promise<boolean> {
  const {
    businessOwnerEmail,
    customerName,
    customerEmail,
    customerPhone,
    serviceNeeded,
    bookingReference,
    action,
    previousDatetime,
    newDatetime,
  } = params;

  if (!businessOwnerEmail) {
    console.error(
      "[email] No business owner email available — skipped self-service change notification."
    );
    return false;
  }

  const displayName = escapeHtml(customerName?.trim() || "A customer");
  const safeEmail = customerEmail ? escapeHtml(customerEmail) : null;
  const safePhone = customerPhone ? escapeHtml(customerPhone) : null;
  const safeService = serviceNeeded ? escapeHtml(serviceNeeded) : null;
  const formattedPrevious = formatAppointmentDate(previousDatetime);
  const subject =
    action === "cancelled"
      ? `Booking cancelled: ${customerName?.trim() || "A customer"} — ${formattedPrevious}`
      : `Booking rescheduled: ${customerName?.trim() || "A customer"}`;

  const bodyDetail =
    action === "cancelled"
      ? `<p style="margin:0 0 4px;"><strong>${displayName}</strong> has cancelled their booking for <strong>${formattedPrevious}</strong>.</p>`
      : `<p style="margin:0 0 4px;"><strong>${displayName}</strong> has rescheduled their booking from <strong>${formattedPrevious}</strong> to <strong>${formatAppointmentDate(
          newDatetime ?? previousDatetime
        )}</strong>.</p>`;

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
    return true;
  } catch (err) {
    console.error("[email] Failed to send self-service change notification:", err);
    return false;
  }
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

interface CallSummaryParams {
  businessOwnerEmail: string | null;
  businessName: string;
  callerPhone: string | null;
  callerName: string | null;
  startedAt: string | null; // ISO string
  durationSeconds: number | null;
  summary: string | null;
  transcript: string | null;
  leadCreated: boolean;
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
    callerName,
    startedAt,
    durationSeconds,
    summary,
    transcript,
    leadCreated,
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
  const formattedTime = startedAt ? formatAppointmentDate(startedAt) : null;
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

  try {
    await sendChecked({
      from: FROM_EMAIL,
      to: businessOwnerEmail,
      subject: `Remy answered a call from ${callerName?.trim() || callerPhone?.trim() || "an unknown number"}`,
      html: renderEmailLayout(`
        <p style="margin:0 0 4px;">Remy answered a phone call for ${escapeHtml(businessName)}.</p>
        ${detailsBlock([
          ["Caller", displayCaller],
          safePhone ? ["Number", safePhone] : null,
          formattedTime ? ["Time", formattedTime] : null,
          formattedDuration ? ["Duration", formattedDuration] : null,
        ])}
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
