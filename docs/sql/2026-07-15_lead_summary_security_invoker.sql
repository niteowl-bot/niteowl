-- Version-safe fix for the "Security Definer View" advisor finding on
-- public.lead_summary. Detects the server version at apply time and
-- chooses the approach automatically. Touches ONLY lead_summary — no
-- tables, policies, or other objects. Idempotent (re-running is a no-op).
-- Run in the Supabase SQL editor on BOTH projects
-- (dev kioljdihgbcboxlnwghv AND production sklcqvvnuigpewzarbiv).
--
-- Background: lead_summary is a VIEW (views can't have RLS). By default a
-- view runs with its owner's privileges (security definer), so it
-- bypasses the leads-table RLS and exposes per-org lead counts to the
-- public anon key. The definition itself is fine and stays untouched;
-- only the *execution context* needs to change.
--
-- Run this block on its OWN, confirm the NOTICE, THEN run the verify
-- query below separately (so a later SELECT can never roll the fix back —
-- the SQL editor runs a whole script as one transaction).

do $$
declare
  v int := current_setting('server_version_num')::int;   -- e.g. 150004 = 15.0.4
begin
  if v >= 150000 then
    -- PG 15+: make the view honour the CALLING role's RLS. Same view
    -- definition, different execution context:
    --   anon         -> leads RLS returns nothing -> view returns 0 rows
    --   org owner    -> sees only their own org's leads (own aggregates)
    --   service_role -> BYPASSRLS, unchanged (nothing in code uses it anyway)
    -- This is the change the linter looks for; it clears the finding.
    execute 'alter view public.lead_summary set (security_invoker = true)';
    raise notice 'PostgreSQL % (>= 15): set security_invoker=true on lead_summary', v;
  else
    -- PG < 15: security_invoker does not exist. Can't make the view
    -- invoker-scoped, so close the data exposure by removing read access
    -- from the untrusted roles; service_role/postgres keep access.
    -- NOTE: this stops the leak but may NOT clear the linter on <15 —
    -- see the header note; a follow-up (drop the unused view, or a PG
    -- upgrade) would be needed then. Reported via the NOTICE below.
    execute 'revoke all privileges on public.lead_summary from anon, authenticated';
    raise notice 'PostgreSQL % (< 15): security_invoker unavailable; revoked anon/authenticated read on lead_summary. Linter may persist — follow up.', v;
  end if;
end $$;
