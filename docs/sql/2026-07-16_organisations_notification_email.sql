-- Owner notification recipient fix (2026-07-16)
--
-- Run manually in the Supabase SQL editor, per this repo's convention (no
-- migrations folder — DDL can't be run via PostgREST/service-role key, only
-- table CRUD, so this needs the SQL editor even on the locally-reachable
-- dev project). Run on BOTH projects:
--   dev:  kioljdihgbcboxlnwghv
--   prod: sklcqvvnuigpewzarbiv  (NOT reachable locally at all)
--
-- Why: every owner notification (booking confirmations, needs-review
-- handoffs, self-service cancel/reschedule, voice call summaries) resolves
-- its recipient via getOrgOwnerEmail() in src/lib/leadCapture.ts, which
-- used the org owner's Supabase Auth LOGIN email with no way to separate
-- "who can sign in" from "who gets notified." For the owner's own org that
-- login email is a personal address, not admin@niteowlhq.com.
--
-- Fix: add a nullable, owner-configurable notification_email column.
-- getOrgOwnerEmail() now prefers it and falls back to the existing
-- auth-email behaviour when null — so every other org (real future
-- tenants) keeps working exactly as before with zero code changes needed
-- on their side. This script does NOT touch auth.users, ADMIN_EMAIL, or
-- any login/access-control path — sign-in is completely unaffected.

-- ── 1) Add the column (idempotent) ───────────────────────────────────
alter table public.organisations
  add column if not exists notification_email text;

-- ── 2) Preview which row(s) this will change — CHECK BEFORE RUNNING 3 ─
-- Expect exactly one row: the owner's own primary/pilot business org.
-- If more than one row comes back, stop and confirm with the owner which
-- org(s) should actually receive admin@niteowlhq.com before running step 3.
select o.id, o.business_name, o.owner_id, u.email as current_login_email
from public.organisations o
join auth.users u on u.id = o.owner_id
where u.email = 'erniesophura@gmail.com';

-- ── 3) Set the notification recipient for that org ───────────────────
-- Scoped by the owner's current login email so this only ever touches
-- org(s) actually owned by that account — never a guess at a row id.
update public.organisations
set notification_email = 'admin@niteowlhq.com'
where owner_id in (
  select id from auth.users where email = 'erniesophura@gmail.com'
);

-- ── Verification ───────────────────────────────────────────────────
select id, business_name, notification_email
from public.organisations
where notification_email = 'admin@niteowlhq.com';
