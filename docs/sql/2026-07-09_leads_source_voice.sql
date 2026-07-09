-- Phase 2 Step 1 follow-up: allow 'voice' as a leads.source value.
-- Dev-project testing (2026-07-09) proved the hazard flagged in
-- 2026-07-09_voice_tables.sql is real: leads has a CHECK constraint
-- (leads_source_check) that rejects source = 'voice', silently blocking
-- voice lead capture (the shared engine logs insert failures rather than
-- throwing, by design).
--
-- This rebuilds the constraint from its LIVE definition with 'voice'
-- injected, so the existing allowed values — whatever they are on each
-- project — are preserved exactly. Idempotent: does nothing if the
-- constraint is absent or already allows 'voice'.
-- Run on BOTH Supabase projects (dev/test AND real production) like the
-- voice tables SQL.

do $$
declare
  def text;
begin
  select pg_get_constraintdef(oid) into def
    from pg_constraint
   where conname = 'leads_source_check'
     and conrelid = 'public.leads'::regclass;

  if def is null then
    raise notice 'leads_source_check not found - nothing to do';
    return;
  end if;

  if def like '%''voice''%' then
    raise notice 'voice already allowed - nothing to do';
    return;
  end if;

  -- def looks like: CHECK ((source = ANY (ARRAY['chat'::text, ...])))
  -- Inject 'voice' as the first array element, keeping everything else.
  def := replace(def, 'ARRAY[', 'ARRAY[''voice''::text, ');

  execute 'alter table public.leads drop constraint leads_source_check';
  execute 'alter table public.leads add constraint leads_source_check ' || def;

  raise notice 'leads_source_check rebuilt as: %', def;
end $$;

-- Verify (should include 'voice'):
select pg_get_constraintdef(oid) as leads_source_check
  from pg_constraint
 where conname = 'leads_source_check'
   and conrelid = 'public.leads'::regclass;
