-- Calendar & Appointment Management, Step 1 — calendar_connections
-- (2026-07-20). Additive only — no existing table is touched.
--
-- Run manually in the Supabase SQL editor, per this repo's convention (no
-- migrations folder — DDL can't be run via PostgREST/service-role key, only
-- table CRUD, so this needs the SQL editor even on the locally-reachable
-- dev project). Run on BOTH projects:
--   dev:  kioljdihgbcboxlnwghv
--   prod: sklcqvvnuigpewzarbiv  (NOT reachable locally at all)
--
-- Safe to run on the live database: guarded by IF NOT EXISTS / DROP POLICY
-- IF EXISTS throughout, so re-running is a no-op.
--
-- Why: Step 1 of the Google Calendar integration lets each business connect
-- its own Google Calendar via OAuth so future steps can read availability
-- from it and write real appointments to it. This table holds one row per
-- org: the OAuth tokens (encrypted at rest by the application before they
-- ever reach here — see src/lib/calendar/tokenCrypto.ts), the connected
-- account email (for status display), and which calendar to write to.
-- Nothing in Step 1 reads or writes bookings — this only stores the
-- connection. Mirrors the voice_settings pattern exactly: org_id PK,
-- service-role-only writes, owner read-only RLS. provider carries a check
-- constraint including 'outlook' so a second provider can be added later
-- with no schema change.

create table if not exists public.calendar_connections (
  org_id uuid primary key references public.organisations(id) on delete cascade,
  provider text not null default 'google'
    check (provider in ('google', 'outlook')),
  account_email text,
  calendar_id text not null default 'primary',
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  scopes text,
  connected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── RLS ──────────────────────────────────────────────────────────────
-- Server code uses the service-role client (bypasses RLS and scopes every
-- query by org_id in application code — the same trust model as the public
-- widget and voice routes). Owners get read-only access to their own org's
-- connection so the Settings page can render status directly. The token
-- columns are only ever read server-side via the service-role client for
-- decryption; the owner-read policy exposes the row (including the
-- encrypted, unusable-without-the-server-key token blobs) but never the
-- plaintext tokens, which never leave the server.
alter table public.calendar_connections enable row level security;

drop policy if exists "Owners can read their org calendar connection" on public.calendar_connections;
create policy "Owners can read their org calendar connection"
  on public.calendar_connections for select
  using (
    org_id in (select id from public.organisations where owner_id = auth.uid())
  );
