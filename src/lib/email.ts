import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";

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
  const displayName = customerName?.trim() || "there";
  const manageUrl = manageToken
    ? `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/booking/manage?token=${manageToken}`
    : null;

  // Customer confirmation
  if (customerEmail) {
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: customerEmail,
        subject: `Booking confirmed with ${businessName}`,
        html: `
          <p>Hi ${displayName},</p>
          <p>Your booking with <strong>${businessName}</strong> is confirmed.</p>
          <p>
            <strong>Date & time:</strong> ${formattedDate}<br/>
            ${serviceNeeded ? `<strong>Service:</strong> ${serviceNeeded}<br/>` : ""}
            <strong>Booking reference:</strong> ${bookingReference}
          </p>
          ${
            manageUrl
              ? `<p>Need to make changes? <a href="${manageUrl}">Cancel or reschedule your booking</a>.</p>`
              : `<p>If you need to make any changes, please contact ${businessName} directly.</p>`
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
      await resend.emails.send({
        from: FROM_EMAIL,
        to: businessOwnerEmail,
        subject: `New booking: ${displayName} — ${formattedDate}`,
        html: `
          <p>You have a new booking.</p>
          <p>
            <strong>Customer:</strong> ${displayName}<br/>
            ${customerEmail ? `<strong>Email:</strong> ${customerEmail}<br/>` : ""}
            <strong>Date & time:</strong> ${formattedDate}<br/>
            ${serviceNeeded ? `<strong>Service:</strong> ${serviceNeeded}<br/>` : ""}
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
    businessName,
    customerName,
    customerEmail,
    customerPhone,
    question,
    conversationContext,
    leadId,
  } = params;

  if (!businessOwnerEmail) {
    console.error(
      "[email] No business owner email available — skipped needs-review notification."
    );
    return false;
  }

  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/leads`;
  const displayName = customerName?.trim() || "A customer";

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: businessOwnerEmail,
      subject: "Customer enquiry requires review",
      html: `
        <p>Customer enquiry requires review.</p>
        <p>
          <strong>From:</strong> ${displayName}<br/>
          ${customerEmail ? `<strong>Email:</strong> ${customerEmail}<br/>` : ""}
          ${customerPhone ? `<strong>Phone:</strong> ${customerPhone}<br/>` : ""}
        </p>
        <p><strong>Question:</strong> ${question}</p>
        ${conversationContext ? `<p><strong>Context:</strong> ${conversationContext}</p>` : ""}
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

  const displayName = customerName?.trim() || "A customer";
  const formattedPrevious = formatAppointmentDate(previousDatetime);
  const subject =
    action === "cancelled"
      ? `Booking cancelled: ${displayName} — ${formattedPrevious}`
      : `Booking rescheduled: ${displayName}`;

  const bodyDetail =
    action === "cancelled"
      ? `<p><strong>${displayName}</strong> has cancelled their booking for <strong>${formattedPrevious}</strong>.</p>`
      : `<p><strong>${displayName}</strong> has rescheduled their booking from <strong>${formattedPrevious}</strong> to <strong>${formatAppointmentDate(
          newDatetime ?? previousDatetime
        )}</strong>.</p>`;

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: businessOwnerEmail,
      subject,
      html: `
        ${bodyDetail}
        <p>
          ${customerEmail ? `<strong>Email:</strong> ${customerEmail}<br/>` : ""}
          ${customerPhone ? `<strong>Phone:</strong> ${customerPhone}<br/>` : ""}
          ${serviceNeeded ? `<strong>Service:</strong> ${serviceNeeded}<br/>` : ""}
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
