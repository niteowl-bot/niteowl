-- Integration Framework (2026-08-04), milestone 1.
-- Run manually in the Supabase SQL editor, per this repo's convention (no
-- migrations folder — DDL can't be run via PostgREST/service-role key).
-- Run on BOTH projects:
--   dev:  kioljdihgbcboxlnwghv
--   prod: sklcqvvnuigpewzarbiv  (NOT reachable locally at all)
--
-- SUPERSEDES the calendar-specific first draft of this file, which was
-- never run anywhere. Nothing below is a rename of a live object.
--
-- ADDITIVE ONLY. Creates four new tables and adds one column to
-- organisations. NO EXISTING TABLE IS MODIFIED — in particular `leads`
-- is not touched at all, because external references live in
-- integration_links rather than as columns on the lead.
--
-- Nothing in the application reads these tables until
-- INTEGRATIONS_ENABLED=true, so this is safe to apply to production well
-- ahead of the feature. An org with no connection behaves exactly as it
-- does today — that is every org, on day one.
--
-- ── Why this is a framework and not a calendar schema ─────────────────
-- Every external integration this product will grow — Google Calendar,
-- Microsoft, CRMs, WhatsApp, Instagram, SMS — needs the same four
-- things: a connection with credentials, a selection of remote objects
-- to act on, a durable job queue, and a link between a local record and
-- its remote counterpart. Those are the four tables. What differs
-- between integrations is the CAPABILITY (what it can do) and the AUTH
-- STRATEGY (how it authenticates), both of which are columns here and
-- interfaces in src/lib/integrations — never new tables.
--
-- Two columns are deliberately unconstrained text: `provider` and
-- `operation`. Adding Twilio, or a messaging 'send' operation, must not
-- require a migration. The allowed values are owned by the integration
-- registry in src/lib/integrations/registry.ts.

-- ── 1) integration_connections — one row per connected account ─────────
-- One authenticated link to an external service. An org may hold several
-- (two providers, two accounts on one provider, calendar + CRM), so the
-- unique key is the account, never the org.
--
-- CREDENTIALS ARE NOT MODELLED AS OAUTH. credentials_encrypted holds an
-- encrypted JSON document whose shape is decided by auth_strategy:
--   oauth2  → { accessToken, refreshToken, expiresAtIso, scopes }
--   api_key → { values: { accountSid, authToken, ... } }   (e.g. Twilio)
--   basic   → { username, password }                        (e.g. CalDAV)
--   none    → {}                                            (e.g. ICS URL)
-- Access/refresh token columns would have fitted Google and Microsoft
-- and then blocked the first non-OAuth integration.
--
-- SECURITY: RLS is enabled with NO POLICIES AT ALL, which denies every
-- anon and authenticated caller outright — including a signed-in owner
-- using the public anon key. Only the service-role client (which
-- bypasses RLS) can read it, and every server query must still scope by
-- org_id explicitly, per the rule in src/lib/supabase/admin.ts.
create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  -- Registry id: 'google', 'microsoft', later 'twilio', 'meta', 'hubspot'.
  provider text not null,
  -- What this connection can do. Array because one connection may serve
  -- several capabilities (a Meta connection covers WhatsApp and
  -- Instagram messaging; a Google connection could later add contacts).
  capabilities text[] not null default '{}',
  auth_strategy text not null
    check (auth_strategy in ('oauth2', 'api_key', 'basic', 'none')),
  -- Stable provider-side account identity, so reconnecting the same
  -- account updates this row rather than creating a second one.
  account_id text not null,
  account_email text,
  account_name text,
  -- AES-256-GCM blob from src/lib/integrations/crypto.ts. Never raw.
  credentials_encrypted text,
  credentials_key_version smallint not null default 1,
  -- Denormalised from the credentials blob purely so a refresh scheduler
  -- can index on it without decrypting every row.
  token_expires_at timestamptz,
  status text not null default 'connected'
    check (status in ('connected', 'needs_reauth', 'error', 'disconnected')),
  last_error text,
  last_verified_at timestamptz,
  -- Per-connection, non-secret configuration (webhook ids, api base, …).
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider, account_id)
);

create index if not exists integration_connections_org_idx
  on public.integration_connections (org_id);

-- Lets the Settings page and the reconnect nag find broken connections.
create index if not exists integration_connections_status_idx
  on public.integration_connections (status)
  where status in ('needs_reauth', 'error');

-- Drives the token-refresh sweep.
create index if not exists integration_connections_expiry_idx
  on public.integration_connections (token_expires_at)
  where status = 'connected' and token_expires_at is not null;

-- ── 2) integration_resources — the remote objects we act on ────────────
-- A connected account exposes many things; this records which ones the
-- business actually uses. resource_type keeps one table serving all
-- integrations:
--   'calendar'      → a Google/Outlook calendar
--   'phone_number'  → a WhatsApp or SMS sender
--   'page'          → an Instagram/Facebook page
--   'pipeline'      → a CRM pipeline
--
-- staff_id is reserved for multi-staff routing and intentionally has no
-- foreign key: no staff table exists yet. NULL means the organisation's
-- own resource, which is the only kind version 1 creates.
create table if not exists public.integration_resources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  connection_id uuid not null
    references public.integration_connections(id) on delete cascade,
  resource_type text not null,
  external_id text not null,
  name text,
  staff_id uuid,
  -- The resource this org uses by default for its type. Version 1 has
  -- exactly one calendar; the constraint is per TYPE, so a primary
  -- calendar and a primary phone number can coexist.
  is_primary boolean not null default false,
  -- Split so a calendar can be consulted for conflicts without Remy
  -- writing to it (e.g. an owner's personal calendar).
  sync_enabled boolean not null default true,
  availability_enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The same remote object may not be selected twice within a connection.
-- Split in two because NULLs compare as distinct in a plain UNIQUE,
-- which would let duplicate org-level rows through.
create unique index if not exists integration_resources_org_level_idx
  on public.integration_resources (connection_id, resource_type, external_id)
  where staff_id is null;

create unique index if not exists integration_resources_staff_level_idx
  on public.integration_resources (connection_id, resource_type, external_id, staff_id)
  where staff_id is not null;

-- One primary per resource type per org today; one per staff later.
-- This is where the "one calendar" rule lives — NOT in the table shape.
create unique index if not exists integration_resources_primary_org_idx
  on public.integration_resources (org_id, resource_type)
  where is_primary and staff_id is null;

create unique index if not exists integration_resources_primary_staff_idx
  on public.integration_resources (org_id, resource_type, staff_id)
  where is_primary and staff_id is not null;

create index if not exists integration_resources_org_type_idx
  on public.integration_resources (org_id, resource_type);

-- ── 3) integration_jobs — durable retry queue ──────────────────────────
-- Mirrors the voice_events durability pattern: work is recorded before
-- it is attempted, so a crashed or timed-out sync is retried rather than
-- lost. dedupe_key makes enqueueing idempotent — a repeated enqueue for
-- the same subject+operation hits the unique constraint and is skipped,
-- which is the first of two defences against duplicate remote objects
-- (the second is the provider-side idempotency key).
--
-- subject_type/subject_id is polymorphic on purpose, so a messaging job
-- about a conversation and a calendar job about a lead share one queue.
-- That means no foreign key to leads, so the drain treats a vanished
-- subject as 'cancelled' rather than relying on cascade delete.
--
-- RLS enabled with no policies: internal queue, last_error carries
-- provider diagnostics. Service role only.
create table if not exists public.integration_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  connection_id uuid
    references public.integration_connections(id) on delete cascade,
  capability text not null,
  -- Unconstrained: messaging will add 'send', CRM will add 'upsert'.
  operation text not null,
  subject_type text not null default 'lead',
  subject_id uuid,
  dedupe_key text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed', 'cancelled')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  -- Snapshot of what to write, so a retry does not depend on the subject
  -- still looking the way it did when the job was queued.
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dedupe_key)
);

-- The cron drain's only query: due work, oldest first.
create index if not exists integration_jobs_due_idx
  on public.integration_jobs (next_attempt_at)
  where status = 'pending';

create index if not exists integration_jobs_org_created_idx
  on public.integration_jobs (org_id, created_at desc);

create index if not exists integration_jobs_subject_idx
  on public.integration_jobs (subject_type, subject_id);

-- ── 4) integration_links — local record ↔ remote object ────────────────
-- Replaces what would have been seven external_event_* columns on
-- `leads`. A table because one lead may exist in several places at once
-- — a calendar event, a CRM contact, a WhatsApp thread — and because it
-- leaves the leads table completely untouched by this feature.
--
-- The Remy lead remains the system of record. A row here only describes
-- the mirror copy.
create table if not exists public.integration_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  connection_id uuid not null
    references public.integration_connections(id) on delete cascade,
  resource_id uuid references public.integration_resources(id) on delete set null,
  capability text not null,
  subject_type text not null default 'lead',
  subject_id uuid not null,
  -- The provider's id for the remote object (a calendar event id, a CRM
  -- contact id, a message id).
  external_id text not null,
  -- Provider concurrency token (Google etag / Graph @odata.etag), so an
  -- update can detect that someone edited the event in the calendar
  -- itself rather than silently overwriting them.
  external_etag text,
  sync_status text not null default 'pending'
    check (sync_status in ('pending', 'synced', 'failed', 'skipped', 'deleted')),
  synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One local record maps to at most one remote object per connection and
-- capability. This is the structural guard against duplicate events.
create unique index if not exists integration_links_subject_idx
  on public.integration_links
     (subject_type, subject_id, connection_id, capability);

-- And no two links may claim the same remote object.
create unique index if not exists integration_links_external_idx
  on public.integration_links (connection_id, external_id);

-- The calendar page's join: sync badges for the appointments on screen.
create index if not exists integration_links_lookup_idx
  on public.integration_links (org_id, subject_type, subject_id);

-- ── 5) RLS ─────────────────────────────────────────────────────────────
-- Policies are created before RLS is switched on, so there is never a
-- window with RLS enabled and no policy.
--
-- integration_connections and integration_jobs get NO policies on
-- purpose: deny-all to anon and authenticated, service role only.
-- integration_resources and integration_links hold no secrets and are
-- read by the dashboard, so owners may SELECT their own rows. All writes
-- go through the server.
drop policy if exists "Owners can read their org integration resources"
  on public.integration_resources;

create policy "Owners can read their org integration resources"
  on public.integration_resources
  for select
  to authenticated
  using (
    org_id in (
      select id from public.organisations where owner_id = auth.uid()
    )
  );

drop policy if exists "Owners can read their org integration links"
  on public.integration_links;

create policy "Owners can read their org integration links"
  on public.integration_links
  for select
  to authenticated
  using (
    org_id in (
      select id from public.organisations where owner_id = auth.uid()
    )
  );

alter table public.integration_connections enable row level security;
alter table public.integration_resources   enable row level security;
alter table public.integration_jobs        enable row level security;
alter table public.integration_links       enable row level security;

-- ── 6) organisations — per-org IANA timezone ───────────────────────────
-- NOT NULL with a default, so every existing row backfills to the value
-- the code has hardcoded until now. Behaviour is therefore identical on
-- the day this runs; only an org that changes it in Settings differs.
alter table public.organisations
  add column if not exists timezone text not null default 'Europe/London';
