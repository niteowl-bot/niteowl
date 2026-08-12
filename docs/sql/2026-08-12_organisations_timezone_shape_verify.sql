-- Verification for 2026-08-12_organisations_timezone_shape.sql.
-- Run AFTER that script's Part 2 reports success, as its OWN query, on
-- BOTH projects. Read-only. Expected results are noted per query.

-- (1) The constraint must exist on organisations.
-- Expected: one row, contype = 'c'.
select conname, contype, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.organisations'::regclass
  and conname = 'organisations_timezone_shape';

-- (2) The column's own definition must be UNCHANGED by this migration:
-- still text, still NOT NULL, still defaulted to Europe/London.
-- Expected: one row, is_nullable = NO, column_default = 'Europe/London'::text.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'organisations'
  and column_name = 'timezone';

-- (3) Every row still satisfies the predicate.
-- Expected: one row, offending_rows = 0.
select
  count(*) filter (
    where not (
      timezone = btrim(timezone)
      and btrim(timezone) <> ''
      and (timezone = 'UTC' or timezone like '%/%')
    )
  ) as offending_rows,
  count(*) as total_orgs
from public.organisations;

-- (4) The constraint actually BITES. Each statement below must FAIL with
-- 23514 (check_violation). Run them one at a time; each is wrapped so
-- nothing is left behind even if it unexpectedly succeeds.
--
-- Expected for all five: ERROR 23514 organisations_timezone_shape.
--
--   begin; update public.organisations set timezone = ''               where id = (select id from public.organisations limit 1); rollback;
--   begin; update public.organisations set timezone = '   '            where id = (select id from public.organisations limit 1); rollback;
--   begin; update public.organisations set timezone = ' Europe/London' where id = (select id from public.organisations limit 1); rollback;
--   begin; update public.organisations set timezone = 'BST'            where id = (select id from public.organisations limit 1); rollback;
--   begin; update public.organisations set timezone = 'EST'            where id = (select id from public.organisations limit 1); rollback;

-- (5) And it must NOT reject legitimate values. Each must SUCCEED, then be
-- rolled back. Expected for all four: UPDATE 1, then ROLLBACK.
--
--   begin; update public.organisations set timezone = 'Europe/London'    where id = (select id from public.organisations limit 1); rollback;
--   begin; update public.organisations set timezone = 'America/New_York' where id = (select id from public.organisations limit 1); rollback;
--   begin; update public.organisations set timezone = 'Pacific/Auckland' where id = (select id from public.organisations limit 1); rollback;
--   begin; update public.organisations set timezone = 'UTC'             where id = (select id from public.organisations limit 1); rollback;

-- (6) A new organisation created WITHOUT the column must still inherit the
-- default and satisfy the constraint — this is the path
-- src/app/onboarding/page.tsx actually uses.
-- Expected: inserted_timezone = 'Europe/London', then ROLLBACK.
--
--   begin;
--   insert into public.organisations (owner_id, business_name, business_type, primary_goal)
--   values (
--     (select owner_id from public.organisations limit 1),
--     'constraint smoke test', 'plumber', 'book jobs'
--   )
--   returning timezone as inserted_timezone;
--   rollback;
