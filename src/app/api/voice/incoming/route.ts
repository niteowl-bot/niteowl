import { NextRequest } from "next/server";
import { handleVoiceWebhookPost } from "@/lib/voice/handler";

export const runtime = "nodejs";

// Inbound-call answering — the phone number's server URL points here,
// and the assistant-request is answered with a per-org assistant built
// from that org's live knowledge base. Delegates to the same handler
// as /api/voice/webhook so either URL accepts any message type.
export async function POST(request: NextRequest) {
  return handleVoiceWebhookPost(request);
}
