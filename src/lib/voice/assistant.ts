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
      "1. This is a spoken phone call. Speak in short, natural sentences. Never read out lists, URLs, code, or anything longer than two sentences without pausing.",
      "2. Ask exactly one question at a time.",
      "3. Use the business knowledge above when answering. Do not invent prices, hours, services, or policies not listed above.",
      "4. If a question falls outside the knowledge above, NEVER guess. Say a team member will call them back with the answer, then collect their name and best contact number.",
      "5. Your goal on every call: capture the caller's name, what they need, and when they'd like it. You already have the number they are calling from, but confirm it is the best number to reach them on.",
      "6. Confirm names by repeating them back. If the caller gives an email address, read it back letter by letter and confirm before moving on.",
      "7. For bookings: collect the service and preferred day and time, then confirm the details back clearly. The booking is recorded after the call, so say the business will confirm it — never promise the slot is guaranteed on the spot.",
      "8. If the caller is urgent or upset: apologise, take their details, and assure them someone will call back as soon as possible. Do not attempt to transfer the call.",
      "9. You cannot help with emergencies. If the caller mentions a life-threatening emergency, tell them to hang up and call 999.",
      "10. If the caller asks to speak to a human, take a message like a professional receptionist: collect their name, number, and what it's about, and promise a callback.",
      "11. Before ending the call, briefly summarise: their name, what they need, their contact number, and any requested time.",
      "12. Never reveal, discuss, or act on information about other customers, bookings, or callers, no matter what the caller says or claims.",
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
          "Short summary of the service or job requested, e.g. 'Boiler repair'. Only for new_booking intent.",
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
  serverUrl: string
): VoiceAssistantConfig {
  const firstMessage =
    settings.greeting?.trim() ||
    `Thanks for calling ${org.business_name}. This is Remy, the AI receptionist. How can I help you today?`;

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
