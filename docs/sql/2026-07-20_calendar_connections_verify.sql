-- Verification for 2026-07-20_calendar_connections.sql.
-- Run AFTER that script reports success, as its OWN query, on BOTH
-- projects. Read-only. Expected results are noted per query.

-- (1) Table must exist. Expected: 1 row.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'calendar_connections';

-- (2) RLS must be enabled. Expected: 1 row, rls_enabled = true.
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relname = 'calendar_connections'
  and relnamespace = 'public'::regnamespace;

-- (3) Exactly one policy: owner-scoped, select-only, authenticated.
-- Expected: 1 row — "Owners can read their org calendar connection" | SELECT | {authenticated}
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename = 'calendar_connections';

-- (4) Columns must exist with the right types. Expected: 11 rows.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'calendar_connections'
order by column_name;

-- (5) provider check constraint must include both providers. Expected: the
-- constraint definition mentions 'google' and 'outlook'.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.calendar_connections'::regclass
  and contype = 'c';
