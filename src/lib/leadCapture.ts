import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseDatetimeToIso } from "@/lib/parseDatetime";
import { isWithinBusinessHours, findNextAvailableSlot, isSlotAvailable } from "@/lib/availability";
import { sendBookingConfirmationEmails, sendNeedsReviewNotification } from "@/lib/email";

// ── Shared lead-capture engine ───────────────────────────────────
// Moved verbatim from src/app/api/chat/route.ts so the public widget
// route can reuse the exact same engine. Next.js route files may only
// export route handlers, so shared helpers must live outside app/api.

// Accepts both the RLS-scoped server client (dashboard chat) and the
// service-role admin client (public widget route, which scopes by
// org_id in application code instead).
type DatabaseClient =
  | Awaited<ReturnType<typeof createClient>>
  | ReturnType<typeof createAdminClient>;

// ── Lead extraction types ────────────────────────────────────────

export type LeadIntent =
  | "new_booking"
  | "reschedule"
  | "contact_update"
  | "question"
  | "unknown";

export interface ExtractedLead {
  intent: LeadIntent;
  name: string | null;
  email: string | null;
  phone: string | null;
  service: string | null;
  preferred_datetime: string | null;
  confidence: number;
}

export const EMPTY_LEAD: ExtractedLead = {
  intent: "unknown",
  name: null,
  email: null,
  phone: null,
  service: null,
  preferred_datetime: null,
  confidence: 0,
};

export const ACTIONABLE_INTENTS: LeadIntent[] = [
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
export const OPEN_LEAD_STATUSES: LeadStatus[] = ["new", "awaiting_confirmation", "contacted", "qualified", "needs_review"];

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
export async function assessAnswerConfidence(
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
- The customer is chatting with Remy, the AI receptionist FOR the
  business described in the knowledge below. Any question about the
  business itself (its name, type, or what it does) is always
  answerable from that identity info — never treat these as unclear.
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
  manage_token: string | null;
}

const LEAD_SELECT_COLUMNS =
  "id, name, email, phone, service_needed, preferred_datetime, appointment_datetime, message, status, conversation_id, manage_token";

/**
 * Resolves the correct open lead for this message using a layered
 * identity strategy. Returns null only when this is genuinely a new
 * enquiry with no resolvable connection to an existing open lead.
 */
async function findOpenLeadForCapture(
  supabase: DatabaseClient,
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

// A booking often completes over two turns: one message states the
// requested time (intent: new_booking), a later one — in reply to Remy
// asking for details — supplies only contact info (intent: contact_update).
// extractLeadData() classifies intent per-message with no conversation
// history, so that second turn never looks like a booking on its own.
// This only fires once a time was already confirmed on the existing lead,
// so it can't mark an unrelated contact-info correction as booked.
function isBookingCompletedByContactUpdate(
  intent: LeadIntent,
  hadAppointmentAlready: boolean,
  appointmentIso: string | null,
  phone: string | null,
  email: string | null
): boolean {
  if (intent !== "contact_update") return false;
  if (!hadAppointmentAlready) return false;
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

export async function getOrgOwnerEmail(
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


// ── Needs-review notification dedup ──────────────────────────────
// The needs-review notification must only be sent once per review
// episode, scoped by conversation: leads are merged across
// conversations by contact details, so a lead-lifetime flag would
// permanently silence notifications for returning customers. The flag
// lives in the leads.metadata JSONB column as
// needs_review_notification_sent = true plus the conversation it was
// sent for. On any read/write failure we fall back to sending rather
// than risk losing the notification entirely.

export async function hasNeedsReviewNotificationBeenSent(
  supabase: DatabaseClient,
  leadId: string | null,
  conversationId: string | null
): Promise<boolean> {
  if (!leadId || !conversationId) return false;

  try {
    const { data } = await supabase
      .from("leads")
      .select("metadata")
      .eq("id", leadId)
      .maybeSingle();

    const metadata = (data?.metadata ?? {}) as Record<string, unknown>;
    return (
      metadata.needs_review_notification_sent === true &&
      metadata.needs_review_notified_conversation_id === conversationId
    );
  } catch (err) {
    console.error("[needs-review] Failed to read notification flag:", err);
    return false;
  }
}

export async function markNeedsReviewNotificationSent(
  supabase: DatabaseClient,
  leadId: string | null,
  conversationId: string | null
): Promise<void> {
  if (!leadId) return;

  try {
    const { data } = await supabase
      .from("leads")
      .select("metadata")
      .eq("id", leadId)
      .maybeSingle();

    const metadata = {
      ...((data?.metadata as Record<string, unknown>) ?? {}),
      needs_review_notification_sent: true,
      needs_review_notified_conversation_id: conversationId,
    };

    const { error } = await supabase
      .from("leads")
      .update({ metadata })
      .eq("id", leadId);

    if (error) {
      console.error("[needs-review] Failed to set notification flag:", error.message);
    }
  } catch (err) {
    console.error("[needs-review] Failed to set notification flag:", err);
  }
}


export async function capturePartialLead(
  supabase: DatabaseClient,
  orgId: string,
  conversationId: string | null | undefined,
  userMessage: string,
  extracted: ExtractedLead,
  leadSource: string = "chat",
  needsReview: boolean = false
): Promise<{ outsideBusinessHours: boolean; suggestedAlternativeIso: string | null; unavailableReason: "hours" | "capacity" | null; leadId: string | null; needsReviewContactCaptured?: boolean }> {


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
        : (isBookingConfirmed(
            extracted.intent,
            updatedAppointmentIso,
            mergedPhone,
            mergedEmail
          ) ||
            isBookingCompletedByContactUpdate(
              extracted.intent,
              Boolean(existing.appointment_datetime),
              updatedAppointmentIso,
              mergedPhone,
              mergedEmail
            )) && !outsideBusinessHours

        ? "booked"
        : needsReview
        ? "needs_review"
        : existing.status === "needs_review"
        ? "needs_review"
        : "new";


    // Every lead gets a manage_token so a booking-confirmation email can
    // always link to the self-service cancel/reschedule page, even for
    // leads that started life before reaching "booked" (e.g. a "new" lead
    // that only becomes a real booking once contact details arrive later).
    const manageToken = existing.manage_token ?? crypto.randomUUID();

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
      manage_token: manageToken,
      ...(safeConversationId ? { conversation_id: safeConversationId } : {}),
    };



    const { error: updateError } = await supabase
      .from("leads")
      .update(updatePayload)
      .eq("id", existing.id);

    // A lead under review that just gained contact details (actionable
    // intents only — the low-confidence flow handles its own notification)
    // must trigger the pending owner notification and a handoff reply.
    let needsReviewContactCaptured = false;

    if (updateError) {
      console.error("[lead capture] update failed:", updateError.message);
    } else {
      console.log("[lead capture] updated existing lead:", existing.id);

      if (
        !needsReview &&
        nextStatus === "needs_review" &&
        Boolean(mergedEmail || mergedPhone)
      ) {
        needsReviewContactCaptured = true;

        const alreadyNotified = await hasNeedsReviewNotificationBeenSent(
          supabase,
          existing.id,
          safeConversationId
        );

        if (alreadyNotified) {
          console.log(
            "[needs-review] notification already sent for this conversation — skipping (contact capture path)"
          );
        } else {
          const ownerInfo = await getOrgOwnerEmail(orgId);
          const notificationSent = await sendNeedsReviewNotification({
            businessOwnerEmail: ownerInfo?.email ?? null,
            businessName: ownerInfo?.businessName ?? "the business",
            customerName: extracted.name ?? existing.name,
            customerEmail: mergedEmail,
            customerPhone: mergedPhone,
            question: existing.message ?? userMessage,
            conversationContext: null,
            leadId: existing.id,
          });

          if (notificationSent) {
            await markNeedsReviewNotificationSent(supabase, existing.id, safeConversationId);
          }
        }
      }

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
        manageToken,
      }).catch((err) =>
        console.error("[email] Failed to send booking confirmation:", err)
      );
    }

    }

    return { outsideBusinessHours, suggestedAlternativeIso, unavailableReason, leadId: existing.id, needsReviewContactCaptured };
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



  const manageToken = crypto.randomUUID();

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
      manage_token: manageToken,
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
        manageToken,
      }).catch((err) =>
        console.error("[email] Failed to send booking confirmation:", err)
      );
    }

  }
return { outsideBusinessHours, suggestedAlternativeIso, unavailableReason, leadId: inserted?.id ?? null };
}
