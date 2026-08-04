-- Verification for 2026-08-04_calendar_integration.sql.
-- Run AFTER that script reports success, as its OWN query, on BOTH
-- projects. Read-only. Expected results are noted per query.

-- (1) All three tables must exist. Expected: 3 rows.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'calendar_connections',
    'calendar_selections',
    'calendar_sync_jobs'
  );

-- (2) RLS must be on for all three. Expected: 3 rows, all rls_enabled = true.
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relname in (
  'calendar_connections',
  'calendar_selections',
  'calendar_sync_jobs'
)
and relnamespace = 'public'::regnamespace;

-- (3) Policies. Expected EXACTLY ONE row:
--   calendar_selections | Owners can read their org calendar selections | SELECT | {authenticated}
-- calendar_connections and calendar_sync_jobs must appear NOWHERE here —
-- they are deny-all by design (service role only). Any row naming them,
-- or any policy with roles {public} or {anon}, is a token-exposure bug.
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in (
    'calendar_connections',
    'calendar_selections',
    'calendar_sync_jobs'
  );

-- (4) The single-calendar rule must be a PARTIAL INDEX, not a table
-- constraint — the schema has to stay multi-calendar capable.
-- Expected 4 rows: org-level and staff-level uniqueness, plus the two
-- primary-calendar indexes. There must be NO unique constraint on
-- calendar_connections(org_id) alone.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'calendar_selections'
  and indexdef ilike '%unique%';

-- (5) Confirm no accidental one-calendar-per-org constraint exists.
-- Expected: 0 rows.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.calendar_connections'::regclass
  and contype = 'u'
  and pg_get_constraintdef(oid) = 'UNIQUE (org_id)';

-- (6) leads must have all seven new columns, every one nullable.
-- Expected: 7 rows, is_nullable = YES for all.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'leads'
  and column_name in (
    'external_event_id',
    'external_event_provider',
    'external_calendar_id',
    'external_event_etag',
    'external_event_sync_status',
    'external_event_synced_at',
    'external_event_error'
  )
order by column_name;

-- (7) organisations.timezone must exist, be NOT NULL, and default to
-- Europe/London. Expected: 1 row, is_nullable = NO,
-- column_default = 'Europe/London'::text.
select column_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'organisations'
  and column_name = 'timezone';

-- (8) Every existing org must have been backfilled — no NULLs, no blanks.
-- Expected: one row, orgs_without_timezone = 0.
select count(*) filter (where timezone is null or timezone = '') as orgs_without_timezone,
       count(*) as total_orgs
from public.organisations;

-- (9) Existing leads must be untouched: no lead may already claim an
-- external event. Expected: one row, both counts 0.
select count(*) filter (where external_event_id is not null) as leads_with_event_id,
       count(*) filter (where external_event_sync_status is not null) as leads_with_sync_status
from public.leads;

-- (10) The duplicate-event guard must exist on leads.
-- Expected: 1 row (leads_external_event_idx).
select indexname
from pg_indexes
where schemaname = 'public'
  and tablename = 'leads'
  and indexname = 'leads_external_event_idx';
