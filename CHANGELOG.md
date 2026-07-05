# Changelog

All notable changes to NiteOwl will be documented in this file.

## 2026-07-05 (business profile: website field, and a still-incomplete confidence check)

### Fixed
- **Remy couldn't answer "What is my website?"** — the org's `website` column was never selected in either `/api/chat` or `/api/widget/chat`, so it was absent from both the system prompt's identity block and the confidence-check's identity summary (the same class of gap fixed for business name/type/description earlier today, just not fully closed). Added `website` to both routes' org `select()`, `buildSystemPrompt`'s identity section, and the confidence-check identity summary
- While fixing this, found the earlier identity-summary fix was also incomplete: it included business name/type/description but not `primary_goal`, meaning "What is my primary goal?" would have hit the same handoff bug. Added it alongside `website` so the confidence check now sees every identity field the main system prompt does, rather than fixing them one report at a time

### Verified
- `tsc --noEmit` and `next build` pass
- Ran all five business-profile questions end-to-end against a disposable test org (real auth, real OpenAI, dev DB, then deleted): business name, business type, website, a full description, and primary goal all now answer directly and correctly instead of escalating to human handoff
- Applied identically to both `/api/chat` and `/api/widget/chat`

## 2026-07-05 (removed stray internal Next.js import)

### Fixed
- Removed an unused `import { loadComponents } from "next/dist/server/load-components"` from `src/app/(dashboard)/chat/page.tsx` — present since the file was created (2026-06-29), never called anywhere. Reaching into Next.js internals like this isn't something legitimate app code does; flagged as suspicious given it lines up with the planted prompt-injection already found in `node_modules/next/dist/docs`. No behaviour change — the import had no effect either way

### Verified
- `tsc --noEmit` and `next build` pass

## 2026-07-05 (critical: business identity questions wrongly routed to human handoff)

### Fixed
- **Remy couldn't answer basic questions about the business itself** (e.g. "What is my business called?") — always replied as if it had no idea and handed off to a human, even though the business name/type/description are injected into the main system prompt. Root cause was two-layered in `assessAnswerConfidence()` (`src/lib/leadCapture.ts`), the low-confidence gate that runs before the real reply is generated:
  1. The gate only ever saw `business_knowledge` (FAQ/pricing/hours/policy) rows — never the org's own identity fields (name, type, description) — so it had no way to know those were answerable. Fixed by fetching the org row earlier in both `/api/chat` and `/api/widget/chat` (previously fetched only afterward, purely for the final system prompt) and folding business name/type/description into the same knowledge summary the confidence check reads
  2. Even after adding identity info to the summary, the gate's prompt still misfired — it's framed around "the customer's question," and a question phrased as "my business" was interpreted by the model as the *customer's own business* rather than the business Remy represents, so it stayed classified as unanswerable. Added an explicit rule clarifying Remy is the receptionist *for* the business described, so questions about that business's own identity are always answerable
- Traced end-to-end before touching anything: confirmed via direct OpenAI calls that the first fix alone (identity data present in the knowledge summary) was not sufficient — the gate still returned `needsReview: true` for "What is my business called?" — before finding the actual framing issue in the prompt wording itself

### Verified
- `tsc --noEmit` and `next build` pass
- Reproduced the exact broken reply locally against a disposable test org (real auth, real OpenAI, dev DB), confirmed the fix resolves it ("Your business is called Claude Debug Co Two.") and confirmed the underlying business-type question also now answers correctly
- Regression-checked that genuinely undocumented questions (e.g. an unlisted discount policy) still correctly trigger the human-handoff path — the confidence gate's core purpose is intact, only the business-identity blind spot was fixed
- Applied identically to both `/api/chat` and `/api/widget/chat` per the project rule that dashboard preview and the website widget must share identical AI behaviour
- Test user/org used for verification deleted afterward; no leftover data

## 2026-07-05 (www redirect + critical dashboard chat fix)

### Added
- `www.niteowlhq.com` now permanently redirects (308) to `niteowlhq.com` via a host-matched redirect in `next.config.ts`, rather than relying on dashboard-only Vercel config — keeps the canonical domain in code

### Fixed
- **Critical: the dashboard preview chat (`/chat`) never showed Remy's reply for some messages.** Root cause in `src/lib/chat.ts`'s `streamChat()`: the client reads the response body in raw chunks and watches for a trailing `\n__DONE__` marker the server appends after the last token. If a chunk contained the marker, the code called `onDone(fullText)` using only the text accumulated from *previous* chunks — any of the assistant's reply text that arrived in the same chunk as the marker was silently dropped. Short replies (e.g. the low-confidence "a team member will follow up" handoff message) are the most likely to be fully flushed in a single chunk over Vercel's network, which is exactly the path seen in production logs right before this was reported. `public/widget.js`'s equivalent client-side logic already handled this correctly (`fullText += chunk.split("__DONE__")[0]`) — `chat.ts` now matches that proven pattern instead of dropping the pre-marker text
- Traced end-to-end before fixing: confirmed `/api/chat` auth, lead extraction, and OpenAI streaming all work correctly server-side (verified against the dev DB with a real authenticated session and real OpenAI streaming, both under `next dev` and a local production build) — the bug was isolated to this one client-side parsing gap, not the API route, Supabase, or OpenAI

### Verified
- `tsc --noEmit` and `next build` pass
- Reproduced the real `/api/chat` request/response end-to-end locally (real auth cookie, real org, real OpenAI streaming) and confirmed the server always sends the final token(s) and `\n__DONE__` correctly — confirms the fix in `chat.ts` (not a server-side change) is the correct and sufficient repair
- Test user/org created for this verification were deleted afterward; no leftover data

## 2026-07-05 (custom domain connected)

### Added
- `niteowlhq.com` and `www.niteowlhq.com` added to the `niteowl` Vercel project (DNS: two `A` records at Porkbun pointing to Vercel's edge, `76.76.21.21`), certs issued and auto-renewing. Production `NEXT_PUBLIC_APP_URL` updated from the `niteowl-pi.vercel.app` placeholder to `https://niteowlhq.com`, followed by a redeploy (no code changes) so the new value takes effect — this is what the widget embed snippet and any server-side links derive from
- Supabase Auth Site URL and Redirect URLs updated to `niteowlhq.com` (previously only `localhost`/the `.vercel.app` URL were allow-listed) — same class of bug as the 2026-07-04 production-deployment entry, where Supabase silently falls back to the Site URL whenever the app's requested `redirectTo` isn't in the allow-list

### Verified
- `/api/health`, `/widget.js`, `/`, `/login`, `/signup`, `/auth/callback` all return correct responses over HTTPS on both `niteowlhq.com` and `www.niteowlhq.com`; plain HTTP correctly 308s to HTTPS
- Confirmed via code (`signup/page.tsx`, `login/page.tsx`) that `emailRedirectTo`/`redirectTo` are built from `window.location.origin`, so a visitor on the new domain automatically requests the correct redirect target — not independently verified by reading an actual confirmation email (no inbox access from this session); a real signup on `https://niteowlhq.com` should be done once to confirm the email link lands on the new domain
- `www` currently has no redirect to/from apex configured (both serve the site directly) — deliberately left both live rather than pick a primary; can add a redirect either direction on request

## 2026-07-04 (basic monitoring: error tracking + uptime health check)

### Added
- `@sentry/nextjs` wired up with the built-in `captureConsoleIntegration`, which reports every existing `console.error(...)` call across the codebase as a Sentry event with email alerting — no changes needed at any of the 28+ existing call sites in `leadCapture.ts`, `email.ts`, `availability.ts`, etc. Kept intentionally minimal: `tracesSampleRate: 0` (error tracking only, no performance tracing), console capture restricted to the `"error"` level so informational logs don't burn through the free-tier event quota
- Public `/api/health` endpoint that checks real database connectivity (not just "the Next.js process is up"), meant to be pinged by an external uptime monitor (e.g. UptimeRobot, Better Uptime — free tier, external signup, not something committed to the repo)

### Verified
- Triggered a real `console.error` path locally (an invalid widget key) and confirmed the Sentry alert arrived
- `tsc --noEmit` and `next build` pass

### Action needed (outside this repo)
- `NEXT_PUBLIC_SENTRY_DSN` must be added to Vercel's production environment variables for alerting to work there — it's in `.env.local` for dev only, not committed
- An external uptime pinger should be pointed at `/api/health` for the "alerts" half of monitoring to actually notify anyone

## 2026-07-04 (customer cancellation/reschedule links)

### Added
- Every booking now gets a `manage_token` (random UUID), and the customer confirmation email links to `/booking/manage?token=...` instead of just saying "contact the business directly." The page is public (no login), following the same identity-via-opaque-secret pattern as the widget's `widget_key`: view the booking, cancel it, or reschedule via a structured date/time picker (deterministic, not free-text/AI-parsed, so it doesn't depend on OpenAI for a self-service write action)
- New `/api/bookings/manage` route: `GET` returns the booking plus business hours for the picker; `POST action=cancel` sets status to `cancelled`; `POST action=reschedule` re-validates the new time against the same business-hours and capacity checks a new booking goes through, offering the next available slot if the requested time is full
- Either action emails the business owner (`sendBookingSelfServiceChangeNotification`) so a change the customer makes themself isn't a surprise they only discover by checking the dashboard
- Scoped to `status="booked"` leads only; an already-cancelled booking shows a read-only "already cancelled" state if the link is reused

### Fixed
- **Critical, found while testing the above**: `src/lib/availability.ts` created its own RLS-scoped (session-cookie) Supabase client internally, regardless of caller. That's fine from an authenticated context (the dashboard preview chat), but the public website widget has no logged-in session — RLS silently returns zero rows rather than an error, and every check failed open on empty data. **Business hours and capacity limits were never actually enforced for real widget bookings** — every request was silently approved regardless of day, time, or existing capacity. Undetected until now because every prior verification of these checks ran through the authenticated dashboard preview chat, which masked the bug. Switched to the admin (service-role) client, which every query already scopes manually by an explicit `orgId` parameter
- The multi-turn booking-status fix from earlier today (`isBookingCompletedByContactUpdate`) could never actually fire: `LEAD_SELECT_COLUMNS` never included `appointment_datetime`, so `existing.appointment_datetime` was always `undefined` at runtime despite the `LeadRow` type claiming otherwise. Added the missing column to the select

### Investigated, not a code bug
- Real production emails (booking confirmation, owner notification, self-service change) currently only ever reach the Resend account owner's own inbox, regardless of the intended recipient — confirmed via Resend's dashboard logs. Root cause: `RESEND_FROM_EMAIL` is still the shared, unverified `onboarding@resend.dev` sandbox sender; Resend redirects all sends to the account owner until a custom sending domain is verified. **No real customer will receive a booking email until a custom domain is verified in Resend and set as the sender.** This is why "Verify email deliverability" was still unchecked on the launch checklist — tracked there, not something to fix in code

### Verified
- Tested locally end-to-end against the dev database: book via widget → manage page shows the correct booking → reschedule to a valid slot succeeds and updates `appointment_datetime` → reschedule to a closed day is correctly rejected → reschedule to a fully-booked slot is correctly rejected and offers the next slot → cancel works and is idempotent on reload
- Re-verified the business-hours/capacity fix directly against the live widget: a closed day is now rejected, and double-booking the same slot now correctly offers the next available time instead of silently succeeding
- `tsc --noEmit` and `next build` pass

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

