export interface ParseDatetimeResult {
  iso: string | null;
  failed: boolean;
}

// ── Weekday correction ───────────────────────────────────────────
// The model reliably gets the time-of-day and the UTC offset right,
// but it has to work out for itself which calendar date a weekday
// name refers to — and it gets that wrong. Given "Current date and
// time (UTC): 2026-07-30" (a Thursday) it resolved "Monday" to
// 2026-08-01, which is a Saturday. The booking was then validated
// against Saturday's hours instead of Monday's, so a time well
// inside Monday's opening hours was rejected as outside them.
//
// Weekday → date is exact arithmetic, so it is done here in code
// rather than trusted to the model: if the expression names a
// weekday, the parsed result is snapped onto the next occurrence of
// that weekday, keeping the wall-clock time the model resolved.

const WEEKDAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, weds: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

function findWeekdayInText(text: string): number | null {
  const lower = text.toLowerCase();
  for (const [name, day] of Object.entries(WEEKDAY_NAMES)) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) return day;
  }
  return null;
}

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAY_SHORT: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function getZonedParts(date: Date, timezone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: WEEKDAY_SHORT[map.weekday],
  };
}

// Offset of `timezone` at this instant, in minutes east of UTC.
function getZoneOffsetMinutes(date: Date, timezone: string): number {
  const p = getZonedParts(date, timezone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  // Drop seconds/ms from the instant so only whole minutes are compared.
  const actual = Math.floor(date.getTime() / 60000) * 60000;
  return (asIfUtc - actual) / 60000;
}

// Builds the UTC instant for a wall-clock time in `timezone`, so 18:45
// in the business's timezone stays 18:45 there (BST or GMT).
function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const firstGuess = new Date(naive - getZoneOffsetMinutes(new Date(naive), timezone) * 60000);
  // Re-resolve once: the offset can differ across a DST boundary.
  const settled = new Date(naive - getZoneOffsetMinutes(firstGuess, timezone) * 60000);
  return settled;
}

/**
 * If `text` names a weekday, forces `parsed` onto the next occurrence of
 * that weekday (today included, when the time has not yet passed),
 * preserving the local time-of-day the model resolved.
 */
function snapToNamedWeekday(
  parsed: Date,
  text: string,
  timezone: string,
  now: Date
): Date {
  const targetWeekday = findWeekdayInText(text);
  if (targetWeekday === null) return parsed;

  const parsedParts = getZonedParts(parsed, timezone);
  if (parsedParts.weekday === targetWeekday) return parsed;

  const nowParts = getZonedParts(now, timezone);
  let daysAhead = (targetWeekday - nowParts.weekday + 7) % 7;

  // Same weekday as today: keep today only if the time is still ahead.
  if (daysAhead === 0) {
    const minutesNow = nowParts.hour * 60 + nowParts.minute;
    const minutesTarget = parsedParts.hour * 60 + parsedParts.minute;
    if (minutesTarget <= minutesNow) daysAhead = 7;
  }

  // Advance from today's local date, letting Date.UTC normalise month ends.
  const target = new Date(
    Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day + daysAhead)
  );
  const targetDate = getZonedParts(target, "UTC");

  return zonedWallClockToUtc(
    targetDate.year,
    targetDate.month,
    targetDate.day,
    parsedParts.hour,
    parsedParts.minute,
    timezone
  );
}

/**
 * Uses GPT to convert free-text datetime expressions into ISO timestamps.
 * Called directly from server code (e.g. the chat lead-capture flow) —
 * there is no HTTP route for this, to avoid an unauthenticated endpoint
 * that does nothing but spend OpenAI budget.
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

  const nowDate = new Date();
  const now = nowDate.toISOString();

  // The model was previously given only the UTC instant and had to infer
  // today's weekday from it, which is where the weekday→date errors came
  // from. Stating the local date and weekday explicitly removes the guess;
  // snapToNamedWeekday below still enforces it deterministically.
  const localNow = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(nowDate);

  const prompt = `You are a datetime parser. Convert the following natural language datetime expression into an ISO 8601 timestamp.

Current date and time (UTC): ${now}
Current local date and time in ${timezone}: ${localNow}
User timezone hint: ${timezone}

Expression: "${text}"

Rules:
- Return ONLY a valid ISO 8601 string (e.g. "2024-07-15T16:00:00.000Z")
- The expression describes a local time in ${timezone}. Convert it to UTC using that timezone's offset on that date.
- When the expression names a weekday, resolve it against the current local date above — the next occurrence of that weekday, today included if the time has not passed.
- If the expression is ambiguous (e.g. "afternoon", "morning"), use a reasonable default (afternoon = 14:00, morning = 09:00, evening = 18:00)
- If the expression cannot be converted to a specific date and time at all, return the string "null"
- Do not return any explanation, just the ISO string or "null"

Examples (these assume a local date of Monday 1 July 2024 and a +01:00 offset — always use the current local date above instead):
tomorrow at 4pm → 2024-07-02T15:00:00.000Z (adjusted for timezone)
next Monday 10am → 2024-07-08T09:00:00.000Z
Friday afternoon → 2024-07-05T13:00:00.000Z
July 15 at 2:30pm → 2024-07-15T13:30:00.000Z
sometime next week → null
`;
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
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.error("[parseDatetimeToIso] OpenAI error:", res.status);
      return { iso: null, failed: true };
    }

    const json = await res.json();
    const raw = (json.choices?.[0]?.message?.content?.trim() ?? "null").replace(/^["']|["']$/g, "");


    if (raw === "null" || raw === "") {
      return { iso: null, failed: false };
    }

    const parsed = new Date(raw);
    if (isNaN(parsed.getTime())) {
      console.error("[parseDatetimeToIso] unparseable model output:", raw);
      return { iso: null, failed: true };
    }

    const corrected = snapToNamedWeekday(parsed, text, timezone, nowDate);

    if (corrected.getTime() !== parsed.getTime()) {
      console.log(
        "[parseDatetimeToIso] corrected weekday for",
        JSON.stringify(text),
        "| model:",
        parsed.toISOString(),
        "→ corrected:",
        corrected.toISOString()
      );
    }

    return { iso: corrected.toISOString(), failed: false };
  } catch (err) {
    console.error("[parseDatetimeToIso] request error:", err);
    return { iso: null, failed: true };
  }
}

