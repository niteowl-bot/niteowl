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
- [ ] Email booking confirmations (code path fixed and correct 2026-07-04; blocked on Resend custom domain — see below, real customers won't receive these until it's verified)
- [x] Customer cancellation/reschedule links
- [ ] Basic monitoring (logs and alerts) — Sentry + `/api/health` shipped 2026-07-04; still needs `NEXT_PUBLIC_SENTRY_DSN` added to Vercel prod env vars and an external pinger (UptimeRobot/Better Uptime) pointed at `/api/health`

## 🟡 Business onboarding
- [ ] Widget installation guide (WordPress, Wix, Squarespace, HTML)
- [ ] Dashboard "Getting Started" guide
- [ ] Test the widget on several real websites
- [ ] Verify email deliverability (blocked: Resend is still on the unverified `onboarding@resend.dev` sandbox sender, which redirects every send to the account owner regardless of recipient — needs a verified custom sending domain, likely alongside the custom domain work above)

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

