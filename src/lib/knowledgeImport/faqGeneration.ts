// ── FAQ suggestion generation ───────────────────────────────────────
// gpt-4o-mini, text-only — matches the model choice used for every other
// auxiliary/extraction task in this codebase (assessAnswerConfidence,
// extractLeadData, extractVoiceLeadFromTranscript). Same house style:
// raw fetch, prompt-instructed JSON, manual parse, null-safe fallback.

export interface SuggestedFaq {
  question: string;
  answer: string;
  confidence: number;
}

function buildFaqGenerationPrompt(knowledgeSummary: string): string {
  return `You are helping a small business turn its Knowledge Base into a
set of Frequently Asked Questions their customers would plausibly ask an
AI receptionist.

Below is a summary of the business's knowledge (services, prices, hours,
policies, etc). Generate between 3 and 8 FAQs, using ONLY the
information given. Return ONLY a valid JSON object in this exact shape:

{
  "faqs": [
    { "question": string, "answer": string, "confidence": number }
  ]
}

## Rules
- Every answer must be fully supported by the knowledge below — never
  invent a price, policy, hour, or fact not present in it.
- Prefer the kinds of questions a real customer would actually ask (e.g.
  "How much is a boiler service?", "What are your opening hours?", "Do
  you charge a call-out fee?", "Which payment methods do you accept?").
- Keep answers short, direct, and in the business's voice — a sentence
  or two, not a paragraph.
- confidence (0.0–1.0) reflects how directly the knowledge below
  supports that exact answer — lower it if you had to combine or
  paraphrase across multiple knowledge items.
- If the knowledge below is too sparse to generate any grounded FAQ,
  return {"faqs": []}.
- Return ONLY the JSON object — no markdown, no explanation, no code fences.

## Business knowledge
${knowledgeSummary || "No knowledge provided."}`;
}

function asConfidence(value: unknown): number {
  const num = typeof value === "number" && Number.isFinite(value) ? value : 0.5;
  return Math.min(1, Math.max(0, num));
}

/**
 * Generates suggested FAQ question/answer pairs from a plain-text
 * knowledge summary. Returns null on any failure — callers simply skip
 * FAQ suggestions for that batch/entry rather than blocking the rest of
 * the import, following this codebase's fail-safe house style.
 */
export async function generateFaqSuggestions(
  knowledgeSummary: string
): Promise<SuggestedFaq[] | null> {
  const openaiKey = process.env.OPENAI_API_KEY;
  const trimmedSummary = knowledgeSummary.trim();
  if (!openaiKey || !trimmedSummary) return null;

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
        max_tokens: 1200,
        messages: [{ role: "user", content: buildFaqGenerationPrompt(trimmedSummary) }],
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      console.error("[knowledgeImport] FAQ generation HTTP error:", res.status);
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
    const rawFaqs = Array.isArray(parsed.faqs) ? parsed.faqs : [];

    return rawFaqs
      .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
      .map((f) => ({
        question: typeof f.question === "string" ? f.question.trim() : "",
        answer: typeof f.answer === "string" ? f.answer.trim() : "",
        confidence: asConfidence(f.confidence),
      }))
      .filter((f) => f.question.length > 0 && f.answer.length > 0);
  } catch (err) {
    console.error("[knowledgeImport] FAQ generation failed:", err);
    return null;
  }
}
