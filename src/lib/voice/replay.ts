import { createAdminClient } from "@/lib/supabase/admin";
import { parseVapiWebhook } from "@/lib/voice/vapi";
import { markVoiceEventProcessed, processCallEnded } from "@/lib/voice/calls";

type AdminClient = ReturnType<typeof createAdminClient>;

// ── Replaying call-ended events whose processing failed ────────────
//
// voice_events has always stored the raw payload BEFORE processing, and
// the comments in calls.ts and handler.ts both said a failure "can be
// replayed". Nothing ever replayed it. A throw inside processCallEnded
// left processed_at NULL and processing_error set, and no code path
// looked at those rows again — so a transient database blip or a Resend
// outage silently lost a phone enquiry the caller had been promised a
// follow-up on. That is the gap this closes.
//
// ── Reuse, not reimplementation ───────────────────────────────────
// This module contains no lead, booking or email logic. It re-parses the
// stored payload with the SAME parser the webhook uses and hands it to
// the SAME processCallEnded. A replayed event therefore cannot drift
// from a live one, because it is the identical code path.

/** Don't race the original after() run still in flight. */
export const MIN_EVENT_AGE_MS = 5 * 60 * 1000;

/**
 * How long a claim is honoured before another worker may take the event.
 * Longer than any plausible processCallEnded (its slowest leg is the
 * OpenAI transcript fallback at 15s), short enough that a worker killed
 * mid-flight does not strand the row for long.
 */
export const CLAIM_STALE_MS = 5 * 60 * 1000;

/** Bounds one invocation, so a backlog cannot run forever. */
export const DEFAULT_BATCH_SIZE = 20;

/**
 * The longest ONE event may take before the worker stops waiting on it.
 *
 * processCallEnded reaches four external services, and not one of them
 * is bounded tightly enough on its own: the transcript-extraction
 * fallback and parseDatetimeToIso each allow 15s, the free/busy lookup
 * 3.5s, and the Resend SDK is called with no timeout at all. Serially
 * that is enough for a single hung call to consume an entire
 * invocation, so the batch never reaches the events behind it.
 *
 * Timing out does NOT cancel the work — a promise cannot be cancelled —
 * it stops this worker WAITING. The abandoned task may still complete
 * and record its own outcome; both writes are claim-guarded, so
 * whichever lands is a legitimate outcome for this claim.
 */
export const EVENT_TIMEOUT_MS = 20_000;

/**
 * Wall-clock ceiling for WORK, checked before each claim and used to
 * shorten every operation that would otherwise overrun it.
 *
 * Events not reached are simply left for the next run. They keep their
 * attempt count, because an event that was never claimed was never
 * tried.
 */
export const INVOCATION_BUDGET_MS = 50_000;

/**
 * Held back beyond the work budget so the outcome of the last event can
 * still be recorded. Without it the final guarded UPDATE is the thing
 * that gets cut off, and the attempt's diagnostics are lost.
 */
export const CLEANUP_RESERVE_MS = 5_000;

/**
 * Ceiling for a single Supabase call.
 *
 * Every database operation on this path — the selection, the claim, the
 * re-check, the outcome write — is an HTTP request with no timeout of
 * its own. One hung request could consume the invocation despite the
 * per-event timeout, because none of them runs inside it.
 *
 *   worst case = INVOCATION_BUDGET_MS + CLEANUP_RESERVE_MS = 55s
 *                                                    < maxDuration 60s
 */
export const DB_TIMEOUT_MS = 5_000;

/**
 * Claims after which an event stops being retried.
 *
 * Not a discard: past this it is reported by every run and stays in the
 * table with its processing_error intact, so a permanently failing event
 * becomes visible rather than either vanishing or being retried forever.
 */
export const MAX_ATTEMPTS = 5;

interface VoiceEventRow {
  id: string;
  org_id: string | null;
  provider_call_id: string | null;
  payload: unknown;
  attempts: number | null;
}

export interface ReplayOutcome {
  /** Events that completed and are now marked processed. */
  recovered: number;
  /** Events that failed again and remain retryable. */
  failed: number;
  /** Events another worker held, or that were claimed between select and claim. */
  skipped: number;
  /** Events past MAX_ATTEMPTS, reported rather than retried. */
  exhausted: string[];
  /**
   * Events claimed, then found already completed by someone else before
   * any side effect ran. Abandoned deliberately — not a failure.
   */
  abandoned: number;
  /** Events left for the next run because the time budget ran out. */
  deferred: number;
  /** Events abandoned mid-flight because they exceeded EVENT_TIMEOUT_MS. */
  timedOut: number;
}

export interface ReplayOptions {
  now?: Date;
  batchSize?: number;
  minEventAgeMs?: number;
  claimStaleMs?: number;
  maxAttempts?: number;
  eventTimeoutMs?: number;
  invocationBudgetMs?: number;
  dbTimeoutMs?: number;
  cleanupReserveMs?: number;
}

class EventTimeoutError extends Error {
  constructor(ms: number) {
    super(`processing exceeded ${ms}ms and was abandoned by this worker`);
    this.name = "EventTimeoutError";
  }
}

/**
 * Stops waiting on `work` after `ms`. The timer is always cleared, so a
 * fast event does not hold the process open for the rest of the window.
 */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Promise.race attaches a reaction to `work`, and keeps it attached
    // after the timeout wins. A later rejection from the abandoned call
    // is therefore absorbed rather than becoming an unhandled rejection
    // — which, under Node's default --unhandled-rejections=throw, would
    // take the whole function down.
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new EventTimeoutError(ms)), Math.max(ms, 0));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Runs a database call under the tighter of its own ceiling and what is
 * left of the invocation, and resolves to `fallback` if it does not
 * finish in time.
 *
 * Every fallback is chosen so that timing out is SAFE rather than
 * merely quiet:
 *
 *   selection      → []     nothing is attempted this pass
 *   claim          → false  treated as "someone else has it"; the row
 *                           may in fact have been claimed, which simply
 *                           delays it to the next stale window
 *   re-check       → false  fails CLOSED, abandoning the replay
 *   outcome write  → false  the write may or may not have landed; the
 *                           event is left claimed and retried, and it
 *                           can never be marked processed by a call
 *                           that did not demonstrably succeed
 */
interface DbResult<T> {
  data: T | null;
  error: { message: string } | null;
}

async function boundedDb<T>(
  work: PromiseLike<DbResult<T>>,
  ms: number,
  label: string
): Promise<DbResult<T>> {
  try {
    // Promise.resolve: the query builder is a thenable, not a Promise.
    return await withTimeout(Promise.resolve(work), ms);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[voice replay] ${label} did not complete: ${message}`);
    // Presented to the caller as an ordinary failure, which every call
    // site already handles by taking its safe path.
    return { data: null, error: { message } };
  }
}

/**
 * The same bound for an operation that reports a plain boolean rather
 * than a query result. A timeout reads as "not done", which is the
 * safe direction for the only such call — recording an outcome.
 */
async function boundedBool(
  work: Promise<boolean>,
  ms: number,
  label: string
): Promise<boolean> {
  try {
    return await withTimeout(work, ms);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[voice replay] ${label} did not complete: ${message}`);
    return false;
  }
}

/**
 * Events eligible for replay.
 *
 * Deterministic by construction:
 *   event_type = 'call-ended'  the only kind with processing worth
 *                              recovering — a status-update carries no
 *                              lead and is superseded by the next one.
 *   processed_at IS NULL       never re-run completed work.
 *   org_id IS NOT NULL         an unmatched number cannot be processed
 *                              at all; it is a configuration problem,
 *                              and retrying it forever would bury the
 *                              events that can actually be recovered.
 *   created_at < now - age     the original run may still be in flight.
 *   oldest first               the enquiry waiting longest goes first.
 */
async function selectReplayable(
  admin: AdminClient,
  cutoffIso: string,
  batchSize: number,
  maxAttempts: number,
  timeoutMs: number
): Promise<VoiceEventRow[]> {
  const query = admin
    .from("voice_events")
    .select("id, org_id, provider_call_id, payload, attempts")
    .eq("event_type", "call-ended")
    .is("processed_at", null)
    .not("org_id", "is", null)
    // Exhausted events are excluded HERE, in the query, not skipped
    // after selection. They are the oldest rows and the batch is
    // ordered oldest-first, so leaving them in let enough of them
    // occupy every slot and starve the queue permanently — replay
    // would go on running and recover nothing, visible only in a log
    // line. They remain unprocessed and are reported separately.
    .lt("attempts", maxAttempts)
    .lt("created_at", cutoffIso)
    .order("created_at", { ascending: true })
    .limit(batchSize);

  const { data, error } = await boundedDb(query, timeoutMs, "event selection");

  if (error) {
    console.error("[voice replay] could not list failed events:", error.message);
    return [];
  }
  return (data ?? []) as VoiceEventRow[];
}

/**
 * Events that have exhausted their attempts, for reporting only.
 *
 * Kept separate from the work batch so they can be surfaced without
 * consuming capacity. Bounded, because the point is to raise an alarm,
 * not to enumerate an unbounded backlog.
 */
async function selectExhausted(
  admin: AdminClient,
  maxAttempts: number,
  timeoutMs: number,
  limit = 50
): Promise<string[]> {
  const query = admin
    .from("voice_events")
    .select("id")
    .eq("event_type", "call-ended")
    .is("processed_at", null)
    .not("org_id", "is", null)
    .gte("attempts", maxAttempts)
    .order("created_at", { ascending: true })
    .limit(limit);

  const { data, error } = await boundedDb(query, timeoutMs, "exhausted-event report");

  if (error) {
    console.error("[voice replay] could not list exhausted events:", error.message);
    return [];
  }
  return ((data ?? []) as { id: string }[]).map((row) => row.id);
}

/**
 * Takes exclusive ownership of one event, or reports that someone else
 * has it.
 *
 * The guard is a conditional UPDATE, which Postgres evaluates atomically
 * against the row: two workers issuing this at the same instant cannot
 * both match, because the first to commit leaves processing_started_at
 * recent and the second's WHERE no longer holds. PostgREST returns the
 * rows it actually updated, so an empty result IS the "someone else has
 * it" signal — no separate read, and no window between checking and
 * claiming.
 *
 * A stale claim is reclaimable, so a worker that died mid-flight does
 * not strand the event permanently.
 */
async function claimEvent(
  admin: AdminClient,
  row: VoiceEventRow,
  nowIso: string,
  staleBeforeIso: string,
  timeoutMs: number
): Promise<boolean> {
  const query = admin
    .from("voice_events")
    .update({
      processing_started_at: nowIso,
      attempts: (row.attempts ?? 0) + 1,
    })
    .eq("id", row.id)
    .is("processed_at", null)
    .or(`processing_started_at.is.null,processing_started_at.lt.${staleBeforeIso}`)
    .select("id");

  const { data, error } = await boundedDb(query, timeoutMs, `claim ${row.id}`);

  if (error) {
    console.error("[voice replay] claim failed:", row.id, error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

/**
 * Re-runs one stored event through the canonical processing path.
 *
 * processCallEnded is idempotent by design for everything it writes (see
 * the note above hasCallSummaryBeenSent in calls.ts), so a replay of an
 * event that partially succeeded finishes the missing part rather than
 * duplicating the part that landed.
 */
/**
 * Whether the event is still waiting to be processed, read fresh.
 *
 * The claim itself refuses a processed row, but the ORIGINAL webhook
 * holds no claim and can finish at any moment — including between our
 * claim and our first side effect. Re-reading immediately before the
 * work closes that window down to the width of one query, and is what
 * stops a replay re-running an event the webhook already completed.
 *
 * Fails CLOSED on a read error: an unknown state is treated as "someone
 * else may have it", because doing nothing is recoverable on the next
 * pass and duplicating an owner email is not.
 */
async function isStillUnprocessed(
  admin: AdminClient,
  eventRowId: string,
  timeoutMs: number
): Promise<boolean> {
  try {
    const { data, error } = await withTimeout(
      Promise.resolve(
        admin
          .from("voice_events")
          .select("processed_at")
          .eq("id", eventRowId)
          .maybeSingle()
      ),
      timeoutMs
    );

    if (error) {
      console.error(
        "[voice replay] could not re-check event state:",
        eventRowId,
        error.message
      );
      return false;
    }

    const row = data as { processed_at: string | null } | null;
    return (row?.processed_at ?? null) === null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[voice replay] state re-check ${eventRowId} did not complete: ${message}`
    );
    return false;
  }
}

type ReplayResult = "recovered" | "failed" | "abandoned" | "timed_out";

async function replayOne(
  admin: AdminClient,
  row: VoiceEventRow,
  claimIso: string,
  eventTimeoutMs: number,
  dbTimeoutMs: number
): Promise<ReplayResult> {
  const event = parseVapiWebhook(row.payload);

  if (!event || event.kind !== "call-ended") {
    // The row says call-ended but the payload no longer parses as one —
    // a parser change, or a payload stored by an older version. Retrying
    // cannot fix it, so it is recorded and closed rather than spun on.
    await boundedBool(
      markVoiceEventProcessed(
        admin,
        row.id,
        "replay: payload no longer parses as a call-ended event",
        { onlyIfClaimedAt: claimIso }
      ),
      dbTimeoutMs,
      `outcome write ${row.id}`
    );
    console.error("[voice replay] unparseable payload:", row.id);
    return "failed";
  }

  // ── D2: authoritative re-check before ANY side effect ────────────
  if (!(await isStillUnprocessed(admin, row.id, dbTimeoutMs))) {
    console.log(
      "[voice replay] already completed by another actor — abandoning:",
      row.id
    );
    return "abandoned";
  }

  try {
    await withTimeout(
      processCallEnded(admin, row.org_id as string, event),
      eventTimeoutMs
    );
    // Clears processing_error as well as setting processed_at, so a
    // recovered event does not keep advertising the failure it survived.
    await boundedBool(
      markVoiceEventProcessed(admin, row.id, null, { onlyIfClaimedAt: claimIso }),
      dbTimeoutMs,
      `outcome write ${row.id}`
    );
    console.log(
      "[voice replay] recovered:",
      row.id,
      "| call:",
      row.provider_call_id
    );
    return "recovered";
  } catch (err) {
    const timedOut = err instanceof EventTimeoutError;
    const message = err instanceof Error ? err.message : String(err);
    // Leaves processed_at NULL and records why — unless someone else has
    // since completed the event, which the guard refuses to undo.
    // processing_started_at stays set, so this is not retried until the
    // claim goes stale; that window is the retry backoff.
    const recorded = await boundedBool(
      markVoiceEventProcessed(admin, row.id, `replay: ${message}`, {
        onlyIfClaimedAt: claimIso,
      }),
      dbTimeoutMs,
      `outcome write ${row.id}`
    );
    if (!recorded) {
      console.log(
        "[voice replay] outcome not recorded — the event is no longer ours:",
        row.id
      );
    }
    console.error(
      timedOut ? "[voice replay] timed out:" : "[voice replay] still failing:",
      row.id,
      "|",
      message
    );
    return timedOut ? "timed_out" : "failed";
  }
}

/**
 * One bounded pass over the failed-event backlog.
 *
 * Safe to run concurrently with itself and with live webhook traffic:
 * every event is claimed before any work is done, and the work is the
 * same idempotent path the webhook runs.
 */
export async function replayFailedVoiceEvents(
  admin: AdminClient,
  options: ReplayOptions = {}
): Promise<ReplayOutcome> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const minEventAgeMs = options.minEventAgeMs ?? MIN_EVENT_AGE_MS;
  const claimStaleMs = options.claimStaleMs ?? CLAIM_STALE_MS;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const eventTimeoutMs = options.eventTimeoutMs ?? EVENT_TIMEOUT_MS;
  const invocationBudgetMs = options.invocationBudgetMs ?? INVOCATION_BUDGET_MS;
  const dbTimeoutMs = options.dbTimeoutMs ?? DB_TIMEOUT_MS;
  const cleanupReserveMs = options.cleanupReserveMs ?? CLEANUP_RESERVE_MS;

  const nowIso = now.toISOString();
  const cutoffIso = new Date(now.getTime() - minEventAgeMs).toISOString();
  const staleBeforeIso = new Date(now.getTime() - claimStaleMs).toISOString();

  // Wall clock, independent of `now` — that one is the logical instant
  // the selection is made against and tests pin it to a fixed date.
  const startedAtMs = Date.now();
  const elapsed = () => Date.now() - startedAtMs;

  /**
   * What a database call may take: its own ceiling, shortened by
   * whatever is left of the budget plus the cleanup reserve. This is
   * what stops a hung Supabase request consuming the invocation — the
   * per-event timeout never covered these, because none of them runs
   * inside it.
   */
  const dbBudget = () =>
    Math.min(
      dbTimeoutMs,
      Math.max(invocationBudgetMs + cleanupReserveMs - elapsed(), 0)
    );

  const outcome: ReplayOutcome = {
    recovered: 0,
    failed: 0,
    skipped: 0,
    exhausted: [],
    abandoned: 0,
    deferred: 0,
    timedOut: 0,
  };

  const rows = await selectReplayable(
    admin,
    cutoffIso,
    batchSize,
    maxAttempts,
    dbBudget()
  );

  // Reported separately from the work batch: exhausted events are the
  // oldest rows, and letting them into an oldest-first LIMITed batch
  // let enough of them starve the queue permanently.
  outcome.exhausted = await selectExhausted(admin, maxAttempts, dbBudget());

  for (const row of rows) {
    // ── D1: never START work we cannot finish inside the budget ─────
    // Checked BEFORE claiming, so a deferred event keeps its attempt
    // count — it was never tried. Being killed mid-event by the
    // platform instead would strand the claim AND burn an attempt.
    if (elapsed() + eventTimeoutMs > invocationBudgetMs) {
      outcome.deferred += 1;
      continue;
    }

    const claimed = await claimEvent(
      admin,
      row,
      nowIso,
      staleBeforeIso,
      dbBudget()
    );
    if (!claimed) {
      outcome.skipped += 1;
      continue;
    }

    // Never longer than what is left of the work budget, so the reserve
    // survives for the outcome write.
    const eventBudget = Math.min(
      eventTimeoutMs,
      Math.max(invocationBudgetMs - elapsed(), 0)
    );

    const result = await replayOne(
      admin,
      row,
      nowIso,
      eventBudget,
      dbBudget()
    );
    if (result === "recovered") outcome.recovered += 1;
    else if (result === "abandoned") outcome.abandoned += 1;
    else if (result === "timed_out") outcome.timedOut += 1;
    else outcome.failed += 1;
  }

  if (outcome.exhausted.length > 0) {
    console.error(
      `[voice replay] ${outcome.exhausted.length} event(s) past ${maxAttempts} attempts and NOT retried — investigate:`,
      outcome.exhausted.join(", ")
    );
  }

  if (outcome.deferred > 0) {
    console.log(
      `[voice replay] ${outcome.deferred} event(s) left for the next run — invocation budget reached`
    );
  }

  if (rows.length > 0) {
    console.log(
      `[voice replay] pass complete — recovered ${outcome.recovered}, failed ${outcome.failed}, timedOut ${outcome.timedOut}, abandoned ${outcome.abandoned}, skipped ${outcome.skipped}, deferred ${outcome.deferred}, exhausted ${outcome.exhausted.length}`
    );
  }

  return outcome;
}
