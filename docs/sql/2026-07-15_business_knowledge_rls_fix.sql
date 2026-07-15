-- CORRECTED RLS fix — public.business_knowledge ONLY.
--
-- Why the previous attempt left RLS disabled: it also ran
-- `alter view public.lead_summary set (security_invoker = true)`, which
-- requires PostgreSQL 15+. On these projects that statement errors, and
-- because the Supabase SQL editor runs a whole script as ONE
-- transaction, the error rolled back everything — including the RLS
-- enable. This script fixes only business_knowledge and contains no
-- view/other-table statements, so there is nothing that can error on an
-- older server and undo it. (lead_summary is handled separately, later.)
--
-- Run in the Supabase SQL editor on BOTH projects
-- (dev kioljdihgbcboxlnwghv AND production sklcqvvnuigpewzarbiv).
-- Run this block on its OWN — do not paste the verification query after
-- it, so a later SELECT can never roll the fix back. Idempotent.

-- 1) Drop every existing policy on the table, so the only policy left is
--    the owner policy below. With RLS currently OFF no policy has ever
--    been enforced, so this changes nothing today — but it guarantees a
--    stray permissive policy can't keep the table open once RLS is on.
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'business_knowledge'
  loop
    raise notice 'dropping existing policy: %', p.policyname;
    execute format('drop policy %I on public.business_knowledge', p.policyname);
  end loop;
end $$;

-- 2) Owner-scoped policy: an authenticated owner may SELECT/INSERT/
--    UPDATE/DELETE only rows for an org they own. Same shape as the
--    existing voice_calls policy. Anon gets no policy => no access.
create policy "Owners can manage their org knowledge"
  on public.business_knowledge
  for all
  to authenticated
  using (
    org_id in (select id from public.organisations where owner_id = auth.uid())
  )
  with check (
    org_id in (select id from public.organisations where owner_id = auth.uid())
  );

-- 3) Turn RLS on. (enable only — matches every other table in this DB;
--    service_role has BYPASSRLS so widget/voice/booking are unaffected.)
alter table public.business_knowledge enable row level security;
