-- Voice AI: delete the 2026-07-10 production test rows (owner's go-live test
-- calls). Run manually in the Supabase SQL editor on REAL PRODUCTION
-- (sklcqvvnuigpewzarbiv), per this repo's convention.
--
-- Scope: only rows from the owner's test caller (+353871465274) against the
-- test org (e3a9ae40-836a-4a55-a723-8b09a9622050), created on 2026-07-10.
-- Every DELETE is scoped by the same predicates as its inspection query —
-- nothing broader. A genuine customer call from a different number is
-- untouched by every statement here.
--
-- HOW TO RUN: run Part 1 first and eyeball the rows (expect the two test
-- calls from the live end-to-end test, plus the earlier failed-processing
-- events from the same number). Only if everything shown is really test data,
-- run Part 2 top to bottom. Part 3 re-verifies zero remaining.

-- ════════════════════════════════════════════════════════════════════
-- Part 1 — INSPECT (read-only; run first, check every row is test data)
-- ════════════════════════════════════════════════════════════════════

-- 1a. Test calls (expect ~2 completed calls from 2026-07-10)
select id, provider_call_id, status, caller_phone, started_at,
       duration_seconds, lead_id, left(summary, 80) as summary_start
from voice_calls
where org_id = 'e3a9ae40-836a-4a55-a723-8b09a9622050'
  and caller_phone = '+353871465274';

-- 1b. Raw events for those calls (join on provider_call_id so events from
--     the same test calls are caught even where org_id is null)
select e.id, e.event_type, e.provider_call_id, e.processed_at,
       e.processing_error, e.created_at
from voice_events e
where e.provider_call_id in (
        select provider_call_id
        from voice_calls
        where org_id = 'e3a9ae40-836a-4a55-a723-8b09a9622050'
          and caller_phone = '+353871465274'
      )
   or (e.org_id = 'e3a9ae40-836a-4a55-a723-8b09a9622050'
       and e.payload::text like '%+353871465274%')
order by e.created_at;

-- 1c. Voice leads from the test caller (expect 1 merged lead)
select id, name, phone, email, source, status, conversation_id, created_at
from leads
where org_id = 'e3a9ae40-836a-4a55-a723-8b09a9622050'
  and source = 'voice'
  and phone = '+353871465274';

-- 1d. Conversations created by those calls (id = the Vapi call id,
--     title 'Phone: +353871465274')
select id, title, created_at
from conversations
where org_id = 'e3a9ae40-836a-4a55-a723-8b09a9622050'
  and title = 'Phone: +353871465274';

-- ════════════════════════════════════════════════════════════════════
-- Part 2 — DELETE (only after Part 1 checks out; order matters: the events
-- delete resolves call ids from voice_calls so it must run while those rows
-- still exist, then voice_calls (references leads), then leads (references
-- conversations), then conversations)
-- ════════════════════════════════════════════════════════════════════

delete from voice_events e
where e.provider_call_id in (
        select provider_call_id
        from voice_calls
        where org_id = 'e3a9ae40-836a-4a55-a723-8b09a9622050'
          and caller_phone = '+353871465274'
      )
   or (e.org_id = 'e3a9ae40-836a-4a55-a723-8b09a9622050'
       and e.payload::text like '%+353871465274%');

delete from voice_calls
where org_id = 'e3a9ae40-836a-4a55-a723-8b09a9622050'
  and caller_phone = '+353871465274';

delete from leads
where org_id = 'e3a9ae40-836a-4a55-a723-8b09a9622050'
  and source = 'voice'
  and phone = '+353871465274';

delete from conversations
where org_id = 'e3a9ae40-836a-4a55-a723-8b09a9622050'
  and title = 'Phone: +353871465274';

-- ════════════════════════════════════════════════════════════════════
-- Part 3 — VERIFY (all four must return 0)
-- ════════════════════════════════════════════════════════════════════

select count(*) as remaining_calls  from voice_calls
  where caller_phone = '+353871465274';
select count(*) as remaining_leads  from leads
  where source = 'voice' and phone = '+353871465274';
select count(*) as remaining_convos from conversations
  where title = 'Phone: +353871465274';
select count(*) as remaining_events from voice_events
  where payload::text like '%+353871465274%';

-- ════════════════════════════════════════════════════════════════════
-- Bonus (read-only) — while you're in the editor: the garbled greeting.
-- Both test calls opened with "Hi. For calling. How can I help you today?".
-- The code default is "Thanks for calling <business>. This is Remy, the AI
-- receptionist. How can I help you today?" — the heard greeting says "Hi"
-- and is missing the "This is Remy" sentence, so a custom value in
-- voice_settings.greeting is almost certainly in play. Paste this result
-- back so the greeting can be fixed:
-- ════════════════════════════════════════════════════════════════════

select org_id, greeting, voice_id, language
from voice_settings
where org_id = 'e3a9ae40-836a-4a55-a723-8b09a9622050';
