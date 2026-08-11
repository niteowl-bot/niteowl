// Recovery of call-ended events whose processing failed.
//
// voice_events has stored the raw payload before processing since day
// one, and both calls.ts and handler.ts said a failure "can be
// replayed" — but nothing ever did. A throw inside processCallEnded
// left processed_at NULL and processing_error set, and no code path
// ever looked at those rows again. A Resend outage or a transient
// database error silently lost a phone enquiry the caller had been
// promised a follow-up on.
//
// The stub below models the two database behaviours the design rests
// on, rather than waving at them:
//
//   1. The conditional claim. The PATCH carries the same filters the
//      real query does, and the stub applies them to the row before
//      updating — so a claim held by another worker really does fail
//      to match here, exactly as Postgres would refuse it.
//   2. Read-merged metadata on voice_calls, which is how the owner
//      summary email knows it has already been sent.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import "./stubs/env.mjs"; // must precede any "@/lib" import

import {
  replayFailedVoiceEvents,
  MIN_EVENT_AGE_MS,
  MAX_ATTEMPTS,
} from "@/lib/voice/replay";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CALL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = new Date("2026-08-11T12:00:00.000Z");
const STALE = new Date(NOW.getTime() - MIN_EVENT_AGE_MS - 60_000).toISOString();
const RECENT = new Date(NOW.getTime() - 30_000).toISOString();

/** A stored Vapi end-of-call payload, as the webhook wrote it. */
function callEndedPayload() {
  return {
    message: {
      type: "end-of-call-report",
      endedReason: "customer-ended-call",
      call: {
        id: CALL_ID,
        customer: { number: "+353861234567" },
        phoneNumber: { number: "+353870000000" },
      },
      summary: "Caller asked for a boiler service on Tuesday at 10am.",
      transcript: "User: I need a boiler service Tuesday at 10am.",
      startedAt: "2026-08-11T11:40:00.000Z",
      endedAt: "2026-08-11T11:45:00.000Z",
      durationSeconds: 300,
    },
  };
}

function eventRow(overrides = {}) {
  return {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    event_type: "call-ended",
    org_id: ORG_ID,
    provider_call_id: CALL_ID,
    payload: callEndedPayload(),
    processed_at: null,
    processing_error: null,
    processing_started_at: null,
    attempts: 0,
    created_at: STALE,
    ...overrides,
  };
}

const realFetch = globalThis.fetch;

function installStubs({
  events = [eventRow()],
  emailFails = false,
  emailDelayMs = 0,
} = {}) {
  // Mutable, so a test can let the provider recover between passes —
  // which is exactly the partial-failure case being recovered from.
  // emailDelayMs models the unbounded external call D1 exists for.
  const control = { emailFails, emailDelayMs, dbDelayMs: 0, dbDelayOn: null };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-service-role-key";
  process.env.OPENAI_API_KEY = "stub-openai-key";
  process.env.RESEND_API_KEY = "stub-resend-key";

  // Mutable server-side state, so a second replay pass sees what the
  // first one wrote — the whole point of the idempotency tests.
  const db = {
    voice_events: events.map((e) => ({ ...e })),
    voice_calls: [],
    leads: [],
    conversations: [],
  };
  const calls = { emails: 0, leadInserts: 0, leadUpdates: 0, claimAttempts: 0 };

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers ?? {});
    const wantsObject = (headers.get("accept") ?? "").includes("pgrst.object");
    const params = new URL(url, "https://stub.supabase.co").searchParams;
    const body = init.body ? JSON.parse(init.body) : null;

    // ── voice_events ───────────────────────────────────────────────
    if (url.includes("/rest/v1/voice_events")) {
      // Which replay database operation this request is, so a test can
      // stall exactly one of them. A claim carries the stale-window
      // `or`; any other PATCH is an outcome write.
      const op =
        method === "PATCH"
          ? params.get("or")
            ? "claim"
            : "outcome"
          : params.get("id")
          ? "recheck"
          : "select";
      if (control.dbDelayOn === op && control.dbDelayMs > 0) {
        await new Promise((r) => setTimeout(r, control.dbDelayMs));
      }

      if (method === "PATCH") {
        calls.claimAttempts += 1;
        const id = (params.get("id") ?? "").replace("eq.", "");
        const row = db.voice_events.find((e) => e.id === id);
        if (!row) return json([]);

        // The claim's WHERE clause, applied for real.
        if (params.get("processed_at") === "is.null" && row.processed_at !== null) {
          return json([]);
        }
        const or = params.get("or");
        if (or && or.includes("processing_started_at")) {
          const staleBefore = or.match(/processing_started_at\.lt\.([^,)]+)/)?.[1];
          const held =
            row.processing_started_at !== null &&
            Date.parse(row.processing_started_at) >= Date.parse(staleBefore);
          if (held) return json([]); // another worker owns it
        }
        Object.assign(row, body);
        return json([{ id: row.id }]);
      }

      // A single-row read by id — the D2 re-check. Must return the row
      // whatever its state, including processed: that IS the signal.
      const byId = (params.get("id") ?? "").replace("eq.", "");
      if (byId) {
        const row = db.voice_events.find((e) => e.id === byId) ?? null;
        return wantsObject ? json(row) : json(row ? [row] : []);
      }

      // Selection.
      let rows = db.voice_events.filter((e) => e.processed_at === null);
      const type = params.get("event_type");
      if (type) rows = rows.filter((e) => e.event_type === type.replace("eq.", ""));
      if (params.get("org_id") === "not.is.null") {
        rows = rows.filter((e) => e.org_id !== null);
      }
      const lt = params.get("created_at");
      if (lt?.startsWith("lt.")) {
        rows = rows.filter((e) => Date.parse(e.created_at) < Date.parse(lt.slice(3)));
      }
      // attempts < maxAttempts (work batch) / >= maxAttempts (report)
      const att = params.get("attempts");
      if (att?.startsWith("lt.")) {
        rows = rows.filter((e) => (e.attempts ?? 0) < Number(att.slice(3)));
      } else if (att?.startsWith("gte.")) {
        rows = rows.filter((e) => (e.attempts ?? 0) >= Number(att.slice(4)));
      }
      const limit = Number(params.get("limit") ?? 0);
      return json(limit > 0 ? rows.slice(0, limit) : rows);
    }

    // ── voice_calls ────────────────────────────────────────────────
    if (url.includes("/rest/v1/voice_calls")) {
      if (method === "POST") {
        const row = Array.isArray(body) ? body[0] : body;
        const existing = db.voice_calls.find(
          (c) => c.provider_call_id === row.provider_call_id
        );
        if (existing) {
          Object.assign(existing, row);
          return wantsObject ? json(existing) : json([existing]);
        }
        const saved = { id: "call-row-1", metadata: {}, ...row };
        db.voice_calls.push(saved);
        return wantsObject ? json(saved) : json([saved]);
      }
      if (method === "PATCH") {
        const id = (params.get("id") ?? "").replace("eq.", "");
        const row = db.voice_calls.find((c) => c.id === id);
        if (row) Object.assign(row, body);
        return json([]);
      }
      const id = (params.get("id") ?? "").replace("eq.", "");
      const found = db.voice_calls.filter((c) => !id || c.id === id);
      return wantsObject ? json(found[0] ?? null) : json(found);
    }

    // ── conversations ──────────────────────────────────────────────
    if (url.includes("/rest/v1/conversations")) {
      if (method === "POST") {
        db.conversations.push(Array.isArray(body) ? body[0] : body);
        return json([], 201);
      }
      const id = (params.get("id") ?? "").replace("eq.", "");
      const found = db.conversations.find((c) => c.id === id) ?? null;
      return wantsObject ? json(found) : json(found ? [found] : []);
    }

    // ── leads ──────────────────────────────────────────────────────
    if (url.includes("/rest/v1/leads")) {
      if (method === "POST") {
        calls.leadInserts += 1;
        const row = Array.isArray(body) ? body[0] : body;
        const saved = { id: `lead-${db.leads.length + 1}`, metadata: {}, ...row };
        db.leads.push(saved);
        return wantsObject ? json(saved) : json([saved]);
      }
      if (method === "PATCH") {
        calls.leadUpdates += 1;
        const id = (params.get("id") ?? "").replace("eq.", "");
        const row = db.leads.find((l) => l.id === id);
        if (row) Object.assign(row, body);
        return json([]);
      }
      if (method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-range": "*/0" },
        });
      }
      // Lead resolution: the conversation_id layer is what makes a
      // replay update this call's lead instead of inserting another.
      const convo = (params.get("conversation_id") ?? "").replace("eq.", "");
      let rows = db.leads;
      if (convo) rows = rows.filter((l) => l.conversation_id === convo);
      else rows = [];
      return wantsObject ? json(rows[0] ?? null) : json(rows);
    }

    if (url.includes("/rest/v1/organisations")) {
      const row = {
        id: ORG_ID,
        owner_id: "owner-1",
        business_name: "Acme Plumbing",
        notification_email: "owner@example.com",
        appointment_duration_minutes: 60,
        emergency_mode_enabled: false,
        max_concurrent_bookings: 1,
        timezone: "Europe/London",
      };
      return wantsObject ? json(row) : json([row]);
    }

    if (url.includes("/rest/v1/business_hours")) return json([]);
    if (url.includes("/rest/v1/business_knowledge")) return json([]);
    if (url.includes("/rest/v1/voice_settings")) return json([]);
    if (url.includes("/auth/v1/admin/users")) {
      return json({ user: { email: "owner@example.com" } });
    }

    if (url.includes("api.resend.com")) {
      calls.emails += 1;
      if (control.emailDelayMs > 0) {
        await new Promise((r) => setTimeout(r, control.emailDelayMs));
      }
      if (control.emailFails) return json({ message: "service unavailable" }, 503);
      return json({ id: "email-1" });
    }

    if (url.includes("api.openai.com")) {
      // Two different callers share this endpoint on this path: the
      // transcript-extraction fallback (Vapi leaves structuredData
      // empty) and parseDatetimeToIso. Answering both with one shape
      // would make the extraction return null and no lead at all.
      const prompt = body?.messages?.[0]?.content ?? "";
      if (prompt.includes("datetime parser")) {
        return json({
          choices: [{ message: { content: "2026-08-11T09:00:00.000Z" } }],
        });
      }
      return json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent: "new_booking",
                name: "Brian Murphy",
                email: "brian@example.com",
                phone: null,
                service: "Boiler service",
                preferred_datetime: "Tuesday at 10am",
                service_address: "14 Mill Road",
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
    db,
    calls,
    control,
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

async function admin() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

const run = async (opts = {}) =>
  replayFailedVoiceEvents(await admin(), { now: NOW, ...opts });

let stubs;
afterEach(() => stubs?.restore());

describe("selecting what to replay", () => {
  test("a stale unprocessed call-ended event IS replayed", async () => {
    stubs = installStubs();
    const outcome = await run();
    assert.equal(outcome.recovered, 1);
    assert.ok(stubs.db.voice_events[0].processed_at, "processed_at is set");
  });

  test("a RECENT event is left alone — the original run may be in flight", async () => {
    // Replaying immediately would race the webhook's own after() call.
    stubs = installStubs({ events: [eventRow({ created_at: RECENT })] });
    const outcome = await run();
    assert.equal(outcome.recovered, 0);
    assert.equal(stubs.calls.claimAttempts, 0, "not even claimed");
    assert.equal(stubs.db.voice_events[0].processed_at, null);
  });

  test("an already-processed event is never re-run", async () => {
    stubs = installStubs({
      events: [eventRow({ processed_at: "2026-08-11T11:50:00.000Z" })],
    });
    const outcome = await run();
    assert.equal(outcome.recovered, 0);
    assert.equal(stubs.calls.emails, 0);
  });

  test("unrelated event types are ignored", async () => {
    // A status-update carries no lead and is superseded by the next one.
    stubs = installStubs({
      events: [eventRow({ event_type: "status-update" })],
    });
    const outcome = await run();
    assert.equal(outcome.recovered, 0);
    assert.equal(stubs.db.voice_events[0].processed_at, null);
  });

  test("an event with no matching org is skipped, not spun on", async () => {
    stubs = installStubs({ events: [eventRow({ org_id: null })] });
    const outcome = await run();
    assert.equal(outcome.recovered, 0);
    assert.equal(stubs.calls.claimAttempts, 0);
  });

  test("the batch is bounded", async () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      eventRow({ id: `event-${i}`, provider_call_id: `call-${i}` })
    );
    stubs = installStubs({ events: many });
    const outcome = await run({ batchSize: 3 });
    // Every bucket, so a new outcome kind cannot let this pass while
    // more than batchSize events were actually touched.
    const touched =
      outcome.recovered +
      outcome.failed +
      outcome.skipped +
      outcome.abandoned +
      outcome.timedOut +
      outcome.deferred +
      outcome.exhausted.length;
    assert.equal(touched, 3);
    assert.equal(outcome.recovered, 3, "and they genuinely completed");
  });
});

describe("failure, retry and exhaustion", () => {
  test("a failed replay stays retryable and records why", async () => {
    stubs = installStubs({ emailFails: true });
    const outcome = await run();
    assert.equal(outcome.failed, 1);
    const row = stubs.db.voice_events[0];
    assert.equal(row.processed_at, null, "must remain unprocessed");
    assert.match(row.processing_error, /replay:/);
    assert.match(row.processing_error, /call summary email failed/);
  });

  test("a recovered event stops advertising the failure it survived", async () => {
    stubs = installStubs({
      events: [eventRow({ processing_error: "boom from the first attempt" })],
    });
    await run();
    const row = stubs.db.voice_events[0];
    assert.ok(row.processed_at);
    assert.equal(row.processing_error, null, "diagnostics cleared on success");
  });

  test("each claim increments attempts", async () => {
    stubs = installStubs({ emailFails: true });
    await run();
    assert.equal(stubs.db.voice_events[0].attempts, 1);
  });

  test("past the cap it is reported and NOT retried", async () => {
    stubs = installStubs({ events: [eventRow({ attempts: MAX_ATTEMPTS })] });
    const outcome = await run();
    assert.deepEqual(outcome.exhausted, [eventRow().id]);
    assert.equal(stubs.calls.claimAttempts, 0, "no further work attempted");
  });

  test("an exhausted event is never discarded", async () => {
    // Left in the table, unprocessed, with its error intact — visible
    // rather than silently dropped.
    stubs = installStubs({
      events: [eventRow({ attempts: MAX_ATTEMPTS, processing_error: "why it broke" })],
    });
    await run();
    const row = stubs.db.voice_events[0];
    assert.equal(row.processed_at, null);
    assert.equal(row.processing_error, "why it broke");
  });

  test("an unparseable payload is closed rather than retried forever", async () => {
    stubs = installStubs({ events: [eventRow({ payload: { nonsense: true } })] });
    const outcome = await run();
    assert.equal(outcome.failed, 1);
    assert.match(stubs.db.voice_events[0].processing_error, /no longer parses/);
  });
});

describe("idempotency — replay cannot duplicate the enquiry", () => {
  test("replaying twice creates ONE lead", async () => {
    stubs = installStubs();
    await run();
    const afterFirst = stubs.calls.leadInserts;

    // Force a second pass over the same event.
    stubs.db.voice_events[0].processed_at = null;
    stubs.db.voice_events[0].processing_started_at = null;
    await run();

    assert.equal(afterFirst, 1, "the first pass created the lead");
    assert.equal(stubs.calls.leadInserts, 1, "the second pass did not");
    assert.equal(stubs.db.leads.length, 1);
  });

  test("replaying twice sends ONE owner summary email", async () => {
    stubs = installStubs();
    await run();
    stubs.db.voice_events[0].processed_at = null;
    stubs.db.voice_events[0].processing_started_at = null;
    await run();
    assert.equal(stubs.calls.emails, 1);
  });

  test("a failure AFTER lead capture recovers without duplicating the lead", async () => {
    // The exact partial-failure case: the lead was written, then the
    // summary email failed. The event is retried; the lead must be
    // updated rather than inserted again, and the email must go out.
    stubs = installStubs({ emailFails: true });
    const first = await run();
    assert.equal(first.failed, 1, "first attempt fails at the email");
    assert.equal(stubs.db.leads.length, 1, "but the lead was persisted");

    assert.equal(
      stubs.db.voice_calls[0].metadata.summary_email_sent,
      undefined,
      "the email never went, so it is not marked sent"
    );

    // Resend recovers, and the claim goes stale so the event is retryable.
    stubs.control.emailFails = false;
    stubs.db.voice_events[0].processing_started_at = null;

    const second = await run();
    assert.equal(second.recovered, 1, "the retry completes");
    assert.equal(stubs.db.leads.length, 1, "still exactly one lead");
    assert.ok(stubs.db.voice_events[0].processed_at);
  });

  test("the summary flag is what stops the second email", async () => {
    stubs = installStubs();
    await run();
    assert.equal(stubs.db.voice_calls[0].metadata.summary_email_sent, true);
    assert.ok(stubs.db.voice_calls[0].metadata.summary_email_sent_at);
  });
});

describe("concurrency — two workers cannot double-process", () => {
  test("an event claimed by another worker is skipped", async () => {
    // A live claim, well inside the stale window.
    stubs = installStubs({
      events: [
        eventRow({
          processing_started_at: new Date(NOW.getTime() - 10_000).toISOString(),
        }),
      ],
    });
    const outcome = await run();
    assert.equal(outcome.skipped, 1);
    assert.equal(outcome.recovered, 0);
    assert.equal(stubs.calls.emails, 0, "no work was done");
  });

  test("a STALE claim is reclaimable — a dead worker cannot strand it", async () => {
    stubs = installStubs({
      events: [
        eventRow({
          processing_started_at: new Date(NOW.getTime() - 20 * 60_000).toISOString(),
        }),
      ],
    });
    const outcome = await run();
    assert.equal(outcome.recovered, 1);
  });

  test("two concurrent passes process the event exactly once", async () => {
    // Both select the row, then both try to claim it. The conditional
    // update means only one can win — the stub applies the same WHERE
    // Postgres would.
    stubs = installStubs();
    const [a, b] = await Promise.all([run(), run()]);
    assert.equal(a.recovered + b.recovered, 1, "processed exactly once");
    assert.equal(a.skipped + b.skipped, 1, "the loser skipped");
    assert.equal(stubs.calls.emails, 1, "one owner email");
    assert.equal(stubs.db.leads.length, 1, "one lead");
  });
});

// ── D1: one slow external call cannot consume the invocation ──────
//
// processCallEnded reaches four external services and none is bounded
// tightly enough on its own — the Resend SDK is called with no timeout
// at all. Against a 60s function limit, a single hung call could eat
// the whole invocation and the events behind it would never be reached.

describe("D1 — bounded per-event execution", () => {
  test("a slow event is abandoned at the timeout, not waited on", async () => {
    stubs = installStubs({ emailDelayMs: 400 });
    const started = Date.now();
    const outcome = await run({ eventTimeoutMs: 100 });
    const elapsed = Date.now() - started;

    assert.equal(outcome.timedOut, 1);
    assert.equal(outcome.recovered, 0);
    assert.ok(
      elapsed < 350,
      `worker waited ${elapsed}ms - it should have stopped at ~100ms`
    );
  });

  test("a timed-out event stays retryable and says so", async () => {
    stubs = installStubs({ emailDelayMs: 400 });
    await run({ eventTimeoutMs: 100 });
    const row = stubs.db.voice_events[0];
    assert.equal(row.processed_at, null, "must remain unprocessed");
    assert.match(row.processing_error, /exceeded 100ms/);
  });

  test("a fast event is unaffected by the timeout", async () => {
    stubs = installStubs();
    const outcome = await run({ eventTimeoutMs: 5000 });
    assert.equal(outcome.recovered, 1);
    assert.equal(outcome.timedOut, 0);
  });

  test("the budget stops the worker CLAIMING more than it can finish", async () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      eventRow({ id: `event-${i}`, provider_call_id: `call-${i}` })
    );
    stubs = installStubs({ events: many });
    // No room for even one event: the budget is smaller than the
    // per-event allowance, so every event is deferred rather than
    // half-started and killed by the platform.
    const outcome = await run({ eventTimeoutMs: 1000, invocationBudgetMs: 0 });
    assert.equal(outcome.deferred, 5);
    assert.equal(outcome.recovered, 0);
    assert.equal(stubs.calls.claimAttempts, 0, "nothing was even claimed");
  });

  test("a deferred event keeps its attempt count - it was never tried", async () => {
    // Burning an attempt on work that never started is how a legitimate
    // event reaches the cap without ever having been processed.
    stubs = installStubs();
    await run({ eventTimeoutMs: 1000, invocationBudgetMs: 0 });
    assert.equal(stubs.db.voice_events[0].attempts, 0);
    assert.equal(stubs.db.voice_events[0].processing_started_at, null);
  });

  test("the worker still drains what it CAN finish", async () => {
    const many = Array.from({ length: 3 }, (_, i) =>
      eventRow({ id: `event-${i}`, provider_call_id: `call-${i}` })
    );
    stubs = installStubs({ events: many });
    const outcome = await run({ eventTimeoutMs: 5000, invocationBudgetMs: 60000 });
    assert.equal(outcome.recovered, 3, "a generous budget processes them all");
  });
});

// ── D2: the event was completed while we held a claim ─────────────
//
// The claim refuses a processed row, but the ORIGINAL webhook holds no
// claim and can finish at any moment — including between our claim and
// our first side effect.

/** Completes the event behind the worker's back, right after it claims. */
function completeAfterClaim(handle, completedAt = "2026-08-11T11:59:00.000Z") {
  const inner = globalThis.fetch;
  let claimed = false;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    if (url.includes("/rest/v1/voice_events") && method === "PATCH" && !claimed) {
      claimed = true;
      const res = await inner(input, init);
      handle.db.voice_events[0].processed_at = completedAt;
      return res;
    }
    return inner(input, init);
  };
}

describe("D2 — processed while claimed", () => {
  test("completion between claim and work abandons the replay", async () => {
    stubs = installStubs();
    completeAfterClaim(stubs);

    const outcome = await run();
    assert.equal(outcome.abandoned, 1);
    assert.equal(outcome.recovered, 0);
    assert.equal(outcome.failed, 0);
  });

  test("abandoning runs NO side effects", async () => {
    stubs = installStubs();
    completeAfterClaim(stubs);

    await run();
    assert.equal(stubs.calls.emails, 0, "no duplicate owner email");
    assert.equal(stubs.calls.leadInserts, 0, "no lead touched");
    assert.equal(
      stubs.db.voice_events[0].processed_at,
      "2026-08-11T11:59:00.000Z",
      "the other actor's completion is left intact"
    );
  });

  test("a zombie worker cannot un-process a completed event", async () => {
    // The core D2 hazard: worker A claims and hangs, its claim goes
    // stale, worker B reclaims and succeeds — then A wakes and tries to
    // record ITS failure, which would write processed_at back to NULL.
    stubs = installStubs({
      events: [
        eventRow({
          processed_at: "2026-08-11T11:59:00.000Z",
          processing_started_at: "2026-08-11T11:30:00.000Z",
        }),
      ],
    });

    const { markVoiceEventProcessed } = await import("@/lib/voice/calls");
    const applied = await markVoiceEventProcessed(
      await admin(),
      eventRow().id,
      "replay: zombie worker reporting a stale failure",
      { onlyIfClaimedAt: "2026-08-11T11:00:00.000Z" }
    );

    assert.equal(applied, false, "the write must be refused");
    const row = stubs.db.voice_events[0];
    assert.equal(row.processed_at, "2026-08-11T11:59:00.000Z", "still processed");
    assert.equal(row.processing_error, null, "error not resurrected");
  });

  test("a failure cannot un-process even when the claim DOES match", async () => {
    // Same claim, but someone completed the event meanwhile — e.g. the
    // abandoned work behind a timeout finishing after we gave up.
    stubs = installStubs({
      events: [
        eventRow({
          processed_at: "2026-08-11T11:59:00.000Z",
          processing_started_at: NOW.toISOString(),
        }),
      ],
    });

    const { markVoiceEventProcessed } = await import("@/lib/voice/calls");
    const applied = await markVoiceEventProcessed(
      await admin(),
      eventRow().id,
      "replay: late failure",
      { onlyIfClaimedAt: NOW.toISOString() }
    );

    assert.equal(applied, false);
    assert.equal(stubs.db.voice_events[0].processed_at, "2026-08-11T11:59:00.000Z");
  });

  test("the claim holder CAN still record success", async () => {
    stubs = installStubs({
      events: [eventRow({ processing_started_at: NOW.toISOString() })],
    });

    const { markVoiceEventProcessed } = await import("@/lib/voice/calls");
    const applied = await markVoiceEventProcessed(await admin(), eventRow().id, null, {
      onlyIfClaimedAt: NOW.toISOString(),
    });

    assert.equal(applied, true);
    assert.ok(stubs.db.voice_events[0].processed_at);
  });

  test("the webhook's unguarded write is unchanged", async () => {
    // No claim id supplied — exactly what handler.ts calls.
    stubs = installStubs();
    const { markVoiceEventProcessed } = await import("@/lib/voice/calls");
    const applied = await markVoiceEventProcessed(await admin(), eventRow().id);
    assert.equal(applied, true);
    assert.ok(stubs.db.voice_events[0].processed_at);
  });
});

// ── B1: DATABASE calls are bounded too ────────────────────────────
//
// The per-event timeout only ever covered processCallEnded. The four
// Supabase operations on this path — selection, claim, re-check,
// outcome write — are HTTP requests with no timeout of their own, so a
// hung one could consume the whole invocation despite EVENT_TIMEOUT_MS.
//
// Each test stalls exactly one of them and asserts both that the worker
// stops waiting AND that the resulting state is safe.

describe("B1 — every database call is bounded", () => {
  test("a hanging SELECTION yields an empty pass, not a hung worker", async () => {
    stubs = installStubs();
    stubs.control.dbDelayOn = "select";
    stubs.control.dbDelayMs = 400;

    const started = Date.now();
    const outcome = await run({ dbTimeoutMs: 80 });
    const elapsed = Date.now() - started;

    assert.equal(outcome.recovered, 0);
    assert.ok(elapsed < 350, `waited ${elapsed}ms, should stop at ~80ms`);
    assert.equal(stubs.db.voice_events[0].processed_at, null, "nothing processed");
  });

  test("a hanging CLAIM is treated as not-claimed and does no work", async () => {
    stubs = installStubs();
    stubs.control.dbDelayOn = "claim";
    stubs.control.dbDelayMs = 400;

    const outcome = await run({ dbTimeoutMs: 80 });

    assert.equal(outcome.skipped, 1, "a claim we cannot confirm is not ours");
    assert.equal(outcome.recovered, 0);
    assert.equal(stubs.calls.emails, 0, "no side effects on an unconfirmed claim");
    assert.equal(stubs.db.voice_events[0].processed_at, null);
  });

  test("a hanging RE-CHECK fails closed and abandons", async () => {
    stubs = installStubs();
    stubs.control.dbDelayOn = "recheck";
    stubs.control.dbDelayMs = 400;

    const outcome = await run({ dbTimeoutMs: 80 });

    assert.equal(outcome.abandoned, 1, "unknown state is never assumed safe");
    assert.equal(stubs.calls.emails, 0, "no side effects ran");
    assert.equal(stubs.db.voice_events[0].processed_at, null);
  });

  test("a hanging OUTCOME WRITE never leaves the event marked processed", async () => {
    // The dangerous direction: if a write we could not confirm were
    // treated as success, the event would be dropped from replay.
    stubs = installStubs();
    stubs.control.dbDelayOn = "outcome";
    stubs.control.dbDelayMs = 400;

    const outcome = await run({ dbTimeoutMs: 80 });

    assert.equal(outcome.recovered, 1, "the work itself completed");
    assert.equal(
      stubs.db.voice_events[0].processed_at,
      null,
      "but the unconfirmed write must not be assumed to have landed"
    );
  });

  test("the database bound shrinks to what is left of the invocation", async () => {
    // With no budget remaining, a database call may not run at all.
    stubs = installStubs();
    stubs.control.dbDelayOn = "select";
    stubs.control.dbDelayMs = 300;

    const started = Date.now();
    await run({ dbTimeoutMs: 10_000, invocationBudgetMs: 0, cleanupReserveMs: 0 });
    const elapsed = Date.now() - started;

    assert.ok(elapsed < 250, `waited ${elapsed}ms — the budget should cap it`);
  });

  test("normal database speed is unaffected", async () => {
    stubs = installStubs();
    const outcome = await run();
    assert.equal(outcome.recovered, 1);
  });
});

// ── B2: exhausted events must not starve the queue ────────────────
//
// selectReplayable orders oldest-first and LIMITs the batch. Exhausted
// events are the oldest rows, so leaving them in the query let enough
// of them occupy every slot — replay would keep running and recover
// nothing, visible only in a log line.

describe("B2 — exhausted events cannot consume batch capacity", () => {
  /** `count` exhausted events, all older than the eligible one. */
  function exhaustedBacklog(count, maxAttempts = MAX_ATTEMPTS) {
    const base = Date.parse(STALE) - count * 60_000;
    return Array.from({ length: count }, (_, i) =>
      eventRow({
        id: `dead-${i}`,
        provider_call_id: `dead-call-${i}`,
        attempts: maxAttempts,
        processing_error: "permanently failing",
        created_at: new Date(base + i * 1_000).toISOString(),
      })
    );
  }

  test("a newer eligible event is still reached past a full batch of dead ones", async () => {
    // 25 exhausted events, all older, against a batch size of 20: under
    // the old query they filled every slot and the live event never ran.
    const live = eventRow({ id: "live-1", provider_call_id: "live-call" });
    stubs = installStubs({ events: [...exhaustedBacklog(25), live] });

    const outcome = await run();

    assert.equal(outcome.recovered, 1, "the eligible event was processed");
    assert.ok(
      stubs.db.voice_events.find((e) => e.id === "live-1").processed_at,
      "and marked processed"
    );
  });

  test("the exhausted events are still reported", async () => {
    const live = eventRow({ id: "live-1", provider_call_id: "live-call" });
    stubs = installStubs({ events: [...exhaustedBacklog(25), live] });

    const outcome = await run();
    assert.ok(outcome.exhausted.length > 0, "reported for human inspection");
    assert.ok(outcome.exhausted.every((id) => id.startsWith("dead-")));
  });

  test("exhausted events are neither processed nor cleared", async () => {
    stubs = installStubs({ events: exhaustedBacklog(3) });
    await run();

    for (const row of stubs.db.voice_events) {
      assert.equal(row.processed_at, null, "never marked processed");
      assert.equal(row.processing_error, "permanently failing", "error kept");
      assert.equal(row.attempts, MAX_ATTEMPTS, "attempts not incremented");
    }
    assert.equal(stubs.calls.claimAttempts, 0, "and never claimed");
  });

  test("the batch stays bounded when eligible events outnumber it", async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      eventRow({ id: `live-${i}`, provider_call_id: `live-call-${i}` })
    );
    stubs = installStubs({ events: [...exhaustedBacklog(10), ...many] });

    const outcome = await run({ batchSize: 4 });
    const touched =
      outcome.recovered +
      outcome.failed +
      outcome.skipped +
      outcome.abandoned +
      outcome.timedOut +
      outcome.deferred;

    assert.equal(touched, 4, "batch size still bounds the work");
    assert.equal(outcome.recovered, 4);
  });

  test("attempt accounting stays correct across the boundary", async () => {
    // One attempt short of the cap: still eligible, and the claim takes
    // it to exactly the cap.
    stubs = installStubs({
      events: [eventRow({ attempts: MAX_ATTEMPTS - 1 })],
    });
    const outcome = await run();
    assert.equal(outcome.recovered, 1, "still eligible at cap - 1");
    assert.equal(stubs.db.voice_events[0].attempts, MAX_ATTEMPTS);
  });

  test("an event exactly AT the cap is excluded from the batch", async () => {
    stubs = installStubs({ events: [eventRow({ attempts: MAX_ATTEMPTS })] });
    const outcome = await run();
    assert.equal(outcome.recovered, 0);
    assert.equal(outcome.exhausted.length, 1);
    assert.equal(stubs.calls.claimAttempts, 0);
  });
});
