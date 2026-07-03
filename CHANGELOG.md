# Changelog

All notable changes to NiteOwl will be documented in this file.

## 2026-07-02

### Added
- Onboarding wizard (4 steps: business info, hours, knowledge base, widget embed) — fully tested end-to-end
- Website chat widget (`public/widget.js`) with public, unauthenticated `/api/widget/chat` route
- Dashboard chat preview at `/chat` — lets business owners test Remy using the exact same AI logic, booking engine, and knowledge base as the live widget, without needing to embed it
- `source` field threading through `streamChat()` and `/api/chat` so preview conversations can be tagged separately from real leads
- Business Hours settings page with per-day config, lunch breaks, and Max Concurrent Bookings
- `needs_review` lead status with an isolated confidence classifier — Remy now flags uncertain enquiries for business follow-up instead of guessing, without touching the booking flow

### Fixed
- Broken "Chat with Remy" dashboard link (was pointing to non-existent `/dashboard/chat`, now correctly points to `/chat`)
- Malformed `streamChat()` function signature in `lib/chat.ts` (missing destructuring separator)
- Lead-merge bug where unrelated customers could be merged into the same lead record

### Changed
- `leads_source_check` constraint updated to allow `dashboard_preview` as a valid source, keeping test/preview leads cleanly separated from real website leads in reporting
- `leads_status_check` constraint updated to allow `needs_review` (and `cancelled`, which was missing from the DB despite existing in the TypeScript type)

### Verified
- Full onboarding flow tested against a fresh Supabase account, confirmed correct data in `organisations`, `business_hours`, `business_knowledge`, and `onboarding_widget_step_seen`
- Dashboard preview chat confirmed to use identical booking/availability logic as the widget (correctly detected a fully-booked slot and offered an alternative)
- Confirmed preview leads land with `source: dashboard_preview`, distinct from real `chat` leads
- Confirmed a low-confidence question correctly creates a `needs_review` lead, and that a subsequent booking in the same conversation correctly overwrites it to `booked`

