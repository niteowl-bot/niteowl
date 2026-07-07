import { createAdminClient } from "@/lib/supabase/admin";
import { parseDatetimeToIso } from "@/lib/parseDatetime";

// ── Sales lead capture engine ────────────────────────────────────
// Captures prospects chatting with the NiteOwl sales assistant
// (src/app/api/sales/chat/route.ts). Deliberately separate from
// src/lib/leadCapture.ts, which captures a TENANT business's own
// customer leads (org-scoped, booking/availability-aware). Sales
// leads have no org_id, no booking, and a different field set
// (company, industry, preferred demo time) — see the architecture
// discussion in this feature's history for why these aren't merged.

type DatabaseClient = ReturnType<typeof createAdminClient>;

export interface ExtractedSalesLead {
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  industry: string | null;
  preferred_demo_time: string | null;
}

export interface SalesLeadRow {
  id: string;
  conversation_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  industry: string | null;
  preferred_demo_time: string | null;
  preferred_demo_datetime: string | null;
  message: string | null;
  status: string;
  notification_sent: boolean;
}

const SALES_LEAD_SELECT =
  "id, conversation_id, name, email, phone, company, industry, preferred_demo_time, preferred_demo_datetime, message, status, notification_sent";

// ── Field order + validation ──────────────────────────────────────

export interface RequiredField {
  key: "name" | "email" | "phone" | "company" | "preferred_demo_time";
  label: string;
}

export const REQUIRED_FIELDS: RequiredField[] = [
  { key: "name", label: "name" },
  { key: "email", label: "email address" },
  { key: "phone", label: "phone number" },
  { key: "company", label: "company name" },
  { key: "preferred_demo_time", label: "preferred time for a demo" },
];

const EMAIL_PATTERN = /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i;
const PHONE_PATTERN = /^[\d\s\-()+]{7,}$/;

function isValidEmail(v: string): boolean {
  return EMAIL_PATTERN.test(v.trim());
}

function isValidPhone(v: string): boolean {
  return PHONE_PATTERN.test(v.trim());
}

function isValidName(v: string): boolean {
  const trimmed = v.trim();
  if (trimmed.length < 2 || trimmed.length > 100) return false;
  if (EMAIL_PATTERN.test(trimmed) || PHONE_PATTERN.test(trimmed)) return false;
  return true;
}

function isValidCompany(v: string): boolean {
  const trimmed = v.trim();
  return trimmed.length >= 2 && trimmed.length <= 150;
}

function isValidDemoTime(v: string): boolean {
  return v.trim().length > 0;
}

const VALIDATORS: Record<RequiredField["key"], (v: string) => boolean> = {
  name: isValidName,
  email: isValidEmail,
  phone: isValidPhone,
  company: isValidCompany,
  preferred_demo_time: isValidDemoTime,
};

export function resolveNextField(
  lead: Partial<Record<RequiredField["key"], string | null>> | null
): RequiredField | null {
  for (const field of REQUIRED_FIELDS) {
    if (!lead?.[field.key]) return field;
  }
  return null;
}

// ── extractSalesLeadFields ─────────────────────────────────────────

export async function extractSalesLeadFields(
  message: string,
  alreadyKnown: Partial<Record<RequiredField["key"] | "industry", string | null>>
): Promise<ExtractedSalesLead> {
  const empty: ExtractedSalesLead = {
    name: null,
    email: null,
    phone: null,
    company: null,
    industry: null,
    preferred_demo_time: null,
  };

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return empty;

  const prompt = `You are a data-extraction assistant for a B2B sales chat. A prospective business owner is chatting with a salesperson about signing up for an AI receptionist product.

Extract any of the following fields the visitor's LATEST message states or corrects. Return ONLY a valid JSON object in this exact shape:
{
  "name": string or null,
  "email": string or null,
  "phone": string or null,
  "company": string or null,
  "industry": string or null,
  "preferred_demo_time": string or null
}

Rules:
- Only fill a field if the LATEST message actually states or corrects it — do not repeat something already known unless they are changing it.
- "industry" is the type of business they run (e.g. plumber, dentist, solicitor) — only fill this if clearly stated.
- "preferred_demo_time" is when they'd like a demo, exactly as they phrased it — do not convert it to a date yourself.
- Return null for any field not present in this message.

Already known:
${JSON.stringify(alreadyKnown)}

Visitor's latest message:
"""
${message}
"""`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 250,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return empty;

    const json = await res.json();
    const raw: string = json.choices?.[0]?.message?.content ?? "";
    const cleaned = raw
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned) as Partial<ExtractedSalesLead>;

    return {
      name: typeof parsed.name === "string" ? parsed.name.trim() || null : null,
      email: typeof parsed.email === "string" ? parsed.email.trim() || null : null,
      phone: typeof parsed.phone === "string" ? parsed.phone.trim() || null : null,
      company: typeof parsed.company === "string" ? parsed.company.trim() || null : null,
      industry: typeof parsed.industry === "string" ? parsed.industry.trim() || null : null,
      preferred_demo_time:
        typeof parsed.preferred_demo_time === "string" ? parsed.preferred_demo_time.trim() || null : null,
    };
  } catch (err) {
    console.error("[extractSalesLeadFields] parse error:", err);
    return empty;
  }
}

// ── Lookup helpers ──────────────────────────────────────────────

// A "complete" lead is a concluded demo request — the visitor already
// got a "team will follow up" reply for it. The browser's conversation
// id is a permanent localStorage value that never rotates, so without
// this gate a visitor returning to ask about a fresh/second demo (even
// weeks later) would match the old completed row and Remy would treat
// its stale fields — including an old preferred_demo_time — as still
// valid for the new request, skipping straight to a confirmation it
// never actually collected in the current conversation. Mirrors the
// same "closed statuses start a fresh lead" rule in leadCapture.ts.
const OPEN_SALES_LEAD_STATUSES = ["new"];

async function findByConversationId(
  supabase: DatabaseClient,
  conversationId: string
): Promise<SalesLeadRow | null> {
  const { data, error } = await supabase
    .from("sales_leads")
    .select(SALES_LEAD_SELECT)
    .eq("conversation_id", conversationId)
    .in("status", OPEN_SALES_LEAD_STATUSES)
    .maybeSingle();

  if (error) {
    console.error("[sales lead resolve] conversation_id lookup error:", error.message);
    return null;
  }
  return (data as SalesLeadRow) ?? null;
}

async function findByContact(
  supabase: DatabaseClient,
  email: string | null,
  phone: string | null
): Promise<SalesLeadRow | null> {
  if (!email && !phone) return null;

  let query = supabase
    .from("sales_leads")
    .select(SALES_LEAD_SELECT)
    .in("status", OPEN_SALES_LEAD_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1);

  if (email && phone) {
    query = query.or(`email.eq.${email},phone.eq.${phone}`);
  } else if (email) {
    query = query.eq("email", email);
  } else if (phone) {
    query = query.eq("phone", phone);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error("[sales lead resolve] contact lookup error:", error.message);
    return null;
  }
  return (data as SalesLeadRow) ?? null;
}

function deduplicateMessage(existing: string | null, incoming: string): string {
  if (!existing) return incoming.trim();
  const lines = existing.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines[lines.length - 1] === incoming.trim()) return existing;
  return [...lines, incoming.trim()].slice(-10).join("\n");
}

// ── captureSalesLead ───────────────────────────────────────────

export interface CaptureResult {
  leadId: string;
  known: Record<RequiredField["key"] | "industry", string | null>;
  nextField: RequiredField | null;
  invalidFieldNote: string | null;
  justCompleted: boolean;
  alreadyNotified: boolean;
}

/**
 * Merges this turn's extracted fields into the visitor's in-progress
 * sales lead — matched first by conversation (same chat session),
 * falling back to email/phone (a returning visitor in a new session)
 * so the same prospect never creates two rows. Validates each field
 * before accepting it; an invalid attempt at the currently-expected
 * field is surfaced back to the caller so the assistant can ask the
 * visitor to re-enter it, rather than silently advancing.
 */
export async function captureSalesLead(
  supabase: DatabaseClient,
  conversationId: string | null,
  userMessage: string
): Promise<CaptureResult> {
  const existingByConvo = conversationId ? await findByConversationId(supabase, conversationId) : null;

  const alreadyKnown = {
    name: existingByConvo?.name ?? null,
    email: existingByConvo?.email ?? null,
    phone: existingByConvo?.phone ?? null,
    company: existingByConvo?.company ?? null,
    industry: existingByConvo?.industry ?? null,
    preferred_demo_time: existingByConvo?.preferred_demo_time ?? null,
  };

  const extracted = await extractSalesLeadFields(userMessage, alreadyKnown);

  let existing = existingByConvo;
  if (!existing && (extracted.email || extracted.phone)) {
    existing = await findByContact(supabase, extracted.email, extracted.phone);
  }

  // Nothing on record for this visitor yet, and nothing new revealed this
  // turn — do not create a row. Otherwise this conversation's own empty
  // row would immediately shadow the conversation_id lookup on the very
  // next turn, so a later message revealing contact info that matches a
  // DIFFERENT existing lead would never be checked against it (existing
  // would already be non-null from this session's own placeholder row).
  const hasAnyExtractedField = Boolean(
    extracted.name ||
      extracted.email ||
      extracted.phone ||
      extracted.company ||
      extracted.industry ||
      extracted.preferred_demo_time
  );

  if (!existing && !hasAnyExtractedField) {
    return {
      leadId: "",
      known: {
        name: null,
        email: null,
        phone: null,
        company: null,
        industry: null,
        preferred_demo_time: null,
      },
      nextField: null,
      invalidFieldNote: null,
      justCompleted: false,
      alreadyNotified: false,
    };
  }

  const expectedBefore = resolveNextField(existing ?? {});
  let invalidFieldNote: string | null = null;

  const merged: Record<RequiredField["key"] | "industry", string | null> = {
    name: existing?.name ?? null,
    email: existing?.email ?? null,
    phone: existing?.phone ?? null,
    company: existing?.company ?? null,
    industry: existing?.industry ?? null,
    preferred_demo_time: existing?.preferred_demo_time ?? null,
  };

  for (const field of REQUIRED_FIELDS) {
    const value = extracted[field.key];
    if (!value) continue;

    if (VALIDATORS[field.key](value)) {
      merged[field.key] = value;
    } else if (expectedBefore?.key === field.key) {
      invalidFieldNote = `They attempted to give their ${field.label} ("${value}") but it doesn't look valid — ask them to double-check and re-enter it.`;
    }
  }

  if (extracted.industry) merged.industry = extracted.industry;

  let preferredDemoDatetime: string | null = existing?.preferred_demo_datetime ?? null;
  if (merged.preferred_demo_time && merged.preferred_demo_time !== existing?.preferred_demo_time) {
    const { iso } = await parseDatetimeToIso(merged.preferred_demo_time, "Europe/London");
    preferredDemoDatetime = iso;
  }

  const nextFieldAfter = resolveNextField(merged);
  const justCompleted = Boolean(expectedBefore) && !nextFieldAfter;
  const status = nextFieldAfter ? "new" : "complete";

  const payload = {
    conversation_id: conversationId,
    ...merged,
    preferred_demo_datetime: preferredDemoDatetime,
    message: deduplicateMessage(existing?.message ?? null, userMessage),
    status,
    updated_at: new Date().toISOString(),
  };

  let leadId: string;

  if (existing) {
    const { error } = await supabase.from("sales_leads").update(payload).eq("id", existing.id);
    if (error) console.error("[sales lead capture] update failed:", error.message);
    leadId = existing.id;
  } else {
    const { data, error } = await supabase
      .from("sales_leads")
      .insert(payload)
      .select("id")
      .single();
    if (error) console.error("[sales lead capture] insert failed:", error.message);
    leadId = data?.id ?? "";
  }

  return {
    leadId,
    known: merged,
    nextField: nextFieldAfter,
    invalidFieldNote,
    justCompleted,
    alreadyNotified: existing?.notification_sent ?? false,
  };
}

export async function markSalesLeadNotified(supabase: DatabaseClient, leadId: string): Promise<void> {
  if (!leadId) return;
  const { error } = await supabase
    .from("sales_leads")
    .update({ notification_sent: true })
    .eq("id", leadId);
  if (error) console.error("[sales lead capture] failed to mark notified:", error.message);
}
