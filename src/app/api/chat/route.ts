import { createClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { parseDatetimeToIso } from "@/lib/parseDatetime";
import { isWithinBusinessHours, findNextAvailableSlot, isSlotAvailable } from "@/lib/availability";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendBookingConfirmationEmails } from "@/lib/email";

export const runtime = "nodejs";

// ── Lead extraction types ────────────────────────────────────────

type LeadIntent =
  | "new_booking"
  | "reschedule"
  | "contact_update"
  | "question"
  | "unknown";

interface ExtractedLead {
  intent: LeadIntent;
  name: string | null;
  email: string | null;
  phone: string | null;
  service: string | null;
  preferred_datetime: string | null;
  confidence: number;
}

const EMPTY_LEAD: ExtractedLead = {
  intent: "unknown",
  name: null,
  email: null,
  phone: null,
  service: null,
  preferred_datetime: null,
  confidence: 0,
};

const ACTIONABLE_INTENTS: LeadIntent[] = [
  "new_booking",
  "reschedule",
  "contact_update",
];
// ── Lead lifecycle ────────────────────────────────────────────────

type LeadStatus =
  | "new"
  | "awaiting_confirmation"
  | "contacted"
  | "qualified"
  | "booked"
  | "lost"
  | "cancelled"
  | "needs_review";


// Open statuses are eligible to receive merged updates from ongoing
// conversation. Closed statuses (booked/lost/cancelled) represent a
// concluded enquiry — any further contact starts a fresh lead.
// "Open" describes dashboard/reporting semantics — an enquiry not yet booked.
const OPEN_LEAD_STATUSES: LeadStatus[] = ["new", "awaiting_confirmation", "contacted", "qualified", "needs_review"];

// "Mergeable" describes which leads can still receive updates from
// follow-up messages in the same chat session. A booked appointment
// is not closed — the customer can still correct contact details or
// reschedule. Only lost/cancelled are genuinely concluded and excluded.
const MERGEABLE_STATUSES: LeadStatus[] = [
  "new",
  "awaiting_confirmation",
  "contacted",
  "qualified",
  "booked",
  "needs_review",
];


// Statuses that must never be silently overwritten by the merge logic
const PROTECTED_STATUSES: LeadStatus[] = ["contacted", "qualified"];


// ── Smart merge helpers ──────────────────────────────────────────

const CONTACT_INFO_PATTERNS: RegExp[] = [
  /^my (email|phone|number|mobile|telephone)/i,
  /^(email|phone|number|mobile|telephone)(\s+is|\s+address)?/i,
  /^(it'?s|that'?s|this is)\s+[\w@.+\-]+$/i,
  /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i,
  /^[\d\s\-()+]{7,}$/,
  /^(my )?(email|phone) (is|address is)/i,
  /^(you can (reach|contact|call|email) me)/i,
];

function looksLikeContactInfo(text: string | null): boolean {
  if (!text) return false;
  return CONTACT_INFO_PATTERNS.some((p) => p.test(text.trim()));
}

function shouldUpdateService(
  extracted: string | null,
  existing: string | null,
  intent: LeadIntent
): string | null {
  // Intent gate — primary defence
  // Only new_booking can ever change the service field
  if (intent !== "new_booking") return existing;

  // Nothing extracted
  if (!extracted) return existing;

  // Secondary string guards — catch GPT intent misclassification
  if (looksLikeContactInfo(extracted)) return existing;

  const containsEmail = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(extracted);
  const containsPhone = /\b[\d\s\-()+]{7,}\b/.test(extracted);
  if (containsEmail || containsPhone) return existing;

  const adminPhrases = [
    /^(phone|email|contact|name)\s*(update|change|correction)?$/i,
    /^(provide|giving|sharing)\s+(phone|email|contact|number)/i,
    /^reschedul/i,
    /^booking\s+update$/i,
    /^appointment\s+update$/i,
  ];
  if (adminPhrases.some((p) => p.test(extracted.trim()))) return existing;

  // Only replace an existing service if the new value is more than 2 words
  if (existing && extracted.split(/\s+/).length <= 2) return existing;

  return extracted;
}
function shouldUpdateName(
  extracted: string | null,
  existing: string | null
): string | null {
  if (!extracted) return existing;
  if (looksLikeContactInfo(extracted)) return existing;
  return extracted;
}


function deduplicateMessage(
  existing: string | null,
  incoming: string
): string {
  if (!existing) return incoming.trim();

  const lines = existing.split("\n").map((l) => l.trim()).filter(Boolean);

  // Avoid appending exact duplicate of the last line
  if (lines[lines.length - 1] === incoming.trim()) return existing;

  // Keep only the last 10 messages to prevent cross-conversation pollution
  const updated = [...lines, incoming.trim()].slice(-10);
  return updated.join("\n");
}


// ── extractLeadData ──────────────────────────────────────────────

async function extractLeadData(message: string): Promise<ExtractedLead> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return { ...EMPTY_LEAD, confidence: 0.5 };

  const prompt = `You are a lead extraction assistant for a business booking system.

Analyse the customer message and return ONLY a valid JSON object.

## Required JSON shape
{
  "intent": "new_booking" | "reschedule" | "contact_update" | "question" | "unknown",
  "name": string or null,
  "email": string or null,
  "phone": string or null,
  "service": string or null,
  "preferred_datetime": string or null,
  "confidence": number 0.0-1.0
}

## Intent definitions

"new_booking"
  Customer wants to book, schedule, get a quote, check availability, or request a service.
  Triggers: "I'd like to book", "Can I make an appointment", "I need a quote",
  "Are you available", "I want to arrange", "How much for", "Can you come out"

"reschedule"
  Customer wants to change, move, update, or correct an existing booking time or date.
  Triggers: "change my booking", "update my appointment", "move it to", "make it",
  "actually", "reschedule", "instead", "different time", "can we do", "how about",
  "5pm instead", "tomorrow instead", "let's do Friday", "change the time",
  "can you change", "I'd prefer", "switch to"

"contact_update"
  Customer is providing or correcting contact details only.
  Triggers: "my email is", "my number is", "you can reach me at",
  "my name is", "I'm called", "this is [name]", "my phone is"

"question"
  General question about the business — no booking action required.
  Triggers: "what are your hours", "do you offer", "how much does",
  "are you open", "what services", "where are you"

"unknown"
  Does not fit any category above.

## Field rules

intent
  Choose the single best intent. When in doubt between new_booking and reschedule,
  look for words like "change", "update", "move", "actually", "instead", "make it"
  — those signal reschedule even without the word "reschedule".

name
  Extract from: "My name is X", "I'm X", "This is X", "call me X".
  Return null if no name is clearly stated.

email
  Exact email address as written. Return null if none.

phone
  Any phone format. Return null if none.

service
  Short summary of the service or job the customer is requesting.
  Examples: "Boiler repair", "Hair appointment", "Plumbing quote".
  STRICT RULES:
  - Return null if intent is "reschedule". Rescheduling is not a new service request.
  - Return null if intent is "contact_update". Providing contact details is not a service request.
  - Return null if intent is "question". Asking a question is not a service request.
  - Return null if intent is "unknown".
  - Only populate this field when intent is "new_booking" AND the customer is clearly requesting a specific job or service.
  - Never copy a phone number, email address, or name into this field.
  - Never use "phone update", "contact update", "reschedule", or similar administrative descriptions as the service.
  - If in doubt, return null.

preferred_datetime
  Extract ANY time or date reference regardless of intent.
  Covers new bookings, rescheduling, corrections, and relative times.
  Examples: "5pm tomorrow", "Friday at 2pm", "next Monday morning",
  "make it 3pm", "actually Tuesday", "morning would be better".
  Return the value exactly as the customer said it.
  Return null ONLY if the message contains zero time or date information.

confidence
  0.9-1.0 confirmed booking with contact details
  0.7-0.89 booking or service request, details incomplete
  0.5-0.69 reschedule or contact update
  0.1-0.49 general question with mild intent signals
  0.0 no lead intent

## Examples

"I'd like to book a plumber for tomorrow at 3pm, my name is James"
{"intent":"new_booking","name":"James","email":null,"phone":null,"service":"Plumber booking","preferred_datetime":"tomorrow at 3pm","confidence":0.92}

"Can you change my appointment to 5pm tomorrow?"
{"intent":"reschedule","name":null,"email":null,"phone":null,"service":null,"preferred_datetime":"5pm tomorrow","confidence":0.6}

"Actually make it 3pm on Friday"
{"intent":"reschedule","name":null,"email":null,"phone":null,"service":null,"preferred_datetime":"3pm on Friday","confidence":0.6}

"Reschedule to next Monday at 9am"
{"intent":"reschedule","name":null,"email":null,"phone":null,"service":null,"preferred_datetime":"next Monday at 9am","confidence":0.6}

"My email is john@example.com"
{"intent":"contact_update","name":null,"email":"john@example.com","phone":null,"service":null,"preferred_datetime":null,"confidence":0.55}

"My name is Sarah and my number is 07911 123456"
{"intent":"contact_update","name":"Sarah","email":null,"phone":"07911 123456","service":null,"preferred_datetime":null,"confidence":0.55}

"What are your opening hours?"
{"intent":"question","name":null,"email":null,"phone":null,"service":null,"preferred_datetime":null,"confidence":0.0}

## Critical rules
- Return ONLY the JSON object — no markdown, no explanation, no code fences
- Never return preferred_datetime as null when any time or date is mentioned
- For rescheduling messages always set intent to "reschedule" even if the word "reschedule" is not used

Customer message:
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
    });

    if (!res.ok) {
      console.error("[extractLeadData] OpenAI error:", res.status);
      return { ...EMPTY_LEAD, confidence: 0.5 };
    }

    const json = await res.json();
    const raw: string = json.choices?.[0]?.message?.content ?? "";

    const cleaned = raw
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned) as Partial<ExtractedLead>;

    const validIntents: LeadIntent[] = [
      "new_booking",
      "reschedule",
      "contact_update",
      "question",
      "unknown",
    ];

    return {
      intent:
        typeof parsed.intent === "string" &&
        validIntents.includes(parsed.intent as LeadIntent)
          ? (parsed.intent as LeadIntent)
          : "unknown",
      name:
        typeof parsed.name === "string"
          ? parsed.name.trim() || null
          : null,
      email:
        typeof parsed.email === "string"
          ? parsed.email.trim() || null
          : null,
      phone:
        typeof parsed.phone === "string"
          ? parsed.phone.trim() || null
          : null,
      service:
        typeof parsed.service === "string"
          ? parsed.service.trim() || null
          : null,
      preferred_datetime:
        typeof parsed.preferred_datetime === "string"
          ? parsed.preferred_datetime.trim() || null
          : null,
      confidence:
        typeof parsed.confidence === "number"
          ? Math.min(1, Math.max(0, parsed.confidence))
          : 0.5,
    };
  } catch (err) {
    console.error("[extractLeadData] parse error:", err);
    return { ...EMPTY_LEAD, confidence: 0.5 };
  }
}
// ── assessAnswerConfidence ────────────────────────────────────────

interface ConfidenceAssessment {
  needsReview: boolean;
  reason: string | null;
}

/**
 * Runs a lightweight, isolated check on whether the customer's message
 * can be confidently answered using the business's knowledge base.
 * This never touches booking, availability, or lead-merge logic — it
 * only informs whether a "needs_review" lead should be created for
 * question/unknown intents that fall outside what Remy actually knows.
 */
async function assessAnswerConfidence(
  message: string,
  knowledgeSummary: string
): Promise<ConfidenceAssessment> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return { needsReview: false, reason: null };

  const prompt = `You are a confidence-checking assistant for a business AI receptionist.

Given the business's available knowledge and a customer message, decide
ONLY whether the knowledge base contains enough information to answer
the customer confidently and accurately.

Return ONLY a valid JSON object in this exact shape:
{"needsReview": boolean, "reason": string or null}

Rules:
- needsReview is true ONLY if the message asks something the knowledge
  base does not cover, or requires a judgement call outside general
  business facts (e.g. a specific policy exception, a complaint, a
  legal question, a request the business hasn't documented).
- needsReview is false for greetings, small talk, questions clearly
  answered by the knowledge below, and any booking-related message.
- reason is a short (under 12 words) internal note for the business
  explaining what the customer needs help with, or null if needsReview
  is false.
- Do not guess an answer. Only assess confidence.

## Business knowledge available
${knowledgeSummary || "No knowledge records configured."}

## Customer message
"""
${message}
"""

Return ONLY the JSON object — no markdown, no explanation.`;

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
        max_tokens: 100,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error("[assessAnswerConfidence] OpenAI error:", res.status);
      return { needsReview: false, reason: null };
    }

    const json = await res.json();
    const raw: string = json.choices?.[0]?.message?.content ?? "";
    const cleaned = raw
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned) as Partial<ConfidenceAssessment>;

    return {
      needsReview: parsed.needsReview === true,
      reason:
        typeof parsed.reason === "string" ? parsed.reason.trim() || null : null,
    };
  } catch (err) {
    console.error("[assessAnswerConfidence] parse error:", err);
    return { needsReview: false, reason: null };
  }
}

// ── capturePartialLead ───────────────────────────────────────────



interface LeadRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  service_needed: string | null;
  preferred_datetime: string | null;
  appointment_datetime: string | null;
  message: string | null;
  status: string;
  conversation_id: string | null;
}

const LEAD_SELECT_COLUMNS =
  "id, name, email, phone, service_needed, preferred_datetime, message, status, conversation_id";

/**
 * Resolves the correct open lead for this message using a layered
 * identity strategy. Returns null only when this is genuinely a new
 * enquiry with no resolvable connection to an existing open lead.
 */
async function findOpenLeadForCapture(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  conversationId: string | null,
  extracted: ExtractedLead,
  leadSource: string
): Promise<LeadRow | null> {

  // ── Layer 1: exact conversation_id match on a mergeable lead ─────
  if (conversationId) {
    const { data, error } = await supabase
      .from("leads")
      .select(LEAD_SELECT_COLUMNS)
      .eq("org_id", orgId)
      .eq("conversation_id", conversationId)
      .in("status", MERGEABLE_STATUSES)
      .maybeSingle();

    if (error) {
      console.error("[lead resolve] conversation_id lookup error:", error.message);
    } else if (data) {
      console.log("[lead resolve] matched via conversation_id:", data.id);
      return data as LeadRow;
    }
  }

  // ── Layer 2: known contact details on a mergeable lead ───────────
  if (extracted.email || extracted.phone) {
    let query = supabase
      .from("leads")
      .select(LEAD_SELECT_COLUMNS)
      .eq("org_id", orgId)
      .in("status", MERGEABLE_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1);

    if (extracted.email && extracted.phone) {
      query = query.or(`email.eq.${extracted.email},phone.eq.${extracted.phone}`);
    } else if (extracted.email) {
      query = query.eq("email", extracted.email);
    } else if (extracted.phone) {
      query = query.eq("phone", extracted.phone);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      console.error("[lead resolve] contact match lookup error:", error.message);
    } else if (data) {
      console.log("[lead resolve] matched via contact details:", data.id);
      return data as LeadRow;
    }

    // Customer gave contact info but it matched no existing lead —
    // this is a genuinely new/different person. Do not fall through
    // to the recency fallback, which could merge into an unrelated lead.
    console.log("[lead resolve] contact details given but no match — will insert new");
    return null;
  }

  // ── Layer 3: most recent mergeable lead in this org, bounded ─────
  // Only reached when the customer gave NO email/phone at all — e.g. a
  // bare "yes that works" reply with nothing else to identify them by.
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("leads")
    .select(LEAD_SELECT_COLUMNS)
    .eq("org_id", orgId)
    .eq("source", leadSource)
    .in("status", MERGEABLE_STATUSES)
    .gte("created_at", thirtyMinutesAgo)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[lead resolve] recency fallback lookup error:", error.message);
  } else if (data) {
    console.log("[lead resolve] matched via recency fallback:", data.id);
    return data as LeadRow;
  }

  console.log("[lead resolve] no mergeable lead found — will insert new");
  return null;
}


function isBookingConfirmed(
  intent: LeadIntent,
  appointmentIso: string | null,
  phone: string | null,
  email: string | null
): boolean {
  if (intent !== "new_booking" && intent !== "reschedule") return false;
  const hasContact = Boolean(phone || email);
  const hasConfirmedTime = Boolean(appointmentIso);
  return hasContact && hasConfirmedTime;
}

// ── Parse free-text datetime into ISO timestamp ──────────────────

async function resolveAppointmentDatetime(
  preferredDatetime: string | null
): Promise<{ iso: string | null; failed: boolean }> {
  return parseDatetimeToIso(preferredDatetime, "Europe/London");
}

async function getOrgOwnerEmail(
  orgId: string
): Promise<{ email: string; businessName: string } | null> {

  try {
    const admin = createAdminClient();

    const { data: org, error: orgError } = await admin
      .from("organisations")
      .select("owner_id, business_name")
      .eq("id", orgId)
      .single();

    if (orgError || !org?.owner_id) {
      console.error("[email] Could not resolve org owner:", orgError?.message);
      return null;
    }

    const { data: userData, error: userError } =
      await admin.auth.admin.getUserById(org.owner_id);

    if (userError || !userData?.user?.email) {
      console.error("[email] Could not resolve owner email:", userError?.message);
      return null;
    }

    return { email: userData.user.email, businessName: org.business_name ?? "the business" };
  } catch (err) {
    console.error("[email] Unexpected error resolving owner email:", err);
    return null;
  }
}


async function capturePartialLead(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  conversationId: string | null | undefined,
  userMessage: string,
  extracted: ExtractedLead,
  leadSource: string = "chat",
  needsReview: boolean = false
): Promise<{ outsideBusinessHours: boolean; suggestedAlternativeIso: string | null; unavailableReason: "hours" | "capacity" | null }> {


  const safeConversationId =
    typeof conversationId === "string" && conversationId.trim().length > 0
      ? conversationId.trim()
      : null;

  console.log("[lead capture] intent:", extracted.intent, "| conversationId:", safeConversationId);
  const { iso: resolvedIso, failed: datetimeParseFailed } =
    await resolveAppointmentDatetime(extracted.preferred_datetime);

  if (datetimeParseFailed) {
    console.error("[lead capture] datetime parsing failed for:", extracted.preferred_datetime);
  }
  let outsideBusinessHours = false;
  let suggestedAlternativeIso: string | null = null;
  let unavailableReason: "hours" | "capacity" | null = null;

    if (resolvedIso) {
    const availability = await isWithinBusinessHours(orgId, resolvedIso);
    const slotAvailable = availability.isAvailable
      ? await isSlotAvailable(orgId, resolvedIso)
      : true;

    if (!availability.isAvailable || !slotAvailable) {
      outsideBusinessHours = true;
      unavailableReason = !availability.isAvailable ? "hours" : "capacity";
      suggestedAlternativeIso = await findNextAvailableSlot(orgId, resolvedIso);
      console.log(
        "[lead capture] requested time unavailable:",
        resolvedIso,
        "| withinHours:",
        availability.isAvailable,
        "| reason:",
        availability.reason,
        "| slotAvailable:",
        slotAvailable,
        "| suggested:",
        suggestedAlternativeIso
      );
    }
  }



  

  const existing = await findOpenLeadForCapture(
    supabase,
    orgId,
    safeConversationId,
    extracted,
    leadSource
  );


  if (existing) {
    // ── Update path — merge into the existing open lead ───────────
    const updatedDatetime =
      extracted.intent === "reschedule" && extracted.preferred_datetime
        ? extracted.preferred_datetime
        : extracted.preferred_datetime ?? existing.preferred_datetime;

    const mergedEmail = extracted.email ?? existing.email;
    const mergedPhone = extracted.phone ?? existing.phone;

    const updatedAppointmentIso =
      extracted.intent === "reschedule" && extracted.preferred_datetime
        ? resolvedIso
        : resolvedIso ?? existing.appointment_datetime;

    const nextStatus: LeadStatus =
      PROTECTED_STATUSES.includes(existing.status as LeadStatus) ||
      existing.status === "booked"
        ? (existing.status as LeadStatus)
        : isBookingConfirmed(
            extracted.intent,
            updatedAppointmentIso,
            mergedPhone,
            mergedEmail
          ) && !outsideBusinessHours

        ? "booked"
        : needsReview
        ? "needs_review"
        : "new";


    const updatePayload = {
      name: shouldUpdateName(extracted.name, existing.name),
      email: mergedEmail,
      phone: mergedPhone,
      service_needed: shouldUpdateService(
        extracted.service,
        existing.service_needed,
        extracted.intent
      ),
      preferred_datetime: updatedDatetime,
      appointment_datetime: updatedAppointmentIso,
      message: deduplicateMessage(existing.message, userMessage),
      status: nextStatus,
      ai_confidence: extracted.confidence,
      ...(safeConversationId ? { conversation_id: safeConversationId } : {}),
    };



    const { error: updateError } = await supabase
      .from("leads")
      .update(updatePayload)
      .eq("id", existing.id);

    if (updateError) {
      console.error("[lead capture] update failed:", updateError.message);
    } else {
      console.log("[lead capture] updated existing lead:", existing.id);
      if (nextStatus === "booked" && existing.status !== "booked") {
      const ownerInfo = await getOrgOwnerEmail(orgId);
      sendBookingConfirmationEmails({
        customerName: extracted.name ?? existing.name,
        customerEmail: mergedEmail,
        businessName: ownerInfo?.businessName ?? "the business",
        businessOwnerEmail: ownerInfo?.email ?? null,
        appointmentDatetime: updatedAppointmentIso ?? existing.appointment_datetime ?? "",
        bookingReference: existing.id.slice(0, 8).toUpperCase(),
        serviceNeeded: existing.service_needed,
      }).catch((err) =>
        console.error("[email] Failed to send booking confirmation:", err)
      );
    }

    }

    return { outsideBusinessHours, suggestedAlternativeIso, unavailableReason };
  }

  // ── Insert path — genuinely new enquiry ──────────────────────────
  const insertStatus: LeadStatus = isBookingConfirmed(
  extracted.intent,
  resolvedIso,
  extracted.phone,
  extracted.email
) && !outsideBusinessHours
  ? "booked"
  : suggestedAlternativeIso
  ? "awaiting_confirmation"
  : needsReview
  ? "needs_review"
  : "new";



  const { data: inserted, error: insertError } = await supabase
    .from("leads")
    .insert({
      org_id: orgId,
      ...(safeConversationId ? { conversation_id: safeConversationId } : {}),
      source: leadSource,
      name: extracted.name,
      email: extracted.email,
      phone: extracted.phone,
      service_needed: extracted.service ?? userMessage,
      preferred_datetime: extracted.preferred_datetime,
      appointment_datetime: resolvedIso,
      message: userMessage,
      ai_confidence: extracted.confidence,
      status: insertStatus,
    })
    .select("id")
    .single();


  if (insertError) {
    console.error("[lead capture] insert failed:", insertError.message);
  } else {
    console.log("[lead capture] inserted new lead:", inserted?.id);
    if (insertStatus === "booked") {
      const ownerInfo = await getOrgOwnerEmail(orgId);
      sendBookingConfirmationEmails({
        customerName: extracted.name,
        customerEmail: extracted.email,
        businessName: ownerInfo?.businessName ?? "the business",
        businessOwnerEmail: ownerInfo?.email ?? null,
        appointmentDatetime: resolvedIso ?? "",
        bookingReference: (inserted?.id ?? "").slice(0, 8).toUpperCase(),
        serviceNeeded: extracted.service ?? userMessage,
      }).catch((err) =>
        console.error("[email] Failed to send booking confirmation:", err)
      );
    }

  }
return { outsideBusinessHours, suggestedAlternativeIso, unavailableReason };
}



// ── Knowledge types ──────────────────────────────────────────────

interface KnowledgeRecord {
  category: string;
  title: string;
  content: string;
  display_order: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  faq: "Frequently Asked Questions",
  service: "Services Offered",
  pricing: "Pricing",
  opening_hours: "Opening Hours",
  policy: "Policies",
  custom_instruction: "Additional Instructions",
};

const CUSTOM_INSTRUCTION_CATEGORY = "custom_instruction";

// ── System prompt builder ────────────────────────────────────────

function buildSystemPrompt(
  org: {
    business_name: string;
    business_type: string;
    primary_goal: string;
    description: string | null;
  },
  knowledge: KnowledgeRecord[],
  intent: LeadIntent = "unknown",
  suggestedAlternativeIso: string | null = null,
  unavailableReason: "hours" | "capacity" | null = null,
): string {

  const sections: string[] = [];

  // Identity
  sections.push(
    [
      `You are Remy, a professional AI assistant for ${org.business_name}.`,
      `Business type: ${org.business_type}.`,
      `Primary goal: ${org.primary_goal}.`,
      org.description ? `About the business: ${org.description}` : null,
    ]
      .filter(Boolean)
      .join("\n")
  );

  // Knowledge blocks
  if (knowledge.length > 0) {
    const standardKnowledge = knowledge.filter(
      (r) => r.category !== CUSTOM_INSTRUCTION_CATEGORY
    );
    const customInstructions = knowledge.filter(
      (r) => r.category === CUSTOM_INSTRUCTION_CATEGORY
    );

    if (standardKnowledge.length > 0) {
      sections.push("## Business Knowledge\n");

      const grouped = standardKnowledge.reduce<Record<string, KnowledgeRecord[]>>(
        (acc, record) => {
          if (!acc[record.category]) acc[record.category] = [];
          acc[record.category].push(record);
          return acc;
        },
        {}
      );

      for (const [category, label] of Object.entries(CATEGORY_LABELS)) {
        if (category === CUSTOM_INSTRUCTION_CATEGORY) continue;
        const records = grouped[category];
        if (!records || records.length === 0) continue;

        sections.push(
          [
            `### ${label}`,
            ...records.map((r) => `- ${r.title}: ${r.content}`),
          ].join("\n")
        );
      }
    }

    if (customInstructions.length > 0) {
      sections.push(
        [
          "## Your Behaviour Rules",
          "Follow these instructions precisely in every response:",
          ...customInstructions.map((r) => `- ${r.content}`),
        ].join("\n")
      );
    }
  }

  // Standing rules
  const isBookingContext =
    intent === "new_booking" ||
    intent === "reschedule" ||
    intent === "contact_update";

  sections.push(
    [
      "## Rules",
      "1. Use the business knowledge above when answering customer questions.",
      "2. Do not invent prices, hours, services, or policies not listed above.",
      isBookingContext
        ? "3. BOOKING MODE ACTIVE: The customer is making a booking request. Accept it immediately. Do NOT say you cannot help or that you lack details. Confirm the service back to them, thank them, and confirm the appointment details naturally. Never redirect them elsewhere."
        : "3. If a question falls outside the knowledge base, say you do not have that specific detail and suggest the customer contacts the team — EXCEPT for bookings, rescheduling, and lead capture, which you always handle directly in this chat.",
      "4. Be helpful, professional, and concise. Ask one question at a time when collecting information.",
      "5. When a customer wants to book or enquire about a service, collect their name, preferred time, and a contact method (phone or email) — one piece at a time.",
      "6. When a customer wants to reschedule or change a booking — including phrases like 'change to', 'update to', 'make it', 'actually', 'instead', 'reschedule', 'move to', 'how about', 'can we do', 'I'd prefer' followed by a time or date — respond warmly and confirm the new time. Example: 'Got it, I've updated your appointment to [new time]. Is there anything else I can help you with?'",
      "7. Never say you cannot change, update, or modify a booking. You capture customer preferences on behalf of the business. Booking changes are always handled here — never redirect the customer elsewhere for this.",
      "8. Never repeat back a long transcript. Keep confirmations short and friendly.",
      "9. When a customer requests any service — even one not listed in the knowledge base — always accept it as a booking. Say something like: 'Thank you, I've noted your request for [service]. Let me confirm your appointment details.' Never say you don't have information about a service when the customer is trying to book it.",
    ].join("\n")
  );

  if (suggestedAlternativeIso) {
    const formatted = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(suggestedAlternativeIso));

    sections.push(
      [
        "## Availability Note",
unavailableReason === "capacity"
  ? `The customer's requested time is unfortunately already booked (fully booked for that slot). Politely let them know it's no longer available, and suggest ${formatted} as the nearest available alternative instead. Do not confirm the original requested time as booked.`
  : `The customer's requested time is outside business hours. Politely let them know, and suggest ${formatted} as the nearest available alternative instead. Do not confirm the original requested time as booked.`

      ].join("\n")
    );
  }
return sections.join("\n\n");
}

// ── POST handler ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

const { messages, conversationId, orgId, source } = await req.json();

  if (!messages || !conversationId || !orgId) {
    return new Response("Missing required fields", { status: 400 });
  }

  const leadSource = source === "dashboard_preview" ? "dashboard_preview" : "chat";


  if (!messages || !conversationId || !orgId) {
    return new Response("Missing required fields", { status: 400 });
  }

  // ── Lead extraction — every message, no keyword filter ───────────
  const latestUserMessage: string =
    [...messages]
      .reverse()
      .find((m: { role: string }) => m.role === "user")?.content ?? "";
let detectedIntent: LeadIntent = "unknown";
let outsideBusinessHours = false;
  let suggestedAlternativeIso: string | null = null;
  let unavailableReason: "hours" | "capacity" | null = null;

      if (latestUserMessage) {
    try {
      const extracted = await extractLeadData(latestUserMessage);
      detectedIntent = extracted.intent;

      console.log("[post handler] extraction complete — intent:", extracted.intent);
      console.log("[post handler] conversationId passed to capture:", conversationId);

      if (ACTIONABLE_INTENTS.includes(extracted.intent)) {
        const captureResult = await capturePartialLead(
          supabase,
          orgId,
          conversationId,
          latestUserMessage,
          extracted,
          leadSource
        );

        outsideBusinessHours = captureResult.outsideBusinessHours;
        suggestedAlternativeIso = captureResult.suggestedAlternativeIso;
        unavailableReason = captureResult.unavailableReason;

      } else {
        console.log("[post handler] intent not actionable — checking answer confidence");

        try {
          const knowledgeResultForCheck = await supabase
            .from("business_knowledge")
            .select("category, title, content")
            .eq("org_id", orgId)
            .eq("is_active", true);

          const knowledgeSummary = (knowledgeResultForCheck.data ?? [])
            .map((r) => `- ${r.title}: ${r.content}`)
            .join("\n");

          const assessment = await assessAnswerConfidence(
            latestUserMessage,
            knowledgeSummary
          );

          if (assessment.needsReview) {
            console.log("[post handler] low confidence — flagging for review:", assessment.reason);
            await capturePartialLead(
              supabase,
              orgId,
              conversationId,
              latestUserMessage,
              extracted,
              leadSource,
              true
            );
          }
        } catch (err) {
          console.error("[post handler] confidence check error:", err);
        }
      }


    } catch (err) {
      console.error("[post handler] lead extraction/capture error:", err);
    }
  }


  // ── Fetch org + knowledge in parallel ───────────────────────────
  const [orgResult, knowledgeResult] = await Promise.all([
    supabase
      .from("organisations")
      .select("business_name, business_type, primary_goal, description")
      .eq("id", orgId)
      .maybeSingle(),

    supabase
      .from("business_knowledge")
      .select("category, title, content, display_order")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .order("category", { ascending: true })
      .order("display_order", { ascending: true }),
  ]);

  const org = orgResult.data;
  const knowledge: KnowledgeRecord[] = knowledgeResult.data ?? [];

  const systemPrompt = org
    ? buildSystemPrompt(org, knowledge, detectedIntent, suggestedAlternativeIso, unavailableReason)
    : "You are Remy, a helpful AI business assistant. Be concise and professional.";

  // ── Streaming response ───────────────────────────────────────────
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const openaiKey = process.env.OPENAI_API_KEY;

        if (!openaiKey) {
          const knowledgeSummary =
            knowledge.length > 0
              ? `I have ${knowledge.length} knowledge record(s) loaded across ${[...new Set(knowledge.map((r) => r.category))].length} category(ies).`
              : "No knowledge records are configured yet.";

          const stubReply = [
            `Hi! I'm Remy, your AI assistant for ${org?.business_name ?? "your business"}.`,
            knowledgeSummary,
            "Add OPENAI_API_KEY to your environment to enable real AI responses.",
          ].join(" ");

          for (const char of stubReply) {
            controller.enqueue(encoder.encode(char));
            await new Promise((r) => setTimeout(r, 18));
          }

          controller.enqueue(encoder.encode("\n__DONE__"));
          controller.close();
          return;
        }

        // ── Real OpenAI streaming ──────────────────────────────────
        const openaiRes = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${openaiKey}`,
            },
            body: JSON.stringify({
              model: "gpt-4o",
              stream: true,
              messages: [
                { role: "system", content: systemPrompt },
                ...messages.map((m: { role: string; content: string }) => ({
                  role: m.role,
                  content: m.content,
                })),
              ],
            }),
          }
        );

        if (!openaiRes.ok || !openaiRes.body) {
          throw new Error(`OpenAI error: ${openaiRes.status}`);
        }

        const reader = openaiRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === "data: [DONE]") continue;
            if (!trimmed.startsWith("data: ")) continue;

            try {
              const json = JSON.parse(trimmed.slice(6));
              const token = json.choices?.[0]?.delta?.content;
              if (token) controller.enqueue(encoder.encode(token));
            } catch {
              // malformed chunk — skip
            }
          }
        }

        controller.enqueue(encoder.encode("\n__DONE__"));
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Stream error";
        controller.enqueue(encoder.encode(`\n__ERROR__:${msg}`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}