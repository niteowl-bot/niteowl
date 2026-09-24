-- Business Opportunity Scan, Phase B / BC-2: nullable sales_leads.source
-- (docs/ARCHITECTURE.md §26.1 — the first approved owner decision).
--
-- Run manually in the Supabase SQL editor, per this repo's convention (no
-- migrations folder — DDL cannot be run via PostgREST / the service-role
-- key). Run on BOTH projects, and CONFIRM THE PROJECT SELECTOR IN THE
-- EDITOR BEFORE RUNNING — production once ran against a different,
-- un-migrated project that was missing sales_leads itself
-- (CHECKLIST.md, 2026-07-06):
--   dev:  kioljdihgbcboxlnwghv
--   prod: sklcqvvnuigpewzarbiv
--
-- What it does: adds ONE nullable text column. No default, no NOT NULL,
-- no CHECK, no backfill, no index. Every existing row keeps source IS
-- NULL and stays valid. Nothing reads `source` to make a decision; only
-- new Scan-originated contacts write the explicit value 'scan_contact'
-- (src/lib/salesLeadCapture.ts, SCAN_CONTACT_SOURCE).
--
-- ORDER MATTERS: run this on production BEFORE the BC-2 code is deployed.
-- An insert naming a column that does not exist fails (PGRST204) and the
-- visitor's contact is lost. An unused nullable column is inert, so
-- SQL-first is safe and code-first is not.
--
-- Rollback (only after the BC-2 code is reverted, for the same reason):
--   alter table public.sales_leads drop column if exists source;

-- ── 0) Pre-check: current columns and constraints. Read this first. ──
-- Expect no `source` row yet. If one already exists, STOP and report its
-- type / nullability / default before running step 1.
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'sales_leads'
 order by ordinal_position;

select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conrelid = 'public.sales_leads'::regclass;

-- ── 1) Add the column (idempotent) ───────────────────────────────────
alter table public.sales_leads
  add column if not exists source text;

-- ── 2) Verify the column: expect exactly one row, is_nullable = 'YES',
--       column_default IS NULL ─────────────────────────────────────────
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'sales_leads'
   and column_name = 'source';

-- ── 3) Verify no existing row was touched: expect 0 ──────────────────
select count(*) as rows_with_source
  from public.sales_leads
 where source is not null;
