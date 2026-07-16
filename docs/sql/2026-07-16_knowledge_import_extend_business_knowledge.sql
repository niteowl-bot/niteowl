-- AI Import for Knowledge Base — extend business_knowledge (2026-07-16),
-- part 2 of 3. Run AFTER 2026-07-16_knowledge_import_tables.sql (the
-- import_id column below references knowledge_imports, created there).
-- Run manually in the Supabase SQL editor, per this repo's convention (no
-- migrations folder). Run on BOTH projects:
--   dev:  kioljdihgbcboxlnwghv
--   prod: sklcqvvnuigpewzarbiv  (NOT reachable locally at all)
--
-- Additive only — every new column is nullable or has a default, so every
-- EXISTING row backfills automatically with no manual UPDATE and no
-- behaviour change: status defaults 'published' (existing rows stay
-- visible to Remy exactly as before), source defaults 'manual'. Idempotent
-- (IF NOT EXISTS / CREATE OR REPLACE / DROP...IF EXISTS throughout).
--
-- Why: "Import with AI" needs structured fields (price/currency/duration/
-- notes/quote_required/starting_from) that plain title+content can't hold,
-- plus a draft/published gate so AI-extracted content never reaches
-- customers until the owner explicitly publishes it, plus an audit trail
-- (who/when changed a record, with the ability to restore an older
-- version). Existing app code (KnowledgeClient.tsx's handleCreate/
-- handleUpdate/handleDelete, the onboarding step, and every retrieval
-- query in chat/widget/voice) is UNCHANGED by this script — the new
-- columns are additive and the triggers below populate themselves.

-- ── 1) New columns ────────────────────────────────────────────────────
alter table public.business_knowledge
  add column if not exists status text not null default 'published'
    check (status in ('draft', 'published')),
  add column if not exists price numeric(10, 2),
  add column if not exists currency text,
  add column if not exists duration_minutes integer,
  add column if not exists notes text,
  add column if not exists quote_required boolean not null default false,
  add column if not exists starting_from boolean not null default false,
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'ai_import')),
  add column if not exists import_id uuid references public.knowledge_imports(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists business_knowledge_status_idx
  on public.business_knowledge (org_id, status);

-- ── 2) Audit trigger — sets updated_at/updated_by on every UPDATE ───────
-- security definer + a fixed search_path so auth.uid() resolves and the
-- function can't be hijacked by a session-local search_path change.
create or replace function public.set_business_knowledge_audit_fields()
returns trigger as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists business_knowledge_set_audit on public.business_knowledge;
create trigger business_knowledge_set_audit
  before update on public.business_knowledge
  for each row execute function public.set_business_knowledge_audit_fields();

-- ── 3) Revision trigger — snapshots the pre-change row on UPDATE/DELETE ─
-- Fires on every write path (existing KnowledgeClient.tsx edits included,
-- since it writes through the RLS client where auth.uid() resolves) with
-- zero application code changes.
--
-- CORRECTED (2026-07-16, caught in browser testing before this ever ran
-- against production): a BEFORE UPDATE trigger's return value becomes
-- what Postgres actually writes for that row — returning OLD unconditionally
-- (as an earlier version of this function did, on the mistaken belief that
-- it was "harmless" for UPDATE) silently discards every column change in
-- the triggering UPDATE statement, reverting the row back to its
-- pre-change values. Only a second trigger (the audit-fields one, which
-- runs after this one alphabetically) masked the symptom by stamping a
-- fresh updated_at on top of the reverted row — so writes looked like
-- they succeeded (fresh timestamp) while silently not applying. This
-- would have broken every edit through the existing KnowledgeClient.tsx
-- UI, not just the new Publish button. Must return NEW for UPDATE (OLD
-- remains correct, and is the only legal choice, for DELETE).
create or replace function public.record_business_knowledge_revision()
returns trigger as $$
begin
  insert into public.business_knowledge_revisions
    (knowledge_id, org_id, snapshot, changed_by, change_type)
  values
    (old.id, old.org_id, to_jsonb(old), auth.uid(), lower(tg_op));

  if (tg_op = 'DELETE') then
    return old;
  else
    return new;
  end if;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists business_knowledge_revision_trigger on public.business_knowledge;
create trigger business_knowledge_revision_trigger
  before update or delete on public.business_knowledge
  for each row execute function public.record_business_knowledge_revision();
