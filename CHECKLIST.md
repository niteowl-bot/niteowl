# 🚀 Alpha Launch Readiness

## 🔴 Critical (must complete before first business)
- [x] Deploy to production (Vercel + production Supabase)
- [ ] Connect a custom domain
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

