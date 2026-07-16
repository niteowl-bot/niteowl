-- Verification for 2026-07-16_knowledge_import_tables.sql.
-- Run AFTER that script reports success, as its OWN query, on BOTH
-- projects. Read-only. Expected results are noted per query.

-- (1) All four tables must exist. Expected: 4 rows.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'knowledge_imports',
    'knowledge_import_files',
    'knowledge_staged_items',
    'business_knowledge_revisions'
  );

-- (2) RLS must be on for all four. Expected: 4 rows, all rls_enabled = true.
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relname in (
  'knowledge_imports',
  'knowledge_import_files',
  'knowledge_staged_items',
  'business_knowledge_revisions'
)
and relnamespace = 'public'::regnamespace;

-- (3) Exactly one policy per table, owner-scoped, authenticated only.
-- Expected 4 rows: three "for all" (ALL) policies + one select-only
-- policy on business_knowledge_revisions, all roles = {authenticated}.
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in (
    'knowledge_imports',
    'knowledge_import_files',
    'knowledge_staged_items',
    'business_knowledge_revisions'
  )
order by tablename;

-- (4) None of the four tables should appear as RLS-disabled. Expected: 0 rows.
select tablename
from pg_tables
where schemaname = 'public'
  and tablename in (
    'knowledge_imports',
    'knowledge_import_files',
    'knowledge_staged_items',
    'business_knowledge_revisions'
  )
  and rowsecurity = false;
