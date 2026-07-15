-- Security Advisor fixes (2026-07-15), three findings, nothing else:
--   1. public.business_knowledge — "RLS Disabled in Public"
--   2. public.business_knowledge — "Policy Exists, RLS Disabled"
--   3. public.lead_summary        — "Security Definer View"
--
-- Run manually in the Supabase SQL editor, per this repo's convention
-- (no migrations folder). The advisor report above is from PRODUCTION
-- (sklcqvvnuigpewzarbiv); the dev project (kioljdihgbcboxlnwghv) was
-- empirically confirmed to have the same business_knowledge gap, so run
-- this on BOTH projects. Idempotent — re-running is a no-op.
--
-- Why: business_knowledge was created without RLS, so the public anon
-- key could read AND write every org's knowledge records (verified
-- empirically 2026-07-15: an unauthenticated INSERT succeeded on dev;
-- prod showed the same anon-read signature — all rows visible to the
-- anon key while every other table returns none).
--
-- Why this keeps the app working exactly as today:
--   * Dashboard knowledge page, onboarding knowledge step, setup
--     checklist and the dashboard-preview chat API all access
--     business_knowledge as an AUTHENTICATED owner scoped to their own
--     org (verified in code 2026-07-15) — covered by the single owner
--     policy below, same pattern as the existing voice_calls policy.
--   * Widget chat, voice, and booking routes use the service-role
--     client, which bypasses RLS — unaffected.
--   * Nothing legitimate reads business_knowledge anonymously, so no
--     anon policy is created.
--   * lead_summary is referenced nowhere in the codebase (verified by
--     repo-wide search), so flipping it to security_invoker cannot
--     affect the app.

-- ── 1) Drop any pre-existing (dormant) policies on business_knowledge ─
-- The advisor's "Policy Exists, RLS Disabled" means at least one policy
-- already exists on prod. With RLS disabled, no policy has ever been
-- active, so dropping them all is provably behaviour-neutral — and it
-- guarantees the only policy in force after this script is the one
-- below (a leftover permissive anon policy would otherwise silently
-- keep the table world-readable). Dropped names are printed as NOTICEs;
-- please paste them back for the record.
do $$
declare
  p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'business_knowledge'
  loop
    raise notice 'dropping dormant policy on business_knowledge: %', p.policyname;
    execute format('drop policy %I on public.business_knowledge', p.policyname);
  end loop;
end $$;

-- ── 2) Owner policy, then enable RLS ─────────────────────────────────
-- Policy is created before RLS is switched on so there is no window
-- with RLS enabled and no policy.
create policy "Owners can manage their org knowledge"
  on public.business_knowledge
  for all
  to authenticated
  using (
    org_id in (select id from public.organisations where owner_id = auth.uid())
  )
  with check (
    org_id in (select id from public.organisations where owner_id = auth.uid())
  );

alter table public.business_knowledge enable row level security;

-- ── 3) lead_summary: run with the caller's privileges ────────────────
-- As a default (security definer) view it executed with its owner's
-- rights, bypassing the leads table's RLS and exposing per-org lead
-- counts to anyone with the public anon key (confirmed empirically on
-- both projects). security_invoker makes it honour the caller's RLS:
-- anon sees nothing, owners would see their own org, service role and
-- the SQL editor (table owner) still see everything. The view is kept
-- rather than dropped because the app never references it — dropping
-- it is a bigger change than this fix needs.
alter view public.lead_summary set (security_invoker = true);

-- ── Verification (single result set — please paste it back) ─────────
-- Expected exactly two rows:
--   policy on business_knowledge: Owners can manage their org knowledge (ALL)
--   lead_summary option: security_invoker=true
-- Any "STILL RLS-DISABLED" row means a public table (including any this
-- script didn't know about) still needs attention.
select 'STILL RLS-DISABLED: ' || tablename as check_result
from pg_tables
where schemaname = 'public' and rowsecurity = false
union all
select 'policy on business_knowledge: ' || policyname || ' (' || cmd || ')'
from pg_policies
where schemaname = 'public' and tablename = 'business_knowledge'
union all
select 'lead_summary option: ' || unnest(reloptions)
from pg_class
where oid = 'public.lead_summary'::regclass;
