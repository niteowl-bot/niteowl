-- Verify the booked-requires-appointment invariant.

-- (a) Constraint exists — expect one row.
select conname
from pg_constraint
where conname = 'leads_booked_requires_appointment';

-- (b) No violating rows — expect violating_rows = 0.
select count(*) as violating_rows
from public.leads
where status = 'booked' and appointment_datetime is null;

-- (c) Optional negative test — this INSERT must FAIL with a check-violation.
-- Replace <org-uuid> with a real organisations.id, then run inside a
-- transaction you roll back so nothing is persisted:
--
--   begin;
--   insert into public.leads (org_id, status) values ('<org-uuid>', 'booked');
--   -- expected: ERROR: new row for relation "leads" violates check constraint
--   --           "leads_booked_requires_appointment"
--   rollback;
