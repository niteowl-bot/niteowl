-- Verification for 2026-07-16_knowledge_import_storage.sql.
-- Run AFTER that script reports success, as its OWN query, on BOTH
-- projects. Read-only. Expected results are noted per query.

-- (1) Bucket must exist and be private. Expected: 1 row, public = false.
select id, name, public
from storage.buckets
where id = 'knowledge-imports';

-- (2) Exactly one policy, owner-scoped, authenticated only.
-- Expected: 1 row — "Owners can manage their org import files" | ALL | {authenticated}
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname = 'Owners can manage their org import files';

-- (3) Manual check (not SQL): as a signed-in owner, upload a small test
-- file to knowledge-imports/{their own org_id}/test/test.txt and confirm
-- it succeeds; then attempt the same path with a DIFFERENT org_id prefix
-- and confirm it's rejected. Delete the test file afterwards.
