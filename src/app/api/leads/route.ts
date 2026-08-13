import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  cancelAppointmentOnCalendar,
  rescheduleAppointmentOnCalendar,
} from "@/lib/calendarSync";
import { isWithinBusinessHours, isSlotAvailable } from "@/lib/availability";

// ── Types ────────────────────────────────────────────────────────

interface LeadPayload {
  org_id: string;
  conversation_id?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  service_needed?: string | null;
  preferred_datetime?: string | null;
  message?: string | null;
  source?: "chat" | "sms" | "web_widget" | "manual" | "other";
  ai_confidence?: number | null;
  metadata?: Record<string, unknown> | null;
}

interface ValidationError {
  field: string;
  message: string;
}

// ── Validation ───────────────────────────────────────────────────

const VALID_SOURCES = ["chat", "sms", "web_widget", "manual", "other"] as const;

// Basic phone-number validation — accepts international numbers with
// spaces, +, parentheses, and hyphens; rejects anything containing other
// characters (letters, symbols) and anything with too few or too many
// digits to plausibly be a real number. Deliberately lenient on FORMAT
// (no country-specific rules) so it never rejects a genuine international
// number — it only catches the clearly malformed case.
const PHONE_ALLOWED_CHARS_RE = /^[0-9+()\-\s]+$/;
const MIN_PHONE_DIGITS = 7;
const MAX_PHONE_DIGITS = 15; // E.164 maximum

function isValidPhoneNumber(value: string): boolean {
  if (!PHONE_ALLOWED_CHARS_RE.test(value)) return false;
  const digitCount = (value.match(/\d/g) ?? []).length;
  return digitCount >= MIN_PHONE_DIGITS && digitCount <= MAX_PHONE_DIGITS;
}

function validatePayload(body: unknown): {
  data: LeadPayload | null;
  errors: ValidationError[];
} {
  const errors: ValidationError[] = [];

  if (!body || typeof body !== "object") {
    return {
      data: null,
      errors: [{ field: "body", message: "Request body must be a JSON object." }],
    };
  }

  const raw = body as Record<string, unknown>;

  // org_id — required
  if (!raw.org_id || typeof raw.org_id !== "string" || !raw.org_id.trim()) {
    errors.push({ field: "org_id", message: "org_id is required." });
  }

  // At least one contact detail must be present
  const hasContact =
    raw.name || raw.phone || raw.email;

  if (!hasContact) {
    errors.push({
      field: "contact",
      message: "At least one of name, phone, or email is required.",
    });
  }

  // email — optional but must be valid if provided
  if (raw.email !== undefined && raw.email !== null) {
    if (typeof raw.email !== "string") {
      errors.push({ field: "email", message: "email must be a string." });
    } else if (raw.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.email.trim())) {
      errors.push({ field: "email", message: "email must be a valid email address." });
    }
  }

  // phone — optional, but must look like a real phone number if provided.
  // International numbers, spaces, +, parentheses, and hyphens are all
  // accepted; only the digit count is checked (7–15, per the E.164 max),
  // so this rejects obviously-malformed input ("12x-abc") without
  // rejecting any valid international format.
  if (raw.phone !== undefined && raw.phone !== null) {
    if (typeof raw.phone !== "string") {
      errors.push({ field: "phone", message: "phone must be a string." });
    } else if (raw.phone.trim() && !isValidPhoneNumber(raw.phone.trim())) {
      errors.push({
        field: "phone",
        message:
          "phone must be a valid phone number, e.g. +44 7700 900123 — only digits, spaces, +, (), and - are allowed.",
      });
    }
  }

  // source — optional but must be a valid enum value if provided
  if (raw.source !== undefined && raw.source !== null) {
    if (!VALID_SOURCES.includes(raw.source as (typeof VALID_SOURCES)[number])) {
      errors.push({
        field: "source",
        message: `source must be one of: ${VALID_SOURCES.join(", ")}.`,
      });
    }
  }

  // ai_confidence — optional but must be 0–1 if provided
  if (raw.ai_confidence !== undefined && raw.ai_confidence !== null) {
    const conf = Number(raw.ai_confidence);
    if (isNaN(conf) || conf < 0 || conf > 1) {
      errors.push({
        field: "ai_confidence",
        message: "ai_confidence must be a number between 0 and 1.",
      });
    }
  }

  // conversation_id — optional but must be a string if provided
  if (
    raw.conversation_id !== undefined &&
    raw.conversation_id !== null &&
    typeof raw.conversation_id !== "string"
  ) {
    errors.push({
      field: "conversation_id",
      message: "conversation_id must be a string.",
    });
  }

  if (errors.length > 0) {
    return { data: null, errors };
  }

  return {
    data: {
      org_id: (raw.org_id as string).trim(),
      conversation_id:
        typeof raw.conversation_id === "string" ? raw.conversation_id : null,
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : null,
      phone:
        typeof raw.phone === "string" && raw.phone.trim() ? raw.phone.trim() : null,
      email:
        typeof raw.email === "string" && raw.email.trim()
          ? raw.email.trim().toLowerCase()
          : null,
      service_needed:
        typeof raw.service_needed === "string" && raw.service_needed.trim()
          ? raw.service_needed.trim()
          : null,
      preferred_datetime:
        typeof raw.preferred_datetime === "string" && raw.preferred_datetime.trim()
          ? raw.preferred_datetime.trim()
          : null,
      message:
        typeof raw.message === "string" && raw.message.trim()
          ? raw.message.trim()
          : null,
      source: VALID_SOURCES.includes(raw.source as (typeof VALID_SOURCES)[number])
        ? (raw.source as LeadPayload["source"])
        : "chat",
      ai_confidence:
        raw.ai_confidence !== undefined && raw.ai_confidence !== null
          ? Math.round(Number(raw.ai_confidence) * 100) / 100
          : null,
      metadata:
        raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
          ? (raw.metadata as Record<string, unknown>)
          : null,
    },
    errors: [],
  };
}

// ── GET — list leads for an org ──────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const orgId = searchParams.get("org_id");

  if (!orgId) {
    return NextResponse.json(
      { error: "org_id query parameter is required." },
      { status: 400 }
    );
  }

  // Verify ownership
  const { data: org, error: orgError } = await supabase
    .from("organisations")
    .select("id")
    .eq("id", orgId)
    .eq("owner_id", user.id)
    .single();

  if (orgError || !org) {
    return NextResponse.json(
      { error: "Organisation not found or access denied." },
      { status: 403 }
    );
  }

  // Optional filters from query params
  const status = searchParams.get("status");
  const source = searchParams.get("source");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);

  let query = supabase
    .from("leads")
    .select(
      "id, name, phone, email, service_needed, preferred_datetime, message, source, status, ai_confidence, conversation_id, created_at, updated_at",
      { count: "exact" }
    )
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);
  if (source) query = query.eq("source", source);

  const { data: leads, error: leadsError, count } = await query;

  if (leadsError) {
    console.error("[leads:GET]", leadsError);
    return NextResponse.json(
      { error: "Failed to fetch leads." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    leads: leads ?? [],
    total: count ?? 0,
    limit,
    offset,
  });
}

// ── POST — create a lead ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Parse body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  // Validate
  const { data: payload, errors } = validatePayload(body);

  if (errors.length > 0 || !payload) {
    return NextResponse.json(
      { error: "Validation failed.", details: errors },
      { status: 422 }
    );
  }

  // Verify the authenticated user owns this organisation
  const { data: org, error: orgError } = await supabase
    .from("organisations")
    .select("id")
    .eq("id", payload.org_id)
    .eq("owner_id", user.id)
    .single();

  if (orgError || !org) {
    return NextResponse.json(
      { error: "Organisation not found or access denied." },
      { status: 403 }
    );
  }

  // Insert lead
  const { data: lead, error: insertError } = await supabase
    .from("leads")
    .insert({
      org_id: payload.org_id,
      conversation_id: payload.conversation_id ?? null,
      name: payload.name ?? null,
      phone: payload.phone ?? null,
      email: payload.email ?? null,
      service_needed: payload.service_needed ?? null,
      preferred_datetime: payload.preferred_datetime ?? null,
      message: payload.message ?? null,
      source: payload.source ?? "chat",
      status: "new",
      ai_confidence: payload.ai_confidence ?? null,
      metadata: payload.metadata ?? null,
    })
    .select(
      "id, name, phone, email, service_needed, preferred_datetime, message, source, status, ai_confidence, conversation_id, created_at"
    )
    .single();

  if (insertError || !lead) {
    console.error("[leads:POST]", insertError);
    return NextResponse.json(
      { error: "Failed to save lead." },
      { status: 500 }
    );
  }

  return NextResponse.json({ lead }, { status: 201 });
}

// ── PATCH — update lead status ───────────────────────────────────

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const raw = body as Record<string, unknown>;

  if (!raw.id || typeof raw.id !== "string") {
    return NextResponse.json(
      { error: "Lead id is required." },
      { status: 400 }
    );
  }

  // "cancelled" is accepted so the owner's dashboard has a calendar-aware
  // way to cancel. It used to be absent, which is exactly why both
  // dashboards wrote to the leads table directly from the browser and the
  // linked Google event was never touched.
  const validStatuses = [
    "new",
    "contacted",
    "qualified",
    "booked",
    "lost",
    "cancelled",
  ];

  if (!raw.status || !validStatuses.includes(raw.status as string)) {
    return NextResponse.json(
      { error: `status must be one of: ${validStatuses.join(", ")}.` },
      { status: 422 }
    );
  }

  // An owner may move an appointment from either dashboard. Optional:
  // absent means "this save is not about the time".
  //
  // Only the INSTANT is taken from the caller. Everything the decision
  // turns on — the previous time, the status, the org — is read from the
  // persisted row below.
  let requestedIso: string | null = null;
  if (raw.appointment_datetime !== undefined && raw.appointment_datetime !== null) {
    if (
      typeof raw.appointment_datetime !== "string" ||
      Number.isNaN(Date.parse(raw.appointment_datetime))
    ) {
      return NextResponse.json(
        { error: "appointment_datetime must be a valid ISO timestamp." },
        { status: 400 }
      );
    }
    requestedIso = new Date(raw.appointment_datetime).toISOString();
  }

  // Fetch the lead and verify ownership via org
  // `status` is selected so the CURRENT persisted status is known: it is
  // what makes a real cancellation transition distinguishable from
  // re-saving a lead that is already cancelled.
  //
  // name/email/service_needed are selected for the RESCHEDULE path, and
  // are not optional there: moveEventToMatch rebuilds the event's title
  // and description from them (summarise()), so passing nulls would
  // retitle a real appointment "Appointment" and strip the customer's
  // name and email out of the business's calendar.
  const { data: existing, error: fetchError } = await supabase
    .from("leads")
    .select(
      "id, org_id, status, appointment_datetime, name, email, service_needed"
    )
    .eq("id", raw.id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  // Invariant: a lead may only be Booked once it has a saved appointment
  // date/time (the calendar renders leads by appointment_datetime). Refuse
  // to mark Booked without one so status and calendar never disagree.
  if (raw.status === "booked" && !existing.appointment_datetime) {
    return NextResponse.json(
      {
        error:
          "A lead can only be marked Booked once it has an appointment date/time. Set the appointment time first.",
      },
      { status: 422 }
    );
  }

  // appointment_duration_minutes rides along on the ownership probe the
  // route already makes — the reschedule path needs it, and this costs
  // no extra round trip.
  const { data: org, error: orgError } = await supabase
    .from("organisations")
    .select("id, appointment_duration_minutes")
    .eq("id", existing.org_id)
    .eq("owner_id", user.id)
    .single();

  if (orgError || !org) {
    return NextResponse.json(
      { error: "Access denied." },
      { status: 403 }
    );
  }

  // ── OWNER RESCHEDULE: CALENDAR FIRST, FAIL CLOSED ─────────────────
  //
  // The exact opposite ordering to the cancellation below, and
  // deliberately so. A customer must always be able to cancel, so that
  // path writes locally first and never rolls back. A reschedule is the
  // reverse: showing an owner "moved to Thursday" while the event sits
  // on Tuesday is the one outcome that must be impossible, and unlike a
  // cancellation nothing is lost by refusing and inviting a retry. So
  // NOTHING is written locally until the calendar has agreed.
  //
  // Judged on a REAL transition, read from the row above rather than
  // from the caller: the browser can neither force the calendar step nor
  // suppress it by lying about the previous time.
  //
  // Compared as INSTANTS, not strings. Postgres returns timestamptz as
  // "…+00:00" while the browser sends "…Z"; a string compare would call
  // every save a reschedule and fire a provider request on each one.
  const isRescheduleTransition =
    requestedIso !== null &&
    existing.status === "booked" &&
    existing.appointment_datetime !== null &&
    new Date(requestedIso).getTime() !==
      new Date(existing.appointment_datetime).getTime();

  // The `requestedIso !== null` repeat is what narrows the type for the
  // block; isRescheduleTransition already implies it.
  if (isRescheduleTransition && requestedIso !== null) {
    // The helper re-verifies the slot itself, but SKIPS that check when
    // the move overlaps its own old time (10:00 → 10:30) because
    // free/busy cannot tell the org's own event apart from anyone
    // else's. These two run first so an overlapping move is still held
    // to the business's opening hours and capacity — the same order
    // /api/bookings/manage uses.
    const hours = await isWithinBusinessHours(existing.org_id, requestedIso);
    if (!hours.isAvailable) {
      return NextResponse.json(
        { error: "That time is outside business hours.", reason: hours.reason },
        { status: 422 }
      );
    }

    // The lead's OWN booking must not count against its move: capacity
    // is an overlap test, so without this every short reschedule would
    // be refused as a clash with itself.
    const free = await isSlotAvailable(existing.org_id, requestedIso, {
      excludeLeadId: existing.id,
    });
    if (!free) {
      return NextResponse.json(
        { error: "That time is already fully booked." },
        { status: 409 }
      );
    }

    const moved = await rescheduleAppointmentOnCalendar(
      {
        orgId: existing.org_id,
        leadId: existing.id,
        startIso: requestedIso,
        durationMinutes: org.appointment_duration_minutes ?? 60,
        serviceNeeded: existing.service_needed,
        customerName: existing.name,
        customerEmail: existing.email,
        location: null,
      },
      existing.appointment_datetime
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

    // "failed" covers a provider refusal, a timeout, and PR #13's
    // missing-link case — a calendar we cannot verify. All three mean
    // the same thing here: the appointment has NOT moved, and the stored
    // time must stay exactly where it is.
    if (moved.outcome === "failed") {
      console.error(
        `[leads:PATCH] reschedule refused for lead ${existing.id} — the original ` +
          `time ${existing.appointment_datetime} is unchanged`
      );
      return NextResponse.json(
        {
          error:
            "We couldn't move this appointment just now. The original time is unchanged — please try again shortly.",
        },
        { status: 503 }
      );
    }
    // "synced" and "no_calendar" both permit the local write below.
    // no_calendar is the ordinary state for a business with no calendar
    // integration, and moving the time is exactly right for it.
  }

  const { data: updated, error: updateError } = await supabase
    .from("leads")
    .update({
      status: raw.status as string,
      // Written ONLY once the calendar has permitted it, and only when
      // this save is genuinely a reschedule.
      ...(isRescheduleTransition ? { appointment_datetime: requestedIso } : {}),
    })
    .eq("id", raw.id)
    .select(
      "id, name, phone, email, service_needed, preferred_datetime, appointment_datetime, message, source, status, ai_confidence, conversation_id, created_at, updated_at"
    )
    .single();

  if (updateError || !updated) {
    console.error("[leads:PATCH]", updateError);
    return NextResponse.json(
      { error: "Failed to update lead." },
      { status: 500 }
    );
  }

  // ── LOCAL-FIRST, the same ordering /api/bookings/manage uses ──────
  //
  // The lead is already cancelled above; this only clears the mirror of
  // it in the business's own calendar. The ordering is deliberate and
  // must not be swapped: a provider failure here must never leave the
  // lead sitting at "booked" with its event already gone, holding the
  // slot internally while showing nothing in the diary. So NOTHING
  // below rolls the local cancellation back.
  //
  // The accepted failure is the reverse — a ghost event, recorded on the
  // link with its error. That record is diagnosis only; nothing surfaces
  // it to the owner today.
  //
  // Every outcome leaves the cancellation standing. "no_calendar" covers
  // both an org with no calendar at all and the lost-link case, whose
  // own diagnostic fires inside the helper — neither is an error here,
  // and neither is reported to the caller as one. The response says only
  // that the lead was updated: it makes no claim about Google, because
  // outside "synced" we have no evidence to make one.
  //
  // Gated on a REAL TRANSITION, read from the row this route already
  // fetched and authorised — never from the caller. Re-saving a lead
  // that is already cancelled is not a cancellation and must not reach
  // the provider again: the delete would be harmless (already-gone is
  // success) but it is a request nobody asked for, and the server, not
  // the browser, is the right place to know that.
  const isCancellationTransition =
    raw.status === "cancelled" && existing.status !== "cancelled";

  if (isCancellationTransition) {
    const removed = await cancelAppointmentOnCalendar(existing.org_id, existing.id);
    if (removed.outcome === "failed") {
      console.error(
        `[leads:PATCH] lead ${existing.id} is cancelled locally but its calendar ` +
          `event could not be removed — the failure is recorded on the link for ` +
          `diagnosis (not surfaced to the owner today)`
      );
    }
  }

  return NextResponse.json({ lead: updated });
}

