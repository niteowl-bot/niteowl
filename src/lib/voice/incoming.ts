import { createAdminClient } from "@/lib/supabase/admin";
import { hasActiveAccess } from "@/lib/billing/access";
import {
  buildVoiceAssistantConfig,
  type VoiceKnowledgeRecord,
} from "@/lib/voice/assistant";
import {
  buildVapiAssistantResponse,
  buildVapiDeclineResponse,
} from "@/lib/voice/vapi";
import type { VoiceAssistantRequestEvent } from "@/lib/voice/types";

// ── Assistant-request handling ─────────────────────────────────────
// The provider is asking "who answers this call?". The dialled number
// resolves the org (tenant key), the org's LIVE knowledge base builds
// the prompt — so knowledge edits apply to the very next call with
// nothing to sync — and the same billing gate as chat decides whether
// Remy answers at all.

type AdminClient = ReturnType<typeof createAdminClient>;

interface AssistantRequestResult {
  status: number;
  body: Record<string, unknown>;
}

export async function buildAssistantRequestResponse(
  admin: AdminClient,
  event: VoiceAssistantRequestEvent
): Promise<AssistantRequestResult> {
  if (!event.businessPhone) {
    console.error("[voice] assistant-request without a dialled number");
    return { status: 400, body: { error: "Missing phone number." } };
  }

  // ── Resolve org by dialled number — the ONLY identity check here ──
  const { data: settings, error: settingsError } = await admin
    .from("voice_settings")
    .select("org_id, enabled, greeting, voice_id, language")
    .eq("phone_number", event.businessPhone)
    .maybeSingle();

  if (settingsError || !settings) {
    console.error(
      "[voice] no settings for number:",
      event.businessPhone,
      "| error:",
      settingsError?.message
    );
    return { status: 404, body: { error: "Unknown number." } };
  }

  if (!settings.enabled) {
    console.log("[voice] number is disabled:", event.businessPhone);
    return { status: 404, body: { error: "Voice is not enabled for this number." } };
  }

  const { data: org, error: orgError } = await admin
    .from("organisations")
    .select(
      "id, business_name, business_type, primary_goal, description, website, subscription_status, trial_ends_at"
    )
    .eq("id", settings.org_id)
    .maybeSingle();

  if (orgError || !org) {
    console.error(
      "[voice] org lookup failed:",
      settings.org_id,
      "| error:",
      orgError?.message
    );
    return { status: 404, body: { error: "Unknown organisation." } };
  }

  // ── Billing gate — same rule as chat: a lapsed trial/subscription
  // means Remy politely declines instead of answering ────────────────
  if (!hasActiveAccess(org)) {
    console.log("[voice] subscription lapsed — declining call for org:", org.id);
    return { status: 200, body: buildVapiDeclineResponse(org.business_name) };
  }

  // ── Live knowledge base → voice prompt ────────────────────────────
  const { data: knowledgeData, error: knowledgeError } = await admin
    .from("business_knowledge")
    .select("category, title, content")
    .eq("org_id", org.id)
    .eq("is_active", true)
    .eq("status", "published")
    .order("category", { ascending: true })
    .order("display_order", { ascending: true });

  if (knowledgeError) {
    // Answer with identity-only knowledge rather than failing the
    // call — rule 4 in the prompt makes Remy take a message for
    // anything it can't answer.
    console.error("[voice] knowledge fetch failed:", knowledgeError.message);
  }

  const knowledge: VoiceKnowledgeRecord[] = knowledgeData ?? [];

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? null;
  if (!appUrl) {
    console.error(
      "[voice] NEXT_PUBLIC_APP_URL not set — call events will fall back to the provider-configured server URL."
    );
  }
  const serverUrl = appUrl ? `${appUrl}/api/voice/webhook` : null;

  const config = buildVoiceAssistantConfig(org, knowledge, settings, serverUrl);
  return { status: 200, body: buildVapiAssistantResponse(config) };
}
