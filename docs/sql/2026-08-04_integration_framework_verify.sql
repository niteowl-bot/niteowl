-- Verification for 2026-08-04_integration_framework.sql.
-- Run AFTER that script reports success, as its OWN query, on BOTH
-- projects. Read-only. Expected results are noted per query.

-- (1) All four tables must exist. Expected: 4 rows.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'integration_connections',
    'integration_resources',
    'integration_jobs',
    'integration_links'
  );

-- (2) RLS must be on for all four. Expected: 4 rows, all rls_enabled = true.
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relname in (
  'integration_connections',
  'integration_resources',
  'integration_jobs',
  'integration_links'
)
and relnamespace = 'public'::regnamespace;

-- (3) Policies. THE MOST IMPORTANT CHECK. Expected EXACTLY TWO rows:
--   integration_resources | Owners can read their org integration resources | SELECT | {authenticated}
--   integration_links     | Owners can read their org integration links     | SELECT | {authenticated}
--
-- integration_connections and integration_jobs must appear NOWHERE in
-- this result — they are deny-all by design, service role only. A row
-- naming either of them, or any policy with roles {public} or {anon}, is
-- a credential-exposure bug: it would let a signed-in owner read
-- encrypted credentials through the public anon key.
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in (
    'integration_connections',
    'integration_resources',
    'integration_jobs',
    'integration_links'
  );

-- (4) The schema must stay multi-connection and multi-resource. There
-- must be NO unique constraint on org_id alone anywhere.
-- Expected: 0 rows.
select conrelid::regclass as table_name,
       conname,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in (
    'public.integration_connections'::regclass,
    'public.integration_resources'::regclass
  )
  and contype = 'u'
  and pg_get_constraintdef(oid) = 'UNIQUE (org_id)';

-- (5) The "one primary per resource type" rule must be a PARTIAL INDEX,
-- so multi-staff needs no redesign. Expected 4 rows on
-- integration_resources: two uniqueness indexes (org-level, staff-level)
-- and two primary indexes.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'integration_resources'
  and indexdef ilike '%unique%'
order by indexname;

-- (6) Duplicate-object guards on integration_links. Expected 2 rows:
--   integration_links_external_idx (no two links claim one remote object)
--   integration_links_subject_idx  (one remote object per subject)
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'integration_links'
  and indexdef ilike '%unique%'
order by indexname;

-- (7) `leads` MUST NOT have been touched by this feature.
-- Expected: 0 rows. Any external_* column here means an older draft of
-- the migration was run by mistake.
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'leads'
  and column_name like 'external_%';

-- (8) organisations.timezone must exist, be NOT NULL, and default to
-- Europe/London. Expected: 1 row, is_nullable = NO,
-- column_default = 'Europe/London'::text.
select column_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'organisations'
  and column_name = 'timezone';

-- (9) Every existing org must have been backfilled — no NULLs, no blanks.
-- Expected: one row, orgs_without_timezone = 0.
select count(*) filter (where timezone is null or timezone = '') as orgs_without_timezone,
       count(*) as total_orgs
from public.organisations;

-- (10) The feature must be inert: nothing connected, nothing queued.
-- Expected: one row, all four counts 0.
select
  (select count(*) from public.integration_connections) as connections,
  (select count(*) from public.integration_resources)   as resources,
  (select count(*) from public.integration_jobs)        as jobs,
  (select count(*) from public.integration_links)       as links;

-- (11) Confirm the earlier calendar-specific draft was never applied.
-- Expected: 0 rows.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'calendar_connections',
    'calendar_selections',
    'calendar_sync_jobs'
  );
