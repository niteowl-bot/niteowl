-- Follow-up to 2026-07-15_lead_summary_security_invoker.sql.
-- Removes the unnecessary SELECT grants on public.lead_summary from the
-- anon and authenticated roles. Applied in production 2026-07-15 (this
-- file records what was run so the repo mirrors prod). Idempotent.
--
-- Why: after security_invoker=true, anon already saw 0 rows through the
-- view (it honours the caller's RLS on leads). Nothing in the codebase
-- reads lead_summary, so the public roles never needed the grant — this
-- removes the door entirely. service_role / postgres keep access.
-- Run in the Supabase SQL editor on BOTH projects.

revoke select on public.lead_summary from anon, authenticated;

-- Verify (run separately). Expected: anon=false, authenticated=false,
-- service_role=true, security_invoker_enabled=true.
select
  has_table_privilege('anon',          'public.lead_summary', 'SELECT') as anon_can_select,
  has_table_privilege('authenticated', 'public.lead_summary', 'SELECT') as authenticated_can_select,
  has_table_privilege('service_role',  'public.lead_summary', 'SELECT') as service_role_can_select,
  (select 'security_invoker=true' = any(reloptions)
     from pg_class where oid = 'public.lead_summary'::regclass)         as security_invoker_enabled;
