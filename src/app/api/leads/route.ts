import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

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

  const validStatuses = ["new", "contacted", "qualified", "booked", "lost"];

  if (!raw.status || !validStatuses.includes(raw.status as string)) {
    return NextResponse.json(
      { error: `status must be one of: ${validStatuses.join(", ")}.` },
      { status: 422 }
    );
  }

  // Fetch the lead and verify ownership via org
  const { data: existing, error: fetchError } = await supabase
    .from("leads")
    .select("id, org_id")
    .eq("id", raw.id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  const { data: org, error: orgError } = await supabase
    .from("organisations")
    .select("id")
    .eq("id", existing.org_id)
    .eq("owner_id", user.id)
    .single();

  if (orgError || !org) {
    return NextResponse.json(
      { error: "Access denied." },
      { status: 403 }
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from("leads")
    .update({ status: raw.status as string })
    .eq("id", raw.id)
    .select(
      "id, name, phone, email, service_needed, preferred_datetime, message, source, status, ai_confidence, conversation_id, created_at, updated_at"
    )
    .single();

  if (updateError || !updated) {
    console.error("[leads:PATCH]", updateError);
    return NextResponse.json(
      { error: "Failed to update lead." },
      { status: 500 }
    );
  }

  return NextResponse.json({ lead: updated });
}

