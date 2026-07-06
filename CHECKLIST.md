# 🚀 Alpha Launch Readiness

## 🔴 Billing (Phase 1 — Stripe, code complete, setup outstanding)
- [x] Run the billing migration SQL against Supabase (2026-07-06 — this project has a single Supabase instance for dev and production, confirmed via the real pilot business rows returned; migration applied and verified, all pre-existing orgs correctly grandfathered to `active`)
- [ ] Add Stripe **test-mode** API keys to `.env.local` (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`) and create a test Product/Price for the flat plan
- [ ] Enable Card + Apple Pay + Google Pay under the Stripe Dashboard's payment methods so Checkout shows all of them
- [ ] Add a test-mode webhook endpoint in Stripe pointing at `/api/webhooks/stripe`, copy the signing secret into `STRIPE_WEBHOOK_SECRET`
- [ ] Verify end-to-end: subscribe via Checkout, confirm `organisations.subscription_status` flips to `active`; cancel via the billing portal, confirm it flips to `canceled` and Remy pauses
- [x] Deployed to production (2026-07-06) — the billing gate is live; existing orgs are unaffected since they're grandfathered `active`, and new orgs get a 14-day trial by default
- [ ] Swap to live Stripe keys + a live Product/Price only once ready to actually charge businesses

## 🔴 Critical (must complete before first business)
- [x] Deploy to production (Vercel + production Supabase)
- [x] Connect a custom domain
- [x] Configure production environment variables
- [x] Run one complete production signup → onboarding → widget → booking flow
- [x] Email booking confirmations (code path fixed 2026-07-04; Resend custom domain verified and live 2026-07-06 — `remy@mail.niteowlhq.com`, confirmed via a real end-to-end booking with both SPF and DKIM passing)
- [x] Customer cancellation/reschedule links
- [ ] Basic monitoring (logs and alerts) — Sentry + `/api/health` shipped 2026-07-04; still needs `NEXT_PUBLIC_SENTRY_DSN` added to Vercel prod env vars and an external pinger (UptimeRobot/Better Uptime) pointed at `/api/health`
- [ ] **Add `ADMIN_EMAIL`, `SALES_NOTIFICATION_EMAIL`, and the updated `RESEND_FROM_EMAIL` (`remy@mail.niteowlhq.com`) to Vercel's production environment variables** (2026-07-06 — currently local-only; without these, `/admin/sales-leads` denies everyone, sales lead notifications silently no-op, and production email still sends from the old sandbox address)

## 🟢 Critical booking bug found and fixed (2026-07-06)
- [x] **Relative booking times ("tomorrow at 2pm") could be silently booked on the wrong date** on the public widget (the real customer-facing path) — the widget's lead-extraction prompt had drifted out of sync with the dashboard's and was missing the "return the date exactly as the customer said it" instruction, so the model resolved it itself using a stale internal calendar before the real current date was ever applied. Fixed by resyncing the two prompts; re-verified a real booking now stores the correct date. Full detail in CHANGELOG.md.
- [x] Audited all existing production leads with a stored appointment time for the same corruption pattern — zero affected, no live customer data was corrupted

## 🟢 Sales chat (marketing site conversion, 2026-07-06)
- [x] Persuasive, outcomes-first sales chat on the landing page, separate persona/system from Remy-as-receptionist
- [x] Objection handling for the 5 most common pushbacks
- [x] Industry personalization (reusable prompt structure, verified against 7 industries including one not explicitly listed)
- [x] Structured, validated, one-field-at-a-time demo lead capture with correction support and cross-session duplicate prevention
- [x] Admin-only `/admin/sales-leads` CRM view + team email notification on completed leads
- [x] Closing CTA — free trial for ready visitors, demo flow for those still deciding
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
- [ ] Verify backups
- [ ] Export data capability
- [ ] Privacy Policy
- [ ] Terms of Service

## ⚪ Version 2
- [ ] Voice AI
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

