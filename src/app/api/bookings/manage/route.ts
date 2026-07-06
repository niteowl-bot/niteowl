import { NextRequest, NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrgOwnerEmail } from "@/lib/leadCapture";
import { sendBookingSelfServiceChangeNotification } from "@/lib/email";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  isWithinBusinessHours,
  isSlotAvailable,
  findNextAvailableSlot,
} from "@/lib/availability";

// Public, unauthenticated route — a customer reaches this via the
// manage-booking link in their confirmation email, with no logged-in
// session. Identity is resolved solely via the opaque manage_token
// (same pattern as /api/widget/chat resolving org via widget_key):
// admin client, every query manually scoped by the resolved lead/org.

const LEAD_FIELDS =
  "id, org_id, name, email, phone, service_needed, appointment_datetime, status";

// Converts a wall-clock date+time the customer picked (assumed to be in
// the business's own timezone) into the correct UTC instant. A plain
// `new Date("2026-07-10T14:00:00")` would be parsed in the server's
// runtime timezone (UTC on Vercel), which is wrong for a UK business —
// this instead finds the UTC instant that actually displays as that
// wall-clock time in Europe/London, correctly handling the BST/GMT
// offset for the specific date in question.
function londonWallTimeToUtcIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return null;
  }

  const naiveUtc = new Date(`${date}T${time}:00.000Z`);
  if (isNaN(naiveUtc.getTime())) return null;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(naiveUtc);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  const shownAsLondon = new Date(
    `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}.000Z`
  );

  const offsetMs = naiveUtc.getTime() - shownAsLondon.getTime();
  return new Date(naiveUtc.getTime() + offsetMs).toISOString();
}

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
    .select("business_name, appointment_duration_minutes, emergency_mode_enabled")
    .eq("id", lead.org_id)
    .maybeSingle();

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
    const { error: updateError } = await supabase
      .from("leads")
      .update({ status: "cancelled" })
      .eq("id", lead.id);

    if (updateError) {
      return NextResponse.json({ error: "Failed to cancel booking" }, { status: 500 });
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
      }).catch((err) =>
        console.error("[bookings/manage] Failed to send cancellation notification:", err)
      )
    );

    return NextResponse.json({ success: true, status: "cancelled" });
  }

  if (action === "reschedule") {
    const { date, time } = body;
    const newIso = londonWallTimeToUtcIso(date, time);

    if (!newIso) {
      return NextResponse.json({ error: "Invalid date or time" }, { status: 400 });
    }

    // No-op reschedule to the same slot the lead already occupies —
    // skip the availability check, which would otherwise count the
    // lead's own existing booking against itself and report the slot
    // as full.
    if (newIso !== lead.appointment_datetime) {
      const hours = await isWithinBusinessHours(lead.org_id, newIso);
      if (!hours.isAvailable) {
        return NextResponse.json(
          { error: "That time is outside business hours.", reason: hours.reason },
          { status: 400 }
        );
      }

      const available = await isSlotAvailable(lead.org_id, newIso);
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
      }).catch((err) =>
        console.error("[bookings/manage] Failed to send reschedule notification:", err)
      )
    );

    return NextResponse.json({ success: true, status: "booked", appointmentDatetime: newIso });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
