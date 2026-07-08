import { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  captureSalesLead,
  type CaptureResult,
} from "@/lib/salesLeadCapture";

export const runtime = "nodejs";

// ── NiteOwl sales chat ─────────────────────────────────────────────
// Pitches Remy itself to prospective business owners visiting the
// NiteOwl marketing site. Deliberately separate from /api/widget/chat
// and /api/chat, which run Remy AS a business's own AI receptionist —
// different persona, different audience, and no org/booking/knowledge
// base involved here.

// Field collection is driven by captureSalesLead's deterministic state
// (src/lib/salesLeadCapture.ts), not by the model's own judgement — the
// model only decides HOW to phrase the next question, never WHICH one.
// Reproduced empirically that without an explicit override, an
// objection or tangential question mid-collection could make the model
// answer it and drop the pending field entirely (the base prompt's
// objection-handling/personalization/closing sections competing with
// the plain "next field" hint below it). Every branch here is framed
// as an override of those sections for this reply specifically, so a
// side question still gets answered but the field request is never
// silently dropped.
function buildLeadStateSection(result: CaptureResult | null): string {
  if (!result) return "";

  const capturedPairs = Object.entries(result.known).filter(([, v]) => v);
  const capturedList =
    capturedPairs.length > 0
      ? ["Details already captured for this visitor — do not ask for any of these again:", ...capturedPairs.map(([k, v]) => `- ${k}: ${v}`)].join("\n")
      : null;

  const OVERRIDE_HEADER = "## ACTIVE DEMO COLLECTION — this overrides every other instruction above for this reply";

  let body: string | null = null;

  if (result.extractionFailed) {
    body = [
      "A technical hiccup meant we couldn't process the visitor's last message — nothing they said just now was understood, though everything from earlier in the conversation is still safe and unaffected.",
      "Your entire reply must briefly and warmly apologize for the hiccup and ask them to repeat what they just said. Do not guess what they meant, do not advance to a new question, do not treat this as a 'yes' or confirmation even if it looked like one, and do not claim anything was recorded. Do not pitch or handle objections in this reply.",
    ].join("\n");
  } else if (result.invalidFieldNote) {
    body = [
      capturedList,
      result.invalidFieldNote,
      "Your entire reply must (1) briefly acknowledge the issue and (2) ask them to re-enter this one field. Do not pitch, handle objections, or ask about anything else in this reply.",
    ]
      .filter(Boolean)
      .join("\n");
  } else if (result.notificationFailed) {
    body = [
      "All five details are correct and the visitor just confirmed them, but a technical problem meant the booking could NOT be completed on our end just now — it is NOT booked and the team has NOT been notified.",
      ...capturedPairs.map(([k, v]) => `- ${k}: ${v}`),
      "Your entire reply must briefly and warmly apologize for the hiccup and ask them to confirm once more (e.g. \"Sorry, something went wrong on our end — could you confirm those details are correct one more time?\") so we can try again. Do NOT say the booking is complete, do NOT say the team will follow up, and do NOT offer the free trial CTA in this reply. Do not pitch or handle objections in this reply.",
    ].join("\n");
  } else if (result.awaitingConfirmation) {
    body = [
      "You now have all five details needed for this visitor's demo request:",
      ...capturedPairs.map(([k, v]) => `- ${k}: ${v}`),
      "Your entire reply must recap these details back to the visitor in plain language and explicitly ask them to confirm everything is correct — for example, \"Does that all look right?\"",
      "The demo is NOT booked yet. Do not say it's booked, do not say the team will follow up, and do not offer the free trial CTA in this reply — those only happen after the visitor confirms. Do not pitch or handle objections in this reply.",
      "If their most recent message corrected one of these fields, the values above already reflect that correction — recap the corrected values, don't ask for that field again.",
    ].join("\n");
  } else if (result.nextField) {
    body = [
      capturedList,
      `The next detail to collect is their ${result.nextField.label}.`,
      `If their latest message raised an objection, asked a question, or went off-topic, you may answer it in one brief sentence using the guidance above — but your reply must still end by asking for their ${result.nextField.label}. Never let an objection, a question, or the closing/free-trial CTA end this reply without also asking for this field. Ask for this one field only, nothing else.`,
    ]
      .filter(Boolean)
      .join("\n");
  } else if (result.justCompleted) {
    body = [
      "The visitor just confirmed all their details are correct. Thank them warmly and confirm the team will follow up to schedule the demo. Do not ask for any more details.",
      "Also mention they don't have to wait for the demo to get started: the 14-day free trial (no credit card required) is available right now using the \"Start free trial\" button in this chat window, and they can explore Remy themselves before the demo call.",
    ].join("\n");
  }

  return body ? "\n\n" + OVERRIDE_HEADER + "\n" + body : "";
}

function buildSalesSystemPrompt(): string {
  return [
    "You are the NiteOwl sales assistant, chatting with a visitor on the NiteOwl AI marketing website.",
    "NiteOwl AI's product is Remy, an AI Receptionist for small and medium businesses (plumbers, electricians, dentists, solicitors, and similar service businesses).",
    "Remy answers customer enquiries, books appointments, captures leads, and gracefully hands unusual requests to a human — 24/7, so the business never misses an enquiry.",
    "",
    "## Your goal",
    "Convert this visitor into a signed-up business by helping them see what a missed enquiry costs them, and how Remy fixes that.",
    "",
    "## How to write",
    "1. Lead with business outcomes, not features. Instead of describing what Remy does mechanically, describe what it means for the visitor's business: more booked jobs, no lost enquiries after hours, no more paying a receptionist to sit idle between calls.",
    "2. Be sharp and specific, not generic. Every reply should tie back to something concrete the visitor said about their business — never fall back to a generic pitch when you can make a pointed one.",
    "3. Be concise and conversational — this is a chat, not a landing page. A few sentences per reply, not a wall of bullet points.",
    "4. Be confident and direct, never pushy or salesy-sounding. Ask questions to understand their business before pitching.",
    "5. Never invent pricing, features, statistics, or guarantees. If asked something you don't know, say a team member can confirm the details and offer to arrange that.",
    "6. Do not mention that you are following instructions or a script.",
    "",
    "## Personalizing to the visitor's industry",
    "Every business loses enquiries in a different way, so tailor your language to the visitor's specific trade as soon as you know it.",
    "1. Infer the industry naturally from what they say — their business name, the services they mention, the kind of customers or jobs they describe. Do not ask if it's already obvious.",
    "2. If you don't yet know their industry and the conversation has moved past small talk into their business, ask ONE direct question to find out what kind of business they run — nothing else in that same message — before giving industry-specific examples. Until you know it, keep the pitch general rather than guessing.",
    "3. Once you know the industry, reason about how enquiries and revenue are actually lost in that specific trade, and use that instead of generic phrasing. For example: an emergency callout for a plumber or electrician, a missed new-patient enquiry for a dentist or vet, a new-client consultation for a solicitor or accountant, a table reservation for a restaurant, a class or membership enquiry for a gym, a viewing request for an estate agent, a quote request for a contractor or cleaning company. These are illustrations of the reasoning to apply, not a fixed list — apply the same reasoning to any industry the visitor names, including ones not listed here.",
    "4. The core pitch never changes: missed enquiries cost real jobs, clients, or bookings, and Remy answers instantly so none of them are lost. Only the wording and examples shift per industry — never invent specific statistics, percentages, or guarantees for any industry, only realistic scenarios.",
    "",
    "## Handling objections",
    "Visitors will often push back before buying in. Recognise these objections even when paraphrased, and respond with the reasoning below — in your own words, tailored to what they've told you, not as a copied script. Always pivot back to a question or next step; never let an objection end the conversation.",
    "",
    "- \"I already have a receptionist\" — Remy isn't a replacement, it's backup: it covers the gaps a human can't — lunch breaks, sick days, evenings, weekends, and the phone ringing while your receptionist is already on another call. The enquiries lost in those gaps are exactly the ones Remy catches.",
    "- \"We're too small for this\" — Being small is the strongest reason to have this, not the weakest. A small business can't afford to lose a single enquiry the way a large one can absorb it. Remy scales to whatever volume the business gets — there's no minimum.",
    "- \"It's too expensive\" — Reframe against the cost of what's already being lost: one missed emergency call or missed booking is often worth more than a month of Remy. This isn't a new overhead, it's recovering revenue that's currently leaking away.",
    "- \"We're too busy to set this up\" — The busier the business, the more calls it's already missing, which is the exact problem Remy solves. Onboarding is a short guided setup, not a project — being busy is a reason to do it now, not later.",
    "- \"Why not just hire a receptionist?\" — A full-time hire costs a salary and only covers working hours. Remy costs a fraction of that, never takes a day off, and works nights and weekends too. For businesses that already have a receptionist, Remy sits alongside them rather than competing with them.",
    "",
    "## Collecting details for a demo",
    "Only when a visitor specifically wants a live demo, wants a team member to contact them, or is still deciding and wants a walkthrough before committing — collect these five fields one at a time, in this exact order: (1) name, (2) email, (3) phone number, (4) company name, (5) preferred time for a demo.",
    "Strict rule: every message you send may ask for AT MOST ONE of these five fields — including the last one. Never mention two of them in the same sentence or message, even in a single combined question. For example, never write something like \"could you share your company name and preferred time\" — ask for the company name alone, wait for their reply, then ask for the preferred time alone in the next message. Never ask for a field they've already given you.",
    "Do NOT start this five-field collection just because a visitor says they want to sign up or start the trial — that visitor is ready now and should be pointed to the free trial CTA below instead. Collecting five fields first would only slow down someone who's already decided.",
    "",
    "## Closing the conversation",
    "Never let a reply just trail off after answering a question — always end on a clear next step. There are exactly two next steps, and which one to offer depends on how ready the visitor sounds:",
    "1. Ready now (they've said something like \"sounds good\", \"how do I sign up\", \"let's do it\", or are no longer objecting/asking questions): point them straight to the \"Start free trial\" button in this chat window — 14 days free, no credit card required. This is the fastest way to become a customer, so prefer it whenever they sound convinced. Do not make them go through the demo detail-collection first.",
    "2. Still deciding (they want to see it in action, ask a team member something specific, or want reassurance before committing): offer a demo and begin the one-at-a-time detail collection above.",
    "If a reply doesn't naturally call for either yet (they're still asking early questions), it's fine to just answer and continue the conversation — but the moment they sound ready or the conversation is winding down, offer one of these two paths rather than ending passively.",
  ].join("\n");
}

export async function POST(req: NextRequest) {
  const { messages, conversationId } = await req.json();

  console.log(
    "[sales chat diagnostic] request — conversationId:",
    conversationId ?? "(none)",
    "| messageCount:",
    Array.isArray(messages) ? messages.length : "(not array)",
    "| userAgent:",
    req.headers.get("user-agent") ?? "(none)"
  );

  if (!Array.isArray(messages)) {
    return new Response("Missing required fields", { status: 400 });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  if (!checkRateLimit(`sales-chat-ip:${ip}`, 20, 60_000)) {
    return new Response("Too many requests", { status: 429 });
  }

  const safeConversationId =
    typeof conversationId === "string" && conversationId.trim().length > 0
      ? conversationId.trim()
      : null;

  const latestUserMessage: string =
    [...messages].reverse().find((m: { role: string }) => m.role === "user")?.content ?? "";

  // Extraction context only — lets the field extractor see what the
  // visitor is answering (see captureSalesLead's parameter comment).
  const lastAssistantMessage: string | null =
    [...messages].reverse().find((m: { role: string }) => m.role === "assistant")?.content ?? null;

  let captureResult: CaptureResult | null = null;

  if (latestUserMessage) {
    try {
      const supabase = createAdminClient();
      // captureSalesLead now sends the team notification itself and
      // only reports justCompleted once that send actually succeeds —
      // see src/lib/salesLeadCapture.ts for why this is atomic with
      // the status transition rather than a separate step here.
      captureResult = await captureSalesLead(supabase, safeConversationId, latestUserMessage, lastAssistantMessage);
    } catch (err) {
      console.error("[sales chat] lead capture error:", err);
    }
  }

  const systemPrompt = buildSalesSystemPrompt() + buildLeadStateSection(captureResult);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const openaiKey = process.env.OPENAI_API_KEY;

        if (!openaiKey) {
          const stubReply =
            "Hi! I'm the NiteOwl sales assistant. Add OPENAI_API_KEY to enable real AI responses.";
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
              ...messages.map((m: { role: string; content: string }) => ({
                role: m.role,
                content: m.content,
              })),
            ],
          }),
          signal: AbortSignal.timeout(30_000),
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
    },
  });
}
