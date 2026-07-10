import { timingSafeEqual } from "node:crypto";
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
  const customer = asRecord(message.customer) ?? asRecord(call?.customer);
  const callerPhone = asString(customer?.number);

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
        summaryPlan: { enabled: true },
        structuredDataPlan: {
          enabled: true,
          schema: config.structuredDataSchema,
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
              "The business cannot take calls right now. Apologise briefly, suggest the caller tries again later, and end the call. Do not answer questions or take messages.",
          },
        ],
      },
      maxDurationSeconds: 60,
      artifactPlan: { recordingEnabled: false },
    },
  };
}
