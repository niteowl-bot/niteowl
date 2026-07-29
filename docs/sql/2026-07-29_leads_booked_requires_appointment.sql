-- Enforce the invariant: a lead may only be status = 'booked' when it has a
-- saved appointment_datetime.
--
-- Why: the calendar renders a lead as an appointment ONLY when
-- appointment_datetime is set (src/app/(dashboard)/calendar/page.tsx filters
-- `.not("appointment_datetime","is",null)`). A 'booked' lead with no timestamp
-- is a confirmed-looking booking that never appears on the calendar.
--
-- Run in the Supabase SQL editor, dev first then prod, per the repo's
-- hand-run migration convention. Safe to re-run (idempotent).

-- 1) Clean any existing violating rows so the constraint can be added.
update public.leads
set status = 'needs_review'
where status = 'booked' and appointment_datetime is null;

-- 2) Add the CHECK constraint (guarded so re-runs don't error).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'leads_booked_requires_appointment'
  ) then
    alter table public.leads
      add constraint leads_booked_requires_appointment
      check (status <> 'booked' or appointment_datetime is not null);
  end if;
end $$;
