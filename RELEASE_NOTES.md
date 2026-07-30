# Release Notes

## v1.0.0-beta — 2026-07-29

First tagged beta of **NiteOwl AI / Remy** — an AI receptionist for small and
medium service businesses that answers customer questions, captures every
enquiry, and books appointments 24/7, handing unusual requests to a human.

**Production:** https://niteowlhq.com

---

### Highlights in this release

**Marketing site & conversion**
- Redesigned homepage hero with a self-contained, image-free **animated product
  demo** in the hero player (loops on a 2-minute cycle, respects
  `prefers-reduced-motion`, and steps aside automatically once a real video URL
  is configured).
- Truthful, aligned messaging (website enquiries → lead capture → bookings),
  consistent primary CTA ("Start Your Free 14-Day Trial") across the page.
- New **"Perfect For"** and **"How Remy Works"** sections; removed the earlier
  duplicated/off-message sections.
- New objection-handling **FAQ** section.
- **SEO:** Open Graph + Twitter-card metadata, canonical URL, `metadataBase`, a
  generated branded OG image, and `SoftwareApplication` + `FAQPage` JSON-LD.
- **Accessibility:** `<main>` landmark, skip-to-content link, single H1,
  decorative icons marked `aria-hidden`.
- Public demo configuration via `NEXT_PUBLIC_REMY_DEMO_VIDEO_URL` and
  `NEXT_PUBLIC_REMY_BOOKING_URL` (public URLs only, no secrets).

**Booking & calendar integrity**
- Enforced invariant: **a lead can never be `booked` without a saved
  `appointment_datetime`** — the calendar renders bookings by that field, so a
  timeless "booked" lead is now impossible. Enforced at every layer: the chat
  lead-capture flow, the Leads editor UI, the `PATCH /api/leads` endpoint, and a
  database `CHECK` constraint (`leads_booked_requires_appointment`), applied on
  **dev and production**.
- Verified end-to-end: a chat booking creates a `booked` lead visible in both the
  dashboard and the calendar at the correct local time; double-booking
  prevention intact.

**Platform (shipped and part of this beta)**
- AI Receptionist, Website Chat Widget, Dashboard Preview Chat.
- Knowledge Base, Business Hours, Capacity Management, Double-Booking Prevention,
  Lead CRM, Calendar.
- Four-step Onboarding Wizard, Dashboard Setup Checklist.
- Needs-Review workflow with owner email notifications (Resend).
- Voice AI, AI Import for the Knowledge Base, Stripe billing.

---

### Verification
- `eslint`, `tsc --noEmit`, and `next build` all clean (no new issues).
- Booking flow verified end-to-end; DB constraint verified on dev **and** prod.
- Production deployment verified live at https://niteowlhq.com.

### Follow-ups / not yet done
- **Google sign-in (OAuth)** is not enabled on the production Supabase project —
  email/password sign-in works; Google returns "provider is not enabled".
- The hero shows a **branded animation**, not a recorded video — set
  `NEXT_PUBLIC_REMY_DEMO_VIDEO_URL` when the real video is ready.
- **"Book a Live Demo"** stays a clearly-disabled button until
  `NEXT_PUBLIC_REMY_BOOKING_URL` is configured.
- **Google Calendar integration (connect + read availability)** exists on the
  `feature/calendar-integration-step1` branch but is **not merged or deployed**;
  its SQL has not been run on production.

See `CHANGELOG.md` for the full dated history and `PROJECT_STATUS.md` for the
current status and roadmap.
