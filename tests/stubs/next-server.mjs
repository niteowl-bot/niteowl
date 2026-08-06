// Stub for "next/server" under the Node test runner.
//
// src/lib/leadCapture.ts imports `after` to defer confirmation emails
// until after the response is sent. Node cannot resolve "next/server"
// outside the Next build, and the real `after` throws when called
// outside a request scope — so tests that exercise the lead engine
// directly need this shim.
//
// `after` deliberately does NOT run the callback: everything handed to
// it is outbound email, which a test must never send. Nothing under
// test asserts on that work; if something ever needs to, record the
// callbacks here and run them explicitly.
export function after() {}

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
export class NextRequest extends Request {}
