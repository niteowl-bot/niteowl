import { createClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { sendNeedsReviewNotification } from "@/lib/email";
import { hasActiveAccess } from "@/lib/billing/access";
import { buildPausedChatResponse } from "@/lib/billing/pausedReply";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  type LeadIntent,
  type ExtractedLead,
  EMPTY_LEAD,
  ACTIONABLE_INTENTS,
  assessAnswerConfidence,
  buildConversationTranscript,
  capturePartialLead,
  getOrgOwnerEmail,
  hasNeedsReviewNotificationBeenSent,
  isServiceConfirmedByKnowledge,
  markNeedsReviewNotificationSent,
  resolveEscalationQuestion,
} from "@/lib/leadCapture";

export const runtime = "nodejs";

// Lead extraction types, merge helpers, confidence check, and the
// capturePartialLead engine live in @/lib/leadCapture — shared with
// the public widget route (route files may only export handlers).

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
      signal: AbortSignal.timeout(15_000),
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
    website: string | null;
  },
  knowledge: KnowledgeRecord[],
  intent: LeadIntent = "unknown",
  suggestedAlternativeIso: string | null = null,
  unavailableReason: "hours" | "capacity" | null = null,
  handoffAskContact: boolean = false,
  handoffContactCaptured: boolean = false
): string {

  const sections: string[] = [];

  // Identity
  sections.push(
    [
      `You are Remy, a professional AI assistant for ${org.business_name}.`,
      `Business type: ${org.business_type}.`,
      `Primary goal: ${org.primary_goal}.`,
      org.description ? `About the business: ${org.description}` : null,
      org.website ? `Website: ${org.website}` : null,
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
      "9. When a customer requests a service, treat it as a genuine request and move the conversation forward — never redirect them elsewhere just because it isn't phrased exactly like an FAQ entry. However, only confirm an appointment as booked if the service is one the business knowledge above actually confirms; if it is NOT confirmed there, follow rule 11 instead of this one.",
      "10. When a customer asks to speak to a person, a human, a team member, or asks how to contact the business directly, do NOT redirect them elsewhere and do NOT mention the website, a phone number, or any contact details as something they should go find themselves. Instead, act like a professional receptionist taking the message: offer to arrange a callback, and collect their name, phone number, email, and preferred time to be contacted — one piece at a time. You are how they reach the business.",
      "11. Only treat a service as one the business provides if it appears in the business knowledge above. If a customer asks about or wants to book a service that is NOT listed there, do not confirm it, do not imply the business offers it, and do not say the appointment is booked or confirmed — this overrides rule 9. Still collect their name, best contact method, and preferred day and time, and record the service EXACTLY as they described it — never renamed, reworded, or labelled as a \"general enquiry\". Tell them: \"I'll pass your request to our team. They'll confirm whether we can provide that service and, if we can, they'll arrange your appointment.\" Make clear that neither the service nor the appointment is confirmed yet.",
      "12. If more than one entry in the business knowledge above could answer the same question, use the most specific one — never list or repeat multiple entries at the customer. If two entries genuinely conflict (e.g. different prices for what sounds like the same thing), do not guess which is correct: say a team member will confirm the exact details, then collect their name and best contact method.",
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
  if (handoffAskContact) {
    sections.push(
      [
        "IMPORTANT — HUMAN HANDOFF MODE:",
        "You could not confidently answer the customer's last question. A team member will follow up personally.",
        "In your reply: politely let the customer know a team member will help with their question.",
        "Ask for their name, the best email address or phone number to reach them on, and their preferred time to be contacted, if they have not already provided these.",
        "Do NOT attempt to answer the original question yourself.",
        "Do NOT redirect them elsewhere (never mention the website, a phone number, or contact details as something to go find themselves) — you are collecting their details directly so the team can reach out.",
        "Reassure them someone will be in touch shortly. Keep it warm and brief.",
      ].join("\n")
    );
  }

  if (handoffContactCaptured) {
    sections.push(
      [
        "IMPORTANT — HUMAN HANDOFF MODE (contact details already provided):",
        "You could not confidently answer the customer's last question. A team member will personally review it and be in touch shortly using the contact details the customer has already provided.",
        "These instructions override every rule above for this reply:",
        "- Do NOT attempt to answer the original question yourself.",
        "- Do NOT confirm or deny that the business provides the service they asked about.",
        "- Do NOT treat this as a booking. Do NOT ask for a preferred time, date, or appointment details.",
        "- Do NOT ask for contact details again.",
        "In your reply: thank them, confirm a team member will review their enquiry and be in touch shortly. Keep it warm and brief.",
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

  // Authenticated, but each message can trigger up to 3 OpenAI calls —
  // an unbounded loop against this route runs up OpenAI billing the
  // same way the public widget route's rate limiting was added to
  // prevent (see /api/widget/chat).
  if (!checkRateLimit(`chat-user:${user.id}`, 20, 60_000)) {
    return new Response("Too many requests", { status: 429 });
  }

const { messages, conversationId, orgId, source, includeDrafts } = await req.json();

  if (!messages || !conversationId || !orgId) {
    return new Response("Missing required fields", { status: 400 });
  }

  const leadSource = source === "dashboard_preview" ? "dashboard_preview" : "chat";

  // Draft Knowledge Base entries (AI-imported, not yet published) are
  // only ever visible here — never to the public widget or voice — and
  // only when the dashboard preview explicitly opts in, so an owner can
  // test unpublished content before making it live. See
  // docs/sql/2026-07-16_knowledge_import_extend_business_knowledge.sql.
  const showDraftKnowledge = leadSource === "dashboard_preview" && includeDrafts === true;


  if (!messages || !conversationId || !orgId) {
    return new Response("Missing required fields", { status: 400 });
  }

  // ── Fetch org early — also needed by the confidence check below,
  // so identity questions ("what's my business called") aren't
  // treated as outside the knowledge base ─────────────────────────
  const { data: org } = await supabase
    .from("organisations")
    .select(
      "business_name, business_type, primary_goal, description, website, subscription_status, trial_ends_at"
    )
    .eq("id", orgId)
    .eq("owner_id", user.id)
    .maybeSingle();

  // ── Billing gate — a lapsed trial/subscription stops Remy from
  // answering entirely, before any lead capture or OpenAI call ──────
  if (org && !hasActiveAccess(org)) {
    return buildPausedChatResponse();
  }

  // ── Lead extraction — every message, no keyword filter ───────────
  const latestUserMessage: string =
    [...messages]
      .reverse()
      .find((m: { role: string }) => m.role === "user")?.content ?? "";
  const conversationTranscript = buildConversationTranscript(messages);
let detectedIntent: LeadIntent = "unknown";
let outsideBusinessHours = false;
  let suggestedAlternativeIso: string | null = null;
  let unavailableReason: "hours" | "capacity" | null = null;
  let handoffAskContact = false;
  let handoffContactCaptured = false;

      if (latestUserMessage && org) {
    try {
      const extracted = await extractLeadData(latestUserMessage);

      // Unconfirmed-service guard — shared with voice AI
      // (isServiceConfirmedByKnowledge in leadCapture.ts). Downgrading
      // the intent BEFORE it reaches ACTIONABLE_INTENTS/capturePartialLead
      // is what stops isBookingConfirmed() there from ever marking this
      // "booked" or sending the booking-confirmation email; a
      // confirmed-service booking never enters this branch, so that
      // path is unchanged.
      let serviceConfirmed = true;
      if (extracted.intent === "new_booking" && extracted.service) {
        serviceConfirmed = await isServiceConfirmedByKnowledge(
          supabase,
          orgId,
          extracted.service
        );
        if (!serviceConfirmed) {
          extracted.intent = "question";
        }
      }

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
          leadSource,
          false,
          conversationTranscript
        );

        outsideBusinessHours = captureResult.outsideBusinessHours;
        suggestedAlternativeIso = captureResult.suggestedAlternativeIso;
        unavailableReason = captureResult.unavailableReason;

        if (captureResult.needsReviewContactCaptured) {
          handoffContactCaptured = true;
        }

        // A "contact_update" message can carry a genuine question or
        // complaint alongside the contact details (e.g. "My plumber
        // damaged my ceiling, my email is x@y.com") — extractLeadData
        // tags these contact_update purely because contact details are
        // present, which previously skipped the confidence check
        // entirely: the lead saved as an ordinary lead and the owner
        // was never notified, even though Remy's own reply already told
        // the customer a team member would follow up. Run the same
        // check used for question/unknown intents here too.
        if (extracted.intent === "contact_update") {
          try {
            let knowledgeCheckQuery = supabase
              .from("business_knowledge")
              .select("category, title, content")
              .eq("org_id", orgId)
              .eq("is_active", true);
            if (!showDraftKnowledge) {
              knowledgeCheckQuery = knowledgeCheckQuery.eq("status", "published");
            }
            const knowledgeResultForCheck = await knowledgeCheckQuery;

            const identitySummary = org
              ? [
                  `- Business name: ${org.business_name}`,
                  `- Business type: ${org.business_type}`,
                  `- Primary goal: ${org.primary_goal}`,
                  org.description ? `- About: ${org.description}` : null,
                  org.website ? `- Website: ${org.website}` : null,
                ]
                  .filter(Boolean)
                  .join("\n")
              : "";

            const knowledgeSummary = [
              identitySummary,
              ...(knowledgeResultForCheck.data ?? []).map(
                (r) => `- ${r.title}: ${r.content}`
              ),
            ]
              .filter(Boolean)
              .join("\n");

            const assessment = await assessAnswerConfidence(
              latestUserMessage,
              knowledgeSummary
            );

            if (assessment.needsReview) {
              console.log(
                "[post handler] low confidence on contact_update — flagging for review:",
                assessment.reason
              );

              const reviewResult = await capturePartialLead(
                supabase,
                orgId,
                conversationId,
                latestUserMessage,
                extracted,
                leadSource,
                true,
                conversationTranscript
              );

              handoffContactCaptured = true;

              const alreadyNotified = await hasNeedsReviewNotificationBeenSent(
                supabase,
                reviewResult.leadId,
                conversationId
              );

              if (alreadyNotified) {
                console.log(
                  "[post handler] needs-review notification already sent for lead:",
                  reviewResult.leadId
                );
              } else {
                const ownerInfo = await getOrgOwnerEmail(orgId);
                const notificationSent = await sendNeedsReviewNotification({
                  businessOwnerEmail: ownerInfo?.email ?? null,
                  businessName: ownerInfo?.businessName ?? "the business",
                  customerName: extracted.name,
                  customerEmail: extracted.email,
                  customerPhone: extracted.phone,
                  question: resolveEscalationQuestion(
                    latestUserMessage,
                    extracted.email,
                    extracted.phone
                  ),
                  escalationReason: assessment.reason,
                  conversationContext: conversationTranscript,
                  leadId: reviewResult.leadId,
                });

                if (notificationSent) {
                  await markNeedsReviewNotificationSent(
                    supabase,
                    reviewResult.leadId,
                    conversationId
                  );
                }
              }
            }
          } catch (err) {
            console.error(
              "[post handler] confidence check error (contact_update):",
              err
            );
          }
        }

      } else if (!serviceConfirmed) {
        // Deterministic unconfirmed-service capture — same behaviour as
        // voice AI. Does not depend on assessAnswerConfidence (whose own
        // rules explicitly treat "any booking-related message" as not
        // needing review, which would otherwise silently drop this
        // enquiry instead of capturing it).
        console.log("[post handler] service not confirmed by knowledge base — capturing as awaiting confirmation");

        const captureResult = await capturePartialLead(
          supabase,
          orgId,
          conversationId,
          latestUserMessage,
          extracted,
          leadSource,
          true,
          conversationTranscript
        );

        if (captureResult.leadId) {
          const { error: statusError } = await supabase
            .from("leads")
            .update({ status: "awaiting_confirmation" })
            .eq("id", captureResult.leadId);
          if (statusError) {
            console.error(
              "[post handler] failed to set awaiting_confirmation status:",
              statusError.message
            );
          }
          if (extracted.email || extracted.phone) {
            handoffContactCaptured = true;
          }
        }
      } else {
        console.log("[post handler] intent not actionable — checking answer confidence");

        try {
          let knowledgeCheckQuery = supabase
            .from("business_knowledge")
            .select("category, title, content")
            .eq("org_id", orgId)
            .eq("is_active", true);
          if (!showDraftKnowledge) {
            knowledgeCheckQuery = knowledgeCheckQuery.eq("status", "published");
          }
          const knowledgeResultForCheck = await knowledgeCheckQuery;

          const identitySummary = org
            ? [
                `- Business name: ${org.business_name}`,
                `- Business type: ${org.business_type}`,
                `- Primary goal: ${org.primary_goal}`,
                org.description ? `- About: ${org.description}` : null,
                org.website ? `- Website: ${org.website}` : null,
              ]
                .filter(Boolean)
                .join("\n")
            : "";

          const knowledgeSummary = [
            identitySummary,
            ...(knowledgeResultForCheck.data ?? []).map(
              (r) => `- ${r.title}: ${r.content}`
            ),
          ]
            .filter(Boolean)
            .join("\n");

          const assessment = await assessAnswerConfidence(
            latestUserMessage,
            knowledgeSummary
          );

          if (assessment.needsReview) {
  console.log("[post handler] low confidence — flagging for review:", assessment.reason);
  const reviewResult = await capturePartialLead(
    supabase,
    orgId,
    conversationId,
    latestUserMessage,
    extracted,
    leadSource,
    true,
    conversationTranscript
  );

  const hasContact = Boolean(extracted.email || extracted.phone);

      if (hasContact) {

  // Contact details already provided — reply must be a human handoff,
  // whether or not the owner notification was deduplicated.
  handoffContactCaptured = true;

  const alreadyNotified = await hasNeedsReviewNotificationBeenSent(
    supabase,
    reviewResult.leadId,
    conversationId
  );

  if (alreadyNotified) {
    console.log(
      "[post handler] needs-review notification already sent for lead:",
      reviewResult.leadId
    );
  } else {
    const ownerInfo = await getOrgOwnerEmail(orgId);
    const notificationSent = await sendNeedsReviewNotification({
      businessOwnerEmail: ownerInfo?.email ?? null,
      businessName: ownerInfo?.businessName ?? "the business",
      customerName: extracted.name,
      customerEmail: extracted.email,
      customerPhone: extracted.phone,
      question: resolveEscalationQuestion(latestUserMessage, extracted.email, extracted.phone),
      escalationReason: assessment.reason,
      conversationContext: conversationTranscript,
      leadId: reviewResult.leadId,
    });

    if (notificationSent) {
      await markNeedsReviewNotificationSent(supabase, reviewResult.leadId, conversationId);
    }
  }
} else {
        handoffAskContact = true;
      }
    }


        } catch (err) {
          console.error("[post handler] confidence check error:", err);
        }
      }


    } catch (err) {
      console.error("[post handler] lead extraction/capture error:", err);
    }
  }


  // ── Fetch knowledge (org was already fetched above) ──────────────
  let knowledgeQuery = supabase
    .from("business_knowledge")
    .select("category, title, content, display_order")
    .eq("org_id", orgId)
    .eq("is_active", true);
  if (!showDraftKnowledge) {
    knowledgeQuery = knowledgeQuery.eq("status", "published");
  }
  const { data: knowledgeData } = await knowledgeQuery
    .order("category", { ascending: true })
    .order("display_order", { ascending: true });

  const knowledge: KnowledgeRecord[] = knowledgeData ?? [];

  const systemPrompt = org
    ? buildSystemPrompt(org, knowledge, detectedIntent, suggestedAlternativeIso, unavailableReason, handoffAskContact, handoffContactCaptured)
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
            signal: AbortSignal.timeout(30_000),
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