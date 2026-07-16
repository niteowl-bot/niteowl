-- AI Import for Knowledge Base — new tables (2026-07-16), part 1 of 3.
-- Run manually in the Supabase SQL editor, per this repo's convention (no
-- migrations folder — DDL can't be run via PostgREST/service-role key, only
-- table CRUD, so this needs the SQL editor even on the locally-reachable
-- dev project). Run on BOTH projects, IN THIS ORDER before the other two
-- files in this batch (business_knowledge's new import_id column
-- references knowledge_imports, created here):
--   dev:  kioljdihgbcboxlnwghv
--   prod: sklcqvvnuigpewzarbiv  (NOT reachable locally at all)
--
-- Additive only — no existing table is touched by this file. Safe to run
-- on the live database: everything is guarded by IF NOT EXISTS / DROP...IF
-- EXISTS, so re-running is a no-op.
--
-- Why: the "Import with AI" feature lets an owner upload documents
-- (menus, price lists, brochures, policy docs) and have AI turn them into
-- draft Knowledge Base entries + suggested FAQs. Nothing the AI extracts
-- is allowed to touch business_knowledge directly — it lands here first,
-- in a staging area the owner reviews (edit/delete/add/approve/reject)
-- before anything is committed. See docs/sql/2026-07-16_knowledge_import_
-- extend_business_knowledge.sql for the commit target's new columns.

-- ── 1) knowledge_imports — one row per upload batch ─────────────────────
create table if not exists public.knowledge_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'ready_for_review', 'committed', 'failed', 'cancelled')),
  error_message text,
  file_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_imports_org_created_idx
  on public.knowledge_imports (org_id, created_at desc);

-- ── 2) knowledge_import_files — one row per uploaded file in a batch ────
-- storage_path points into the private "knowledge-imports" Storage bucket
-- (see docs/sql/2026-07-16_knowledge_import_storage.sql) — never a public
-- URL. A batch continues processing even if one file fails; per-file
-- status/error_message is how the review UI shows that.
create table if not exists public.knowledge_import_files (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.knowledge_imports(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes integer not null,
  page_count integer,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'extracted', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists knowledge_import_files_import_idx
  on public.knowledge_import_files (import_id);

-- ── 3) knowledge_staged_items — the review-before-save staging area ─────
-- Shared by two flows, distinguished by import_id / source_knowledge_id
-- rather than splitting into three near-identical tables:
--   - Import review: import_id set, source_knowledge_id null.
--   - "Regenerate FAQs" on one existing entry: import_id null,
--     source_knowledge_id set to the business_knowledge row it came from.
-- item_type separates suggested Knowledge Base entries from suggested
-- FAQs within the same batch, mirroring business_knowledge.category='faq'
-- being just another category there. Nothing here is ever read by Remy —
-- only committed rows in business_knowledge are (and only once
-- status='published' there, per the extend-table script).
create table if not exists public.knowledge_staged_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  import_id uuid references public.knowledge_imports(id) on delete cascade,
  source_knowledge_id uuid references public.business_knowledge(id) on delete cascade,
  source_file_id uuid references public.knowledge_import_files(id) on delete set null,
  item_type text not null check (item_type in ('knowledge', 'faq')),
  category text,
  title text not null,
  content text,
  price numeric(10, 2),
  currency text,
  duration_minutes integer,
  notes text,
  quote_required boolean not null default false,
  starting_from boolean not null default false,
  confidence numeric(3, 2),
  low_confidence boolean not null default false,
  duplicate_of uuid references public.business_knowledge(id) on delete set null,
  duplicate_action text check (duplicate_action in ('merge', 'replace', 'keep_both')),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_staged_items_import_idx
  on public.knowledge_staged_items (import_id);
create index if not exists knowledge_staged_items_source_kb_idx
  on public.knowledge_staged_items (source_knowledge_id);
create index if not exists knowledge_staged_items_org_idx
  on public.knowledge_staged_items (org_id);

-- ── 4) business_knowledge_revisions — append-only revision history ──────
-- Populated exclusively by the trigger added in the extend-table script,
-- never by application code directly — that's why there's no insert
-- policy for authenticated users below, only select. change_type
-- distinguishes an edit (row still exists, can restore in place) from a
-- delete (row is gone, "restore" means re-inserting it).
create table if not exists public.business_knowledge_revisions (
  id uuid primary key default gen_random_uuid(),
  knowledge_id uuid not null,
  org_id uuid not null references public.organisations(id) on delete cascade,
  snapshot jsonb not null,
  changed_by uuid references auth.users(id) on delete set null,
  change_type text not null check (change_type in ('update', 'delete')),
  created_at timestamptz not null default now()
);

create index if not exists business_knowledge_revisions_kb_idx
  on public.business_knowledge_revisions (knowledge_id, created_at desc);

-- ── RLS — same owner-scoped shape as business_knowledge's existing fix ──
alter table public.knowledge_imports enable row level security;
alter table public.knowledge_import_files enable row level security;
alter table public.knowledge_staged_items enable row level security;
alter table public.business_knowledge_revisions enable row level security;

drop policy if exists "Owners can manage their org imports" on public.knowledge_imports;
create policy "Owners can manage their org imports"
  on public.knowledge_imports
  for all
  to authenticated
  using (org_id in (select id from public.organisations where owner_id = auth.uid()))
  with check (org_id in (select id from public.organisations where owner_id = auth.uid()));

drop policy if exists "Owners can manage their org import files" on public.knowledge_import_files;
create policy "Owners can manage their org import files"
  on public.knowledge_import_files
  for all
  to authenticated
  using (org_id in (select id from public.organisations where owner_id = auth.uid()))
  with check (org_id in (select id from public.organisations where owner_id = auth.uid()));

drop policy if exists "Owners can manage their org staged items" on public.knowledge_staged_items;
create policy "Owners can manage their org staged items"
  on public.knowledge_staged_items
  for all
  to authenticated
  using (org_id in (select id from public.organisations where owner_id = auth.uid()))
  with check (org_id in (select id from public.organisations where owner_id = auth.uid()));

-- Select-only: revisions are written exclusively by the security-definer
-- trigger in the extend-table script, which bypasses RLS by design. No
-- authenticated insert/update/delete policy exists here on purpose.
drop policy if exists "Owners can read their org knowledge revisions" on public.business_knowledge_revisions;
create policy "Owners can read their org knowledge revisions"
  on public.business_knowledge_revisions
  for select
  to authenticated
  using (org_id in (select id from public.organisations where owner_id = auth.uid()));
