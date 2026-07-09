-- Phase 2 Step 1: Voice AI tables (additive — no existing table is touched).
-- Run manually in the Supabase SQL editor BEFORE deploying the voice routes,
-- per this repo's convention (no migrations folder). Safe to run on the live
-- database: creates only, all guarded by IF NOT EXISTS; re-running is a no-op.

-- ── 1) voice_events — append-only raw webhook payloads ─────────────────────
-- Source of truth for everything voice. The webhook route stores the raw
-- provider payload here BEFORE any processing, so a processing failure never
-- loses a call: the row keeps processed_at NULL (+ processing_error) and can
-- be replayed. dedupe_key makes provider retries idempotent — a second
-- delivery of the same event hits the unique constraint and is skipped.
create table if not exists public.voice_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'vapi',
  dedupe_key text not null,
  event_type text not null,
  provider_call_id text,
  org_id uuid references public.organisations(id) on delete set null,
  payload jsonb not null,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now(),
  unique (provider, dedupe_key)
);

create index if not exists voice_events_org_created_idx
  on public.voice_events (org_id, created_at desc);
create index if not exists voice_events_call_idx
  on public.voice_events (provider_call_id);

-- ── 2) voice_calls — one row per phone call, derived from voice_events ─────
-- cost_usd/cost_breakdown are captured from day one so per-org usage can
-- feed metered billing later. language is forward-compatibility for
-- multilingual support (defaulted, unused by code today).
create table if not exists public.voice_calls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  provider text not null default 'vapi',
  provider_call_id text not null,
  direction text not null default 'inbound',
  status text not null default 'in_progress',
  ended_reason text,
  caller_phone text,
  business_phone text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  summary text,
  transcript text,
  recording_url text,
  cost_usd numeric(10, 4),
  cost_breakdown jsonb,
  language text,
  lead_id uuid references public.leads(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_call_id)
);

create index if not exists voice_calls_org_created_idx
  on public.voice_calls (org_id, created_at desc);

-- ── 3) voice_settings — per-org voice configuration ────────────────────────
-- phone_number (E.164, e.g. +447700900123) → org is THE tenant key for
-- inbound calls: the webhook resolves which business a call belongs to by
-- the number that was dialled. enabled=false keeps an org dark even if a
-- number is assigned. transfer_phone is reserved for the later
-- human-handoff phase (unused by code today).
create table if not exists public.voice_settings (
  org_id uuid primary key references public.organisations(id) on delete cascade,
  enabled boolean not null default false,
  phone_number text unique,
  provider_phone_number_id text,
  transfer_phone text,
  greeting text,
  voice_id text,
  language text not null default 'en-GB',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Server code uses the service-role client (bypasses RLS and scopes every
-- query by org_id in application code — the same trust model as the public
-- widget route). Owners get read-only access to their own org's calls and
-- settings for a future dashboard page. voice_events stays server-only:
-- RLS enabled with no policies = no client access at all.
alter table public.voice_events enable row level security;
alter table public.voice_calls enable row level security;
alter table public.voice_settings enable row level security;

drop policy if exists "Owners can read their org voice calls" on public.voice_calls;
create policy "Owners can read their org voice calls"
  on public.voice_calls for select
  using (
    org_id in (select id from public.organisations where owner_id = auth.uid())
  );

drop policy if exists "Owners can read their org voice settings" on public.voice_settings;
create policy "Owners can read their org voice settings"
  on public.voice_settings for select
  using (
    org_id in (select id from public.organisations where owner_id = auth.uid())
  );

-- ── Note on leads.source ────────────────────────────────────────────────────
-- Voice leads are inserted with source = 'voice' through the existing
-- capturePartialLead engine. Existing sources ('chat', 'web_widget',
-- 'dashboard_preview') were added without schema changes, so leads.source
-- is expected to be a plain text column. If a CHECK constraint was ever
-- added manually, extend it before enabling voice:
--   alter table public.leads drop constraint <name>;
--   alter table public.leads add constraint <name>
--     check (source in ('chat', 'web_widget', 'dashboard_preview', 'voice'));
