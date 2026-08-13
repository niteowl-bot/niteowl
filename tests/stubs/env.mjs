// Side-effect module: stub environment for tests that import the lead
// engine. Must be imported BEFORE any "@/lib/..." module, because
// src/lib/email.ts constructs its Resend client at module load and
// throws without a key.
//
// These are placeholders, never used to reach a real service — the
// tests replace global fetch, so nothing leaves the process.
process.env.RESEND_API_KEY ??= "re_stub_key";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://stub.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "stub-service-role-key";
// The RLS-scoped browser/server client (lib/supabase/client.ts and
// lib/supabase/server.ts) reads the anon key. Needed by any test that
// drives an authenticated dashboard route.
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "stub-anon-key";
process.env.OPENAI_API_KEY ??= "stub-openai-key";
