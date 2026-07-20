-- Verification for 2026-07-20_booking_buffer_minutes.sql.
-- Run AFTER that script, as its own query, on BOTH projects. Read-only.

-- (1) Column must exist, integer, not null, default 0. Expected: 1 row.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'organisations'
  and column_name = 'booking_buffer_minutes';

-- (2) Every existing row backfilled to 0 (no behaviour change). Expected: 0 rows.
select id, booking_buffer_minutes
from public.organisations
where booking_buffer_minutes is null or booking_buffer_minutes <> 0;
