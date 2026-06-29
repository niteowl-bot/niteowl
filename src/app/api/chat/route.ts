import { createClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
// ── Lead intent detection ────────────────────────────────────────

const LEAD_INTENT_KEYWORDS = [
  "appointment",
  "book",
  "booking",
  "call me",
  "contact me",
  "phone",
  "email",
  "quote",
  "price",
  "pricing",
  "availability",
];

function hasLeadIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return LEAD_INTENT_KEYWORDS.some((keyword) => lower.includes(keyword));
}

async function capturePartialLead(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  conversationId: string,
  userMessage: string
): Promise<void> {
  const { error } = await supabase.from("leads").insert({
    org_id: orgId,
    conversation_id: conversationId,
    source: "chat",
    message: userMessage,
    service_needed: userMessage,
    ai_confidence: 0.7,
    status: "new",
  });

  if (error) {
    // Non-fatal — log and continue so the chat response still streams
    console.error("[lead capture]", error.message);
  }
}


// ── Types ────────────────────────────────────────────────────────

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

// Custom instructions are injected differently — appended after the
// main prompt block rather than listed as knowledge, so the model
// treats them as direct behavioural rules.
const CUSTOM_INSTRUCTION_CATEGORY = "custom_instruction";

// ── System prompt builder ────────────────────────────────────────

function buildSystemPrompt(
  org: {
    business_name: string;
    business_type: string;
    primary_goal: string;
    description: string | null;
  },
  knowledge: KnowledgeRecord[]
): string {
  const sections: string[] = [];

  // ── Identity block ─────────────────────────────────────────────
  sections.push(
    [
      `You are Remy, a professional AI assistant for ${org.business_name}.`,
      `Business type: ${org.business_type}.`,
      `Primary goal: ${org.primary_goal}.`,
      org.description
        ? `About the business: ${org.description}`
        : null,
    ]
      .filter(Boolean)
      .join("\n")
  );

  // ── Knowledge blocks ───────────────────────────────────────────
  if (knowledge.length > 0) {
    // Separate custom instructions from the rest
    const standardKnowledge = knowledge.filter(
      (r) => r.category !== CUSTOM_INSTRUCTION_CATEGORY
    );
    const customInstructions = knowledge.filter(
      (r) => r.category === CUSTOM_INSTRUCTION_CATEGORY
    );

    if (standardKnowledge.length > 0) {
      sections.push("## Business Knowledge\n");

      // Group by category, preserving the label order defined above
      const grouped = standardKnowledge.reduce<
        Record<string, KnowledgeRecord[]>
      >((acc, record) => {
        if (!acc[record.category]) acc[record.category] = [];
        acc[record.category].push(record);
        return acc;
      }, {});

      for (const [category, label] of Object.entries(CATEGORY_LABELS)) {
        if (category === CUSTOM_INSTRUCTION_CATEGORY) continue;
        const records = grouped[category];
        if (!records || records.length === 0) continue;

        const block = [
          `### ${label}`,
          ...records.map((r) => `- ${r.title}: ${r.content}`),
        ].join("\n");

        sections.push(block);
      }
    }

    // ── Custom instructions ──────────────────────────────────────
    if (customInstructions.length > 0) {
      const block = [
        "## Your Behaviour Rules",
        "Follow these instructions precisely in every response:",
        ...customInstructions.map((r) => `- ${r.content}`),
      ].join("\n");

      sections.push(block);
    }
  }

  // ── Standing instructions ──────────────────────────────────────
  sections.push(
    [
      "## General Guidelines",
      "-- Be helpful, professional, and concise.",
"-- Only answer questions relevant to the business and its customers.",
"-- If you do not know something, say so honestly rather than guessing.",
"-- Never invent prices, services, or policies not listed above.",
"-- Keep responses conversational and easy to read.",
"-- When a customer expresses interest in booking, pricing, availability, or contact, collect their details one question at a time. First ask for their name. After they reply, ask what service they need. Finally ask for their phone number or email. Never ask for all details in a single message.",
].join("\n")
  );

  return sections.join("\n\n");
}

// ── Route handler ────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { messages, conversationId, orgId } = await req.json();

  if (!messages || !conversationId || !orgId) {
    return new Response("Missing required fields", { status: 400 });
  }
const latestUserMessage: string =
  [...messages]
    .reverse()
    .find((m: { role: string }) => m.role === "user")
    ?.content ?? "";

if (latestUserMessage && hasLeadIntent(latestUserMessage)) {
  await capturePartialLead(
    supabase,
    orgId,
    conversationId,
    latestUserMessage
  );
}


if (hasLeadIntent(latestUserMessage)) {
  await capturePartialLead(
    supabase,
    orgId,
    conversationId,
    latestUserMessage
  );
}

  // ── Fetch org + knowledge in parallel ───────────────────────────

  const [orgResult, knowledgeResult] = await Promise.all([
    supabase
      .from("organisations")
      .select("business_name, business_type, primary_goal, description")
      .eq("id", orgId)
      .single(),

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

  // ── Build system prompt ──────────────────────────────────────────

  const systemPrompt = org
  ? buildSystemPrompt(org, knowledge)
  : "You are Remy, a helpful AI business assistant. Be concise and professional.";



  // ── Streaming response ───────────────────────────────────────────

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const openaiKey = process.env.OPENAI_API_KEY;

        if (!openaiKey) {
          // Stub mode — streams a placeholder so the UI works without a key
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

