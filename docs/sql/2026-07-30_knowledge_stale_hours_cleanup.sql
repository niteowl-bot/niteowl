-- Stale opening-hours text in the Knowledge Base (2026-07-30).
-- Run manually in the Supabase SQL editor, per this repo's convention
-- (no migrations folder). Applies to:
--   dev:  kioljdihgbcboxlnwghv  (ALREADY DONE — 3 rows deleted 2026-07-30)
--   prod: sklcqvvnuigpewzarbiv  (NOT reachable locally — run this there)
--
-- Why: the chat assistant now takes opening hours from Settings
-- (business_hours) via getBusinessHoursSummary, and the prompt marks any
-- conflicting hours text in the Knowledge Base as out of date. That fixes
-- what Remy SAYS, but the contradictory text is still sitting in the data
-- and will resurface in anything else that reads business_knowledge
-- (Knowledge Base UI, AI Import duplicate detection, FAQ regeneration).
-- This removes it at source so business_hours is the only place opening
-- hours are defined.
--
-- NO SCHEMA CHANGE. Deletes rows only, and only ones you have reviewed.
--
-- SAFETY: this script deliberately does NOT delete by pattern. A blanket
-- pattern match would also catch legitimate entries that merely mention a
-- time ("we can usually attend within 2 hours", "no callouts after 8pm").
-- Step 1 lists candidates; you paste the ids you actually want gone into
-- step 2. Deletion is permanent — the Knowledge Base has no undo.

-- ── Step 1: review candidates ─────────────────────────────────────────
-- Every entry whose text looks like it states opening/closing times,
-- shown next to the hours that org actually has configured. Anything
-- where CONTENT disagrees with CONFIGURED_HOURS is a candidate.
select
  bk.id,
  o.business_name,
  bk.category,
  bk.status,
  bk.is_active,
  bk.title,
  bk.content,
  (
    select string_agg(
      case bh.day_of_week
        when 0 then 'Sun' when 1 then 'Mon' when 2 then 'Tue'
        when 3 then 'Wed' when 4 then 'Thu' when 5 then 'Fri'
        else 'Sat'
      end
      || ' ' ||
      case
        when bh.is_closed or bh.open_time is null or bh.close_time is null then 'closed'
        else to_char(bh.open_time, 'HH24:MI') || '-' || to_char(bh.close_time, 'HH24:MI')
      end,
      ', ' order by bh.day_of_week
    )
    from public.business_hours bh
    where bh.org_id = bk.org_id
  ) as configured_hours
from public.business_knowledge bk
join public.organisations o on o.id = bk.org_id
where
  -- mentions opening/closing in its category, title or content ...
  (
    bk.category = 'opening_hours'
    or bk.title ilike any (array['%hour%', '%open%', '%clos%'])
    or bk.content ilike any (array['%opening hour%', '%we open%', '%we close%', '%closed on%'])
  )
  -- ... and actually contains a time of day
  and bk.content ~* '([0-9]{1,2}\s?(am|pm)|[0-9]{1,2}:[0-9]{2})'
order by o.business_name, bk.category, bk.status;

-- ── Step 2: delete the reviewed ids ───────────────────────────────────
-- Paste the ids from step 1 that you want removed. Re-running is
-- harmless: already-deleted ids simply match nothing.
--
-- Deletes both published and draft rows, and rows created by AI Import
-- (source = 'ai_import'), which is where most of this text came from.
--
-- delete from public.business_knowledge
-- where id in (
--   '00000000-0000-0000-0000-000000000000',  -- replace
--   '00000000-0000-0000-0000-000000000000'   -- replace
-- );

-- ── Step 3: confirm ───────────────────────────────────────────────────
-- Re-run step 1. Ideally it returns no rows whose content disagrees with
-- configured_hours. Then ask Remy "what time do you close on Monday?" in
-- Chat Preview and confirm the answer matches Settings.

-- ── Note on AI Import history ─────────────────────────────────────────
-- Rows deleted here may still exist inside a past import's history
-- (knowledge_import_* tables), which the Knowledge Base "Restore" action
-- can re-apply. Deleting these rows does not rewrite that history, so
-- restoring an old import could reintroduce the stale hours text. If that
-- happens, re-run step 1.

-- ── Reversal ──────────────────────────────────────────────────────────
-- There is no undo. To restore an entry, re-create it via the Knowledge
-- Base UI. The three rows removed from dev on 2026-07-30 were:
--   opening_hours / published / "Opening hours"
--     "Mon-Fri 8am-6pm, Sat 9am-1pm."
--   faq / published / "What are your opening hours?"
--     "Our opening hours are Monday to Friday from 8am to 6pm, and Saturday from 9am to 1pm."
--   opening_hours / draft / "Opening hours"
--     "Monday to Friday, 7am - 7pm. Saturday, 9am - 2pm. Closed Sundays."
-- all for org 5b7fbecc-2eb0-464d-8ec3-2ef5cfccf3a5 ("Plumbing Co 3"),
-- whose configured hours are Mon-Sat 09:00-17:00, Sun closed.
Automated tests pass. Do not commit or push yet. Tell me exactly how I can perform a live phone-call test of the new availability behaviour in the current local/uncommitted state, if possible. If a live phone test requires deployment, state that clearly and do not make any changes.