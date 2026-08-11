-- Voice event replay: recover call-ended events whose processing failed.
--
-- Run manually in the Supabase SQL editor, per this repo's convention
-- (no migrations folder). Additive only — two nullable/defaulted columns
-- and one index. Safe to run on the live database; re-running is a no-op.
--
-- ── Why a column was needed ────────────────────────────────────────
-- voice_events already carries processed_at and processing_error, which
-- is enough to FIND a failed event but not enough to CLAIM one: two
-- replay workers selecting the same row would both process it. The only
-- schema-free alternatives were to abuse processing_error as a lock
-- (destroying the diagnostic this table exists to keep) or to set
-- processed_at optimistically before the work (which loses the event
-- entirely if the worker dies mid-flight). Neither is acceptable, so the
-- claim gets its own column.

alter table public.voice_events
  add column if not exists processing_started_at timestamptz;

-- How many times replay has CLAIMED this event. Bounded retries: an
-- event that keeps failing stops being retried and is surfaced for a
-- human instead of being retried forever or silently dropped.
alter table public.voice_events
  add column if not exists attempts integer not null default 0;

comment on column public.voice_events.processing_started_at is
  'When a replay worker claimed this event. Compare-and-swap lock: a claim older than the stale window is reclaimable, so a worker that dies mid-flight does not strand the row.';

comment on column public.voice_events.attempts is
  'Replay claims made for this event. Past the cap the event is left alone and reported, never silently discarded.';

-- The replay selection, as an index: unprocessed events only. Partial,
-- so it stays small — the overwhelming majority of rows are processed
-- and are excluded from the index entirely.
create index if not exists voice_events_replay_idx
  on public.voice_events (created_at)
  where processed_at is null;

-- ══════════════════════════════════════════════════════════════════
--  OPERATOR CHECKS
-- ══════════════════════════════════════════════════════════════════
--
-- Run the PRE-MIGRATION query BEFORE the ALTERs above, and before the
-- cron is ever enabled. The first replay run will attempt every event
-- it lists — including calls from weeks ago, whose owners would then
-- receive a summary email about a call they have long forgotten.
-- Decide deliberately what should happen to anything old.
--
-- Nothing here modifies data. Both are pure SELECTs.

-- ── PRE-MIGRATION: what would become eligible on the first run ─────
--
-- Uses ONLY columns that exist before the ALTERs above. The earlier
-- version of this query selected `attempts` and `processing_started_at`
-- and therefore failed with 42703 undefined_column on the very schema
-- it was meant to inspect.
--
-- Mirrors every eligibility condition the worker applies that can be
-- evaluated pre-migration: event_type, processed_at, org_id and the
-- 5-minute age cutoff. The two it cannot check are `attempts < 5` and
-- the claim state — both are vacuous here, because every existing row
-- gets attempts = 0 and processing_started_at = NULL from the defaults.
--
--   select id, provider_call_id, org_id, created_at,
--          left(processing_error, 200) as err
--     from public.voice_events
--    where processed_at is null
--      and event_type = 'call-ended'
--      and org_id is not null
--      and created_at < now() - interval '5 minutes'
--    order by created_at asc;
--
-- Scale and age, which is what decides whether the backlog is safe to
-- release. `older_than_7d` is the number of owners who would be emailed
-- about a stale call.
--
--   select count(*) as eligible,
--          min(created_at) as oldest,
--          max(created_at) as newest,
--          count(*) filter (where created_at < now() - interval '7 days')
--            as older_than_7d
--     from public.voice_events
--    where processed_at is null
--      and event_type = 'call-ended'
--      and org_id is not null;
--
-- Events EXCLUDED from replay because they match no organisation. These
-- are a number-configuration problem and are never retried; worth
-- knowing they exist.
--
--   select count(*) as unmatched_org
--     from public.voice_events
--    where processed_at is null
--      and event_type = 'call-ended'
--      and org_id is null;

-- ── POST-MIGRATION: verification and ongoing monitoring ────────────
--
-- Confirms the columns landed with the expected defaults on existing
-- rows: every pre-existing event must read attempts = 0 and
-- processing_started_at = NULL.
--
--   select count(*) as total,
--          count(*) filter (where attempts = 0) as attempts_defaulted,
--          count(*) filter (where processing_started_at is null)
--            as never_claimed
--     from public.voice_events
--    where processed_at is null
--      and event_type = 'call-ended';
--
-- Ongoing: what is stuck, and what has given up. An event at
-- attempts >= 5 is no longer retried and no longer consumes batch
-- capacity — it stays here until a human deals with it.
--
--   select id, provider_call_id, attempts, created_at,
--          processing_started_at, left(processing_error, 200) as err
--     from public.voice_events
--    where processed_at is null
--      and event_type = 'call-ended'
--    order by attempts desc, created_at asc;
