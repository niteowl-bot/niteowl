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
- Callback Urgency Owner Visibility (PR #34, merged and deployed 2026-08-31; **live regression found the same day — it did NOT work end-to-end**. Corrected by **PR #35**, merged, deployed and **live-production verified** 2026-08-31)
- Owner Booking-Status Accuracy (PR #37, merged, deployed and **live-production verified** 2026-08-31 — a booking outcome is reported only when a time was actually requested)
- Caller-Name Integrity (PR #39, merged, deployed and **live-production verified** 2026-09-01 — an email address can no longer manufacture a caller name)
- Required Fields Before Closing (PR #40, merged, deployed and **live-production verified** 2026-09-01 — closing dialogue is forbidden until the required-field gate is satisfied; **Finding A CLOSED**)
- Caller-Name / Email-Digit Integrity (PR #43, merged `c104449`, deployed and production-verified 2026-09-02 — a digit-suffixed email can no longer condemn the caller's real name)

Verified current state through PR #40:

- **PR #27** is merged and deployed. The owner call summary now reports the **final persisted booking status**, not an interim one.
- **PR #28** is merged and deployed, and the plumber/plumbing morphology fix was **verified successfully in production**: ordinary word forms of the same service now match.
- **Live voice to Google Calendar booking is verified end-to-end.** The PR #28 production verification produced a genuine `booked` lead together with a synced calendar integration link.
- **PR #30** is merged (`dbf299b`, a normal two-parent merge), deployed and **production verified**. Remy's spoken closing now tells the truth about what is known while the caller is still on the line — see the voice-closing rule below.
- **PR #34** is merged (`7eff6ec`, a normal two-parent merge) and **deployed** — production deployment `dpl_9WhkwnRC6XAhg8HQ8q741VBz1bDj` reached READY, carries the `git-main` alias and serves `niteowlhq.com`, and `/api/health` returned **HTTP 200** `{"status":"ok","database":"ok"}`. It added a conditional **"Callback urgency"** row to the owner's call-summary email and a read-only note in the leads drawer. 1129 tests passed / 0 fail; `tsc` clean; ESLint unchanged at 11 pre-existing problems. *(Corrected 2026-08-31: this entry originally claimed the urgency "now reaches the owner". The live regression below proved it does not, for the extraction shape production actually produces. **The merge and deployment facts stand; the behavioural claim did not**, and it is recorded rather than quietly rewritten so a later reader can see how it was wrong.)*
- **Live post-merge regression, 2026-08-31 — PR #34 did not work end-to-end.** A real production call, caller saying *"As soon as possible. It's urgent."* and then *"I don't have a specific time. Just as soon as possible, please."*, produced an owner email that correctly showed **Callback date: Not provided. Callback time: Not provided.** and **no "Callback urgency" row at all**. The whole point of PR #34 did not occur.
  - **Root cause.** Extraction returned **`urgent: true` with `preferred_datetime: null`** — which is exactly what it is instructed to do: `src/lib/voice/extraction.ts` tells the model *"URGENCY IS NOT A TIME … NEVER record one of them here; set urgent true instead. Null if no day or time was mentioned, including when urgency was all the caller gave."* But `calls.ts` derived `callbackUrgency` **only** from `preferred_datetime`, via `sanitisePreferredDatetime(...).urgency`. **PR #34 read a field that the prompt above it is designed to leave empty**, so on the obedient-model path there was nothing to read and `urgent: true` went unused. `metadata.callback_urgency` was never written either, so the leads drawer was blank for the same reason.
  - **Why the tests missed it.** The PR #34 email tests called `sendCallSummaryEmail` **directly** with a `callbackUrgency` value and checked it rendered; the sanitiser tests fed it the phrase in `preferred_datetime` — the shape a **disobedient** model produces. Nothing exercised the step that *decides* the value against the shape production actually emits. **All 54 passed while production did nothing.** The lesson is recorded because it generalises: a test that supplies the value under test cannot prove the pipeline that produces it.
  - **The fix — PR #35, merged, deployed and LIVE-PRODUCTION VERIFIED 2026-08-31.** Branch `fix/callback-urgency-production-regression`, commit `35f6403`, merged as PR #35 (`62afd12`, a normal two-parent merge). Production deployment `dpl_BbGd7nezo2CKCG3pn8B8KZWnoZkA` reached READY, carries the `git-main` alias and serves `niteowlhq.com`; `/api/health` returned **HTTP 200** `{"status":"ok","database":"ok"}`. `resolveCallbackUrgency()` in `callbackTiming.ts` now reads **both** signals — the caller's own phrase when the model supplies one, the extracted `urgent` flag when it does not — and returns nothing whenever a real timing exists. Seven end-to-end tests drive the **real `processCallEnded`** on the live extraction shape and are mutation-verified: reverting the fix fails two of them. 1136 tests pass / 0 fail; `tsc` clean; ESLint unchanged at 11.
  - **Live production verification, 2026-08-31 — PASS.** A real urgency-only call closed this out. The caller asked for help with a **burst pipe** and said *"As soon as possible. It's urgent."*, then confirmed there was no specific day or time and they needed someone as soon as possible. Observed in production:
    - the owner's call-summary email visibly rendered **`Callback urgency: Urgent — no specific day or time given`** — the row that was missing on the PR #34 call
    - **Callback date: Not provided** and **Callback time: Not provided**, both correct
    - **no fabricated appointment datetime** was created
    - booking status remained **REQUIRES REVIEW**, and the email stated explicitly that the requested appointment was **not confirmed in the calendar**
    - Remy preserved the urgency semantically and did **not** use the previous incorrect *"any time suits"* wording

    Every required behaviour held together on one call: urgency reaches the owner, no timing is invented, and nothing is falsely confirmed.
- **PR #37 — the false calendar-failure block, merged, deployed and LIVE-PRODUCTION VERIFIED 2026-08-31.** A **separate** defect found by the same live call that verified PR #35, and fixed separately. The owner's email showed **"REQUIRES REVIEW — The requested appointment was not confirmed in the calendar"** on a call where **no time was ever requested**, so nothing had been submitted to a calendar and nothing had failed. The block was gated on `isAppointmentRequest` alone — *"the caller wanted a visit"* — which says nothing about whether they named a time. It conflated **"we tried and could not"** with **"there was nothing to try"**, the conflation this codebase refuses everywhere else.
  - **The fix.** Branch `fix/owner-booking-status-no-time-requested`, commit `3de1210`, merged as PR #37 (`13883e1`, a normal two-parent merge). One condition in `src/lib/voice/calls.ts`: the block renders only when `callbackTiming.preferredDatetime` is set. Gated on the **sanitised** requested phrase deliberately — not the resolved instant, so a time that was given but failed to parse or that the calendar refused still reports its outcome (**fail-closed preserved**); and not the raw `details.preferred_datetime`, because a model writing *"as soon as possible"* into that field would re-admit the urgency-as-time confusion PR #35 removed. Both rejected alternatives are pinned by tests. `src/lib/email.ts` untouched — the block is omitted, not relabelled. 7 tests drive the **real `processCallEnded`**; mutation-verified (reverting the gate fails 3, using the raw field fails 1). 1143 tests pass / 0 fail; `tsc` clean; ESLint unchanged at 11.
  - **Production deployment.** `dpl_9daL9V8cAb7376hVBDyThY9NdHm9` reached READY, carries the `git-main` alias and serves `niteowlhq.com`; `/api/health` returned **HTTP 200** `{"status":"ok","database":"ok"}`.
  - **Live production verification, 2026-08-31 — PASS.** An urgent burst-pipe call: the caller had a burst pipe, needed someone as soon as possible, had **no particular day or time**, and wanted the team to contact them as soon as possible. Observed in the owner's email:
    - **`Callback urgency: Urgent — no specific day or time given`** — present, so PR #35's behaviour survived the change
    - **Callback date: Not provided** and **Callback time: Not provided**
    - the false **"REQUIRES REVIEW — The requested appointment was not confirmed in the calendar"** block **did not appear**
    - **no false booking attempt and no failed-calendar claim** of any kind
    - the urgent request still reached the owner correctly

    **PR #37 is verified.** The owner is now told about a booking outcome only when a booking was actually asked for.
- **PR #39 — the email-derived caller name, merged, deployed and LIVE-PRODUCTION VERIFIED 2026-09-01.** This closes the "NEW, OPEN" caller-name item recorded against the PR #37 verification call, where the caller gave **"Ernesto"** and the owner email's structured **Caller** field read **"Ernie Sephora"** — a person who does not exist, whose name is the local part of the email address spoken later in the same call.
  - **The fix.** Branch `fix/voice-caller-name-integrity`, commit `fa9e0d2`, merged as PR #39 (`569cb8c`, a normal two-parent merge). New `src/lib/voice/nameIntegrity.ts` plus a two-line wiring change in `src/lib/voice/calls.ts`. See the caller-name integrity rule below for the substance.
  - **Production deployment.** `dpl_5jeEKH4NVzsyyAMMEU2GvFUE9Lc5` reached READY, carries the `git-main` alias and serves `niteowlhq.com`; `/api/health` returned **HTTP 200** `{"status":"ok","database":"ok"}`. The deployment was created at 2026-08-31 23:06:53, three seconds after the `569cb8c` merge commit (23:06:50). *(Recorded honestly: `vercel inspect` carries no git metadata, so the build's commit SHA was **not** read back directly — the identification rests on the timestamp adjacency plus the `git-main` alias, not on a SHA comparison.)*
  - **Live production verification, 2026-09-01 — PASS.** A real leaking-radiator call (17:39, duration 1m 40s, caller ID `+353871465274`) closed this out. Observed in the owner's email, and confirmed against the call transcript:
    - the caller explicitly gave the name **"Ernesto"** (*"User: Ernesto. Ernesto."*)
    - the owner email's structured **Caller** field displayed **`Ernesto`**, and the subject line read *"…a call from Ernesto"*
    - it did **not** display the previous fabricated email-derived name
    - the generated summary also identified the caller as **Ernesto** (*"Ernesto called to request an urgent appointment… Name: Ernesto."*), so **the two surfaces agreed** — the precise disagreement PR #39 exists to prevent
    - **`Callback urgency: Urgent — no specific day or time given`** was still present, so PR #35's behaviour survived the change
    - **no Booking status row appeared at all**, and the summary carried **`Appointment date: Not provided. Appointment time: Not provided.`** — so PR #37's behaviour survived the change and **no false booking outcome** was reported
    - note that **no email address was collected on this call** (`Email: Not provided`), so the guard held on the path where it matters most: with no email to borrow from, the name still came through as the caller's own

    **PR #39 is verified.** The structured Caller field and the summary can no longer disagree, and an email address no longer manufactures a caller.
  - **The same call exposed two SEPARATE findings.** They are **not** part of PR #39 and were deliberately not bundled into it: PR #39 passed its own verification independently of both. Both had their **root cause proven from the call transcript**. **Finding A was then fixed by PR #40 and is CLOSED (below). Finding B remains OPEN.**
- **PR #40 — closing before the required fields were complete (FINDING A), merged, deployed and LIVE-PRODUCTION VERIFIED 2026-09-01. FINDING A IS CLOSED.**
  - **The defect, as observed.** On the PR #39 verification call the caller wanted an **urgent service visit** and could not give a day or a time. Remy collected name, address and callback number, then went straight to *"Is there anything else I can help you with today?"* with the **email never asked for**, **no recap** and **no confirmation** — and asked *"anything else?"* a second time. Rule 5's COMPLETION GATE already blocked all of that and already named email: the gate was **bypassed**, not missing.
  - **Root cause (proven from the transcript, not inferred).** The moment the caller declined a time, Remy spoke **rule 11's urgent CLOSING line mid-call** — *"I'll note this as urgent and pass your request to the team straight away"* — and repeated it verbatim at the number step. **Having spoken a closing, it behaved as though the call was closing.** The prompt permitted it: the closing lines were defined *only* as closings but nothing forbade speaking one earlier, and rule 11 (which buckets *"CALLBACK … or a call that is urgent"* together), rule 12 and rule 6 all invite callback-shaped wording the moment a caller is urgent. Rule 13's *"NEVER end the timing question early"* is **satisfied** in this case, because the caller had declined a time. **The defect is a TRANSITION, not a phrase.**
  - **The fix.** Branch `fix/voice-required-fields-before-closing`, commit `c3d39d8`, merged as PR #40 (`91d2bc3`, a normal two-parent merge). **Prompt-only**, five places in `src/lib/voice/assistant.ts` — see the closing-gate rule below. **No state machine, no new tool, no config key, no provider logic**; a test pins that the assistant config's key set has not grown. 26 new tests in `tests/voiceClosingGate.test.mjs`, of which the sequence half **parses the required-field list back out of the prompt** and replays the real call against it. Mutation-verified with five reversions (7 / 2 / 1 / 5 / 1 failures), source restored green after each. 1197 tests pass / 0 fail, 212 suites; `tsc` clean; ESLint unchanged at 11.
  - **Production deployment.** `dpl_8xEYiKCKpQ6cntxRyPGVjX1nhavm` reached READY and carries the `git-main` alias plus `niteowlhq.com`; `/api/health` returned **HTTP 200** `{"status":"ok","database":"ok"}`. Its `githubCommitSha` reads **`91d2bc37a594d7aa647f1e5f8c75d73d0e7d6f24`** — the merge commit itself, read from Vercel's own metadata rather than inferred from deployment timing, which is the weaker evidence the PR #39 entry had to rely on.
  - **Live production verification, 2026-09-01 — PASS.** A live urgent / no-specific-time call confirmed the behaviour the tests could not:
    - Remy **requested the caller's email before closing**
    - Remy **did not skip a remaining required field merely because the request was urgent**
    - the **recap ran before the closing / goodbye sequence**

    **This is the part that matters.** PR #40 is a **model-behaviour prompt correction**: the test suite can prove the instruction is present, coherent and mutation-sensitive, but never that the model obeys it. Only this call could close it — the same reasoning that made PR #34's all-green suite worthless in production.

Deferred and non-blocking (do **not** pick these up as part of other work):

- **FINDING A is CLOSED — fixed by PR #40, live-production verified 2026-09-01.** It is recorded in full above, root cause and all, and is listed here only so a reader scanning the open items does not go looking for it. The standing rule it produced is the closing-gate rule below.

- **NEW, OPEN — FINDING B: a mangled HOUSE NUMBER was accepted without question (PR #39 verification call, 2026-09-01). ORIGIN PROVEN from the call transcript.** The caller intended **`81 Oakland Drive`**. Layer by layer:
  - **Speech-to-text — the origin, and it is provider-side.** *User:* "**K e 1** Auckland Drive." Then, correcting: *User:* "No. **A c 1**. Oakland Drive." The caller said the number twice and **the digits were mangled both times**, while the street name resolved correctly on the second attempt (Auckland → Oakland). The failure is confined to the **house number**. ~~This repository configures no transcriber at all … The transcriber lives in Vapi configuration, which is out of scope.~~ **CORRECTED 2026-09-02 — that claim was wrong, and it is struck rather than deleted so a later reader can see the error.** `buildVoiceAssistantConfig` does emit only `language`, `voiceId`, `maxDurationSeconds`, `firstMessage`, `systemPrompt`, `structuredDataSchema`, `summaryInstructions` and `serverUrl` — that much was accurate — but the transcriber is added one layer further out, in `buildVapiAssistantResponse` (`src/lib/voice/vapi.ts`), and **this repository therefore does explicitly supply it**. Confirmed against the effective production config read back from a live call's own payload: **`provider: deepgram`, `model: nova-2`, `language: en-GB`**. Transcriber configuration is **in scope and repository-side**. Options this repository does not set — keyword/keyterm boosting, formatting, endpointing, confidence thresholds, fallback transcriber — still fall to Deepgram/Vapi defaults. **Nova-3 has not been implemented or evaluated**, and no provider or transcriber-model change has been made.
  - **Conversational confirmation — Remy's read-backs were CORRECT, and still insufficient.** It queried the address (*"Just to confirm, was that k e 1 Auckland Drive?"*) and, on correction, read the **whole** corrected address back (*"Got it. A c 1 Oakland Drive."*) — both exactly as rule 5 step 7 and rule 10 require, and both pinned by tests. **The gap is that it accepted `A c 1` as a house number.** Rule 5 step 7 tells Remy to query an uncertain **street name**; rule 7's digit read-back covers only the **callback number**. **Nothing tells Remy a house number is digits**, so `A c 1 Oakland Drive` — not a possible address — passed unchallenged.
  - **Correction handling — worked.** The caller's final `81 Oakland Drive` replaced the earlier values completely, per rule 10.
  - **Where it was actually caught — by the caller, not by Remy.** The correction came at *"anything else?"*: *"Yes. My address is 81 Oakland Drive."* **The rule 11 recap is the designed safety net for exactly this, and Finding A is why it never ran.** The two findings converge here: had the recap happened, the caller would have heard the wrong address in its proper place instead of having to interrupt the close. **PR #40 has since restored the recap** — the safety net now exists again, and the PR #40 verification call confirmed the recap runs before the close. **That is a mitigation, not a fix**: the recap only gives the caller a second chance to notice, and Remy will still accept an impossible house number in the first place.
  - **Extraction and final rendering — correct.** The owner-email summary carried **`Address: 81 Oakland Drive`**.

  **NOT verified.** Whether **`leads.metadata.service_address`** also holds `81 Oakland Drive`. The lead's copy is written by `recordLeadCallDetails` from `details.service_address` (`calls.ts:766`); the `Address:` line the owner reads is in the **generated summary paragraph** — `sendCallSummaryEmail` has **no structured Address field**. These are **two independent paths that are never compared**, and only the summary one was observed. Reading the production `leads` row was **blocked by the auto-mode permission classifier**; that check remains outstanding.

  **Test-coverage gap.** Correction handling is well covered *as prompt text*. Nothing covers a **house number** misrecognised as letters, and nothing asserts that the lead's `metadata.service_address` and the summary's `Address:` line agree — the exact class of divergence PR #39 had to fix for the caller's **name**.

  **STILL OPEN after PR #40.** PR #40 changed nothing about address handling — **rule 5 step 7 is byte-identical to what it was before that branch**, verified block-by-block against `main` at merge time. Finding B is untouched and is **not** to be picked up as part of other work.

  **Smallest safe correction (NOT implemented, awaiting approval).** A prompt-only addition to rule 5 step 7: a house number is **digits**, so if what was heard is not, query that part alone before accepting it — the same shape as the existing street-name check. **Do NOT implement a speculative address parser and do NOT change Vapi/provider configuration.**

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

Callback urgency rule (opened by PR #34, merge `7eff6ec`; **NOT closed by it** — see the live regression above. Closed by **PR #35**, merge `62afd12`, **live-production verified 2026-08-31**):

Urgency is **not** a callback time, and the two must never be confused — but the owner must still see it.

- **Urgency is decided from two signals, not one.** This is the whole substance of the correction. `resolveCallbackUrgency` (`src/lib/voice/callbackTiming.ts`) takes the caller's own phrase when the model supplied one, and falls back to the extracted **`urgent` flag** when it did not. Reading only `preferred_datetime` — what PR #34 shipped — loses the urgency on every call where the model **obeys** its own extraction schema, which is the normal case
- `sanitisePreferredDatetime` returns a real timing **or** an urgency phrase, **never both**. It remains a backstop for a model that *disobeys* and writes urgency into `preferred_datetime`; it is not, and never was, the primary source
- **A real timing wins outright.** When the caller gave a usable day or time, no urgency row is produced at all, so urgency can never compete with a field that means WHEN
- the value reaches the owner as a conditional **"Callback urgency"** row in the call-summary email (`src/lib/email.ts`) and a read-only note in the leads drawer (`LeadsTable.tsx`), and is kept on `leads.metadata.callback_urgency`
- it is labelled **as urgency, never as a date or a time**, and is HTML-escaped like every other caller-supplied value
- the dashboard note renders **outside** the datetime input, so it can never be edited or saved into `preferred_datetime`
- **Never fabricate the caller's words.** On the fallback path NiteOwl holds only a boolean, so the row reads `Urgent — no specific day or time given` (`URGENT_WITHOUT_TIMING`) — NiteOwl's own wording, rendered plainly and **not** as a quotation. Inventing a quote to fill the row would be the exact fabrication this rule exists to prevent
- the distinctions are pinned by tests that drive the **real `processCallEnded`**, not the email helper in isolation — the gap that let PR #34 ship broken

**Merged, deployed and live-production verified 2026-08-31.** A real urgency-only call — a burst pipe, *"As soon as possible. It's urgent."*, then no specific day or time — produced `Callback urgency: Urgent — no specific day or time given` in the owner's email, with callback date and time both "Not provided", no fabricated appointment datetime, booking status **REQUIRES REVIEW**, the email stating the appointment was not confirmed in the calendar, and no *"any time suits"* wording.

Caller-name integrity rule (closed by PR #39, merge commit `569cb8c`, **live-production verified 2026-09-01**):

**An email address must never manufacture a caller name.** A caller-supplied identity outranks a model inference, and an email outranks nothing at all.

- **No code derives a name from an email — the model does.** Read-only reproduction against the real extractor established the mechanism: when a caller name is absent or unclear, extraction fabricates a plausible person from the adjacent email local part (`jameshartley@gmail.com` → name `James Hartley`, 3 of 3 runs). **Which extractor produced the bad name on the live call was NOT established** — the provider's structured data and the transcript fallback are both possible and the logs no longer reach back — so the guard sits **downstream of both**, in `toExtractedLead`, where the two paths converge
- `name` was the **only** caller-supplied field in the voice pipeline with no deterministic backstop: `email` has `normaliseSpokenEmail`, `preferred_datetime` has `sanitisePreferredDatetime`. `resolveCallerName` in `src/lib/voice/nameIntegrity.ts` is the third, and is self-contained, synchronous and deterministic — **no model call, no network, no imports**
- the precedence rule: spoken support agreeing with the candidate keeps the candidate (it may legitimately be the fuller form); spoken support disagreeing with a candidate that **looks manufactured from the email** takes the caller's own word; spoken support disagreeing otherwise keeps the candidate, so **a later correction always wins and a stale first answer is never resurrected**; **no** spoken support plus a manufactured-looking candidate rejects it, so the owner sees the caller's real phone number rather than an invented person; otherwise the candidate stands exactly as before
- `findSpokenName` strips literal and spoken email spans **first**, so *"james hartley at gmail dot com"* can never be read as a name while *"I'm John, john@gmail.com"* still yields John. It is **evidence, not a guess**: anything ambiguous yields null
- the edit-distance rule (at least 6 letters, at most 2 edits) exists for one measured reason — on the live call the fabricated name and the local part differed by a single vowel (`erniesephora` vs `erniesophura`). It is consulted **only as a NEGATIVE guard when no spoken support exists**, so a legitimate John Smith with `johnsmith@gmail.com` is protected before it is ever reached. **Similarity alone is never proof that a name is invalid**
- **the persisted lead name and the owner-email Caller field derive from the same resolved decision and cannot disagree.** Guarding the lead alone was insufficient: the owner email read the raw `details?.name`, so the surface the defect was actually observed on bypassed the guard entirely. `callerName` now reads `extracted?.name`
- 28 tests, 5 of which drive the **real `processCallEnded`**; mutation-verified — bypassing the guard fails 2, removing spoken-name precedence fails 5

**Extended by PR #43 (merge `c104449`, deployed and production-verified 2026-09-02) — the guard could destroy a name the extractor got RIGHT.** The opposite failure to Ernesto's, and worse: there the model invented a name and the guard had to reject it; here the model was correct and the guard overwrote it.

- **The 2026-09-02 call.** Vapi's `structuredData` held the correct `"Jason Test"`; the transcript rendered the isolated spoken-name turn as `"JSON test"`; the email was captured correctly as `jasontest141@gmail.com`. `looksDerivedFromEmail` stripped digits from the local part, so `jasontest141` collapsed to `jasontest` — exactly the caller's own name — and reported an email-derived match. With the mangled transcript making `namesAgree` false, PR #39's rule 2 fired and replaced the correct name with the transcript rendering. The persisted lead and the owner email both received `"JSON test"`. **The email from the same `structuredData` object came through untouched — only `name` passes this guard, and only `name` was corrupted.**
- **The fix.** Digits are preserved when normalising the local part, and a digit-bearing local part is settled by the exact test alone — without that second part `johnsmith` vs `johnsmith82` is two edits, inside the existing edit-distance budget, so a real John Smith would still be destroyed. **Building an email from your own name plus digits is the ordinary human pattern**, and it no longer marks a caller as fictional. No JSON→Jason mapping, no dictionary, gazetteer, fuzzy correction or phonetic matching; no transcriber, prompt or provider change.
- **The trade, recorded rather than glossed over.** A name genuinely manufactured from a digit-bearing local part no longer trips the guard either — the evidence is identical for both cases. The costs are not symmetric, and that settles it: a false positive **destroys** a correct name, a false negative only leaves the candidate standing as it stood before PR #39. **This fails toward keeping the caller's own data.** All-letter local parts, including the observed `erniesophura`, are untouched.
- **Validation.** The real failing call replays through the **real `processCallEnded`**: lead name and owner-email Caller field both `Jason Test`, email preserved, `JSON test` absent. Ernesto protection preserved. Mutation-verified — restoring digit-stripping fails 6, removing only the digit short-circuit fails 1. 1240 tests pass / 0 fail across 220 suites; `tsc` clean; ESLint unchanged at 11. Production deployment `dpl_8Sc2X1sGmHuT8XXDuCUSEKoqF3vQ` reached READY carrying `niteowlhq.com` and the `git-main` alias, its `githubCommitSha` reading the merge commit itself; `/api/health` returned **HTTP 200** `{"status":"ok","database":"ok"}`.
- **No live call was required, and this is the distinction worth keeping.** Unlike PR #34 and PR #40, this is a **deterministic code defect**, replayable from the real production payload — so the suite genuinely closes it. A model-behaviour correction still could not be.

Closing-gate rule (closed by PR #40, merge commit `91d2bc3`, **live-production verified 2026-09-01**):

**Closing dialogue is forbidden until the applicable required-field gate is satisfied — and an urgent handoff acknowledgement is not closing dialogue, so saying one never licenses the transition.**

- the defect this fixes was a **TRANSITION, not a phrase**. Remy said the right sentence at the wrong moment and then behaved as though the call was closing. Banning the sentence would have been wrong: an urgent caller should hear *"I'll pass your request to the team straight away"* immediately
- rule 5's **COMPLETION GATE** now states that **URGENCY NEVER OPENS THE GATE**: an urgent **service visit** is a service request, keeps rule 5's full list, and **rule 13's shorter callback list does NOT apply to it**. Declining a time settles the **time** and nothing else, and is never a sign the call is ready to end. Email is named as the step this failure loses
- a handoff acknowledgement may be given **the moment it is true**, but must be followed by **the next unfinished item** — never *"anything else?"*, a recap, a goodbye, or rule 11's closing line
- rule 11 **defers explicitly to the gate** for when the call may end, and names its four lines as **CLOSING LINES** forbidden while a required field is open. **Having said something that sounded like one earlier never counts as having closed**, and the remaining debt is spelled out
- rules 6 and 12 mark their urgency acknowledgements as not closings; rule 13 separates its mid-call handoff phrase from rule 11's closing
- **a caller is never pressed.** Refusal still releases the gate (*"A caller who refuses or cannot give a detail counts as done for it"*), and *"Ask at most twice"* is unchanged, so a caller who declines a time is not asked again
- **no state machine, no new tool, no config key, no provider logic.** The live tool surface remains exactly `endCall` and `check_availability`, and a test pins that the assistant config's key set has not grown
- the sequence tests **parse the required-field list back out of the prompt** and replay the real 2026-09-01 call against it, rather than matching sentences — dropping `email` from the gate breaks that replay. This is the deliberate answer to the PR #34 gap, where an all-green suite proved only that the prompt *said* the right thing

**Model-behaviour corrections are not closed by tests.** This rule, like PR #34's, could only be confirmed by a live call, and was: on 2026-09-01 Remy requested the email before closing, did not skip a required field because the request was urgent, and ran the recap before the closing sequence.

Historical record — a cosmetic PR-number discrepancy in `main`, deliberately NOT corrected:

Merge commit **`3457927`** (the PR #39 documentation closeout) carries the message *"Merge pull request #40 from niteowl-bot/docs/pr39-live-verification-closeout"*. **No PR #40 existed for that branch** — it was merged locally with a hand-written message, and the number was guessed. GitHub later issued **#40 to the Finding A fix** (`fix/voice-required-fields-before-closing`, merge `91d2bc3`), so that message now points at an unrelated PR.

- **`main` history is deliberately NOT rewritten.** The discrepancy is cosmetic, the commit is already on `origin/main`, and rewriting shared history to fix a message is a far worse trade than recording it here
- the underlying facts are unaffected: `3457927` really is the PR #39 docs closeout, and `91d2bc3` really is PR #40
- **the lesson, which is the reusable part:** `git merge --no-ff -m "Merge pull request #N …"` does **not** create PR #N. Take the number from `gh` — or open the PR first — rather than guessing it in a merge message

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
