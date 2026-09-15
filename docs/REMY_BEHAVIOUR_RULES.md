# Remy — Standing Behaviour Rules

**Read the rule before changing the behaviour it governs.**

Every rule below was established by a shipped, verified PR and exists to stop a specific
defect returning. They are **not history**: they are the constraints that keep shipped Remy
behaviour from regressing, and they are as binding today as on the day each was written.

*This document was created on 2026-09-15, when `PROJECT_CONTEXT.md` exceeded the active
context limit. **Every rule below was moved here verbatim from `PROJECT_CONTEXT.md`** — no
rule was added, removed, reworded, weakened or summarised in the move. `PROJECT_CONTEXT.md`
keeps a one-line index of every rule and points here.*

**This document is the only prose record of PRs #42–#70 outside git history.** `CHANGELOG.md`
is **not an exhaustive PR index**: it has **no entry for PRs #27, #28 or #30**, whose record is
Part 1 below, and **none for PRs #42–#70**, whose record is Part 2. The voice and
caller-integrity guard series was recorded in `PROJECT_CONTEXT.md` and nowhere else, which is
why these blocks were moved rather than dropped as duplicates.

**Related canon:** the architecture is `docs/ARCHITECTURE.md` (Parts I–XV); shipped history
with test counts and deployment detail is `CHANGELOG.md`; current state and status is
`PROJECT_CONTEXT.md`. The **canonical-information architecture** — *one canonical fact, many
renderings* — is the invariant these rules serve, and it is stated in `PROJECT_CONTEXT.md`
because it governs every change to the voice path.

## Contents

**Part 1 — Verification record.** The PRs #27–#40 live-production checkpoints, including the
PR #34 regression and the lesson that generalises from it.

**Part 2 — The standing rules.** Dashboard timezone · customer manage-link timezone · email
timezone · the standing timezone rule · password recovery and auth callback ·
cross-conversation lead matching · reschedule availability · voice calendar booking status ·
voice booking closing · callback urgency · caller-name integrity · closing gate ·
service integrity · service-address authority · caller-email evidence · caller-timing
evidence · the historical PR-number discrepancy · service matching and its deferred false
positive.

---

# Part 1 — Verified production checkpoints

*Editorial note: the block below was moved verbatim from `PROJECT_CONTEXT.md`; "the
shipped-feature list above" refers to the shipped-feature list in `PROJECT_CONTEXT.md`.*

Verified production checkpoints (PRs #27–#40). The shipped-feature list above and the
standing rules below are the canonical record of *behaviour*; this list is the record of
*verification*. Full narratives — root cause, test counts, mutation results — are in Git
history at each merge commit. `CHANGELOG.md` records much of this history from PR #34
onward where applicable.

- **PR #27**, merged and deployed. The owner call summary reports the **final persisted booking status**, not an interim one.
- **PR #28**, merged and deployed, **production-verified**: plumber/plumbing morphology now matches ordinary word forms. The same verification produced a genuine `booked` lead with a synced calendar integration link, which is what proves **live voice → Google Calendar booking end-to-end**.
- **PR #30** (`dbf299b`), merged, deployed, **production-verified** 2026-08-27. Remy's spoken closing tells the truth about what is known while the caller is on the line — see the voice booking closing rule below.
- **PR #34** (`7eff6ec`), merged and deployed (`dpl_9WhkwnRC6XAhg8HQ8q741VBz1bDj` READY, `git-main` alias, `/api/health` HTTP 200). It added the conditional **"Callback urgency"** row and leads-drawer note. **The merge and deployment facts stand; the behavioural claim did NOT** — see the regression below. Recorded rather than quietly rewritten.
  - **Live post-merge regression, 2026-08-31 — PR #34 did not work end-to-end.** A real urgent call produced **no "Callback urgency" row at all**. **Root cause:** extraction returned `urgent: true` with `preferred_datetime: null` — exactly what `src/lib/voice/extraction.ts` instructs — but `calls.ts` derived `callbackUrgency` **only** from `preferred_datetime`. **PR #34 read a field the prompt above it is designed to leave empty.**
  - **Why the tests missed it, and the lesson that generalises:** the PR #34 tests supplied `callbackUrgency` directly and checked it rendered; nothing exercised the step that *decides* it against the shape production emits. **All 54 passed while production did nothing. A test that supplies the value under test cannot prove the pipeline that produces it.**
- **PR #35** (`62afd12`), merged, deployed (`dpl_BbGd7nezo2CKCG3pn8B8KZWnoZkA`) and **live-production verified 2026-08-31** — the fix for the above. `resolveCallbackUrgency()` reads **both** signals. Verified on a real burst-pipe urgency-only call: the email rendered `Callback urgency: Urgent — no specific day or time given`; callback date and time both "Not provided"; **no fabricated appointment datetime**; status **REQUIRES REVIEW** with the email stating the appointment was not confirmed; and no incorrect *"any time suits"* wording. See the callback urgency rule below.
- **PR #37** (`13883e1`), merged, deployed (`dpl_9daL9V8cAb7376hVBDyThY9NdHm9`) and **live-production verified 2026-08-31.** A separate defect found by the same call: the owner email showed *"REQUIRES REVIEW — The requested appointment was not confirmed in the calendar"* on a call where **no time was ever requested**. It conflated **"we tried and could not"** with **"there was nothing to try"**. The block now renders only when `callbackTiming.preferredDatetime` is set — gated on the **sanitised** requested phrase deliberately, so fail-closed is preserved and urgency-as-time cannot return. Verified live: urgency row present, callback date/time "Not provided", **the false block absent**, no false booking attempt.
- **PR #39** (`569cb8c`), merged, deployed (`dpl_5jeEKH4NVzsyyAMMEU2GvFUE9Lc5`) and **live-production verified 2026-09-01** — an email address can no longer manufacture a caller name. Verified on a real call where the caller said "Ernesto": the structured **Caller** field, the subject line and the generated summary all read **Ernesto**, and the two surfaces agreed. No email was collected on that call, so the guard held on the path where it matters most. PR #35's urgency row and PR #37's no-false-booking behaviour both survived the change. See the caller-name integrity rule below. *(Deployment identified by timestamp adjacency plus the `git-main` alias, not by a SHA comparison — `vercel inspect` carried no git metadata.)*
- **PR #40** (`91d2bc3`), merged, deployed (`dpl_8xEYiKCKpQ6cntxRyPGVjX1nhavm`, `githubCommitSha` reading the merge commit itself) and **live-production verified 2026-09-01. Finding A CLOSED.** Verified live: Remy **requested the email before closing**, **did not skip a required field because the request was urgent**, and **ran the recap before the closing sequence**. **This is the part that matters** — PR #40 is a model-behaviour prompt correction, so the suite could prove the instruction present, coherent and mutation-sensitive, but never that the model obeys it. Only a live call could close it. See the closing-gate rule below.


---

# Part 2 — The standing rules

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

Password-recovery and auth-callback rule (closed by PR #96, merge `eeed1f7`, and PR #97, merge `8ccddc6`, both 2026-09-14; **cross-device recovery V1-verified in production 2026-09-14**):

**A recovery link must work from ANY browser or device, and an auth redirect must be consumed by official Supabase APIs into the existing SSR cookies — never by a parallel session store.**

- **`/auth/confirm-reset` accepts exactly three link shapes** (`src/lib/auth/recoveryLink.ts`, pure): `token_hash` + `type=recovery` → `verifyOtp({ type: 'recovery', token_hash })`; `code` alone → the original PKCE `exchangeCodeForSession`; nothing → forwarded to `/reset-password` so a fragment can be consumed client-side. **Everything else is refused before any Supabase call** — a hash without a type, a type without a hash, any other type, an empty / whitespace / over-length hash, both shapes at once. Success → 307 `/reset-password`; any failure → 307 `/forgot-password?error=link`
- **`type` is a literal in code.** The URL's `type` only gates entry to the branch, so a magic-link, signup or invite token can never be relabelled into a recovery session
- **The production Reset Password email template sends `{{ .SiteURL }}/auth/confirm-reset?token_hash={{ .TokenHash }}&type=recovery`** — a fixed route on the Site URL, no Supabase `/verify` redirect hop. This is what makes recovery cross-device: `verifyOtp` needs nothing from the requesting browser. **The PKCE `?code=` shape is same-browser-only by design** — the code verifier is a host-only cookie set only in the profile that called `resetPasswordForEmail`, and a failed exchange deletes it — which is why the first real production test failed even though PR #96 was working as designed. The `?code=` branch is kept for links already issued, not as the primary path. **Any future template change must keep the route deployed first and the template second**; the reverse breaks every reset email until the deploy lands
- **Implicit-flow fragments (`#access_token=…`) are consumed once, client-side, through `setSession()`** (`src/lib/auth/hashSession.ts`, mounted once in the root layout by `AuthHashSessionHandler`): the fragment is stripped via `history.replaceState` **before** any network call, `setSession` verifies the token against Supabase before saving through the SSR cookie storage, a malformed / error / rejected fragment produces no session, and the destination is a **fixed literal** chosen from the fragment's `type` (`/reset-password` for recovery, else `/dashboard`). `@supabase/ssr` hard-codes PKCE and auth-js rejects an implicit fragment on a PKCE client, so **no page's browser client can consume one on its own** — this handler is the only consumer. `/reset-password` awaits that consumption before its `getUser()` gate, and the gate is unchanged: no session, no form
- **No token in any log, redirect `Location`, error body or console**, and no localStorage / sessionStorage auth. Verified live with a synthetic value on every branch
- **Magic-link authentication is deferred to V1.1/later and is NOT a V1 blocker.** The app has no magic-link sender; the dashboard's *Send magic link* necessarily targets the production Site URL; and the fragment consumer fails closed. Recorded as unverified rather than assumed
- **Known, unchanged exposure:** a `token_hash` link is consumed by any GET, so a mail-scanner pre-visit burns it. The Supabase-hosted link had the same single-use exposure; a click-to-confirm mitigation is V1.1

Cross-conversation lead matching rule (closed by PR #70, merge commit `8833896`, deployed 2026-09-07):

**Identifying the PERSON is not identifying the APPOINTMENT. A confirmed booking may be reached by the conversation it was made in, never by contact details from a later one.**

- **layer 1 — same `conversation_id`** — keeps the **full** `MERGEABLE_STATUSES`, `booked` included. Within one conversation the person and the appointment coincide, so a genuine in-session reschedule still merges and still moves the Google event
- **layers 2 and 3 — cross-conversation** (email/phone with no time bound; same-source 30-minute recency) — use `CROSS_CONVERSATION_MERGEABLE_STATUSES`, the same list **minus `booked`**. The 30-minute bound narrows WHICH lead can be reached, never WHOSE, so layer 3 needs the same exclusion as layer 2
- the cross-conversation set is **derived** from `MERGEABLE_STATUSES`, not written out, so the two cannot drift: a status added later is mergeable in-conversation by default, and `booked` is the single documented exclusion
- **a second booking is a second lead.** Two visible records the owner can reconcile, never one record silently moved — and **never** a customer's confirmed appointment rescheduled by a request that was not about it
- **a cross-conversation reschedule creates a second lead too**, deliberately. `/api/bookings/manage` is the designed reschedule path and is unchanged
- **voice is unaffected** — `findOpenLeadForCapture` returns null for `source === "voice"` before either layer, and that exemption is untouched
- `PROTECTED_STATUSES`, `isBookingCompletedByContactUpdate`, the calendar-rescheduling implementation and the manage-booking flow are all unchanged. **Do not close this differently later** by removing `booked` from `MERGEABLE_STATUSES` globally, or by putting a time bound on layer 2 — both were considered and rejected

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
- **THE FLAG HAS THREE STATES, AND ONLY `true` ACTS (PR #68).** `details.urgent` is `true` when the provider said the caller was urgent, `false` when it said they were not, and **`null` when it said nothing usable** — absent from a partial payload, blank, or not a boolean. Every consumer tests `=== true`, so `null` behaves exactly as `false` does and **absence never becomes urgency**. This is representation, not recovery: nothing reads the transcript for urgency, and **transcript-based urgency recovery is deferred to V1.1/later**
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

Service-integrity rule (closed by PR #54, merge commit `36805b8`; producer contract aligned by PR #56, merge commit `a71815d`; both deployed 2026-09-03):

**The canonical requested service must be grounded in the CALLER'S own speech on the current call.** A service the caller never asked for must never become canonical.

- **caller turns are the only evidence.** Assistant speech, Knowledge Base terminology and model-invented labels establish nothing — and the assistant is the one party on the call holding the business's own "Services Offered" vocabulary in its prompt, which is precisely why its turns are excluded
- **explicitly negated caller wording is not support.** "It's not the boiler, it's the radiator" supplies `radiator`, never `boiler`. Bare "no" is deliberately **not** a negation cue: "no hot water" is one of the commonest ways a caller names the thing they are ringing about, and treating it as a negation would destroy real caller information — the opposite of this guard's purpose
- **keep, reduce, or refuse.** A fully supported candidate is kept exactly as written, so reordering and morphology survive ("my radiator is leaking" fully supports "leaking radiator"). A partly supported candidate **falls toward the caller's own wording** rather than preserving the invented portion ("radiator repair" becomes "radiator"). An unsupported candidate is **refused**, and the canonical service resolves to **null**
- **the result is always a subsequence of the model's own candidate.** That is what makes "it cannot invent a service" a property of the code rather than a claim about it — it has no way to produce a word the candidate did not already contain, so it can never resurrect a service the caller superseded
- `resolveRequestedService` (`src/lib/voice/serviceIntegrity.ts`) is **synchronous, deterministic, model-free, network-free and vocabulary-free**. **It is NOT a taxonomy, a classifier, a fuzzy matcher or a semantic service-inference system** — it is a provenance boundary. It never decides what a call was about and holds no trade vocabulary. Its only domain knowledge is PR #28's existing `stemServiceWord`, so the guard and the Knowledge Base matcher agree about word forms instead of each having an opinion
- **one resolver at the convergence point, not a guard per consumer.** Both extraction paths — provider `structuredData` and the transcript fallback — converge in `toExtractedLead`, and the resolved value is produced there. Every downstream consumer then reads it: the lead row, the KB check, calendar-booking eligibility, the calendar event title, the owner email row, the customer confirmation and the dashboard. **Adding a separate guard to each consumer was deliberately avoided** — that is the anti-pattern the PR #39 defect and PRs #45–#47 exist to remove
- **refusal is fail-closed for booking, and never destroys an otherwise genuine lead.** This is NOT "every call creates a lead". An unsupported service does not unlock calendar-backed booking, because the Knowledge Base gate is only as sound as its input and an invented label that happens to match the KB would be rubber-stamped. Lead capture still proceeds wherever other genuine caller substance exists — a name, a time, or urgency. Only when the refused service was the **sole** substance is no lead created, and in that case the guard has established the call contained nothing the caller supplied
- the trade is deliberately asymmetric. A false positive persists a service nobody asked for, shows it to the owner, titles an engineer's diary entry with it and sends it to the **customer**. A false negative gives the owner the caller's own rougher wording, or no service at all — and **absence is already rendered as absence** everywhere: no Service row, a plain "Appointment" event title, no service line in the customer's email. **The caller's truth outranks a tidier label**
- **BOTH PRODUCERS MUST ASK FOR THE SAME THING (PR #56).** A guard that refuses ungrounded wording is only half the rule: a producer instructed to paraphrase will keep handing it values it must refuse, and every one of those is a booking lost for no reason. The `structuredData` schema and the transcript-fallback prompt now state the **same** contract for `service` — the caller's own words, never expanded, renamed, relabelled or made more specific. **A future prompt change to either producer must keep them aligned**, and asking a model for a "summary" or a canonical label of a caller-supplied fact is the specific mistake to avoid. The guard stays the enforcement boundary regardless: aligning a producer never licenses relaxing it
- **PRODUCER OUTPUT IS JUDGED BY SEMANTIC SUBSTANCE, NOT CONTAINER EXISTENCE (PR #58).** A syntactically valid provider object must never suppress a recovery path merely because the object exists. When an extraction producer supplies **no substantive supported caller information**, it is treated as **absent** for producer-selection purposes — that is decided once, at the parser boundary, so every consumer reads the same answer. `parseStructuredDetails` therefore returns null for `{}`, for an all-null object, and for one holding only empty or whitespace strings; it returns the object whenever any supported field carries substance. **`urgent: true` IS substance** and must never be collapsed away — losing it is the PR #35 failure again; **`urgent: false` is not**. *(The original reason given here — that `false` is indistinguishable from no urgency signal — stopped being true with **PR #68**, which made the two distinguishable. The rule is unchanged and the reason is now stated properly: a payload whose only content is "not urgent" describes no enquiry, so it must keep reaching the transcript fallback. `null` does not count either, for the plainer reason that the provider said nothing.)* **This is not arbitrary truthiness**: the test is over the named supported fields and is written `=== true`, so a field added to the parser and forgotten in the check would silently stop counting.
- **The two producer rules are SEPARATE lessons and must stay separate.** PR #56 aligned **what** the two producers are asked to produce; PR #58 ensures an **empty result from one producer does not prevent the other from running**. Collapsing them into one vague principle loses both. Neither rule permits **merging** the producers: whichever one runs, it runs alone.
- **PR #58 AND PR #62 OPERATE AT DIFFERENT LAYERS, AND THE DISTINCTION MATTERS.** PR #58 is **record-level producer selection**: an EMPTY payload means the provider said nothing, so the fallback extractor runs. PR #62 is **field-level evidence recovery** on a PARTIAL payload: the provider did speak, its selection stands, **the fallback extractor is still never invoked**, and one field is recovered afterwards from the caller's own turns by a deterministic guard — the mechanism `resolveCallerName` and `resolveServiceAddress` have always used on that same path. The superseded email expectation in `tests/voiceStructuredDataEmpty.test.mjs` records this new field-level recovery; **PR #58 was neither weakened nor reversed**, and its extractor-never-invoked assertion still passes. **PR #66 is the same layer as PR #62**, for `preferred_datetime`, and updates that same test's timing expectation for the same reason: `urgency` and `service` there are still not completed, because neither has such a guard.

Service-address authority rule (closed by PR #60, merge commit `a07a06a`, deployed 2026-09-04):

**A provider value is not authoritative merely because it is well formed. Explicit caller evidence outranks it — and where neither can be trusted, NOTHING is recorded.**

The resolved order in `resolveServiceAddress`, deterministic throughout:

- **different place → the caller wins.** Reliable caller-spoken evidence naming a different place beats the provider candidate. `81 Oakland Drive` against a provider `12 Meadow Court` resolves to **81 Oakland Drive**
- **same place, agreeing → the candidate stands, byte for byte**, including a fuller provider rendering (`81 Oakland Drive, Galway`, `Flat 2, 14 Mill Road`). Nothing the provider held is dropped
- **the candidate lacks a house number the caller gave → recover it.** Substring containment is required, so taking the caller's wording can only **ADD** the number and can never lose part of the candidate — `Oakland Drive, Galway` is left alone
- **same street, CONFLICTING house numbers → correction, or nothing.** If deterministic transcript ordering proves the caller **superseded** the candidate's number with a later corrected one, their final word wins. Otherwise **no service address is recorded at all**. `81 Oakland Drive` and `12 Oakland Drive` are two front doors, not two renderings, and choosing either would send an engineer somewhere on a coin flip
- **explicit caller self-correction remains authoritative**, and is the only thing that resolves a numeric conflict. `findSpokenAddresses` returns the caller's addresses **in order**, so a superseded value is identifiable from the caller's own turns — evidence, not inference. `findSpokenAddress` is unchanged, and is now that list's last element
- **unreliable evidence changes nothing.** Silence, no address question, an ambiguous reply, a fragment, evidence that is itself transcription noise, a spelt-out number, or an address only the **assistant** said all leave the provider value exactly as the model wrote it. This is **not** "the transcript always wins"

Two boundaries worth keeping in mind before extending it:

- **only COMPARABLE numbers conflict.** A spelt-out `eighty one` would need a number-word table, and `Flat 2, 14 Mill Road` does not carry its number in the position read. Both yield no comparison and leave prior behaviour untouched — **conservative, not clever**. Widening this means adding inference, which this module does not do
- **refusal is NOT a booking failure.** The service address was never a booking gate, so an unresolved conflict keeps the appointment and simply sends the calendar event with **no location** — the existing "absence is rendered as absence" semantics, with no new conflict field, flag or surface. The owner still has the caller's phone number, and **a wrong address is worse than none**

Caller-email evidence rule (closed by PR #62, merge commit `c2d48b7`, deployed 2026-09-04):

**A provider value that survives normalisation is authoritative. Only when it does not is the caller's own speech read — and only where the CONVERSATION establishes that the caller is giving their address.**

- **the provider wins first.** `resolveCallerEmail` runs the existing `normaliseSpokenEmail` on `details.email`; if that yields an address it is returned and the transcript is **not consulted at all**. No comparison, no conflict resolution. A structured-versus-transcript disagreement is **out of scope**: there is no deterministic way to say which of two valid addresses is wrong, and no corruption path has been shown. **This is not "the transcript wins"**
- **absence is one path, not two.** A field the provider omitted and a value that cannot be made into a valid address are the same absence after normalisation, so malformed input gets no authority class of its own
- **evidence is CUE- or QUESTION-ANCHORED, never a span search.** A candidate is read only from an answer to an **explicit assistant email request** in the immediately preceding turn, or from an **explicit caller self-declaration** (`my email is …`, `you can email me at …`) whose cue supplies the left boundary. The candidate is then handed to the **unchanged** normaliser — locating and normalising stay separate responsibilities
- **CALLER TURNS ONLY. An assistant turn can supply question context and nothing else.** Remy is the one party on the call speaking a model-generated address back, so reading its turns would launder its own guess into caller evidence — including when its read-back is phrased exactly like the self-declaration cue, where **only the speaker separates the two**
- **a bare acknowledgement is not the caller supplying an address.** "Yes", "correct", "that's right" against a read-back confirm the assistant's transcription, not the address itself; if it mis-heard, a confirmation goes to a stranger
- **the LAST reliable caller value wins**, across turns and within one turn, so an explicit self-correction is deterministic ordering rather than inference — the same authority the address guard uses
- **clause boundaries bound every candidate.** The caller's own commas and sentence ends, so `John Smith, john dot smith at example dot com` and `…, if that's easier` both read correctly, and a leading `No,` on a correction is stripped as `addressIntegrity` already does. **A whole clause is never a sub-span**, which is what makes truncation structurally impossible
- **nothing is ever completed or invented.** An incomplete address gets no TLD, ordinary speech containing `at`/`dot` yields nothing, and a free-floating or third-party address with no question or cue behind it is not the caller's own — the field means *this caller's* email

Caller-timing evidence rule (closed by PR #66, merge commit `bd5853a`, deployed 2026-09-07):

**A provider timing that survives the sanitiser is authoritative. An urgency answer is an ANSWER, not an absence. Only genuine absence admits the caller's own speech — and evidence must pin a DAY of its own.**

- **the provider wins first.** `resolveRequestedDatetime` runs the existing `sanitisePreferredDatetime` on `details.preferred_datetime`; if a real timing survives it is returned byte for byte and the transcript is **not consulted at all**. No comparison, no conflict resolution. **This is not "the transcript wins"**, and structured-versus-transcript conflict stays deliberately out of scope, exactly as for email
- **URGENCY BLOCKS RECOVERY.** The caller was asked when and said "as soon as possible"; that is their answer, so a day mentioned elsewhere on the call must never outrank it. The urgency still reaches the owner unchanged (PR #35), and this is the one place the timing rule differs from the email rule — an email has no equivalent of "I answered, and my answer was that I don't have one"
- **only an absent or blank field is an absence.** Then, and only then, deterministic caller-turn evidence is read
- **EVIDENCE SELECTION, NOT DATETIME PARSING.** The recovered value is the caller's **phrase**, and `parseDatetimeToIso` resolves it exactly as it resolves a provider phrase — organisation timezone, DST, `snapToNamedWeekday`. The guard never parses, resolves, completes, repairs or converts a datetime, which is why **no timezone, availability, calendar or booking semantics changed**
- **a DAY is required; a clock alone is not enough.** *"AI: what time on Friday? / User: 3 PM"* has a caller-spoken clock whose day came from the assistant, and resolving it would book the wrong day. A bare day part and a spelled ordinal with no month are refused for the same reason. **Incomplete-but-anchored timing is recovered and follows the parser's existing clarification behaviour** — it is not completed here
- **caller turns only, anchored to an explicit timing question or an explicit caller cue.** **Assistant turns are never read**, including when the assistant's own offer is phrased *exactly* like a recognised caller cue (*"How about Tuesday at 2?"*) — **only the speaker separates a suggestion from evidence**, and reading it would launder a model-generated time into a booking nobody asked for
- **a bare acknowledgement supplies nothing.** "Yes", "correct", "that's right" confirm the assistant's proposal, not a time. A caller who restates the time in their own words IS evidence — the distinction is the speaker, not the value
- **the LAST reliable anchored caller value wins**, across turns and within one turn, so a correction is deterministic ordering rather than inference — the same authority the address and email guards use
- **ordinary speech is never a booking preference.** A house number, a phone number, a duration, a quantity, and a day mentioned while describing the problem rather than answering about timing all recover nothing
- **resolved once, in `processCallEnded`, and passed to every consumer.** The lead, the owner's urgency decision, the booking-status gate and the requested-time row read the same decision

**PARTIAL PROVIDER OUTPUT MUST NOT SILENTLY ERASE RELIABLE CALLER INFORMATION — but the fix must never become "two independent AI readings hoping they agree".** Field-level recovery requires a **deterministic provenance and authority rule**. PR #62 was the first implementation of one, for email; **PR #66 is the second, for requested timing**. **A field without such a rule stays unrecovered** — `urgency` and `service` still are — and the longer-term direction remains a single canonical extraction/provenance architecture, which is **not** started.

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

**PR #54 (F5) did not change the matcher, and did not close this.** It changed only what reaches it: the value handed to `isServiceConfirmedByKnowledge` on the voice path is now the caller-grounded resolved service, so the matcher is no longer asked to judge a label nobody spoke. The `requiredMatches` false positive above is **unaffected and still open** — it is a property of the matcher, and chat and the widget still pass an unguarded value. **`extracted.service` remains untrusted as a service identity.**

The safer future direction is a distinct upstream signal — conceptually `requested_service` — but that is **DEFERRED and not approved**. It is a proper architecture task across voice, chat and widget requiring: an explicit semantic contract; a clear split between requested service identity and problem description; **constrain-only** semantics (may refuse, may never confirm); fallback to existing behaviour when absent or uncertain; adversarial tests; provider-independent boundaries; identical behaviour across all three surfaces; PR #28 morphology preserved; fail-safe throughout; and no hard-coded trade taxonomy unless separately justified.

**Do not casually retry any of these** — each was investigated and rejected:

- another preposition/qualifier heuristic (proven to cause false negatives)
- more stop-word tuning (an ever-growing list; breaks on "I require assistance with…")
- trade-name suffix heuristics (`-er` catches `under`, `water`, `other` — verified to break `"leak under the shower"`)
- fuzzy matching, edit distance, embeddings, or an LLM call inside the matcher
- hard-coded trade vocabularies or industry-specific lists
- cross-record contradiction as the sole fix (never fires on a single-service KB, so it misses this very case)
- lowering `requiredMatches` or any arbitrary threshold change (amplifies the false positive)
