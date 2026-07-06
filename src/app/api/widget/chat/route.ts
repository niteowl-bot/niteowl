import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  assessAnswerConfidence,
  capturePartialLead,
  getOrgOwnerEmail,
  hasNeedsReviewNotificationBeenSent,
  markNeedsReviewNotificationSent,
} from "@/lib/leadCapture";
import { sendNeedsReviewNotification } from "@/lib/email";
import { hasActiveAccess } from "@/lib/billing/access";
import { buildPausedChatResponse } from "@/lib/billing/pausedReply";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

// ── Types (mirrors chat/route.ts) ─────────────────────────────────

type LeadIntent = "new_booking" | "reschedule" | "contact_update" | "question" | "unknown";

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

const ACTIONABLE_INTENTS: LeadIntent[] = ["new_booking", "reschedule", "contact_update"];

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

// ── extractLeadData (identical logic to chat/route.ts) ────────────

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

    if (!res.ok) return { ...EMPTY_LEAD, confidence: 0.5 };

    const json = await res.json();
    const raw: string = json.choices?.[0]?.message?.content ?? "";
    const cleaned = raw
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned) as Partial<ExtractedLead>;
    const validIntents: LeadIntent[] = ["new_booking", "reschedule", "contact_update", "question", "unknown"];

    return {
      intent: typeof parsed.intent === "string" && validIntents.includes(parsed.intent as LeadIntent)
        ? (parsed.intent as LeadIntent) : "unknown",
      name: typeof parsed.name === "string" ? parsed.name.trim() || null : null,
      email: typeof parsed.email === "string" ? parsed.email.trim() || null : null,
      phone: typeof parsed.phone === "string" ? parsed.phone.trim() || null : null,
      service: typeof parsed.service === "string" ? parsed.service.trim() || null : null,
      preferred_datetime: typeof parsed.preferred_datetime === "string" ? parsed.preferred_datetime.trim() || null : null,
      confidence: typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
    };
  } catch (err) {
    console.error("[widget extractLeadData] parse error:", err);
    return { ...EMPTY_LEAD, confidence: 0.5 };
  }
}

// ── System prompt builder (identical to chat/route.ts) ────────────

function buildSystemPrompt(
  org: { business_name: string; business_type: string; primary_goal: string; description: string | null; website: string | null },
  knowledge: KnowledgeRecord[],
  intent: LeadIntent = "unknown",
  suggestedAlternativeIso: string | null = null,
  unavailableReason: "hours" | "capacity" | null = null,
  handoffAskContact: boolean = false,
  handoffContactCaptured: boolean = false
): string {
  const sections: string[] = [];

  sections.push(
    [
      `You are Remy, a professional AI assistant for ${org.business_name}.`,
      `Business type: ${org.business_type}.`,
      `Primary goal: ${org.primary_goal}.`,
      org.description ? `About the business: ${org.description}` : null,
      org.website ? `Website: ${org.website}` : null,
    ].filter(Boolean).join("\n")
  );

  if (knowledge.length > 0) {
    const standardKnowledge = knowledge.filter((r) => r.category !== CUSTOM_INSTRUCTION_CATEGORY);
    const customInstructions = knowledge.filter((r) => r.category === CUSTOM_INSTRUCTION_CATEGORY);

    if (standardKnowledge.length > 0) {
      sections.push("## Business Knowledge\n");
      const grouped = standardKnowledge.reduce<Record<string, KnowledgeRecord[]>>((acc, record) => {
        if (!acc[record.category]) acc[record.category] = [];
        acc[record.category].push(record);
        return acc;
      }, {});

      for (const [category, label] of Object.entries(CATEGORY_LABELS)) {
        if (category === CUSTOM_INSTRUCTION_CATEGORY) continue;
        const records = grouped[category];
        if (!records || records.length === 0) continue;
        sections.push([`### ${label}`, ...records.map((r) => `- ${r.title}: ${r.content}`)].join("\n"));
      }
    }

    if (customInstructions.length > 0) {
      sections.push(
        ["## Your Behaviour Rules", "Follow these instructions precisely in every response:",
          ...customInstructions.map((r) => `- ${r.content}`)].join("\n")
      );
    }
  }

  const isBookingContext = intent === "new_booking" || intent === "reschedule" || intent === "contact_update";

  sections.push(
    [
      "## Rules",
      "1. Use the business knowledge above when answering customer questions.",
      "2. Do not invent prices, hours, services, or policies not listed above.",
      isBookingContext
        ? "3. BOOKING MODE ACTIVE: The customer is making a booking request. Accept it immediately. Confirm the service back to them, thank them, and confirm the appointment details naturally."
        : "3. If a question falls outside the knowledge base, say you do not have that specific detail and suggest the customer contacts the team — EXCEPT for bookings, rescheduling, and lead capture, which you always handle directly in this chat.",
      "4. Be helpful, professional, and concise. Ask one question at a time when collecting information.",
      "5. When a customer wants to book or enquire about a service, collect their name, preferred time, and a contact method (phone or email) — one piece at a time.",
      "6. Never say you cannot change, update, or modify a booking.",
      "7. Never repeat back a long transcript. Keep confirmations short and friendly.",
      "8. When a customer asks to speak to a person, a human, a team member, or asks how to contact the business directly, do NOT redirect them elsewhere and do NOT mention the website, a phone number, or any contact details as something they should go find themselves. Instead, act like a professional receptionist taking the message: offer to arrange a callback, and collect their name, phone number, email, and preferred time to be contacted — one piece at a time. You are how they reach the business.",
    ].join("\n")
  );

  if (suggestedAlternativeIso) {
    const formatted = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
    }).format(new Date(suggestedAlternativeIso));

    sections.push(
      [
        "## Availability Note",
        unavailableReason === "capacity"
          ? `The customer's requested time is unfortunately already fully booked. Politely let them know it's no longer available, and suggest ${formatted} as the nearest available alternative instead.`
          : `The customer's requested time is outside business hours. Politely let them know, and suggest ${formatted} as the nearest available alternative instead.`,
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

// ── Widget conversation linking ────────────────────────────────────
// leads.conversation_id has an FK to conversations, and lead merging
// matches by conversation id. The widget's conversation id is a
// client-generated UUID from an unauthenticated, public surface, so it
// must be validated and org-scoped before use: an id that exists but
// belongs to another org is discarded rather than linked.

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ensureWidgetConversation(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  conversationId: unknown,
  firstMessage: string
): Promise<string | null> {
  if (typeof conversationId !== "string" || !UUID_PATTERN.test(conversationId)) {
    return null;
  }

  try {
    const { data: existing } = await supabase
      .from("conversations")
      .select("id, org_id")
      .eq("id", conversationId)
      .maybeSingle();

    if (existing) {
      return existing.org_id === orgId ? conversationId : null;
    }

    const title = `Website: ${firstMessage.slice(0, 40)}${firstMessage.length > 40 ? "…" : ""}`;
    const { error: insertError } = await supabase
      .from("conversations")
      .insert({ id: conversationId, org_id: orgId, title });

    if (insertError) {
      console.error("[widget] conversation insert failed:", insertError.message);
      return null;
    }

    return conversationId;
  } catch (err) {
    console.error("[widget] conversation linking error:", err);
    return null;
  }
}

// ── POST handler ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { messages, conversationId, widgetKey } = await req.json();

  if (!messages || !conversationId || !widgetKey) {
    return new Response("Missing required fields", { status: 400 });
  }

  // ── Rate limiting ────────────────────────────────────────────────
  // The widget is public and unauthenticated by design (widgetKey is
  // visible in every customer site's HTML source), so a scripted
  // client can bypass the widget UI and POST directly. Each message
  // triggers up to 3 OpenAI calls, and conversationId is client-
  // supplied, so an unbounded loop can both run up OpenAI costs and
  // flood a business's inbox with fake needs-review notifications by
  // minting a fresh conversationId per request. Two limits: a tight
  // one per IP+widgetKey pair (stops a single scripted client), and a
  // looser one per widgetKey alone (caps worst-case cost even if the
  // same leaked key is hit from many IPs).
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  const rateLimitHeaders = { "Access-Control-Allow-Origin": "*" };

  if (!checkRateLimit(`widget-ip:${ip}:${widgetKey}`, 15, 60_000)) {
    return new Response("Too many requests", { status: 429, headers: rateLimitHeaders });
  }
  if (!checkRateLimit(`widget-key:${widgetKey}`, 60, 60_000)) {
    return new Response("Too many requests", { status: 429, headers: rateLimitHeaders });
  }

  const supabase = createAdminClient();

  // ── Resolve org by widget_key — the ONLY identity check here ────
  const { data: org, error: orgError } = await supabase
    .from("organisations")
    .select(
      "id, business_name, business_type, primary_goal, description, website, subscription_status, trial_ends_at"
    )
    .eq("widget_key", widgetKey)
    .maybeSingle();

  if (orgError || !org) {
       console.error("[widget] org lookup failed for widgetKey:", widgetKey, "| error:", orgError?.message);
    return new Response("Invalid widget key", { status: 401 });

  }

  // ── Billing gate — a lapsed trial/subscription stops Remy from
  // answering entirely, before any lead capture or OpenAI call ──────
  if (!hasActiveAccess(org)) {
    return buildPausedChatResponse({ "Access-Control-Allow-Origin": "*" });
  }

  const orgId = org.id;

  // ── Lead extraction — same engine as /api/chat ─────────────────
  const latestUserMessage: string =
    [...messages].reverse().find((m: { role: string }) => m.role === "user")?.content ?? "";

  let detectedIntent: LeadIntent = "unknown";
  let suggestedAlternativeIso: string | null = null;
  let unavailableReason: "hours" | "capacity" | null = null;
  let handoffAskContact = false;
  let handoffContactCaptured = false;

  if (latestUserMessage) {
    try {
      const linkedConversationId = await ensureWidgetConversation(
        supabase,
        orgId,
        conversationId,
        latestUserMessage
      );

      const extracted = await extractLeadData(latestUserMessage);
      detectedIntent = extracted.intent;

      console.log("[widget] extracted intent:", extracted.intent, "| conversation:", linkedConversationId);

      if (ACTIONABLE_INTENTS.includes(extracted.intent)) {
        const captureResult = await capturePartialLead(
          supabase,
          orgId,
          linkedConversationId,
          latestUserMessage,
          extracted,
          "web_widget"
        );

        suggestedAlternativeIso = captureResult.suggestedAlternativeIso;
        unavailableReason = captureResult.unavailableReason;

        if (captureResult.needsReviewContactCaptured) {
          handoffContactCaptured = true;
        }
      } else {
        // ── Confidence check — mirrors /api/chat ──────────────────
        const knowledgeResultForCheck = await supabase
          .from("business_knowledge")
          .select("category, title, content")
          .eq("org_id", orgId)
          .eq("is_active", true);

        const identitySummary = [
          `- Business name: ${org.business_name}`,
          `- Business type: ${org.business_type}`,
          `- Primary goal: ${org.primary_goal}`,
          org.description ? `- About: ${org.description}` : null,
          org.website ? `- Website: ${org.website}` : null,
        ]
          .filter(Boolean)
          .join("\n");

        const knowledgeSummary = [
          identitySummary,
          ...(knowledgeResultForCheck.data ?? []).map(
            (r) => `- ${r.title}: ${r.content}`
          ),
        ]
          .filter(Boolean)
          .join("\n");

        const assessment = await assessAnswerConfidence(latestUserMessage, knowledgeSummary);

        if (assessment.needsReview) {
          console.log("[widget] low confidence — flagging for review:", assessment.reason);

          const reviewResult = await capturePartialLead(
            supabase,
            orgId,
            linkedConversationId,
            latestUserMessage,
            extracted,
            "web_widget",
            true
          );

          const hasContact = Boolean(extracted.email || extracted.phone);

          if (hasContact) {
            handoffContactCaptured = true;

            const alreadyNotified = await hasNeedsReviewNotificationBeenSent(
              supabase,
              reviewResult.leadId,
              linkedConversationId
            );

            if (alreadyNotified) {
              console.log("[widget] needs-review notification already sent for this conversation");
            } else {
              const ownerInfo = await getOrgOwnerEmail(orgId);
              const notificationSent = await sendNeedsReviewNotification({
                businessOwnerEmail: ownerInfo?.email ?? null,
                businessName: ownerInfo?.businessName ?? "the business",
                customerName: extracted.name,
                customerEmail: extracted.email,
                customerPhone: extracted.phone,
                question: latestUserMessage,
                conversationContext: null,
                leadId: reviewResult.leadId,
              });

              if (notificationSent) {
                await markNeedsReviewNotificationSent(supabase, reviewResult.leadId, linkedConversationId);
              }
            }
          } else {
            handoffAskContact = true;
          }
        }
      }
    } catch (err) {
      console.error("[widget POST] lead extraction/capture error:", err);
    }
  }

  // ── Fetch knowledge ─────────────────────────────────────────────
  const { data: knowledgeData } = await supabase
    .from("business_knowledge")
    .select("category, title, content, display_order")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .order("category", { ascending: true })
    .order("display_order", { ascending: true });

  const knowledge: KnowledgeRecord[] = knowledgeData ?? [];

  const systemPrompt = buildSystemPrompt(org, knowledge, detectedIntent, suggestedAlternativeIso, unavailableReason, handoffAskContact, handoffContactCaptured);

  // ── Streaming response (identical pattern to chat/route.ts) ─────
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const openaiKey = process.env.OPENAI_API_KEY;

        if (!openaiKey) {
          const stubReply = `Hi! I'm Remy, your AI assistant for ${org.business_name}. Add OPENAI_API_KEY to enable real AI responses.`;
          for (const char of stubReply) {
            controller.enqueue(encoder.encode(char));
            await new Promise((r) => setTimeout(r, 18));
          }
          controller.enqueue(encoder.encode("\n__DONE__"));
          controller.close();
          return;
        }

        const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
          body: JSON.stringify({
            model: "gpt-4o",
            stream: true,
            messages: [
              { role: "system", content: systemPrompt },
              ...messages.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
            ],
          }),
        });

        if (!openaiRes.ok || !openaiRes.body) throw new Error(`OpenAI error: ${openaiRes.status}`);

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
            } catch {}
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
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
