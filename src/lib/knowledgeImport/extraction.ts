import { KNOWLEDGE_CATEGORY_VALUES } from "@/lib/knowledgeImport/constants";

// ── Document extraction ─────────────────────────────────────────────
// Same shape as src/lib/voice/extraction.ts: build-prompt → raw fetch to
// OpenAI → strip code fences → JSON.parse in try/catch → per-field
// coercion → typed result or null on any failure. This codebase has no
// openai SDK and never uses response_format/json_schema anywhere — this
// follows that house style rather than introducing a new one.
//
// gpt-4o (not gpt-4o-mini, used for every other auxiliary task in this
// codebase) is the one deliberate model deviation here: vision input
// requires it.

export interface ExtractedKnowledgeItem {
  category: string;
  title: string;
  content: string | null;
  price: number | null;
  currency: string | null;
  duration_minutes: number | null;
  notes: string | null;
  quote_required: boolean;
  starting_from: boolean;
  confidence: number;
}

export interface DocumentExtractionResult {
  detectedCurrency: string | null;
  items: ExtractedKnowledgeItem[];
}

function buildDocumentExtractionPrompt(): string {
  return `You are a business-information extraction assistant. You will be
shown an image of a document (a menu, price list, brochure, flyer,
service list, product catalogue, policy document, screenshot, or
similar) belonging to a small business. Extract every piece of useful
business information visible in the image and return ONLY a valid JSON
object in this exact shape:

{
  "detected_currency": string or null,
  "items": [
    {
      "category": "faq" | "service" | "pricing" | "opening_hours" | "policy" | "custom_instruction",
      "title": string,
      "description": string or null,
      "price": number or null,
      "currency": string or null,
      "duration_minutes": number or null,
      "notes": string or null,
      "quote_required": boolean,
      "starting_from": boolean,
      "confidence": number
    }
  ]
}

## Field rules
category — pick the single best-fitting category from the six listed.
  Use "service" for products/services/menu items, "pricing" for
  standalone price-list entries not tied to a specific service
  description, "policy" for cancellation/refund/guarantee/payment-method
  rules, "opening_hours" for hours of operation, "faq" only if the
  document is itself phrased as a question and answer.
title — short name of the item (e.g. "Standard Boiler Service", "Monday
  to Friday").
description — a plain-language description of what's visible, in your
  own words. Null if there's nothing beyond the title/price worth
  capturing.
price — a numeric price if one is visibly stated, INCLUDING when it's
  phrased as "from"/"starting at" (e.g. "From £120" → price: 120,
  starting_from: true — do not leave price null just because the
  wording is "from"). Null if no price is shown, or if only a price
  RANGE with no single figure is given (put the range in "notes"
  instead).
currency — the ISO 4217 code for the price's currency if determinable
  from a symbol or text on the page (e.g. "£" → "GBP", "$" → "USD"). Null
  if genuinely not determinable from the image.
duration_minutes — how long the service takes, in minutes, only if
  explicitly stated (e.g. "45 min" → 45, "1 hour" → 60). Null otherwise.
notes — any other relevant detail (call-out fees, price ranges,
  conditions, what's included) that doesn't fit the other fields.
quote_required — true only if the document explicitly says pricing is
  "on request", "quote only", "POA", "varies", or similar — never infer
  this from a missing price alone.
starting_from — true only if the document literally uses wording like
  "from", "starting at", "prices from", or "onwards" next to the price.
confidence — your own honest estimate (0.0–1.0) of how certain you are
  this item was read correctly, based on image legibility and ambiguity.
  Lower it for blurry, cut-off, or ambiguous text; do not default to a
  high number.

## Critical rules
- Extract ONLY what is visibly present in the image. Never invent a
  price, service, policy, hour, or fact that isn't shown.
- If the same currency applies to every priced item, also set
  detected_currency at the top level; otherwise null.
- If nothing useful can be extracted, return {"detected_currency": null, "items": []}.
- Return ONLY the JSON object — no markdown, no explanation, no code fences.`;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asCategory(value: unknown): string {
  return typeof value === "string" && KNOWLEDGE_CATEGORY_VALUES.includes(value)
    ? value
    : "service";
}

function asConfidence(value: unknown): number {
  const num = typeof value === "number" && Number.isFinite(value) ? value : 0.5;
  return Math.min(1, Math.max(0, num));
}

/**
 * Extracts structured business knowledge from a single document page
 * image. Returns null when extraction is impossible or fails — callers
 * mark that file/page as failed and continue with the rest of the batch,
 * exactly like extractVoiceLeadFromTranscript's null-on-failure contract.
 */
export async function extractKnowledgeFromImage(
  base64DataUrl: string
): Promise<DocumentExtractionResult | null> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey || !base64DataUrl) return null;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0,
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildDocumentExtractionPrompt() },
              { type: "image_url", image_url: { url: base64DataUrl } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      console.error("[knowledgeImport] extraction HTTP error:", res.status);
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
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];

    const items: ExtractedKnowledgeItem[] = rawItems
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => ({
        category: asCategory(item.category),
        title: asString(item.title) ?? "Untitled",
        content: asString(item.description),
        price: asNumber(item.price),
        currency: asString(item.currency),
        duration_minutes: asNumber(item.duration_minutes),
        notes: asString(item.notes),
        quote_required: asBoolean(item.quote_required),
        starting_from: asBoolean(item.starting_from),
        confidence: asConfidence(item.confidence),
      }));

    return {
      detectedCurrency: asString(parsed.detected_currency),
      items,
    };
  } catch (err) {
    console.error("[knowledgeImport] extraction failed:", err);
    return null;
  }
}
