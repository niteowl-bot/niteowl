import type { VoiceExtractedDetails } from "@/lib/voice/types";

// ── Fallback transcript extraction ─────────────────────────────────
// The provider's post-call analysis is the primary source of
// structured lead data, but it is not guaranteed: Vapi documents that
// call.analysis.structuredData is left EMPTY when its extraction
// request times out (observed on the first real production call,
// 2026-07-10 — summary present, structuredData null). When that
// happens this module extracts the same fields from the transcript we
// already hold, so a lead is never lost to a provider-side analysis
// failure. Prompt rules are adapted from the chat/widget
// extractLeadData (duplicated per consumer, per the existing
// convention — route internals must not be imported here).

const VALID_INTENTS = [
  "new_booking",
  "reschedule",
  "contact_update",
  "question",
  "unknown",
] as const;

function buildTranscriptExtractionPrompt(transcript: string): string {
  return `You are a lead extraction assistant for a business phone answering system.

Below is the transcript of a phone call between an AI receptionist ("AI")
and a caller ("User"). Analyse the CALLER's side of the conversation and
return ONLY a valid JSON object describing what the caller wanted.

## Required JSON shape
{
  "intent": "new_booking" | "reschedule" | "contact_update" | "question" | "unknown",
  "name": string or null,
  "email": string or null,
  "phone": string or null,
  "service": string or null,
  "preferred_datetime": string or null,
  "service_address": string or null,
  "urgent": boolean
}

## Intent definitions
"new_booking" — the caller wanted to book, schedule, get a quote, request a
  service, demo, or appointment, or asked the business to arrange something
  for them. This includes requests the receptionist said it would "pass to
  the team": if the caller asked for an appointment or booking, the intent
  is new_booking even if nothing was confirmed on the call. Asking for
  someone to CALL THEM BACK about an appointment is not by itself a
  new_booking — use new_booking only if the caller asked to arrange the
  appointment on this call.
"reschedule" — the caller wanted to change or move an existing booking.
"contact_update" — the caller only provided or corrected contact details.
"question" — the caller only asked general questions; no booking action.
"unknown" — none of the above fit.

## Field rules
name — the caller's name as given on the call. Spoken spellings may be
  fragmented ("E r n e s t o") — join them naturally. Null if never given.
email — the caller's email address, ALWAYS in normal format
  ("john.smith@gmail.com") and never the spoken wording. Spoken emails
  arrive as words ("john dot smith at gmail dot com", "michael ryan at
  hotmail dot com" → "michaelryan@hotmail.com"): convert "at" to @, "dot"
  to ., "underscore" to _, "dash"/"hyphen" to -, and close up the spaces
  between spoken words. Prefer the version the receptionist read back and
  the caller confirmed. Null if never given.
phone — ONLY an additional number the caller spoke aloud to be reached on
  (e.g. "call me back on the office line instead"), digits as spoken. The
  number they are calling from is already known and recorded separately —
  never guess or reconstruct it. Null if they stated no number.
service — short summary of what the caller wants, e.g. "Boiler repair",
  "Product demo". Only when intent is new_booking; otherwise null.
preferred_datetime — the caller's requested day and time EXACTLY as they
  said it (e.g. "tomorrow at 2pm", "the twelfth of July at 10 AM",
  "Thursday between 2 and 5"). Do NOT convert to a calendar date. If the
  caller only gave a vague answer ("tomorrow", "the afternoon", "later") and
  never narrowed it down, record that vague phrase verbatim — NEVER turn it
  into a specific clock time and never borrow a time the receptionist
  suggested but the caller did not accept. URGENCY IS NOT A TIME: "as soon
  as possible", "ASAP", "whenever you can", "the earliest you can", "soon"
  and "any time" say how urgent the caller is, not when they are free —
  NEVER record one of them here; set urgent true instead. Null if no day or
  time was mentioned, including when urgency was all the caller gave.
service_address — the address or location where the work is needed, exactly
  as the caller gave it. Null if they gave none.
urgent — true only if the caller was urgent, upset, or needs a same-day
  callback.

## Critical rules
- Return ONLY the JSON object — no markdown, no explanation, no code fences.
- Extract only what the caller actually said; never invent details.
- CORRECTIONS WIN. Where the caller corrected the receptionist — "boiler
  service, not buzzer", "no, Tuesday, not Thursday", "it's Brian, with an i" —
  record ONLY the caller's corrected value. Never record the mis-heard version,
  never record both, and never combine them into one string ("buzzer/boiler
  service"). This holds for every field: the caller's last word on a detail is
  the value. It does not apply to the number they are calling from, which is
  recorded separately and never comes from the transcript.

Transcript:
"""
${transcript}
"""`;
}

/**
 * Extracts lead details from a call transcript. Returns null when
 * extraction is impossible or fails — callers treat null exactly like
 * a call the provider returned no structured data for, so a failure
 * here can never make things worse than before the fallback existed.
 */
export async function extractVoiceLeadFromTranscript(
  transcript: string | null,
  summary: string | null
): Promise<VoiceExtractedDetails | null> {
  const openaiKey = process.env.OPENAI_API_KEY;
  // The summary alone is a weak extraction source but far better than
  // dropping the call when the provider omitted the transcript too.
  const text = transcript?.trim() || summary?.trim() || "";
  if (!openaiKey || !text) return null;

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
        max_tokens: 300,
        messages: [
          { role: "user", content: buildTranscriptExtractionPrompt(text) },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.error("[voice] fallback extraction HTTP error:", res.status);
      return null;
    }

    const json = await res.json();
    const raw: string = json.choices?.[0]?.message?.content ?? "";
    const cleaned = raw
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    const asString = (value: unknown): string | null =>
      typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : null;

    return {
      intent: VALID_INTENTS.includes(parsed.intent as (typeof VALID_INTENTS)[number])
        ? (parsed.intent as string)
        : "unknown",
      name: asString(parsed.name),
      email: asString(parsed.email),
      phone: asString(parsed.phone),
      service: asString(parsed.service),
      preferred_datetime: asString(parsed.preferred_datetime),
      service_address: asString(parsed.service_address),
      urgent: parsed.urgent === true,
    };
  } catch (err) {
    console.error("[voice] fallback extraction failed:", err);
    return null;
  }
}
