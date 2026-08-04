-- External calendar integration (2026-08-04), milestone 1 of 7.
-- Run manually in the Supabase SQL editor, per this repo's convention (no
-- migrations folder — DDL can't be run via PostgREST/service-role key).
-- Run on BOTH projects:
--   dev:  kioljdihgbcboxlnwghv
--   prod: sklcqvvnuigpewzarbiv  (NOT reachable locally at all)
--
-- ADDITIVE ONLY. Creates three new tables and adds nullable columns to
-- two existing ones. No existing column is altered, dropped or retyped;
-- no existing row changes meaning. Everything is guarded by IF NOT
-- EXISTS, so re-running is a no-op.
--
-- Nothing in the application reads these tables until
-- CALENDAR_SYNC_ENABLED=true, so this can be applied to production well
-- before the feature ships. An org with no calendar_connections row
-- behaves exactly as it does today — that is every org, on day one.
--
-- ── Why the shape is what it is ────────────────────────────────────────
-- Version 1's UI exposes ONE calendar per business, but the schema
-- deliberately does NOT encode that: there is no unique constraint on
-- org_id anywhere. A business can hold several connected accounts
-- (calendar_connections) and select several calendars within them
-- (calendar_selections), which is what multi-staff routing will need
-- later. The single-calendar rule is enforced by a PARTIAL unique index
-- on the primary flag, which extends to one-primary-per-staff without a
-- schema redesign.
--
-- provider is deliberately NOT constrained to ('google','microsoft').
-- Adding Apple/CalDAV/ICS later must not require a migration — the
-- allowed set is owned by the provider registry in
-- src/lib/calendar/registry.ts, which is the only place that knows which
-- providers exist.

-- ── 1) calendar_connections — one row per connected account ────────────
-- One OAuth grant. An org may hold several (two providers, or two
-- accounts on one provider), so the unique key is the account, not the
-- org.
--
-- SECURITY: this table holds encrypted OAuth tokens. RLS is enabled with
-- NO POLICIES AT ALL, which denies every anon and authenticated caller
-- outright — including a signed-in owner using the public anon key. Only
-- the service-role client (which bypasses RLS) can read it, and every
-- server query must still scope by org_id explicitly, per the rule in
-- src/lib/supabase/admin.ts. The dashboard never selects the token
-- columns; it reads status through a server component.
create table if not exists public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  provider text not null,
  -- Stable provider-side account identifier (Google "sub", Microsoft
  -- "id"). Used as the account's identity so reconnecting the same
  -- account updates the row instead of creating a second one.
  provider_account_id text not null,
  provider_account_email text,
  -- AES-256-GCM blobs produced by src/lib/calendar/crypto.ts, never raw
  -- tokens. token_key_version mirrors the version embedded in the blob so
  -- a key rotation can find rows still on the old key without decrypting.
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_key_version smallint not null default 1,
  token_expires_at timestamptz,
  scopes text,
  status text not null default 'connected'
    check (status in ('connected', 'needs_reauth', 'error', 'disconnected')),
  last_error text,
  last_synced_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider, provider_account_id)
);

create index if not exists calendar_connections_org_idx
  on public.calendar_connections (org_id);

-- Lets the reconnect-nag job find broken connections cheaply.
create index if not exists calendar_connections_status_idx
  on public.calendar_connections (status)
  where status in ('needs_reauth', 'error');

-- ── 2) calendar_selections — which calendars are actually used ─────────
-- Separate from the connection because one account exposes many
-- calendars and a business may eventually sync more than one.
--
-- staff_id is reserved for multi-staff routing and intentionally has no
-- foreign key: no staff table exists yet. NULL means "the organisation's
-- own calendar", which is the only kind version 1 creates.
create table if not exists public.calendar_selections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  connection_id uuid not null
    references public.calendar_connections(id) on delete cascade,
  external_calendar_id text not null,
  external_calendar_name text,
  staff_id uuid,
  -- The calendar Remy books into. Version 1 always has exactly one.
  is_primary boolean not null default false,
  -- Split so a calendar can be consulted for conflicts without Remy
  -- writing to it (e.g. a personal calendar an owner wants respected).
  sync_enabled boolean not null default true,
  availability_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The same calendar may not be selected twice within one connection.
-- Split in two because NULLs compare as distinct in a plain UNIQUE, which
-- would let duplicate org-level rows through.
create unique index if not exists calendar_selections_org_level_idx
  on public.calendar_selections (connection_id, external_calendar_id)
  where staff_id is null;

create unique index if not exists calendar_selections_staff_level_idx
  on public.calendar_selections (connection_id, external_calendar_id, staff_id)
  where staff_id is not null;

-- Exactly one primary calendar per org today; one per staff member later.
-- This is where the "one calendar" rule lives — NOT in the table shape.
create unique index if not exists calendar_selections_primary_org_idx
  on public.calendar_selections (org_id)
  where is_primary and staff_id is null;

create unique index if not exists calendar_selections_primary_staff_idx
  on public.calendar_selections (org_id, staff_id)
  where is_primary and staff_id is not null;

create index if not exists calendar_selections_org_idx
  on public.calendar_selections (org_id);

-- ── 3) calendar_sync_jobs — durable retry queue ────────────────────────
-- Mirrors the voice_events durability pattern: the work is recorded
-- before it is attempted, so a crashed or timed-out sync is retried
-- rather than lost. dedupe_key makes enqueueing idempotent — a repeated
-- enqueue for the same lead+operation hits the unique constraint and is
-- skipped, which is the first of two defences against duplicate events
-- (the second is the provider-side idempotency key).
--
-- RLS enabled with no policies: internal queue, last_error can contain
-- provider diagnostics. Service role only.
create table if not exists public.calendar_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  selection_id uuid references public.calendar_selections(id) on delete set null,
  operation text not null check (operation in ('create', 'update', 'cancel')),
  dedupe_key text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed', 'cancelled')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  -- Snapshot of what to write, so a retry does not depend on the lead
  -- still looking the way it did when the job was queued.
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dedupe_key)
);

-- The cron drain's only query: due work, oldest first.
create index if not exists calendar_sync_jobs_due_idx
  on public.calendar_sync_jobs (next_attempt_at)
  where status = 'pending';

create index if not exists calendar_sync_jobs_org_created_idx
  on public.calendar_sync_jobs (org_id, created_at desc);

create index if not exists calendar_sync_jobs_lead_idx
  on public.calendar_sync_jobs (lead_id);

-- ── 4) RLS ─────────────────────────────────────────────────────────────
-- Policies are created (where any exist) before RLS is switched on, so
-- there is never a window with RLS enabled and no policy.
--
-- calendar_connections and calendar_sync_jobs get NO policies on purpose:
-- deny-all to anon and authenticated, service role only. calendar_
-- selections holds no secrets, so owners may read their own rows; writes
-- still go through the server.
drop policy if exists "Owners can read their org calendar selections"
  on public.calendar_selections;

create policy "Owners can read their org calendar selections"
  on public.calendar_selections
  for select
  to authenticated
  using (
    org_id in (
      select id from public.organisations where owner_id = auth.uid()
    )
  );

alter table public.calendar_connections enable row level security;
alter table public.calendar_selections  enable row level security;
alter table public.calendar_sync_jobs   enable row level security;

-- ── 5) leads — external event bookkeeping (additive, all nullable) ─────
-- The Remy lead stays the system of record. These columns only record
-- what happened to the mirror copy in the external calendar, so a lead
-- with them all NULL — every existing row — is exactly a lead that has
-- never been synced, which is the correct reading.
alter table public.leads
  add column if not exists external_event_id text,
  add column if not exists external_event_provider text,
  add column if not exists external_calendar_id text,
  -- Provider concurrency token (Google etag / Graph @odata.etag), so an
  -- update can detect that someone edited the event in the calendar
  -- itself rather than silently overwriting them.
  add column if not exists external_event_etag text,
  add column if not exists external_event_sync_status text,
  add column if not exists external_event_synced_at timestamptz,
  add column if not exists external_event_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'leads_external_sync_status_valid'
  ) then
    alter table public.leads
      add constraint leads_external_sync_status_valid
      check (
        external_event_sync_status is null
        or external_event_sync_status in
             ('pending', 'synced', 'failed', 'skipped', 'deleted')
      );
  end if;
end $$;

-- Second defence against duplicate events: one lead per external event.
create unique index if not exists leads_external_event_idx
  on public.leads (external_event_provider, external_event_id)
  where external_event_id is not null;

-- ── 6) organisations — per-org IANA timezone ───────────────────────────
-- NOT NULL with a default, so every existing row backfills to the value
-- the code has hardcoded until now. Behaviour is therefore identical on
-- the day this runs; only an org that changes it in Settings differs.
alter table public.organisations
  add column if not exists timezone text not null default 'Europe/London';
