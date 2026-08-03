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
