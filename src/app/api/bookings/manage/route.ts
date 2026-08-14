import { NextRequest, NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrgOwnerEmail } from "@/lib/leadCapture";
import { sendBookingSelfServiceChangeNotification } from "@/lib/email";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  isWithinBusinessHours,
  isSlotAvailable,
  findNextAvailableSlot,
  resolveOrgTimezone,
} from "@/lib/availability";
import {
  cancelAppointmentOnCalendar,
  rescheduleAppointmentOnCalendar,
} from "@/lib/calendarSync";
import {
  DEFAULT_ORG_TIMEZONE,
  isValidTimezone,
  wallClockToInstant,
} from "@/lib/calendar/timezone";

// Public, unauthenticated route — a customer reaches this via the
// manage-booking link in their confirmation email, with no logged-in
// session. Identity is resolved solely via the opaque manage_token
// (same pattern as /api/widget/chat resolving org via widget_key):
// admin client, every query manually scoped by the resolved lead/org.

const LEAD_FIELDS =
  "id, org_id, name, email, phone, service_needed, appointment_datetime, status";

// The wall-clock conversion this route used to own was hardcoded to
// Europe/London and single-pass. Both are now the shared
// wallClockToInstant's problem: it takes the org's IANA zone explicitly
// and settles the offset twice, so a wall time near a DST transition
// lands on the right side of it. Nothing here does offset arithmetic.

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select(LEAD_FIELDS)
    .eq("manage_token", token)
    .maybeSingle();

  if (leadError || !lead) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const { data: org } = await supabase
    .from("organisations")
    .select("business_name, appointment_duration_minutes, emergency_mode_enabled, timezone")
    .eq("id", lead.org_id)
    .maybeSingle();

  // Every wall-clock time on the customer's page is read in this zone —
  // the appointment it shows and the pickers it prefills — so that what
  // the customer sees, and therefore what they send back, is the
  // BUSINESS's clock rather than London's or their own device's.
  //
  // Rides on the organisations read above; no extra round trip. The
  // fallback is deliberately soft, matching getOrgTimezone: a page that
  // cannot render its own appointment is worse than one rendering it in
  // the default zone. The WRITE path is where uncertainty is refused —
  // POST resolves strictly and declines rather than guess.
  const timezone =
    org?.timezone && isValidTimezone(String(org.timezone))
      ? String(org.timezone)
      : DEFAULT_ORG_TIMEZONE;

  const { data: businessHours } = await supabase
    .from("business_hours")
    .select("day_of_week, is_closed, open_time, close_time, lunch_start, lunch_end")
    .eq("org_id", lead.org_id);

  return NextResponse.json({
    status: lead.status,
    appointmentDatetime: lead.appointment_datetime,
    serviceNeeded: lead.service_needed,
    customerName: lead.name,
    businessName: org?.business_name ?? "the business",
    appointmentDurationMinutes: org?.appointment_duration_minutes ?? 60,
    emergencyModeEnabled: org?.emergency_mode_enabled ?? false,
    businessHours: businessHours ?? [],
    timezone,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token, action } = body;

  if (!token || !action) {
    return NextResponse.json({ error: "Missing token or action" }, { status: 400 });
  }

  // Public, token-authenticated — a leaked or guessed manage_token could
  // otherwise trigger unlimited reschedule/cancel notification emails to
  // the business owner with no throttle. Two limits, same shape as the
  // public widget route: one per IP (stops a scripted client), one per
  // token (caps worst-case notification spam even across many IPs).
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  if (!checkRateLimit(`bookings-manage-ip:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!checkRateLimit(`bookings-manage-token:${token}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const supabase = createAdminClient();

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select(LEAD_FIELDS)
    .eq("manage_token", token)
    .maybeSingle();

  if (leadError || !lead) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  if (lead.status !== "booked") {
    return NextResponse.json(
      { error: "This booking can no longer be modified." },
      { status: 400 }
    );
  }

  const bookingReference = lead.id.slice(0, 8).toUpperCase();

  if (action === "cancel") {
    // LOCAL FIRST, deliberately. The local record is the system of
    // record, and a customer must always be able to cancel — so the
    // cancellation is persisted before Google is touched at all.
    //
    // Doing it the other way round created the one failure this design
    // does not accept: the event deleted from the business's calendar
    // while the lead still said "booked", holding the slot internally
    // and showing nothing in the diary. This ordering leaves only the
    // failure that IS accepted — a ghost event, recorded on the link
    // with its error. Note that nothing reads that record today: it is
    // for diagnosis, not a surface the owner can act on.
    const { error: updateError } = await supabase
      .from("leads")
      .update({ status: "cancelled" })
      .eq("id", lead.id);

    if (updateError) {
      return NextResponse.json({ error: "Failed to cancel booking" }, { status: 500 });
    }

    const removed = await cancelAppointmentOnCalendar(lead.org_id, lead.id);
    if (removed.outcome === "failed") {
      console.error(
        `[bookings/manage] lead ${lead.id} is cancelled locally but its calendar event ` +
          `could not be removed — the failure is recorded on the link for diagnosis ` +
          `(not surfaced to the owner today)`
      );
    }

    const ownerInfo = await getOrgOwnerEmail(lead.org_id);
    after(() =>
      sendBookingSelfServiceChangeNotification({
        businessOwnerEmail: ownerInfo?.email ?? null,
        customerName: lead.name,
        customerEmail: lead.email,
        customerPhone: lead.phone,
        serviceNeeded: lead.service_needed,
        bookingReference,
        action: "cancelled",
        previousDatetime: lead.appointment_datetime ?? "",
        timezone: ownerInfo?.timezone ?? null,
      }).catch((err) =>
        console.error("[bookings/manage] Failed to send cancellation notification:", err)
      )
    );

    return NextResponse.json({ success: true, status: "cancelled" });
  }

  if (action === "reschedule") {
    const { date, time } = body;

    // STRICT resolution, and the organisation is the ONLY authority.
    //
    // The customer picked a wall-clock time with no zone attached, so
    // the zone is entirely our inference — and the wrong one is silent:
    // it writes a real instant, at the wrong hour, into both the lead
    // and the business's Google calendar, where the two then agree and
    // nothing looks broken. Not knowing the zone therefore refuses,
    // rather than falling back to a default that would be right only
    // for UK and Irish businesses. Nothing from the browser is trusted
    // here; the request carries no timezone and would not be believed
    // if it did.
    const { timezone, resolved } = await resolveOrgTimezone(lead.org_id);
    if (!resolved) {
      console.error(
        `[bookings/manage] refusing to reschedule lead ${lead.id}: org ${lead.org_id} ` +
          `has no usable timezone, so "${String(date)} ${String(time)}" cannot be ` +
          `converted to an instant`
      );
      return NextResponse.json(
        {
          error:
            "We can't change this booking online just now. Your original time is unchanged — please contact the business directly.",
        },
        { status: 503 }
      );
    }

    // wallClockToInstant THROWS on anything that is not a zoneless
    // "YYYY-MM-DDTHH:mm" — which is exactly the validation this route
    // used to do with two regexes. Caught here so malformed input stays
    // the 400 it has always been rather than becoming a 500.
    let newIso: string;
    try {
      newIso = wallClockToInstant(`${date}T${time}`, timezone);
    } catch {
      return NextResponse.json({ error: "Invalid date or time" }, { status: 400 });
    }

    // No-op reschedule to the same slot the lead already occupies —
    // skip the availability check, which would otherwise count the
    // lead's own existing booking against itself and report the slot
    // as full.
    if (newIso !== lead.appointment_datetime) {
      // The zone is already resolved for this request, so hand it over
      // rather than making isWithinBusinessHours read organisations a
      // second time. Same decision, one query fewer.
      const hours = await isWithinBusinessHours(lead.org_id, newIso, timezone);
      if (!hours.isAvailable) {
        return NextResponse.json(
          { error: "That time is outside business hours.", reason: hours.reason },
          { status: 400 }
        );
      }

      // The lead's OWN booking must not count against its move. Under
      // overlap, a 10:00 appointment shifting to 10:30 collides with
      // itself, so without this every short reschedule would be refused.
      const available = await isSlotAvailable(lead.org_id, newIso, {
        excludeLeadId: lead.id,
      });
      if (!available) {
        const suggested = await findNextAvailableSlot(lead.org_id, newIso);
        return NextResponse.json(
          {
            error: "That time is fully booked.",
            suggestedAlternative: suggested,
          },
          { status: 409 }
        );
      }
    }

    const previousDatetime = lead.appointment_datetime ?? "";

    // The calendar moves BEFORE the local record, and a refusal stops
    // the reschedule outright. This is the opposite of cancel on
    // purpose: saying "moved to Thursday" while the event sits on
    // Tuesday is precisely the desync this is here to prevent, and
    // unlike a cancellation the customer loses nothing by trying again.
    const { data: org } = await supabase
      .from("organisations")
      .select("appointment_duration_minutes")
      .eq("id", lead.org_id)
      .maybeSingle();

    const moved = await rescheduleAppointmentOnCalendar(
      {
        orgId: lead.org_id,
        leadId: lead.id,
        startIso: newIso,
        durationMinutes: org?.appointment_duration_minutes ?? 60,
        serviceNeeded: lead.service_needed,
        customerName: lead.name,
        customerEmail: lead.email,
        location: null,
      },
      lead.appointment_datetime
    );

    if (moved.outcome === "conflict") {
      return NextResponse.json(
        {
          error: "That time is no longer available.",
          suggestedAlternative: moved.suggestedIso,
        },
        { status: 409 }
      );
    }
    if (moved.outcome === "failed") {
      return NextResponse.json(
        {
          error:
            "We couldn't move your appointment just now. Your original time is unchanged — please try again shortly.",
        },
        { status: 503 }
      );
    }

    const { error: updateError } = await supabase
      .from("leads")
      .update({ appointment_datetime: newIso })
      .eq("id", lead.id);

    if (updateError) {
      return NextResponse.json({ error: "Failed to reschedule booking" }, { status: 500 });
    }

    const ownerInfo = await getOrgOwnerEmail(lead.org_id);
    after(() =>
      sendBookingSelfServiceChangeNotification({
        businessOwnerEmail: ownerInfo?.email ?? null,
        customerName: lead.name,
        customerEmail: lead.email,
        customerPhone: lead.phone,
        serviceNeeded: lead.service_needed,
        bookingReference,
        action: "rescheduled",
        previousDatetime,
        newDatetime: newIso,
        // The zone this reschedule was interpreted in, so the owner's
        // email states the same wall-clock time the customer picked.
        timezone: ownerInfo?.timezone ?? timezone,
      }).catch((err) =>
        console.error("[bookings/manage] Failed to send reschedule notification:", err)
      )
    );

    return NextResponse.json({ success: true, status: "booked", appointmentDatetime: newIso });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
