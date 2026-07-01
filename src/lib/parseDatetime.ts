export interface ParseDatetimeResult {
  iso: string | null;
  failed: boolean;
}

/**
 * Uses GPT to convert free-text datetime expressions into ISO timestamps.
 * Shared by the /api/parse-datetime route and the chat lead-capture flow —
 * call this directly from server code instead of fetching the route.
 */
export async function parseDatetimeToIso(
  text: string | null,
  timezone: string = "Europe/London"
): Promise<ParseDatetimeResult> {
  if (!text) {
    return { iso: null, failed: false };
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return { iso: null, failed: true };
  }

  const now = new Date().toISOString();

  const prompt = `You are a datetime parser. Convert the following natural language datetime expression into an ISO 8601 timestamp.

Current date and time (UTC): ${now}
User timezone hint: ${timezone}

Expression: "${text}"

Rules:
- Return ONLY a valid ISO 8601 string (e.g. "2024-07-15T16:00:00.000Z")
- If the expression is ambiguous (e.g. "afternoon", "morning"), use a reasonable default (afternoon = 14:00, morning = 09:00, evening = 18:00)
- If the expression cannot be converted to a specific date and time at all, return the string "null"
- Do not return any explanation, just the ISO string or "null"

Examples:
"tomorrow at 4pm" → "2024-07-02T15:00:00.000Z" (adjusted for timezone)
"next Monday 10am" → "2024-07-07T09:00:00.000Z"
"Friday afternoon" → "2024-07-05T13:00:00.000Z"
"July 15 at 2:30pm" → "2024-07-15T13:30:00.000Z"
"sometime next week" → "null"`;

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
        max_tokens: 50,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error("[parseDatetimeToIso] OpenAI error:", res.status);
      return { iso: null, failed: true };
    }

    const json = await res.json();
    const raw = json.choices?.[0]?.message?.content?.trim() ?? "null";

    if (raw === "null" || raw === "") {
      return { iso: null, failed: false };
    }

    const parsed = new Date(raw);
    if (isNaN(parsed.getTime())) {
      console.error("[parseDatetimeToIso] unparseable model output:", raw);
      return { iso: null, failed: true };
    }

    return { iso: parsed.toISOString(), failed: false };
  } catch (err) {
    console.error("[parseDatetimeToIso] request error:", err);
    return { iso: null, failed: true };
  }
}

