import { timingSafeEqual } from "node:crypto";
import { normaliseCallerId } from "@/lib/voice/callerId";
import type {
  VoiceAssistantConfig,
  VoiceCallEndedEvent,
  VoiceEvent,
  VoiceExtractedDetails,
} from "@/lib/voice/types";

// ── Vapi adapter ───────────────────────────────────────────────────
// The ONLY file that knows Vapi's wire format. Inbound webhook bodies
// are mapped to the internal VoiceEvent types; outbound assistant
// configs are rendered from the internal VoiceAssistantConfig. Field
// locations are parsed defensively with fallbacks because the raw
// payload is always stored in voice_events first — a shape this
// parser misses is never lost, only left for a replay after a fix.

// ── Kill switch ────────────────────────────────────────────────────

/**
 * Global voice kill switch. Voice routes answer 404 unless
 * VOICE_ENABLED=true, so the entire surface stays dark in production
 * until deliberately switched on — and can be switched off again
 * without a deploy if calls misbehave. Chat is never affected.
 */
export function isVoiceEnabled(): boolean {
  return process.env.VOICE_ENABLED === "true";
}

// ── Webhook authentication ─────────────────────────────────────────

/**
 * Verifies the shared secret Vapi sends in the x-vapi-secret header
 * (configured as the "server URL secret" in the Vapi dashboard).
 * /api/voice/* is public — this comparison is the entire trust
 * boundary, same model as Stripe signature verification. Constant-time
 * compare; returns false when the env secret is unset so the routes
 * fail closed rather than open.
 */
export function verifyVoiceWebhookSecret(request: Request): boolean {
  const expected = process.env.VAPI_WEBHOOK_SECRET;
  if (!expected) {
    console.error("[voice] VAPI_WEBHOOK_SECRET not set — rejecting webhook.");
    return false;
  }

  const provided = request.headers.get("x-vapi-secret") ?? "";
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

// ── Inbound payload parsing ────────────────────────────────────────

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Vapi nests call context in several places depending on event type. */
function extractCallContext(message: UnknownRecord): {
  callId: string | null;
  businessPhone: string | null;
  callerPhone: string | null;
  direction: "inbound" | "outbound";
} {
  const call = asRecord(message.call);
  const callId = asString(call?.id);

  // The dialled business number: message.phoneNumber.number, falling
  // back to call.phoneNumber.number.
  const phoneNumber =
    asRecord(message.phoneNumber) ?? asRecord(call?.phoneNumber);
  const businessPhone = asString(phoneNumber?.number);

  // The caller: message.customer.number, falling back to call.customer.
  // Normalised here, in the anti-corruption layer, so a withheld number
  // arrives downstream as null rather than as the literal placeholder
  // the carrier sent ("anonymous", "+266696687"); the raw payload is
  // still stored verbatim in voice_events.
  const customer = asRecord(message.customer) ?? asRecord(call?.customer);
  const callerPhone = normaliseCallerId(asString(customer?.number));

  const callType = asString(call?.type) ?? "";
  const direction: "inbound" | "outbound" = callType
    .toLowerCase()
    .includes("outbound")
    ? "outbound"
    : "inbound";

  return { callId, businessPhone, callerPhone, direction };
}

/**
 * Validates the assistant's structured extraction. This arrives from
 * the provider (ultimately from an LLM listening to an untrusted
 * caller), so every field is type-checked — mirrors how the widget
 * route validates extractLeadData output before trusting it.
 */
function parseStructuredDetails(value: unknown): VoiceExtractedDetails | null {
  const data = asRecord(value);
  if (!data) return null;

  return {
    intent: asString(data.intent),
    name: asString(data.name),
    email: asString(data.email),
    phone: asString(data.phone),
    service: asString(data.service),
    preferred_datetime: asString(data.preferred_datetime),
    service_address: asString(data.service_address),
    urgent: data.urgent === true,
  };
}

/**
 * Maps a raw Vapi webhook body to an internal VoiceEvent.
 * Returns null only when the body has no recognisable Vapi envelope
 * at all (the route treats that as a bad request).
 */
export function parseVapiWebhook(body: unknown): VoiceEvent | null {
  const root = asRecord(body);
  const message = asRecord(root?.message);
  if (!message) return null;

  const eventType = asString(message.type);
  if (!eventType) return null;

  const { callId, businessPhone, callerPhone, direction } =
    extractCallContext(message);

  if (eventType === "assistant-request") {
    return {
      kind: "assistant-request",
      provider: "vapi",
      providerCallId: callId,
      businessPhone,
      callerPhone,
    };
  }

  if (eventType === "end-of-call-report") {
    if (!callId) return null;

    const analysis = asRecord(message.analysis);
    const artifact = asRecord(message.artifact);

    // Vapi sends durationSeconds as a decimal (e.g. 34.583), but
    // voice_calls.duration_seconds is an integer column — must round
    // or the upsert is rejected with "invalid input syntax for type
    // integer" (first real production call, 2026-07-10).
    const rawDurationSeconds =
      asNumber(message.durationSeconds) ??
      (asNumber(message.durationMs) !== null
        ? (asNumber(message.durationMs) as number) / 1000
        : null);
    const durationSeconds =
      rawDurationSeconds === null ? null : Math.round(rawDurationSeconds);

    const event: VoiceCallEndedEvent = {
      kind: "call-ended",
      provider: "vapi",
      dedupeKey: `vapi:${callId}:end-of-call-report`,
      providerCallId: callId,
      businessPhone,
      callerPhone,
      direction,
      startedAt: asString(message.startedAt),
      endedAt: asString(message.endedAt),
      durationSeconds,
      endedReason: asString(message.endedReason),
      summary: asString(analysis?.summary) ?? asString(message.summary),
      transcript:
        asString(message.transcript) ?? asString(artifact?.transcript),
      recordingUrl:
        asString(message.recordingUrl) ?? asString(artifact?.recordingUrl),
      costUsd: asNumber(message.cost),
      costBreakdown: asRecord(message.costBreakdown),
      extracted: parseStructuredDetails(analysis?.structuredData),
    };
    return event;
  }

  if (eventType === "tool-calls") {
    // Vapi's documented shape: message.toolCallList[], each with an id,
    // a name and already-parsed arguments. `toolCalls` with a nested
    // OpenAI-style function object is accepted as a fallback because
    // both appear in the wild; arguments arrive as an object there or
    // occasionally as a JSON string.
    const rawList =
      (Array.isArray(message.toolCallList) ? message.toolCallList : null) ??
      (Array.isArray(message.toolCalls) ? message.toolCalls : null) ??
      [];

    const calls = rawList
      .map((entry) => {
        const call = asRecord(entry);
        if (!call) return null;
        const fn = asRecord(call.function);
        const id = asString(call.id);
        const name = asString(call.name) ?? asString(fn?.name);
        if (!id || !name) return null;

        const rawArgs = call.arguments ?? fn?.arguments;
        let args: Record<string, unknown> = asRecord(rawArgs) ?? {};
        if (typeof rawArgs === "string") {
          try {
            args = asRecord(JSON.parse(rawArgs)) ?? {};
          } catch {
            args = {};
          }
        }
        return { id, name, args };
      })
      .filter((call): call is { id: string; name: string; args: Record<string, unknown> } => call !== null);

    if (calls.length === 0) return null;

    return {
      kind: "tool-call",
      provider: "vapi",
      providerCallId: callId,
      businessPhone,
      callerPhone,
      calls,
    };
  }

  if (eventType === "status-update") {
    const status = asString(message.status);
    if (!callId || !status) return null;

    return {
      kind: "status-update",
      provider: "vapi",
      dedupeKey: `vapi:${callId}:status:${status}`,
      providerCallId: callId,
      businessPhone,
      callerPhone,
      status,
    };
  }

  // Recognised envelope, unhandled type (transcript chunks, speech
  // updates, hang notifications…). Acknowledged so Vapi doesn't
  // retry, never stored, never processed.
  return { kind: "ignored", provider: "vapi", eventType };
}

// ── Outbound assistant rendering ───────────────────────────────────

/**
 * Vapi's built-in hang-up tool. Its whole definition is the type — a
 * default tool needs no function name, description or parameters, and
 * the model calls it like any other tool.
 *
 * Until this existed Remy could SAY goodbye but had no way to hang up,
 * so the line stayed open until the caller rang off or the 600s cap
 * expired. On the 2026-08-06 production call that produced:
 *   AI:   "...Have a great day. Goodbye. Bye."
 *   User: "Thanks. Bye."   AI: "Goodbye."
 *   User: "Bye."           AI: "Goodbye."
 * — the assistant knew the conversation was finished and kept
 * answering farewells because ending the call was not something it
 * could do.
 *
 * Model-driven on purpose. Vapi also offers `endCallPhrases`, which
 * hangs up on literal phrase matches in the CALLER's speech — that
 * would cut off "bye for now, but I have another question" mid
 * sentence. The tool leaves the decision with the model, which reads
 * the whole turn, and rule 11 states the one condition for using it.
 */
const END_CALL_TOOL = { type: "endCall" } as const;

/**
 * The tool name the model calls, and the name the webhook dispatches
 * on. Declared here rather than imported from availabilityTool.ts on
 * purpose: this module is loaded to answer every assistant-request,
 * and importing the lookup would drag the whole integrations chain
 * (credentials, crypto, provider registry) onto that path to obtain a
 * string.
 */
export const VOICE_AVAILABILITY_TOOL_NAME = "check_availability";

/**
 * The live-availability tool. Unlike endCall this is a CUSTOM function
 * tool: Vapi posts to our server URL mid-call, waits for the result,
 * and hands it to the model.
 *
 * It takes a date and a clock time separately, both in the business's
 * own timezone, rather than one ISO string. The model already resolves
 * "next Wednesday" correctly against the date in its prompt (verified
 * on a live call), but an ISO instant would also make it responsible
 * for a UTC offset — and a silent one-hour error there is a customer
 * sent to the wrong slot. The zone conversion is done in our code.
 *
 * Registered only when a server URL is known; without one Vapi would
 * have nowhere to ask, and a tool that always fails is worse than a
 * tool that is absent (rule 6 then simply asks for a preferred time,
 * exactly as it does today).
 */
function buildAvailabilityTool(serverUrl: string): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: VOICE_AVAILABILITY_TOOL_NAME,
      description:
        "Check whether a specific appointment date and time is actually available, and get real alternatives if it is not. Use ONLY for appointments, service visits and bookings — never for callback requests. Call it once you have both a calendar date and a clock time, before telling the caller anything about availability. Never state or guess availability without calling this first.",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description:
              "The appointment date as YYYY-MM-DD, resolved from today's date given in your instructions (e.g. 2026-08-12).",
          },
          time: {
            type: "string",
            description:
              "The requested start time on that date, 24-hour HH:MM in the business's local time (e.g. 15:00 for 3 PM).",
          },
        },
        required: ["date", "time"],
      },
    },
    server: { url: serverUrl, timeoutSeconds: 20 },
  };
}

/**
 * Renders the internal assistant config into Vapi's transient
 * assistant response for an assistant-request. Recording is
 * explicitly disabled (GDPR decision: transcripts only at launch).
 */
export function buildVapiAssistantResponse(
  config: VoiceAssistantConfig
): Record<string, unknown> {
  return {
    assistant: {
      name: "Remy",
      firstMessage: config.firstMessage,
      model: {
        provider: "openai",
        model: "gpt-4o",
        messages: [{ role: "system", content: config.systemPrompt }],
        tools: config.serverUrl
          ? [END_CALL_TOOL, buildAvailabilityTool(config.serverUrl)]
          : [END_CALL_TOOL],
      },
      transcriber: {
        provider: "deepgram",
        model: "nova-2",
        language: config.language,
      },
      ...(config.voiceId
        ? { voice: { provider: "11labs", voiceId: config.voiceId } }
        : {}),
      maxDurationSeconds: config.maxDurationSeconds,
      serverMessages: ["end-of-call-report", "status-update"],
      ...(config.serverUrl ? { server: { url: config.serverUrl } } : {}),
      artifactPlan: { recordingEnabled: false },
      analysisPlan: {
        // Vapi's analysis requests default to a 5s timeout and leave
        // the result EMPTY on expiry (per their API spec) — observed
        // on the first real production call, where the summary arrived
        // but structuredData was null. 30s trades a slower end-of-call
        // report for reliable extraction.
        // Custom summary messages replace Vapi's default prompt
        // ("summarize the call in 2-3 sentences"), which was happy to
        // report details the call never actually collected. Shape and
        // template variables are per SummaryPlan.messages in Vapi's
        // OpenAPI spec ({{transcript}}, {{systemPrompt}}, {{messages}},
        // {{endedReason}}); the user message mirrors their documented
        // default so only the instructions change. If a future Vapi
        // change breaks this, the summary comes back empty rather than
        // wrong — the email says so, and the lead itself comes from
        // structuredData, not from here.
        summaryPlan: {
          enabled: true,
          timeoutSeconds: 30,
          messages: [
            { role: "system", content: config.summaryInstructions },
            {
              role: "user",
              content:
                "Here is the transcript:\n\n{{transcript}}\n\n. Here is the ended reason of the call:\n\n{{endedReason}}\n\n",
            },
          ],
        },
        structuredDataPlan: {
          enabled: true,
          schema: config.structuredDataSchema,
          timeoutSeconds: 30,
        },
      },
    },
  };
}

/**
 * Minimal assistant that politely declines the call — used when the
 * org's trial/subscription has lapsed (the voice equivalent of the
 * widget's paused-chat reply) so a lapsed business's phone line fails
 * gracefully instead of dead air.
 */
export function buildVapiDeclineResponse(
  businessName: string
): Record<string, unknown> {
  return {
    assistant: {
      name: "Remy",
      firstMessage: `Thanks for calling ${businessName}. We're not able to take calls right now — please try again later. Goodbye.`,
      model: {
        provider: "openai",
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "The business cannot take calls right now. Apologise briefly, suggest the caller tries again later, and end the call with the end-call tool. Do not answer questions or take messages.",
          },
        ],
        // This assistant was already told to "end the call" and had no
        // way to do it either.
        tools: [END_CALL_TOOL],
      },
      maxDurationSeconds: 60,
      artifactPlan: { recordingEnabled: false },
    },
  };
}
