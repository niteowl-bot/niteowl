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
  } = params;

  const formattedDate = formatAppointmentDate(appointmentDatetime);
  const displayName = customerName?.trim() || "there";

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
          <p>If you need to make any changes, please contact ${businessName} directly.</p>
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
