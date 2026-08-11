import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { isVoiceEnabled } from "@/lib/voice/vapi";
import { replayFailedVoiceEvents } from "@/lib/voice/replay";

// ── Scheduled recovery of failed voice events ─────────────────────
//
// The scheduler's only job is to call this on a timer; every decision
// about what is eligible, what is claimed and what is retried lives in
// lib/voice/replay.ts, so the behaviour is testable without a scheduler
// and identical however it is invoked.
//
// Same trust model as the voice webhook: the endpoint is public and
// authenticity comes solely from a shared secret, compared in constant
// time. Vercel Cron sends it as `Authorization: Bearer $CRON_SECRET`.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorised(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[voice replay] CRON_SECRET not set — refusing to run.");
    return false;
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : header;

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export async function GET(req: NextRequest): Promise<Response> {
  // Mirrors the webhook: the whole voice surface stays dark unless
  // VOICE_ENABLED=true, and a disabled surface has nothing to replay.
  if (!isVoiceEnabled()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (!isAuthorised(req)) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  const outcome = await replayFailedVoiceEvents(createAdminClient());

  // 200 even when events failed again: the run itself succeeded, and a
  // non-200 would make the scheduler retry immediately, racing the
  // claims still held by this pass.
  return NextResponse.json({ ok: true, ...outcome });
}
