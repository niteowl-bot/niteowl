-- Verification for the business_knowledge RLS fix.
-- Run AFTER the fix reports success, as its OWN query, on BOTH projects.
-- Read-only. Expected results are noted per query.

-- (1) RLS must be on.  Expected: rls_enabled = true
select relrowsecurity as rls_enabled
from pg_class
where oid = 'public.business_knowledge'::regclass;

-- (2) Exactly one policy, owner-scoped, authenticated only.
-- Expected one row: "Owners can manage their org knowledge" | ALL | {authenticated}
select policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'business_knowledge';

-- (3) The table must NOT appear as RLS-disabled.  Expected: 0 rows.
select tablename
from pg_tables
where schemaname = 'public'
  and tablename = 'business_knowledge'
  and rowsecurity = false;
