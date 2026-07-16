-- Verification for 2026-07-16_knowledge_import_extend_business_knowledge.sql.
-- Run AFTER that script reports success, as its OWN query, on BOTH
-- projects. Read-only. Expected results are noted per query.

-- (1) New columns must exist with the right types. Expected: 11 rows.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'business_knowledge'
  and column_name in (
    'status', 'price', 'currency', 'duration_minutes', 'notes',
    'quote_required', 'starting_from', 'source', 'import_id',
    'updated_by', 'updated_at'
  )
order by column_name;

-- (2) Every existing row must have backfilled to the safe defaults.
-- Expected: 0 rows (i.e. nothing is NULL where it shouldn't be, and
-- nothing accidentally landed as 'draft' or 'ai_import').
select id, status, source
from public.business_knowledge
where status <> 'published' or source <> 'manual';

-- (3) Both triggers must exist and be enabled ('O' = origin, i.e. on).
-- Expected: 2 rows.
select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.business_knowledge'::regclass
  and tgname in ('business_knowledge_set_audit', 'business_knowledge_revision_trigger');

-- (4) Smoke test the triggers: run this UPDATE against one throwaway/test
-- row (do NOT run against real business data), then check
-- business_knowledge_revisions for a matching snapshot and confirm
-- updated_at/updated_by moved.
--   update public.business_knowledge set title = title where id = '<test-row-id>';
--   select updated_at, updated_by from public.business_knowledge where id = '<test-row-id>';
--   select * from public.business_knowledge_revisions where knowledge_id = '<test-row-id>' order by created_at desc limit 1;
