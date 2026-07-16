-- AI Import for Knowledge Base — private Storage bucket (2026-07-16),
-- part 3 of 3. Run manually in the Supabase SQL editor, per this repo's
-- convention (no migrations folder). Run on BOTH projects:
--   dev:  kioljdihgbcboxlnwghv
--   prod: sklcqvvnuigpewzarbiv  (NOT reachable locally at all)
--
-- This is the first Storage bucket used anywhere in this app — no
-- existing bucket/policy is touched. Idempotent (ON CONFLICT DO NOTHING /
-- DROP POLICY IF EXISTS).
--
-- Why: uploaded documents (menus, price lists, brochures, policy docs)
-- must stay private — never a public URL, never readable cross-tenant.
-- Path convention is {org_id}/{import_id}/{file_id}-{filename}, and the
-- policy below scopes access by matching the first path segment against
-- the caller's own org_id, mirroring the org_id-scoped RLS pattern used
-- everywhere else in this app. The upload route builds this path
-- server-side from the session-verified org_id — it never trusts a
-- client-supplied path.

-- ── 1) Create the bucket, private ────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('knowledge-imports', 'knowledge-imports', false)
on conflict (id) do nothing;

-- ── 2) Storage policy — owner-scoped by the path's org_id segment ──────
-- No anon policy exists at all, so anonymous/public access is impossible
-- regardless of this policy. storage.foldername(name) splits the object
-- path into an array of folder segments; [1] is the org_id segment.
drop policy if exists "Owners can manage their org import files" on storage.objects;
create policy "Owners can manage their org import files"
  on storage.objects
  for all
  to authenticated
  using (
    bucket_id = 'knowledge-imports'
    and (storage.foldername(name))[1] in (
      select id::text from public.organisations where owner_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'knowledge-imports'
    and (storage.foldername(name))[1] in (
      select id::text from public.organisations where owner_id = auth.uid()
    )
  );
