-- RLS / lead_summary verification + diagnostic.
-- Run in the Supabase SQL editor on EACH project and paste the output back.
-- Read-only: selects only, wrapped in a rolled-back transaction for the
-- simulated-auth checks. Nothing here changes data or schema.

-- ── A) Diagnosis: did the fix actually take effect? ─────────────────
-- version() matters: `security_invoker` on a view requires PostgreSQL 15+.
-- If these projects are on 14, the ALTER VIEW in the fix script errors,
-- and because the SQL editor runs a multi-statement script as ONE
-- transaction, that error rolls back the whole script — including the
-- business_knowledge RLS enable. That would explain RLS still being off.
select version() as postgres_version;

select relname as table,
       relrowsecurity  as rls_enabled,    -- want: true
       relforcerowsecurity as rls_forced
from pg_class
where oid = 'public.business_knowledge'::regclass;

select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'business_knowledge';
-- want exactly one: "Owners can manage their org knowledge", cmd ALL,
-- roles {authenticated}. Any policy with roles {public} or {anon}, or a
-- qual/with_check of "true", is why anon still has access.

select reloptions as lead_summary_options   -- want: {security_invoker=true}
from pg_class
where oid = 'public.lead_summary'::regclass;

select tablename as still_rls_disabled
from pg_tables
where schemaname = 'public' and rowsecurity = false;   -- want: 0 rows

-- ── B) Behavioural check: owner CRUD + cross-org isolation ──────────
-- Simulates two different authenticated owners against the real policy,
-- entirely inside a transaction that is rolled back at the end.
do $$
declare
  owner_a uuid; org_a uuid;
  owner_b uuid; org_b uuid;
  seen int;
  new_id uuid;
begin
  select o.owner_id, o.id into owner_a, org_a
    from public.organisations o
    join public.business_knowledge k on k.org_id = o.id
    group by o.owner_id, o.id
    order by o.id
    limit 1;

  select o.owner_id, o.id into owner_b, org_b
    from public.organisations o
   where o.owner_id <> owner_a
   order by o.id
   limit 1;

  raise notice 'owner_a=% org_a=% | owner_b=% org_b=%', owner_a, org_a, owner_b, org_b;

  -- Become owner_a
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
                     json_build_object('sub', owner_a, 'role', 'authenticated')::text, true);

  -- READ own org
  execute 'select count(*) from public.business_knowledge where org_id = $1'
    into seen using org_a;
  raise notice 'owner_a reads own org rows: %  (expect > 0)', seen;

  -- READ another org (RLS should hide them all)
  if org_b is not null then
    execute 'select count(*) from public.business_knowledge where org_id = $1'
      into seen using org_b;
    raise notice 'owner_a reads owner_b org rows: %  (expect 0)', seen;
  else
    raise notice 'owner_a reads owner_b org rows: (only one owner in data — skipped)';
  end if;

  -- CREATE in own org
  insert into public.business_knowledge (org_id, category, title, content)
  values (org_a, 'faq', 'RLS_VERIFY_OWNER_A', 'temp')
  returning id into new_id;
  raise notice 'owner_a insert own org: OK (id %)', new_id;

  -- UPDATE + DELETE own row
  update public.business_knowledge set content = 'temp2' where id = new_id;
  raise notice 'owner_a update own row: OK';
  delete from public.business_knowledge where id = new_id;
  raise notice 'owner_a delete own row: OK';

  -- CREATE into another org (WITH CHECK should block)
  if org_b is not null then
    begin
      insert into public.business_knowledge (org_id, category, title, content)
      values (org_b, 'faq', 'RLS_VERIFY_CROSSORG', 'temp');
      raise notice 'owner_a insert into owner_b org: NOT BLOCKED  <-- PROBLEM';
    exception when others then
      raise notice 'owner_a insert into owner_b org: correctly blocked (%)', sqlerrm;
    end;
  end if;

  perform set_config('role', 'postgres', true);
  raise exception 'rollback_marker';   -- force clean rollback of everything above
exception when others then
  if sqlerrm <> 'rollback_marker' then raise; end if;
  raise notice 'verification transaction rolled back (no data changed)';
end $$;
