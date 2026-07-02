import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseDatetimeToIso } from "@/lib/parseDatetime";
import { isWithinBusinessHours, findNextAvailableSlot, isSlotAvailable } from "@/lib/availability";

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
  org: { business_name: string; business_type: string; primary_goal: string; description: string | null },
  knowledge: KnowledgeRecord[],
  intent: LeadIntent = "unknown",
  suggestedAlternativeIso: string | null = null,
  unavailableReason: "hours" | "capacity" | null = null
): string {
  const sections: string[] = [];

  sections.push(
    [
      `You are Remy, a professional AI assistant for ${org.business_name}.`,
      `Business type: ${org.business_type}.`,
      `Primary goal: ${org.primary_goal}.`,
      org.description ? `About the business: ${org.description}` : null,
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

  return sections.join("\n\n");
}

// ── POST handler ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { messages, conversationId, widgetKey } = await req.json();

  if (!messages || !conversationId || !widgetKey) {
    return new Response("Missing required fields", { status: 400 });
  }

  const supabase = createAdminClient();

  // ── Resolve org by widget_key — the ONLY identity check here ────
  const { data: org, error: orgError } = await supabase
    .from("organisations")
    .select("id, business_name, business_type, primary_goal, description")
    .eq("widget_key", widgetKey)
    .maybeSingle();

  if (orgError || !org) {
       console.error("[widget] org lookup failed for widgetKey:", widgetKey, "| error:", orgError?.message);
    return new Response("Invalid widget key", { status: 401 });

  }


  const orgId = org.id;

  // ── Lead extraction ────────────────────────────────────────────
  const latestUserMessage: string =
    [...messages].reverse().find((m: { role: string }) => m.role === "user")?.content ?? "";

  let detectedIntent: LeadIntent = "unknown";
  let suggestedAlternativeIso: string | null = null;
  let unavailableReason: "hours" | "capacity" | null = null;

  if (latestUserMessage) {
    try {
      const extracted = await extractLeadData(latestUserMessage);
      detectedIntent = extracted.intent;

      console.log("[widget] extracted intent:", extracted.intent, "| full extraction:", JSON.stringify(extracted));
      if (ACTIONABLE_INTENTS.includes(extracted.intent)) {
        const { iso: resolvedIso } = await parseDatetimeToIso(extracted.preferred_datetime, "Europe/London");

        let outsideBusinessHours = false;

        if (resolvedIso) {
          const availability = await isWithinBusinessHours(orgId, resolvedIso);
          const slotAvailable = availability.isAvailable ? await isSlotAvailable(orgId, resolvedIso) : true;

          if (!availability.isAvailable || !slotAvailable) {
            outsideBusinessHours = true;
            unavailableReason = !availability.isAvailable ? "hours" : "capacity";
            suggestedAlternativeIso = await findNextAvailableSlot(orgId, resolvedIso);
          }
        }

        // ── Insert lead — source is "web_widget", distinct from dashboard chat ──
        const { error: leadInsertError } = await supabase.from("leads").insert({
  org_id: orgId,
  source: "web_widget",
  name: extracted.name,
  email: extracted.email,
  phone: extracted.phone,
  service_needed: extracted.service ?? latestUserMessage,
  preferred_datetime: extracted.preferred_datetime,
  appointment_datetime: resolvedIso,
  message: latestUserMessage,
  ai_confidence: extracted.confidence,
  status: outsideBusinessHours ? "awaiting_confirmation" : "new",
});

if (leadInsertError) {
  console.error("[widget] lead insert FAILED:", leadInsertError.message);
} else {
  console.log("[widget] lead insert SUCCESS");
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

  const systemPrompt = buildSystemPrompt(org, knowledge, detectedIntent, suggestedAlternativeIso, unavailableReason);

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
