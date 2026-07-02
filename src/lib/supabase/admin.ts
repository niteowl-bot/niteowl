import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for trusted server-only code paths
 * (e.g. the public widget API route). This client bypasses RLS —
 * it must NEVER be imported into any client component, and the
 * service role key must NEVER be exposed to the browser.
 *
 * Every query made with this client MUST manually scope by org_id
 * (or equivalent) in application code, since RLS is not enforced here.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
