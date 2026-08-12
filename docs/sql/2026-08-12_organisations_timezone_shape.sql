-- Reject clearly-invalid values in organisations.timezone at the database
-- boundary.
--
-- ⚠️ NOT YET EXECUTED. Run Part 2 only after Part 1 returns zero offending
-- rows on the project being changed. Read-only parts are safe to re-run.
--
-- ── WHY ──────────────────────────────────────────────────────────────
-- PR #9 (b18354e) made availability judge business hours on the
-- organisation's own clock, and made it FAIL CLOSED when that clock cannot
-- be established: a failed read, a missing value, or a value Intl cannot
-- use all mean "we do not know what 09:00 means for this business", so the
-- slot is refused rather than guessed at in Europe/London.
--
-- That runtime protection is correct and this change does NOT touch it.
-- This is preventative, one layer earlier: stop a malformed value being
-- STORED, so the fail-closed path stays a genuine safety net rather than a
-- routine occurrence.
--
-- The column today is:
--   timezone text not null default 'Europe/London'   (2026-08-04 migration)
-- NOT NULL rules out NULL. It does not rule out '', '   ', ' Europe/London'
-- or 'BST' — all of which are storable right now.
--
-- ── WHY THIS PREDICATE, AND NOT A LIST ───────────────────────────────
-- Deliberately NOT a frozen enum of IANA zone names. Postgres cannot keep
-- such a list in step with the runtime's ICU build, and this codebase has
-- already been bitten by exactly that drift: isValidTimezone carries a note
-- about an India user whose perfectly valid 'Asia/Kolkata' was rejected
-- because their ICU listed only 'Asia/Calcutta'. A frozen list would
-- reintroduce that failure with no way to widen it except another migration.
--
-- The predicate instead mirrors the application's own IANA_ID_SHAPE rule —
-- an Area/Location id containing at least one '/' — which is precisely what
-- excludes the dangerous legacy abbreviations. Those are the real hazard:
-- Intl ACCEPTS them and silently resolves them somewhere else. 'BST'
-- becomes Asia/Dhaka (UTC+6), so an owner picking it for British Summer
-- Time would have every appointment six hours out with no error raised
-- anywhere. 'EST' becomes America/Panama. Not one contains a slash.
--
-- 'UTC' is allowed explicitly. It is a legitimate choice for a business
-- with no fixed locale, the application's CANONICAL_ZONES adds it by hand
-- (some ICU builds omit it from supportedValuesOf), and it has no slash.
--
-- Checked before writing this, not assumed: of the 418 canonical zones this
-- runtime reports, ZERO are slashless. So 'UTC' is the only exception the
-- predicate needs today.
--
-- ── THE ONE RESIDUAL RISK, STATED ────────────────────────────────────
-- If some future ICU build lists a slashless canonical zone AND a timezone
-- picker later offers it, this constraint would reject the write. That
-- fails LOUDLY at write time — a 400 the owner sees — rather than silently
-- storing a zone that corrupts every later date calculation. It is one line
-- to widen. The accompanying test (tests/calendarTimezone.test.mjs) asserts
-- that every zone the application would canonicalise satisfies this
-- predicate, so the drift is caught in CI rather than in production.
--
-- ── SCOPE ────────────────────────────────────────────────────────────
-- One CHECK constraint on one column. No data is modified. No default is
-- changed — 'Europe/London' remains correct: it is a real IANA zone, it
-- satisfies this constraint, and it is what makes the single organisation
-- creation path (src/app/onboarding/page.tsx, which omits the column) safe.
-- No application code changes; there is no code path that writes this
-- column today.


-- ── Part 1 — PREFLIGHT (read-only; run FIRST, on the project being changed)
--
-- Every existing row must already satisfy the predicate, or ADD CONSTRAINT
-- will fail. Expected: offending_rows = 0.

select
  count(*) filter (
    where not (
      timezone = btrim(timezone)
      and btrim(timezone) <> ''
      and (timezone = 'UTC' or timezone like '%/%')
    )
  ) as offending_rows,
  count(*) as total_orgs
from public.organisations;

-- If offending_rows > 0, list them before going further. Expected: no rows.
select id, business_name, quote_literal(timezone) as stored_timezone
from public.organisations
where not (
  timezone = btrim(timezone)
  and btrim(timezone) <> ''
  and (timezone = 'UTC' or timezone like '%/%')
);


-- ── Part 2 — THE CHANGE (run only after Part 1 returns zero)

alter table public.organisations
  add constraint organisations_timezone_shape
  check (
    -- no leading or trailing whitespace, so ' Europe/London' cannot be
    -- stored as a distinct value the application would then reject
    timezone = btrim(timezone)
    -- not empty, and not whitespace-only
    and btrim(timezone) <> ''
    -- an Area/Location IANA id, or the explicitly-allowed 'UTC'.
    -- This is what keeps 'BST', 'EST', 'PST', 'CET', 'GMT' and friends out.
    and (timezone = 'UTC' or timezone like '%/%')
  );


-- ── Part 3 — VERIFICATION
--
-- See 2026-08-12_organisations_timezone_shape_verify.sql. Read-only; safe
-- to re-run at any time.


-- ── Part 4 — ROLLBACK
--
-- Instant and lossless: dropping a CHECK constraint modifies no data, and
-- the runtime fail-closed protection from PR #9 is unaffected either way.
--
--   alter table public.organisations
--     drop constraint if exists organisations_timezone_shape;
