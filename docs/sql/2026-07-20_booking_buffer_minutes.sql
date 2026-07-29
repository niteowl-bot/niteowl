-- Calendar & Appointment Management, Step 2 — booking buffer time
-- (2026-07-20). Additive only — one nullable-with-default column.
--
-- Run manually in the Supabase SQL editor, per this repo's convention (no
-- migrations folder). Run on BOTH projects:
--   dev:  kioljdihgbcboxlnwghv
--   prod: sklcqvvnuigpewzarbiv  (NOT reachable locally at all)
--
-- Safe on the live database: IF NOT EXISTS + a default of 0 means every
-- existing row backfills to "no buffer", i.e. exactly today's behaviour —
-- zero change for any org until one deliberately sets a buffer.
--
-- Why: Step 2 reads real-time availability from a connected Google
-- Calendar. When a business wants a gap between appointments (travel time
-- between jobs, cleanup, etc.), booking_buffer_minutes widens the window a
-- requested slot is tested against the calendar's busy events, so a new
-- appointment can't be booked flush against an existing calendar event.
-- Applied to the calendar free/busy check in src/lib/availability.ts;
-- the internal exact-slot capacity check (max_concurrent_bookings) is
-- unchanged. Default 0 = no buffer.

alter table public.organisations
  add column if not exists booking_buffer_minutes integer not null default 0;
