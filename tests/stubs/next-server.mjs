// Stub for "next/server" under the Node test runner.
//
// src/lib/leadCapture.ts imports `after` to defer confirmation emails
// until after the response is sent. Node cannot resolve "next/server"
// outside the Next build, and the real `after` throws when called
// outside a request scope — so tests that exercise the lead engine
// directly need this shim.
//
// `after` deliberately does NOT run the callback: everything handed to
// it is outbound email, which a test must never send.
//
// The callbacks ARE recorded, because customer cancellation/reschedule
// emails are scheduled through `after` and a test must be able to prove
// both that one was scheduled and — more importantly — that one was NOT
// scheduled on a failed reschedule. Recording is passive: nothing runs
// unless a test explicitly calls runAfterCallbacks(), so every existing
// test keeps the previous no-op behaviour.
const afterCallbacks = [];

export function after(callback) {
  if (typeof callback === "function") afterCallbacks.push(callback);
}

/** How many deferred callbacks are queued. */
export function afterCallbackCount() {
  return afterCallbacks.length;
}

/** Drops anything queued, so one test cannot observe another's work. */
export function resetAfterCallbacks() {
  afterCallbacks.length = 0;
}

/**
 * Runs the queued callbacks and clears the queue. Only call this from a
 * test that has stubbed every network call the callbacks make.
 */
export async function runAfterCallbacks() {
  const queued = afterCallbacks.splice(0, afterCallbacks.length);
  for (const cb of queued) await cb();
}

// src/lib/voice/handler.ts (the voice webhook) additionally needs
// NextResponse.json and the NextRequest type. Only the pieces the
// handler actually uses are implemented: a JSON body, a status, and
// headers — all of which the standard Response already provides, so
// this is a thin wrapper rather than a reimplementation.
export const NextResponse = {
  json(body, init = {}) {
    return new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
  },
};

// A type-only import at runtime; the handler is called with a plain
// Request in tests, which supplies everything it reads (headers, json).
//
// `nextUrl` is the one thing the standard Request does not provide, and
// GET /api/bookings/manage reads its searchParams for the manage token.
// Next's own nextUrl is a parsed URL of the request with framework
// extras none of these routes touch, so a plain URL is the whole of it
// here. Additive: nothing that used this class before reads it.
export class NextRequest extends Request {
  get nextUrl() {
    return new URL(this.url);
  }
}
