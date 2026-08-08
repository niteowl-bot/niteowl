-- Cancel the 11 stale voice test rows that were holding future appointment
-- capacity on REAL PRODUCTION (sklcqvvnuigpewzarbiv).
--
-- ⚠️ ALREADY EXECUTED — 2026-08-08, via the service-role REST API rather than
-- the SQL editor. This file is the durable RECORD of that operation, plus
-- re-verification and rollback. Do NOT run Part 2 again: it is idempotent
-- (the rows are already 'cancelled') but there is no reason to.
--
-- Production SHA at the time of the operation:
--   c6f5bd19fde08bdcc531ed16e9e01ae1a3a938d5
--   ("fix(booking): prevent overlapping appointments, and fail closed when a
--    check cannot be made" — READY, alias niteowlhq.com)
--
-- ── WHY ──────────────────────────────────────────────────────────────
-- That deployment changed capacity from an exact-timestamp match to an
-- INTERVAL OVERLAP. Under the old rule a stale test request at 15:00 blocked
-- only the instant 15:00; under overlap it blocks the whole open interval
-- (14:00, 16:00). Eleven leads left behind by the owner's own test calls on
-- 6–8 August therefore began blocking real appointment slots on 10–13 August
-- — six hourly starts in total. The rows were correct data; the fix simply
-- made their footprint honest, and they were never real bookings.
--
-- ── WHY CANCEL RATHER THAN DELETE ────────────────────────────────────
-- The held-slot check excludes cancelled/lost by design
-- (RELEASED_STATUSES in src/lib/voice/availabilityTool.ts), so cancelling
-- frees the slots exactly as deleting would — while preserving the rows, the
-- metadata and the link to each voice_calls record. It is also trivially
-- reversible (Part 4). Deletion would have discarded evidence for no gain.
--
-- ── SCOPE ────────────────────────────────────────────────────────────
-- Eleven EXPLICIT ids, listed below. Deliberately NOT a status/date/org
-- predicate: a broad WHERE would have swept up rows that were audited and
-- excluded. Untouched: 4 inert future rows (no appointment_request flag, so
-- they hold nothing), 15 past-dated/null-datetime rows, every
-- 'Verification Plumbing Co' record, and every dashboard/widget lead.
--
-- ── HOW THE 11 WERE IDENTIFIED AS TEST DATA ──────────────────────────
-- All eleven satisfied every one of these, verified immediately before the
-- write (88 of 88 checks passed):
--   1. org_id = e3a9ae40-836a-4a55-a723-8b09a9622050 ('Niteowl Test') — the
--      Remy test environment, and the only org with voice enabled.
--   2. source = 'voice'.
--   3. phone AND metadata.caller_id = the owner's own test handset — the same
--      +3538714652xx number already recorded in
--      docs/sql/2026-07-12_voice_test_rows_cleanup.sql. It appears on 28 of
--      49 production leads and on zero non-voice leads.
--   4. Each linked to a real voice_calls row from that handset, 132–199s
--      long: the test calls made while iterating on the voice flow.
--   5. created_at clustered on 6–8 August, matching those sessions.
--   6. Eight different "customer" names across a SINGLE handset, with
--      recycled synthetic addresses — a pattern no real caller can produce,
--      since a genuine caller carries their own caller ID.
-- Contact details are deliberately omitted here: they are fabricated test
-- personas and are not needed to identify the rows. The ids are authoritative.

-- ════════════════════════════════════════════════════════════════════
-- Part 1 — THE 11 ROWS, AND THEIR BEFORE/AFTER STATE
-- ════════════════════════════════════════════════════════════════════
--
-- Every row was 'awaiting_confirmation' before and is 'cancelled' after.
-- appointment_datetime is unchanged; it is shown as the reason each row
-- mattered. Times are UTC; the business runs Europe/London (BST, UTC+1).
--
--  lead id                               appointment_datetime  local  before                 after
--  ------------------------------------  --------------------  -----  ---------------------  ---------
--  c91c1794-7859-466c-bf0c-f90b2f80916d  2026-08-10T09:00:00Z  Mon 10:00  awaiting_confirmation  cancelled
--  f8b5b8eb-f5ce-4212-9336-e9374e524c59  2026-08-11T09:00:00Z  Tue 10:00  awaiting_confirmation  cancelled
--  4b0ac0bd-548f-407d-9759-a4fcf7cc4296  2026-08-11T10:00:00Z  Tue 11:00  awaiting_confirmation  cancelled
--  50c355d8-8fd3-409e-b3f2-2917cc741ea2  2026-08-12T14:00:00Z  Wed 15:00  awaiting_confirmation  cancelled
--  e174277c-680c-436a-b5e9-3fcca62e65b2  2026-08-12T14:00:00Z  Wed 15:00  awaiting_confirmation  cancelled
--  1773d59b-7727-45fd-b9af-c0b71b54b18f  2026-08-12T14:02:00Z  Wed 15:02  awaiting_confirmation  cancelled
--  29d80eb3-eade-479c-8fb0-a1f3891dac2d  2026-08-12T15:00:00Z  Wed 16:00  awaiting_confirmation  cancelled
--  4ff82adf-f8cc-4e0f-ae79-1fb3e340446f  2026-08-12T15:00:00Z  Wed 16:00  awaiting_confirmation  cancelled
--  e02519dd-faef-4fa3-8c87-05532bc3685a  2026-08-12T15:00:00Z  Wed 16:00  awaiting_confirmation  cancelled
--  88e5e9ba-456f-45a8-80c5-65a18e84cbe9  2026-08-13T08:00:00Z  Thu 09:00  awaiting_confirmation  cancelled
--  6f170fbf-b3f1-4b99-92b3-2f4fedf46d23  2026-08-13T08:00:00Z  Thu 09:00  awaiting_confirmation  cancelled
--
-- The 15:02 row is off the hourly grid — it came from a mis-transcribed
-- "3:02 PM" on a 6 August call — and blocked (14:02, 16:02).

-- ════════════════════════════════════════════════════════════════════
-- Part 2 — WHAT WAS EXECUTED (already done; recorded for the audit trail)
-- ════════════════════════════════════════════════════════════════════
--
-- Issued as ONE statement scoped to the explicit id list, so it committed as
-- a single transaction. Only `status` was written; `updated_at` moved because
-- the table maintains it. No other column was sent.

-- update public.leads
--    set status = 'cancelled'
--  where id in (
--    'c91c1794-7859-466c-bf0c-f90b2f80916d',
--    'f8b5b8eb-f5ce-4212-9336-e9374e524c59',
--    '4b0ac0bd-548f-407d-9759-a4fcf7cc4296',
--    '50c355d8-8fd3-409e-b3f2-2917cc741ea2',
--    'e174277c-680c-436a-b5e9-3fcca62e65b2',
--    '1773d59b-7727-45fd-b9af-c0b71b54b18f',
--    '29d80eb3-eade-479c-8fb0-a1f3891dac2d',
--    '4ff82adf-f8cc-4e0f-ae79-1fb3e340446f',
--    'e02519dd-faef-4fa3-8c87-05532bc3685a',
--    '88e5e9ba-456f-45a8-80c5-65a18e84cbe9',
--    '6f170fbf-b3f1-4b99-92b3-2f4fedf46d23'
--  );
-- -- 11 rows updated.

-- ════════════════════════════════════════════════════════════════════
-- Part 3 — VERIFICATION (read-only; safe to re-run at any time)
-- ════════════════════════════════════════════════════════════════════
--
-- RESULTS RECORDED 2026-08-08, immediately after the update:
--
--   Total production leads      before 49  →  after 49   (NO ROWS DELETED)
--   awaiting_confirmation       before 30  →  after 19
--   Future capacity-holding     before 11  →  after  0
--   Future confirmed bookings   before  0  →  after  0
--
--   Columns changed on the 11 targets : status, updated_at — and nothing else
--   Rows changed OUTSIDE the 11       : 0
--   Evidence preserved on all 11      : metadata (incl. appointment_request,
--                                       caller_id, service_address),
--                                       appointment_datetime, name, email,
--                                       phone, service_needed, conversation_id
--   voice_calls (56 rows)             : not targeted, unchanged
--
-- Proven by diffing a full 49-row pre-change snapshot against a post-change
-- read, column by column, rather than by spot checks.

-- 3a. The 11 are cancelled, and their evidence is intact.
select id, status, appointment_datetime,
       metadata->>'appointment_request' as appointment_request,
       conversation_id is not null as call_linked
from public.leads
where id in (
  'c91c1794-7859-466c-bf0c-f90b2f80916d','f8b5b8eb-f5ce-4212-9336-e9374e524c59',
  '4b0ac0bd-548f-407d-9759-a4fcf7cc4296','50c355d8-8fd3-409e-b3f2-2917cc741ea2',
  'e174277c-680c-436a-b5e9-3fcca62e65b2','1773d59b-7727-45fd-b9af-c0b71b54b18f',
  '29d80eb3-eade-479c-8fb0-a1f3891dac2d','4ff82adf-f8cc-4e0f-ae79-1fb3e340446f',
  'e02519dd-faef-4fa3-8c87-05532bc3685a','88e5e9ba-456f-45a8-80c5-65a18e84cbe9',
  '6f170fbf-b3f1-4b99-92b3-2f4fedf46d23'
)
order by appointment_datetime;
-- Expect: 11 rows, all status='cancelled', appointment_request still 'true',
-- call_linked true. Nothing else altered.

-- 3b. Nothing future is holding capacity for the test org any more.
--     This is the same predicate isHeldByPendingRequest issues.
select count(*) as future_holds
from public.leads
where org_id = 'e3a9ae40-836a-4a55-a723-8b09a9622050'
  and appointment_datetime > now()
  and metadata->>'appointment_request' = 'true'
  and status not in ('cancelled', 'lost');
-- Expect: 0.

-- 3c. Capacity restored for 10–13 August.
--     A slot is blocked when a live request OVERLAPS it — the same strict
--     window the deployed code uses: (start - duration, start + duration).
with slots as (
  select generate_series(
    timestamptz '2026-08-10 09:00 Europe/London',
    timestamptz '2026-08-13 16:00 Europe/London',
    interval '1 hour') as slot
),
open_slots as (
  select slot from slots
  where extract(hour from slot at time zone 'Europe/London') between 9 and 16
)
select o.slot at time zone 'Europe/London' as local_start,
       (select count(*) from public.leads l
         where l.org_id = 'e3a9ae40-836a-4a55-a723-8b09a9622050'
           and l.metadata->>'appointment_request' = 'true'
           and l.status not in ('cancelled','lost')
           and l.appointment_datetime > o.slot - interval '60 minutes'
           and l.appointment_datetime < o.slot + interval '60 minutes'
       ) as held,
       (select count(*) from public.leads l
         where l.org_id = 'e3a9ae40-836a-4a55-a723-8b09a9622050'
           and l.status = 'booked'
           and l.appointment_datetime > o.slot - interval '60 minutes'
           and l.appointment_datetime < o.slot + interval '60 minutes'
       ) as booked
from open_slots o
order by o.slot;
-- Expect: held = 0 and booked = 0 for every row.
--
-- RESULT RECORDED 2026-08-08 — all 32 starts (09:00–16:00 across the four
-- days) free, and all SIX previously-blocked starts restored:
--   Mon 10 Aug  10:00
--   Tue 11 Aug  10:00, 11:00
--   Wed 12 Aug  15:00, 16:00
--   Thu 13 Aug  09:00
-- Verified by issuing the two predicates the deployed code actually runs,
-- not by re-deriving the rule.

-- ════════════════════════════════════════════════════════════════════
-- Part 4 — ROLLBACK
-- ════════════════════════════════════════════════════════════════════
--
-- Restores exactly the previous state: the only field changed was `status`,
-- from 'awaiting_confirmation' to 'cancelled', so putting it back is a
-- complete reversal. `updated_at` will move again — it cannot be restored to
-- its original value, and does not need to be.
--
-- Scoped to the SAME 11 explicit ids. Never widen this to a status/date
-- predicate: other rows are legitimately 'cancelled' and must stay that way.
--
-- Re-holding these slots would re-block the six starts listed in 3c.

-- update public.leads
--    set status = 'awaiting_confirmation'
--  where id in (
--    'c91c1794-7859-466c-bf0c-f90b2f80916d',
--    'f8b5b8eb-f5ce-4212-9336-e9374e524c59',
--    '4b0ac0bd-548f-407d-9759-a4fcf7cc4296',
--    '50c355d8-8fd3-409e-b3f2-2917cc741ea2',
--    'e174277c-680c-436a-b5e9-3fcca62e65b2',
--    '1773d59b-7727-45fd-b9af-c0b71b54b18f',
--    '29d80eb3-eade-479c-8fb0-a1f3891dac2d',
--    '4ff82adf-f8cc-4e0f-ae79-1fb3e340446f',
--    'e02519dd-faef-4fa3-8c87-05532bc3685a',
--    '88e5e9ba-456f-45a8-80c5-65a18e84cbe9',
--    '6f170fbf-b3f1-4b99-92b3-2f4fedf46d23'
--  )
--    and status = 'cancelled';   -- guard: never revive an already-restored row
