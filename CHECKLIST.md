# 🚀 Alpha Launch Readiness

## 🔴 Billing (Phase 1 — Stripe, code complete, setup outstanding)
- [x] Run the billing migration SQL against Supabase (2026-07-06 — **correction, same day**: the "single Supabase instance for dev and production" claim below was wrong. The migration had actually only ever been applied to a separate dev/test project (`kioljdihgbcboxlnwghv`) referenced by `.env.local` — real production (`sklcqvvnuigpewzarbiv`) never had it, meaning every widget/dashboard chat request was failing outright. Re-applied directly to the real production project; both existing orgs there grandfathered to `active`. See CHANGELOG for how this was discovered and confirmed.)
- [ ] Add Stripe **test-mode** API keys to `.env.local` (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`) and create a test Product/Price for the flat plan
- [ ] Enable Card + Apple Pay + Google Pay under the Stripe Dashboard's payment methods so Checkout shows all of them
- [ ] Add a test-mode webhook endpoint in Stripe pointing at `/api/webhooks/stripe`, copy the signing secret into `STRIPE_WEBHOOK_SECRET`
- [ ] Verify end-to-end: subscribe via Checkout, confirm `organisations.subscription_status` flips to `active`; cancel via the billing portal, confirm it flips to `canceled` and Remy pauses
- [x] Deployed to production (2026-07-06) — the billing gate is live; existing orgs are unaffected since they're grandfathered `active`, and new orgs get a 14-day trial by default
- [ ] Swap to live Stripe keys + a live Product/Price only once ready to actually charge businesses

## 🔴 Critical (must complete before first business)
- [x] Deploy to production (Vercel + production Supabase)
- [x] Connect a custom domain
- [x] Configure production environment variables — confirmed correct (2026-07-06): `RESEND_FROM_EMAIL` was found still set to the old sandbox address despite being "configured" earlier, and has now been corrected directly in Vercel; verified via a real send
- [x] Run a complete production booking flow against the real production Supabase project (`sklcqvvnuigpewzarbiv`) — the version originally checked off here was mistakenly run against a different dev/test project; redone and confirmed correct (2026-07-06)
- [x] Email booking confirmations — fully verified end-to-end against real production (2026-07-06): correct date stored, both customer and owner emails sent from `remy@mail.niteowlhq.com`, owner copy confirmed `delivered` via Resend's own API
- [x] Customer cancellation/reschedule links (self-service notification emails had the same fire-and-forget issue — fixed alongside booking confirmations)
- [x] Needs-review owner notification emails — fixed (2026-07-08): a message combining a genuine question/complaint with contact details in the same turn was classified as `contact_update`, which skipped the confidence check entirely, so the owner was never notified even though Remy told the customer a team member would follow up; see CHANGELOG
- [x] Basic monitoring (logs and alerts) — Sentry + `/api/health` shipped 2026-07-04, `NEXT_PUBLIC_SENTRY_DSN` confirmed live in Vercel prod env; external uptime pinger configured against `/api/health` by the owner (2026-07-08) — `/api/health` re-verified responding `200` (`{"status":"ok","database":"ok"}`) at setup time

## 🔴 Critical infrastructure bugs found and fixed (2026-07-06)
- [x] **Real production was running against a completely different, un-migrated Supabase project than everything tested against all session** — discovered while investigating why sales chat capture failed in production. Confirmed by extracting the real project ref straight out of the production login page's compiled JS. The real project was missing both the billing migration and the new `sales_leads` table; the missing billing columns meant every widget/dashboard chat request was failing at the very first query. Both migrations re-applied to the correct project.
- [x] **Booking confirmation and self-service cancel/reschedule emails were fire-and-forget**, which is unsafe on Vercel's serverless runtime (the function can freeze right after the response is sent, killing unawaited work) — worked fine locally, silently failed in real production. Fixed using Next.js's `after()` across all 4 call sites.
- [x] **Every `resend.emails.send()` call site ignored the SDK's returned `error` field**, which is how the SDK reports API-level failures (it resolves normally instead of throwing) — meaning a real send failure was silently treated as success everywhere. Fixed with a shared `sendChecked()` helper that surfaces the error properly.
- [x] **`RESEND_FROM_EMAIL` in real production was still the Resend sandbox address** (`onboarding@resend.dev`), despite appearing "configured" — it had only ever been added as a sibling of two genuinely new variables, never actually edited itself. This, not a wrong API key or account, was the real reason emails were failing in production. Corrected directly; confirmed via a real delivered send.
- [x] **Relative booking times ("tomorrow at 2pm") could be silently booked on the wrong date** on the public widget (the real customer-facing path) — the widget's lead-extraction prompt had drifted out of sync with the dashboard's and was missing the "return the date exactly as the customer said it" instruction, so the model resolved it itself using a stale internal calendar before the real current date was ever applied. Fixed by resyncing the two prompts; re-verified a real booking now stores the correct date.
- [x] Audited all existing leads (in the correct production project) with a stored appointment time for the same date-corruption pattern — zero affected, no live customer data was corrupted
- [x] Full real-production re-verification after all fixes: booking (correct date + delivered emails) and sales chat demo capture (all 5 fields + delivered notification) both confirmed working end-to-end

## 🟢 Sales chat (marketing site conversion, 2026-07-06)
- [x] Persuasive, outcomes-first sales chat on the landing page, separate persona/system from Remy-as-receptionist
- [x] Objection handling for the 5 most common pushbacks
- [x] Industry personalization (reusable prompt structure, verified against 7 industries including one not explicitly listed)
- [x] Structured, validated, one-field-at-a-time demo lead capture with correction support and cross-session duplicate prevention
- [x] Admin-only `/admin/sales-leads` CRM view + team email notification on completed leads
- [x] Closing CTA — free trial for ready visitors, demo flow for those still deciding
- [x] Fixed (2026-07-07): a returning visitor's permanent `localStorage` conversation id could match an already-completed demo lead, causing Remy to confirm a booking using stale data instead of collecting fresh details — see CHANGELOG. **Superseded (2026-07-08, round 6):** this only excluded *completed* leads; a lead abandoned mid-flow (never confirmed) was still reusable and caused the same class of bug. `localStorage` persistence for the conversation id was removed entirely — see below.
- [x] Fixed (2026-07-07): mobile input font-size (14px) was below iOS Safari's auto-zoom threshold, clipping chat content on focus — see CHANGELOG
- [x] Fixed (2026-07-07): an objection or tangential reply mid-collection could make Remy drop the pending field request entirely; field collection guidance is now an explicit override — see CHANGELOG
- [x] Added (2026-07-07): a demo request now requires explicit visitor confirmation of a full recap before being marked complete or triggering the team notification — see CHANGELOG
- [x] Fixed (2026-07-08): the page behind the chat widget could be scrolled while the widget was open (confirmed via a real device recording, then reproduced precisely: `window.scrollY` moved on a background wheel-scroll with the chat open); now locked and restored correctly on close — see CHANGELOG
- [x] Fixed (2026-07-08, round 3): root cause of mobile message clipping identified and deterministically reproduced/fixed — an interrupted stream (dropped before the server's completion sentinel arrived) left partial text stuck displayed as final, with no error. Now retries once automatically, falls back to a visible error only if that also fails. Verified via forced stream-truncation test, not inferred — see CHANGELOG. Confirmed by the reporter on a real device that this resolved the flow-completion issue.
- [x] Fixed (2026-07-08, round 4): after round 3, the reporter's real Samsung device showed a *different*, more specific issue — the last assistant message rendering partially behind the fixed CTA/composer. Root cause: missing `min-h-0`/`shrink-0` flexbox properties, an engine-dependent overflow bug. Fixed and verified via precise overlap measurement (not just visual screenshot check) across 5 viewport/font-scale configurations including simulated Android "larger text" accessibility settings — see CHANGELOG. Confirmed by the reporter: layout clipping resolved on Chrome for Android.
- [x] Fixed (2026-07-08, round 5): real-device testing after round 4 isolated two remaining **browser-specific** bugs — (1) Chrome for Android's auto-dark-theme left input text nearly invisible (no explicit color/background on the input); (2) Samsung Internet specifically still clipped messages, traced to the completion-sentinel check only inspecting each network chunk in isolation rather than the accumulated text, so a sentinel split across two chunks (plausible given different browsers chunk streams differently) was never detected. Both fixed and deterministically verified (dark-color-scheme emulation for the input; a raw controlled-chunking HTTP server for the sentinel bug, since Playwright's route interception can't simulate real chunk boundaries) — see CHANGELOG. Still pending final confirmation from Samsung Internet specifically (no way to test that engine directly in this environment).
- [x] Fixed (2026-07-08, round 6): **critical** — a fresh-looking chat (empty message list) could silently resume an old, still-open (never-confirmed) lead from a totally different past visit, greeting the visitor by a stale name and referencing a company they never mentioned. Root cause: the conversation id was persisted in `localStorage` indefinitely, but the visible message list never was — always starting empty regardless, masking the fact that the server was continuing an old conversation. Fixed by making the id in-memory-only per page load (no `localStorage` at all), plus proactively clearing the old key for browsers that already had one cached. Reproduced and verified against the dev database with a deliberately seeded stale lead — see CHANGELOG.
- [x] Fixed (2026-07-08, round 7): field extraction could silently drop a message on timeout/error (confirmed via a real production log entry) with no visible error, preventing the booking from ever completing; and the booking could be reported complete even if the team notification failed to send. Extraction now retries and returns a genuine failure signal instead of a false "nothing stated"; notification-sending now happens atomically with the completion transition, so the visitor is only told the booking is complete once the notification actually sent — a failure keeps the lead open and asks for one more confirmation, which naturally retries. Verified directly against the real function (retry) and a real temporarily-broken notification config (gating) — see CHANGELOG.
- [x] Fixed (2026-07-08, round 8): **root cause of the intermittent missing demo notifications** — the field extractor had no conversation context, so bare answers ("Poiu" for company, gibberish names) were sometimes silently dropped, leaving the flow stuck collecting while the reply model claimed the booking was complete; the "Chrome vs Samsung" pattern was coincidence. Extractor now receives the pending field (from lead state) or the previous assistant message (opening name turn). Verified 7/7 E2E runs under both browsers' user-agents plus owner's real-device confirmation on both — see CHANGELOG. **This build is the frozen pilot baseline**; sales-chat diagnostic logging deliberately left live for the pilot.
- [x] Cleaned up (2026-07-08): the five 2026-07-08 production test leads (`priya@brightsmiles.co.uk`, `claude-diag-test@example.com`, `Dean@huy.com`, `Ernie@samsiming.com`, `Lupo@lup.com`) deleted from the real production `sales_leads` table via a temporary, token-gated ops endpoint that matched only these exact ids/emails (verified each row's content matched expectations before deleting, confirmed zero remaining after, then removed the endpoint). No genuine customer leads existed in production at the time.
- [ ] Owner's own manual pass of the authenticated `/admin/sales-leads` view (assistant verified the unauthenticated redirect and the underlying data directly, but not the authenticated render — no access to real login credentials)

## 🟢 Pre-alpha security & reliability audit (2026-07-06)
- [x] Full-codebase audit ahead of external alpha (security, performance, reliability, production-readiness)
- [x] Fixed: unescaped user input in transactional emails (HTML injection into business-owner-facing notification emails)
- [x] Fixed: `/api/chat` lead-capture/knowledge-base access still used an unverified client-supplied `orgId` after a spoofed org lookup returned null (the 2026-07-04 fix only patched the lookup, not the write path)
- [x] Fixed: `/api/chat` had no rate limiting (unlike the other two chat routes) — unbounded OpenAI cost-abuse risk on a no-card-required signup
- [x] Fixed: `/api/bookings/manage` had no rate limiting — a leaked/guessed manage_token could trigger unlimited notification emails
- [x] Fixed: SSRF hardening gap in `/api/widget/verify-install` (DNS-rebinding and redirect-based bypass of the private-IP/localhost check, including the cloud metadata address)
- [ ] `/api/leads` route is dead code (zero callers) with an incomplete status whitelist — flagged, not removed; decide whether to wire it up or delete it

## 🟡 Business onboarding
- [x] Widget installation guide (WordPress, Wix, Squarespace, Shopify, Webflow, HTML, Google Tag Manager) — `Settings → Website Widget`, 2026-07-06, includes a live "verify installation" check
- [ ] Dashboard "Getting Started" guide
- [ ] Test the widget on several real websites
- [x] Verify email deliverability (2026-07-06 — `mail.niteowlhq.com` verified with Resend, `RESEND_FROM_EMAIL` switched to `remy@mail.niteowlhq.com`; confirmed via a real end-to-end send with SPF/DKIM passing and a real booking's confirmation emails checked via Resend's own send log)

## 🟡 Admin
- [ ] Business management view
- [x] Verify backups — enabled by the owner (2026-07-08) on the production Supabase project (`sklcqvvnuigpewzarbiv`) via the dashboard; a Supabase-side setting, no code/config change in this repo
- [ ] Export data capability
- [x] Privacy Policy (2026-07-06 — `/privacy`, tailored to what the app actually collects/processes; not a substitute for a real legal review, but a solid, specific draft rather than generic boilerplate)
- [x] Terms of Service (2026-07-06 — `/terms`, same caveat)
- [x] Linked from the footer (already referenced there), the signup page's existing agreement notice, the sales chat, and the embeddable customer-facing widget (absolute URL, since it renders on third-party sites)

## 🟡 Voice AI (Phase 2, Step 1 — code complete 2026-07-09, dark until setup below is done)
- [x] Additive voice platform merged: `/api/voice/webhook` + `/api/voice/incoming`, adapter layer (`src/lib/voice/`), durable idempotent event ingestion, lead capture with source `voice` through the existing engine, owner call-summary emails. Kill switch `VOICE_ENABLED` keeps it all 404 until deliberately enabled — deploying is safe with zero production behaviour change
- [x] Run `docs/sql/2026-07-09_voice_tables.sql` in the Supabase SQL editor on the **dev/test project** (`kioljdihgbcboxlnwghv`) — done 2026-07-09, tables verified present
- [x] Run `docs/sql/2026-07-09_leads_source_voice.sql` on the **dev/test project** — done 2026-07-09; constraint confirmed rebuilt with `'voice'` included (dev testing had proved `leads_source_check` really does reject `'voice'`)
- [ ] Run BOTH SQL files on **real production** (`sklcqvvnuigpewzarbiv`) — do not conflate the two projects (see 2026-07-06 incident)
- [ ] Complete Step 0 (Vapi account, spend cap, browser-call prototype — see docs/VOICE_AI_PLAN.md) if not already done
- [ ] In Vapi: set the phone number / assistant server URL to `<app-url>/api/voice/incoming`, set the server-URL secret, and put the same value in `VAPI_WEBHOOK_SECRET`
- [ ] Insert a `voice_settings` row for the test org (phone_number in E.164, enabled=true)
- [ ] Set `VAPI_WEBHOOK_SECRET` + `VOICE_ENABLED=true` in the target environment (Vercel) only after the SQL has run
- [ ] Live end-to-end test call: Remy answers with KB knowledge, call row lands in `voice_calls`, lead created with source `voice`, owner receives the summary email
- [x] Verify a phone booking flows through the existing engine — **verified via full dev simulation (2026-07-09)**: simulated end-of-call report → raw event stored + deduplicated → `voice_calls` row with cost → lead created with source `voice` (caller ID as phone, "tomorrow at 2pm" parsed to the correct Europe/London ISO datetime, status `booked` after the availability/capacity checks, `manage_token` issued) → lead linked back to the call → owner booking-confirmation + call-summary emails accepted by Resend (customer copy correctly skipped, phone-only caller). All test rows deleted afterwards; still needs re-confirming with a real Vapi call (item below)
- [x] Confirm whether `leads.source` has a CHECK constraint blocking `'voice'` — **it does** (`leads_source_check`, confirmed via a real dev-project insert failure 2026-07-09); fix is `docs/sql/2026-07-09_leads_source_voice.sql`, tracked above

## ⚪ Version 2
- [x] Voice AI — in progress; moved to its own Phase 2 section above
- [ ] Google Calendar
- [ ] Outlook Calendar
- [ ] Multi-staff scheduling
- [ ] Stripe subscriptions
- [ ] SMS reminders
- [ ] Analytics dashboard

## 🎯 Pilot Customers
- [ ] Identify 10 local businesses
- [ ] Recruit first 3 pilot users
- [ ] Install widget on first live website
- [ ] Complete first real booking
- [ ] Collect feedback
- [ ] Fix reported issues

## ⚪ Known issues (low priority, deferred — not blockers)
- [ ] **Dashboard preview chat swallows the error toast on a failed first message in a brand-new conversation.** `ChatShell.tsx` remounts `ConversationView` (via `key={activeId ?? "empty"}`) the instant a new conversation is created. If the AI call fails on that exact first message, `onError` fires after the remount and sets state on an already-unmounted instance, so no error message renders. The input is never stuck — the freshly-mounted instance starts clean and works immediately — this is a missed notification, not a crash or dead-end. Any later message in an established conversation shows errors correctly. Root cause and full detail in CHANGELOG.md, 2026-07-06 (AI-call reliability bundle). Deliberately not fixed yet — the real fix means revisiting `ChatShell`'s remount-on-conversation-switch strategy, which deserves its own deliberate pass rather than being folded into a reliability bugfix bundle.

