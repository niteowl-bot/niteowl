// ── Stage timing for latency investigations ───────────────────────
//
// The 2026-08-07 blocking test timed out after 8s and NOTHING in the
// logs could attribute those seconds: cold start, eleven sequential
// database round trips, the OAuth refresh and the freeBusy call were
// all invisible. Attribution had to be reconstructed afterwards from
// database timestamps, which only worked because the refresh happened
// to persist a row.
//
// So each stage reports its own elapsed time. Deliberately tiny:
//   - one line per stage, prefixed [timing] so it greps cleanly;
//   - logs on failure too (the slow path is usually the failing one),
//     via finally, without swallowing the error;
//   - no aggregation, no sampling, no state — nothing here can itself
//     become a source of latency or a thing that breaks.

/** Runs `fn`, logging how long it took. Returns exactly what `fn` returns. */
export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    console.log(`[timing] ${label} ${Date.now() - started}ms`);
  }
}

/**
 * A manual stopwatch, for spans that do not wrap a single call — the
 * total lookup, which resolves through a race, is the reason this
 * exists alongside `timed`.
 */
export function startTimer(): () => number {
  const started = Date.now();
  return () => Date.now() - started;
}
