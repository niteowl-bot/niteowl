import { createClient } from "@/lib/supabase/server";

// ── Request-scoped tenant resolution ──────────────────────────────
//
// Every integration route resolves the org the same way: from the
// authenticated session, never from a query parameter or request body.
// Centralised so no route can accidentally trust a client-supplied
// org id and reach another business's connections.

export interface IntegrationSession {
  userId: string;
  orgId: string;
}

/**
 * The signed-in owner's org, or null when there is no session or no org.
 * Callers turn null into a 401/redirect — this never throws, so an
 * unauthenticated request cannot be distinguished from an org-less one
 * by timing or error text.
 */
export async function resolveIntegrationSession(): Promise<IntegrationSession | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return null;

  // Same org resolution the dashboard pages use: the owner's most
  // recent organisation, read under RLS as the user themselves.
  const { data: org } = await supabase
    .from("organisations")
    .select("id")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!org) return null;

  return { userId: user.id, orgId: org.id as string };
}
