# Changelog

All notable changes to NiteOwl will be documented in this file.

## 2026-07-04 (critical: business hours/capacity never enforced on the widget)

### Fixed
- `src/lib/availability.ts` created its own RLS-scoped (session-cookie) Supabase client internally in every function, regardless of caller. That's fine from an authenticated context (the dashboard preview chat), but the public website widget has no logged-in session — RLS silently returns zero rows rather than an error, and every check failed open on empty data: no `business_hours` rows read back → treated as always open; no matching `leads` found for a capacity count → treated as always available. **Business hours and capacity limits were never actually enforced for real widget bookings.** Undetected until now because every prior verification of these checks ran through the authenticated dashboard preview chat, which happened to have a valid session and masked the bug
- Switched `isWithinBusinessHours`, `isSlotAvailable`, and `findNextAvailableSlot` to the admin (service-role) client — safe because every query already manually scopes by an explicit `orgId` parameter, never a session, matching the existing pattern used by `getOrgOwnerEmail` and the widget route itself

### Verified
- Locally, against the dev database, via the live widget: a Sunday (marked closed for the test business) is now correctly rejected; booking the same slot twice against a business with `max_concurrent_bookings=1` now correctly offers the next available time instead of silently double-booking
- `tsc --noEmit` and `next build` pass

## 2026-07-04 (correction: booking status fix was incomplete)

### Fixed
- The earlier "booking status not flipping to booked on multi-turn bookings" fix, shipped and reported verified earlier today, did not actually work in all cases. `LEAD_SELECT_COLUMNS` in `src/lib/leadCapture.ts` never included `appointment_datetime` in its query, even though the `LeadRow` type declared the field and the merge logic reads `existing.appointment_datetime` — TypeScript couldn't catch it since `LeadRow` is hand-written, not derived from the query. At runtime the field was always `undefined`, so the "was a time already confirmed" check could never pass. Reproduced locally against the dev database (a two-turn booking landed as `status: "new"` despite Remy confirming it to the customer) and confirmed fixed after adding the column to the select

### Note
- This corrects the "Verified" claim in the earlier 2026-07-04 production-deployment entry below — that verification pass was mistaken. Treat this entry as the accurate record for this bug

## 2026-07-04 (hydration fix)

### Fixed
- React hydration mismatch (minified error #418) on `/leads` and `/calendar`, flagged as a known issue in the production verification session earlier today. Root cause: `Intl.DateTimeFormat` calls in `LeadsTable.tsx` and `CalendarView.tsx` never pinned a `timeZone`, so they used the runtime's own default — UTC on Vercel, the visitor's local zone in the browser — meaning the server-rendered date/time text disagreed with the client's hydration render on every load. Every other date formatter in the codebase (`src/lib/email.ts`, `src/lib/availability.ts`) already pins `Europe/London`; these two were the exception
- Narrower version of the same bug in `CalendarView.tsx`: the "is this today" highlight called `new Date()` directly during render, which can resolve to a different calendar day server vs. client for about an hour a day during BST. Added `getLondonToday()`, which derives "today" from Europe/London's date parts so it resolves identically regardless of which machine renders it

### Verified
- `tsc --noEmit` and `next build` pass
- Re-ran the browser check against production: no console/page errors on `/leads` or `/calendar`; calendar's "today" highlight and the booked-lead colour coding still correct

## 2026-07-04 (production deployment + browser verification)

### Deployed
- First production deployment live at `https://niteowl-pi.vercel.app/` (Vercel + production Supabase project, separate from the local dev Supabase project)

### Fixed
- Supabase Auth "Site URL" / Redirect URLs were still pointing at `localhost:3000`, so every real signup's confirmation email link redirected to a dead local address instead of the production domain — email confirmation was completely broken for new signups until this was corrected in the Supabase dashboard
- Booking status not flipping to `booked` (and confirmation email never sending) when a customer supplies contact details in a follow-up message rather than the same message as the booking request: `extractLeadData()` classifies intent per-message with no conversation history, so that follow-up reads as `contact_update` instead of `new_booking`. `capturePartialLead()`'s merge logic (`src/lib/leadCapture.ts`) now also confirms the booking when a `contact_update` turn supplies contact info for a lead that already has a resolved appointment time — matches what Remy was already telling the customer in the chat reply

### Verified (browser-based, against the live production site)
- Landing, login, and signup pages render correctly with no console errors; widget bootstrap script (`/widget.js`) serves correctly
- `NEXT_PUBLIC_APP_URL` resolves correctly in production — the widget embed snippet shown in onboarding correctly points at the production domain, not localhost
- Full signup → email confirmation → login → 4-step onboarding (business info, hours, knowledge base, widget embed) completed end-to-end with a real account and no errors
- Website widget embedded in a standalone host page and driven through a real two-turn booking conversation against the live `/api/widget/chat` — after the fix above, the lead correctly reaches `booked` status and the confirmation email path fires

### Known issues (not yet fixed)
- Minified React error #418 (hydration mismatch) observed in the browser console on `/leads` and `/calendar` — did not visibly break rendering in this session, but not yet root-caused
- Browser tab title reads the default "Create Next App" on all pages (root layout metadata was never overridden) — cosmetic, no functional impact
- A prompt injection was found planted in `node_modules/next/dist/docs/index.md` (a hidden HTML comment instructing an "AI agent" to read a further file before making changes) — not acted on; worth a clean reinstall from the lockfile to confirm it isn't reproduced by a legitimate `next` release

## 2026-07-04 (lint cleanup)

### Fixed
- 12 of 13 pre-existing ESLint errors ahead of production deployment: escaped raw quotes/apostrophes in JSX text (landing page, dashboard, widget settings, calendar, chat welcome), replaced the auth layout's plain `<a href="/">` with `next/link`, and typed `initialRecords` with the existing `KnowledgeRecord` type instead of `any` — no rendered output or behaviour changes
- Remaining, deliberately untouched: `react-hooks/set-state-in-effect` in `ConversationView.tsx` (fixing it requires refactoring the working dashboard chat UI — parked post-Alpha) and 6 unused-variable warnings; none of these block `next build` or deployment

### Verified
- `npm run lint` down from 13 errors/6 warnings to 1 error/6 warnings; `tsc --noEmit` and `next build` both pass

## 2026-07-04 (Step 3 — widget needs-review)

### Added
- Needs-review workflow extended to the website widget (`/api/widget/chat`): confidence check, human-handoff replies, `needs_review` lead capture, and the once-per-conversation owner notification now run through the exact same engine as the dashboard chat
- Shared `src/lib/leadCapture.ts` — the lead-capture engine (extraction types, merge guards, layered lead resolution, `assessAnswerConfidence`, `capturePartialLead`, needs-review notification dedup) moved verbatim out of `/api/chat` so both routes reuse one system; route files now export only handlers
- Widget conversation linking: the widget's client-generated conversation id is UUID-validated and org-scoped before use, and persisted to `conversations`, so widget leads merge correctly across messages and cross-org ids are discarded

### Changed
- Widget lead capture replaced its inline insert-only logic with the shared `capturePartialLead()` engine — lead merging, availability/capacity checks, and booking confirmation emails are now identical to dashboard chat

### Verified
- Five-point widget suite against the live API (Test Plumbing Co): (1) uncovered question without contact → handoff reply asking for details plus a `web_widget` `needs_review` lead; (2) contact provided in the same conversation → status preserved and exactly one owner email; (3) repeated contact → no duplicate email (dedup skip logged); (4) new conversation from the same customer → merged into the same lead with a fresh notification; (5) supported-service booking → `booked` lead, flow unaffected. All test rows removed afterwards
- `tsc --noEmit` and `next build` pass; `/api/chat` auth gate intact (401 unauthenticated)

## 2026-07-04

### Added
- Needs-review notification deduplication — the owner email is now sent once per review episode, tracked in the lead's `metadata` JSONB (`needs_review_notification_sent` plus `needs_review_notified_conversation_id`)
- Human handoff reply when contact details are already provided with a low-confidence enquiry — Remy now thanks the customer and confirms a team member will review, and never implies an unsupported service is offered, asks for a preferred time, or re-asks for contact details
- `sendNeedsReviewNotification()` now returns whether the send succeeded, so the dedup flag is only recorded after a real send
- `capturePartialLead()` now returns the lead id on the merge path (previously `null`), enabling the metadata flag to be stamped on merged leads

### Fixed
- Needs-review emails being permanently suppressed for returning customers: leads merge across conversations by contact details, so a lead-lifetime dedup flag silenced all future notifications — dedup is now scoped per conversation
- Ask-then-provide handoff flow (Step 2): when Remy asked for contact details and the customer supplied them, the `contact_update` merge silently downgraded the lead from `needs_review` to `new`, never sent the owner notification, and replied in booking mode — the merge now preserves `needs_review` (confirmed bookings still overwrite it), sends the pending notification through the same conversation-scoped dedup, and replies with the human-handoff message

### Data
- Seeded 10 realistic `service` knowledge records for Test Plumbing Co so supported vs unsupported service paths can be tested (database only, no code change)

### Verified
- Low-confidence enquiry with contact details sends exactly one owner email per conversation, replies with the human-handoff message, and sends again for a new conversation from the same customer
- Supported-service booking flow and the ask-for-contact handoff behave exactly as before (prompt is byte-identical outside the new needs-review path)
- Step 2 five-point suite run end-to-end against the live API as the org owner, plus manual inbox checks: (1) ask-then-provide keeps `needs_review`, sends one owner email, replies with handoff; (2) repeated contact in the same conversation sends no second email; (3) a booking in the same conversation still flips `needs_review` → `booked` with confirmation emails; (4) clean supported-service booking unaffected; (5) contact-details-first flow unaffected

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

