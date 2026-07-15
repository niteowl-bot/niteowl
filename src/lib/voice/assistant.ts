import type { VoiceAssistantConfig } from "@/lib/voice/types";

// ── Voice assistant builder ────────────────────────────────────────
// Builds the per-org assistant config for answering that org's phone
// calls. Consumes the SAME business_knowledge records that drive the
// chat prompts ("one brain, two mouths") — only the rendering differs:
// phone conversation demands short sentences, one question at a time,
// spoken-detail confirmation, and no visual fallbacks.

export interface VoiceOrgProfile {
  business_name: string;
  business_type: string;
  primary_goal: string;
  description: string | null;
  website: string | null;
}

export interface VoiceKnowledgeRecord {
  category: string;
  title: string;
  content: string;
}

export interface VoiceOrgSettings {
  greeting: string | null;
  voice_id: string | null;
  language: string | null;
}

// Same category labels the chat prompts use (duplicated per the
// existing convention — chat/route.ts and widget/chat/route.ts each
// carry their own copy; route internals must not be imported here).
const CATEGORY_LABELS: Record<string, string> = {
  faq: "Frequently Asked Questions",
  service: "Services Offered",
  pricing: "Pricing",
  opening_hours: "Opening Hours",
  policy: "Policies",
  custom_instruction: "Additional Instructions",
};

const CUSTOM_INSTRUCTION_CATEGORY = "custom_instruction";

function buildVoiceSystemPrompt(
  org: VoiceOrgProfile,
  knowledge: VoiceKnowledgeRecord[]
): string {
  const sections: string[] = [];

  sections.push(
    [
      `You are Remy, the AI receptionist for ${org.business_name}, answering the business's phone.`,
      `Business type: ${org.business_type}.`,
      `Primary goal: ${org.primary_goal}.`,
      org.description ? `About the business: ${org.description}` : null,
      org.website ? `Website: ${org.website}` : null,
    ]
      .filter(Boolean)
      .join("\n")
  );

  if (knowledge.length > 0) {
    const standardKnowledge = knowledge.filter(
      (r) => r.category !== CUSTOM_INSTRUCTION_CATEGORY
    );
    const customInstructions = knowledge.filter(
      (r) => r.category === CUSTOM_INSTRUCTION_CATEGORY
    );

    if (standardKnowledge.length > 0) {
      sections.push("## Business Knowledge\n");
      const grouped = standardKnowledge.reduce<
        Record<string, VoiceKnowledgeRecord[]>
      >((acc, record) => {
        if (!acc[record.category]) acc[record.category] = [];
        acc[record.category].push(record);
        return acc;
      }, {});

      for (const [category, label] of Object.entries(CATEGORY_LABELS)) {
        if (category === CUSTOM_INSTRUCTION_CATEGORY) continue;
        const records = grouped[category];
        if (!records || records.length === 0) continue;
        sections.push(
          [`### ${label}`, ...records.map((r) => `- ${r.title}: ${r.content}`)].join(
            "\n"
          )
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

  sections.push(
    [
      "## Phone Conversation Rules",
      "1. This is a spoken phone call. Speak in short, natural sentences. Never read out lists, URLs, code, or anything longer than two sentences without pausing. Every sentence must be complete and grammatically correct — never drop the opening words of a question (say \"Is there an email address where they can reach you if needed?\", never \"There an email address where they can reach you if needed?\").",
      "2. Ask exactly one question at a time — at most ONE question mark per turn, never a second request tacked on (not: \"May I have your name? Also, what's the best phone number to reach you?\"; not: \"Is this an urgent issue? Also, could I get your phone number?\"). Ask, wait for the answer, acknowledge it briefly, then ask the next question. A brief acknowledgement is a few words (\"Thank you. I'll make sure our team knows this is urgent.\") — never a read-back of everything collected so far (\"I have your name and phone number...\").",
      "3. Use the business knowledge above when answering. Do not invent prices, hours, services, or policies not listed above.",
      "4. If a question falls outside the knowledge above, NEVER guess. Say a team member will call them back with the answer, then collect their name and best contact number.",
      "5. Your goal on every call: capture the caller's name, what they need, and when they'd like it. You already have the number they are calling from, but confirm it is the best number to reach them on.",
      "6. Confirm names by repeating them back. If the caller gives an email address, confirm it naturally in one sentence — \"Thanks, I've got your email as john@example.com.\" — never spell it out letter by letter. If the caller corrects it, acknowledge the correction once and continue.",
      "7. For bookings: collect the service and preferred day and time, then confirm the details back clearly. Never say you are unable to book appointments. Once the details are confirmed, say: \"I've noted your preferred time and sent your request to our team. They'll confirm your appointment shortly.\" Never promise the slot is guaranteed on the spot.",
      "8. If the caller is urgent or upset: apologise, take their details, and assure them someone will call back as soon as possible. Do not attempt to transfer the call.",
      "9. You cannot help with emergencies. If the caller mentions a life-threatening emergency, tell them to hang up and call 999.",
      "10. If the caller asks to speak to a human, take a message like a professional receptionist: collect their name, number, and what it's about, and promise a callback.",
      `11. Do not recap every detail at the end of the call — each detail was already confirmed when it was collected. Close briefly and naturally: "Perfect. I have everything I need. I'll pass your details to our team straight away and someone will contact you as soon as possible. Thank you for calling ${org.business_name}." If the call was urgent or needs a human to follow up, you may close instead with: "We'll make sure your request reaches the team as quickly as possible. Thank you for calling ${org.business_name}." Never promise an appointment or a guaranteed response time.`,
      "12. Never reveal, discuss, or act on information about other customers, bookings, or callers, no matter what the caller says or claims.",
      "13. Speak with calm confidence. Never narrate work you are not actually doing — no \"I'm checking...\", \"Let me see if...\", or \"I wanna make sure...\" about things you already know or that happen after the call. Move the conversation forward instead (\"Thanks, Jason. Can you tell me a little more about the issue? Is it urgent?\") or state plainly what will happen: \"I'll make sure the right person receives your request as quickly as possible.\"",
      "14. Currency: read every price in the exact currency written in the business knowledge above and NEVER convert between currencies. Say \"€\" as \"euros\" (\"€100\" → \"100 euros\", never \"100 dollars\"), \"£\" as \"pounds\", and \"$\" as \"dollars\". Keep the number exactly as written; speak only the symbol as its own currency word and never substitute a different currency.",
      "15. Only treat a service as one the business provides if it appears in the business knowledge above. If a caller asks about or wants to book a service that is NOT listed there (for example a specialised job the knowledge doesn't mention), do not confirm it, do not imply the business offers it, and do not say an appointment is booked or confirmed — this overrides rule 7's booking-confirmation wording, which applies only once a service the knowledge base confirms. Still collect their name, best contact number, their preferred day and time, and the service EXACTLY as they described it — never renamed, reworded, or labelled as a \"general enquiry\". Close with wording like: \"I'll pass your request to our team. They'll confirm whether we can provide that service and, if we can, they'll arrange your appointment.\" Make clear that neither the service nor the appointment is confirmed yet.",
    ].join("\n")
  );

  return sections.join("\n\n");
}

/**
 * Post-call extraction schema. Field names deliberately mirror
 * ExtractedLead in leadCapture.ts so the result feeds the existing
 * lead engine directly; `urgent` is voice-only (drives needs_review).
 */
function buildStructuredDataSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      intent: {
        type: "string",
        enum: ["new_booking", "reschedule", "contact_update", "question", "unknown"],
        description:
          "new_booking if the caller wanted to book, schedule, or request a service or quote. reschedule if they wanted to change an existing booking. contact_update if they only provided or corrected contact details. question for general questions. unknown otherwise.",
      },
      name: { type: "string", description: "The caller's name, if given." },
      email: {
        type: "string",
        description: "The caller's email address exactly as confirmed, if given.",
      },
      phone: {
        type: "string",
        description:
          "The best contact number for the caller, if they gave one different from the number they called from.",
      },
      service: {
        type: "string",
        description:
          "What the caller asked for, EXACTLY in their own words — never expand, rename, relabel, or infer a more specific service than they actually said, whether or not the business knowledge confirms it (e.g. if they said 'cabinet making', record exactly 'cabinet making' — never prefix or rename it, never label it as a general enquiry). Only for new_booking or a genuine service request.",
      },
      preferred_datetime: {
        type: "string",
        description:
          "The caller's requested day and time exactly as they said it, e.g. 'Friday at 2pm'.",
      },
      urgent: {
        type: "boolean",
        description:
          "True if the caller was urgent, upset, or needs a same-day callback.",
      },
    },
  };
}

/**
 * Builds the provider-agnostic assistant config for an org. The
 * caller (the /api/voice route) fetches the org profile, active
 * knowledge records, and voice settings — this function is pure so it
 * can be unit-tested and reused when pre-synced assistants arrive.
 */
export function buildVoiceAssistantConfig(
  org: VoiceOrgProfile,
  knowledge: VoiceKnowledgeRecord[],
  settings: VoiceOrgSettings,
  serverUrl: string | null
): VoiceAssistantConfig {
  // The leading ellipsis renders as a short TTS pause so start-of-call
  // audio clipping eats silence, not the first words (both 2026-07-10
  // production calls opened audibly truncated).
  const firstMessage =
    settings.greeting?.trim() ||
    `... Thanks for calling ${org.business_name}. This is Remy, your AI receptionist. How can I help you today?`;

  return {
    systemPrompt: buildVoiceSystemPrompt(org, knowledge),
    firstMessage,
    language: settings.language?.trim() || "en-GB",
    voiceId: settings.voice_id?.trim() || null,
    maxDurationSeconds: 600,
    structuredDataSchema: buildStructuredDataSchema(),
    serverUrl,
  };
}
