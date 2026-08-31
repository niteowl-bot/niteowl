# NiteOwl AI - Project Context

## Project

NiteOwl AI is a SaaS platform for small and medium businesses.

The first product is **Remy**, an AI Receptionist that answers customer enquiries, books appointments, captures leads and escalates unusual requests to the business.

This repository is the source of truth.

GitHub should always reflect the latest working state.

**Canonical architecture set.** Architecture lives in exactly two documents, and every
review extends them rather than adding a third:

- `docs/ARCHITECTURE.md` — **Parts I–VI.** Part I future-compatibility guardrail, Part II
  provider independence and resilience, Part III compounding moat and outcome intelligence,
  Part IV outcome intelligence / governed agents / resource control, Part V operational
  sovereignty and diagnostic intelligence, Part VI the Business Problem Case. **§21 is
  the single canonical architecture diagram.**
- `docs/AGENT_ACCESS_LAYER.md` — the governed Agent Access Layer, capability registry,
  autonomy ladder and free-product distribution architecture.

All of it is **documentation only**; nothing in either document has been implemented, and
neither asks for implementation now. The canonical `DecisionRecord` is defined once, at
`docs/ARCHITECTURE.md` §20.7.

---

# Current Status

The following features are complete and tested:

- AI Receptionist
- Website Chat Widget
- Dashboard Preview Chat
- Dashboard
- Knowledge Base (Create/Edit/Delete)
- Business Hours
- Capacity Management
- Double Booking Prevention
- Calendar
- Lead CRM
- Four-step Onboarding Wizard
- Dashboard Setup Checklist
- Needs Review Workflow
- Dashboard Preview Lead Separation
- GitHub Workflow
- Dashboard Timezone Correctness (PR #17, merged and live 2026-08-14)
- Customer Manage-Link Timezone Correctness (PR #19, merged and live 2026-08-14)
- Email Appointment Timezone Correctness (PR #21, merged and live 2026-08-14)
- External-Calendar Rescheduling Correctness (PR #25, merged and live 2026-08-19)
- Voice Calendar Booking (PR #23, merged 2026-08-18; **verified live end-to-end 2026-08-27**)
- Owner Call-Summary Booking Status (PR #27, merged and live 2026-08-26)
- Service-Matcher Morphology (PR #28, merged and live 2026-08-26)
- Truthful Voice Booking Closing (PR #30, merged and live 2026-08-27; **live production smoke test PASS**)
- Callback Urgency Owner Visibility (PR #34, merged and deployed 2026-08-31; **live regression found the same day — it did NOT work end-to-end**; fix pending on `fix/callback-urgency-production-regression`, not merged)

Verified current state through PR #34:

- **PR #27** is merged and deployed. The owner call summary now reports the **final persisted booking status**, not an interim one.
- **PR #28** is merged and deployed, and the plumber/plumbing morphology fix was **verified successfully in production**: ordinary word forms of the same service now match.
- **Live voice to Google Calendar booking is verified end-to-end.** The PR #28 production verification produced a genuine `booked` lead together with a synced calendar integration link.
- **PR #30** is merged (`dbf299b`, a normal two-parent merge), deployed and **production verified**. Remy's spoken closing now tells the truth about what is known while the caller is still on the line — see the voice-closing rule below.
- **PR #34** is merged (`7eff6ec`, a normal two-parent merge) and **deployed** — production deployment `dpl_9WhkwnRC6XAhg8HQ8q741VBz1bDj` reached READY, carries the `git-main` alias and serves `niteowlhq.com`, and `/api/health` returned **HTTP 200** `{"status":"ok","database":"ok"}`. It added a conditional **"Callback urgency"** row to the owner's call-summary email and a read-only note in the leads drawer. 1129 tests passed / 0 fail; `tsc` clean; ESLint unchanged at 11 pre-existing problems. *(Corrected 2026-08-31: this entry originally claimed the urgency "now reaches the owner". The live regression below proved it does not, for the extraction shape production actually produces. **The merge and deployment facts stand; the behavioural claim did not**, and it is recorded rather than quietly rewritten so a later reader can see how it was wrong.)*
- **Live post-merge regression, 2026-08-31 — PR #34 did not work end-to-end.** A real production call, caller saying *"As soon as possible. It's urgent."* and then *"I don't have a specific time. Just as soon as possible, please."*, produced an owner email that correctly showed **Callback date: Not provided. Callback time: Not provided.** and **no "Callback urgency" row at all**. The whole point of PR #34 did not occur.
  - **Root cause.** Extraction returned **`urgent: true` with `preferred_datetime: null`** — which is exactly what it is instructed to do: `src/lib/voice/extraction.ts` tells the model *"URGENCY IS NOT A TIME … NEVER record one of them here; set urgent true instead. Null if no day or time was mentioned, including when urgency was all the caller gave."* But `calls.ts` derived `callbackUrgency` **only** from `preferred_datetime`, via `sanitisePreferredDatetime(...).urgency`. **PR #34 read a field that the prompt above it is designed to leave empty**, so on the obedient-model path there was nothing to read and `urgent: true` went unused. `metadata.callback_urgency` was never written either, so the leads drawer was blank for the same reason.
  - **Why the tests missed it.** The PR #34 email tests called `sendCallSummaryEmail` **directly** with a `callbackUrgency` value and checked it rendered; the sanitiser tests fed it the phrase in `preferred_datetime` — the shape a **disobedient** model produces. Nothing exercised the step that *decides* the value against the shape production actually emits. **All 54 passed while production did nothing.** The lesson is recorded because it generalises: a test that supplies the value under test cannot prove the pipeline that produces it.
  - **The fix (NOT merged, NOT deployed).** On branch `fix/callback-urgency-production-regression`, against `7eff6ec`. `resolveCallbackUrgency()` in `callbackTiming.ts` reads **both** signals — the caller's own phrase when the model gives one, the extracted `urgent` flag when it does not — and returns nothing whenever a real timing exists. Seven end-to-end tests now drive the **real `processCallEnded`** on the live shape and are mutation-verified: reverting the fix fails two of them. 1136 tests pass / 0 fail; `tsc` clean; ESLint unchanged at 11.
  - **Still unverified in production.** The fix has had no live call. Closing this needs one real urgency-only call showing the row — the same standard PR #34 was closed *without*, which is how the defect shipped.

Deferred and non-blocking (do **not** pick these up as part of other work):

- The remaining `requiredMatches` false positive is **explicitly deferred** pending a safer service-identity architecture. It is **not** to be closed with a matcher tweak — see the service-matching section below for the approaches already investigated and rejected.
- The `requested_service` architectural seam remains **deferred and not approved** (same section).
- **Rule 11 recap wording, minor and pre-existing.** The recap can still say the team will contact the caller by phone while the final closing points at the confirmation email. Both statements are true and the closing itself is single and coherent, so no truthfulness rule is broken. It predates PR #30 and was deliberately left alone.
- **Speech-to-text noise, observed not fixed.** The 2026-08-27 smoke test mis-heard a spoken email twice before the read-back loop settled on the correct address, and stored "Galway" as "Galloway". The read-back behaved correctly; these are transcription artefacts, not booking defects.

Dashboard timezone rule:

Dashboard appointment times mean the **business's** timezone (`organisations.timezone`), never the owner's browser/device timezone.

- `datetime-local` values are converted with `wallClockToInstant(value, orgTimezone)` in `src/lib/calendar/timezone.ts`, which is DST-aware
- dashboard display formatting uses the organisation timezone; the previous hardcoded `Europe/London` formatting is gone
- this matches the chat, widget and voice booking paths, which already resolved the organisation's zone

Customer manage-link timezone rule (same rule, customer side):

A time a customer picks on the manage-booking link means that wall-clock time in the **business's** timezone — never `Europe/London`, never the customer's device.

- `/api/bookings/manage` converts with the same `wallClockToInstant`; the old London-only conversion is gone
- the page displays and prefills in the organisation timezone, returned by `GET`
- an unresolvable organisation timezone **fails closed**: the reschedule is refused, and neither Google Calendar nor `appointment_datetime` is written
- cancellation is unaffected — it converts no wall-clock time

Email timezone rule (closed by PR #21 — this was the PR #19 follow-up):

Appointment times in emails render in the **business's** timezone. `formatAppointmentDate` in `src/lib/email.ts` takes the organisation zone; the `Europe/London` hardcode is gone.

- the zone comes from `getOrgOwnerEmail`'s existing `organisations` read — no extra database query
- threaded into booking confirmation, owner new-booking notification, cancellation, reschedule and call-summary formatting, **including subject lines**
- display **fails soft**: a missing, empty or unusable zone falls back to `DEFAULT_ORG_TIMEZONE` so the email still sends, and the formatter's `try/catch` remains as final protection
- `en-GB` wording and date format are unchanged — that is date presentation, not a timezone

Standing timezone rule (all three surfaces):

Appointment instants are stored as **UTC instants**, always. A business-local timezone is used only to interpret or display a wall-clock time. **Email formatting must never reintroduce a hardcoded tenant timezone.**

Reschedule availability rule (closed by PR #25, merge commit `4784cfc`):

A reschedule is judged by the **same decision every other booking path makes** — business hours, then internal capacity, then the business's real external calendar — and an appointment must never conflict with **itself**.

- both reschedule routes (owner dashboard `/api/leads`, customer manage link `/api/bookings/manage`) go through `checkBookingSlot`; the internal-only `isWithinBusinessHours` + `isSlotAvailable` pair is gone from both (`b2e80e7`)
- `checkBookingSlot`'s `rescheduleExclusion` is the external counterpart to `excludeLeadId`, built by the shared `appointmentBusyWindow()` helper so the two routes cannot drift (`ce48832`)
- the exclusion is **subtracted** from the busy list, never matched against it: only the span the appointment already occupies is freed, so a genuine conflict extending into newly claimed time still refuses the move. **Whole busy intervals must never be dropped for merely overlapping the old window** — that would wave another customer's appointment through
- "we could not check" is never "that time has gone": a failed hours read, a failed capacity count or an unreadable calendar returns **503** and leaves the appointment untouched
- callers that pass no exclusion use the busy list exactly as fetched, so **new bookings are unaffected**
- known and accepted: Google free/busy exposes **no event identity**, so an event lying entirely inside the appointment's own window is subtracted with it. The internal capacity check catches any other *lead* in that span, so this needs a Google-only event invisible to our database

Voice calendar booking status:

`VOICE_CALENDAR_BOOKING_ENABLED` is **set in the production environment**, so voice calendar booking (PR #23) is **enabled in production**. The flag requires the exact literal `"true"`, so anything else — including unset — still reads as off.

**Verified end-to-end in production (2026-08-27).** A live phone call booked an appointment and the Google Calendar event was created: the PR #28 production verification produced a genuine `booked` lead together with a synced calendar integration link. Voice bookings are no longer local-only.

This supersedes the earlier record that the flag was absent and the feature disabled.

Voice booking closing rule (closed by PR #30, merge commit `dbf299b`):

A live call **cannot know that a booking exists**, so the spoken closing may only claim what is authoritative at the moment it is spoken.

- the calendar event is written **after the caller has hung up** — `processCallEnded` runs in `after()`, then `capturePartialLead` settles through `settleCalendarBacking`. **Post-call settlement remains the single booking path**
- the live assistant tool surface is exactly **`check_availability` and `endCall`**. There is **no booking tool**, no mid-call calendar write, no second booking path and no hold or reservation mechanism. A regression test pins this, and any change that adds a third tool must be treated as an architectural decision, not a feature
- `check_availability` is the one authoritative fact Remy learns mid-call, so **"currently showing as available"** is the strongest claim the closing may make — and only when the tool actually returned FREE. It is a reading, not a hold: nothing reserves the slot, so it can still be taken before the request is processed
- the closing must **never** say booked, confirmed, reserved, held, secured, locked in or "in the diary", and must never claim the request has already been submitted while the caller is still on the line
- processing is stated as happening **after the call**, and the **confirmation email is the authoritative booking confirmation**. It is offered as something to look out for, never guaranteed — settlement can fail, and then no confirmation is sent
- rule 9 no longer announces what happens next; it defers to the single rule 11 closing, so the caller never hears two competing next-step promises

**Verified by live production smoke test 2026-08-27** (call `01a04416-941c-7991-9ea5-f0593c01f2e5`, deployment proven built from `dbf299b`): `check_availability` ran and returned AVAILABLE; Remy said *"That time is currently showing as available. After this call, I'll submit your booking request for processing so please look out for the confirmation email."*; the call ended normally; post-call settlement created the Google event; the lead settled to `booked`; exactly one `integration_links` row synced; and the customer confirmation email was received. No duplicate or contradictory state.

Callback urgency rule (opened by PR #34, merge `7eff6ec`; **NOT closed by it** — see the live regression above. Corrected on `fix/callback-urgency-production-regression`, which is **not merged and not deployed**):

Urgency is **not** a callback time, and the two must never be confused — but the owner must still see it.

- **Urgency is decided from two signals, not one.** This is the whole substance of the correction. `resolveCallbackUrgency` (`src/lib/voice/callbackTiming.ts`) takes the caller's own phrase when the model supplied one, and falls back to the extracted **`urgent` flag** when it did not. Reading only `preferred_datetime` — what PR #34 shipped — loses the urgency on every call where the model **obeys** its own extraction schema, which is the normal case
- `sanitisePreferredDatetime` returns a real timing **or** an urgency phrase, **never both**. It remains a backstop for a model that *disobeys* and writes urgency into `preferred_datetime`; it is not, and never was, the primary source
- **A real timing wins outright.** When the caller gave a usable day or time, no urgency row is produced at all, so urgency can never compete with a field that means WHEN
- the value reaches the owner as a conditional **"Callback urgency"** row in the call-summary email (`src/lib/email.ts`) and a read-only note in the leads drawer (`LeadsTable.tsx`), and is kept on `leads.metadata.callback_urgency`
- it is labelled **as urgency, never as a date or a time**, and is HTML-escaped like every other caller-supplied value
- the dashboard note renders **outside** the datetime input, so it can never be edited or saved into `preferred_datetime`
- **Never fabricate the caller's words.** On the fallback path NiteOwl holds only a boolean, so the row reads `Urgent — no specific day or time given` (`URGENT_WITHOUT_TIMING`) — NiteOwl's own wording, rendered plainly and **not** as a quotation. Inventing a quote to fill the row would be the exact fabrication this rule exists to prevent
- the distinctions are pinned by tests that drive the **real `processCallEnded`**, not the email helper in isolation — the gap that let PR #34 ship broken

**Not merged, not deployed, and not live-tested.** It fires only when a caller gives urgency instead of a callback time, and both surfaces are behind auth, so closing it needs one real urgency-only call showing the row.

Service matching — one known false positive, DEFERRED (investigated 2026-08-26, against `f05db92`):

`isServiceConfirmedByKnowledge` (`src/lib/leadCapture.ts`, shared by voice, chat **and** widget) can confirm a service the business does not offer.

Reproduction, against a Plumbing-only Knowledge Base:

```
"electrician for a broken radiator"  →  true   (WRONG)
   significant tokens: [electrician, broken, radiator]   requiredMatches = 2
   electrician = miss,  broken = HIT,  radiator = HIT    →  2 of 3, confirmed
```

Why: every significant token carries **equal weight**, so incidental descriptor words can satisfy the threshold while the token naming the service misses entirely. `requiredMatches` is `n <= 2 ? n : ceil(2n/3)` — non-monotonic, strictest at exactly two words. This **fails open**, which makes it more serious than the PR #28 morphology bug, which failed closed. It has never been observed in production.

**A qualifier/preposition gate was implemented and REJECTED.** The idea was to split the request at the first qualifier preposition and treat the words before it as the requested service. Adversarial testing of 24 phrases against the real matcher proved the invariant "words before the qualifier identify the service" is simply false in ordinary English — English `for` is both purposive ("looking **for** a plumber") and qualifying ("plumber **for** a radiator"). It introduced four genuine false negatives on valid requests:

- `"I need help with a burst pipe"` (before `with` = "help")
- `"help with a blocked toilet"` (= "help")
- `"issue with a leaking pipe"` (= "issue")
- `"need someone for a leaking radiator"` (= "someone")

The experiment was fully reverted; no part of it remains.

**Architectural finding — `extracted.service` is NOT a trusted service identity.** Its extraction contract calls it a *"short summary of what the caller wants"* (voice `extraction.ts`; chat/widget prompt example returns `"Plumber booking"`). One free-text field, model-generated, observed in production holding a trade (`"plumber"`), a family (`"plumbing"`), trade + request (`"plumbing appointment"`), trade + problem, a problem alone, and once an entire call summary paragraph (lead `dbff9272`). `shouldUpdateService` already guards it against model misclassification. `confidence` gates nothing.

**Never make `extracted.service` authoritative for deciding which services a business offers.**

The safer future direction is a distinct upstream signal — conceptually `requested_service` — but that is **DEFERRED and not approved**. It is a proper architecture task across voice, chat and widget requiring: an explicit semantic contract; a clear split between requested service identity and problem description; **constrain-only** semantics (may refuse, may never confirm); fallback to existing behaviour when absent or uncertain; adversarial tests; provider-independent boundaries; identical behaviour across all three surfaces; PR #28 morphology preserved; fail-safe throughout; and no hard-coded trade taxonomy unless separately justified.

**Do not casually retry any of these** — each was investigated and rejected:

- another preposition/qualifier heuristic (proven to cause false negatives)
- more stop-word tuning (an ever-growing list; breaks on "I require assistance with…")
- trade-name suffix heuristics (`-er` catches `under`, `water`, `other` — verified to break `"leak under the shower"`)
- fuzzy matching, edit distance, embeddings, or an LLM call inside the matcher
- hard-coded trade vocabularies or industry-specific lists
- cross-record contradiction as the sole fix (never fires on a single-service KB, so it misses this very case)
- lowering `requiredMatches` or any arbitrary threshold change (amplifies the false positive)

---

# Current Work

Currently implementing:

- Needs Review email notifications
- Shared email service using Resend

Next planned work:

- Production deployment
- Domain
- Email confirmations
- Cancellation/Reschedule workflow

---

# Business Goal

Primary objective:

Launch an Alpha version to real businesses as quickly as possible.

Every feature should be evaluated by one question:

"Does this help me acquire and retain my first paying businesses?"

If not, recommend postponing it.

---

# Brand

Company:
NiteOwl AI

First Product:
Remy

Positioning:

Remy is an AI Receptionist that never misses a customer enquiry.

It answers questions, books appointments, captures leads and gracefully hands unusual requests to a human.

---

# Architecture Rule

Every new feature must:

- reuse existing helpers
- never create duplicate systems
- remain backward compatible
- be implemented one step at a time
- be tested after every step

Architecture discussion always comes before code.

---

# Development Principles

These rules must always be followed.

## Never refactor working code.

If a feature works and has been tested:

- leave it alone
- make additive changes only
- reuse existing helpers
- avoid duplicate systems
- preserve backwards compatibility

Every new feature should be implemented in small isolated steps.

After each step I will test before continuing.

---

# Core Architecture

Remy consists of:

- Dashboard
- Website Widget
- Dashboard Preview Chat
- AI Chat API
- Knowledge Base
- Business Hours
- Booking Engine
- Capacity Checking
- Calendar
- Lead CRM
- Settings
- Onboarding Wizard

Both Dashboard Preview and Website Widget must always use the same booking engine and AI behaviour.

Only their lead source differs.

---

# Lead Sources

Current lead sources include:

- chat
- web_widget
- dashboard_preview

These must remain separated.

Dashboard testing must never pollute production analytics.

---

# Booking Principles

Booking logic must never be broken.

Current functionality includes:

- availability checking
- business hours
- capacity limits
- double booking prevention
- appointment parsing
- automatic lead merging
- booking confirmation flow

---

# Knowledge Base

Knowledge records are fully editable.

Categories include:

- FAQ
- Services
- Pricing
- Opening Hours
- Policies
- Custom Instructions

The Knowledge Base drives Remy's responses.

---

# Needs Review Workflow

Purpose:

When Remy cannot confidently answer:

- never invent an answer
- never break booking flow

Instead:

- collect missing contact details
- create/update lead
- status = needs_review
- notify business owner
- customer receives a polite handoff response

Notification should only be sent once.

Use metadata JSONB to store:

needs_review_notification_sent = true

---

# Current Tech Stack

- Next.js
- TypeScript
- Supabase
- OpenAI
- Resend (email)
- GitHub
- Vercel (planned)

---

# Coding Style

Always:

- additive changes
- isolated helpers
- production safe
- reuse existing code
- minimal edits
- explain architecture before coding

Never:

- rewrite whole files
- refactor unrelated code
- change working booking logic
- duplicate systems

---

# Product Vision

Remy is not simply a chatbot.

Remy is an AI Receptionist.

Primary goals:

- answer customer questions
- book appointments
- capture every lead
- never miss an enquiry
- gracefully hand uncertain requests to a human

---

# Roadmap

Current priority:

Alpha Launch

Remaining work:

- production deployment
- custom domain
- email confirmations
- cancellation/reschedule emails
- monitoring
- production testing

Future:

- Voice AI
- Google Calendar
- Outlook Calendar
- Stripe
- Multi-staff
- Analytics

---

# Development Workflow

1. Review architecture.
2. Identify risks.
3. Recommend the cleanest implementation.
4. Wait for approval.
5. Implement one isolated step.
6. Test.
7. Commit.
8. Push to GitHub.
9. Update CHANGELOG.md.
10. Update CHECKLIST.md if required.
