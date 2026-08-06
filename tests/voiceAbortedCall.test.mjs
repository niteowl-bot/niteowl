// Regression: "Remy answered a phone call" for a call Remy never answered.
//
// The 2026-08-06 incident. An inbound call ended as
//   call.ringing.sip-inbound-caller-hungup-before-call-connect
// with NULL duration and NULL transcript — the caller heard silence
// because the call never left the ringing state and no assistant was
// ever attached. The owner still received the standard email:
//
//   "Remy answered a phone call for <business>."
//   "No summary was generated for this call."
//   "No lead was created from this call."
//
// Nothing in the post-call pipeline had failed (voice_events.
// processing_error was NULL); processCallEnded simply emailed
// unconditionally on every end-of-call-report. Two connected calls the
// same afternoon (customer-ended-call, 435s/2871 chars and 196s/2671
// chars) produced transcripts and emails normally, and must keep doing
// so — that is what test B guards.
//
// These drive the REAL processCallEnded with the HTTP layer stubbed
// (same approach as voiceLeadIsolation.test.mjs), so the assertion is
// about what actually leaves the process: a request to Resend, or none.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import — see the file
import { processCallEnded, callNeverConnected } from "@/lib/voice/calls";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CALLER = "+353871465274";
const BUSINESS = "+353212345678";

/** The call that produced the false email, as Vapi reported it. */
const RING_ABORTED = {
  kind: "call-ended",
  provider: "vapi",
  dedupeKey: "vapi:ring-aborted:end-of-call-report",
  providerCallId: "cccccccc-3333-4333-8333-cccccccccccc",
  businessPhone: BUSINESS,
  callerPhone: CALLER,
  direction: "inbound",
  startedAt: "2026-08-06T15:10:00.000Z",
  endedAt: "2026-08-06T15:10:07.000Z",
  durationSeconds: null,
  endedReason: "call.ringing.sip-inbound-caller-hungup-before-call-connect",
  summary: null,
  transcript: null,
  recordingUrl: null,
  costUsd: null,
  costBreakdown: null,
  extracted: null,
};

/** A healthy call from the same afternoon: connected, then hung up. */
const CONNECTED = {
  ...RING_ABORTED,
  dedupeKey: "vapi:connected:end-of-call-report",
  providerCallId: "dddddddd-4444-4444-8444-dddddddddddd",
  startedAt: "2026-08-06T15:14:00.000Z",
  endedAt: "2026-08-06T15:17:16.000Z",
  durationSeconds: 196,
  endedReason: "customer-ended-call",
  summary: "A caller asked about opening hours. Name: Not provided.",
  transcript: "AI: Thanks for calling. User: What time do you open?",
};

/**
 * Stubs the whole outbound HTTP surface and records any Resend send.
 * Every unstubbed URL throws, so a request this test does not know
 * about surfaces as a failure rather than reaching the network.
 */
function installStubs() {
  const realFetch = globalThis.fetch;
  const emails = [];
  const voiceCallWrites = [];

  const json = (body) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers ?? {});
    const wantsObject = (headers.get("accept") ?? "").includes("pgrst.object");

    if (url.includes("api.resend.com")) {
      emails.push(JSON.parse(init.body));
      return json({ id: `email-${emails.length}` });
    }

    if (url.includes("/rest/v1/voice_calls")) {
      if (method === "POST" || method === "PATCH") {
        voiceCallWrites.push({ method, payload: JSON.parse(init.body) });
      }
      const row = { id: "call-row-1" };
      return wantsObject ? json(row) : json([row]);
    }

    if (url.includes("/rest/v1/organisations")) {
      // getOrgOwnerEmail: notification_email set, so no auth lookup.
      const row = {
        owner_id: "22222222-2222-4222-8222-222222222222",
        business_name: "Acme Plumbing",
        notification_email: "owner@example.com",
      };
      return wantsObject ? json(row) : json([row]);
    }

    if (url.includes("api.openai.com")) {
      // Fallback transcript extraction: a plain question, nothing to
      // capture — so this call creates no lead, and the email is still
      // the only thing that tells the owner it happened.
      return json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent: "question",
                name: null,
                email: null,
                phone: null,
                service: null,
                preferred_datetime: null,
                service_address: null,
                urgent: false,
              }),
            },
          },
        ],
      });
    }

    throw new Error(`Unstubbed fetch in test: ${method} ${url}`);
  };

  return {
    emails,
    voiceCallWrites,
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

async function adminClient() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

describe("a call that never connected", () => {
  let stubs;

  beforeEach(() => {
    stubs = installStubs();
  });
  afterEach(() => {
    stubs.restore();
  });

  test("A — the ring-aborted call sends no 'Remy answered' email", async () => {
    const admin = await adminClient();
    await processCallEnded(admin, ORG_ID, RING_ABORTED);

    assert.equal(
      stubs.emails.length,
      0,
      "no owner email for a call Remy never answered"
    );
  });

  test("A — but the call itself is still recorded", async () => {
    const admin = await adminClient();
    await processCallEnded(admin, ORG_ID, RING_ABORTED);

    // Requirement: the dashboard, the endedReason and the cost must be
    // unaffected — only the email is withheld.
    assert.equal(stubs.voiceCallWrites.length, 1);
    const [write] = stubs.voiceCallWrites;
    assert.equal(write.payload.org_id, ORG_ID);
    assert.equal(
      write.payload.ended_reason,
      "call.ringing.sip-inbound-caller-hungup-before-call-connect"
    );
    assert.equal(write.payload.caller_phone, CALLER);
  });

  test("B — a connected customer-ended-call still emails the owner", async () => {
    const admin = await adminClient();
    await processCallEnded(admin, ORG_ID, CONNECTED);

    assert.equal(stubs.emails.length, 1, "the healthy call must still email");
    const [sent] = stubs.emails;
    assert.equal(sent.to, "owner@example.com");
    assert.match(sent.html, /Remy answered a phone call/);
    // No lead was created for this one, and that is still reported —
    // "never miss an enquiry" is unchanged for calls that connected.
    assert.match(sent.html, /No lead was created from this call\./);
  });
});

describe("which calls count as never connected", () => {
  // The predicate on its own, so the boundary is pinned independently
  // of the pipeline around it.
  const ringing = {
    endedReason: "call.ringing.sip-inbound-caller-hungup-before-call-connect",
    transcript: null,
    summary: null,
  };

  test("a ringing-state reason with nothing to show counts", () => {
    assert.equal(callNeverConnected(ringing, false), true);
  });

  test("every reason from a call that connected does not", () => {
    for (const endedReason of [
      "customer-ended-call",
      "assistant-ended-call",
      "silence-timed-out",
      "assistant-said-end-call-phrase",
      "pipeline-error-openai-llm-failed",
      "customer-did-not-answer",
      "exceeded-max-duration",
    ]) {
      assert.equal(
        callNeverConnected({ ...ringing, endedReason }, false),
        false,
        `${endedReason} must still email`
      );
    }
  });

  test("a transcript, a summary or a lead always wins over the reason", () => {
    assert.equal(
      callNeverConnected({ ...ringing, transcript: "AI: Hello." }, false),
      false
    );
    assert.equal(
      callNeverConnected({ ...ringing, summary: "A caller rang." }, false),
      false
    );
    assert.equal(callNeverConnected(ringing, true), false);
  });

  test("whitespace-only content is not content", () => {
    assert.equal(
      callNeverConnected({ ...ringing, transcript: "   ", summary: "\n" }, false),
      true
    );
  });

  test("a missing endedReason is not treated as never-connected", () => {
    // Absent information must not silence an email — the failure mode
    // this whole fix exists to avoid is the owner not hearing about a
    // call that happened.
    assert.equal(callNeverConnected({ ...ringing, endedReason: null }, false), false);
  });
});
