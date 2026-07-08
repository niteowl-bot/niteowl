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
        html: `
          <p>Hi ${displayName},</p>
          <p>Your booking with <strong>${safeBusinessName}</strong> is confirmed.</p>
          <p>
            <strong>Date & time:</strong> ${formattedDate}<br/>
            ${safeService ? `<strong>Service:</strong> ${safeService}<br/>` : ""}
            <strong>Booking reference:</strong> ${bookingReference}
          </p>
          ${
            manageUrl
              ? `<p>Need to make changes? <a href="${manageUrl}">Cancel or reschedule your booking</a>.</p>`
              : `<p>If you need to make any changes, please contact ${safeBusinessName} directly.</p>`
          }
        `,
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
        html: `
          <p>You have a new booking.</p>
          <p>
            <strong>Customer:</strong> ${displayName}<br/>
            ${safeCustomerEmail ? `<strong>Email:</strong> ${safeCustomerEmail}<br/>` : ""}
            <strong>Date & time:</strong> ${formattedDate}<br/>
            ${safeService ? `<strong>Service:</strong> ${safeService}<br/>` : ""}
            <strong>Booking reference:</strong> ${bookingReference}
          </p>
        `,
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
      subject: "Customer enquiry requires review",
      html: `
        <p>Customer enquiry requires review.</p>
        <p>
          <strong>From:</strong> ${displayName}<br/>
          ${safeEmail ? `<strong>Email:</strong> ${safeEmail}<br/>` : ""}
          ${safePhone ? `<strong>Phone:</strong> ${safePhone}<br/>` : ""}
        </p>
        <p><strong>Question:</strong> ${safeQuestion}</p>
        ${safeContext ? `<p><strong>Context:</strong> ${safeContext}</p>` : ""}
        <p><a href="${dashboardUrl}">View this lead in your dashboard</a></p>
      `,
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
      ? `<p><strong>${displayName}</strong> has cancelled their booking for <strong>${formattedPrevious}</strong>.</p>`
      : `<p><strong>${displayName}</strong> has rescheduled their booking from <strong>${formattedPrevious}</strong> to <strong>${formatAppointmentDate(
          newDatetime ?? previousDatetime
        )}</strong>.</p>`;

  try {
    await sendChecked({
      from: FROM_EMAIL,
      to: businessOwnerEmail,
      subject,
      html: `
        ${bodyDetail}
        <p>
          ${safeEmail ? `<strong>Email:</strong> ${safeEmail}<br/>` : ""}
          ${safePhone ? `<strong>Phone:</strong> ${safePhone}<br/>` : ""}
          ${safeService ? `<strong>Service:</strong> ${safeService}<br/>` : ""}
          <strong>Booking reference:</strong> ${bookingReference}
        </p>
      `,
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
      html: `
        <p>A visitor completed the sales chat on the marketing site.</p>
        <p>
          <strong>Name:</strong> ${displayName}<br/>
          ${safeEmail ? `<strong>Email:</strong> ${safeEmail}<br/>` : ""}
          ${safePhone ? `<strong>Phone:</strong> ${safePhone}<br/>` : ""}
          ${safeCompany ? `<strong>Company:</strong> ${safeCompany}<br/>` : ""}
          ${safeIndustry ? `<strong>Industry:</strong> ${safeIndustry}<br/>` : ""}
          ${safeDemoTime ? `<strong>Preferred demo time:</strong> ${safeDemoTime}<br/>` : ""}
        </p>
      `,
    });
    console.log("[sales notification diagnostic] sendChecked succeeded — resend id:", data?.id ?? "(no id)");
    return true;
  } catch (err) {
    console.error("[email] Failed to send sales lead notification:", err);
    return false;
  }
}
