// ── Internal voice event schema (provider-agnostic) ───────────────
// The anti-corruption layer between the voice vendor and the rest of
// Remy. Webhook payloads from the provider (Vapi today) are mapped
// into these types by an adapter (vapi.ts); everything downstream —
// storage, lead capture, summary emails — consumes ONLY these types.
// Swapping providers later means writing one new adapter file, not
// changing the processing engine or routes.

export type VoiceProvider = "vapi";

/**
 * Structured data the assistant extracts during/after a call.
 * Deliberately mirrors the shape of ExtractedLead in leadCapture.ts so
 * a voice call feeds the existing lead engine without translation —
 * but kept as its own type: this is the *wire* shape promised by the
 * provider's analysis schema, validated before use, never trusted.
 */
export interface VoiceExtractedDetails {
  intent: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  service: string | null;
  preferred_datetime: string | null;
  urgent: boolean;
}

/** A completed phone call — the main event the platform acts on. */
export interface VoiceCallEndedEvent {
  kind: "call-ended";
  provider: VoiceProvider;
  /** Idempotency key for storage — unique per delivered event. */
  dedupeKey: string;
  providerCallId: string;
  /** E.164 number the caller dialled — resolves the tenant org. */
  businessPhone: string | null;
  /** Caller ID — the canonical phone contact for the lead. */
  callerPhone: string | null;
  direction: "inbound" | "outbound";
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  endedReason: string | null;
  summary: string | null;
  transcript: string | null;
  recordingUrl: string | null;
  costUsd: number | null;
  costBreakdown: Record<string, unknown> | null;
  extracted: VoiceExtractedDetails | null;
}

/** Mid-call status change (ringing, in-progress, ended…). */
export interface VoiceStatusEvent {
  kind: "status-update";
  provider: VoiceProvider;
  dedupeKey: string;
  providerCallId: string;
  businessPhone: string | null;
  callerPhone: string | null;
  status: string;
}

/**
 * The provider is asking which assistant should answer an incoming
 * call — Remy responds with a per-org assistant config built from
 * that org's knowledge base.
 */
export interface VoiceAssistantRequestEvent {
  kind: "assistant-request";
  provider: VoiceProvider;
  providerCallId: string | null;
  businessPhone: string | null;
  callerPhone: string | null;
}

/** A provider message type we recognise but deliberately don't act on. */
export interface VoiceIgnoredEvent {
  kind: "ignored";
  provider: VoiceProvider;
  eventType: string;
}

export type VoiceEvent =
  | VoiceCallEndedEvent
  | VoiceStatusEvent
  | VoiceAssistantRequestEvent
  | VoiceIgnoredEvent;

/**
 * Provider-agnostic assistant configuration. assistant.ts builds this
 * from the org's knowledge base; the provider adapter renders it into
 * the vendor's wire format.
 */
export interface VoiceAssistantConfig {
  systemPrompt: string;
  firstMessage: string;
  /** BCP-47 tag for the transcriber, e.g. "en-GB". */
  language: string;
  /** Provider voice id; null lets the adapter pick its default. */
  voiceId: string | null;
  maxDurationSeconds: number;
  /**
   * JSON schema for post-call structured extraction. The provider's
   * default analysis prompts are used against this schema — custom
   * analysis prompts are deliberately not configured yet, since their
   * wire format (template variables) should be confirmed against live
   * payloads before relying on them.
   */
  structuredDataSchema: Record<string, unknown>;
  /**
   * Absolute URL that call events should be posted back to; null
   * falls back to the server URL configured provider-side.
   */
  serverUrl: string | null;
}
