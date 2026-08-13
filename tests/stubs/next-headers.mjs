// Stub for "next/headers" under the Node test runner.
//
// src/lib/supabase/server.ts calls `cookies()` to build the RLS-scoped
// client used by authenticated dashboard routes. Node cannot resolve
// "next/headers" outside the Next build, and the real implementation
// throws outside a request scope — so any test that drives an
// authenticated route (PATCH /api/leads) needs this shim.
//
// The jar carries ONE cookie: a Supabase session, because without it
// supabase-js short-circuits and getUser() returns "session missing"
// having made no request at all — every route would answer 401 and the
// tests would prove nothing.
//
// With the cookie present, getUser() does what it does in production:
// sends the access token to /auth/v1/user and BELIEVES THE SERVER, not
// the cookie. So identity stays under the test's control via the fetch
// stub's `authUser` option (including `null` to prove the 401), in the
// same place every other backend fact is stubbed.
//
// The cookie NAME is derived exactly as supabase-js derives it —
// `sb-${hostname.split(".")[0]}-auth-token` — from the stub URL set in
// tests/stubs/env.mjs. If that URL changes, this must follow.
//
// expires_at is far in the future on purpose: an expired session would
// make auth-js refresh first, and that request would land on the
// Google-shaped "/token" branch of the fetch stub.

const PROJECT_REF = "stub"; // https://stub.supabase.co
const FAR_FUTURE = 4102444800; // 2100-01-01, seconds

const SESSION = JSON.stringify({
  access_token: "stub-access-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: FAR_FUTURE,
  refresh_token: "stub-refresh-token",
  user: { id: "stub-user", aud: "authenticated", role: "authenticated" },
});

export async function cookies() {
  return {
    getAll() {
      return [{ name: `sb-${PROJECT_REF}-auth-token`, value: SESSION }];
    },
    set() {},
  };
}
