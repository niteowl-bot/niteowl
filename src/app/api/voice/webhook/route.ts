import { NextRequest } from "next/server";
import { handleVoiceWebhookPost } from "@/lib/voice/handler";

export const runtime = "nodejs";

// Voice provider server URL — receives end-of-call reports and status
// updates (and handles assistant-request too, so a provider-side
// misconfiguration never drops events). Public endpoint authenticated
// by the shared secret inside the handler; dark until VOICE_ENABLED.
export async function POST(request: NextRequest) {
  return handleVoiceWebhookPost(request);
}
