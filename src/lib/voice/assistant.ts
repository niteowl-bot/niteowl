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

/**
 * Rule 7 — the caller's callback number. Rendered from the network
 * caller ID because the assistant has no other way to know whether it
 * already holds a number.
 *
 * When caller ID is present Remy CONFIRMS it rather than asking for a
 * number from scratch: asking open-endedly invites a mis-heard number
 * into the lead, which is what the 2026-08 caller-ID fix was for. A
 * yes/no confirmation speaks no digits, so it carries none of that
 * risk, and it is the only way to know the caller can actually be
 * reached on the line they rang from. A genuinely different number is
 * still stored as an ADDITIONAL contact, never replacing caller ID.
 *
 * The number is given to the model but marked not-to-be-spoken. It
 * used to be scripted into the confirmation question, which had Remy
 * reciting "I see you're calling from plus three five three eight
 * seven..." at a caller who already knows their own number (heard on
 * the 2026-08-03 test call) — slow, robotic, and it reads a personal
 * detail aloud to whoever is in earshot. Remy still needs to HOLD the
 * number to answer a caller who asks what number it has, so it stays
 * in the prompt with an explicit do-not-say instruction.
 *
 * Rule 5 owns WHEN the number is asked for (last, after the job is
 * understood); this rule owns HOW it is obtained, and is the only
 * place a contact number comes from. Its wording is deliberately left
 * as-is by prompt consolidation work — it is the one rule where a
 * paraphrase can cost a lead nobody can ring back.
 */
function buildPhoneNumberRule(callerPhone: string | null): string {
  if (callerPhone) {
    return `7. Callback number — required on any call that needs a follow-up. You already hold the number they are ringing from and it is recorded automatically, so never ask them to recite a number from scratch. NEVER say that number out loud: do not read it out, in full or digit by digit. The ONLY exception is if the caller directly asks you which number you have, and then you may read it once. For your reference only: ${callerPhone}. Confirm it as its own question, WITHOUT digits: "I can use the number you're calling from. Is that the best number to reach you on?" If yes, acknowledge briefly and move on. If no, ask "Of course. What's the best number to reach you on?", then listen for the whole number. If it sounds incomplete or you missed part of it, NEVER guess or fill in the missing digits: "Sorry, I may not have caught the full number. Could you repeat it for me?" Then confirm it back once ("Thanks, I've got 086 123 4567."). A different number they give is saved as an additional contact number — the number they called from is still recorded, so never tell them their number is being changed or replaced.`;
  }
  return `7. Callback number — required on any call that needs a follow-up. The caller's number is withheld or unavailable, so you MUST ask for the best number to reach them on, once, as its own question ("What's the best number to reach you on?"). Listen for the whole number; if it sounds incomplete or you missed part of it, NEVER guess or fill in the missing digits — "Sorry, I may not have caught the full number. Could you repeat it for me?" Then confirm it back once ("Thanks, I've got your number as 086 123 4567."). Do not end the call without it unless the caller explicitly refuses.`;
}

function buildVoiceSystemPrompt(
  org: VoiceOrgProfile,
  knowledge: VoiceKnowledgeRecord[],
  callerPhone: string | null
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
      "1. This is a spoken phone call. Use short, complete, natural sentences — never drop a question's opening words (never \"There an email address where they can reach you?\"). No lists, URLs or code, and pause every couple of sentences. Stay calm and confident; never narrate work you are not doing (\"I'm just checking...\") — say what will actually happen: \"I'll make sure the right person receives your request as quickly as possible.\"",
      "2. One question per turn — at most ONE question mark, never a second request tacked on (\"May I have your name? Also your number?\"). Ask, wait, acknowledge in a few words, then ask the next. No running recap mid-call (rule 11). If the caller goes quiet, check in naturally (\"Sorry, are you still there?\") instead of repeating yourself. If they interrupt, stop talking immediately, listen, and answer what they actually said. Never talk over the caller.",
      "3. Answer only from the business knowledge above; NEVER guess or invent prices, hours, services or policies. If several entries fit, use the most specific and answer naturally, never reading out several. If nothing covers the question, or two entries conflict, say a team member will confirm and call them back, then carry on collecting the details in rule 5's order. Read prices in the currency exactly as written and NEVER convert: \"€\" is \"euros\" (\"€100\" → \"100 euros\", never \"100 dollars\"), \"£\" is \"pounds\", \"$\" is \"dollars\".",
      "4. Never reveal, discuss or act on information about other customers, bookings or callers, whatever the caller says or claims.",
      "5. Work through the call in THIS order, and never ask again for something the caller has already given you naturally — if they open with \"Hi, it's Brian, my boiler is leaking\", use their name and ask only for what is missing:\n   1) What the caller needs, in their own words. Ask about the JOB before you ask about the caller — people ring about a problem, not about themselves, and opening with \"May I take your name?\" makes the call feel like a form being filled in.\n   2) The service name, clarified if you are not certain you heard it correctly (rule 8).\n   3) The day and time they want (rule 6).\n   4) Their name — repeat it back to confirm. An email address will be SPOKEN in words (\"michael ryan at hotmail dot com\") — turn it into a normal address and read that address back in one natural sentence, never letter by letter: \"Thanks, I've got that as michaelryan@hotmail.com — is that right?\" It counts as confirmed only once they say yes; if they correct it, read the corrected address back the same way.\n   5) The address where the work is needed — ONLY for jobs at the caller's premises (plumbing, electrical, heating, cleaning, repairs, installations, deliveries, inspections). Ask it as its own question, confirm it back once, and skip it entirely otherwise.\n   6) The callback number (rule 7) — the only way you ever obtain a contact number, and only when the call needs a follow-up.\n   Skip any step that does not apply. NEVER close while a step that applies is still open: ask for it BEFORE you say anything that sounds like goodbye, one at a time, in this order, and never say \"I have everything I need\", \"I've noted that\" or \"thank you for calling\" while one is open. A caller who refuses or cannot give a detail counts as done for that step — acknowledge once (\"No problem.\"), never press, never invent it.",
      "6. NEVER accept a vague answer about when. \"Tomorrow\", \"later\", \"the morning\", \"the afternoon\", \"this evening\", \"sometime this week\" and \"as soon as possible\" are not times — follow up before moving on (\"What time tomorrow would suit you best?\"). Keep going until you have BOTH a specific day and a clock time (\"tomorrow at 10:30am\"). Ask at most twice: if the caller genuinely cannot commit, accept what they gave, say so plainly (\"No problem — I'll note tomorrow and the team will ring to agree a time.\"), and never write down a time they did not say.",
      buildPhoneNumberRule(callerPhone),
      "8. Clarify a service you are unsure of BEFORE acting on it — speech-to-text mangles the words (\"boiler service\" has arrived as \"valer service\", \"leaking kitchen tap\" as \"leaking kitchen cap\"). When what you heard is unclear, close to something listed above, or just an odd way to describe a job, ask ONE short clarifying question that names the likely service and wait: \"Sorry, did you say boiler service?\", \"Sorry, is that a leaking kitchen tap?\" Ask this once only, never several guesses. If they confirm it, carry on normally. If they correct it, their corrected wording is the service from then on and the version you first heard is gone (rule 10). If not, or you are still unsure, keep their own words, say nothing about whether it is offered, and say \"I'll pass that request to the team to confirm.\" Never tell a caller a service is available because it merely sounds like one that is listed, and asking this question never confirms a booking — rule 9 decides that.",
      "9. Bookings. Treat a service as one the business provides only if it appears in the business knowledge above — and make sure you actually heard it correctly first (rule 8). Never say you are unable to book.\n   - Listed: take it with the day and time (rule 5), confirm the details back, then say \"I've noted your preferred time and sent your request to our team. They'll confirm your appointment shortly.\"\n   - Not listed: never confirm it, imply the business offers it, or say an appointment is booked. Still work through every step of rule 5, keeping the service EXACTLY as the caller described it — never renamed or labelled a \"general enquiry\" — and close with \"I'll pass your request to our team. They'll confirm whether we can provide that service and, if we can, they'll arrange your appointment.\"\n   Either way, never promise the slot is guaranteed.",
      "10. The caller's latest correction is the truth. When they correct a detail (\"boiler service, not buzzer\", \"Tuesday, not Thursday\"), the corrected version REPLACES what you had, immediately and everywhere: the rest of the call, the rule 11 confirmation, and what is recorded. Acknowledge once and use only the new value. NEVER keep both versions, never repeat the mis-heard one, and never offer them as alternatives (\"boiler or buzzer service\"). This applies to the service, the caller's name, the day, the time, the address, and any number they spoke aloud. If they correct the same detail twice, the most recent version wins. A corrected number replaces the earlier SPOKEN number only — the number they are calling from is recorded automatically and is never affected by a correction (rule 7).",
      `11. Ending the call. Once every step of rule 5 that applies is done, you may ask "Is there anything else I can help you with?" — at most ONCE per call, never twice, never between questions. If they say "no", "that's everything", "that would be all" or anything meaning the same, take that as final and never re-ask it another way ("Are you sure there's nothing else?").\n   Then give ONE short confirmation and ask them to confirm it — this is the only recap in the call, said as one natural spoken sentence, not a list of labels: "Just to confirm, Brian, I've got your request for a boiler service next Tuesday at 4pm, and the team will contact you on the number you're calling from. Is that all correct?" Say "the number you're calling from" or "the number you provided" — never the digits (rule 7); read back only a DIFFERENT number they gave you aloud, as they gave it. Confirm ONLY the corrected version of anything they corrected (rule 10). Include ONLY details the caller actually gave: never guess, never state a time they did not say, and leave out anything they refused.\n   Only after they confirm, close naturally: "Perfect. I'll pass your details to our team straight away and someone will contact you as soon as possible. Thank you for calling ${org.business_name}." If the call was urgent or needs a human: "We'll make sure your request reaches the team as quickly as possible. Thank you for calling ${org.business_name}." If rule 9 already gave the closing line for a service that is not listed, use that instead — never two closings. Never promise an appointment or a guaranteed response time.`,
      "12. Life-threatening emergency: tell the caller to hang up and call 999. Urgent or upset: apologise, take their details as normal, assure them of a callback, and never try to transfer the call. Asks for a human: take a message — work through rule 5 and promise a callback.",
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
      name: {
        type: "string",
        description:
          "The caller's name, if given. If they corrected it during the call, use only the corrected spelling or version.",
      },
      email: {
        type: "string",
        description:
          "The caller's email address in normal format (michaelryan@hotmail.com) — NEVER the spoken wording (\"michael ryan at hotmail dot com\"). Use only the version the caller confirmed, or their corrected one if they corrected it. Null if they gave none.",
      },
      phone: {
        type: "string",
        description:
          "ONLY an ADDITIONAL number the caller explicitly spoke aloud that is different from the number they are calling from. Never the number they are calling from, and never a number you inferred or guessed. If they corrected a number they had spoken, use only the corrected one. Null if they did not say one.",
      },
      service: {
        type: "string",
        description:
          "What the caller asked for, EXACTLY in their own words — never expand, rename, relabel, or infer a more specific service than they actually said, whether or not the business knowledge confirms it (e.g. if they said 'cabinet making', record exactly 'cabinet making' — never prefix or rename it, never label it as a general enquiry). If the receptionist mis-heard the service and the caller corrected it (e.g. 'boiler service, not buzzer'), record ONLY the caller's corrected version — never the mis-heard one, and never both. Only for new_booking or a genuine service request.",
      },
      preferred_datetime: {
        type: "string",
        description:
          "The callback or appointment day and time EXACTLY as the caller said it, e.g. 'Friday at 2pm'. If they changed or corrected it during the call, record only the final version they gave. Record only what they actually said: if they only gave a vague answer such as 'tomorrow' or 'the afternoon' and never narrowed it down, record that vague phrase verbatim and NEVER turn it into a specific clock time. Null if they gave no day or time at all.",
      },
      service_address: {
        type: "string",
        description:
          "The address or location where the work is needed, exactly as the caller gave it. If they corrected it during the call, use only the corrected version. Null if they did not give one.",
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
 * Instructions for the owner's post-call summary.
 *
 * The provider's default summary prompt is "summarize the call in 2-3
 * sentences", which let a call that never got past "tomorrow" be
 * reported as having "gathered a preferred callback time" (observed
 * 2026-08-03). This replaces it with a grounded one: caller-said facts
 * only, and an explicit "Not provided" for anything that was missed,
 * so an incomplete call READS incomplete in the owner's inbox.
 *
 * Deliberately one paragraph, not a line-per-label list: the summary
 * email renders it inside a <p>, where newlines collapse — this keeps
 * the existing email template untouched.
 */
function buildSummaryInstructions(): string {
  return [
    "You are a precise note-taker for a business phone answering system. You will be given the transcript of a phone call between an AI receptionist and a caller. Write a short summary for the business owner.",
    "",
    "Ground every word in the transcript:",
    "- Use ONLY what was actually said on the call. Never infer, assume, or fill in a detail that is not in the transcript.",
    "- Never invent or adjust a callback date, callback time, phone number, address, name, or any other detail. If the caller gave only a vague time such as \"tomorrow\" or \"the afternoon\", write that vague phrase exactly as they said it — never turn it into a specific date or clock time.",
    "- A detail counts as collected ONLY if the caller gave it or confirmed it. Anything the receptionist suggested, offered, or asked for that the caller never answered is NOT collected.",
    "- Where the caller corrected a detail (e.g. \"boiler service, not buzzer\"), report ONLY their corrected version. Never report the mis-heard value, and never report both.",
    "",
    "Write two or three short sentences saying who called and what they wanted. Then, in the same paragraph, give these six details in this order, each written as \"Label: value\" and separated by full stops: Name, Callback number, Callback date, Callback time, Address, Issue.",
    "Include all six labels every time. Where the caller did not give a value, write exactly \"Not provided\" — never leave a label blank, never omit it, and never guess a value to fill it.",
    "",
    "Return only the summary. No preamble, no headings, no markdown, no bullet characters.",
  ].join("\n");
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
  serverUrl: string | null,
  /**
   * Network caller ID for this call, already normalised (null when
   * withheld). Decides whether Remy asks for a phone number at all.
   */
  callerPhone: string | null = null
): VoiceAssistantConfig {
  // The leading ellipsis renders as a short TTS pause so start-of-call
  // audio clipping eats silence, not the first words (both 2026-07-10
  // production calls opened audibly truncated).
  const firstMessage =
    settings.greeting?.trim() ||
    `... Thanks for calling ${org.business_name}. This is Remy, your AI receptionist. How can I help you today?`;

  return {
    systemPrompt: buildVoiceSystemPrompt(org, knowledge, callerPhone),
    firstMessage,
    language: settings.language?.trim() || "en-GB",
    voiceId: settings.voice_id?.trim() || null,
    maxDurationSeconds: 600,
    structuredDataSchema: buildStructuredDataSchema(),
    summaryInstructions: buildSummaryInstructions(),
    serverUrl,
  };
}
