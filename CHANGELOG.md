# Changelog

All notable changes to NiteOwl will be documented in this file.

## 2026-08-28 (Voice — the callback urgency the caller gave now reaches the owner)

**`fix/callback-urgency-owner-visibility`, implementation commit `9bdfaf3`, rebased onto `e785942` as `f9ed564`. PR NOT YET RAISED — not merged, not deployed.** 1129 tests pass / 0 fail, 203 suites; `tsc --noEmit` clean; ESLint unchanged at 11 pre-existing problems, none in a changed file.

**No schema, RLS, Vapi prompt, two-tool voice surface, booking, calendar, availability, lead-capture, provider or configuration change.** Four files: three production, one test file.

### The gap
The 2026-08-06 callback fix did half the job. Urgency-only phrases — "as soon as possible", "ASAP" — stopped becoming a callback date or time, and the caller's own words were kept on `leads.metadata.callback_urgency`. **Nothing ever read that field**: not the owner's call-summary email, not the leads dashboard. So a caller who wanted a ring back urgently arrived looking exactly like one who declined to give a time at all, and the most urgent callers were the least distinguishable. The data already existed; this exposes it.

### The fix
- **`src/lib/email.ts`** — `sendCallSummaryEmail` takes an optional `callbackUrgency` and renders one conditional **"Callback urgency"** row, HTML-escaped like every other caller-supplied value.
- **`src/lib/voice/calls.ts`** — passes the already-computed value through. Wiring only; no change to how urgency is captured, sanitised or stored. A comment claiming the urgency "still reaches the owner" was false when written and is now true.
- **`LeadsTable.tsx`** — a read-only note under the timing field, rendered only when the value exists and deliberately **outside** the input, so it can never be edited into `preferred_datetime`.

**Urgency is surfaced as urgency, never as a date or a time.** `sanitisePreferredDatetime` returns a real timing *or* an urgency phrase and never both, so the row appears only when there is no callback time to show and can never compete with a real one. The three-way distinction — a real time shows as a time, urgency shows as urgency, neither invents anything — is preserved and pinned.

### Coverage
10 tests added to `tests/callbackTiming.test.mjs`, 54 in that file. Six drive the real send path — urgency named in the caller's own words, labelled as urgency rather than a time, escaped, and absent when a genuine callback time exists. Four are structural over `LeadsTable.tsx`, following the `calendarEventCreation.test.mjs` precedent: this repo has no React renderer, and the test file states that limitation. Mutation-verified — removing the email row breaks 2 tests, and binding urgency into the datetime input breaks 1.

## 2026-08-19 (Rescheduling — a move is checked against the real calendar, and no longer against itself)

**PR #25 — `fix/reschedule-external-availability`. MERGED AND LIVE** via a normal GitHub merge commit, `4784cfc36ea18e3acadac0232e4a2c9cd33ede19`. Two Phase 1 implementation commits: the original fix `b2e80e7` and the corrective fix `ce48832`. The merge-triggered production deployment `dpl_BciwumDpGX5A6QRQzVicEL4wyPQS` (target `production`, commit `4784cfc`) reached **READY** and serves `niteowlhq.com`; the live `/api/health` returned **HTTP 200** with `{"status":"ok","database":"ok"}`. **1032 tests pass / 0 fail**, 189 suites; `tsc --noEmit` clean; ESLint unchanged at 11 pre-existing problems, none in a changed file.

**No schema, RLS, OAuth, Vapi, Twilio, timezone, provider, configuration or environment-variable change.** Six files: three production, one test file, two documentation corrections (`HANDOFF.md`, `CHECKLIST.md`).

### The defect (`b2e80e7`)
Both reschedule routes — the owner dashboard (`src/app/api/leads/route.ts`) and the customer manage link (`src/app/api/bookings/manage/route.ts`) — still called `isWithinBusinessHours` + `isSlotAvailable`, which are **internal checks only**. Chat and the widget were routed through `checkBookingSlot` on 2026-08-12 (`369b099`); these two were not, so a move could land straight on top of an appointment that exists in the business's own Google Calendar.

The gap was real for organisations **not** on `CALENDAR_EVENT_CREATION_ORG_IDS`. An allowlisted org was already protected by `rescheduleAppointmentOnCalendar`'s pre-write re-check; a write-disabled org gets `no_calendar` from the sync layer, which does nothing, so the move went through. Availability **reads** are gated separately, which is why the calendar can be consulted for those organisations at all.

Both routes now make the same decision every other booking path makes: hours, then capacity, then the external calendar. It also closed a truthfulness gap — a failed hours read, a failed capacity count or an unreadable calendar used to return the untrue "that time is fully booked". They now return **503 "we couldn't confirm that time"** and leave the appointment untouched. **"Cannot check" is never "that time has gone."**

### The self-overlap regression, and its fix (`ce48832`)
Caught during merge-readiness review, before the merge. Free/busy carries **no event identity** — a busy block is just a span — so a calendar-backed appointment moving 10:00 → 10:30 met its **own** event and was refused `409 "That time is no longer available."` Measured against `b2e80e7`: both routes returned **409** where `main` returned **200**.

The gap was exactly symmetrical with one already closed internally. `excludeLeadId` stops the lead's own row counting against its move in the capacity count; nothing did the same for the calendar. The new `rescheduleExclusion` option on `checkBookingSlot` is that missing half, and both routes pass it via the shared `appointmentBusyWindow()` helper.

**Subtraction, not matching.** Only the span the appointment already occupies is freed, never an event: a genuine 10:45–11:45 booking survives as 11:00–11:45 and still refuses the move, and the single merged 10:00–12:00 block Google returns for two touching events is trimmed to 11:00–12:00 rather than cleared. Dropping whole intervals that merely *overlap* the old window would have waved another customer's appointment through. The rule underneath: the only time a reschedule newly claims is (new window − old window), and subtraction leaves precisely that remainder to be checked against the real calendar.

### Not changed
Google Calendar creation, reschedule and cancel semantics; feature flags; OAuth; Vapi and Twilio; timezone handling; `appointment_datetime` storage; capacity, business-hours and availability logic for new bookings. Callers that pass no exclusion use the busy list exactly as fetched, so **new bookings are unaffected**.

### Coverage
`tests/rescheduleExternalAvailability.test.mjs` — 46 tests, 17 of them added by `ce48832`, every case run against **both** routes with the appointment genuinely present in the stubbed free/busy response (the gap that let the regression through): the allowed short move; a genuine second event in the new window; a second event *overlapping the old window*; a merged busy block; an unrelated busy period; the fail-closed 503 on an unreadable calendar; and an unconnected organisation.

**Mutation-verified**: ignoring the exclusion breaks 2 tests, and replacing subtraction with wholesale interval removal breaks 4 — the two "not swept away" and "merged block" cases exist precisely to catch that unsafe design. The original five `b2e80e7` mutations still hold.

### Known limitation
An event lying **entirely inside** the appointment's own window (e.g. 10:15–10:45 within 10:00–11:00) is subtracted away with it. This is **inherent to Google free/busy**, which exposes no event identity: within the span we already occupy, our event and a coincident one are indistinguishable, and Google merges touching intervals anyway. The internal capacity check (with `excludeLeadId`) runs first and catches any *other lead* in that span, so this requires a Google-only event invisible to our database. It is also strictly more conservative than the previous behaviour, which skipped the external check for overlapping moves entirely. Documented, accepted, and unchanged by this release.

### Voice calendar booking remains off
`VOICE_CALENDAR_BOOKING_ENABLED` is **absent from the production environment entirely** — verified against the full production variable list after the merge. `isVoiceCalendarBookingEnabled` requires the exact literal `"true"`, so an absent variable reads as **off**: voice calendar booking (PR #23) remains disabled in production.

## 2026-08-18 (Architecture Part III — the compounding moat is history, and history is currently overwritten)

**Documentation only. No production code, schema, SQL, RLS, flag, environment variable, dependency or provider was changed** — and none is requested. `docs/ARCHITECTURE.md` gained **Part III — Compounding Moat and Outcome Intelligence** (§17–33), extending Parts I and II rather than duplicating them; `CHECKLIST.md`'s architecture-map pointer was updated. Written against `c7d9b78`.

### Why
Parts I and II asked whether the architecture survives growth and survives its providers. Part III asks what is left once every capability in the product is commoditised. The answer is not "several AI specialists over shared data" — every component of that is purchasable in weeks to months. It is the accumulated record of **what was decided, what was done, and what followed**, which cannot be back-filled by anyone starting later.

### The finding that matters — M1
**NiteOwl records state, not history, and the state is destructively overwritten.** `leads` is mutated in place: status replaced, `appointment_datetime` overwritten on every reschedule, contact fields merged. There is **no revision table and no audit trigger on `leads`** — unlike `business_knowledge`, which has both. So how many times an appointment moved, who moved it, what was originally requested, and whether a cancelled customer came back are **permanently unanswerable for every booking already taken**.

This re-prices the existing C3 finding (a returning customer's second booking overwrites their first): it is a correctness bug *and* the clearest case of history loss, destroying the record of the most valuable customer — the one who came back. **Cost went up; urgency did not.** Production holds test orgs only, so almost nothing has been lost yet. Settle it before the first paying business, not before the calendar work.

### The finding that makes the rest cheap — M2
**The decision record is already computed and then thrown away.** `calendarSync`'s seven outcomes, `checkBookingSlot`'s reason codes, `bookingOutcome.ts`, and `parseDatetimeToIso`'s `failed`/`needsClarification` produce outcome, evidence, alternatives and confidence at one choke point, at one instant — the exact shape of a decision record. They are used to phrase one reply and discarded. When this is eventually persisted it is a projection of known values, not new instrumentation.

### What Part III adds
Business Operating State named as a **read model, not a stored object**; the Outcome Spine's shape and six candidate event names, modelled on `voice_events` (`dedupe_key`, `occurred_at` vs `recorded_at`, `schema_version`, no provider names); Decision & Outcome Memory; a nine-level provenance vocabulary whose governing rule is **an inference may drive an action but may never silently become a fact**; four causal tiers (`caused_by` / `attributed_to` / `correlated_with` / `hypothesised`) with no automatic promotion; the Cross-Product Learning Contract (no product reads another's tables, no cross-product foreign keys, no synchronous cross-product call on a customer-facing path); the free-product staging model (no `org_id` until explicit consent); and one new provider guardrail — **never let a provider hold NiteOwl's memory** (hosted threads, managed conversation state, provider-side vector stores and memory features).

### Decisions taken (owner-approved 2026-08-18)
1. **C3's deadline is "before the first paying business", not "before the calendar work".** The calendar sequence keeps its priority.
2. **Standing principle adopted — *record what cannot be recomputed*.** Configuration, inferences and projections can be rebuilt; a transition that was overwritten cannot. It is the single exception to §3.6's "collect nothing without a current use", and the two now stand together.
3. **Provider-memory guardrail adopted.** No provider-hosted memory, threads or vector stores over tenant data; our database remains the system of record, and any provider-side index or embedding must be rebuildable from it alone.

None of the three requires a code, schema or configuration change today.

### Phasing
**NOW: none.** Zero new tables, services, abstractions or providers are proposed for the current product; every recommendation is a decision, a naming convention or a documented seam. Ten PREPARE items (documentation), seven LATER items (each with a trigger), five MUCH LATER items requiring legitimate accumulated outcome data.

### Remy's roadmap
**Unchanged and explicitly verified** (§32). Calendar reliability remains the priority; Reception Intelligence and Dynamic Schedule Recovery stay behind it. The only intersections with current work are C3 (re-priced, still deferrable, still an owner decision) and P1 (`subject_type = 'appointment'`, already decided and implemented — confirmed correct for a second reason, since every future canonical reference inherits that identity).

## 2026-08-14 (Emails — the appointment time is announced on the business's clock, not London's)

**PR #21 — `fix(email): use business timezone for appointment emails`. MERGED AND LIVE** via a normal GitHub merge commit, `7df5f622ba81bb0a9074fa5273e7aacfea6cee07` (branch commit `d6ef7dcc8d504ff37bf76c0e2d21aac65ca8bfeb`). The merge-triggered production deployment completed **Ready**, and `niteowlhq.com` returned **200**, served by that deployment. **953 tests pass / 0 fail / 0 skipped**, 172 suites; `tsc --noEmit` clean; ESLint clean on all four changed production files.

**No SQL, schema, RLS, OAuth, Vapi/Twilio, provider, configuration, environment-variable or dependency change.** Five files: four production, one new test file.

### The defect
`email.ts` had exactly one time formatter and it was pinned to `Europe/London`. The **stored instant was always correct** — the dashboard (PR #17) and the manage link (PR #19) both resolve the organisation's zone — so this was purely a rendering fault, and only for organisations outside the UK and Ireland.

Measured, for appointments booked at 14:00 local: Dublin announced as 14:00 (right), **Dubai as 11:00**, **New York as 19:00**, Sydney as 00:00. Worse at the edges: a New York appointment at 20:00 on Thursday was announced as **"Friday, 21 August at 01:00"** — the wrong **day**, in an email whose entire purpose is telling someone when to turn up.

### The fix
`formatAppointmentDate` now receives the organisation's IANA zone and the `Europe/London` literal is gone from this surface. The zone rides on `getOrgOwnerEmail`'s **existing** `organisations` read — every affected email already calls it immediately before sending — so **no extra database query was added** and no second source of truth introduced.

Threaded into all five renderings: **booking confirmation** (customer), **new-booking notification** (owner), **cancellation**, **reschedule** (both the previous and new times), and the **call-summary** time. Subject lines use the same business-local zone — two of them carried the wrong time in the owner's inbox list.

`en-GB` wording and date format are unchanged: that is date presentation, not a timezone.

### Fail-soft, deliberately
Unlike the booking write paths, which refuse rather than store an instant nobody can vouch for, this is a notification — an email in the default zone beats no email telling a business someone booked. A missing, empty or unusable zone falls back to `DEFAULT_ORG_TIMEZONE`, and the formatter's existing `try/catch` remains as final protection so no send can fail on a formatting problem. `"BST"` is covered by the validity check: `Intl` accepts it and resolves it to Asia/Dhaka, six hours out.

### Not changed
`appointment_datetime` storage; Google Calendar behaviour; booking creation; cancellation, rescheduling and availability logic; calendar sync; and the timezone **write**/conversion logic. Display-only — the formatter's output reaches HTML bodies and subject lines and nothing else.

### Coverage
New `tests/emailTimezone.test.mjs` (+325 lines, 19 tests): London/Dublin rendering unchanged; New York and Dubai correct; the date-boundary case; DST across the US March transition; confirmation body and subject; cancellation; reschedule; call summary; five invalid/missing-zone fail-soft cases; a test proving the zone arrives on **one** `organisations` read; and structural fences against the London literal returning.

**Mutation-verified four ways** — the tests fail if the London hardcode is restored (9 fail, **Dublin still passing**, which is what makes it a real no-change fence), if threading is removed at a caller (1), if the zone is no longer passed to the formatter (6), or if the fail-soft fallback is removed (4).

### Repository state
Feature branch `fix/email-appointment-business-timezone` deleted locally and remotely after the merge; local `main` equals `origin/main`; working tree clean.

## 2026-08-14 (Customer manage link — a rescheduled time means the business's clock, not London's)

**PR #19 — `fix(calendar): use business timezone for customer rescheduling`. MERGED AND LIVE** via the normal GitHub merge, as merge commit `935bb73cb56aaedb9dc9c48880aa7ab2dfd91af7` (branch commit `94b36451943dac840bf721215cca2b66e3183b36`). Vercel preview passed before the merge; the merge-triggered production deployment completed **Ready**, and `niteowlhq.com` returned **200**, served by that deployment. **934 tests pass / 0 fail / 0 skipped**; `tsc --noEmit` and lint clean.

**No SQL, schema, RLS, OAuth, Vapi/Twilio, provider or configuration change.** Four files: two production, two test.

### The defect
The manage-booking link's date and time inputs carry a wall-clock time and **no zone**, and `/api/bookings/manage` converted them with a hardcoded `Europe/London`. The page that prefills them formatted in London too — so the two halves agreed with each other and nothing looked wrong, while every time on the page sat `(org offset − London offset)` from the business's real clock.

Measured, for a customer picking 14:00: Dublin 14:00, New York **09:00**, Dubai **17:00**. Eastward zones mostly failed loudly, refused by the business-hours check for a time the page's own opening-hours hint said was open. New York is the dangerous one — 09:00 lands exactly on opening time, so it was **accepted**, written into the lead and the business's Google calendar, and confirmed to the customer as their 2pm.

### The fix
The organisation timezone is now the sole authority on this path. `GET` returns `organisations.timezone` (riding on the existing `organisations` read — no extra round trip), the page displays and prefills in it, and the reschedule converts with the shared **`wallClockToInstant`** from PR #17 — DST-aware via its two-pass offset settle, no offset arithmetic, no second timezone system. The route's own London-only, single-pass conversion is deleted.

Both halves moved together deliberately: fixing the server alone would have been worse than the bug, because a London-prefilled value reinterpreted in the org's zone would have **silently moved** an appointment whose time the customer had not changed.

### Failure behaviour
An unresolvable or unusable organisation timezone **fails closed** — the reschedule is refused, nothing reaches Google Calendar, `appointment_datetime` is not written, and no success is reported. Malformed date/time remains a controlled client error rather than a 500: `wallClockToInstant` throws where the old regexes returned `null`, so the boundary is wrapped rather than the helper weakened.

### Unchanged
**Customer cancellation** — it converts no wall-clock time at all, and still succeeds even for an org whose zone cannot be resolved. **London and Dublin behaviour** — Dublin shares London's offsets year-round, so every existing production organisation is unaffected. Also untouched: the idempotent write on a no-op reschedule, and the owner-dashboard work from PR #17.

### Coverage
**+14 tests**, all in `tests/calendarEventCreation.test.mjs`: Dublin unchanged, New York and Dubai correct end to end (asserted through to the Google event body), the display half, the no-op round trip, a DST boundary, the fail-closed refusal, malformed input, and a cancellation fence. `tests/stubs/next-server.mjs` gained a `nextUrl` getter — test-only infrastructure, without which no test can drive this route's `GET`.

**Mutation-verified twice:** restoring the London hardcode fails 5 tests (Dublin still passes, which is what makes it a real no-change fence); disabling the fail-closed branch fails 2.

### Separate follow-up, not bundled
`src/lib/email.ts` still formats appointment times in `Europe/London` and was **not** changed here. Same class of bug, display-only, separate surface — its own task.

## 2026-08-14 (Dashboard — appointment times now mean the business's clock, not the owner's device)

**PR #17. MERGED AND LIVE** as merge commit `0c513bb3ff1f6db112a7e8215443b5c6f0a2fcca` (branch commit `b74bfd0140209240b112cf75435de89347976662`). Vercel preview succeeded before merge; the merge triggered a production deployment which completed **Ready**, and `niteowlhq.com` returns 200 served by that deployment. **920 tests pass / 0 fail; `tsc --noEmit` clean.**

**No schema, SQL, RLS, OAuth, Vapi/Twilio or provider-architecture change.** Seven files: four dashboard files, one library helper, two test files.

### The defect
An `<input type="datetime-local">` carries a wall-clock time and **no zone**. Both dashboards resolved it with `new Date(value)` and rendered it back with `d.getHours()`, so the zone actually in play was whatever the owner's device was set to. Self-consistent on one machine, wrong on any machine whose zone differs from the organisation's: an owner in New York editing a Dublin business stored **18:00Z for "14:00"** instead of 13:00Z.

Since PR #16 routed owner reschedules through calendar sync, that error no longer stayed local — it was written into the business's Google calendar too, and because both stores then agreed there was no divergence to detect it by. Large offsets get caught by the business-hours check and surface as a baffling 422; small ones (an owner one zone away) land inside opening hours and are accepted **silently at the wrong hour**.

The organisation's zone was already the source of truth everywhere else — `organisations.timezone`, resolved by `resolveOrgTimezone`, validated against canonical IANA names, used correctly by the chat, widget and voice booking paths via `parseDatetimeToIso`. Only the dashboard did not participate.

### The input half — `wallClockToInstant`
One primitive was missing. `lib/calendar/timezone.ts` owned `toProviderLocalTime` (instant → wall time) but not its inverse; the inverse existed only as a private function inside `parseDatetime.ts`. `wallClockToInstant` adds it to the timezone module, so datetime-local values are now converted using `organisations.timezone` rather than the browser's.

**DST-aware, via the same two-pass offset settle** as `parseDatetime`'s `zonedWallClockToUtc`: the offset needed to convert a wall time is only knowable once you know the instant, so the first pass guesses at the naive instant and the second re-resolves at that guess. Without it, any wall time within an offset's distance of a DST boundary lands on the wrong side of the transition. No manual UTC-offset arithmetic was introduced.

It accepts **only** zoneless `"YYYY-MM-DDTHH:mm[:ss]"` and **throws** on anything carrying a `Z` or an offset — a value that is already an instant must never be re-interpreted, which is the same bug in reverse.

DST edges are documented rather than special-cased: a nonexistent spring-forward time maps to the instant the clock jumped to; an ambiguous autumn time resolves to one of its two real instants rather than throwing. Both are defined and stable, and availability still refuses an impossible slot downstream. Silence was the actual defect.

### The display half
Five hardcoded `Europe/London` formatters are gone, and `getLondonToday` is now `getBusinessToday(zone)`. Fixing only the picker would have left the grid showing London times while the picker showed organisation times — a new internal mismatch, arguably worse than the old one. Both pages already query `organisations`, so `timezone` rides along on the existing `select` and is threaded down as an explicit prop. **No context, no new architecture.**

### Deliberately unchanged
`PATCH /api/leads` receives an absolute instant and correctly refuses to re-interpret it, so the conversion happens exactly once at the browser edge. `/api/bookings/manage` keeps its own `Europe/London` hardcode on the **customer** page — same class of bug, separate change, and `wallClockToInstant` is now available for it.

### Expected visible effect
Existing appointments will appear to move for any owner whose browser zone differs from the organisation's. **That is the fix** — those times were being displayed wrongly before. Nothing shifts for a London- or Dublin-aligned owner.

### Coverage
**+285 lines of tests** across `tests/calendarTimezone.test.mjs` and `tests/calendarEventCreation.test.mjs`, covering the wall-clock conversion, its rejection of instants, and the DST boundary behaviour.

### Post-merge state
Local `main` fast-forwarded to `0c513bb`; the merged feature branch `fix/dashboard-business-timezone` was deleted locally and on the remote after confirming the merged tree is byte-identical to the reviewed commit. No unrelated branch was touched.

## 2026-08-12 (Database — `organisations.timezone` now rejects clearly-invalid values)

**PR #11. MERGED** as `2a2a008017c78634fc493c56d569417b73b33c89`. The SQL was **executed manually against production on 2026-08-12, via the Supabase SQL Editor**, and verified there. The database half of the timezone follow-up hardening; the application half remains deferred.

### Why
PR #9 made availability fail closed when an organisation's timezone cannot be resolved. This is preventative, one layer earlier: stop a malformed value being **stored**, so that fail-closed path stays a genuine safety net rather than a routine occurrence.

The column was `timezone text not null default 'Europe/London'` with **no CHECK**. `NOT NULL` ruled out `NULL`; it did not rule out `''`, `'   '`, `' Europe/London'` or `'BST'`. `'BST'` is the dangerous one — `Intl` **accepts** it and silently resolves it to Asia/Dhaka (UTC+6), so an owner picking it for British Summer Time would have every appointment six hours out with no error raised anywhere.

### The constraint
```sql
check (timezone = btrim(timezone)
       and btrim(timezone) <> ''
       and (timezone = 'UTC' or timezone like '%/%'))
```

It mirrors the application's own `IANA_ID_SHAPE` rule — at least one `/`, which is exactly what excludes the legacy abbreviations. **Deliberately not a frozen list** of zone names: Postgres cannot keep one in step with the runtime's ICU build, and this codebase has already been bitten by that drift (`isValidTimezone` records an India user whose valid `Asia/Kolkata` was rejected because their ICU listed only `Asia/Calcutta`). `'UTC'` is allowed explicitly — checked, not assumed: of the 418 canonical zones this runtime reports, zero are slashless.

### Execution and production verification
Run **by the owner in the Supabase SQL Editor**, not by tooling. The service-role key authorises data access, not DDL, and no DDL path exists from the development environment — worth recording, because the same will be true of any future migration.

- `pg_constraint`: `organisations_timezone_shape` present exactly once, `contype = 'c'`, definition as reviewed
- `total_orgs = 2`, `offending_rows = 0`
- **No existing organisation data was modified** — `ADD CONSTRAINT … CHECK` validates rows, it does not rewrite them; the `DEFAULT` is unchanged
- Rollback remains one lossless line: `alter table public.organisations drop constraint if exists organisations_timezone_shape;`

### Tests
+4 in `tests/calendarTimezone.test.mjs`. The load-bearing one asserts **exhaustively** that every zone the application can canonicalise satisfies the SQL predicate — all 418, not a sample — so ICU drift is caught in CI rather than in production. One of them failed on first draft and correctly: the app does not *reject* `' Europe/London'`, it **trims** it. The test now pins that asymmetry — the app normalises padding, while `timezone = btrim(timezone)` catches a padded value that reached the database without going through canonicalisation.

### Still deferred
The **application boundary** is unchanged and still open: no code path writes this column, and `canonicaliseTimezone()` / `listSupportedTimezones()` still have zero consumers. Wiring them belongs in the timezone-picker PR, alongside the UI they validate.

**PR #9's runtime protection is untouched** — `resolveOrgTimezone` still fails closed, availability still refuses rather than substituting `Europe/London`, and PR #11 changed no `src/` file.

## 2026-08-12 (Availability — business hours are judged on the business's own clock)

**PR #9. MERGED AND LIVE** as `b18354e5050dedbb13e0f5324350980f096794a2`, deployed and production-verified. Closes the timezone defect parked since PR #5. No migration, no new dependency.

### The defect
Business hours are stored as wall-clock strings (`"09:00"`), so they mean nothing until you know whose clock they are on. `getLondonParts` took a timezone parameter defaulting to `Europe/London`, and **neither call site ever passed one** — the requested instant was parsed in the org's real zone, correctly, then judged in London.

For a London business the wrong zone is the right answer, which is exactly why this survived: production has only London orgs, and every existing test was a London org. Measured, against 09:00–17:00 local hours:

| Org | Local time | Before | Correct |
|---|---|---|---|
| London | every case | matches | matches |
| New York | **06:00** | **ACCEPTED** | REFUSED — three hours before opening |
| New York | 12:00 | REFUSED | ACCEPTED |
| New York | 16:30 | refused as "outside hours" | refused as "ends after close" |

### Organisation-specific evaluation
`getZonedParts` (renamed from `getLondonParts`) now **requires** the zone — the default *was* the defect, and removing it makes the mistake unrepresentable rather than fixed once. The zone is resolved **once** per availability decision and threaded downward: one `organisations` read per decision, none when the caller supplies it, and none per slot (`findNextAvailableSlot` resolves before its loop, not inside it).

### Strict resolution, and failing closed
New `resolveOrgTimezone` reports whether the organisation's own valid zone was actually read. A failed query, a missing value, or a zone `Intl` cannot use all mean the same thing: we do not know what `"09:00"` means for this business. Availability **refuses** rather than substituting `Europe/London` — which would not be a neutral default, since it is precisely what accepted 06:00 in New York. The refusal uses the existing `internalCheckFailed` / `lookup_failed` channel, so the customer hears *"we cannot confirm that time right now"* rather than the untrue *"you are outside our opening hours"*, and no alternative is offered rather than a fabricated one.

`getOrgTimezone` keeps its soft-fallback contract for everything that merely **speaks** a time back. It delegates to `resolveOrgTimezone` and flattens the result — one query, one column, one validation, the same read with the outcome no longer discarded. Not a second source of truth.

### The voice trust-boundary correction
Because a supplied zone is *trusted*, passing one is a trust boundary — and a pre-push forensic review caught the voice tool crossing it **before this shipped**. It called the soft `getOrgTimezone`, which answers `"Europe/London"` on failure, and handed that fallback downstream as though resolved; a truthy value bypassed all three guards. Same org, no resolvable timezone: chat answered `available=false` while voice answered `available=true`. Voice now uses strict resolution and bails, returning the existing unknown-availability outcome, which already refuses to call a time free or offer an alternative.

### Multi-tenancy and DST
The zone is read per call from `organisations.timezone`, scoped by org id, with no global mutable state — one organisation's zone cannot reach another's. Every conversion passes an explicit `timeZone` to `Intl`, so server and browser timezone are irrelevant, and IANA rules (BST/GMT, US DST, half-hour offsets such as `Asia/Kolkata`) are applied by the platform. **No manual UTC-offset arithmetic was introduced.**

### Regression coverage
**+16 tests.** Business hours: London unchanged; New York accepting its own midday; the 06:00 bug refused; ends-after-close still distinguishable; **the same UTC instant judged differently for two orgs** — the defect and tenant isolation in one assertion; DST either side of the US transition, where the London gap is 4 hours not 5; a half-hour zone; three unresolvable-zone cases.

Voice coverage is driven through the real webhook → tool → lookup path rather than the helpers underneath it — the helpers were never the problem, the caller above them was, and testing them directly is exactly why the first round missed it.

Test stubs now model `organisations.timezone`, which the real column carries with a `Europe/London` default. No assertion was weakened. **Mutation-verified three ways:** judging hours in London again fails 5 tests including the 06:00 case; restoring the soft fallback in the engine fails 2; reverting voice to `getOrgTimezone` fails 3.

Full suite **841 pass / 0 fail**; `tsc --noEmit` clean. PR #3–#8 protections verified intact.

### Follow-up hardening — recorded, not implemented
Before wider multi-timezone onboarding: prevent empty-string `organisations.timezone` values at the database/application boundary (the column is `NOT NULL DEFAULT 'Europe/London'` but carries no `CHECK`, so `''` is storable and would trip the new fail-closed path); route any future timezone picker or write through `canonicaliseTimezone()`; and validate future writes against supported IANA values. Neither blocked this merge — a pre-merge invariant review confirmed the sole organisation-creation path omits the column and safely inherits the database default, so no organisation the application can create reaches the fail-closed path.

## 2026-08-12 (Calendar availability reliability — missing FreeBusy calendar now fails closed)

**PR #5. MERGED AND LIVE** as `3b2fe4721cb63dcbc456eb15be8395d8db0370c8`. One guard in one provider file, plus regression coverage.

### Behaviour
If Google's FreeBusy API returns **successfully** but the response does not include the specifically requested calendar, Remy no longer interprets that absence as an empty — and therefore free — calendar. The condition is now an integration/availability failure, so it can never produce a false `AVAILABLE`.

`parseFreeBusyResponse` previously returned `entry?.busy ?? []` when the calendar key was absent from Google's `calendars` map. An empty busy list is indistinguishable from "completely free", so a 200 that never mentioned our calendar was read as a wide-open diary and the slot was offered over whatever is really in it.

Nothing about that response looks like a failure — HTTP 200, valid JSON, no `errors` block, just silence about the one calendar we asked about. It was the single place this module failed **open**, and it contradicted the rule stated two lines below it, where an `errors` entry deliberately throws because *"treating an unreadable calendar as empty would double-book a customer."* Same rule, one step earlier: **no answer is not "free"**.

The thrown error is classified `transient`, deliberately **not** `auth_expired`. An incomplete payload says nothing about the credentials, and `requiresReauth` would otherwise park a healthy connection as `needs_reauth`, disabling the calendar until the owner noticed. The caller converts any non-auth failure to `lookup_failed` — UNKNOWN — which is never bookable.

### Changed
- `src/lib/integrations/providers/google.ts`

### Regression coverage added/updated
- `tests/calendarReliability.test.mjs`
- `tests/googleIntegration.test.mjs`

Twelve tests (813 → 825): five at the parser, seven end-to-end through `checkVoiceAvailability` so the whole chain is pinned rather than the parser alone. **Four are controls** proving the fix refuses *silence* and not *free time* — an answered-empty calendar is still available, a real busy window is still a conflict, half-open back-to-back is still bookable, and no connection is parked `needs_reauth`. Without them the suite would pass on a blanket refusal that had broken availability entirely.

One existing assertion was corrected: it recorded the old behaviour under the name *"an empty calendar yields no busy windows"*, merging two different situations — the calendar answered and is free, versus the calendar never answered. That test is now split and the second half inverted. It is the only deleted line in the change.

**Mutation-verified:** removing the guard fails 7 of the new tests, while every control keeps passing in both states.

### Verification
- 825 tests passing, 0 failing, before merge
- `tsc --noEmit` clean
- Vercel production deployment **Ready**; its `githubCommitSha` matched the merge commit exactly
- `niteowlhq.com` returned **HTTP 200**
- No unexpected files landed — exactly three files, +171/−1

### Scope
Intentionally narrow. PR #3's false-confirmation protection and PR #4's leadCapture update-path protection are both untouched and verified intact on `main`. No OAuth, Google Cloud, database, environment, Vapi/Twilio, UI, onboarding or pricing change.

**The timezone defect remains unresolved** — business hours are still evaluated in `Europe/London` rather than the organisation's own timezone (`getLondonParts` is called without a timezone argument at `src/lib/availability.ts:377` and `:469`). It was deliberately not touched here and belongs to the next separate workstream.

## 2026-08-12 (Calendar — `no_calendar` could confirm a booking that did not exist)

**PR #3. MERGED AND LIVE** as `7f3b136`, merged `ccc8fe2`, deployed to production 2026-08-12. One-line production change plus tests; no flag, schema, prompt or route change.

*(This entry originally read "NOT DEPLOYED, NOT PUSHED" — true when written, corrected here once the branch was merged and deployed.)*

`mayConfirmBooking()` returned true for `no_calendar`, so an **allowlisted** org whose calendar is disconnected — or has sync switched off — was told its appointment was booked with no event in anyone's Google Calendar: status `booked`, a null `unavailableReason`, *"your appointment IS NOW BOOKED"* handed to the reply model, and a confirmation email. Availability had passed, and the code read "nothing contradicted us" as "Google said yes".

### Why the old reasoning was wrong, not merely outdated
The comment justified the exclusion as protecting orgs with no connection: *"refusing to book it would break every business using Remy today."* That described a call production never makes. The only caller — `settleCalendarBacking` in `lib/leadCapture` — is reached exclusively through `requiresCalendarBacking()`, which gates on the same `isCalendarEventCreationEnabled(orgId)` checked at the top of `confirmAppointmentOnCalendar`. An org with no calendar integration never reaches the function at all: it books in a single write and returns. **That path, not this exclusion, is what preserved the legacy behaviour** — and it is asserted directly by the untouched flag-off end-to-end test.

So the only outcome the exclusion ever changed was the one it must not. This **supersedes the `no_calendar` → `booked` row** in the milestone-5 outcome table below, which is left as written because it records what was true then: that row's parenthetical ("every org today, byte-identical to before") was the assumption that made the exclusion look harmless, and it stopped holding the moment an org was allowlisted without a working calendar.

### Tests
`npm test` **803 passing, 0 failing** (790 → 803, +13). `tsc --noEmit` clean.

Three obsolete expectations corrected. All three asserted `mayConfirmBooking("no_calendar") === true` under the stale justification, and all three did it by calling `confirmAppointmentOnCalendar` directly with the flag off — a call the engine never makes.

Thirteen regression tests added, in two groups: an **exhaustive sweep over the `CalendarConfirmOutcome` union**, so a future outcome cannot default into confirmable unnoticed and `mayConfirmBooking` cannot silently re-diverge from `isCalendarConfirmed`; and **end-to-end coverage through the real `capturePartialLead` and the real `buildBookingOutcomeNote`**, composed exactly as the chat and widget routes compose them, proving the refusal survives to the only thing a customer experiences — the instruction handed to the model that writes the reply. Includes a **control test** asserting a genuine write still produces the confirmation note, so the group cannot pass on a note builder broken to return null.

**Mutation-verified:** restoring the old one-liner fails 11 of them, including the end-to-end *"the lead must not be left booked"*.

### Production configuration check
Verified read-only against prod before committing. Two orgs exist; applying the code's exact predicate (`getPrimaryResourceWithConnection` plus the `syncEnabled` gate), only `Niteowl Test` resolves to a writable calendar, and `Verification Plumbing Co` has no calendar resource at all. All three `integration_links` ever written belong to the test org.

**The allowlist value itself could not be read.** `CALENDAR_EVENT_CREATION_ORG_IDS` is typed *Sensitive* in Vercel: `env ls` shows `Hidden` and `env pull` returns the literal placeholder `[SENSITIVE]`. `CHECKLIST.md` records it as the test org alone, which the creation date and the link data corroborate but do not prove.

That uncertainty does not gate the deploy, because the outcome is the same either way: if the allowlist is the test org alone, its calendar is writable, `no_calendar` is unreachable and **the change is a no-op in production today** — a safety net for the day a calendar is disconnected or a second org is added. If another org is on the list, that org is *currently getting the bug*, and the change stops it. There is no configuration in which this makes production worse.

### Two findings this surfaced, neither fixed here *(both since resolved — see below)*
- **The Google token has not refreshed since 2026-08-08.** `last_verified_at`, `updated_at` and `token_expires_at` all sit at that date, and a successful refresh writes all three back — with `status=connected` and `last_error` null, that reads as *not exercised*, not broken. It does not interact with this change: `resolveOrgCalendar` reads the database only and never filters on connection status, so a dead token yields `unverified` or `failed` — never `no_calendar` — and both were already non-confirmable.
- **`leadCapture.ts` returns `booked: confirmedBooking || safeNextStatus === "booked"` on the update path.** When `backsWithCalendar` is true, `safeNextStatus === "booked"` holds by construction, so the settled calendar result is computed and then discarded. No false confirmation reaches a customer today — `settleCalendarBacking` also sets `unavailableReason`, and `buildBookingOutcomeNote` bails on that first — but the field's documented contract ("whether the lead genuinely ended up confirmed") is untrue, and the insert path returns the honest value. The `||` is not removable outright: it exists so an already-`booked` lead still reports `booked` on reschedule. **RESOLVED by PR #4 — see the entry above.** *(This line originally ended "Left for an owner decision".)*

## 2026-08-12 (Booking — the update path must report the calendar's verdict, not its intent)

**PR #4. MERGED AND LIVE** as `40e1030`, merged `e45ee07`, deployed to production 2026-08-12. Resolves the second of the two findings raised by PR #3 above.

`capturePartialLead`'s **update** path returned `booked: confirmedBooking || safeNextStatus === "booked"`. `backsWithCalendar` implies `safeNextStatus === "booked"` **by construction** — `requiresCalendarBacking()` demands it — so the second operand could never be false when the calendar was consulted, and `settleCalendarBacking`'s verdict, assigned to `confirmedBooking` immediately above, was computed and then discarded. The engine reported `booked: true` while the row it had just written said `needs_review`.

The persisted record was always correct; only the reported value lied, and no customer ever saw a false confirmation — `settleCalendarBacking` also sets `unavailableReason`, and `buildBookingOutcomeNote` checks that guard first. It still mattered: the two contradicted each other, which is the exact coupling `bookingOutcome.ts` exists to keep honest, and one reordered guard or one new consumer of `.booked` would have surfaced it. The insert path already returned the honest value, so the two paths disagreed.

The fix is one expression — `backsWithCalendar ? confirmedBooking : confirmedBooking || safeNextStatus === "booked"`. Where the calendar spoke, its settled result is the answer; where it did not, behaviour is byte-identical. The OR is deliberately kept: for a lead that is already `booked`, `confirmedBooking` is false *by design* (it tests `existing.status !== "booked"`) and a chat reschedule still has to report its booking. Removing it outright breaks that path.

**Changed:** `src/lib/leadCapture.ts`. **Coverage:** `tests/calendarEventCreation.test.mjs` — 10 tests (803 → 813), including an exercise guard so the fixture cannot silently degrade into an insert-path test, an invariant sweep asserting the reported value and the persisted row can never disagree across every outcome, and three cases pinning that an existing booking survives an ordinary update with its event and link intact. **Mutation-verified:** restoring the unconditional OR fails 3 of them. 2 files, +215/−1; `tsc` clean.

## 2026-08-08 (Google Calendar sync — LIVE-VERIFIED end to end on the test org)

**Documentation of a verification, not a code change.** Production runs `7fb7b0414df0d621dbb0a6f860fb38d071ec200e`; `CALENDAR_EVENT_CREATION_ORG_IDS` is set in **Production only** to the `Niteowl Test` org and nothing else.

Milestones 5 and 6 are live for one org and proven against a real Google Calendar:

| Step | Result |
|---|---|
| **Book** | One event, one `integration_links` row (`subject_type='appointment'`, `synced`), correct org/connection/resource. Reply "14:00", stored `13:00Z` = 14:00 BST |
| **Reschedule (manage link)** | Same event id, etag changed, no duplicate |
| **Reschedule (chat)** | Same event id, etag changed, no duplicate |
| **Cancel** | Link `deleted`, `last_error` null, lead `cancelled` — **owner confirmed in Google Calendar that the event is gone** |

Etags are issued by Google, not by us, so each change is Google confirming it modified that specific event. **Isolation held**: every link in production belongs to the test org, and a booking on the non-allowlisted org produced zero links and attempted no external write.

### The one defect the live test caught
A widget reschedule moved the appointment *and* the event, while the reply said *"I'm sorry, but I can't change or update appointments."* Root cause: the chat routes run two independent model calls, and only **failure** was ever communicated to the one writing the reply — on success it was told nothing. Production logs confirmed the intent was `reschedule`, so BOOKING MODE and the "never say you cannot change a booking" rule were both in the prompt. A negative constraint is not a fact.

Fixed in `7fb7b04` and re-verified live: *"Your appointment has been successfully moved to Tuesday, 25 August 2026 at 11:00."* — matching the persisted instant exactly, one link, same event id, changed etag.

### Cleanup
Both live test appointments cancelled through the normal `/api/bookings/manage` path — no bespoke mutation. Verified by column-by-column diff of a 52-lead snapshot: **only the target row changed** (`status`, `updated_at`), no rows added or deleted, non-test-org data byte-identical, zero active integration links remaining. The unrelated `Verification Plumbing Co` isolation-check lead was deliberately left untouched.

## 2026-08-08 (Calendar — event creation is now an org allowlist, not a global switch)

**NOT DEPLOYED. Nothing enabled.** `CALENDAR_EVENT_CREATION_ENABLED` is **replaced** by `CALENDAR_EVENT_CREATION_ORG_IDS`. The old variable is gone from the code; it was never set anywhere, so removing it changes nothing.

### Why
Preparing the live calendar test raised a question worth answering honestly: can the write flag be scoped to the test org? It could not. `isCalendarEventCreationEnabled()` took no org and was consulted at five call sites, none of which passed one — a single global boolean, on for every org or off for every org.

Flipping it globally *would* have been safe today, because only `Niteowl Test` has connected a calendar. But that is a property of the **data**, not of the flag, and it is not a guarantee: `setPrimaryResource` hard-codes `sync_enabled: true`, so any org connecting a calendar mid-rollout would have started receiving writes with no further action and no warning. `CALENDAR_SYNC_ENABLED` is also set for `Preview, Production`, so the same shape would have let preview builds write into a real calendar.

### What it is now
A comma-separated allowlist of org UUIDs. Whitespace is ignored and matching is case-insensitive, so a copy-pasted id cannot fail silently. **Unset or empty means nobody** — the same failure direction as the three switches above it: a misconfigured environment writes to no calendar at all, never to the wrong one. `CALENDAR_SYNC_ENABLED` remains a prerequisite.

`orgId` is threaded through **every** gate — `confirmAppointmentOnCalendar`, `rescheduleAppointmentOnCalendar`, `cancelAppointmentOnCalendar`, and both `leadCapture` gates. No parallel or bypass path: a grep for a bare `isCalendarEventCreationEnabled()` returns zero.

### Tests
`npm test` **625 passing, 0 failing** (608 → 625, +17). `tsc --noEmit` clean, lint clean.

Covers: allowlisted org enabled; non-allowlisted refused; empty and missing variable disabling everyone; separator/whitespace-only junk disabling everyone; multiple ids parsing with whitespace; case-insensitive matching; partial and prefix ids never matching; empty/undefined/null orgId never allowed; `CALENDAR_SYNC_ENABLED` and `INTEGRATIONS_ENABLED` still prerequisites; create, reschedule and cancel each obeying the gate; an unlisted org booking exactly as it does today with zero provider calls; and no cross-org leakage even when the connection lookup would have answered.

**Mutation-verified against fail-open specifically** — each of these was applied and confirmed to break tests: empty list meaning *everyone* (9 failures), dropping the sync prerequisite (1), prefix matching instead of exact (1), and allowing a missing orgId (1).

### One fixture bug this surfaced
A cancel test's stubbed lead row omitted `org_id`. Under the global flag that went unnoticed; under the per-org gate it correctly **failed closed** and the test broke. The fixture was wrong — every real query selects `org_id` — and is now faithful. That is the gate doing its job before it ever reached production.

## 2026-08-08 (Calendar milestone 6 — reschedule and cancel now move and remove the event)

**NOT DEPLOYED, and dark on arrival** — same `CALENDAR_EVENT_CREATION_ENABLED` flag as milestone 5, still unset everywhere. No new flag, no schema change.

### A reschedule moves the event; it does not recreate it
`rescheduleAppointmentOnCalendar` PATCHes the existing event, so the customer keeps one event with its history rather than receiving a cancellation followed by a fresh invite.

The consequence is worth stating: a moved event keeps the id it was **created** with, so the event id no longer encodes the current time — which is why milestone 5's `stale_link` inference had to go. Guessing was replaced by **making it true**: when a link already exists, `confirmAppointmentOnCalendar` realigns the event with an idempotent update. Setting an event to the time it already holds costs one request and changes nothing, so the caller never has to know where the event currently sits.

### The truthfulness rule is deliberately asymmetric
This is the core of the design, not an inconsistency:

| | On provider failure | Why |
|---|---|---|
| **Reschedule** | Refused — local time unchanged, customer asked to retry (503) | Saying "moved to Thursday" while the event sits on Tuesday is the exact desync this closes, and the customer loses nothing by trying again |
| **Cancel** | Local cancellation goes ahead anyway; link marked `failed` with its error | A customer must **always** be able to cancel. Trapping them because Google is unreachable is far worse than leaving the business one ghost event to clear |

A reschedule also re-verifies the new slot before moving, and refuses on a conflict with the engine's suggested alternative.

### One known limitation, handled rather than ignored
Google's free/busy returns intervals with **no event ids**, so the org's own event cannot be filtered out of a conflict check. Moving an appointment by less than one appointment-duration (10:00 → 10:30) would clash with the very event it is about to move. The external check is therefore skipped when the new slot overlaps the old one — the internal checks still apply, and the only thing plausibly in that window is the appointment itself. Closing it properly needs an event-id-aware busy read (`events.list` rather than `freeBusy`), which is not worth it yet.

### Wiring
`/api/bookings/manage` and `capturePartialLead`. A reschedule moves the event **before** touching the local record and aborts if it cannot; a cancellation persists locally **first**. `updateOrgEvent` and `cancelOrgEvent` are used unmodified.

### Two blockers found in review, before anything shipped
Both were real, both were on live paths, and both were missed by the first round of tests.

- **A chat/widget reschedule never synced at all.** The calendar-backing block only fires on the transition *into* `booked`, so an already-booked lead being rescheduled skipped it entirely — the stored time moved to Thursday, the Google event stayed on Tuesday, and the assistant told the customer Thursday. Exactly the desync this milestone exists to close. Proved with a throwaway probe against the real engine (`GOOGLE CALLS: (none)`) rather than argued from the code. Now handled by its own path in `capturePartialLead`, before the local write, with a refusal keeping the original time.
- **Cancellation was Google-first.** If the delete succeeded and the local update then failed, the event was gone from the business's diary while the lead still said `booked` — holding the slot internally and showing nothing in the calendar. That is the one failure this design does not accept. Now local-first, leaving only the accepted failure: a ghost event, recorded on the link.

Also corrected: my own implementation note claimed chat reschedules "realign on the next confirmation pass". There was no such pass.

### Tests
`npm test` **602 passing, 0 failing** (588 → 602, +14). `tsc --noEmit` clean.

Covers: a clear move, link re-stamped with the new etag, re-verification before the move, a busy slot refusing it, provider failure recording the desync rather than hiding it, the short-move self-conflict exception, no-event and flag-off cases; and for cancel: deletion, already-gone treated as success (so a repeated cancel is safe), failure recorded with `last_error`, no-event, tenant scoping, and neither operation ever throwing into the caller.

**Mutation-verified:** letting a failed move report success — the reschedule lie — fails 2 tests; removing the pre-move conflict check fails 1.

Two milestone-5 tests were updated because the behaviour deliberately changed: `stale_link` is now `realigned`, and an existing link at a different time is moved rather than sent for review.

## 2026-08-08 (Calendar milestone 5 — a validated appointment now creates the Google event)

**NOT DEPLOYED, and dark on arrival.** Gated behind a new fourth kill switch, `CALENDAR_EVENT_CREATION_ENABLED`. Unset means off, so deploying this changes nothing for anyone until the variable is set.

The first thing Remy does that changes something in someone else's Google account. Everything before it was a question; this is a consequence, so the whole change is built around one rule: **an appointment is "booked" only if Google says so.**

### How it works
`confirmAppointmentOnCalendar` (`src/lib/calendarSync.ts`) is the single path that writes an event, called from `capturePartialLead` at the two points a lead becomes `booked`. The lead's status is decided **from its outcome** rather than before it:

| Outcome | Status | |
|---|---|---|
| `no_calendar` | `booked` | flag off / nothing connected / sync disabled — **every org today, byte-identical to before** |
| `created` / `already_linked` | `booked` | Google holds the event |
| `conflict` | `needs_review` | the slot went while we were talking |
| `unverified` / `failed` / `stale_link` | `needs_review` | nothing is known, so nothing is claimed |

Reuses the existing pieces rather than reimplementing them: `resolveOrgCalendar` picks the connection, `checkBookingSlot` re-verifies, `createOrgEvent` writes. **`createOrgEvent` and the Google provider are unmodified.**

### The protections §R3 asked for
- **Re-verified at the write**, not at conversation time. An observed external conflict blocks the write **regardless of `CALENDAR_AVAILABILITY_BLOCKING`** — that flag decides whether a customer is turned away, but writing on top of a busy window is a double booking in the business's own diary.
- **Internal claim before the external write.** The lead is saved in a pending state *before* Google is touched, so a crash between the two leaves a recoverable request rather than an event with no lead. This is why C1 had to land first: the capacity check can only serve as a claim now that it is overlap-aware.
- **Only a confirmed write reaches `booked`**, and the confirmation email is gated on the same value — the customer is never told of a booking that does not exist.
- **A conflict returns the engine's suggested alternative** and never silently moves the appointment.

### Three defences against duplicates
The deterministic Google event id (a retry re-derives it and gets a 409, which is treated as success); a pre-check on `integration_links`; and that table's own `unique (subject_type, subject_id, connection_id, capability)`.

**The idempotency key is `leadId + startMs`** — and the instant is what makes `alreadyExisted` safe to trust. Keying on the lead alone, the obvious choice, would re-derive the same id after a reschedule, hit the event still sitting at the **old** time, and report success carrying the wrong hour. That is the §R2 trap; a test now fails if the key is reduced to the lead.

Links are written with `subject_type = 'appointment'`, per §P1, so the stored rows already say what they mean if appointments ever separate from leads. **No schema change** — `integration_links` has existed and been empty since 2026-08-04.

### Tests
`npm test` **588 passing, 0 failing** (+37; 551 → 588). `tsc --noEmit` clean, lint clean on changed files.

Covers success, timezone (local wall time plus IANA zone, never an offset), duration (60 and 30 minute orgs), conflict and partial overlap, Google 500 and 401, a lost link *not* un-booking a real event, all three duplicate defences, the stale-link case, flag-off and not-connected, sync-disabled resources, tenant isolation (every query's `org_id` observed, not assumed), and five end-to-end cases through the real `capturePartialLead`.

**Verified by mutation, not assumed:** removing the conflict guard fails 3 tests; reducing the idempotency key to the lead id fails 3; making `mayConfirmBooking` always true — the exact lie this exists to prevent — fails 9.

### Deliberately not built
Microsoft, queues, provider abstractions, and **reschedule/cancel sync (milestone 6)**. `/api/bookings/manage` can therefore leave a stale event behind; the `stale_link` outcome exists so that state is surfaced for review rather than silently confirmed. **That is the immediate follow-up and should land before the flag is enabled for a business that reschedules.** No Vapi, Twilio or voice-prompt change — voice never sets `booked`, so it is untouched.

## 2026-08-08 (Production data — 11 stale test rows cancelled, releasing six blocked appointment slots)

**Documentation of a production data operation. No code, schema, configuration or deployment change.** Full record, verification queries and rollback in `docs/sql/2026-08-08_stale_capacity_holds_cancelled.sql`, following the convention set by `2026-07-12_voice_test_rows_cleanup.sql`.

**Why.** The overlap fix deployed as `c6f5bd1` changed capacity from an exact-timestamp match to an interval overlap. Under the old rule a stale test request at 15:00 blocked only that instant; under overlap it blocks the open interval (14:00, 16:00). Eleven leads left behind by the owner's own test calls on 6–8 August therefore began blocking **six real hourly starts** across 10–13 August. The rows were correct data — the fix simply made their footprint honest.

**Cancelled, not deleted.** The held-slot check excludes `cancelled`/`lost` by design, so cancelling frees the slots exactly as deleting would, while preserving every row, its metadata and its link to the originating `voice_calls` record. It is also trivially reversible.

**Scope and safety.** Eleven **explicit ids**, never a status/date/org predicate — a broad `WHERE` would have swept up rows that were audited and deliberately excluded. All 11 re-read immediately before the write and checked on eight criteria each (88/88 passed); the mutation was gated on that result. Issued as one statement, so it committed as a single transaction.

**Verified by diffing a full 49-row pre-change snapshot against a post-change read, column by column:**

| | Before | After |
|---|---|---|
| Total production leads | 49 | **49 — no rows deleted** |
| `awaiting_confirmation` | 30 | 19 |
| Future capacity-holding rows | 11 | **0** |
| Future confirmed bookings | 0 | 0 |

Columns changed on the 11 targets: **`status` and `updated_at` only** (the latter maintained by the table, not set by the operation). **Rows changed outside the 11: zero.** `voice_calls` untouched.

**Capacity re-verified** by issuing the two predicates the deployed code actually runs, rather than re-deriving the rule: all 32 hourly starts across 10–13 August are free, and all six previously-blocked starts are restored — Mon 10:00; Tue 10:00 and 11:00; Wed 15:00 and 16:00; Thu 09:00. The off-grid 15:02 row, from a mis-transcribed "3:02 PM", is released too.

Untouched as audited: the 4 inert future rows, the 15 past/null-datetime rows, all `Verification Plumbing Co` records, and every dashboard/widget lead. Contact details are deliberately omitted from the audit file — they are fabricated test personas and the ids are authoritative.

## 2026-08-08 (Booking — overlapping appointments are now prevented, and unchecked slots fail closed)

### Fixed — a booking conflicted only when the START TIMES were identical
`isSlotAvailable` counted booked leads with `.eq("appointment_datetime", isoDatetime)`. With production's 60-minute appointments and `max_concurrent_bookings = 1`, a booking at 10:00 and another at 10:30 **both passed**: neither timestamp equalled the other, each saw a count of zero, and the business was double-booked. `overlapsBusy` in the same file already had correct half-open interval logic — but it was only ever applied to the *external* calendar's busy windows, never to the org's own bookings. `PROJECT_CONTEXT.md` has listed "Double Booking Prevention" as complete throughout; it prevented identical-timestamp collisions only.

- **Semantics, not examples.** Two appointments conflict when their occupied intervals share any time. Appointments are all one org-configured length, so `[existingStart, +D)` overlaps `[start, +D)` exactly when `existingStart` lies strictly inside `(start-D, start+D)` — expressed as a strict range on `appointment_datetime` so Postgres still answers it with an index range scan rather than a table scan.
- **Half-open preserved**, so genuinely adjacent appointments stay bookable: one finishing exactly as the next begins is not a conflict. This is why the range bounds are strict.
- **One definition, two callers.** `appointmentOverlapWindow` (for the query) and `appointmentsOverlap` (for in-memory checks) are exported from `availability.ts` and used by both the shared capacity check and the voice held-slot check, so the two cannot drift apart.

### Fixed — voice carried the same hole
`isHeldByPendingRequest` and `fetchHeldSlots` were also exact-timestamp. A pending phone request at 15:00 left 15:30 both lookable *and* offerable as an alternative. Both now apply the same overlap rule; the alternatives search returns start instants rather than an instant-keyed map, because a map keyed by exact instant cannot express "14:00 also holds 14:30".

### Fixed — a database read failure produced a confirmed booking
`getBusinessHoursForOrg` returned `[]` for **both** "no hours configured" and "the query failed", discarding the `error` object it held. A Supabase blip therefore read as `no_hours_configured`, which deliberately fails OPEN, and produced a **confirmed, emailed booking for a time nothing had validated**.

- The two are now distinct. A failed read yields `reason: "lookup_failed"` and fails **closed**; a genuinely empty table still fails **open**, which is the behaviour a business mid-setup depends on.
- `isSlotAvailable` fails closed too (was `return true` — *"don't block bookings on a query error"*).
- `checkSlotCapacity` reports **why** a slot was refused, so a failed count is never spoken as *"that slot is fully booked"*. Both chat routes gained a branch that says only that the time could not be confirmed.
- `findNextAvailableSlot` returns null rather than a suggestion built on an unread table.

### Behaviour changes, deliberate
- **Bookings that used to be accepted are now refused** — any overlap, on every channel.
- **A reschedule no longer clashes with itself.** Under exact-match a lead moving 10:00 → 10:30 never met itself; under overlap it does. `isSlotAvailable` takes `excludeLeadId`, used by `/api/bookings/manage` and by lead capture. This is why `capturePartialLead` now resolves the existing lead *before* the availability check — the only structural change in the pass, and a pure reordering.
- **Voice says UNKNOWN, not "not available", on a failed hours read.** Caught by an existing test: the new fail-closed path made the voice guard fall through to "cannot be offered", which is as false as claiming it free. The guard now treats `lookup_failed` and `no_hours_configured` alike.

### A test-infrastructure gap found on the way
The PostgREST stubs implemented `eq`, `not.in`, `gte` and `lte` but silently ignored unknown operators — so the new `gt`/`lt`/`neq` filters were dropped and **every row matched**, producing four false failures that looked like bugs in the fix. The stubs now implement the missing operators, compare timestamps as instants rather than as text, and **throw on an unrecognised filter** so this cannot happen quietly again.

### Verified against the old code
The new tests were re-run with the overlap reverted to `.eq(...)`: **8 fail** (6 in `bookingOverlap`, 2 in `voiceAvailability`). A test that passes either way proves nothing, so this was checked rather than assumed; both files were confirmed byte-identical after restoring.

Scope: `src/lib/availability.ts`, `src/lib/voice/availabilityTool.ts`, `src/lib/leadCapture.ts`, `src/app/api/bookings/manage/route.ts`, both chat routes (type + one truthful branch each). **No change to OAuth, Google event creation, Stripe, provider configuration, voice prompt wording, schema or deployment config; no production data touched.** `npm test` **551 passing, 0 failing** (+36); `tsc --noEmit` clean.

## 2026-08-08 (Voice — call quality: stock phrases, false enthusiasm and "Good Goodbye.")

The fifth live call was **correct end to end** — availability-first, three email confirmations each with its own "is that right?", email in the owner summary, corrected address and alternate number both persisted, appointment labels right. This is a tone pass only; no behaviour was changed.

### Fixed — "Great choice." and other praise for routine answers
```
AI: "Great choice. Let's proceed with Thursday, 13 August at 9 AM."
```
- **Root cause: nothing banned praise.** SAY LESS covered stock *openers* ("Thank you", "Great", "Perfect") but said nothing about congratulating a caller for picking a slot, so the model filled the gap with its own enthusiasm.
- **Fix:** one clause inside the existing SAY LESS block — no new rule — naming "Great choice", "Excellent", "Wonderful" and "Perfect" as banned, with the replacement shown so "less" does not become curt: *"Thursday at 9 AM works. May I have your name?"*

### Fixed — "Good Goodbye."
- **Root cause: a THREE-sentence closing line.** `"Thank you for calling {business}. Have a great day. Goodbye."` Three farewells in one breath is what stacks and garbles.
- **Fix:** two sentences, never three — `"Thanks for calling {business}. Goodbye."` The old form is asserted gone, not merely discouraged.

### Fixed — two scripted stock phrases deleted at source
Both confirmation replies opened with a literal **"Perfect."** (`"Perfect. I'll pass your details…"`, `"Perfect. We'll make sure…"`). Removed. The recap example also opened with **"Just to confirm, Brian, …"** — the exact phrase SAY LESS bans, so the prompt was contradicting itself. The example now opens on the caller's name, with the contradiction called out inline.

### Fixed — shorter questions
The long form is now named as wrong: *"What's the address for the job?"*, never *"Could you please provide the address where the work is needed?"*

### Prompt length held flat, per the brief
Additions were paid for by deleting redundancy rather than by growing the prompt: rule 9's duplicate rationale (already stated in rule 5 step 4), the *"Say 'everything else', not 'everything I've summarised'"* sentence (the scripted line above it already says exactly that), and two unpinned trailing rationales. **21,500 → 21,506 characters, net +6.**

### Preserved, verified by marker
Availability-first (`THE CALENDAR CHECK`, rule 9's step-4 pointer, callbacks skipping it), `EVERY VERSION NEEDS ITS OWN YES`, `Is everything else correct?`, multi-field corrections, `CONFIRM THE TIME ONCE, THEN CHECK`, the seven summary labels including Email, `Number calling from`, `A READ-BACK IS A WHOLE TURN`, `SAY LESS`, and the truthful "preferred time" language. `vapi.ts` untouched, so turn-taking (`stopSpeakingPlan numWords 2`) is unchanged.

Scope: `src/lib/voice/assistant.ts` only — 4 lines changed. `npm test` **515 passing, 0 failing** (+4 regression tests); `tsc --noEmit` clean.

## 2026-08-08 (Voice — fourth live call: the correction check was told, not asked; and the owner never saw the email)

### Fixed — "Everything else is correct." was a statement
```
User: "No. My address is 21 Elm Drive... And can you change my number to 052121456?"
AI:   "Got it. 21 Elm Drive. And the number as 052121456. Everything else is correct."
```
- **Root cause: the scripted phrase was a bare declarative with a question mark on the end** — `"Got it — 15 Oak Drive. Everything else is correct?"` Two of the three instances on this call came out as questions, one as a flat statement and one trailing into a comma. A declarative sentence cannot be relied on to be *heard* as a question.
- **Fix:** the script is now grammatically interrogative — **"Is everything else correct?"** — with the flat form explicitly banned, because it tells the caller what to think instead of asking, and leaves the rest unconfirmed.

### Fixed — multiple corrections in one breath
The caller corrected the address **and** the number in one utterance and Remy handled it correctly, but the instruction said *"confirm ONLY that one field"*, singular. Now stated for the plural case: update them all, read back each corrected value once, still in a single turn, still no full re-read.

### Fixed — a corrected email was folded into "everything else"
```
AI:   "I've updated your email to jason moon 2 3 at gmail dot com. Everything else is correct?"
User: "Jason 1 2 3 at gmail dot com."
```
The initial email read-back worked. The **corrections** did not get one — each was repeated and then rolled straight into the wider question, so the caller's answer was about the other details, not the email. It took two more round trips to settle.
- **Fix: EVERY VERSION NEEDS ITS OWN YES.** A corrected email is read back and asked about on its own — *"is that right?"* — however many times it changes, including when the correction lands during the closing recap, where the new email is confirmed **first** and only then "is everything else correct?".

### Fixed — the owner summary never contained the email
The final email **was stored correctly** (`jason123@gmail.com`, after two corrections), but the owner's summary listed Name, Callback number, date, time, Address and Issue — no email anywhere.
- **The omission was not deliberate.** Nothing in the code or its history treats it as a design decision: the structured schema extracts email, the lead stores it, the dashboard shows it — the summary simply never had a label for it. There is no privacy rationale either; the same email already carries the caller ID and the full transcript.
- **Fix:** Email is now the second of **seven** labels, written in normal form (`michaelryan@hotmail.com`, never the spoken wording), and only ever the final confirmed version — this call had three.

### Fixed — two restatements before the calendar was consulted
```
AI: "I'll note your request for a radiator repair next Wednesday at 3 PM.
     Just to confirm, you mean Wednesday, 12 August at 3 PM."
```
**CONFIRM THE TIME ONCE, THEN CHECK.** Rule 6's date confirmation is the only restatement permitted before the check — no *"I'll note your request for…"* preamble, no second version after it. One sentence, then the tool. A chosen alternative is likewise not restated back; the recap is where the caller hears it again.

### Preserved and verified by marker
Availability-first (`THE CALENDAR CHECK`, rule 9's step-4 pointer, callbacks skipping it), alternative-slot handling, appointment-vs-callback labels, `Number calling from`, SAY LESS, read-back-is-a-whole-turn, no-full-recap-after-correction, and the truthful "preferred time" language. Stored data from this call confirms corrected address (`21 Elm Drive`), alternate callback number (`052121456` kept alongside the caller ID) and final email all persisted correctly.

Scope: `src/lib/voice/assistant.ts` only (rule 5 steps 4 and 6, rule 11, summary instructions). `npm test` **511 passing, 0 failing** (+5 regression tests); `tsc --noEmit` clean. Prompt 19,829 → **21,500** characters.

## 2026-08-08 (Voice — verification pass on the third live call; two tiny changes)

### Verified working from the stored row, not the transcript
The 12:53 UTC call ran on `56cd1af`. Checked against the actual `leads` record rather than the transcript rendering:

- **Spoken email normalised correctly.** Caller said *"jason 1 2 1 at gmail dot com"*; the transcript renders it that way, but the **stored value is `jason121@gmail.com`**. Structured extraction is converting spoken form to a real address, and the ambiguity confirmation still fired ("I've got that as… is that right?") before the caller corrected it.
- **Address correction is authoritative.** Deepgram transcribed *"32 Ellen Drive"* for a spoken "21 Elm Drive". The caller corrected it at the recap and the **stored `metadata.service_address` is `"21 Elm Drive"`** — the corrected value, with no trace of the misheard one.
- **Correction no longer triggers a full re-read.** *"Got it. 21 Elm Drive. Is everything I've summarized correct?"* — one field, then a single short question. The previous call re-read the entire summary here.
- **Semantic field validation held.** Asked for an email, the caller answered with an address; Remy rejected it — *"Sorry, Jason. Could you please provide your email address?"* — rather than storing whatever the transcriber returned.
- **Appointment labelled correctly.** The owner summary now reads *"Appointment date: Wednesday, 12 August. Appointment time: 4 PM"*, not "Callback date/time".
- **Availability-first intact**, and `appointment_datetime` `2026-08-12T15:00:00Z` = 4 PM BST, correct.

### Changed — the recap re-ask now scopes itself to the remainder
After a single-field correction, the wording is now *"Got it — 15 Oak Drive. Everything else is correct?"* rather than re-asking the wider "Is everything I've summarised correct?", which is what invited the full re-read in the first place. One sentence in rule 11.

### Documented, not built — the check-to-create race (`docs/ARCHITECTURE.md` §R3)
An alternative offered mid-call is **already safely derived** from the same authoritative availability result — the one `busy` list the decision fetched, plus the slot walker's hours/capacity rules, plus held-request exclusion, with anything past the fetched window refused rather than offered. **Re-checking on acceptance is redundant and no code was changed.** What is *not* guaranteed is the window between checking and writing, which is harmless while nothing is ever written and becomes real at milestone 5. Five required protections recorded, including that re-verification belongs next to the write rather than in the dialogue, and that a failed or conflicted create must never become "booked".

### Not fixed — address mis-transcription is a provider problem
"21 Elm" became "32 Ellen" — both the number and the street. Remy cannot see per-word confidence (Vapi does not expose it), so no prompt can distinguish a confident wrong string from a right one. The control that works is the final recap, and it worked: the caller heard it and corrected it. **No extra confirmations were added** — that would trade a real cost on every call against an error the recap already catches.

### Fixed — a known caller ID was summarised to the owner as "Not provided"
The owner summary printed **"Callback number: Not provided"** while the same email's **Caller ID row directly above it showed `+353871465274`**, and the lead stored it. A business reading that would conclude they had no way to ring the customer back.

- **Root cause: the summarising model only ever sees the transcript, and rule 7 forbids Remy from reading the caller's number aloud** — so no digits appear there, and the instruction to write "Not provided" when the caller gave no value was followed correctly. It was the honest-looking wrong answer. An earlier call rendered the same situation as "Number calling from", so the label was also inconsistent between calls.
- **Fix: one bullet in `buildSummaryInstructions()`** stating that the caller's own number is captured automatically from Caller ID and shown elsewhere in the email, so it is never missing merely because the transcript has no digits. If the caller agreed to be reached on the number they called from → exactly **"Number calling from"** (the existing convention). A different number spoken aloud → that number. **"Not provided"** survives only where it is earned: the caller explicitly refused a number *and* declined the one they were calling from.
- **No change to the email template**, which already renders the real number as its own `Caller ID` row — the defect was only the generated paragraph contradicting it.

Scope: `src/lib/voice/assistant.ts` (one sentence in rule 11, one summary bullet) and `docs/ARCHITECTURE.md`. `npm test` **506 passing, 0 failing**; `tsc --noEmit` clean; `vapi.ts` and `email.ts` untouched.

## 2026-08-08 (Voice — correction repetition, stock acknowledgements, and an appointment emailed as a callback)

### Availability-first worked. Preserved unchanged.
The live call did exactly the intended thing: requested Wednesday 3 PM → tool check → *"not available"* → two real alternatives → caller chose Thursday 9 AM → **checked again** → *"is available. I'll record that as your preferred time"* → only then name, email, address, number. Nothing in this change touches rule 5 step 4, rule 9, or `stopSpeakingPlan`; `vapi.ts` was not modified at all, and the markers are asserted.

### Fixed — one corrected field triggered the entire recap again
```
User: "No. It Elm. My address is Elm Drive, e l m, Elm."
AI:   "Thank you for correcting that. I've updated the address to 21 Elm Drive.
       Just to confirm, Jimmy, I've noted your preferred time as Thursday,
       13 August at 9 AM for the radiator repair. At 21 Elm Drive. I have your
       email as jimmy at gmail dot com, and the team will contact you on the
       number you're calling from. Is everything I've summarized correct?"
```
- **Root cause: rule 11 said to do it.** Its CONFIRMATION clause read *"If they correct anything (rule 10), recap once more and ask again."* Remy followed the instruction exactly.
- **Fix:** confirm only the corrected field — *"Got it — 15 Oak Drive."* — then go straight to "anything else?", restating no unchanged detail. The full recap repeats **only** when what changed was the appointment itself (date, time or service), where a mistake sends someone to the wrong job at the wrong hour. The same "correct only what changed" rule was added to the email read-back.

### Fixed — a stock thank-you opened almost every turn
Nine in a 175-second call: *"Thank you, Jimmy."*, *"Thanks."*, *"Thank you for correcting that."* ×2, *"Great, Jimmy."*, *"Thank you."*, *"Just to confirm..."* ×3, *"Perfect."*
- **Root cause: the prompt both instructed and scripted them.** Rule 2 said *"Ask, wait, acknowledge briefly, ask the next"*, and the worked examples the model copies from began with thanks — `"Thanks, I've got that as…"`, `"Thank you for correcting that. I've updated…"`, `take with a brief "Thanks."`
- **Fix, at the source rather than by adding variety:** rule 2 gains **SAY LESS** — most answers need no acknowledgement at all, never open two turns in a row with thanks, and *"the goal is FEWER WORDS, not a wider set of openers — do not swap one stock phrase for another."* The three scripted thank-yous were deleted from the examples; a test asserts they cannot come back.

### Fixed — an appointment was emailed as a callback
The owner's summary read *"Callback date: Thursday, 13 August. Callback time: 9 AM"* for a radiator repair visit.
- **Root cause: hardcoded labels in `buildSummaryInstructions()`** — *"give these six details… Name, Callback number, Callback date, Callback time, Address, Issue"* — regardless of what the caller asked for. The summarising model wrote precisely what it was told to.
- **The data itself was already correct.** The lead row carried `metadata.appointment_request: true`, `appointment_datetime` `2026-08-13T08:00:00Z` (09:00 BST, correct), and `service_address` `"21 Elm Drive"` — the corrected value, not the misheard one. Only the email wording was wrong.
- **Fix:** the date and time labels are now chosen from what the caller actually wanted — "Appointment date"/"Appointment time" for a service visit, "Callback date"/"Callback time" for a call back — *"decided from what the caller asked for, never from which words the receptionist happened to use."* "Callback number" deliberately keeps its name; it is the number to reach them on either way. Still six labels, and the existing grounding and urgency rules apply to both.

### Verified, not changed
- **Corrections persist correctly.** `service_address` stored the corrected `"21 Elm Drive"`; `email` stored the corrected `jimmy@gmail.com`. Structured extraction already treats the caller's correction as authoritative — no code change needed.
- **Caller ID was handled right**: asked once, no digits spoken.
- **`status: awaiting_confirmation` is correct, not an availability bug.** Traced to `serviceConfirmed === false` in `calls.ts` — the Knowledge Base has no radiator-repair entry, so the deliberate "team will confirm whether we can provide that service" path applied. Business hours (Thu 09:00–17:00) and capacity both passed; nothing occupied the slot.
- **Truthful language held**: *"I'll record that as your preferred time"*, never booked/confirmed/reserved. `createOrgEvent` still has no call sites, so that remains correct.

### Name softened, email read-back kept
An ordinary name is now taken as given and read back only where it may genuinely have been misheard. The email read-back is explicitly marked as the one that always happens — it is the detail speech-to-text mangles most, and a wrong one silently loses the confirmation.

### Scope
`src/lib/voice/assistant.ts` only (rules 2, 5, 11 and the summary instructions). **No change to `vapi.ts`, availability logic, alternative-slot generation, timezone, date parsing, lead capture, extraction, caller ID, email delivery, schema, credentials, routes or deploy config.** `npm test` **505 passing, 0 failing** (+4 tests; two pins updated for wording deliberately changed). `tsc --noEmit` clean. Prompt 18,550 → **19,829** characters.

## 2026-08-08 (Voice — live call after the flow fix: three causes, only one of them the prompt)

### The first and largest cause: the fix was never deployed. Third occurrence.
The live call ran the **pre-fix prompt**. Verified three ways: `git show origin/main:src/lib/voice/assistant.ts | grep -c "THE CALENDAR CHECK"` → **0**; the same against `HEAD` → **0**; the working tree → 1. Production's READY deployment reports `githubCommitSha` **8b4862e**, which is HEAD, which does not contain the change. So problems 1 and 3 had **no root cause in the code** — the availability step and the confirm-once rule were never in the prompt Vapi was given.

`CHECKLIST.md` already records this exact failure mode as a "deployment lesson, second occurrence". This is the third. The check that catches it is `git show origin/main:<file> | grep <marker>` after pushing; a green local suite never will.

### Verified — the live prompt path has no stale or provider-side copy
The assistant is **transient**: `assistant-request` → `buildAssistantRequestResponse` → `buildVoiceAssistantConfig` → `buildVapiAssistantResponse`, returned inline in the webhook response and rebuilt from source plus live `business_knowledge` on **every call**. There is no stored Vapi assistant, no generated prompt file, no cached or environment-specific copy, and no database-stored prompt (`voice_settings` carries only greeting, voice id and language). So the deployed `src/lib/voice/assistant.ts` **is** the live prompt — which is exactly why an undeployed change had no effect.

### Fixed — Remy was cut off mid-sentence by one-word agreement
```
AI:   "Just to confirm, you mean Wednesday, 12 August at 3 PM for"
User: "Yeah. Sorry. Can you say that again?"
AI:   "Of course. Just"
User: "Sorry?"
```
- **Root cause: no speaking plan was ever sent**, so the provider default applied — stop talking the moment ANY caller speech is transcribed. The caller's "Yeah." was agreement, not an interruption, and it truncated the question they were agreeing to; they then asked twice for a repeat and never heard it.
- **Fix: `stopSpeakingPlan: { numWords: 2 }`** in `buildVapiAssistantResponse` — one line. One-word acknowledgements ("yeah", "okay", "sure") no longer stop the sentence; a real interruption, which is essentially always two words or more ("sorry, can you", "hang on"), still stops it immediately. Deliberately not raised further: every extra word is a longer talk-over. The decline assistant is untouched — it speaks one sentence and hangs up.

### Fixed — "17 Elm Drive" was stored as "17 Ellen Drive"
- **Root cause: transcription, not prompt, extraction or post-processing.** The stored transcript itself reads `User: 17 Ellen Drive.` — Deepgram `nova-2` misheard it, and Remy faithfully repeated what it was handed. Remy never sees what was said, only what was transcribed.
- **A second, compounding cause: the read-back was merged into the next question.** Remy said *"I have noted the address as 1 7 Ellen Drive. I can use the number you're calling from. Is that the best number to reach you on?"* — the caller's "Yeah. Yeah." confirmed the **number**. The address check was present and useless.
- **Fix, both halves.** Rule 2 gains **A READ-BACK IS A WHOLE TURN** — never tack the next question onto a read-back, because the caller answers the last thing they heard. Rule 5's address step now uses the targeted clarification rule 8 already uses for services: if a street name is unusual or could plausibly be a mis-hearing, ask once naming only that part — *"Sorry, was that Birch Drive?"* — and nothing else in the turn. A clearly-heard address still gets a brief "Thanks." and nothing more.
- **The transcriber was NOT changed.** Swapping the speech-to-text model is a provider-config change affecting every word of every call, and this evidence does not justify it.

### Not reproduced — no false availability claim
The brief asked to stop Remy implying availability it had not verified. **The transcript shows it did not.** Remy said *"I'll note your preferred time as Wednesday, 12 August at 3 PM"* — the existing rule 9 "preferred time" wording — and never said available, booked, confirmed or reserved. That guard held and was left untouched. Nothing was changed for this item.

### One real bug found by the tests, during this change
Inserting the speaking plan **dropped `serverMessages: ["end-of-call-report", "status-update"]`** from the assistant payload — which would have stopped every end-of-call report reaching the webhook, silently killing lead capture, call records and owner emails. `voiceEndCall.test.mjs`'s "the rest of the assistant payload is unchanged" assertion caught it immediately. Restored and re-verified: the built payload carries all 10 keys and both tools.

### Scope and tests
`src/lib/voice/assistant.ts` (rules 2 and 5) and `src/lib/voice/vapi.ts` (one config line plus the restored `serverMessages`). **No change to OAuth, calendar connection, token handling, timezone, date parsing, availability calculation, alternative-slot generation, lead capture, caller ID, email, schema, credentials, routes or deployment config.** `npm test` **501 passing, 0 failing** (+5 tests); `tsc --noEmit` clean. Prompt 17,708 → **18,550** characters. **The acceptance test is another real call — automated tests prove the wording is in the built prompt, never that the model obeys it, and nothing here can prove the barge-in threshold without a live call.**

## 2026-08-08 (Voice — the calendar was checked last, and everything was confirmed twice)

### Fixed — availability is now checked before any customer detail is collected
Observed on a test call: the caller asked for "next Wednesday at 3 PM" and was taken through service, name, email, address and callback number **before anything looked at the calendar**. If the slot was never free, the caller had answered the whole interrogation for nothing.

- **Root cause: two rules disagreed about when, and the one that owns ORDER never mentioned the check.** Rule 9 has always said to call `check_availability` *"once you hold an appointment DATE and CLOCK TIME"* — but that instruction sits in the tail of a rule about booking language, while **rule 5** is the rule that owns the sequence the call is worked through, and its ordered list went straight from the day and time to the caller's name. The model followed the list.
- **Fix: the calendar check is now step 4 of rule 5**, immediately after the date and time are agreed and before name (5), email (6), address (7) and number (8) — with the reason stated, since a model needs to know *why* the order matters: *"name, email, address and number make no difference to whether a slot is free, so NEVER collect them first to find out."* Rule 9 gained one sentence pointing at the same step so the two can no longer drift.
- **The minimum-information exception is already satisfied by the existing order**: the service is settled at step 2, before the check, and `checkBookingSlot` takes only org, instant and duration. Nothing new is asked for in order to check.
- **A callback still skips the check entirely** (rule 13), so a callback request starts no calendar lookups.

### Fixed — Remy confirmed everything twice
The same call confirmed the date, then the email, then the address, each as its own turn, then read all three back again in the closing recap.

- **Root cause: confirmation was mandated per item in five separate places** (rule 5 steps for name, email and address; rule 6 for the date; rule 7 for the number) **and again wholesale in rule 11's recap.** Every scripted read-back was individually justified; nothing ever counted them together, so each item was confirmed twice by construction.
- **Fix: one CONFIRM ONCE, NOT TWICE clause in rule 2** (which already owns turn discipline) naming exactly where a read-back earns its turn — service, calendar date, email, name, and any number spoken aloud — and banning *"is that correct?"* on anything already understood confidently. **The address's inline read-back is removed**; it is now acknowledged and passed, with the recap covering it. Correction handling is untouched: a corrected address is still repeated back **whole**, never part-corrected.
- **The single final confirmation is kept** and now says so explicitly — *"it is one check at the end, not a re-reading of the whole call"* — plus a two-to-three-sentence ceiling.

### Deliberately NOT changed — booking language
The brief described a third state, *"BOOKED — say so only after the calendar create succeeds."* **That state is unreachable today**: `createOrgEvent` still has zero call sites, so the voice path never writes to a calendar. The prompt's existing ban on "booked"/"confirmed"/"reserved" wording, and its *"a time it reports as available is still only a REQUEST"* rule, are therefore correct as they stand and were **left exactly as they were**. Adding "you're booked" would have made Remy claim something no code performs.

### Scope
Four prompt strings in `src/lib/voice/assistant.ts` (rules 2, 5, 9, 11). **No code logic, no availability calculation, no alternative-slot generation, no date parsing, no timezone handling, no OAuth, no token storage, no calendar API config, no schema, no env var, no route.** Prompt grew 15,985 → **17,708 characters** (+1,723) for a bare org — see the standing note that the 11,399 "budget" has no documented origin. `npm test` **496 passing, 0 failing** (493 + 3 new); one existing assertion updated from 7 to 8 checklist steps, which is the count the new step changes. `tsc --noEmit` clean.

## 2026-08-08 (Provider independence & resilience review — documentation only, no code changed)

### Added — `docs/ARCHITECTURE.md` Part II
Extends the same-day guardrail review (Part I) with provider risk, failure isolation, truthful degradation, idempotency, source of truth, portability and recovery. **Nothing implemented, no provider migrated, no vendor added, no working integration touched.** `npm test` 493 passing, 0 failing, unchanged.

The headline: **the weak points are not abstraction gaps.** `CalendarCapability` is a real domain contract, `IntegrationError` is a provider-neutral taxonomy, `integrationFetch` gives every provider one timeout and one retry classification, and Google's client-supplied event id makes creation idempotent at the provider. Portability is good — **no `@vercel/*` import anywhere**, no `vercel.json`, no KV/Blob/Edge Config/Cron, no Supabase Realtime/Edge Functions/RPC. Idempotency is genuinely strong: eight independent guards, **no current duplicate-business-action vulnerability found**. Observability is correctly non-blocking (`tracesSampleRate: 0`, async buffered transport, no business path awaits Sentry).

### Found, not fixed — a database blip makes chat and the widget confirm a booking nothing checked
`getBusinessHoursForOrg` returns `[]` for **both** "no hours configured" and "the query failed" — it holds the `error` object and discards the distinction. `isWithinBusinessHours` reads the empty list as `no_hours_configured` and returns available; `isSlotAvailable` fails open on a query error by the same reasoning. So a transient Supabase error on the booking path does not degrade — it produces a **confirmed, emailed booking** for a time that may be outside business hours or over capacity.

The codebase already knows. `voice/availabilityTool.ts:391` guards against exactly this and states that doing otherwise *"is exactly what the engine's own 'could not check is never it is free' rule forbids"* — but that guard was deliberately scoped to voice so shared behaviour would not change. The consequence is that the rule the whole calendar design rests on is enforced against Google, enforced on the phone, and not enforced against the database on the website path. Deliberately left alone: the fail-open is load-bearing for the genuine no-hours-configured case, and changing it changes what happens to real bookings during a blip.

### Flagged before milestone 5 — the idempotency key is a trap for reschedules
`toGoogleEventId(idempotencyKey)` turns the key into the **permanent Google event id**, and a 409 correctly returns `alreadyExisted: true`. If the key is derived from the lead id, a rescheduled appointment re-derives the same key, hits the existing event, and reports success **carrying the old time**. The key must identify this *version* of the appointment, and `alreadyExisted: true` must never be read as "the calendar now matches" without an update or a verification read. Pairs with the appointment-identity decision from Part I.

### Before scale, recorded not built
A broken calendar connection is **invisible** — `needs_reauth` surfaces only on Settings → Integrations, no email or banner, while the phone correctly refuses to confirm anything; this will fire, because an unverified Google app in Testing mode issues refresh tokens that expire after 7 days. Email delivery state is neither tracked nor retried. `integration_jobs` — the durable retry queue with dedupe key, backoff and payload snapshot — is built, migrated, live, and has **zero consumers**; it is the right home for both. Plus: every `console.error` becomes a Sentry event (quota, not correctness), per-instance rate limiting, unproven restore, and no provider-health model. Also noted: `INTEGRATION_TOKEN_ENCRYPTION_KEY` is not part of the database backup, so a restore without the matching key holds credentials nobody can decrypt.

### Verified rather than assumed
Middleware matches nearly every request including `/api/*`, but `getUser()` short-circuits locally with `AuthSessionMissingError` when there is no session cookie — confirmed by reading the installed `@supabase/auth-js` source, not from memory. So the widget and voice webhook paths pay **no** auth round trip, and a Supabase Auth outage logs dashboard users out while leaving public routes untouched.

## 2026-08-08 (Architecture review — documentation only, no code changed)

### Added — `docs/ARCHITECTURE.md`
A future-infrastructure guardrail review against `8b4862e`. **No production code, schema, route, RLS policy, environment variable or feature flag was changed**, and no future roadmap feature was built. The architecture decisions in this repo were real and well-reasoned but scattered across `SESSION_SUMMARY.md` §20, SQL file headers and code comments — none of them a map. The document records the current architecture, the multi-tenant and calendar picture, deferred future-compatibility notes each with a stated trigger, and a compatibility map. `npm test` **493 passing, 0 failing** before and after (nothing executable was touched).

### Verified against production, read-only — credential tables are not readable via the anon key
Checked by **exposure rather than by reading `pg_policies`**, which PostgREST cannot reach: the same probe run with the service-role key and the anon key, printing counts only — no row contents, no keys, no PII. `integration_connections` returns **1 row to service-role and 0 to anon**, which is direct proof that RLS denies the public key on the table holding encrypted Google tokens; `leads` behaves the same (5 vs 0). This closes the outstanding `CHECKLIST.md` item that the 2026-08-07 verification never re-checked. ⚠️ `integration_jobs` and `integration_links` returned 0/0 because they are **empty** — their deny-all is inferred from the migration, not proven, and should be re-probed once the job queue has run.

### Found, not fixed — three booking-correctness findings, all pre-existing, all needing an owner decision
Recorded in `CHECKLIST.md` and `docs/ARCHITECTURE.md`; deliberately left alone because each changes core booking behaviour for every existing org.

- **Overlapping appointments are not prevented.** `isSlotAvailable` counts booked leads with `.eq("appointment_datetime", isoDatetime)` — exact timestamp equality, not overlap. With production's 60-minute appointments and `max_concurrent_bookings=1`, a 10:00 and a 10:30 booking both see a count of zero and both pass. `overlapsBusy()` sits in the same file with correct half-open interval logic, but is applied only to *external* busy windows, never to the org's own bookings. "Double Booking Prevention" is therefore identical-timestamp prevention. Every channel is affected.
- **Chat and the widget book without consulting the calendar, while the phone refuses on the same calendar.** `capturePartialLead` calls the internal engine directly and never `checkBookingSlot`; `voice/availabilityTool.ts` does. With `CALENDAR_AVAILABILITY_BLOCKING` live in production, the channels now disagree — and since no write path is wired, a website booking never reaches Google either. `/api/bookings/manage` has the same gap plus one more: a self-service reschedule will silently desync the external event once writes land.
- **A returning customer's second booking overwrites their first.** Lead-resolution layer 2 matches email/phone across conversations with no time bound, and `booked` is in `MERGEABLE_STATUSES`, so a chat/widget customer booking again a month later has the existing row mutated — first appointment gone from the calendar, and no confirmation email, because the send is guarded by `existing.status !== "booked"`. Voice is unaffected (layer 2 is skipped for `source='voice'`).

### Decision flagged before milestone 5 — appointment identity
`integration_links` carries `unique (subject_type, subject_id, connection_id, capability)`, so whatever `createOrgEvent` is eventually passed as `subject_id` becomes the permanent stored identity of the thing that owns a calendar event. Choosing the lead id means one lead can hold exactly one event forever, and un-baking it later means a data migration over live rows plus reconciliation against Google. Recommendation: write `subject_type = 'appointment'` from the very first event, with the lead's id as the value for now — no new table, no migration, no behaviour change, and the rows already say what they mean if appointments are ever separated from leads.

## 2026-08-07 (Integrations — choosing a Google Calendar could never save)

### Fixed — "Could not save your selection." on every calendar choice
Google Calendar connected successfully in production (`admin@niteowlhq.com`, status `connected`), but picking a calendar from the dropdown in Settings → Integrations failed every time and reset to "Choose…". Nothing was ever written: `integration_resources` stayed empty.

- **Root cause: `ON CONFLICT` cannot target a partial index.** `setPrimaryResource` upserted with `onConflict: "connection_id,resource_type,external_id"`, but uniqueness for org-level resources is a **partial** index — `… WHERE staff_id IS NULL`. Postgres only matches `ON CONFLICT` to a partial index when the statement repeats the predicate, and PostgREST's `onConflict` parameter has no syntax for one. Every attempt was rejected at planning time with **`42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification`**, surfacing as a 502 from `resources/route.ts` and that message in the UI.
- **Reproduced against the real database before fixing**, in a rolled-back transaction: the generated statement failed with `42P10`; the identical statement plus `WHERE staff_id IS NULL` got past planning and failed only on a deliberately invalid foreign key. Both ends verified.
- **The fix matches the index's own key instead of flattening the index.** `setPrimaryResource` now clears the previous primary (unchanged), selects on `connection_id + resource_type + external_id + staff_id IS NULL`, then updates by id or inserts. **No schema change, no new constraint.** Adding a non-partial `UNIQUE` was rejected: it would forbid an org-level row and a future staff-level row describing the same calendar, which is exactly the multi-staff flexibility the partial split exists to preserve — and which verify check (4) of the integration migration explicitly guards.
- **The race the upsert used to cover is handled.** Select-then-insert is not atomic; a concurrent selection losing to `23505` now adopts the winning row rather than failing the owner's click.
- **Why the OAuth connection saved but the calendar selection did not:** the sibling upsert for `integration_connections` targets `org_id, provider, account_id`, which the migration created as a genuine table-level `UNIQUE` constraint. Same code pattern, different index type — that asymmetry was the whole bug.
- **Behaviour deliberately preserved:** the write still forces `sync_enabled` and `availability_enabled` to true on an existing row, exactly as the upsert's `DO UPDATE` did. Unobservable today (no UI exposes either), but it is a preserved quirk rather than an endorsement — revisit when those toggles get a UI.
- Scope: one function in `src/lib/integrations/connections.ts`. No schema, RLS, OAuth, route, UI, Vercel or feature-flag change. The same latent bug would have hit any future integration selecting a resource.
- `npm test` **473 passing** (was 466; +7). `tsc --noEmit` clean. Lint unchanged — the same 10 pre-existing problems before and after.
- ✅ **Pushed, deployed and verified in production (2026-08-07).** Pushed as `01acbba` — a single fast-forward commit, nothing else carried. The production deployment reached READY, reports `githubCommitSha` `01acbbaa4440…` on `main`, and holds the `niteowlhq.com` alias. Selecting the default calendar in Settings → Integrations then created **exactly one** `integration_resources` row — `resource_type=calendar`, `external_id`/`name` `admin@niteowlhq.com`, **`is_primary=true`**, `staff_id=null`, org `e3a9ae40…`, connection `5cad7b94…` — against a table confirmed **empty** minutes earlier. The connection was **unaffected: `status=connected`, `last_error=null`**. A live `vercel logs --follow` tail spanning the click, filtered for `42P10`, `Failed to select resource`, `ON CONFLICT` and 5xx, emitted **nothing** — no production error was observed. `is_primary=true` with `staff_id=null` is precisely the org-level partial-index path that used to fail, so the fix was exercised rather than sidestepped, and the row survived a later independent re-read.

### ⚠️ Three of the seven new tests pass against the old code too
Verified by reverting the fix and re-running: **4 of 7 fail**, including the central assertion that no request may carry `on_conflict=` or `Prefer: resolution=merge-duplicates`. The three that still pass do so honestly — an upsert also POSTs on a first insert, clearing the old primary was never broken, and error propagation was already correct. Recorded because a test that passes either way is worse than no test if it is mistaken for proof. The tests stub PostgREST at the HTTP layer, so they prove the right requests are issued, not that Postgres accepts them; that half is covered by the live reproduction above.

## 2026-08-06 (Voice — a broad window is not an appointment time)

### Fixed — "next Wednesday afternoon" was accepted as a bookable appointment time
Live call: *"I'd like to make an appointment for a burst pipe."* → *"Which day and time would be best for the repair?"* → *"Next Wednesday afternoon."* Remy resolved **Wednesday, 12 August** correctly, then took "afternoon" as the complete time and moved on to the caller's name. A plumber cannot be sent to a burst pipe at "the afternoon".

- **Root cause: a callback rule applied to appointments.** Rule 6's window branch said a day plus a window *"is enough"*, unconditionally. That sentence was written the same day for CALLBACKS (rule 13), where a window genuinely is a usable preference. Remy followed it exactly — the instruction was wrong, not the model.
- **The fix is a conditional split of that one branch, not a new rule.** A window is still enough for a **callback** — confirmed, kept in the caller's own words, never narrowed. For an **appointment** it is not: the date is still confirmed, then ONE question — *"Wednesday, 12 August. What time that afternoon would suit you?"* — and conversational answers are taken as spoken ("3pm", "around 3", "half three", "quarter past two"), never asked twice. Still 13 rules; a test asserts only one window branch exists so two competing versions cannot drift apart.
- **No availability is invented.** Rule 9 gains one clause: *"You cannot see a calendar, so never say a time is available, free or reserved either."* Nothing queries a calendar — the availability engine remains unwired — and the pre-existing bans on "confirmed", "booked", "booked in" and guaranteed slots are untouched, as is the `REQUESTED or PREFERRED time, not an appointment` wording.
- **Intent is never silently converted.** Rule 13 gains *"Never downgrade an appointment to a callback because you cannot book it yourself"*, alongside the existing ban on the reverse.
- **Deliberately out of scope:** when live calendar availability is wired up, this branch should offer genuine free slots inside the caller's window rather than asking an open question. Not built here.
- **Untouched and re-asserted by tests:** `callbackTiming.ts` and its guard (a window is a real timing answer and still reaches `preferred_datetime` verbatim; only urgency is stripped), relative-date resolution, corrections, caller-ID and alternate-number handling, and the endCall tool — `vapi.ts` has a zero-line diff.
- Three prompt lines changed (rules 6, 9, 13). Prompt **15,181 → 15,646 (+465)**.
- `npm test` **426 passing** (was 406; +20). `tsc --noEmit` clean. Lint on changed files clean. One existing assertion was re-scoped from "a window is always enough" to "enough for a callback" — the behaviour it pinned moved, so the test moved with it.
- ⏳ **Not yet verified on a live call.**

## 2026-08-06 (Voice — Remy can now actually hang up)

### Fixed — the call stayed open after the goodbye, and every further farewell got answered
```
AI:   "Thank you for calling Nite Owl Test. Have a great day. Goodbye."
User: "Right."     AI: "Goodbye."
User: "Right."     AI: "Goodbye."
```

- **Root cause: no capability, not a prompt problem.** The transient assistant sent to Vapi carried **no `tools` array at all**. Remy could say goodbye but had no way to end the call, so the line stayed open until the caller rang off or `maxDurationSeconds` expired. The prompt alone could never have fixed this.
- **Vapi's built-in `{ type: "endCall" }`**, inline in `model.tools`, on both the main assistant and the decline assistant — the latter had already been instructed to "end the call" and could not either. Wire format verified against Vapi's docs before shipping: a default tool is recognised by `type` alone, no function name or parameters.
- **`endCallPhrases` deliberately not used.** It hangs up on literal phrase matches in the caller's speech, which would cut off *"bye for now, but I have another question"* mid-sentence. The tool leaves the decision with the model, which reads the whole turn; rule 11 states the single condition and the exception.
- **Rule 11:** the closing line is said once, nothing after it — no trailing second "bye" — and the call ends in the same turn. The only thing that stops it ending is the caller raising something new before the close.
- ✅ **Verified on a real production call**: the line now drops after one farewell.
- Also carried a lossless prompt-compression pass, **15,476 → 15,181 (−295)**, across rules 1, 2, 3, 5, 6, 8, 10, 11 and 13 — duplicated phrasing and illustrative examples only. **Five bolder cuts were reverted** because the suite caught them taking real behaviour (`Ask this once only`, `Assuming the number is fine is not confirming it`, `the version you first heard is gone`, `It will be SPOKEN in words`, `make sure you actually heard it correctly first`). No rule, safeguard or gate removed; no assertion changed.
- `npm test` **406 passing**. `tsc --noEmit` clean. Lint on changed files clean.

### ⚠️ The deployment lesson, for the second time
The first live test of this fix "failed" — and it was not a code failure. The fix had never been committed, so production was still running `cf031ec` with no `endCall` anywhere in it. Remy behaved exactly as the *deployed* prompt instructed. The same class of failure is already recorded against 2026-08-03 (`0b81e6f`).

**A green local suite can never detect "this was never pushed."** The check that does is `git show origin/main:<file> | grep <marker>` **after** pushing, which is now run explicitly as part of shipping rather than trusting a green Vercel status.

### ⚠️ Prompt length remains over budget
**15,646 characters, 4,247 over the 11,399 figure.** A dedicated lossless compression pass recovered only 295 characters before every remaining cut hit a test-pinned behaviour. Closing the gap means deleting working safeguards. Worth recording plainly: **the 11,399 number has no documented origin** — nothing in code enforces it, no test asserts it, no provider limit corresponds to it, and its earliest appearance already treats it as pre-existing. For scale, 15,646 characters is ≈3,900 tokens against gpt-4o's 128k context. The real costs are per-turn tokens, latency and instruction dilution — all gradual. Left for an explicit decision: re-derive the ceiling from measurement, or trade named behaviours away deliberately.

## 2026-08-06 (Voice — two fixes from live test calls)

### Fixed — callback vs appointment, and "as soon as possible" as a date
From the 6 August test call: the caller asked for someone to ring them back about an appointment, Remy took it as a booking, asked "which day and time would suit you best?", accepted "As soon as possible", and wrote the call up as `Callback date: as soon as possible` / `Callback time: as soon as possible`, then fell back to "the team will contact you".

- **New `callbackTiming.ts` — a deterministic guard, not just an instruction.** Urgency-only phrases ("as soon as possible", "ASAP", "whenever you can", "any time", "no preference") can no longer reach `preferred_datetime`. Anything carrying a real day, month, window or digit passes through untouched, so "Thursday, as soon as possible" and "any time between 2 and 5" are still stored verbatim. The caller's own words are kept on `leads.metadata.callback_urgency` — the urgency is not lost, it just stops being a date. No schema change; the dashboard reads named keys only.
- **Prompt rule 13 — a callback is not an appointment.** One scripted clarifying question when the intent is genuinely unclear, a shorter callback checklist (reason, day + window, name, number — no email or site address), and an explicit ban on ending the timing question early with "the team will contact you". Promises are limited to "I'll record that as your preferred time".
- **Rule 6 widened, not loosened.** A day with a broad window ("Thursday afternoon", "between 2 and 5") is now explicitly enough and must not be narrowed; a bare "tomorrow" still requires a time; urgency is stated to be neither a day nor a time.
- **Both extraction paths and the owner summary agree.** The Vapi schema and the transcript fallback both refuse urgency as a `preferred_datetime`, and the summary instructions write "Not provided" for date and time rather than the urgency phrase, reporting the urgency in the sentences instead. Corrections behaviour (rule 10) is unchanged.
- ⚠️ **Prompt length is 15,047 characters, 3,648 over the 11,399 budget** (10,822 → 14,518 on the withheld-caller-ID variant). HEAD already shipped 425 over and flagged it. Rule 13 is ~2,300 of the increase and rule 6's additions ~900; none of it duplicates existing wording, so getting back under the ceiling means cutting a working safeguard, which this task forbade. **Left over budget and flagged for your decision** — a trimming pass is the obvious follow-up, and it should happen before the next live test if call latency or instruction-following degrades.

### Fixed — "Remy answered a phone call" for a call Remy never answered
Also 6 August: an inbound call ended as `call.ringing.sip-inbound-caller-hungup-before-call-connect` with NULL duration and NULL transcript — the caller heard silence because the call never left the ringing state. The owner still received the standard email claiming Remy answered it, reporting no summary and no lead.

- **Nothing had failed.** `voice_events.processing_error` was NULL and the pipeline ran to completion; `processCallEnded` simply emailed unconditionally on every end-of-call report. Traced by elimination first — the owner email is the last statement in that function, so its arrival proved no exception had been swallowed.
- **`callNeverConnected()` in `calls.ts`** withholds that email only when Vapi's `call.ringing.` state prefix is present **and** there is no transcript, no summary and no lead. Every reason from a call that connected (`customer-ended-call`, `assistant-ended-call`, `silence-timed-out`, the pipeline errors) still emails exactly as before, and a null `endedReason` deliberately does not qualify — missing information must never silence a notification.
- **The call itself is still recorded.** The `voice_calls` row, its `endedReason` and its cost are written before this check, so nothing disappears from the dashboard or the event log. Dashboard-visible call status is unchanged.
- Regression tests drive the **real** `processCallEnded` with the HTTP layer stubbed and assert on whether a request reaches Resend: ring-aborted → none, connected `customer-ended-call` (the healthy 196s/2,671-char call from the same afternoon) → email still sent, including when it produced no lead.

- `npm test` **393 passing** (was 385 at the start of the session, 340 before the callback work; +53). `tsc --noEmit` clean. Lint on changed files clean; the two pre-existing repo-wide problems are untouched.
- ⏳ Neither fix has been verified on a live call yet.

## 2026-08-04 (Milestone 3 — availability engine, prepared but NOT wired in)

### Added — new files plus two additive changes; nothing calls the new engine
Session stopped here for usage limits. This is deliberately **code-complete and inactive**: the engine exists, is tested, and has **no call site**. Wiring it into lead capture is the first step of the next session, and is what would make it live.

- **`bookingAvailability.ts` — the intended single source of truth** for "can this slot be booked?", composed so that every channel (website chat, embedded widget, the phone AI's post-call capture, and any future API) can call one function. Order of checks: business hours → internal capacity → external calendar, with the external lookup running last and only when the first two pass, so a request that was never bookable costs no provider call.
- **`calendarService.ts` — the org-level calendar door.** Resolves which connection and calendar an org uses, obtains valid credentials, and calls the capability, so nothing upstream learns which vendor answered.
- **"Cannot check" is never "free".** A provider outage, an expired token or an unreadable calendar returns a failure, never an empty busy list — the caller must then refuse to confirm and send the lead for review. Treating an unknown as free is how a customer gets double-booked.
- **Log-only mode is the default.** An external conflict is recorded but the booking still proceeds until `CALENDAR_AVAILABILITY_BLOCKING` is explicitly enabled, so the log can be compared against reality before the system is ever allowed to turn a customer away.
- **`availability.ts` changed additively only.** The diff removes exactly five lines, each re-added with a behaviour-preserving default: `getLondonParts` gained an optional `timezone` (defaulting to `Europe/London`) and `findNextAvailableSlot` gained an optional predicate which, when omitted, leaves the loop identical. **The 173 existing voice and booking tests pass unchanged.** No integration module is imported into this file — the external layer composes on top of it, so the live booking path gains no new dependency and no new failure mode.

### ⚠️ The dev migration turned out to be only partially applied
Probed directly (read-only) before stopping: the four `integration_*` tables **exist on dev**, but **`organisations.timezone` does not**. Since the Supabase SQL editor runs a multi-statement script as one transaction, an error would have rolled everything back — so the script was most likely run in parts, or truncated before the final statement. The outstanding one-liner is in `SESSION_SUMMARY.md`. Code fails soft (`getOrgTimezone()` falls back to `Europe/London`), so nothing breaks, but per-org timezones cannot work until it exists.

**Production migration state could not be verified** from this environment — `.env.local` points at dev and prod is unreachable locally, as previously recorded.

**Security property verified on dev:** the anon key cannot even *see* the four tables — PostgREST does not expose them at all, which is the strongest possible denial and exactly the intent for the credential tables.

- `npm test` **325 passing** (was 311; +14). `tsc --noEmit` clean. Lint unchanged.
- ⏳ Not wired, not enabled, no live connection ever made. See `SESSION_SUMMARY.md` for the full handover.

## 2026-08-04 (Milestone 2 — OAuth connections on the Integration Framework)

### Added — connect, disconnect, refresh, reconnect, status; Google is the first integration to use it
Entirely behind `INTEGRATIONS_ENABLED`, which is off. With the flag unset every new route returns 404 and the Settings tab does not exist — verified against a running dev server, not assumed.

- **One generic route pair serves every integration**, not one per provider: `/api/integrations/[provider]/{connect,callback,disconnect,resources}`. The provider is a path segment resolved through the registry, so Microsoft, HubSpot or Meta need **no new endpoint** — only a registered integration.
- **Settings → Integrations renders itself from the registry.** An integration appears because it was registered, not because the page mentions it. There is no vendor branching in the page or its client component; the resource picker's label comes from the manifest, so the same control serves a calendar today and a WhatsApp number later.
- **Connection lifecycle written once** (`connections.ts`): store, refresh-on-use, status transitions, reconnect, disconnect. `getValidCredentials()` is the only way to obtain credentials, so refresh-on-use and the `needs_reauth` transition are guaranteed everywhere rather than being remembered at each call site.
- **Google is a plug-in, not a special case.** Every Google-specific fact — endpoints, scopes, the `calendarList` shape, the base32hex event-id alphabet — is confined to `providers/google.ts`. The composition root registers it in two lines, and an integration whose credentials are absent from the environment is simply not registered, so a half-configured deployment does not show a Connect button that dead-ends.
- **Tenant isolation.** The org always comes from the authenticated session, never from a query parameter, state value or request body. Every query carries an explicit `org_id` even where a row id would be unique, so a guessed connection id is not enough to reach another business's credentials. Encrypted credentials never leave the server module.
- **Disconnect actually disconnects**: revokes with the provider, deletes selected resources, and **nulls the stored credentials** rather than only flipping a status. Local disconnect still succeeds if the provider refuses.

### Failure modes closed at connect time rather than mid-booking
- **A partial scope grant is refused.** Google's consent screen lets a user untick individual permissions; without the check that surfaces much later as a confusing 403 during a customer's booking.
- **A grant with no refresh token is refused.** It would work for an hour and then die unrecoverably.
- **CSRF on the callback.** State is an httpOnly, `sameSite=lax` cookie bound to the provider it was issued for, compared in constant time — so a nonce cannot be replayed at a different integration's callback, and a crafted callback cannot attach an attacker's Google account to an owner's business. `lax`, not `strict`, because the callback is a cross-site navigation and a strict cookie would never be sent.
- **A 409 on create is success, not failure.** Google accepts a client-supplied event id derived from the lead, so a retry returns 409 rather than creating a second event. Treating it as failure would retry forever; treating it as a fresh create would double-book.
- **An unreadable calendar raises instead of looking free** — treating a permissions error as "no busy periods" would double-book a customer.
- **403 is disambiguated.** Google returns it for both rate limiting and insufficient permission, and only the body's reason code separates them: one must be retried, the other must not.

### Two things this version of Next.js changed
- `export const dynamic` is **not** in v16's route segment config. The Integrations page was prerendering as static, which would have baked in the flag-off redirect and kept serving it after the flag was switched on. Fixed with `await connection()`, this version's documented API. Build output confirms the page is now `ƒ` (dynamic).
- The settings layout was a client component, so it could not read a server-side flag. Split into a server `layout.tsx` plus a client `SettingsNav.tsx` — mechanical, and it keeps one flag rather than a `NEXT_PUBLIC_` mirror that could drift.

### A flaky test caught before it reached main
`npm test` passed, then failed on a re-run. The bug was in the test, not the crypto: it tampered with the **last base64url character** of the ciphertext, and for some payload lengths those trailing bits are padding that decoding discards — so the bytes came back identical and the blob authenticated correctly. Tampering is now done at the byte level, with a sweep across payload lengths 1–48 so the flaw cannot return. Confirmed deterministic over five consecutive runs.

- `npm test` **311 passing** (was 258; +53). `tsc --noEmit` and `next build` clean. Lint unchanged at the same 10 pre-existing problems.
- ⏳ Migration still **not run**; no real OAuth credentials exist yet, so no live connection has been made.

## 2026-08-04 (Milestone 1b — generalised to an Integration Framework)

### Changed — pre-runtime refactor; nothing shipped, nothing running, no production risk
Milestone 1 built a calendar-shaped abstraction. The directive is that every external integration — Google, Microsoft, CRMs, WhatsApp, Instagram, SMS — plugs into one framework rather than each bringing its own authentication, settings page and connection management. This re-lays milestone 1 on that basis **before** anything is wired up.

**Why now:** the milestone 1 code was imported only by its own tests, the migration had not been run on either project, and `CALENDAR_TOKEN_ENCRYPTION_KEY` was not set anywhere. So this cost a set of file edits. The same change after the SQL runs is a rename migration on live tables; after milestone 2 it is a rewrite of working OAuth.

- **The correction that drove the shape: not everything is OAuth.** Milestone 1 modelled credentials as `access_token`/`refresh_token` columns, which fits Google and Microsoft and then blocks the first non-OAuth integration — Twilio is an account SID + auth token, CalDAV is a username + app password, an ICS feed is a URL with no credential at all. Credentials are now one encrypted JSON document whose shape is chosen by a pluggable `AuthStrategy` (`oauth2` / `api_key` / `basic` / `none`).
- **Four generic tables** replace the three calendar-specific ones: `integration_connections` (a connected account, with a `capabilities` array), `integration_resources` (a selected remote object — a calendar, a WhatsApp number, an Instagram page, a CRM pipeline, keyed by `resource_type`), `integration_jobs` (the retry queue, which was never calendar-specific), and `integration_links` (a local record ↔ its remote counterpart).
- **`leads` is now untouched by this feature.** The seven `external_event_*` columns became `integration_links` rows, so one lead can be in a calendar *and* a CRM *and* a message thread, and the leads table gains nothing.
- **One primary resource per *type* per org**, still enforced by partial unique index — so a primary calendar and a primary phone number coexist, and multi-staff still needs no redesign.
- **Capability seam.** The booking engine's entire view of the framework is `getCalendarCapability(id)` returning a `CalendarCapability`. It cannot discover which vendor answered: the returned object has no manifest and no auth strategy, which a test asserts.
- **Registration validates the manifest.** An integration claiming the `calendar` capability without implementing it is rejected at registration rather than failing later inside a job against a real customer's calendar.
- **Only the `calendar` capability is defined.** `MessagingCapability` and `CrmCapability` are deliberately absent until there is a real requirement to shape them — inventing message-threading or deal-pipeline semantics with no spec would bake a guess into the framework, and a wrong guess is worse than no abstraction because everything then fights it.
- Shared auth logic extracted and tested: refresh-timing with a safety margin, scope-grant verification, and credential merging.

### Two production failure modes now covered by tests
- **A refresh must not wipe the refresh token.** Google issues no new refresh token when refreshing; replacing the stored credentials wholesale would discard the only long-lived credential and force every owner to reconnect within the hour. `mergeRefreshedCredentials` keeps the existing token when the provider declines to reissue one, and rotates it when Microsoft does.
- **A partial scope grant is caught at connect time.** Google's consent screen lets a user untick individual permissions; without the check that surfaces much later as a confusing 403 in the middle of a customer's booking.

- `npm test` **258 passing** (was 231; +27). `tsc --noEmit` and `next build` clean. Lint unchanged at the same 10 pre-existing problems.
- Env var renamed `CALENDAR_TOKEN_ENCRYPTION_KEY` → `INTEGRATION_TOKEN_ENCRYPTION_KEY`, and `CALENDAR_SYNC_ENABLED` now sits under a master `INTEGRATIONS_ENABLED`. Neither was set anywhere, so nothing to migrate.
- ⏳ Migration still **not run**; no OAuth credentials exist yet.

## 2026-08-04 (External calendar integration — milestone 1: schema, encryption, provider abstraction)

### Added — new files only; not one existing file was modified
First of seven milestones. Everything here is dormant: no route imports it, no query reads the new tables, and `CALENDAR_SYNC_ENABLED` defaults to off. `git status` for this commit is six additions and zero modifications, which is the intended shape — an org with no calendar connected behaves exactly as it does today, and that is every org.

- **Schema (`docs/sql/2026-08-04_calendar_integration.sql`, NOT YET RUN).** Three new tables plus additive nullable columns on `leads` and `organisations`. **Deliberately multi-calendar from day one**: there is no unique constraint on `org_id` anywhere. `calendar_connections` is keyed by `(org_id, provider, provider_account_id)` so a business can hold several accounts; `calendar_selections` is a separate table because one account exposes many calendars, and it carries a reserved `staff_id` (no FK — no staff table exists yet). Version 1's "one calendar" rule is a **partial unique index** on the primary flag, which extends to one-primary-per-staff without a schema redesign.
- **`provider` is intentionally unconstrained.** Adding Apple, CalDAV or ICS later must not need a migration, so the allowed set lives in the provider registry, not a CHECK.
- **Token security.** `calendar_connections` and `calendar_sync_jobs` have **RLS enabled with no policies at all** — deny-all to anon *and* authenticated, service-role only, so a signed-in owner cannot read their own encrypted tokens through the public anon key. `calendar_selections` holds no secrets and gets an owner read policy.
- **Encryption (`crypto.ts`).** AES-256-GCM, key from `CALENDAR_TOKEN_ENCRYPTION_KEY`. GCM rather than CBC so a tampered row fails loudly instead of yielding a corrupt bearer token. Every blob embeds its key version (`v1.iv.tag.ciphertext`), so keys can be rotated later without a migration or a re-encryption outage. A missing key throws rather than falling back to anything guessable.
- **Provider abstraction (`types.ts`, `registry.ts`, `errors.ts`).** The booking engine will import `CalendarProvider` and the registry, never `google.ts` or `microsoft.ts`. Providers are stateless — every method takes the access token, so they never touch the database and are testable against a fake fetch. A provider-independent error taxonomy (`auth_expired`, `rate_limited`, `transient`, `conflict`, …) is what the retry queue will branch on, so no caller ever reads an HTTP status.
- **Per-org timezones (`timezone.ts`).** No helper has a default zone — a caller cannot accidentally fall back to London. Providers will receive local wall time plus the IANA name, never a fixed offset, because a stored offset stops being true at a DST transition.

### A trap found and closed while testing
`Intl.DateTimeFormat` **accepts `"BST"` and silently resolves it to `Asia/Dhaka` (UTC+6)** — an owner picking it for British Summer Time would have had every appointment six hours out, with no error raised anywhere. `"EST"` likewise becomes `America/Panama`. Validation is therefore membership of `Intl.supportedValuesOf("timeZone")` (the ~418 canonical zones), not a `try/catch` around the constructor. Both the wrong behaviour and the hazard are pinned by tests so the check cannot be loosened back.

- `npm test` **231 passing** (was 173; +58). `tsc --noEmit` and `next build` clean. Lint unchanged at the same 10 pre-existing problems.
- ⏳ The migration has **not been run** on either project, and no OAuth credentials exist yet.

## 2026-08-04 (Calendar month view: the hidden appointments are reachable again)

### Fixed — `CalendarView.tsx` only; no change to any API, query, lead capture, booking logic, voice prompt, schema or deployment config
A month cell renders at most three appointment chips. On a day with more (6 August had five), the remainder sat behind a `+2 more` line that was a plain `<p>` — **no handler, no element to click**. Those appointments were unreachable from month view; the only way to see them was to switch to week or day view.

- **`+N more` is now a `<button>`** that opens a popover listing the day's full set, with an `aria-label` ("Show all 5 appointments") since "+2 more" alone says nothing out of context.
- **A chip on a shared day opens the same popover**, so any click in a crowded cell reaches every appointment on it. A day with a **single** appointment still opens that appointment's detail panel directly, exactly as before.
- **Each row in the popover opens the existing `EditPanel`**, unchanged — the popover closes first so the two are never stacked.
- **Closes on outside click, on Escape, and on the close button.** Also on scroll and resize: the popover is positioned from the cell's viewport rect, so it would otherwise drift away from the day it belongs to.
- **Desktop and mobile.** Anchored beside the cell on desktop, clamped back inside the viewport for cells in the last column or against an edge. Under 640px it becomes a centred sheet with a dimmed backdrop — a 288px popover hung off a ~45px-wide cell would fall off-screen.
- **Paging months drops a popover left open**, rather than re-pointing it at the same date number in the new month. Guarded during render, not in an effect.

**There is no FullCalendar in this project** — the calendar is a hand-written component (`CalendarView.tsx`), so there was no library behaviour to configure or restore. The popover deliberately mirrors what FullCalendar's dayGrid `+N more` does, because that is the behaviour people expect from a month grid.

- `tsc --noEmit` clean, `next build` clean, `npm test` **173 passing** (unchanged — this is UI-only and the suite covers lib code). Lint unchanged at the same 10 pre-existing problems; the one warning in this file (`businessName` unused) predates the change.
- ⏳ **Click-level behaviour is not machine-verified.** `/calendar` is behind auth and this repo has no jsdom, no component test runner, and no browser automation available in-session, so the popover opening, Escape/outside-click closing, and row → detail panel were confirmed by reading the wiring, not by clicking. Structure *was* verified against a running dev server with fixture data on a temporary unauthenticated route (since deleted): the crowded day rendered three chips plus a real `<button aria-label="Show all 5 appointments">`, with the other two appointments correctly absent from the cell.

## 2026-08-04 (Spoken polish: five wording fixes from the live call)

### Changed — voice system prompt wording only; no change to the conversation flow, recap or confirmation logic, booking, date parsing, lead capture, calendar, database, email generation, deployment configuration or UI
Five defects heard on the passing live call. All five are wording; none moves a step, relaxes a gate, or touches anything outside `buildVoiceSystemPrompt`.

1. **Business name said as "Night Owl Test" for an org stored as "NiteOwl Test".** The prompt already interpolated the stored name verbatim — the model was re-spelling it into two words. The opening line now says to use that name exactly as written, never re-spelled or split. ⚠️ **If the mispronunciation is the text-to-speech voice rather than the model's text, this cannot fix it** — the prompt controls the words Remy emits, not how the voice renders them. That would be a Vapi voice/pronunciation-dictionary setting, which you asked me not to touch. Worth listening for specifically on the next call.
2. **"I have your email address please?"** — rule 5 named the email step but never scripted the question, so the model improvised and dropped the opening word. Step 5 now carries the exact wording: "May I have your email address, please?"
3. **Half-corrected addresses spoken aloud** ("15 O Drive", "15 Ork Drive" on the way to "15 Oak Drive"). The address step now says to change only the wrong part and say the whole corrected address back once, never a part-corrected one, with the acknowledgement scripted: "Thank you for correcting that. I've updated the address to 15 Oak Drive."
4. **"And and someone will contact you…"** — **a scan of the prompt source and the built prompt for repeated words found none**, so there was nothing to delete; the stutter was generated, not copied from an instruction. Fixed at both ends instead: rule 1 now forbids repeating a word, and the follow-up sentence is scripted rather than improvised — "Someone will contact you as soon as possible." (It had no scripted form after the end-of-call rewrite removed the old combined closing.)
5. **"Anything else?" asked more than once.** Tightened from "once each time a recap has just been confirmed" to **ONCE per call**. The yes-path still loops through rule 5 and a fresh recap, but now goes straight to the goodbye after the second confirmation instead of re-asking.

- `npm test` **173 passing** (was 168). Four new assertions pin fixes 1–4 and one pins the yes-path; three existing assertions had their wording updated where these fixes changed the text they matched (the email step, the post-confirmation line, and the "anything else?" guard). No test was relaxed and no other test was touched. `tsc --noEmit` clean.
- ⚠️ **Prompt length is 11,824 characters, 425 over the 11,399 budget.** The five fixes add ~490 characters of genuinely new instruction — three scripted sentences you specified verbatim, plus two guards. Only ~65 characters of safe redundancy were left to offset them ("never guess" in rule 11, already stated in the same sentence; "the rule 11 recap" → "the recap" in rule 10). The 787 characters recovered in the previous entry took everything that was duplicated phrasing; what remains is load-bearing — three cuts had to be *reverted* last time because they turned out to be behaviours. **Getting under 11,399 now means deleting a working safeguard, which this task forbids, so it is left over budget and flagged for your decision.** Candidates, if you want them, with what each costs: rule 8's correction clause (~120, duplicates rule 10 — needs a test update), rule 6's vague-time fallback example (~74, but the vague-time path is still untested on a live call), rule 5's "the only way you ever obtain a contact number" (~47), rule 9's "and, if we can, they'll arrange your appointment" (~48).

## 2026-08-04 (Recap before "anything else?" — end-of-call order)

### Changed — voice system prompt rule 11 only; no change to date parsing, "tomorrow" resolution, date confirmation, email/address/callback-number collection, the completion gate, lead creation, calendar creation, dashboard, email summaries, Vapi/Twilio configuration, schema or UI
Conversational refinement only. The end of the call ran number → "Is there anything else I can help you with?" → recap → goodbye, so the caller was asked whether they needed anything more *before* a single detail had been read back to them. A receptionist reads the details back, gets a yes, and only then asks whether there is anything else.

- **The call now ends in a fixed order**: recap → the caller confirms it → "Is there anything else I can help you with today?" → goodbye. Rule 11 states the order explicitly and forbids asking "anything else?" before the recap has been confirmed.
- **The recap is now complete, not a one-line summary.** It names the service, appointment date, appointment time, caller's name, callback number, address and any important note — still spoken as natural sentences rather than read out as a list of labels, still giving the weekday *and* the calendar date, still never speaking the network caller ID's digits, still carrying only corrected values (rule 10) and only details the caller actually gave.
- **The confirmation is its own question and Remy waits for it**: "Is everything I've summarised correct?" A correction is taken (rule 10), the recap is given once more, and the question is asked again. Only on a yes does Remy say "Perfect. I'll pass your details to our team straight away." The urgent/needs-a-human line and rule 9's not-listed closing line are unchanged alternatives to that sentence, still never two of them.
- **"Anything else?" can now loop, but only through a confirmed recap.** A yes sends Remy back through rule 5 for whatever is new, then a fresh complete recap and the confirmation question again. The old "at most ONCE per call" guard is replaced by a tighter one — once per confirmed recap, never twice in a row, never between questions, never again after a no — so the repetition this rule exists to prevent ("Are you sure there's nothing else?") is still banned.
- **The goodbye is now the last thing said**: "Thank you for calling {business}. Have a great day. Goodbye."

### Unchanged, deliberately
The rule 5 completion gate is untouched and not weakened. It still blocks all three exits — "anything else?", the rule 11 recap, and anything that sounds like goodbye — and since the recap is now the *earliest* of those three, the gate binds at least as early as it did before. Booking logic, `parseDatetimeToIso`, caller-ID handling and spoken-email normalisation were not opened.

- `npm test` **168 passing** (was 163). Five new assertions pin the new order; three existing assertions were updated for the new wording (`voiceConversation.test.mjs` — "anything else?" repetition, "the only recap in the call"; `callerId.test.mjs` — "Only after they confirm" → "Only once they confirm"). No test was relaxed. `tsc --noEmit` clean.
- ⏳ **Not yet verified on a live call.** As recorded below, these tests assert the instruction is present in the built prompt; only a real call proves the model follows the new order.

### Then trimmed back under the length budget — redundant wording only
The new flow first landed at 12,138 characters, 739 over the 11,399 budget. A second pass brought it to **11,351** (10,822 on the withheld-caller-ID variant) — 48 characters of headroom, and 24 *below* what shipped on 2026-08-03. **The whole 787 characters came out of duplicated phrasing and illustrative examples; not one rule, safeguard or gate was removed, and the new confirmation flow is untouched.** All 168 tests still pass **without a single assertion being changed**, which is the check that matters: every phrase a test pins is a behaviour verified on a live call, so if a cut had taken one, the suite would have caught it.

- **Deliberately not touched**: rule 7 (its comment records that its wording is left as-is because a paraphrase there can cost a lead nobody can ring back); the currency example `"€100" → "100 euros", never "100 dollars"` (a real 2026-07-15 live-call failure — calls were reading `€100` as "100 dollars"); the completion gate; and every rule-11 sentence added by this change.
- **What went, and where the behaviour still lives**: rule 1's reassurance example (near-identical to rule 11's urgent line); rule 2's double-question example and "never talk over the caller" (restated by "if they interrupt, stop talking, listen"); rule 5's step-1 rationale clause (both instruction bookends kept); rule 6's "the caller must have heard the date you settled on" (restated by "never say a date you have not had confirmed" and rule 5's "get their agreement BEFORE step 4"), two of five vague-time examples, "acknowledge it and move on" (restated by "Do NOT ask for the date again"), the say-no branch (restated by the next sentence, "ask plainly which date they mean rather than picking one"), and "never write down a time they did not say" (also in rule 11, the structured-data schema *and* the summary instructions); rule 8's "never several guesses" and "if they confirm it, carry on normally"; rule 9's "confirm the details back" (rule 11's recap now does this on every call) and two bans restated verbatim by the blanket ban two sentences later; rule 10's second correction example, "use only the new value" and the alternatives example.
- **Three cuts were reverted after review.** A word-level diff of the built prompt against the previous commit showed "acknowledge briefly" (rule 2), "never read out several" (rule 3) and "use their name" (rule 5) were small *behaviours*, not phrasing. They were restored and paid for with rule 6's genuinely duplicated say-no branch. Auditing the diff of the rendered prompt — not the source — is what surfaced them.

## 2026-08-03 (Appointment requests: confirmed calendar dates and a completion gate) — ✅ LIVE PRODUCTION TEST PASSED

### Fixed — voice system prompt only; no change to date parsing, caller-ID infrastructure, spoken-email normalisation, service extraction, lead isolation, status handling, booking, calendar, Knowledge Base, dashboard, chat, widget, pricing, schema or Vapi/Twilio configuration
Two commits, each driven by a real call: `d16b343` (confirm the calendar date behind a spoken weekday) and `c2d311b` (close the completion gate on appointment requests).

- **Remy now knows what day it is.** The voice prompt carried no date at all, so when a caller said "Thursday at 2 PM" Remy had nothing to resolve it against — it accepted the weekday, never said a date aloud, and closed with "this Thursday at 2 PM". The dashboard still stored 06/08/2026 correctly, because `parseDatetimeToIso` resolves *after* the call; the caller simply never heard or agreed a date. Today's date is now rendered into the prompt (`Europe/London`, matching the parser's default so the two agree), passed in as an optional `now` argument so the builder stays pure and testable.
- **Rule 6 owns date and time** with four branches: time only → ask which day; day only → ask what time; weekday or relative day → resolve and CONFIRM ("Just to confirm, you mean Thursday, 6 August at 2pm?"), settled only once the caller agrees; explicit date → do not ask again. Ambiguity is asked about, never guessed. The existing vague-answer rules were folded in unchanged.
- **A requested time is not a booking.** Rule 9 now states the time taken is the caller's requested/preferred time; "confirmed", "booked", "booked in" and "see you then" are banned *while on the call*, conditionally — the ban turns on whether the business has actually confirmed, not on the words. Rule 11's recap gives the weekday AND the calendar date, never a bare weekday, and the owner's summary reports a settled calendar date rather than reducing it to a weekday.
- **A second live call then exposed the completion gate leaking.** A boiler-service call collected date, time, name and email, then asked "Is there anything else I can help you with?" without ever requesting the service address — the caller had to interrupt. Remy also said the team would ring "on the number you're calling from" without asking whether that was the best number. A gate already existed; two wordings let the model past it. **Email was not a required field** (it was a sub-clause of the name step) and **address and number carried "only when…" conditionals** the model could judge its way out of — the address step said "ONLY for jobs at the caller's premises (plumbing, electrical, heating…)", leaving Remy to decide whether a boiler service qualified.
- **The gate is now named, enumerated, and blocks all three exits** — "anything else?", the rule 11 recap, *and* the goodbye. Previously only the goodbye was blocked, which is exactly how the call reached "anything else?" with the address missing. Email is step 5 in its own right; the address step reads "EVERY job at the caller's premises: boiler and heating work, plumbing, electrical, repairs, installations, inspections, cleaning"; the number step states caller ID does not excuse asking rule 7's question and getting a yes.

### Verified — real production phone call, 2026-08-03
The final call passed every requirement: resolved and confirmed "Thursday, 6 August at 2 PM"; collected and confirmed the caller's name; collected and confirmed the email; **proactively asked for the service address without being prompted**; asked whether the caller ID was the best callback number; accepted an alternate number and repeated it back for confirmation; stored the correct calendar date/time; and included the address and the alternate callback number in the owner notification.

- `npm test` **163 passing** (was 130 before this work). `tsc --noEmit` and `next build` clean throughout.
- Prompt length held under the 11,399-character ceiling at every step (11,327 as shipped). The gate cost ~250 characters; ~370 was recovered by tightening rules 1, 2, 3, 8, 9 and 11 — duplicated examples and redundant phrasing, no behaviour dropped.
- **A deployment lesson worth recording.** The first "failed" live test was not a code failure: the fix had never been committed, so production was still running `0b81e6f` and the prompt genuinely contained no date. Verifying that a fix is *in the pushed commit* — `git show HEAD:<file>` — is now part of the routine, not just that tests pass locally.
- **A testing limitation worth recording.** These tests assert that instructions are present in the built prompt. They cannot prove the model obeys them; only a live call does. Both live failures were behaviours a green suite had already "passed".

## 2026-08-03 (Spoken emails said as a sentence)

### Fixed — `normaliseSpokenEmail` only; no change to lead isolation, caller ID, alternate numbers, booking, calendar, Knowledge Base, dashboard, chat, widget, pricing, schema or Vapi/Twilio configuration
Resolves the limitation recorded in the entry below. Normalisation assumed the extracted field held the address alone, so a whole sentence had its leading words folded into the local part: "My email is michael dot ryan at hotmail dot com" became `myemailismichael.ryan@hotmail.com` — wrong, but well-formed enough to be saved and emailed.

- **A closed list of conversational lead-ins** is stripped from the start: "my/the email (address) is", "email address is", "it's"/"that's"/"this is", "you can/please email|contact|reach me at|on". Deliberately a fixed list, not a general "drop unknown words" pass — deleting a word that turned out to be part of the address would produce a plausible but wrong result. Lead-ins ending in "at"/"on" consume that word, because "you can email me **at** michael dot ryan **at** hotmail dot com" has two and only the second is the `@`.
- **Filler phrased any other way is rejected, not absorbed.** Before spaces are closed up, the words destined for the local part are counted; more than four means a sentence rather than a name, and the result is dropped. "erm hang on it is probably michael dot ryan at hotmail dot com" returns null instead of an address nobody has.
- All four requested phrasings now resolve to `michael.ryan@hotmail.com`, and a lead-in in front of an already-valid address ("My email is michael.ryan@hotmail.com", "It's pat@gmail.com") passes through unchanged.

### Verified
- `npm test` **138 passing** (was 130 — 8 new: the four sentence forms plus variants, a lead-in before a valid address, a lead-in with nothing behind it, a lead-in before a half-heard address, and unknown filler being rejected). The voice-lead isolation and caller-ID suites are untouched and passing.
- `tsc --noEmit` and `next build` clean.
- **Still unhandled:** trailing filler. "michael dot ryan at hotmail dot com thanks" yields `michael.ryan@hotmail.comthanks`, since the pattern accepts a long TLD. Scoped out deliberately — the fix is prefix-only.

## 2026-08-03 (Spoken email addresses, and clearer service descriptions)

### Fixed — voice contact normalisation and two prompt rules only; no change to lead isolation, caller ID, alternate numbers, booking, calendar, Knowledge Base, chat, widget, dashboard, pricing, schema or Vapi/Twilio configuration
An email given over the phone arrives as words — "michael ryan at hotmail dot com" — and could be written into `leads.email` in that form. That field is the address `sendBookingConfirmationEmails` sends to, so a spoken form there is a confirmation the customer never receives.

- **Deterministic normalisation before the lead is written.** New `normaliseSpokenEmail` (`src/lib/voice/spokenEmail.ts`), applied in `toExtractedLead` exactly where `normaliseSpokenNumber` already handles the phone field. Converts spoken punctuation — "at", "dot"/"point", "underscore", "dash"/"hyphen" — and closes up the spaces between spoken words: "michael ryan at hotmail dot com" → `michaelryan@hotmail.com`. An address that already arrives well-formed short-circuits before that pass, so real addresses containing those letters (`pat@`, `dorothy.dotson@`, `matt@atlas.com`) are never rewritten; word-boundary matching protects them where conversion is still needed.
- **Unusable input is dropped, not guessed.** Anything that cannot be made into a valid address returns null rather than saving the spoken wording — the same rule already applied to unusable phone numbers, and it avoids a guaranteed bounce. The caller's actual words are not lost: they remain in the call transcript and the owner's summary email.
- **Remy reads the address back and waits for a yes** (rule 5 step 4). Previously it confirmed an email without being told to convert the spoken form first. It now turns the spoken words into an address, reads *that* back — "Thanks, I've got that as michaelryan@hotmail.com — is that right?" — and treats it as confirmed only once the caller agrees. The extraction schema and the fallback transcript extractor both now require normal email format and never the spoken wording.
- **Garbled service descriptions get the same one clarification as mis-heard names** (rule 8, widened). The rule previously covered only a service *name* close to something in the Knowledge Base ("valer service" → "boiler service"). "Leaking kitchen tap" arriving as "leaking kitchen cap" matches nothing listed, so it fell through. The rule now also covers "just an odd way to describe a job", and states that a corrected description replaces the version first heard.

### Verified
- `npm test` **130 passing** (was 110 — 20 new: 14 for the normaliser including the reported case, multi-part domains, underscore/dash forms, valid-address passthrough and the "pat"/"dorothy" safety cases, plus 6 prompt assertions). All 7 voice-lead isolation tests and the caller-ID/alternate-number suites unchanged and passing.
- `tsc --noEmit` and `next build` clean.
- **Known limitation, not yet fixed:** normalisation assumes the extracted field holds the address alone. If a whole sentence reaches it ("My email is michael dot ryan at hotmail dot com"), the leading words are absorbed into the local part — `myemailismichael.ryan@hotmail.com`. The extraction prompts ask for the address only, so this should not occur in practice; a follow-up should strip leading filler and reject a local part that looks like a sentence.
- **Not tested with a real phone call by the assistant.** Outstanding: say an email in words on a call, and confirm the lead stores the normalised address.

## 2026-08-03 (Remy can no longer end a call on an incomplete lead)

### Fixed — voice conversation flow and post-call summary only; no booking logic, availability, capacity, chat, widget, onboarding, Knowledge Base, Leads UI, email template, pricing, schema or API changes
A test call reporting an urgent ceiling leak ended with Remy having asked only for the caller's name and "when would be a good time to get in touch?", accepting "tomorrow" and hanging up. No exact time, no callback number, no address — and the owner's email then described it as having "gathered Brian's name and a preferred callback time for tomorrow", which reads like a time was actually agreed.

- **A mandatory pre-close checklist (new prompt rule 20).** Remy may not end a call needing follow-up until name, callback number, callback **day**, exact callback **time**, the issue in the caller's own words, and the service address (where applicable) are each collected *or* explicitly refused. Missing items are asked for one at a time, and closing phrases — "I have everything I need", "thank you for calling" — are banned while any line is open. An explicit refusal closes a line: Remy acknowledges once and moves on rather than pressing, and never invents the detail.
- **Vague times are no longer answers (new rule 18).** "Tomorrow", "later", "the morning", "the afternoon", "this evening", "sometime this week" and "as soon as possible" are named in the prompt as non-answers, each requiring a follow-up ("What time tomorrow would suit you best?") until a specific day *and* clock time exist. Capped at two asks — a caller who genuinely cannot commit is accepted as-is, and Remy is told never to write down a time they did not say.
- **Service address for on-site trades (new rule 19)** — plumbing, electrical, heating, HVAC, cleaning, repairs, installations, deliveries, inspections. Asked as its own question and confirmed once. `service_address` is added to the extraction schema and the fallback transcript extractor, and stored in the existing `leads.metadata` JSONB alongside `caller_id`/`alternate_phone`. **No schema change** — `ExtractedLead` is shared with chat/widget and was deliberately left alone.
- **A final read-back before closing (rule 11, rewritten).** Rule 11 previously said *not* to recap at the end. It now requires one confirmation — "Just to confirm, I have Brian, your ceiling leak at 24 Main Street, callback on +353871234567 tomorrow at 10:30am. Is that all correct?" — including only details the caller actually gave, and closes only once they confirm. Rule 2's ban on read-backs gained a one-clause carve-out so the two rules do not contradict each other.
- **Remy confirms the caller ID instead of ignoring it (rule 5, rewritten).** This deliberately reverses part of the caller-ID fix directly below, which told Remy never to ask for a number *and never to read the caller ID back*. The lead must carry a number the caller can actually be reached on, but a yes/no confirmation ("I can see you're calling from +353871465274. Is this the best number to reach you on?") speaks no digits, so the mis-transcription that fix was written for still cannot reach the lead. **The data precedence is unchanged:** caller ID still wins `leads.phone`, and a genuinely different number is still stored as `alternate_phone`.
- **The owner's summary is now grounded in the transcript.** Vapi's default summary prompt is "summarize the call in 2-3 sentences", which is what let an incomplete call read as complete. `analysisPlan.summaryPlan.messages` now carries custom instructions: caller-said facts only, no inferred or adjusted date, time, number, address or name, a vague phrase written verbatim rather than converted to a clock time, and a detail counted as collected **only if the caller gave or confirmed it** — not if Remy merely offered it. Six labels are always present (Name, Callback number, Callback date, Callback time, Address, Issue) with a mandatory `Not provided` for anything missing.
- **`preferred_datetime` can no longer be sharpened.** Both the structured-extraction schema and the fallback transcript extractor now say a vague answer must be recorded verbatim, never turned into a specific clock time, and never borrowed from a time the receptionist suggested but the caller did not accept.
- The summary wire format was **confirmed against Vapi's OpenAPI spec** (`SummaryPlan.messages`, variables `{{transcript}}`, `{{systemPrompt}}`, `{{messages}}`, `{{endedReason}}`) rather than assumed — `types.ts` had explicitly deferred custom analysis prompts until that was checked. The user message mirrors Vapi's documented default so only the instructions differ. Instructions live in `assistant.ts` with no provider template syntax (a test asserts this); the adapter owns the `{{…}}`. If Vapi ever rejects the shape, `call.analysis.summary` comes back **empty, not wrong** — the email says so, and the lead still comes from `structuredData`.

### Verified
- `npm test` **59 passing** (was 50 — 9 new: the confirm-don't-ask caller-ID variant, alternate-number precedence, vague-time follow-up, all six checklist lines, the final read-back, `service_address` in the schema, the grounded summary instructions, and the rendered `summaryPlan` shape/timeout. Two assertions pinning the old "never ask for a number" wording were updated, since that behaviour changed deliberately).
- `tsc --noEmit` and `next build` clean. `eslint` reports only the pre-existing errors in `ConversationView.tsx` and the other files listed below — none in any file touched here.
- **The new summary instructions were run against the actual failing transcript.** Old output claimed "a preferred callback time for tomorrow"; new output is "Name: Brian. Callback number: Not provided. Callback date: tomorrow. Callback time: Not provided. Address: Not provided." A complete transcript was checked too, to confirm it does not simply default to "Not provided": every field came through, with "Half ten in the morning" kept as spoken rather than normalised.
- **Not tested with a real phone call by the assistant** (no way to place one). Outstanding end-to-end check: ring the number, give a vague time, and confirm Remy pushes for an exact one, asks for the address, confirms the caller ID, reads everything back — then that the transcript, the email's six labels, `leads.preferred_datetime`, `leads.metadata.service_address` and the dashboard lead all agree.

## 2026-08-03 (Voice leads now keep the real caller ID)

### Fixed — voice lead phone resolution only; no booking logic, availability, capacity, chat, widget, onboarding, Knowledge Base, pricing, schema or API changes
A number the caller **spoke** during a call could replace the network caller ID on the lead and in the owner's summary email, so a mis-transcribed or simply different number produced a lead nobody could ring back.

- **The precedence was backwards.** `toExtractedLead` in `src/lib/voice/calls.ts` resolved the lead's phone as `details.phone ?? callerPhone` — the transcribed number won and the caller ID was only a backstop. It is now `callerPhone ?? details.phone`. Caller ID is the one contact detail a call supplies that no transcription step can mangle; a spoken number is still used when there is no caller ID, which is exactly when Remy is told to ask for one.
- **A spoken number is kept, not discarded.** When the caller genuinely gives a different line ("try the office instead"), it is saved as `alternate_phone` in the existing `leads.metadata` JSONB alongside `caller_id`, read-merged so it cannot clobber the needs-review notification flag. **No schema change.** Comparison is digit-based on the last 9 significant digits, so a caller reading their own number back in national form (`086 123 4567` vs `+353861234567`) is recognised as the same line and not filed as an alternate.
- **Remy no longer asks for a number it already has.** Prompt rule 5 is now rendered from the live caller ID (`buildPhoneNumberRule`, `src/lib/voice/assistant.ts`), which `incoming.ts` passes through from the assistant-request. With caller ID: the number is stated in the prompt and Remy is told never to ask for one and never to read it back — explicitly overriding rules 4, 10 and 15, which were written before caller ID was wired through and all say "collect their best contact number". Withheld: Remy is told to ask. The structured-extraction `phone` field and the fallback transcript extractor now both describe that field as an *additional* number only.
- **Withheld numbers are recognised as withheld.** Carriers send a placeholder rather than an empty field, so `anonymous`, `unknown`, `restricted`, `private`, `blocked` and the keypad spellings (`+266696687` = ANONYMOUS, `+2568378` = BLOCKED) used to be storable as a lead's phone number. New `src/lib/voice/callerId.ts` normalises these to null in the Vapi adapter — the anti-corruption layer, so nothing downstream ever sees them. The raw payload is still stored verbatim in `voice_events`.
- **Displayed where the owner reads it.** The summary email's "Number" row is now labelled **"Caller ID"** (and reads "Withheld" when there is none), with an "Alternate number" row when one exists. The dashboard lead drawer labels the phone row "Caller ID" for calls that have one and shows the alternate beneath it; `leads/page.tsx` selects `metadata` to do so.

### Verified
- `npm test` **50 passing** (was 45 — 9 new: caller-ID normalisation including every blocked placeholder, national-vs-E.164 matching, the adapter carrying/nulling caller ID, and the two prompt variants; existing 41 untouched).
- `tsc --noEmit` and `next build` clean. `eslint` reports only the 7 pre-existing errors in `ConversationView.tsx`, `CalendarView.tsx`, `ImportClient.tsx`, `api/chat/route.ts`, `global-error.tsx`, `not-found.tsx` and `onboarding/page.tsx` — none in any file touched here.
- **Not tested with a real phone call by the assistant** (no way to place one, and firing a synthetic webhook would write test rows and send a live email). The end-to-end check — ring the number from a `+353` mobile, give a different number aloud, and confirm the email's Caller ID row and the dashboard lead both show the number actually called from — is still outstanding.

## 2026-07-30 (Homepage demo CTA duration copy)

- Homepage demo CTA and its accessibility labels updated from "2-Minute Demo" to "90-Second Walkthrough", matching the walkthrough's actual 90-second runtime. Copy only — no behaviour, styling or layout change.

## 2026-07-30 (Homepage walkthrough entry experience — narration is now discoverable)

### Changed — walkthrough entry and sound control only; no narration, captions, music, scene timing, visuals, homepage layout, booking, onboarding, chat, Knowledge Base, Leads, pricing, schema or API changes
The narration existed but almost nobody would ever have heard it: the sound control lived inside the demo modal, and the only prompt to open that modal was a hover overlay — which never fires on touch.
- **The hero preview is the play button, and now says so.** The preview was already a single full-area `<button>`, so no layout or structural change was needed. Its overlay is now always visible and centred rather than hover-only: "▶ Watch 90-second walkthrough", with "🔊 Click to hear narration" beneath. Colours reuse the pill styling already present (`bg-white/95` / `text-slate-900`); the only new tone is a mild `bg-black/30` scrim so the text stays legible over the moving walkthrough. The overlay is hidden while the modal is open.
- **Clicking the preview starts narration immediately, from the top.** `HeroDemo` passes `autoStart={isModal}`, which seeds the audio hook's initial `enabled` state. Because the modal can only be reached by clicking, that click *is* the user gesture browsers require — **nothing attempts to autoplay sound on page load**, and the hero preview itself always passes `autoStart={false}` and stays silent. Closing the modal unmounts it, so reopening is a fresh mount: clock back to 0, narration back to the first sentence.
- **The sound control reads as a control.** It previously showed the word "Sound" on desktop and **no label at all** on mobile. It now always carries a label — "Turn sound on" when muted, "Sound on" when live — alongside the existing speaker icon. For the first 9 seconds of each loop, and only for a visitor who has never used it, it renders as a filled blue pill with the line "Click to hear the 90-second walkthrough", then settles into the quiet dark pill. It never moves between states and never disappears, so sound can always be turned back off.
- **`aria-label` on the preview** was saying "Watch the Remy 2-minute product demo", which now contradicts its own visible text; the preview has its own `PREVIEW_LABEL`. The left-column "Watch 2-Minute Demo" button keeps the old wording — pre-existing copy, untouched, and still worth rewording separately since the walkthrough is 90 seconds.

### Verified
- Narration, captions, music, ducking, scene timings and the 90.000s runtime are unchanged — `src/app/walkthroughNarration.ts` and the mp3 do not appear in the diff at all.
- Served homepage markup: overlay headline and subtext present, preview `aria-label` correct, **max button nesting depth 1** with tags balanced, and no sound control leaking into the preview (which would be an illegal nested button).
- `tsc --noEmit`, `next build` and `eslint` clean; `npm test` **36 passing** (untouched).
- **Not browser-tested by the assistant** (no browser tooling this session): narration actually starting on click, mute/unmute, caption sync while narrating, and desktop vs mobile rendering are logic-verified only. Safari carries the real risk — the modal mounts via a React state update, so the `AudioContext` is created milliseconds after the click rather than inside the handler's call stack. Chrome and Edge honour sticky activation; if Safari refuses, it degrades safely to muted playback with captions and the "Turn sound on" control in place.

## 2026-07-30 (Voice-over, captions and ambient music on the homepage walkthrough)

### Added — walkthrough presentation only; no booking logic, business hours, schema, pricing, chat, onboarding, Knowledge Base, Leads or CTA changes
The walkthrough played silent, so a visitor with the sound on learned nothing extra and a visitor skim-reading got no narrative thread at all.
- **New `public/audio/remy-walkthrough-narration.mp3`** — one continuous 90-second track (mono, 24 kHz, 56 kbps, 616 KB) carrying eleven spoken sentences with silence between them. Rendered per sentence with OpenAI `gpt-4o-mini-tts` (voice `fable`, instructed for calm, confident, professional British English at a measured pace), silence-trimmed, then mixed to fixed offsets with ffmpeg.
- **New `src/app/walkthroughNarration.ts`** — the timing table, and the single source of truth for caption display, audio position and music ducking. `startMs`/`endMs` are the *measured* speech boundaries of each sentence in the mixed track (ffmpeg `silencedetect` at −45 dB), not estimates, so captions cannot claim a word that isn't there.
- **New `src/app/useWalkthroughAudio.ts`** — narration playback plus a synthesised ambient bed. The narration track is exactly `TOTAL_MS` long and is *slaved* to the walkthrough's existing clock, which stays the master; the hook only ever seeks the audio to match, resyncing past 250 ms of drift. There is no second clock, which is why captions, visuals and voice cannot drift apart. Music is a five-note major-9 pad built in the Web Audio API rather than a loaded file — no asset, no stock-music licensing, seamless looping, and ducking becomes exact gain automation. Bed sits at 0.17, ducks to 0.051 under narration (fast down at 0.12 s, gentle back up at 0.4 s, as a broadcast ducker behaves), fades in over 2.5 s and out over the final 3 s.
- **Captions render for everyone, sound or not.** They are drawn as subtitles over the stage, from the same `elapsed` value as every frame; the existing chapter caption bar is untouched and still describes the *scene* rather than the sentence.
- **`src/app/RemyWalkthrough.tsx`** — the closing scene runs 9 s rather than 6 s so the call to action lands on the call-to-action visual instead of overrunning the loop. That is the only scene duration the voice-over changed, and the only line removed from the file; everything else is additive. Total runtime is now exactly 90.000 s.
- **Sound is offered only in the demo modal.** Browsers will not autoplay audio, so a control is required — but the hero preview is itself a `<button>`, and a button cannot legally contain another one. `RemyWalkthrough` takes a `sound` prop (default `false`) and `HeroDemo` passes `sound={isModal}`. The preview plays silent with captions; the modal gets the control. Enabling sound in one mounted instance mutes the other.

### Verified
- Narration placement measured in the mixed track rather than assumed: the scripted one-second pause before "Start your free 14-day trial today" measures 1.018 s, and the longest remaining silence is 4.38 s.
- Button nesting depth across the served homepage is 1 — no nested buttons anywhere — with the walkthrough wrapper correctly inside the preview button and tags balanced 6/6.
- `tsc --noEmit`, `next build` and `eslint` clean; `npm test` **36 passing** (untouched — no booking, availability or parsing code was modified).
- Not auditioned by the assistant: timing, levels, gaps and markup were verified numerically and structurally, but the recording's tone and the modal's sound control were confirmed by the maintainer in a browser, not by automated check.

## 2026-07-30 (Homepage demo replaced with a full product walkthrough)

### Changed — homepage demo presentation only; no booking logic, schema, pricing, homepage copy, chat, onboarding, Knowledge Base or Leads changes
The hero demo was a single looping chat conversation, which showed what Remy *says* but never what the product *is* — a prospect couldn't see setup, the Knowledge Base, where captured leads land, or that the business gets notified.
- **New `src/app/RemyWalkthrough.tsx`** — a self-contained, asset-free ~87-second walkthrough of the real journey in ten scenes: the two assistants distinguished, onboarding step 1 (business details) and step 2 (opening hours), Settings → Hours (appointment length + capacity), Knowledge Base records being added, a customer question answered from that Knowledge Base, the booking taken against the configured hours, the captured lead in the Leads table, the owner's booking notification email, and the closing message plus call to action.
- **Every screen mirrors UI that exists in this repo today** — the onboarding wizard's step dots and fields, Settings → Hours' "Appointment Duration (minutes)" and "Max Concurrent Bookings" cards, the Knowledge Base category badges, the Leads table's real columns (desktop table *and* the real mobile card layout) and the owner email from `src/lib/email.ts`. Nothing depicts a page, field or behaviour the product does not have. Where the product differs from an obvious demo script it follows the product: appointment length is shown in Settings → Hours, not the onboarding wizard (the wizard itself defers it), and business contact details appear as a Knowledge Base record because no such field exists in onboarding or Settings.
- **The HQ website assistant and a tenant's own Remy are never conflated** — a persistent chip names the world for every scene (`niteowlhq.com — our website assistant` / `Your Niteowl AI dashboard` / `<site> — your customer, your Remy`), and the opening scene contrasts the two directly: ours answers questions about Remy and books demos, theirs answers their customers from their Knowledge Base and books appointments.
- **Desktop and mobile** — the walkthrough is laid out on a fixed 16:9 stage that is CSS-scaled to its container, so composition is identical at every width; below 660px a smaller stage shows fewer, larger elements, the same way the product's own responsive UI drops from a table to cards. One clock drives scenes, captions and the chapter bar, so they cannot drift apart.
- **`src/app/HeroDemo.tsx`** — swapped the fallback component (one import, one JSX line) and refreshed the stale comments plus the modal caption. The video precedence is unchanged: `NEXT_PUBLIC_REMY_DEMO_VIDEO_URL` → `/videos/remy-demo.mp4` → the walkthrough. No recording is committed, so the walkthrough is what plays today; dropping an mp4 in later takes over with no code change. `src/app/RemyDemoAnimation.tsx` is now unreferenced but left in place.

### Verified
- `tsc --noEmit`, `next build` and `eslint` clean on the changed files; `npm test` **36 passing** (untouched — no booking, availability or parsing code was modified).
- Homepage served 200 in dev with the walkthrough present in the SSR markup. Dates in the Leads row and the email are computed client-side (so they never go stale) behind a `useSyncExternalStore` client snapshot, keeping SSR and hydration identical; until they resolve, those cells show the same `—` the real Leads table uses for a missing value.
- Degrades deliberately: an absent or unplayable video leaves the walkthrough in place rather than a black box, `prefers-reduced-motion` gets a static chapter summary with no timers, and the animation pauses while scrolled out of view.
- Not verified in a browser this session (no browser tooling available) — responsive layouts were sized against the stage by hand rather than eyeballed.

## 2026-07-30 (Chat assistant could not read the configured business hours)

### Fixed — chat prompt and one additive helper only; no schema, design, pricing, homepage or video changes
Reported: Monday saved as 09:00–19:30, but Chat Preview still answered "outside business hours" for 18:50, and "what time do you close on Monday?" got "I don't have those hours".
- **Root cause — the chat routes never read `business_hours` at all.** The system prompt was built purely from `business_knowledge` (the Knowledge Base), so hours set in Settings were invisible to Remy. It could only discuss hours if someone had typed them into a KB entry — and where such an entry existed it was frequently out of date, so Remy quoted hours the booking engine does not enforce (a real dev org has `business_hours` at 09:00–17:00 while its KB says "Mon-Fri 8am-6pm" published, "7am-7pm" draft and an FAQ saying "8am to 6pm"). Confirmed directly: given a KB entry saying "9am to 5pm" against Settings of 19:30, Remy answered "We close at 5pm on Monday." With Chat Preview on "Published only", a *draft* hours entry is filtered out too, which is the "I don't have those hours" case. The `ends_after_close` logic from the earlier entry was working — the Availability Note produces the correct explanation when it fires; Remy's *knowledge* of hours simply came from a different source and overrode it. Ruled out: caching (none in `src`; org and knowledge are fetched per request) and any draft/published state on the hours themselves (`business_hours` has none).
- **Current configured hours are now supplied to the chat assistant** — new exported `getBusinessHoursSummary` in `src/lib/availability.ts`, reusing the same `getOrgSettings`/`getBusinessHoursForOrg` queries the booking validator uses, so what Remy says and what the engine enforces cannot diverge. Read live per request, so a hours edit takes effect on the next message. Days with no row are stated as closed, matching what `isWithinBusinessHours` enforces (an omitted day invited the model to invent one); an org with no rows at all yields nothing, so the deliberate no-hours-configured fail-open is not contradicted.
- **Remy can now answer opening-hours questions from Settings** — both `src/app/api/chat/route.ts` and `src/app/api/widget/chat/route.ts` gained an authoritative "Opening Hours" prompt section (identical wording, per the shared-behaviour rule; appended as a trailing optional parameter so existing call signatures are unaffected). It states the configured hours and appointment length, instructs Remy to answer opening/closing questions from them and never to claim it lacks them, and marks any conflicting hours text in the Knowledge Base as out of date.
- **Outside-hours and finishes-after-closing stay distinct** — the hours block supplies data only and explicitly forbids the model from deciding availability or doing arithmetic with the appointment length; the deterministic Availability Note remains the sole source of a refusal and its reason. Two earlier attempts at this wording were caught and discarded in testing: the first had Remy *confirm* an overrunning booking, and the second — by asking the model to work out whether the appointment fits, repeating the original bug's mistake — refused a valid Monday 16:00 and mislabelled a genuinely out-of-hours Tuesday 18:45 as an overrun.

### Verified
- 8 new regression tests for `getBusinessHoursSummary` (**36 passing**, `npm test`): the configured close time is exposed, the same `business_hours` rows the validator reads are queried, Monday-first ordering, a 19:30 edit appears immediately, lunch breaks, emergency mode, a missing day reported as closed *and* agreeing with `isWithinBusinessHours`, and no-rows reported as unconfigured rather than closed.
- Prompt behaviour checked end-to-end against a deliberately conflicting Knowledge Base (KB "9am to 5pm" vs Settings Monday 19:30): closing-time question answers 7:30 PM not 5pm; full opening-hours question lists the configured week; Monday 16:00 accepted with no false overrun claim; Monday 18:50 explained as running past closing with an alternative offered; Tuesday 18:45 correctly outside hours; Sunday correctly closed.
- `tsc --noEmit` and `next build` clean; `eslint` at its existing 10-problem baseline. No SQL migration or Supabase change required.
- Still outstanding for the owner, not a code issue: the stale hours entries in the Knowledge Base are now overridden in the prompt but remain in the data; deleting them removes the contradiction at source.

## 2026-07-30 (Booking weekday parsing + closing-time validation — summary)

Concise summary of the booking-hours work; the detailed root-cause write-up is in the entry immediately below.
- **Named weekdays resolved to the wrong day.** `parseDatetimeToIso` let the model decide which calendar date a weekday name meant, and it resolved "Monday" to Saturday 1 August. Business hours were then validated against the wrong day, so Monday 18:45 was refused as "outside business hours" against a 09:00–19:00 Monday. Weekday→date is now exact arithmetic in code (`snapToNamedWeekday`), with timezone-correct wall-clock→UTC conversion so 18:45 stays 18:45 in the business's timezone.
- **Appointments could be booked past closing time.** `isWithinBusinessHours` only checked the start time, so a 60-minute appointment at 18:45 against a 19:00 close was silently accepted. It now rejects `start + duration > close` with a distinct `ends_after_close` reason, `findNextAvailableSlot` only offers slots that fit before closing, and both chat routes explain that the *appointment* would finish after closing rather than falsely calling the requested time outside business hours.
- **28 regression tests added** for booking-date and availability logic (`tests/`), run with `npm test`. Node's built-in test runner and native TypeScript support — no new dependencies. The HTTP layer is stubbed rather than injecting fakes into working booking code, so the real `availability.ts` and `parseDatetime.ts` run unmodified with no Supabase project contacted, no dev record mutated and no OpenAI spend. Verified to genuinely catch the bugs: 6 of the 28 fail against the pre-fix code, and the other 22 guard behaviour that already worked (Sunday closed, per-day hours, emergency mode, no-hours-configured fail-open). `tsc --noEmit`, `next build` and `eslint` unaffected.

## 2026-07-30 (Business hours — Monday 18:45 wrongly rejected as "outside business hours")

### Fixed — two distinct defects; no schema, design, pricing, widget-appearance or unrelated changes
Reported symptom: Monday configured 09:00–19:00 in `Settings → Business Hours`, but asking Remy to book Monday 18:45 was refused as "outside business hours" with 09:45 offered instead.
- **Root cause — the wrong *day* was being validated, not the wrong hours.** `parseDatetimeToIso` (`src/lib/parseDatetime.ts`) handed the whole conversion to `gpt-4o-mini`, giving it only `Current date and time (UTC): …` and returning the model's output verbatim with no check that the resolved date lands on the weekday the customer actually named. The model resolved "Monday" to **Saturday 1 August** (three identical trials at temperature 0; "Monday 4pm" → Sat 01 Aug, "Tuesday 6:45pm" → Sun 02 Aug). Remy therefore checked 18:45 against Saturday's row and answered honestly about Saturday; Monday's 19:00 close was never read. `findNextAvailableSlot` then stepped forward in 60-minute increments from Sat 18:45, skipped Sunday, and landed on Monday 09:45 — the exact reported message.
- **Ruled out, with evidence** — the hours saved correctly, and appointment duration was *not* the cause. Replaying the Settings page's exact upsert (`on_conflict=org_id,day_of_week`) returned and persisted `close_time: "19:00:00"`; the unique constraint exists, so that upsert cannot silently no-op. Running the pre-fix engine on a *genuinely correct* Monday 18:45 ISO (19:00 close, 60-min duration) returned `available=true` — the original `isWithinBusinessHours` contained no duration check at all (`appointmentDurationMinutes` was used only as the step size in `findNextAvailableSlot`). Also ruled out: stale caching (`unstable_cache`/`revalidate`/`force-cache` appear nowhere in `src`; hours are read fresh per request) and draft-vs-published (the "Previewing: Published only" badge is the Knowledge Base's `includeDrafts` toggle — business hours have no draft concept). No hard-coded 17:00 exists in the availability path; the only one is a new-org *form placeholder* (`HoursForm.tsx`), deliberately left in place because removing it would blank the inputs and make `validateDay` block Save for a fresh org.
- **`src/lib/parseDatetime.ts`** — weekday→date is exact arithmetic, so it is no longer trusted to the model: new `snapToNamedWeekday` forces the parsed result onto the next occurrence of the named weekday (today included when the time hasn't passed), preserving the wall-clock time the model resolved. New `getZonedParts` / `getZoneOffsetMinutes` / `zonedWallClockToUtc` helpers do timezone-correct wall-clock→UTC conversion (DST-boundary safe, honours the passed timezone) so 18:45 stays 18:45 in the business's timezone under BST or GMT. The prompt now also states the current *local* date and weekday and the weekday/timezone rules, and the stale 2024 examples were corrected — but note the prompt change alone was **not** sufficient (the model still returned 1 Aug); the deterministic correction is what actually fixes it. Logs `[parseDatetimeToIso] corrected weekday` whenever it engages.
- **Second, opposite defect fixed — appointments could be booked past closing time.** Because no end-time check existed, a 60-minute appointment at 18:45 against a 19:00 close would have been silently accepted, running 45 minutes past close. `src/lib/availability.ts` now rejects `start + duration > close` with a new `ends_after_close` reason (kept deliberately distinct from `outside_hours`, and checked *after* the open/close and lunch checks so existing reasons still take precedence), carrying `appointmentDurationMinutes` and `minutesUntilClose` for the logs. `findNextAvailableSlot` now also requires a candidate to fit before closing, so Remy can't offer a slot it would then have to refuse.
- **Honest messaging for the length case** — `src/lib/leadCapture.ts` maps the new reason through instead of flattening it to `"hours"`, and both `src/app/api/chat/route.ts` and `src/app/api/widget/chat/route.ts` gained a dedicated Availability Note branch instructing Remy to explain that the *appointment* would finish after closing and explicitly **not** to claim the requested time is outside business hours. Dashboard preview and public widget share the wording, per the "same AI behaviour" rule.

### Verified
- Compiled the real `availability.ts` and `parseDatetime.ts` and ran them against the live dev DB (`kioljdihgbcboxlnwghv`) on an org configured Mon 09:00–19:00, Tue 09:00–17:00, Sun closed — **12 passed, 0 failed**: Monday 16:00 accepted; Monday 18:45 accepted at 15-min duration (ends exactly at 19:00) and rejected as `ends_after_close` at 30 and 60 min; Monday 19:00 rejected `outside_hours`; Monday 08:30 rejected `outside_hours`; Tuesday 18:45 rejected `outside_hours`; Sunday rejected `closed_day`; and `"Monday at 6:45pm"` → **Mon 03 Aug 18:45** (was Sat 01 Aug), with 18:45 preserved as 18:45 London under BST.
- **Reproduced the original bug against the pre-fix code at `HEAD`** to confirm causation rather than correlation: `"Monday at 6:45pm"` → `Sat 01 Aug 18:45` → `available=false` → suggested `Mon 03 Aug 09:45`, matching the report exactly.
- `tsc --noEmit` clean; `next build` clean; `eslint` clean on all changed files apart from one pre-existing, unrelated unused-variable warning in `chat/route.ts`.
- Test harness lives outside the repo (this project has no test runner in `package.json`), so these results are verified but not yet repeatable via an npm script — worth adding a runner if this area is touched again. The dev record used for testing was restored to how it was found (Monday 09:00–17:00, duration 30).
- No SQL migration and no Supabase change required — no schema, column, RLS or data change on either project.

## 2026-07-29 (Marketing homepage — hero demo & conversion refinements)

### Changed — marketing homepage only; no product/app/auth/DB/booking/widget changes
Refined the public marketing homepage (`src/app/page.tsx`) and added a new hero demo component (`src/app/HeroDemo.tsx`). Copy-and-layout only; the Remy chat widget, authentication, dashboard, booking engine, and all APIs are untouched. Homepage `/` remains statically prerendered (no added initial-load cost, no layout shift). Tagged `v0.9-marketing-ready`.
- **Redesigned hero** (`HeroDemo.tsx`, new client component, still server-rendered for SEO): two-column layout — H1 "Never Miss Another Customer Enquiry", supporting copy (answers questions, captures enquiries, books appointments), primary CTA "Start Your Free 14-Day Trial" (→ `/signup`, unchanged destination) plus a "Watch 2-Minute Demo" button. The old missed-call phone mock-up was replaced by a 16:9 branded demo video preview built as an image-free CSS poster (no extra network request, no CLS). Video sits beside the copy on desktop, below it on mobile.
- **Accessible demo modal**: opens from the button or the poster; `role="dialog"`, `aria-modal`, focus trap, Escape-to-close, backdrop click, body scroll-lock, video torn down on close, no autoplay audio.
- **Publicly viewable demo (no sign-in)**: the video and booking destinations are driven by public, build-time env vars — `NEXT_PUBLIC_REMY_DEMO_VIDEO_URL` (a direct `.mp4`/`.webm` played in a native `<video>` for any signed-out visitor, no account required) and `NEXT_PUBLIC_REMY_BOOKING_URL` (opened in a new tab via "Book a Live Demo" with `target="_blank" rel="noopener noreferrer"`). While the video URL is unset the modal shows an honest "See Remy in Action" placeholder; while the booking URL is unset the button is clearly disabled as "Live Demo Booking Coming Soon" — never a dead link, a fake destination, or a sign-in redirect. Watching the demo never requires starting a trial.
- **Homepage cleanup**: removed the two now-duplicated legacy sections (old "How it works" missed-call 3-step, and "Who it's for" industry grid); replaced by a new "Perfect For" industry grid and a 5-step "How Remy Works". The one genuinely different element (the ROI/value line) was merged, reworded, into "Perfect For"; the `#how-it-works` anchor was preserved on the new process section.
- **Truthful messaging alignment**: re-pointed remaining copy from missed-call/SMS framing to website enquiries → lead capture → bookings (pricing subtitle + feature list, CTA-strip headline, social-proof stat). Removed the green "Live demo" badge and the absolute "100%" stat; replaced "Trusted by local businesses" (implied customers we don't yet have) with "Built for local businesses". No fake testimonials or customer counts.
- **Conversion refinements**: standardised the primary CTA to "Start Your Free 14-Day Trial" across hero, mid-page, pricing and CTA strip (nav stays short "Start free trial"); added a centred CTA after "How Remy Works" with "No credit card required • Cancel anytime".
- **Accessibility**: single H1, clean H2/H3 hierarchy, decorative emoji `aria-hidden`, labelled buttons/dialog, keyboard-navigable modal.
- **Verified** (2026-07-29): `eslint` (no new issues — the same 10 pre-existing, unrelated warnings/errors), `tsc --noEmit` clean, `next build` clean with `/` still statically prerendered. Live dev render confirmed all copy, both new sections, a single H1, and the chat widget launcher intact. Browser click-through (modal + breakpoints) left to the owner — browser automation was unavailable this session.

## 2026-07-20 (Website widget — verified on a real external site)

### Tested, end-to-end, against real production
- Signed up a brand-new production test business ("Claude Widget Test Co", real signup + real email confirmation via a Gmail plus-alias, no existing customer touched) to get a genuine `widget_key` without risking any real org's data.
- Published a minimal static page to a real, separate public domain (GitHub Pages, `niteowl-bot.github.io/niteowl-widget-test`) with the exact embed snippet a real business owner would copy from `Settings → Website Widget`.
- Confirmed `widget.js` serves correctly from `niteowlhq.com`, the published page satisfies both checks `/api/widget/verify-install` looks for (script tag present, `widget_key` present), and a real cross-origin conversation against `/api/widget/chat` succeeded with the correct `Access-Control-Allow-Origin` header — Remy correctly said it didn't have an answer and offered to loop in the team, rather than inventing one, for this intentionally knowledge-empty test org.
- Cleaned up afterward: production test org + auth user deleted via SQL; the temporary GitHub repo is pending manual deletion by the owner (API token used lacks the `delete_repo` scope).

## 2026-07-20 (Production deploy failure — missing RESEND_API_KEY)

### Fixed
- **Bug found and fixed — missing `RESEND_API_KEY` in Vercel Production failed the entire build, not just email**: the AI Import fixes below failed to deploy with `Error: Missing API key. Pass it to the constructor 'new Resend("re_123")'` during "Collecting page data" for `/api/sales/chat`. Root cause: `src/lib/email.ts` does `new Resend(process.env.RESEND_API_KEY)` at module scope (not lazily inside a function), and Next.js's build-time page-data collection evaluates that module — so a missing key kills the whole production build. Confirmed via a local `next build` succeeding cleanly (`.env.local` has the key), isolating the problem to Vercel's Production environment variable rather than the code. Owner confirmed the var was missing from Vercel, re-added it from Resend's dashboard, and redeployed. No code changes were needed for this fix — deliberately left `email.ts`'s eager instantiation as-is rather than also refactoring a working file in the same pass; worth revisiting (lazy client construction) if this class of failure recurs.
- **Verified end-to-end against real production**: ran a real 6-turn sales-chat demo-lead conversation directly against `niteowlhq.com` (no browser needed — the API contract is plain HTTP with a streamed plain-text reply) covering all 5 required fields plus explicit confirmation. No stream errors at any turn; the final reply used the completion message that the code only sends once `sendSalesLeadNotification` actually succeeds. Owner confirmed the real notification email arrived at `admin@niteowlhq.com`. The test lead row was verified and deleted from production afterward.

## 2026-07-20 (AI Import — real multi-page PDF test: 2 bugs found and fixed)

### Tested, end-to-end, against real dev data (`Plumbing Co 3`, `kioljdihgbcboxlnwghv`)
A genuine 4-page PDF (cover page with an embedded logo image, a bordered services/pricing table, a policies page, an FAQ page) was authenticated into and clicked through via a real browser automation session — upload → vision extraction → duplicate resolution (Merge, Replace, and Keep-both all exercised, not just Merge as before) → commit → History/Restore — the exact gaps CHECKLIST.md had flagged as untested.
- **Pages/text**: all 4 pages processed (`knowledge_import_files.page_count = 4`, `status = extracted`, no error) — no truncation, well under `MAX_PDF_PAGES`.
- **Table extraction**: the 6-row pricing table read with full structural accuracy, including correctly converting "Approx. 4 hours" → `duration_minutes: 240` and inferring `starting_from: true` from "From £80" — confirms the page-as-image-to-vision approach handles tables well with no dedicated table-parsing code.
- **Image handling**: the cover page's embedded logo produced no spurious entry and didn't interfere with extracting the real surrounding text — correctly treated as decorative, not content.
- **Duplicate resolution — all three actions verified correct** against real existing rows: **Replace** fully overwrote an existing entry's fields; **Merge** correctly kept existing non-empty values and only filled previously-empty fields (confirmed it does *not* combine/append new detail into an already-populated field — a real, working-as-designed limitation, not a bug); **Keep-both** left the original untouched and inserted a genuinely separate new draft row. Commit summary ("10 new entries saved as Draft, 4 existing entries updated") matched the expected math exactly.
- **FAQ generation**: confirmed the aggregate FAQ-generation step's low output count on this run was the batch-local dedup (`findLikelyDuplicateAmong`) correctly suppressing FAQs that restated page-4 items already staged from the same document — working as designed, not a bug. Separately noted: per-page vision extraction captured 3 of 5 visually-distinct FAQ blocks from the dedicated FAQ page (one merged into an already-captured service, one dropped) — inherent model-recall imprecision on dense list pages, not a deterministic code defect; not chased further.
- **History/Restore**: real edit → real revision snapshot appeared in the modal (verified against ~60 pre-existing genuine revisions on the row) → Restore reverted the content correctly.
- Non-issue confirmed: the `Unable to load font data at: standard_fonts/...` warning from `pdf-to-img` also occurs in this app's own rendering path (not just a scratch test), but is cosmetic only (fallback-font letter-spacing) — extraction accuracy was unaffected across every field checked above.

### Fixed
- **Bug found and fixed — orphaned import batches with no way back**: `ImportClient.tsx` always started at the "upload" step on mount, with no check for an existing unfinished batch. A reload or closed tab while a multi-page PDF was still processing (the UI's own copy warns "this can take a minute") stranded a real `ready_for_review`/`processing` batch permanently — the data was safe in the DB, but the owner had no way back to it except re-uploading and re-paying for extraction from scratch. `page.tsx` now looks up the org's latest non-terminal `knowledge_imports` row and passes it down; `ImportClient` resumes directly into the `processing` or `review` step via the existing `GET /api/knowledge/import/[id]` route (no new endpoint). Verified live: a batch left in `ready_for_review` by a prior session was picked up correctly by a cold page load with zero prior client state.
- **Bug found and fixed — same-titled entries with different content bypassed duplicate detection entirely**: `findLikelyDuplicate`'s word-overlap scorer treats `title + content` as one bag of words, so two entries sharing the exact same title (e.g. re-importing an updated "Opening hours" with new days/times) can score well under the 0.6 threshold once the differing content dilutes the match — confirmed live: a second "Opening hours" entry with different hours committed with no duplicate banner at all, leaving two same-titled, conflicting entries in the Knowledge Base. This is the same class of issue as the "similar names, conflicting answers" concern from the 2026-07-16 P8 refinement pass. Fixed by adding an exact (case/whitespace-insensitive) title-match short-circuit ahead of the word-overlap score in `scoreCandidates()`, applied to both `findLikelyDuplicate` and `findLikelyDuplicateAmong` — purely additive (only adds coverage, never removes an existing match), matching this scorer's own documented bias toward false positives over silently letting a duplicate through. Re-verified live: a fresh upload of the same document now correctly flags "Opening hours" as a duplicate of the existing entry.
- `tsc --noEmit` clean after both fixes.

## 2026-07-16 (AI Import for Knowledge Base — new feature)

### Added
- **"Import with AI"** on the Knowledge Base page: upload JPG/PNG/WEBP/PDF documents (menus, price lists, brochures, policy docs) and have AI extract structured Knowledge Base entries and suggested FAQs for review. Nothing is ever published automatically — every item goes through an Edit/Delete/Add/Approve/Reject review step (`/knowledge/import`, new `ImportClient.tsx` + `StagedItemForm.tsx`) before anything is saved.
- **Schema**: `business_knowledge` extended additively (`status` draft/published, `price`, `currency`, `duration_minutes`, `notes`, `quote_required`, `starting_from`, `source`, `import_id`, `updated_by`, `updated_at`) — every existing row backfills to `status='published'`, `source='manual'` automatically, zero behaviour change for existing data. Two new triggers populate `updated_at`/`updated_by` and an append-only `business_knowledge_revisions` table on every write, including through the pre-existing `KnowledgeClient.tsx` edit/delete handlers, with no changes needed to that file's logic. Four new tables (`knowledge_imports`, `knowledge_import_files`, `knowledge_staged_items`, `business_knowledge_revisions`) with RLS matching the existing `business_knowledge` owner-scoped policy. New private Storage bucket `knowledge-imports`, org-scoped by path. SQL in `docs/sql/2026-07-16_knowledge_import_tables.sql`, `..._extend_business_knowledge.sql`, `..._storage.sql` (each with a `_verify.sql`) — **not yet applied to dev or production; must be run manually via the Supabase SQL editor on both projects before this feature works**, per this repo's no-migrations-folder convention.
- **Extraction**: `src/lib/knowledgeImport/extraction.ts` calls `gpt-4o` (vision — the one deliberate model deviation from the `gpt-4o-mini` used for every other auxiliary task in this codebase) via the same raw-`fetch`/prompt-instructed-JSON house style as `voice/extraction.ts`, with per-item self-reported confidence and a "never invent" instruction. PDFs render to page images first via the new `pdf-to-img` dependency (`src/lib/knowledgeImport/pdfToImages.ts`) — WASM-based, no native binary, chosen specifically for Vercel serverless compatibility.
- **FAQ generation**: `src/lib/knowledgeImport/faqGeneration.ts` (`gpt-4o-mini`) generates suggested FAQs from extracted or existing knowledge, grounded only in what's given. "Regenerate FAQs" (new button per Knowledge Base row + `POST /api/knowledge/regenerate-faqs`) never overwrites existing FAQs — only adds new pending suggestions for review.
- **Duplicate detection**: `src/lib/knowledgeImport/duplicateDetection.ts` adapts the existing word-overlap approach from `isServiceConfirmedByKnowledge` (`leadCapture.ts`) to flag likely duplicates against existing entries (draft or published); the reviewer must explicitly choose Merge / Replace / Keep both before an item can be approved — nothing is silently overwritten.
- **Draft/Published gate**: committed AI-imported entries land as `status='draft'` and are invisible to the public widget and voice AI (unconditional filter) until explicitly published from the Knowledge Base list. The Dashboard Preview Chat gets an "Include drafts" toggle (off by default, clearly banner-labelled) so an owner can test unpublished content before making it live — the public widget can never reach this path.
- **Revision history**: "History" button per Knowledge Base row shows prior versions (date, "Modified by you" when resolvable) with one-click restore, powered entirely by the new trigger — no new write-path code needed in the existing CRUD handlers.
- **Cost/abuse controls**: `hasActiveAccess` billing gate + `checkRateLimit` at 5 import batches/hour/user, 5 files/batch, 10MB/file — vision calls are meaningfully more expensive than this codebase's usual `gpt-4o-mini` auxiliary calls.
- **Build fix**: `pdf-to-img`/`pdfjs-dist` failed to bundle under Next 16's default Turbopack build (`TypeError: The "path" argument must be of type string`); fixed by adding `serverExternalPackages: ["pdf-to-img", "pdfjs-dist"]` to `next.config.ts` (the documented fix for packages with Node-specific dynamic module resolution) rather than working around it.
- `tsc --noEmit`, `next build`, and `eslint` all pass. Two pre-existing lint findings (`outsideBusinessHours` unused-var warning in `api/chat/route.ts`, a `setState`-in-effect warning in `ConversationView.tsx`) were confirmed via diff to predate this change and were left untouched, per this repo's "never refactor working code" rule.
- **Server-side verification against the real dev database** (2026-07-16, after the three SQL files were applied to dev): ran the actual library functions directly against `Test Plumbing Co`'s real Knowledge Base data (not mocked) —
  - FAQ generation: produced correctly grounded, correctly priced FAQs matching the exact examples from the original spec ("How much is a boiler service?", "Do you charge a call-out fee?", etc.), no invented facts.
  - **Bug found and fixed**: `findLikelyDuplicate`'s match ratio was normalized by `Math.max(needleWords.length, haystackWords.length)`, which penalized matches against longer/richer existing entries — a near-duplicate ("Boiler Fixing Service" vs. the existing "Boiler Repair" entry) scored 0.47 and was missed entirely, the opposite of the intended "bias toward flagging, not silently missing, a duplicate" behaviour. Fixed by normalizing against the deduplicated candidate's own word count instead (now scores 0.75, correctly flagged); re-verified the two designed "must NOT match" cases (an unrelated service, and the existing generic-word false-positive guard) still correctly return no match.
  - Extraction: ran a real `gpt-4o` vision call against a synthetic price-list image (services, a "from £X" price, a quote-required item, a call-out fee, opening hours, payment methods) — correctly split into the right categories, correctly converted "2 hours" to `duration_minutes: 120`, correctly left `price` null (not invented) for the quote-required item.
  - **Second bug found and fixed**: a "from £120" price was extracted as `price: null` with the amount stuffed into `notes` instead of `price: 120, starting_from: true` — the prompt didn't say a "from" price should still populate `price`. Added an explicit instruction and re-verified the same test image now correctly returns `price: 120, starting_from: true`.
  - DB triggers: inserted/updated/deleted a real (test, cleaned-up-afterward) `business_knowledge` row directly — confirmed `updated_at` moves on update, the revision trigger correctly snapshots the row's state *before* each change (not after), and both the update and delete paths each produce their own revision row.
  - Storage: uploaded, downloaded, and removed a real test object in the `knowledge-imports` bucket — round-tripped correctly.
  - **Still not run**: the actual HTTP API routes end-to-end through a real authenticated browser session (upload → process → review → commit → publish), since this environment has no login credentials (same constraint noted for `/admin/sales-leads` on 2026-07-06) — everything above was verified by calling the underlying library/DB/storage layer directly with the service-role client, not through the routes' own auth-gated HTTP surface. See CHECKLIST.md.
- `tsc --noEmit` re-verified clean after both fixes.

## 2026-07-16 (AI Import — real browser walkthrough: 5 more bugs found and fixed)

### Changed, after a full authenticated browser pass against `Plumbing Co 3` on dev (upload → extract → review → duplicate resolution → commit → publish → chat preview)
- **Bug found and fixed — service-role key exposure**: a sloppy `sed` filter printed the dev Supabase service-role key in plaintext into this conversation. Rotated: dev migrated off legacy JWT-based API keys (Legacy HS256 signing secret revoked) onto the new Publishable/Secret key system; `.env.local` updated; old key confirmed dead via a live `401 Legacy API keys are disabled` response before rotating, and the new keys confirmed working via the same check after. Prod was never exposed and is untouched.
- **Bug found and fixed — serious**: the revision-history trigger (`record_business_knowledge_revision`, added in the previous entry) unconditionally `return old;`, which for a `BEFORE UPDATE` trigger silently discards every column change in that statement — the row gets rewritten with its PRE-change values. A second trigger (audit fields) running after it masked the symptom by stamping a fresh `updated_at` on the reverted row, so writes looked successful. This broke every edit through the **pre-existing** `KnowledgeClient.tsx` UI, not just the new Publish button — confirmed via a direct before/after test (requested `content=changed, status=published`, got back `content=original, status=draft`). Fixed: return `NEW` for UPDATE, `OLD` only for DELETE. Re-verified the same test now persists correctly AND still captures the correct pre-change snapshot in `business_knowledge_revisions`. `docs/sql/2026-07-16_knowledge_import_extend_business_knowledge.sql` corrected on disk; the live dev function was hotfixed via the SQL editor.
- **Bug found and fixed**: `KnowledgeClient.tsx`'s pre-existing `handleCreate`/`handleUpdate` only re-`select()`ed the original 7 `business_knowledge` columns, so saving an edit wiped the new `status`/`price`/etc. fields from that row's *local* state (never the database) — the Publish button and draft/published pill vanished for that row until a full page reload. Widened both `select()` calls to the full column list; `handleUpdate`'s `setRecords` now merges (`{...r, ...data}`) instead of replacing, so this class of gap can't recur if another field is added later without every caller remembering to re-select it.
- **Bug found and fixed**: the Publish/Unpublish button had no in-flight guard, so a second click before the first request's response landed would read a stale `record.status` and immediately toggle the value back — a real, successful write looked like "nothing happened." Same root cause on the Merge/Replace/Keep-both banner buttons. Both now disable themselves and show explicit "…"/"Saving…" feedback while a request is in flight.
- **Bug found and fixed**: `findLikelyDuplicate`'s word-matching had no stemming — "cleaning"/"cleaner" vs. "clean" and "hour" vs. "hours" didn't match as strings, silently missing an obvious duplicate ("Standard Cleaning Service" vs. existing "Standard Clean" scored 0.5, under threshold). Added lightweight suffix stripping (-ing/-ers/-er/-es/-s). Re-verified the previously-passing "must NOT match" cases still don't.
- **Bug found and fixed**: `PATCH /api/knowledge/import/items/[itemId]`'s "duplicate must be resolved before approving" check only looked at whether *that specific request's body* included `duplicate_action` — but Merge/Replace/Keep-both is saved via its own earlier, separate PATCH (clicking the banner button). Approving sends a follow-up PATCH containing only `{review_status: "approved"}`, so the check saw no `duplicate_action` in *that* request and blocked an already-resolved item. Now checks the item's existing database value as a fallback (`raw.duplicate_action ?? item.duplicate_action`).
- **Gap found and fixed (not a bug — a design hole)**: duplicate detection only ever checked a new item against the *already-committed* Knowledge Base, never against other items extracted in the *same* import batch. A single document naturally produces both a structured KB entry ("Call-out fee", `price: 10, currency: GBP`) and an AI-generated FAQ restating the same fact ("Do you charge a call-out fee? Yes, £10...") — reviewed side by side with no relationship between them. Editing one later (confirmed live: a reviewer changed the FAQ's £→€ without knowing the sibling entry existed) leaves the two silently disagreeing, and Remy answers from whichever one it happens to use. Added `findLikelyDuplicateAmong()` — checks each new item against everything staged earlier in the same batch and skips staging the redundant one entirely. Required generalizing the match scorer to check both containment directions (short entry fully covered by a longer paraphrase, and vice versa) and keep the better score — the one-directional version missed this exact FAQ/KB-entry pair (0.5 one way, 1.0 the other). Re-verified against the full existing regression suite plus a short-vs-long sanity case; all pass. Manually reconciled the two live entries this was found on (`Call-out fee` / `Do you charge a call-out fee?`) to both read €10.
- Every fix above re-verified with `tsc --noEmit` (clean throughout) and either a direct before/after database check or a real click-through in the browser — see conversation for specifics. This is now genuinely end-to-end tested on dev: upload, vision extraction, both duplicate-detection paths, all three resolution actions, commit, publish/unpublish, and draft isolation in both the "published only" and "include drafts" preview modes.

## 2026-07-16 (Needs-review escalation email — content only)

### Changed (`src/lib/email.ts`, `src/lib/leadCapture.ts`, `src/app/api/widget/chat/route.ts`, `src/app/api/chat/route.ts`)
- **Root cause**: the escalation email's "Their question" line always showed whichever message happened to trigger the notification. For the common pattern (customer asks something Remy can't answer → Remy asks for contact details → customer replies with just an email/phone), that trigger message was the contact-only reply, so the email displayed contact details where the real question should be. The email's transcript field (`conversationContext`) existed but every call site always passed `null`; the escalation reason (`assessment.reason`, already computed by the confidence check) was only ever logged to the console, never passed to the email.
- **Fix**: added `buildConversationTranscript()` to `src/lib/leadCapture.ts`, built from the client-supplied message history at both chat routes (windowed to the most recent 10 messages, not a character cut from the start) and passed through `capturePartialLead()`'s new optional `conversationTranscript` param. `sendNeedsReviewNotification` now renders a "Why Remy escalated" line and an actual "Conversation transcript" section. Name/email/phone were already shown as separate detail rows — unchanged.
- **Follow-up refinement (pilot feedback, same day)**: the first pass still let the trigger message's raw text appear in "Their question" even when that text was purely the extracted email/phone. Added `resolveEscalationQuestion()`, applied at every `sendNeedsReviewNotification` call site — it strips the extracted email/phone (exact match, plus a digits-only match for phone number formatting variants) and common contact-supplying filler words from the candidate text; if nothing substantive survives, the email now shows **"No explicit question captured."** instead of ever displaying an email address or phone number as the question.
- Verified live: reproduced three scenarios against the dev org and fetched each sent email via Resend's API — (1) a single-turn message that was purely contact details → "No explicit question captured."; (2) a single-turn message combining a real complaint with contact details → real complaint text shown, not blanked; (3) a two-turn conversation (real question, then a contact-only reply) → the original question shown, not the reply. All three showed the escalation reason, the full transcript, and contact fields kept separate. Test leads and conversations deleted afterward.
- No change to intent classification, the confidence-check logic, booking, voice AI, or any other functionality — this only changes what the escalation email displays. `tsc --noEmit` passes.

## 2026-07-16 (Owner notification recipient — separate from login email)

### Changed (`src/lib/leadCapture.ts`, `.env.local`, new `docs/sql/2026-07-16_organisations_notification_email.sql`)
- **Root cause**: all four owner-notification emails (booking confirmations, needs-review handoffs, self-service cancel/reschedule, voice call summaries) share one recipient resolver, `getOrgOwnerEmail()` in `src/lib/leadCapture.ts`. It resolved the recipient as the org owner's Supabase Auth **login** email — there was no separate notification-address field anywhere. For the pilot org that login email is the owner's personal address, so every business notification landed there instead of `admin@niteowlhq.com`.
- **Fix**: added a nullable `organisations.notification_email` column (`docs/sql/2026-07-16_organisations_notification_email.sql` — must be run manually in the Supabase SQL editor on both the dev and prod projects, per this repo's no-migrations-folder convention; DDL isn't reachable via the service-role REST API). `getOrgOwnerEmail()` now prefers `notification_email` and falls back to the existing auth-email behaviour when it's unset, so every other/future org keeps working exactly as before with no action needed. The SQL script sets it to `admin@niteowlhq.com` scoped to the owner's own org(s) only.
- **`ADMIN_EMAIL` (access-control gate for `/admin/sales-leads`) and Supabase Auth login emails are deliberately untouched** — this was a notification-routing fix only, not an access-control change. The owner's existing login keeps working exactly as-is.
- `SALES_NOTIFICATION_EMAIL` (recipient for marketing-site sales-chat lead notifications, unrelated to any tenant org) changed from the personal address to `admin@niteowlhq.com` in `.env.local` and in Vercel's Production env vars (owner updated via the dashboard and redeployed).
- No changes to booking logic, voice AI, chat, the widget, or any customer-facing email — verified every `sendChecked` call site in `src/lib/email.ts` is unchanged.
- `tsc --noEmit` passes.

## 2026-07-15 (Basic phone number validation — `src/app/api/leads/route.ts` only)

### Changed
- Follow-up to the Priority 9 finding: `/api/leads`'s existing `validatePayload` checked that `phone` was a string but never checked its format, so `"12x-abc"` (and anything else) was accepted. `validatePayload` already had a working `field`/`message` validation pattern (used by the `email` check right above it) — this extends the same pattern to `phone` rather than inventing a new mechanism.
- New `isValidPhoneNumber` helper: accepts digits, spaces, `+`, `(`, `)`, and `-`; rejects any other character (letters, symbols); requires the digit count to be between 7 and 15 (the E.164 maximum) so it never rejects a genuine international number, only something clearly too short or malformed. On failure, the API returns the same friendly-message shape every other field already uses: `"phone must be a valid phone number, e.g. +44 7700 900123 — only digits, spaces, +, (), and - are allowed."`
- Verified with 14 test cases covering UK/US/Irish/Australian international formats with spaces, `+`, parentheses, and hyphens (all correctly accepted) alongside the original `"12x-abc"` bug report, too-short numbers, letters, and an over-length number (all correctly rejected) — all 14 passed.
- **Only this one route changed.** AI-extracted phone numbers from chat, the widget, and voice are untouched — those come from natural-language extraction, not a structured form field, and validating/rejecting them is a different, more involved product decision that was deliberately not made here. GET and PATCH on `/api/leads`, and every other field's validation, are unchanged.
- `tsc --noEmit` and `next build` both pass.

## 2026-07-15 (Refinement Priority 9: edge-case testing — results, no code changes)

### Tested against the real dev environment (dev server + dev Supabase + `Test Plumbing Co` org), no code changed
- **Invalid phone numbers**: sent `"12x-abc"` as a contact number through the widget. Confirmed it is stored completely unvalidated — `leads.phone` accepted it verbatim, no format check anywhere in the app. Not fixed here (a validation/rejection policy is a product decision, not implied by "testing"), but flagged as a real, reproducible gap worth a deliberate follow-up.
- **Multiple questions/requests in one message**: sent a single message combining a pricing question, a "do you offer X" question, and a full booking request with name/email/time. Remy answered all three correctly in one coherent reply and completed the booking properly — no extraction or capture bug found.
- **Customer changing their mind**: sent "book boiler repair tomorrow at 2pm" then, in the same conversation, "actually make it 4pm instead" (deliberately with no contact info, so the lead could never reach `booked` and risk a real email — see below). Confirmed the SAME lead was updated (not duplicated) and `appointment_datetime` correctly moved from 2pm to 4pm. Existing reschedule-merge logic handled this correctly with no changes needed.
- **Long pauses, background noise, caller interruptions**: these are live-phone-call scenarios this environment cannot reproduce (no way to place a call or simulate audio/transcription conditions here). Silence/interruption *wording* was already addressed at the prompt level in Priority 7 (voice Rule 16); the actual real-time turn-taking behaviour depends on Vapi's own defaults, which the app does not currently override (`buildVapiAssistantResponse` in `src/lib/voice/vapi.ts` sets no `silenceTimeoutSeconds` or interruption-sensitivity parameters) — a real test call is the only way to verify this properly, and is recommended before considering this scenario closed.
- **Incident during testing, disclosed immediately**: one test message ("book someone for tomorrow at 3pm... my email is edgecaseb@example.com") completed a full, real booking against the dev org — which set the lead to `booked` and fired the real booking-confirmation email flow through this project's production Resend account, almost certainly reaching the dev org owner's real inbox. The test lead and conversation were deleted from the database immediately (verified 0 remaining), but an already-sent email cannot be recalled. All further tests were redesigned to never supply both contact info and a confirmable time together, specifically to make a real send impossible for the remainder of this session.
- No files changed for this priority — testing and reporting only.

## 2026-07-15 (Refinement Priority 8: Knowledge Base edge cases — similar names, conflicting/multiple answers)

### Changed (`src/lib/leadCapture.ts`, `src/lib/voice/assistant.ts`, `src/app/api/chat/route.ts`, `src/app/api/widget/chat/route.ts`)
- **Unknown services**: already covered end-to-end by Priority 1 (shared across voice, chat, widget).
- **Similar service names — real false-positive found and fixed**: `isServiceConfirmedByKnowledge` (the shared function from Priority 1) matched on ANY shared word, which meant a single generic word could wrongly confirm an unrelated request — e.g. "emergency roof repair" would have matched a plumbing KB entry titled "Emergency Plumbing Call-Out" purely because both mention "emergency," even though the business has nothing to do with roofing. Now filters common trade/booking words (emergency, repair, installation, check, appointment, etc.) before matching, and requires ALL meaningful words to match for short requests (1–2 words, the common case) or two-thirds for longer ones — genuine close variants like "boiler check" against "Boiler Repair" still confirm correctly; unrelated services sharing only a generic word now correctly fail. Verified with 7 test cases covering both directions (unrelated services correctly rejected, genuine variants correctly accepted) — all passed.
- **Multiple / conflicting matching answers**: added one new rule to all three prompts (voice Rule 17, chat Rule 12, widget Rule 10) — if more than one knowledge entry could answer the same question, use the most specific one rather than reciting several; if two entries genuinely conflict (e.g. different prices for what sounds like the same thing), say a team member will confirm the exact details rather than guessing.
- **Missing answers**: reviewed — already correctly handled by the existing "if a question falls outside the knowledge base, don't guess" rules on all three surfaces; no gap found, no change needed.
- No change to booking logic, database schema, or any file outside the four listed above. `tsc --noEmit` and `next build` both pass.

## 2026-07-15 (Refinement Priority 7: conversation prompt review — silence/interruptions, one repetitive-wording fix)

### Reviewed (voice, chat, and widget prompts) + Changed (`src/lib/voice/assistant.ts` only)
- **Silence and interruptions** (explicitly requested, only meaningful on a live phone call): added Rule 16 — if the caller goes quiet, check in naturally ("Sorry, are you still there?") instead of repeating the last question verbatim or sitting in silence; if interrupted mid-sentence, stop talking immediately and respond to what was actually said instead of finishing or repeating the original sentence.
- **Repetitive wording fix**: Rule 11's generic closing and Rule 15's unconfirmed-service closing could both fire for the same call (an unconfirmed-service request that's also urgent), risking two closing statements back to back. Rule 11 now explicitly defers to Rule 15's closing when it already applies.
- **Greeting — deliberately left untouched**: the current voice greeting (leading ellipsis for TTS clip-resistance, "your AI receptionist" wording) has already been iteratively refined across several prior commits based on real production test calls and explicit owner requests. Changing it again without new call evidence risked undoing already-verified fixes, so it was reviewed and left as-is.
- **Chat/widget — reviewed, no changes**: no repetitive-wording or unnatural phrasing issues found beyond what Priority 1 already resolved (the Rule 9 rewrite). Chat has no fixed "closing" script by design, since a chat session (unlike a phone call) has no single natural end point — forcing one would be a behaviour change, not a wording polish, so none was added.
- No change to business logic, booking behaviour, knowledge retrieval, or any other file. `tsc --noEmit` and `next build` both pass.

## 2026-07-15 (Refinement Priority 6: consistent, polished formatting for every customer-facing email)

### Changed (`src/lib/email.ts` only)
- Every email (booking confirmation ×2, needs-review notification, self-service cancel/reschedule notification, sales lead notification, call summary) rendered its own bare `<p><strong>` markup with no shared look. Added one `renderEmailLayout` wrapper (wordmark header, card body, footer with a privacy link) plus two small helpers (`detailsBlock`, `emailButton`) so every email now shares the same branded structure and a consistent details layout instead of five slightly different ad-hoc ones.
- Wording tightened for warmth and clarity without changing what any email says happened: booking confirmation opens with "Good news — your booking is confirmed"; the needs-review subject and body now explicitly say "Remy couldn't confidently answer" instead of the colder, unexplained "Customer enquiry requires review"; the call summary distinguishes "no lead was created from this call" instead of silently omitting the dashboard link with no explanation.
- **Fixed a real bug found during this pass**: `sendCallSummaryEmail` accepted a `businessName` parameter that every caller already provides, but the function never actually used it. It now appears in the email ("Remy answered a phone call for {business}"), so multi-business owners (a rare case today, more relevant later) can immediately tell which business the call belongs to.
- **Everything else is unchanged**: recipients, triggers, subject-line meaning, `escapeHtml` sanitisation, `sendChecked` error handling, and every function's signature and return value are exactly as before — this is markup and copy only.
- The project's configured Resend key is the production account, so this was **not** verified by sending a real email (that would reach real inboxes) — verified instead by `tsc --noEmit`, `next build`, and careful structural review of the generated markup. Worth a real send-and-look before considering this fully closed.

## 2026-07-15 (Refinement Priority 5: branded 404 and error pages)

### Added (`src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/global-error.tsx`)
- No custom 404 or error boundary existed anywhere in the app — any mistyped URL or uncaught render/server error fell through to Next.js's bare default screens.
- `not-found.tsx`: branded 404 ("This page took a wrong turn"), links to the dashboard and homepage. Verified live: a nonexistent route now returns HTTP 404 with this page's content instead of Next's default.
- `error.tsx`: branded error boundary with a "Try again" button (calls Next's `reset()`) and a link to the dashboard. Logs the error via `console.error`, which Sentry's existing `captureConsoleIntegration` (already configured in `src/instrumentation.ts`) turns into an event with no other wiring needed — this is what actually connects the friendly page to the monitoring that was already in place but had nothing surfacing errors to it from the UI layer.
- `global-error.tsx`: the last-resort handler for an error in the root layout itself — per Next's requirement it renders its own minimal `<html>/<body>` (inline styles only, no shared components) so it can't itself fail if something more foundational broke.
- No existing page, layout, or logic touched — purely additive. `tsc --noEmit` and `next build` both pass; the 404 page was confirmed rendering via a live request to a nonexistent route.

## 2026-07-15 (Refinement Priority 4: onboarding no longer creates duplicate organisations)

### Changed (`src/app/onboarding/page.tsx` only)
- Step 1 of onboarding inserted a new `organisations` row unconditionally, with no check for one already existing. Refreshing the page (or navigating back) after submitting step 1, then continuing again, silently created a second row for the same owner — every other query in the app resolves "the" org by most-recently-created, so the duplicate went invisible rather than erroring, quietly polluting the table.
- **Validated on mount**: the page now checks for an existing organisation for the signed-in owner before ever showing the step-1 form. If one exists, onboarding resumes at step 2 using that org — the create-new-org form is never re-shown, so the duplicate can't happen in the first place. A brief loading state covers this check so the form doesn't flash first.
- **Defensive re-check on submit**: `handleSubmitStep1` re-checks for an existing org immediately before inserting (belt-and-suspenders against the same race), and reuses it instead of inserting if one is found.
- **Clearer error message**: the generic "Something went wrong. Please try again." fallback is now a specific, actionable message for genuine failures.
- No change to steps 2–4, the database schema, or any other file. `tsc --noEmit` and `next build` both pass.

## 2026-07-15 (Refinement Priority 3: password reset flow for business owners)

### Added (`src/app/(auth)/forgot-password/`, `src/app/(auth)/reset-password/`, `src/app/auth/confirm-reset/route.ts`) + Changed (`src/app/(auth)/login/page.tsx`, one link)
- There was no self-service password recovery anywhere in the app — an owner who forgot their password had no path back into their own dashboard. Added the standard Supabase Auth recovery flow: **Forgot password?** link on login → `/forgot-password` (email form, calls `resetPasswordForEmail`) → emailed link → new `/auth/confirm-reset` route handler (mirrors the existing `/auth/callback` code-exchange exactly, but redirects to `/reset-password` instead of straight to `/dashboard`, since recovery must show a "choose a new password" form, not silently sign the owner in with their old, forgotten password still unchanged) → `/reset-password` (verifies a real recovery session exists, then calls `updateUser({ password })`) → redirects to the dashboard.
- Success/error handling throughout: the request-reset form always shows the same "check your email" message whether or not the address has an account (never reveals which emails exist); an expired or already-used reset link shows a clear message with a way to request a new one; the new-password form validates length and confirmation match before submitting and surfaces Supabase's own error message on failure.
- `/forgot-password` needed a `Suspense` boundary around its `useSearchParams()` usage to satisfy Next's static-prerender requirement — split into a thin server `page.tsx` + client `ForgotPasswordForm.tsx`, the same pattern already used by `booking/manage/page.tsx`.
- **Existing authentication is unchanged** — login (email/password and Google OAuth), signup, and `/auth/callback` were not modified beyond the one added link on the login page.
- **Action needed from the owner**: this project has a documented history of Supabase silently falling back to the Site URL when a `redirectTo` isn't in its allow-list (the 2026-07-04 production-deployment incident). The new `/auth/confirm-reset` redirect target must be added to Supabase Auth's allow-listed Redirect URLs (both projects) before a real reset email will land on the right page — verified by code review, build, and a local render check of all three new pages; not yet tested against a real Supabase-sent email, which requires that allow-list step first.
- `tsc --noEmit` and `next build` both pass.

## 2026-07-15 (Refinement Priority 2: dashboard is now responsive on mobile)

### Changed (`src/components/dashboard/DashboardNav.tsx`, `src/app/(dashboard)/layout.tsx`, `src/app/(dashboard)/settings/layout.tsx`, `src/app/(dashboard)/calendar/CalendarView.tsx`)
- **The core fix**: `DashboardNav` was a fixed 224px sidebar with zero responsive behaviour, wrapping every dashboard page (Dashboard, Chat Preview, Knowledge Base, Leads, Calendar, Settings). It's now a slide-in drawer below the `md` breakpoint — a mobile top bar (logo + hamburger) toggles a backdrop + off-canvas panel that closes automatically when a link is tapped — and an unchanged static sidebar at `md` and above. This mirrors the exact interaction pattern already proven in the Chat Preview's own sidebar (`ChatShell.tsx`), reused for consistency rather than invented fresh. `(dashboard)/layout.tsx` gained one class change (`flex-col md:flex-row` instead of a fixed row) so content stacks under the mobile top bar instead of being squeezed beside it.
- **Leads table**: already responsive from an earlier session (desktop table below `lg`, card list above it) — confirmed unaffected, no change needed.
- **Dashboard home cards**: already used `sm:grid-cols-2` (single column on mobile) — confirmed unaffected, no change needed.
- **Chat Preview**: already had its own working mobile drawer — confirmed unaffected, no change needed.
- **Settings tabs**: the 4-tab bar (`Business`, `Business Hours`, `Website Widget`, `Billing`) now scrolls horizontally instead of wrapping or squeezing at narrow widths (`overflow-x-auto` + `whitespace-nowrap` on the tab links) — same "wide content scrolls in its own container" pattern already used elsewhere, not a new mechanism. Settings/Business, Settings/Hours, and Settings/Widget pages were reviewed and are already single-column and mobile-safe; no changes needed there.
- **Calendar**: the month and week grids (7 columns) are now wrapped in a horizontally-scrollable container with a sensible minimum width, so a narrow phone screen scrolls the grid instead of crushing each day's column illegibly. The grid itself, its columns, and Day view are otherwise unchanged — no redesign into an agenda/list view.
- No changes to business logic, data fetching, the database, or any file outside the four listed above. `tsc --noEmit` and `next build` both pass.
- **Verification note**: dashboard pages require an authenticated session to view, which isn't available from this environment, so the drawer's interactive behaviour was verified by code review against the already-working `ChatShell` pattern it mirrors, plus a successful production build — not by a live click-through. Worth a manual phone check before considering this fully closed.

## 2026-07-15 (Refinement Priority 1: chat and widget now use the SAME unknown-service validation as Voice AI)

### Changed (`src/lib/leadCapture.ts`, `src/lib/voice/calls.ts`, `src/app/api/chat/route.ts`, `src/app/api/widget/chat/route.ts`)
- **Shared, not duplicated**: `isServiceConfirmedByKnowledge` (word-overlap match against active `business_knowledge`, fails closed on any error) moved out of voice's `calls.ts` into `leadCapture.ts` — the one place already shared by chat, widget, and voice — and voice now imports it from there instead of keeping its own copy. One implementation, three callers.
- **Chat and widget gained the same guard voice already had**: right after lead extraction, if the intent is `new_booking` and a specific service was named, the service is checked against the org's Knowledge Base. If unconfirmed, the intent is downgraded before it reaches `ACTIONABLE_INTENTS`/`capturePartialLead` — the same mechanism that stops the shared `isBookingConfirmed()` from marking it "booked" or sending a booking-confirmation email. A new deterministic branch then captures the lead directly (not routed through `assessAnswerConfidence`, whose own rules explicitly treat "any booking-related message" as not needing review and would otherwise drop the enquiry instead of capturing it), sets the resulting status to the existing `awaiting_confirmation` value, and preserves the caller's exact requested service text — matching what was already correct for voice.
- **Same wording as voice**: chat gains a new Rule 11 and widget a new Rule 9, both matching voice's Rule 15 almost verbatim — "I'll pass your request to our team. They'll confirm whether we can provide that service and, if we can, they'll arrange your appointment," making clear neither the service nor the appointment is confirmed.
- **Resolved a real conflict found during this fix**: chat's existing Rule 9 said "When a customer requests any service — even one not listed in the knowledge base — always accept it as a booking," which directly caused the bug this priority fixes. Rule 9 is now scoped to "treat it as a genuine request, don't redirect them elsewhere" while explicitly deferring to the new Rule 11 for confirmation — the same override pattern voice's Rule 15 already uses against its own Rule 7.
- **Known-service bookings are completely unchanged** — the guard only fires when a service is named and isn't found in the Knowledge Base; every existing booking, chat, and widget behavior for real services is untouched.
- No changes to the database schema, RLS, voice routing, Vapi integration, or any file outside the four listed above. `tsc --noEmit` and `next build` both pass.

## 2026-07-15 (Voice AI: two wording refinements for unconfirmed services — `src/lib/voice/assistant.ts` prompt text only)

### Changed (voice prompt wording only — no logic, no other file)
- **Exact service text preserved**: the structured-data `service` field description and Rule 15 previously told the model to record an unconfirmed service as "General enquiry - X". Both now instruct it to record the caller's exact words with no relabelling at all (e.g. "cabinet making" stays "cabinet making") — the lead's `service_needed` still shows the literal request, status still `awaiting_confirmation` (from the previous commit's code fix, unchanged).
- **Clearer unconfirmed-service closing**: Rule 15's script now explicitly overrides Rule 7's booking-confirmation wording (which promises "They'll confirm your appointment shortly" and was leaking into unconfirmed-service calls) and closes instead with wording that makes clear neither the service nor the appointment is confirmed yet: "I'll pass your request to our team. They'll confirm whether we can provide that service and, if we can, they'll arrange your appointment."
- Known-service bookings are untouched — Rule 7's wording, the booking flow, and the "booked" status/confirmation email are unaffected; Rule 15 only overrides Rule 7 for the unconfirmed-service branch. No change to `calls.ts`, `leadCapture.ts`, chat, widget, Vapi integration, Supabase, or schema. `tsc --noEmit` and `next build` pass.

## 2026-07-15 (Voice AI: unconfirmed services no longer create a real booking — `src/lib/voice/calls.ts`, `src/lib/voice/assistant.ts`)

### Fixed (voice-only; business name NOT touched — "Nite Owl Test" is correct and unchanged)
- **Bug**: a caller requesting a service not in the Knowledge Base (e.g. "cabinet making" on a plumbing org) got Remy's correct spoken caveat, but the system still created a `booked` lead and sent the "New booking" confirmation email. Root cause: `isBookingConfirmed()` in the shared lead-capture engine (`src/lib/leadCapture.ts`, used by chat/widget too — **not modified**) decides "booked" from intent + contact + a confirmed time alone; it has no concept of whether the requested *service* is actually confirmed by the Knowledge Base.
- **Fix, voice-only, before the shared engine ever sees it**: `processCallEnded` in `calls.ts` now checks a `new_booking` request's named service against the org's active `business_knowledge` (new `isServiceConfirmedByKnowledge`, word-overlap match, fails closed on any lookup error). If unconfirmed, the intent is downgraded (so the shared engine's own unmodified logic naturally skips "booked" and never schedules the booking email), the lead's name/phone/exact requested service/preferred time are still captured as before, and its status is explicitly set to the existing `awaiting_confirmation` value. The owner still gets the call-summary email that already fires for every call — just not a false "New booking" confirmation.
- **Confirmed-service bookings are completely unaffected** — the guard only fires when a service is named and isn't found in the KB; the known-service branch never enters the new code path.
- **Voice prompt (Rule 15)** tightened so the caller is told plainly the preferred time is noted but the appointment isn't confirmed until the business verifies it offers the service — no other prompt content changed (Rule 14, added last commit, is untouched).
- Known limitation, accepted to keep this change minimal and to avoid touching `leadCapture.ts`: on the rare repeat-caller *merge* path, `shouldUpdateService()` there only updates `service_needed` when intent is `new_booking`, so a downgraded intent won't overwrite an existing merged lead's service text. New leads (the reported scenario) are unaffected.
- No change to: business name (any surface), known-service booking behaviour, Knowledge Base retrieval, voice routing, Vapi integration, chat, the shared lead-capture engine, calendar logic, database schema, or dashboard layout. `tsc --noEmit` and `next build` pass.

## 2026-07-15 (Three targeted fixes: editable business name, currency, unknown-service handling)

### Added — Business Information settings page (`src/app/(dashboard)/settings/business/`)
- The business name was only ever set during onboarding, with no way to edit it afterward — so it kept showing the onboarding value ("Niteowl Test"). It was never hardcoded: dashboard welcome, voice greeting, and every email already read `organisations.business_name` via `org.business_name` / `getOrgOwnerEmail()`. Added a **Business** settings tab + page to edit that single field (mirrors the existing `settings/hours` update pattern; authenticated owner updates `organisations.business_name`). Because all surfaces already read that one field, saving here updates the dashboard welcome, voice greeting, email notifications, booking emails, and call summaries consistently. `settings/layout.tsx` gains the tab; `/settings` now lands on it. No email/greeting/dashboard code changed.

### Changed — Voice prompt only (`src/lib/voice/assistant.ts`)
- **Currency (Rule 14)**: read prices in the exact currency written in the Knowledge Base and never convert — `€`→"euros" ("€100" → "100 euros", never "100 dollars"), `£`→"pounds", `$`→"dollars"; the symbol is preserved as stored.
- **Unknown services (new Rule 15 + structured-data `service` description)**: if a caller asks for a service NOT in the Knowledge Base (e.g. geothermal heating), Remy must not confirm it, imply the business offers it, or say an appointment is booked — instead it says it can't confirm that service, offers a callback, takes their details, and records the request in the caller's own words as a general enquiry (e.g. "General enquiry - geothermal heating"), never rewritten into a specific service. Confirmed-service bookings (Rule 7) are unchanged.
- Prompt strings only — no change to the booking engine, lead-capture/extraction code, KB retrieval, Vapi integration, or Supabase. `tsc --noEmit` and `next build` pass.

## 2026-07-15 (Voice AI: currency pronunciation rule — prompt only, `src/lib/voice/assistant.ts`)

### Changed (one new Phone Conversation Rule; nothing else touched)
- Live calls were reading `€100` from the Knowledge Base as "100 dollars". Added Rule 14 to the voice system prompt instructing the assistant to say prices in the exact currency written and never convert — the `€` symbol is spoken as "euros" ("€100" → "100 euros"), never "dollars"/pounds/etc. Number kept exactly as written; only the symbol is spoken as the word.
- Prompt string only — no logic, retrieval, booking, lead-capture, or other prompt rules changed. `tsc --noEmit` and `next build` pass.

## 2026-07-15 (Leads page: compact rows + details drawer — layout only, `src/app/(dashboard)/leads/LeadsTable.tsx`)

### Changed (presentation only — no data, schema, lead-creation, notification, or voice change)
- **Row height fixed**: long voice-call summaries no longer stretch rows. The old standalone "Message" column (an inline, expand-in-place cell) is removed from the desktop table; the enquiry/summary now shows as a **two-line, ellipsis-clamped** preview inside the **Service** column (`service_needed`, falling back to the summary). Same two-line clamp applied on the mobile cards.
- **Details view**: the whole row (desktop) and whole card (mobile) are now clickable, and the last column is labelled **Actions** with a clear **View details** button, all opening the existing right-side drawer. The drawer already shows the full text; its section was relabelled "Enquiry summary" and continues to render the complete `lead.message`. The drawer keeps its existing edit fields (status/service/appointment/notes) — no functionality removed.
- Columns kept and readable: Created, Name, Phone, Email, Service, Appointment time, Status, Source, Actions. Desktop table + mobile cards both preserved (responsive `lg` breakpoint unchanged). `tsc --noEmit` and `next build` pass.
- NOTE: the full call **transcript** lives on `voice_calls.transcript`, which this page does not load; surfacing it would need a data-fetch change (out of scope per the request), so the drawer shows the complete stored lead summary (`lead.message`).

## 2026-07-15 (Voice AI: KB-not-used root-caused to a stray static Vapi assistant — RESOLVED; temp diagnostics removed)

### Fixed (configuration — Vapi dashboard, no code change) + Reverted (`src/lib/voice/incoming.ts`)
- **Root cause**: a static assistant ("Inbound AI Receptionist") was still attached to the Vapi number `+18436480204`, so Vapi answered calls with that canned prompt and never sent an `assistant-request` to `/api/voice/incoming` — our KB-building path never ran. Exactly the mistake `docs/VOICE_SETUP_RUNBOOK.md` Step 3 warns about; end-of-call reports still reached us, so leads/emails/call-rows worked and it looked healthy while the Knowledge Base was bypassed.
- **How it was proven** (not a code/retrieval bug): SQL confirmed the number resolves to the right org ("Niteowl Test", enabled) which holds the €100 record active under category `faq` (a rendered category); a dev end-to-end drive showed the code injects that record into the voice prompt; and prod log capture across 3 real calls showed every call ran end-of-call processing but produced ZERO `[voice kb diagnostic]` lines — those fire at the top of `buildAssistantRequestResponse`, so their absence proved the builder never executed.
- **Fix**: owner detached the static assistant from the number in Vapi (assistant field empty; only the Server URL remains). **Verified in production**: the next call logged `active records returned: 5`, `KB block present in system prompt: true`, and the injected prompt contained `### Frequently Asked Questions — What are your call out fees: €100 standard fee`. Voice now answers from the Knowledge Base, same content as chat.
- **Reverted**: the temporary `[voice kb diagnostic]` logging added earlier today (commit 30be6cc) is removed — `src/lib/voice/incoming.ts` is byte-for-byte back to its prior state. No other code, chat, schema, or functionality touched. `tsc --noEmit` passes.

## 2026-07-15 (Voice AI: temporary KB-retrieval diagnostics on the assistant-request path — logging only)

### Added (`src/lib/voice/incoming.ts` — TEMPORARY `[voice kb diagnostic]` logs, remove after pilot)
- Investigating: after the Vapi number was switched off its static assistant, live calls now reach our dynamic path but Remy still asks follow-up questions instead of answering a KB FAQ (e.g. the €100 call-out fee) that chat answers correctly. Local end-to-end drive of the assistant-request path proved the code fetches and injects the KB, so these logs capture the one thing only a real prod call can show: which org the dialled number resolved to and what actually reached the LLM.
- Logs added in `buildAssistantRequestResponse`, same deliberately-live-in-prod pattern as the existing `[sales chat diagnostic]` lines: (1) resolved org id/name + dialled number, (2) whether the KB query errored and how many active records returned, (3) the record categories/titles, (4) whether the `## Business Knowledge` block is present and the FULL injected system prompt, (5) a note that the LLM's answer selection isn't server-visible — so if the FAQ line is in the prompt but Remy still asked for details, retrieval is correct and the cause is model/prompt-following; if absent, the record is missing/inactive/mis-categorised for that org.
- Logging only — no logic, control flow, retrieval, or prompt content changed. `tsc --noEmit` passes. To read: make one test call, then `npx vercel logs <deployment> --json | grep "voice kb diagnostic"`.

## 2026-07-15 (Security Advisor fixes prepared: business_knowledge RLS + lead_summary invoker — docs only, awaiting owner execution)

### Security (SQL prepared in `docs/sql/2026-07-15_business_knowledge_rls.sql`, to be run in BOTH Supabase SQL editors)
- **Finding (confirmed empirically on both projects)**: `business_knowledge` was created without RLS — the public anon key could read *and write* every org's knowledge records. Verified on dev by an unauthenticated INSERT succeeding (probe row deleted immediately); prod showed the same signature via read-only count probes (all rows anon-visible, every other table 0). All other app tables already had RLS enabled — this was the only gap. Prod advisor also reports a dormant policy on the table ("Policy Exists, RLS Disabled").
- **Fix**: drop all dormant policies on `business_knowledge` (provably behaviour-neutral — none has ever been active with RLS off, and a leftover permissive policy could otherwise keep the table world-readable once RLS turns on), create one owner-scoped `FOR ALL TO authenticated` policy (same `org_id in (select … where owner_id = auth.uid())` pattern as the existing `voice_calls` policy), then enable RLS.
- **Why the app is unaffected**: every anon-key access to `business_knowledge` (knowledge page, KnowledgeClient CRUD, onboarding knowledge step, setup checklist, dashboard-preview chat API) was verified in code to be an authenticated owner operating on their own org; widget chat, voice, and booking paths use the RLS-bypassing service-role client.
- **`lead_summary` (advisor: "Security Definer View")**: as a default view it ran with owner rights, bypassing `leads` RLS and exposing per-org lead counts to the anon key (confirmed on both projects). Fixed with `security_invoker = true`; the view is referenced nowhere in the codebase (repo-wide search), so this cannot affect the app. Kept rather than dropped — dropping is a bigger change than the fix needs.
- **Explicitly NOT touched**: all other tables/policies, schema, app code, booking logic. Script is idempotent and ends with a single verification query (expected: exactly two rows, no "STILL RLS-DISABLED" lines) — owner to paste results back after running on prod (`sklcqvvnuigpewzarbiv`) and dev (`kioljdihgbcboxlnwghv`).

## 2026-07-12 (Voice AI: four more owner-requested conversation refinements from the latest test call — prompt rules only)

### Changed (`src/lib/voice/assistant.ts` Phone Conversation Rules only — rules 1, 2, 11)
- **Rule 1 (grammar)**: the latest call produced dropped-opening-word questions ("There an email address where they can reach you if needed?"); the rule now demands complete, grammatically correct sentences and quotes that exact wrong/right pair.
- **Rule 2 (one question per turn, tightened again)**: the previous example didn't generalise ("Is this an urgent issue? Also, could I get your phone number?" still happened), so the rule is now mechanical — at most ONE question mark per turn — with both observed anti-patterns quoted. Also absorbs the anti-repetition refinement: an acknowledgement is a few words ("Thank you. I'll make sure our team knows this is urgent."), never a read-back of everything collected so far.
- **Rule 11 (closing)**: the mandated end-of-call recap of every detail is removed (it was producing the long final summary; each detail is already confirmed at collection time by rules 6/7, which are untouched — worth watching lead quality on the next few calls since the recap also gave the transcript-extraction fallback a consolidated record). New closing: "Perfect. I have everything I need. I'll pass your details to our team straight away and someone will contact you as soon as possible. Thank you for calling {business name}." The urgent/manual-follow-up variant and the "never promise an appointment or a guaranteed response time" safeguard are retained.
- Explicitly NOT touched, per the owner's instruction: booking logic, Vapi integration, Supabase, database, webhooks, lead creation, email templates, extraction logic, all other prompt content and safeguards. `next build` passes.

## 2026-07-12 (Voice AI: five owner-requested conversation refinements — prompt rules only, one file)

### Changed (`src/lib/voice/assistant.ts` Phone Conversation Rules only)
- **Rule 2 (one question at a time)**: the bare rule was being ignored ("May I have your name? Also, what's the best phone number…"); now spells out the anti-pattern verbatim and the required rhythm — ask, wait, acknowledge, then ask the next.
- **Rule 6 (email confirmation)**: letter-by-letter read-back replaced with a single natural confirmation ("Thanks, I've got your email as john@example.com."); a caller's correction is acknowledged once, then the call moves on.
- **Rule 11 (closing)**: urgent/manual-follow-up calls now close with "We'll make sure your request reaches the team as quickly as possible. Thank you for calling {business name}." instead of the standard booking closing; an explicit "never promise an appointment or a guaranteed response time" is added to the rule, alongside the existing Rule 7 no-guarantee safeguard which is untouched.
- **New Rule 13 (no fake checking, confident tone)**: forbids narrating work Remy isn't doing ("I'm checking…", "Let me see if…", "I wanna make sure…") about things it already knows or that happen after the call; supplies the replacement patterns — move the conversation forward or state plainly what will happen ("I'll make sure the right person receives your request as quickly as possible.").
- Explicitly NOT touched, per the owner's instruction: booking logic, Vapi integration, Supabase, schema, webhooks, email templates, lead creation, transcript extraction, all other prompt content and safeguards. `next build` passes.

## 2026-07-12 (Voice AI: three owner-requested conversation wording changes — one file, no logic touched)

### Changed (`src/lib/voice/assistant.ts` only)
- **Greeting clip-resistance**: the default `firstMessage` now starts with a leading `...` — TTS renders it as a short pause, so the start-of-call audio clipping heard on both 2026-07-10 production calls consumes silence instead of the opening words. Text-only; the Vapi payload shape is untouched.
- **Booking confirmation wording (Rule 7)**: the model had been improvising negative phrasing ("Currently, I'm unable to book appointments directly…" — confirmed absent from the codebase, so purely prompt-driven). Rule 7 now forbids "unable to book" phrasing and supplies the exact line: "I've noted your preferred time and sent your request to our team. They'll confirm your appointment shortly." The existing never-guarantee-the-slot constraint is retained verbatim.
- **Closing (Rule 11)**: after the existing end-of-call summary, Remy now closes with exactly: "Thank you for calling {business name}. We've received your request and will be in touch shortly. Have a wonderful day." (`business_name` interpolated, so it says "NiteOwl HQ" for the live org and stays correct for future orgs).
- Explicitly NOT touched, per the owner's instruction: business logic, Vapi integration/payload, Supabase, schema, lead creation, booking logic, emails, webhooks, any other prompt content. `next build` passes.

## 2026-07-12 (Voice AI: production test-row cleanup executed and verified + greeting warmed up per owner request)

### Done (production cleanup, owner-executed, assistant-guided)
- The 2026-07-10 go-live test rows are gone from real production: 12 `voice_events`, 4 `voice_calls`, 1 `voice` lead, 2 conversations, all scoped to the owner's test caller `+353871465274` / test org. Run inspect-first with results verified at every step; each delete used `returning` so the owner saw exactly what was removed; final verification query confirmed 0 remaining in all four tables.
- One inspection catch that mattered: the merged test lead stored the **spoken** local-format phone (`0871465274`, via the transcript-extraction fallback), not the `+353…` caller ID, so the script's phone-predicate lead delete would have silently missed it (and the conversations delete would then have hit the lead's FK). Caught before deleting; the lead was verified by content and deleted by exact id instead. Worth remembering: **voice leads' `phone` is the number as spoken, not the caller ID** — the caller ID lives on `voice_calls.caller_phone`.
- Greeting mystery resolved by the same session's prod query: `voice_settings.greeting` is **NULL** — the code default was in play all along (the "custom greeting" theory in the entry below was wrong), so "Hi. For calling." is the call audio/transcript's rendering of the default, most plausibly start-of-call clipping. Tracked in CHECKLIST: listen on the next test call; if still clipped, it's audio timing, not wording.

### Changed (greeting only — owner-requested wording)
- `src/lib/voice/assistant.ts` default greeting: "This is Remy, **the** AI receptionist" → "This is Remy, **your** AI receptionist" (one word; the `{business_name}` interpolation and everything else untouched). No other voice logic, booking flow, lead capture, or email path modified — the greeting string is consumed only as `firstMessage` in the assistant config. `next build` passes.

## 2026-07-12 (Voice AI: production test-row cleanup SQL prepared + garbled greeting narrowed to a custom setting — docs only, no code)

### Added
- `docs/sql/2026-07-12_voice_test_rows_cleanup.sql` — owner-runnable script for the outstanding hygiene item: deleting the 2026-07-10 go-live test rows from real production. Same discipline as the earlier sales-leads cleanup: an inspect-first section to eyeball every row before anything is deleted, deletes scoped by the exact same predicates (test caller `+353871465274` + test org only — a genuine customer call from any other number is untouched by every statement), FK-safe ordering (events resolved via `voice_calls` before those rows go, calls before leads, leads before conversations), and zero-remaining verification queries at the end.

### Diagnosed (greeting follow-up narrowed, pending one prod query)
- The deterministic "Hi. For calling. How can I help you today?" opening on both real calls is almost certainly **not** the code default: `src/lib/voice/assistant.ts` defaults to "Thanks for calling {business}. This is Remy, the AI receptionist. How can I help you today?", which starts differently ("Hi" vs "Thanks") and contains a whole sentence ("This is Remy…") absent from what was heard. A custom `voice_settings.greeting` row value in production is therefore the prime suspect. The confirming read-only query is appended to the cleanup script (owner runs both in one SQL-editor session); once the stored value is known, the fix is a single UPDATE (or clearing it to NULL to fall back to the code default).

### Notes
- No code changed; CHECKLIST's two open Voice items updated to point at the script. The third open follow-up (Vapi `structuredData` NULL on every real call) needs Vapi call logs/support and stays open — the transcript fallback continues to carry extraction.

## 2026-07-10 (Voice AI: second real call — summary email worked, but Vapi returned no structured data, so no lead; timeout raised + transcript-extraction fallback added)

### Diagnosed
- After the duration fix deployed, the owner's second real production call completed the pipeline (event processed cleanly, `voice_calls` row correct, summary email delivered) but **`message.analysis.structuredData` was NULL**, so no lead and no booking email. Vapi's API spec documents the cause: analysis requests default to a **5-second timeout** and "when request times out, `call.analysis.structuredData` will be empty" — a 2.5-minute transcript plus extraction schema doesn't reliably fit in 5s. The summary still arriving (Vapi summarises by default) matched exactly. Verified against Vapi's live OpenAPI spec that our `analysisPlan.structuredDataPlan { enabled, schema }` shape is current and correct — the shape wasn't the problem, the timeout was.

### Fixed
- `src/lib/voice/vapi.ts`: `timeoutSeconds: 30` set on both `summaryPlan` and `structuredDataPlan` (spec allows up to 60; trades a slower end-of-call report for reliable extraction).
- **New fallback so a provider-side analysis failure can never cost a lead again**: `src/lib/voice/extraction.ts` extracts the same lead fields from the transcript we already hold (gpt-4o-mini, JSON-only, defensively parsed, returns null on any failure — a fallback failure leaves behaviour exactly as before the fallback existed). `processCallEnded` uses it only when the provider returned no structured data; everything downstream (lead capture, needs-review logic, summary-email caller name) reads the resolved details. Prompt handles spoken artefacts: fragmented name spellings, "john dot smith at gmail dot com" emails, and keeps the repo's hard-won rule of returning requested times exactly as spoken (never model-resolved dates).

### Verified (dev end-to-end, fallback path specifically)
- Replayed an end-of-call report **without** `structuredData` (transcript only, decimal duration 154.583): fallback log line fired; event processed with no error; `voice_calls` completed (`duration_seconds = 155`, cost, lead linked); lead created with source `voice`, transcript-extracted name, spoken email correctly normalised to `fallback.test@example.com`, caller ID as phone, "tomorrow at 2pm" booked for the correct Europe/London slot; all three emails (owner booking confirmation, owner call summary — now with the caller's name in the subject — and customer booking confirmation) accepted/delivered via Resend. All test rows deleted afterwards; `next build` passes.

## 2026-07-10 (Voice AI: first real production call exposed a duration-rounding bug — one-line fix in the Vapi adapter)

### Fixed
- **End-of-call processing failed on every real call: `voice_calls upsert failed: invalid input syntax for type integer`.** After the two go-live gaps below were fixed (`VOICE_ENABLED` on, canned assistant un-assigned), the owner's real production test call reached the webhook and stored its `voice_events` row, but processing died at the very first step — so no `voice_calls` row survived, no lead was created, and no summary email was sent. Root cause: Vapi reports `message.durationSeconds` as a **decimal** (e.g. `34.583`), and the adapter passed it through unrounded into the integer `voice_calls.duration_seconds` column. The `durationMs` fallback path already rounded; the primary path didn't. The 2026-07-09 dev simulation missed it because its hand-written payload used a whole number.
- Fix (`src/lib/voice/vapi.ts`, adapter only — no engine/route changes): round `durationSeconds` after resolving either source field. Failure containment worked exactly as designed: the raw event was preserved in `voice_events` with `processing_error` set, and the production diagnosis came straight from that column.

### Verified (full dev end-to-end replay with the exact failing shape)
- Replayed a realistic `end-of-call-report` (`durationSeconds: 34.583`, decimal cost, structured booking data) against the dev server + dev Supabase project: event stored and marked processed with no error; `voice_calls` row `completed` with `duration_seconds = 35`, `cost_usd = 0.0432`, lead linked; lead created with source `voice`, caller ID as phone, "tomorrow at 2pm" parsed to the correct Europe/London slot, status `booked`; both the booking-confirmation and call-summary emails confirmed `delivered` via Resend's API. All test rows (lead, call, event, conversation, temporary `voice_settings`) deleted afterwards. `next build` passes.

## 2026-07-10 (Voice AI: production setup executed by the owner — two gaps found before go-live; docs only, no code)

### Progress (owner-completed, same day as the runbook)
- Both voice SQL files run on real production (`sklcqvvnuigpewzarbiv`); owner confirmed `leads_source_check` now includes `'voice'`
- Vapi account + production phone number `+18436480204` created and activated; number's Server URL set to `https://niteowlhq.com/api/voice/incoming` with the shared secret; `VAPI_WEBHOOK_SECRET` added to Vercel Production and redeployed
- `voice_settings` row created and verified for the production org (`e3a9ae40-836a-4a55-a723-8b09a9622050`, enabled, E.164 number matching the Vapi number)
- A real inbound call to the number was answered — proves number provisioning and telephony work

### Found before go-live (both must be fixed before the end-to-end test counts)
- **`VOICE_ENABLED` is still off in production** — externally verified after the owner's redeploy: `POST /api/voice/incoming` and `/api/voice/webhook` both answer 404 (dark), while `/api/health` is 200. The env var was never set (it was absent from the completed-steps report). Fix: add `VOICE_ENABLED=true` in Vercel Production and redeploy.
- **A dashboard-built assistant ("Inbound AI Receptionist") was assigned to the Vapi number.** With an assistant attached, Vapi answers using that canned assistant rather than sending an `assistant-request` to our Server URL — so the successful test call never touched our integration: Remy was not built from the Knowledge Base, and no `voice_events`/`voice_calls` rows, lead, or summary email were produced (confirmed consistent with the routes being dark). Fix: remove the assistant from the number so only the Server URL drives it, per runbook Step 3.
- CHECKLIST's Voice section updated to reflect exactly which items are genuinely complete and which two remain; the live end-to-end test call item stays open and must be redone after both fixes.

## 2026-07-10 (Voice AI: production setup runbook for the owner — docs only)

### Added
- `docs/VOICE_SETUP_RUNBOOK.md` — the remaining Voice AI work is entirely outside-the-repo owner setup (production SQL, Vapi account/number, Vercel env vars, live test call), so this writes those steps up in strict order with exact values pulled from the code: the correct production project ref, verification queries for both SQL files, the `x-vapi-secret` server-URL secret flow, an idempotent `voice_settings` upsert template, the two Vercel variables that finally turn voice on, the live-call verification chain, and rollback. CHECKLIST's Voice section now points at it. No code changed; voice remains dark in production.

## 2026-07-09 (Voice AI Phase 2 Step 1 — additive voice platform behind /api/voice/*, dark by default)

### Added
- **Voice AI foundation so Remy can answer phone calls via Vapi** — entirely additive: a new `src/lib/voice/` namespace and two new routes (`/api/voice/webhook`, `/api/voice/incoming`); no existing chat, widget, booking, notification, dashboard, or auth code path was modified. Nothing existing imports from `voice/`, so a voice failure is structurally incapable of affecting the pilot baseline.
- **Adapter architecture (provider-replaceable):** `types.ts` defines the internal `VoiceEvent`/`VoiceAssistantConfig` schema; `vapi.ts` is the only file that knows Vapi's wire format (inbound payload parsing with defensive fallbacks, outbound transient-assistant rendering with **recording disabled** per the GDPR decision). Swapping providers later means one new adapter, not a rewrite.
- **Durable, idempotent ingestion:** raw webhook payloads are stored in `voice_events` *before* processing (dedupe on `provider + dedupe_key`, so provider retries are no-ops); processing runs in `after()` post-ack, and a failure records `processing_error` while leaving the event replayable. If storage itself fails the route answers 500 so the provider retries — an event is never acked without being persisted.
- **Answering calls:** an `assistant-request` resolves the org by the dialled number (`voice_settings.phone_number` is the tenant key), applies the same `hasActiveAccess` billing gate as chat (lapsed orgs get a polite spoken decline, mirroring the paused-chat reply), and builds the voice prompt from the org's **live** `business_knowledge` records — knowledge edits apply to the next call with nothing to sync. Phone-specific prompt rules: short spoken sentences, one question at a time, spell-back confirmation of names/emails, never invent answers (take a message instead), 999 emergency disclaimer, no cross-customer disclosure.
- **Existing engines reused, not duplicated:** end-of-call structured data (schema mirrors `ExtractedLead`) feeds `capturePartialLead` with the new lead source `voice` — availability, capacity, double-booking prevention, lead merging (repeat callers match by caller ID), and booking-confirmation emails are all the existing engine. Urgent or substantive non-booking calls become `needs_review` leads. Every completed call emails the owner a summary via a new `sendCallSummaryEmail` appended to `email.ts` (reuses `escapeHtml`/`sendChecked`; no existing email function touched). No separate needs-review email for voice — the per-call summary already notifies the owner.
- **Security:** endpoints are public and authenticated solely by constant-time verification of the `x-vapi-secret` header (fails closed if `VAPI_WEBHOOK_SECRET` is unset) — the Stripe-webhook trust model; per-IP rate limiting via the existing limiter; `VOICE_ENABLED=true` global kill switch, without which the entire voice surface answers 404 (it is currently OFF everywhere, so production behaviour is unchanged by deploying this).

### Database (must be run manually — no migrations folder in this repo, same convention as prior schema changes)
- `docs/sql/2026-07-09_voice_tables.sql` creates `voice_events`, `voice_calls` (with cost columns for future metered billing), and `voice_settings`. Additive only, RLS enabled, owner read-only policies on calls/settings. **Run it on BOTH Supabase projects — the dev/test project (`kioljdihgbcboxlnwghv`, what `.env.local` points at) and real production (`sklcqvvnuigpewzarbiv`) — before enabling voice there; recall the 2026-07-06 incident where these two were conflated.** Deploying the code without the SQL is safe: the routes are dark without `VOICE_ENABLED` and fail closed if enabled early.

### Environment
- New server-side vars: `VAPI_WEBHOOK_SECRET` (must match the Vapi dashboard's server-URL secret) and `VOICE_ENABLED` (kill switch, default dark). Added to `.env.local` with comments; **do not set `VOICE_ENABLED` in Vercel production until the SQL has run and a test number is configured.**

### Verified
- `next build` passes; all 34 existing pages/routes build unchanged; `tsc --noEmit` clean (the one pre-existing lint error in `ConversationView.tsx` predates this work and was deliberately left alone)
- Dev-server smoke tests against the dev/test Supabase project: missing/wrong secret → 401, invalid JSON/envelope → 400, unhandled Vapi message types → 200 acked-and-ignored, `assistant-request` for an unknown number → 404, kill switch off → 404 on both routes, `/api/voice/incoming` alias behaves identically, and end-of-call storage correctly refuses to ack (500 → provider retry) while the voice tables don't exist yet
- Baseline re-verified after all changes: `/api/health` → `200 {"status":"ok","database":"ok"}`

### Verified (addendum, later same day — full dev-project end-to-end after both SQL files were applied)
- Both SQL files applied to the dev/test project by the owner. The `leads_source_check` hazard proved real: the first simulated booking call recorded the call and sent the summary email but the lead insert was rejected by the constraint — exactly the failure mode predicted; fixed by `docs/sql/2026-07-09_leads_source_voice.sql` (rebuilds the constraint from its live definition, no value guessing)
- Full simulated chain then verified green: `assistant-request` returned a complete Remy assistant built from Test Plumbing Co's live knowledge base → simulated `end-of-call-report` stored raw + deduplicated on resend → `voice_calls` row (completed, cost 0.31, transcript) → lead created with source `voice`, caller ID as phone, "tomorrow at 2pm" parsed to the correct Europe/London ISO datetime, status `booked` via the existing availability/capacity checks, `manage_token` issued → lead linked back to the call → owner booking-confirmation and call-summary emails accepted by Resend (customer copy correctly skipped for a phone-only caller); a late `status-update` did not downgrade the completed call
- Baseline re-verified live after everything: `/api/health` 200, homepage/login/dashboard-redirect 200, widget 401 on bad key, bookings-manage and Stripe webhook designed 400s, and a real widget chat message streamed the existing needs-review handoff behaviour end-to-end
- All test data removed from the dev database afterwards (voice tables empty, test lead/conversation deleted)

### Status
- Voice is code-complete for Step 1 and fully verified by simulation against the dev project, but **dark in production**: no Vapi account is wired up yet, `VOICE_ENABLED` is unset in production, and neither SQL file has been run on the production project. Next steps live in CHECKLIST.md under "Voice AI (Phase 2)". Remaining verification gap: a real Vapi test call end-to-end, once the owner completes the Vapi/Twilio setup from the Step 0 plan.

## 2026-07-08 (Sales chat: root cause of intermittently missing demo notifications — context-free field extraction; PILOT BASELINE)

### Fixed
- **The intermittent "demo booked but no notification email" failures — previously suspected to be browser-specific (Chrome vs Samsung Internet) — were caused by the field extractor silently dropping bare answers.** Root-caused via the temporary production diagnostics: `extractSalesLeadFields` sees only the visitor's latest message plus already-known fields, with no conversation history, so a bare unframed answer like "Poiu" to "what's your company name?" was a coin flip — sometimes attributed, sometimes dropped. A dropped field left the deterministic flow state stuck at "still collecting" (no recap, no confirmation, notification correctly never sent), while the reply-generating model — which *does* see the full history and knows the answer was given — declared the booking complete anyway ("Fantastic! You're all set…"), so the visitor walked away believing it was booked. Captured live in a real production trace: the failing conversation's final turn exited with `awaitingConfirmation: false` and one field missing, while the matching Samsung run 90 seconds earlier passed on identical phrasing luck. The browser pattern was pure coincidence across a small sample.
- Fix (extraction input only — no UI, wording, booking-flow, or notification-logic changes): the extractor is now told which field the visitor was just asked for, derived from the lead's own state once a row exists; for the opening name question — where no lead row exists yet, a gap that E2E testing proved could shift every later answer one question out of phase — it instead receives the salesperson's previous message as context, passed through from the route (which already had it in the request body).

### Verified
- Exact production failure script (bare "Poiu" company, "Tomorrow at 3.45") now completes and notifies, under the failing session's real Chrome for Android user-agent
- Adversarial bare-gibberish answers for name AND company (both classes reproduced dropping the field pre-fix) now attribute deterministically; normal-value regression unchanged — under both Chrome and Samsung Internet user-agents, 7/7 completed runs each delivered a real Resend-accepted notification
- Owner confirmed on real devices: notifications now arrive consistently in both Chrome and Samsung Internet
- All E2E test leads deleted from the dev database; `tsc --noEmit` passes

### Status
- **This build (`e16a228`) is the frozen working baseline for pilot customers.** Temporary diagnostic logging in the sales chat path is deliberately left live for the pilot so any future failure is immediately traceable; remove it once the pilot has stabilized. Outside-the-repo items still open: Supabase backups, external uptime pinger, manual deletion of production test leads (see CHECKLIST).

## 2026-07-08 (Needs-review owner notifications never sent when a question/complaint arrived alongside contact details)

### Fixed
- **Needs-review notification emails to the business owner were never sent when a customer's message combined a genuine question or complaint with their contact details in the same turn** (e.g. "My plumber damaged my ceiling, my email is x@y.com"). `extractLeadData` correctly classifies this as `contact_update` intent since contact details are present, but both `/api/chat` and `/api/widget/chat` only ran the confidence check that flags `needs_review` and triggers `sendNeedsReviewNotification` for `question`/`unknown` intents — `contact_update` (along with `new_booking`/`reschedule`) skipped it entirely. The lead saved as an ordinary lead with no `needs_review` status and no notification, even though Remy's own reply already told the customer a team member would follow up. Now runs the same existing confidence check for `contact_update` messages too, reusing the same needs-review capture and notification helpers already used for `question`/`unknown` — `new_booking` and `reschedule` (the actual booking flow) are untouched.

### Verified
- Reproduced directly against the dev database via the live widget API: a complaint message with an email address saved as an ordinary `new` lead with no metadata and no notification sent
- Re-ran the identical message after the fix: the lead now correctly lands as `needs_review` with `needs_review_notification_sent: true` in metadata, confirming Resend accepted the send
- `tsc --noEmit` passes with zero new errors
- All test leads/conversations created during reproduction/verification deleted afterward

## 2026-07-08 (Sales chat: hardened field extraction against silent failure; booking can no longer appear complete unless the team notification actually sent)

### Fixed
- **A field-extraction timeout or error could silently drop whatever the visitor said in a message, with only a server-side `console.error` — invisible to the visitor and indistinguishable from "nothing new stated."** Confirmed via a real production log entry found while investigating a report that Chrome completed the booking flow without ever sending the team notification: `[extractSalesLeadFields] parse error: [Error [TimeoutError]: The operation was aborted due to timeout]`. If this happened on any of the five required-field turns, that field would never be recorded and the conversation could never reach the "all fields collected" state — yet the AI's reply still sounded conversational, so the visitor had no way to know anything had gone wrong. `extractSalesLeadFields` (`src/lib/salesLeadCapture.ts`) now retries once on any failure (network error, non-2xx response, or unparseable output) and, critically, now distinguishes "the call genuinely failed" from "the call succeeded and found nothing new" — previously both cases returned the same all-null result, making them indistinguishable to the caller. When extraction still fails after retrying, `captureSalesLead` returns the visitor's state exactly as it was before that turn (nothing lost, nothing guessed) and flags `extractionFailed`, so the assistant apologizes and asks the visitor to repeat themselves instead of silently advancing or treating a lost message as if it were never sent.
- **The booking could be reported to the visitor as complete ("our team will follow up") even when the team notification email failed to send** — the notification was a separate, unawaited-by-the-reply step; the AI's closing message was generated regardless of whether that send actually succeeded. `sendSalesLeadNotification` is now called from inside `captureSalesLead` itself, at the exact moment the visitor confirms, and the outcome directly gates completion: the lead is only marked `status: "complete"` / `notification_sent: true`, and the visitor is only told the booking is complete, if that send genuinely succeeds. If it fails, the lead deliberately stays `status: "new"` with all five fields intact, and the assistant apologizes and asks the visitor to confirm once more — a repeated confirmation naturally retries the send, with no separate retry mechanism needed. The now-redundant separate notification step and `markSalesLeadNotified` helper were removed from `src/app/api/sales/chat/route.ts`.

### Verified
- Extraction retry tested directly against the real function (not a simulation) via `tsx`, mocking `fetch` to fail with the exact confirmed production error (`TimeoutError`) then succeed: confirmed the retry recovers cleanly (2 calls, correct fields, `failed: false`), and that a persistent failure across all attempts correctly returns `failed: true` after exactly `MAX_ATTEMPTS` calls (no infinite loop)
- Notification-gating tested end-to-end against the real dev database and a real (temporarily broken) `SALES_NOTIFICATION_EMAIL`: confirming with the notification email unset correctly leaves the lead at `status: "new"` / `notification_sent: false` and replies with an apology asking to confirm again — never claims success; restoring the env var and sending the identical "yes" a second time correctly completes the booking (`status: "complete"`, `notification_sent: true`) and a real notification email was delivered
- Full 7-turn end-to-end regression (happy path, no simulated failures) confirms all previously-shipped fixes still hold together: sequential field collection, confirmation gate, background-scroll lock, no CTA/message overlap, input text contrast
- `tsc --noEmit` and `npm run lint` pass with zero new errors/warnings beyond the existing documented baseline
- All test sales leads created against the dev Supabase project during reproduction/verification deleted afterward; `.env.local` restored to its original state after the notification-failure test

## 2026-07-08 (Sales chat: fresh conversations silently inheriting an old, still-open lead's name/company/email)

### Fixed
- **Critical: a genuinely fresh-looking sales chat (empty message list) could silently resume a completely unrelated, old, still-open sales lead — greeting the visitor by a stale name and later referencing a company they never mentioned in the current conversation.** Reproduced exactly as reported: a browser with an old conversation id already cached, sent only "Hi" in what looked like a brand-new chat, and got a reply referencing a name and company from a prior, never-completed test conversation. Root cause: `SalesChatWidget.tsx` persisted its conversation id in `localStorage` indefinitely, surviving across page loads and browser restarts — but the visible message list is plain React state that has never been persisted or restored anywhere, so it always starts empty on mount regardless. That mismatch meant the widget could *look* fresh while the server, keying off the reused id, treated it as a continuation of whatever lead that id last pointed to. A 2026-07-07 fix excluded already-*completed* leads from this reuse (`OPEN_SALES_LEAD_STATUSES`), but that only covered leads that had reached the confirmation step — it did nothing for the far more common case of a lead abandoned mid-flow (never confirmed), which is exactly what's still "open" and reusable. Fixed by no longer persisting the conversation id in `localStorage` at all — every page load now gets its own brand-new id, kept only in memory (a `useRef`) for the lifetime of that page view, matching the message list's own lifecycle exactly. Also proactively clears the old `localStorage` key on mount so browsers that already have a stale id cached (like the reporter's) are reset immediately rather than needing a manual storage clear.
- Within-page-load continuity (the actual, intended "explicitly continuing an existing conversation" case — sending multiple messages in one sitting, including closing and reopening the widget without reloading the page) is unaffected: the id is still generated once per page view and reused for every send within that view, so the booking flow's sequential field collection and confirmation gate work exactly as before.

### Verified
- Reproduced the exact reported bug against the dev Supabase project: seeded a still-open (`status: "new"`, never confirmed) lead with `name: "Ernie"` / `company: "Asgo Co"`, primed a browser with that lead's conversation id already in `localStorage` (simulating a browser that had it cached from before this fix), then opened the widget fresh and sent only "Hi" — confirmed the old code's reply would have referenced the stale name/company (this is exactly the previously-working, now-fixed, reuse path)
- Re-ran the identical scenario post-fix: the stale `localStorage` key is removed on mount, and the reply to "Hi" is a fully generic greeting with zero reference to the seeded name or company
- Full 7-turn within-session regression (including a close/reopen of the widget without a page reload) confirms all 5 fields are still collected correctly in order, the confirmation gate and completion both work, and nothing about the booking flow itself changed
- Confirmed all other active fixes from previous rounds still hold: no CTA/message overlap, background-scroll lock, input text contrast
- `tsc --noEmit` and `npm run lint` pass with zero new errors/warnings beyond the existing documented baseline
- All test sales leads (including the deliberately-seeded stale one) created against the dev Supabase project during reproduction/verification deleted afterward

## 2026-07-08 (Sales chat: browser-specific bugs — input text invisible under Chrome's auto-dark-theme; Samsung Internet clipping traced to a chunk-boundary bug)

### Fixed
- **Input text was nearly invisible while typing on Chrome for Android.** The `<input>` had no explicit `color`/`background-color`, relying entirely on browser defaults — Chrome's "Auto Dark Theme for Web Contents" (on by default on many Android builds, including Samsung's) heuristically recolors unstyled form controls on pages it judges to be light-themed, and applies it inconsistently enough to leave near-invisible low-contrast text. Fixed with explicit `bg-white text-slate-900` on the input plus `style={{colorScheme: "light"}}`, the standards-based signal that tells the browser this control is deliberately light-themed and opts it out of automatic dark-mode recoloring. Verified with Playwright's `colorScheme: 'dark'` emulation (the actual trigger condition): text renders as near-black on white regardless of the OS/browser dark-mode preference.
- **Found the real cause of Samsung-Internet-specific message clipping, distinct from Chrome (which the previous round's retry fix already resolved): the completion-sentinel check only inspected each network chunk in isolation, not the accumulated text.** The 9-character `"__DONE__"` marker isn't guaranteed to land whole in a single chunk — different browsers' networking stacks chunk a stream differently, and if the marker is split across two separate reads, checking only the latest chunk never detects it, even though the accumulated text already contains it complete. This is consistent with Samsung Internet clipping while Chrome (after the round-3 fix) didn't: different chunking behavior exposed a real bug that Chrome's pattern happened not to trigger. Confirmed deterministically with a raw HTTP server (not Playwright route interception, which can't control real chunk boundaries) that writes `"...demo?\n__DO"` then, after a delay, `"NE__"` as two separate stream chunks: the old per-chunk check never detected completion and leaked the literal `"__DONE__"` text into the visible message; the fixed accumulated-text check correctly detects it and extracts clean text. Also bumped max retry attempts from 2 to 3 for additional resilience against flaky connections.

### Verified
- Deterministic split-sentinel reproduction via a raw Node HTTP server with controlled chunk timing (impossible to simulate accurately with Playwright's `route.fulfill`, which delivers a static body and lets the browser's own network stack decide chunking) — confirmed the old logic fails exactly as hypothesized and the new logic fixes it
- Input contrast verified via Playwright's `colorScheme: 'dark'` context emulation — computed `color-scheme: light` and near-black text color on white background regardless of OS dark-mode preference
- Full 7-turn end-to-end regression under dark-color-scheme emulation: all 5 fields collected, confirmation gate and completion both correct, no raw `"__DONE__"`/`"__ERROR__"` text leaked into any displayed message, background-scroll lock and no-overlap layout from previous fixes both still hold
- Confirmed no desktop regression: input text color/contrast and overall layout screenshot both unchanged
- `tsc --noEmit` and `npm run lint` pass with zero new errors/warnings beyond the existing documented baseline
- All test sales leads created against the dev Supabase project during reproduction/verification deleted afterward

## 2026-07-08 (Sales chat: last assistant message rendering behind the CTA/composer on mobile)

### Fixed
- **The latest assistant message could render partially behind the fixed "Start free trial" CTA and message composer on mobile**, confirmed by the reporter after the streaming-truncation fix resolved the earlier flow-completion issue. Root cause: the scrollable messages container (`flex-1 overflow-y-auto`) had no `min-h-0`, and its sibling footer elements (CTA block, input row, privacy text) had no `shrink-0`. Per the flexbox spec, a flex item's automatic minimum size defaults to its *content* size, not zero — without `min-h-0`, some browser engines let the messages container's content push past its allotted share instead of shrinking to fit and scrolling internally, while the footer siblings render at their normal flow position regardless, visually overlapping the tail of the last message. This is engine-dependent flex resolution, which is exactly why it was never reproducible in this session's Chromium/WebKit desktop-emulation testing (previously suspected and ruled out in round 1, but that test only covered the un-scaled default state). Fixed by adding `min-h-0` to the messages container (the only element now allowed to flex/shrink) and `shrink-0` to every other direct child (header, CTA block, input row, privacy text), plus a touch of extra bottom padding (`pb-6` in place of the uniform `p-4`) so the last message always has clear breathing room above the CTA, not just zero-overlap.

### Verified
- Automated overlap check (precise `getBoundingClientRect()` comparison between the last message bubble and the CTA button, not just a visual screenshot check) run after every turn of a full conversation, across 5 configurations: standard mobile viewport (390×844), a smaller viewport (360×740), a larger Samsung-class viewport (412×915), and — critically, a new test angle this round — the same viewports with the root font-size scaled to 130% and 150% to simulate Android/Samsung "larger text" accessibility settings, which is a real, common factor in exactly this class of overflow bug that hadn't been tested before. Zero overlap detected in any configuration.
- Full 7-turn stress conversation (long opening message, all 5 fields, confirmation recap, "yes") at 130% font scale: zero overlap at any point, and the background-scroll lock from the previous fix still holds throughout
- Confirmed no desktop regression: screenshot pixel-equivalent to pre-fix layout
- `tsc --noEmit` and `npm run lint` pass with zero new errors/warnings beyond the existing documented baseline
- All test sales leads created against the dev Supabase project during reproduction/verification deleted afterward

### Known limitation
- WebKit (closest available proxy for Samsung Internet/mobile Safari rendering) could not be tested this round — its Windows installer failed with a permission error (`EPERM` writing `Playwright.exe`), most likely a local antivirus/security-software conflict unrelated to the site itself. Chromium testing across 5 configurations including aggressive font-scaling was thorough, and the fix itself (`min-h-0` + `shrink-0`) is a standards-based flexbox correction rather than an engine-specific workaround, but this is still not a real-device confirmation.

## 2026-07-08 (Sales chat: real cause of mobile message clipping found — silently-truncated streams; verified field collection against live production)

### Fixed
- **Root cause of mobile message clipping found: an interrupted stream (connection dropped before the server's `__DONE__` completion sentinel arrived) left whatever partial text had streamed in permanently displayed as if it were the finished reply, with no error and no recovery.** `SalesChatWidget.tsx`'s read loop only checked for `__DONE__`/`__ERROR__:` markers inside received chunks — if `reader.read()` ever resolved with `done: true` *without* one of those markers ever showing up (a dropped or reset connection, far more likely on real mobile cellular than on any stable desktop/localhost connection, which is why two prior rounds of CSS/scroll-based fixes never reproduced it), the loop just exited and the truncated text stayed on screen. Confirmed with a deterministic test: intercepted the API response and served a truncated body with no sentinel — the old code left it stuck exactly as described ("Could you please share your name to proceed with book..."). Fixed by tracking whether the sentinel was actually seen; an incomplete stream now retries once automatically (transparently, before the user sees anything), and only falls back to a visible "that reply got cut off, please try again" if the retry also fails — never silently shows partial text as final.
- Refactored `handleSend`'s inline fetch/stream logic into a separate `streamAssistantReply` function to support the retry without duplicating the read loop; behavior for the normal (non-interrupted) path is unchanged.

### Investigated, not changed
- **Re-verified the field-collection logic directly against the live production API** (`https://niteowlhq.com/api/sales/chat`, bypassing the browser entirely) after the user reported the booking flow was still not collecting all fields on their real device. Walked a full conversation through curl: name → email → phone → company → preferred time were all correctly requested in order by the currently-deployed production code. Also confirmed the previous scroll-lock and field-collection fixes are present in the live client JS bundle (`visualViewport` and `position:"fixed"` both found in the deployed chunks). This rules out the server-side logic and the deployment itself as the cause — the "fields not collected" symptom was very likely a downstream effect of the same clipping bug: if the question asking for the next field gets cut off, the flow looks broken even though the server is asking correctly.

### Verified
- Deterministic reproduction of the exact clipping bug via Playwright route interception (served a response body with no `__DONE__` sentinel) — confirmed the OLD code left the truncated text stuck permanently, and the NEW code transparently retries and shows the complete message with no visible glitch
- Verified the double-failure fallback path (both attempts truncated): exactly 2 total requests (no retry loop), and a clear error message shown instead of raw truncated text
- Full end-to-end regression: all 5 fields collected in order, confirmation-gate recap shown, "yes" correctly completes the booking, and the background-scroll lock from the previous fix still holds — all with the new retry logic in place
- `tsc --noEmit` and `npm run lint` pass with zero new errors/warnings beyond the existing documented baseline
- All test sales leads created against the dev Supabase project during reproduction/verification deleted afterward

### Known limitation / follow-up needed
- One test lead (`priya@brightsmiles.co.uk`, "Bright Smiles Dental") was created in the **real production** database while verifying field-collection logic directly against `https://niteowlhq.com`. It was left incomplete (never reached the confirmation step, so no notification email was sent) but was not deleted — `SUPABASE_SERVICE_ROLE_KEY` for production is a Vercel "sensitive" env var and cannot be read back via `vercel env pull` even by the project owner (confirmed empty on pull, consistent with the 2026-07-06 finding). Needs manual deletion via the Supabase dashboard or `/admin/sales-leads`.
- Still no independent confirmation from a real native screen recording (not a camera pointed at a monitor) that this specific fix resolves the clipping on the reporter's actual device — this fix is shipped because the root cause is now concretely identified and deterministically reproduced/fixed (not inferred), which is a materially stronger basis than the previous two rounds, but real-device confirmation is still the definitive test.

## 2026-07-08 (Sales chat: background page scrolled behind the open widget; further mobile clipping investigation)

### Fixed
- **The page behind the sales chat widget scrolled freely while the widget was open, instead of staying locked to whatever was behind it.** Confirmed directly via a real screen recording of the deployed site (owner testing on a real device) showing the background hero/testimonial content changing position while the chat panel stayed still, then reproduced precisely in an automated test: `window.scrollY` moved from 800 to 1300 in response to a wheel-scroll gesture with the chat open, because nothing in `SalesChatWidget.tsx` ever locked page scroll — the panel is `position: fixed`, which only pins the panel itself, not the page underneath it. Fixed using the standard fixed-position-plus-restore body lock (save `scrollY`, pin `body` at `position: fixed; top: -{scrollY}px`, restore and re-scroll to the saved position on close) rather than plain `overflow: hidden`, which doesn't reliably block scroll/touch bleed-through on mobile Safari/Chrome. Re-verified with the same automated reproduction: wheel-scroll while open now has zero effect on `scrollY`, and closing the widget restores the exact prior scroll position.
- **Investigated the reported mobile message-clipping further** but could not get a clean, reproducible repro of a message getting permanently stuck cut off — instrumented scroll-state polling every 100ms through a full streamed conversation (157 samples) found the message list correctly at the bottom (0px gap) throughout, aside from one isolated ~20px transient that self-corrected within ~100ms. Applying the background-scroll lock above is a plausible fix for this too: without it, the page moving under the user's touch on a real phone can trigger the browser's own address-bar show/hide, an additional source of viewport instability uncorrelated with new message content that the existing `messages`-keyed scroll effect couldn't anticipate. Flagged in CHECKLIST as still needing a real-device confirmation.

### Verified
- Reviewed the actual screen recording provided (`ffmpeg`/`playwright` installed via `winget`/`npm` locally to extract and inspect frames, since no video-capable tool was otherwise available) — note: the recording is of a narrowed *desktop* browser window filmed with a phone camera (visible Windows taskbar, browser tab bar, and mouse cursor throughout), not native mobile Chrome/Samsung Internet rendering. The background-scroll bug is confirmed and viewport-independent regardless; the clipping claim couldn't be independently confirmed from this recording or from automated testing at any viewport size.
- Automated reproduction of the scroll-lock bug and fix, both before (`scrollY` 800→1300 on background wheel-scroll while open) and after (locked at 0, restored to 800 on close)
- Confirmed no desktop regression: background page scroll works normally before opening and after closing the widget; desktop screenshots pixel-equivalent to pre-fix layout
- `tsc --noEmit` and `npm run lint` pass with zero new errors/warnings beyond the existing documented baseline
- All test sales leads created against the dev Supabase project during reproduction/verification deleted afterward

### Known limitation
- Message clipping is still not independently confirmed reproducible by this session — the fix applied is a well-reasoned, standard-practice change targeting the most likely shared root cause (unlocked background scroll → viewport instability), not a confirmed-fixed repro of the exact symptom. If it persists after this deploy, the next step should be a real-device screen *recording* (native screen capture, not a camera pointed at a monitor) with the exact timestamp of the clipping called out.

## 2026-07-07 (Sales chat: field collection could be derailed by objections; no confirmation gate before completing; mobile scroll robustness)

### Fixed
- **The previous same-day fix (auto-zoom input font size) did not fully resolve mobile message clipping, and the underlying scroll mechanism itself was fragile.** `SalesChatWidget.tsx` called `messagesEndRef.current?.scrollIntoView({behavior:"smooth"})` once per streamed token and again in a `finally` block — a smooth-scroll animation invoked dozens of times per second (or interrupted by an in-flight `visualViewport` resize from a mobile browser's address-bar collapse or on-screen keyboard) is not guaranteed to land at the true bottom. Replaced with a direct, non-animated `container.scrollTop = container.scrollHeight`, run from a `useEffect` keyed on `messages` (so it always runs after the DOM has committed the new content, not mid-render), plus a `window.visualViewport` `resize` listener that re-asserts scroll position whenever the visible viewport itself changes size. Could not reproduce the clipping in headless Chromium or WebKit (iPhone-emulated) at any viewport tested — mobile Safari's auto-zoom-on-focus and address-bar/keyboard viewport races aren't faithfully reproducible outside a real device — so this is a defensive fix for the documented failure mode, not a confirmed-fixed repro.
- **Sales chat field collection could be silently derailed by an objection, question, or tangential reply mid-flow.** Reproduced directly: after the visitor gave their name and was asked for email, replying "Honestly this sounds expensive, we already have a receptionist" got a good objection-handling reply — but it never asked for email again, dropping the pending field entirely. Root cause: `buildLeadStateSection`'s "next field to collect" hint was appended as a soft, easily-outweighed suggestion after the base prompt's much longer objection-handling/personalization/closing-CTA sections, so the model would satisfy those instead. Rewrote the state section in `src/app/api/sales/chat/route.ts` as an explicit override ("this overrides every other instruction above for this reply") that permits a brief one-sentence answer to the objection but requires the reply to still end by asking for the pending field. Re-verified: the same objection now gets answered and is immediately followed by the email request.
- **A demo request could be marked complete and trigger the team notification the instant the fifth field arrived, with no chance for the visitor to correct a typo'd email or phone number first.** Added a deterministic confirmation gate in `captureSalesLead` (`src/lib/salesLeadCapture.ts`): reaching all five fields for the first time now recaps them and asks the visitor to confirm, without changing `status` to `"complete"` or sending the notification. Only an explicit affirmative reply (checked via `AFFIRMATION_PATTERN`, anchored to the start of the message so a correction like "Actually my email is..." is never misread as a "yes") flips it to complete. A correction instead of a confirmation re-shows the recap with the corrected value and stays open. This required no DB schema change — confirmed via direct testing against the dev project that `sales_leads.status` has a CHECK constraint allowing only `new`/`complete`/`contacted`, so the "awaiting confirmation" state is derived in code (comparing the field-completeness before vs. after this turn) rather than stored as a new status value.

### Verified
- Reproduced the objection-derailment bug against the dev Supabase project before fixing (name → email requested → objection raised → email never re-requested), then re-ran the identical scenario post-fix and confirmed the objection is answered and the pending field is still asked
- Ran a full 6-field conversation end-to-end post-fix: correctly recapped all details once complete, stayed at `status: "new"` / `notification_sent: false` until an explicit "yes" was given, then flipped to `status: "complete"` / `notification_sent: true` only on confirmation
- Tested a correction at the confirmation step ("Actually my phone number is wrong, it should be...") — confirmed it updates the field, re-shows the recap, and does not mark the lead complete or send the notification
- Tested 3 independent fresh conversations with varied opening messages — all consistently asked for name first per the documented order, no case observed asking for company name first
- Headless-Chromium and WebKit (iPhone-13-emulated) screenshots of full multi-turn conversations confirm no visual regression on mobile or desktop, and that the container correctly auto-scrolls to bottom after every fix iteration tested
- `tsc --noEmit` and `npm run lint` pass with zero new errors/warnings beyond the existing documented baseline
- All test sales leads created against the dev Supabase project during reproduction/verification deleted afterward

### Known limitation
- The mobile clipping fix could not be verified on an actual physical mobile device or browser — only headless Chromium and Playwright's WebKit engine (which does not fully replicate real iOS Safari's auto-zoom-on-focus or address-bar/keyboard viewport behavior) were available. If clipping is still observed after this deploy, it needs to be reproduced on a real device to identify what headless testing is missing.

## 2026-07-07 (Sales chat: stale completed leads resurfacing as false confirmations; mobile input auto-zoom)

### Fixed
- **Sales chat demo capture could confirm a booking it never actually collected in the current conversation.** `SalesChatWidget.tsx` persists its `conversationId` in `localStorage` indefinitely — it never rotates once a demo lead is marked `complete`. `findByConversationId`/`findByContact` in `src/lib/salesLeadCapture.ts` matched on that id (or on email/phone) with no status filter, so a visitor returning later to ask about a new or second demo matched their old, already-`complete` lead row and Remy treated all of its fields — including a stale `preferred_demo_time` from the earlier session — as still valid for the new request. Reproduced directly: completed a full demo capture (name/email/phone/company/time), then reused the same conversation id to ask for a demo again — Remy replied "I see Tuesday afternoon works for you" and moved straight to confirmation without asking anything in the new conversation. Fixed by gating both lookups to `status = "new"` (`OPEN_SALES_LEAD_STATUSES`), mirroring the existing "closed statuses start a fresh lead" rule already used for real bookings in `src/lib/leadCapture.ts`. A completed lead's conversation id (or contact details) no longer matches; a later demo request now starts a fresh lead and Remy asks for each field again, in order.
- **Mobile message clipping in the sales chat widget was still reproducible after the earlier `h-dvh` panel-height fix.** Root cause was different from what that fix addressed: the message input (`SalesChatWidget.tsx`) is `text-sm` (14px), which is under iOS Safari's 16px auto-zoom-on-focus threshold — tapping the input zooms the whole page in, pushing chat content out of the visible frame on a real phone. Not reproducible in headless Chromium (no auto-zoom-on-focus behavior), so confirmed via direct knowledge of the documented Safari behavior rather than a browser repro. Fixed by bumping the input to `text-base` (16px) below the `sm` breakpoint only (`text-base sm:text-sm`) — desktop keeps its existing 14px input unchanged.

### Verified
- Reproduced the stale-lead bug against the dev Supabase project before fixing: completed a full 5-field demo capture, then reused the same conversation id to request a second demo — got a fabricated "I see Tuesday afternoon works for you" confirmation with no fields actually asked for in the new conversation
- Re-ran the same scenario post-fix: the second demo request now correctly starts over and asks for name → email → phone → company → time in order, never claiming a field the visitor hadn't given this time
- Full happy-path (single conversation, all 5 fields given once) still completes correctly end-to-end post-fix, confirming the status gate doesn't affect normal in-progress resume behavior
- Headless-Chromium screenshots (390×844 mobile, 1280×800 desktop) of a real multi-turn conversation confirm no visual regression and correct auto-scroll-to-bottom on both; desktop screenshot confirmed pixel-equivalent to pre-fix layout
- `tsc --noEmit` and `npm run lint` pass with zero new errors/warnings beyond the existing documented baseline (`CalendarView.tsx` unused var, `api/chat/route.ts` unused var, `onboarding/page.tsx` unused var, `ConversationView.tsx`'s deliberately-deferred `react-hooks/set-state-in-effect`)
- All test sales leads created against the dev Supabase project during reproduction/verification (7 rows, `company: "Acme Plumbing"`) deleted afterward

## 2026-07-06 (Real root cause of the production email failure: RESEND_FROM_EMAIL was never actually updated)

### Fixed
- **Booking confirmation and sales lead notification emails were failing in real production with a Resend "testing mode" validation error, even after the Supabase-project fix and the `after()` fix.** Traced this precisely rather than guessing: added temporary logging of the Resend SDK's actual send outcome, which revealed `resend.emails.send()` resolves with `{ data, error }` on API-level failures instead of throwing — every call site's `try/catch` was blind to this, silently treating a rejected send as success. Fixed by checking the `error` field explicitly (`src/lib/email.ts`, new shared `sendChecked()` helper).
- That fix surfaced the real underlying error message directly: `RESEND_API_KEY`'s account had no verified domain. Suspected (wrongly, at first) that Vercel's production key was for a different Resend account entirely, and updated it to match `.env.local`'s — this didn't fix it. Added one more round of minimal diagnostic logging (last 6 characters of the key, plus the resolved `FROM_EMAIL` — never the full secret) and found the real, much simpler cause: **`RESEND_FROM_EMAIL` in Vercel's production environment was still `onboarding@resend.dev`**, the Resend sandbox sender, which is always testing-mode-restricted regardless of which account or key sends from it. It had only ever been added as a sibling of the new `ADMIN_EMAIL`/`SALES_NOTIFICATION_EMAIL` variables, never actually edited itself — exactly the same class of mistake as the earlier "single Supabase instance" assumption. Updated directly in Vercel to `remy@mail.niteowlhq.com`.

### Verified
- Full real production end-to-end test, post-fix: a real widget booking correctly stored the right date (Next.js `after()` fix from earlier in the day) *and* both confirmation emails sent from `remy@mail.niteowlhq.com` and were confirmed `delivered` via Resend's own API (not just "accepted")
- A full sales-chat demo capture also completed correctly end-to-end against real production: all 5 fields captured, `sales_leads` row landed with `status: complete`, and the team notification email delivered
- All temporary diagnostic logging removed once each root cause was confirmed
- All test leads/conversations/sales_leads created during this investigation removed from the real production database; the two pre-existing organisations (`Verification Plumbing Co`, `Niteowl Test`) and their prior history were left untouched
- `tsc --noEmit` and `npm run lint` pass with zero new errors/warnings beyond the existing documented baseline
- `/privacy`, `/terms`, `/admin/sales-leads` (unauthenticated redirect), and `/api/health` all confirmed live and correct on the current production deployment

## 2026-07-06 (Critical: real production was a different, un-migrated Supabase project; fire-and-forget emails fixed)

### Fixed
- **Real production (niteowlhq.com) was running against an entirely different Supabase project (`sklcqvvnuigpewzarbiv`) than the one referenced everywhere in local `.env.local` and in every "verified against production" claim made earlier in this session (`kioljdihgbcboxlnwghv`).** Discovered while investigating why the newly-deployed sales chat couldn't write to `sales_leads` in production — confirmed decisively by creating a test org in the `.env.local` project and confirming the real widget route rejected its widget key outright. This means the billing migration (`organisations.subscription_status`, `trial_ends_at`, etc.) had also never reached real production — every widget/dashboard chat request was failing at the very first org lookup query, since it explicitly selects those columns. **The core product was completely non-functional in real production before this fix**, for any business that had tried to use it (though no real pilot businesses had onboarded yet — only 2 old verification/test orgs existed there). Reconstructed the billing migration directly from the application code (`src/lib/billing/access.ts`, `src/lib/billing/stripe.ts`) since no version-controlled migration file exists, and re-ran the `sales_leads` migration against the correct project. Both existing orgs grandfathered to `active`, matching the original migration's behaviour.
- **Booking confirmation emails and self-service cancel/reschedule notifications were fire-and-forget (`.catch()` with no `await`), which is unsafe on Vercel's serverless runtime** — the function can freeze immediately after the response is sent, killing any still-pending unawaited work. This worked reliably in local `npm run dev` (a long-lived process) but silently failed in real production: a real end-to-end booking test correctly stored the right appointment date but never sent either confirmation email, with no error logged anywhere. Wrapped all four fire-and-forget call sites (`src/lib/leadCapture.ts` ×2, `src/app/api/bookings/manage/route.ts` ×2) in Next.js's `after()`, which guarantees the work completes regardless of when the response is returned. `sendNeedsReviewNotification` and `sendSalesLeadNotification` were already correctly `await`ed and were not at risk.

### Verified
- Confirmed which Supabase project production actually uses by extracting `NEXT_PUBLIC_SUPABASE_URL` directly from the compiled JS bundle served by the real login page — `NEXT_PUBLIC_*` vars are baked into client-side JS by design, so this needed no special access
- Re-ran the full end-to-end booking test against the corrected production project post-migration: correct date stored, and (pending redeploy) confirmation emails now expected to send reliably via `after()`
- `tsc --noEmit` and `npm run lint` pass with zero new errors/warnings beyond the existing documented baseline

### Process note
- Vercel env vars marked "sensitive" cannot be read back via `vercel env pull` or the dashboard, even by the project owner — this is a deliberate write-only security feature, not a bug, but it means env var *values* can't be diffed this way; `vercel env ls` still shows names/scopes/last-modified times, which is how the fact that `RESEND_FROM_EMAIL` was never actually edited (only `ADMIN_EMAIL`/`SALES_NOTIFICATION_EMAIL` were new) was caught

## 2026-07-06 (Privacy Policy & Terms of Service)

### Added
- `/privacy` and `/terms` pages (`src/app/privacy/page.tsx`, `src/app/terms/page.tsx`) — tailored to what NiteOwl actually collects and processes (Customer accounts, End User chat/booking data, the OpenAI/Supabase/Resend/Stripe/Vercel/Sentry sub-processor list), not generic boilerplate. Matches the site's existing dark theme; not a substitute for a real legal review, but a specific, accurate first draft
- Linked from the footer and the signup page's existing agreement notice (both already referenced `/privacy` and `/terms` before the pages existed — this closes that gap), plus two new placements: a small "By chatting, you agree to our Privacy Policy" notice in the NiteOwl sales chat (`SalesChatWidget.tsx`), and a "Powered by NiteOwl AI · Privacy Policy" line in the embeddable customer-facing widget (`public/widget.js`) — using an absolute URL there, since that widget renders on third-party business websites and a relative link would have pointed at the host site's own (nonexistent) `/privacy` page

### Verified
- Both pages render correctly and are reachable from the footer and signup notice
- Sales chat privacy notice renders and links correctly
- Widget.js privacy link resolves to an absolute `niteowlhq.com` URL even when embedded on a simulated third-party host page — confirmed via a standalone test host page
- `tsc --noEmit` and `npm run lint` pass with zero new errors/warnings beyond the existing documented baseline

## 2026-07-06 (Resend custom domain live; critical booking-date bug found and fixed)

### Fixed
- **Critical: relative booking times ("tomorrow at 2pm", "next Friday") could be silently booked on the wrong date.** `src/app/api/widget/chat/route.ts`'s `extractLeadData()` prompt had drifted out of sync with `src/app/api/chat/route.ts`'s — despite a code comment claiming the two are identical, the widget's copy was missing the explicit `preferred_datetime: Return the value exactly as the customer said it` rule and all few-shot examples. Without that instruction, the model resolved relative phrases itself using its own internal (stale, training-data-anchored) sense of "today" *before* the value ever reached `parseDatetimeToIso()` — which correctly receives the real current date, but by then was just reformatting an already-wrong absolute timestamp. Reproduced directly: "tomorrow at 2pm" extracted as `2023-10-04T14:00:00`. Fixed by resyncing the widget's prompt to match the dashboard's (which already had the correct instruction). This is the customer-facing widget path — the one real pilot businesses' actual customers use — so this was live in production.
- Switched the production email sender from Resend's `onboarding@resend.dev` sandbox (which silently redirected every send to the account owner regardless of recipient) to the newly verified `remy@mail.niteowlhq.com`. Registered a dedicated sending subdomain with Resend rather than the root `niteowlhq.com`, specifically to avoid conflicting with the root domain's existing live MX/SPF records for `hello@niteowlhq.com` forwarding.

### Verified
- Reproduced the datetime bug via a direct, isolated call to the exact extraction prompt before fixing it, then confirmed the fixed prompt correctly preserves the raw phrase; re-ran a full booking end-to-end through the live widget route post-fix and confirmed the stored `appointment_datetime` in Supabase resolved to the correct real date (2026-07-07 for "tomorrow" asked on 2026-07-06)
- Audited all 18 existing production leads with a stored `appointment_datetime` for the same corruption pattern (appointment date earlier than the lead's creation date) — zero affected; the bug did not corrupt any live customer data before being caught
- Domain verification: DNS records added at Porkbun for `mail.niteowlhq.com` (DKIM TXT, SPF TXT, SPF-feedback MX) took two attempts — the MX record didn't save correctly the first time. Confirmed live via `dig`-equivalent checks against all four of Porkbun's own authoritative nameservers plus Google/Cloudflare public resolvers, and empirically via a real end-to-end test send that arrived with both SPF and DKIM passing
- Post-switch, re-ran a real booking through the live widget route and confirmed both the customer confirmation and business-owner notification emails were sent from `remy@mail.niteowlhq.com` (checked via the Resend API's own send log, not just assumed)
- `tsc --noEmit` and `npm run lint` pass with zero new errors/warnings beyond the existing documented baseline
- All disposable test data (test org, test auth user, test leads/conversations) removed after verification

### Requires action
- `RESEND_FROM_EMAIL` updated in local `.env.local` only — **must be updated in Vercel's production environment variables** before this takes effect in production

## 2026-07-06 (Pre-alpha security & reliability audit)

### Fixed
- **HTML injection in every transactional email** (`src/lib/email.ts`, all four send functions). Customer/visitor-supplied text (chat questions, names, phone numbers, sales-lead fields) was interpolated directly into HTML email bodies with no escaping — a message like `Need a quote<a href="...">Sign in</a>` sent through the public widget chat would render as live HTML in the "Customer enquiry requires review" email landing in a real business owner's inbox, a phishing vector against NiteOwl's own notification system. Added a shared `escapeHtml()` helper, applied to every interpolated value across all four functions (booking confirmations, needs-review notifications, self-service cancel/reschedule notifications, sales lead notifications).
- **`/api/chat` still wrote leads and read another org's knowledge base using the raw, unverified client-supplied `orgId`**, even though the 2026-07-06 "AI-call reliability bundle" entry below added an ownership check to the org *lookup*. That fix made `org` correctly resolve to `null` for a spoofed `orgId`, but nothing then stopped execution — the lead-capture block and `business_knowledge` query still ran against the raw `orgId`, relying entirely on Supabase RLS (not verifiable from this repo) as the only remaining defence. Gated the entire lead-capture/confidence-check block on `org` being non-null (`src/app/api/chat/route.ts`); the existing generic-assistant fallback reply for a missing org is unaffected.
- **`/api/chat` (the authenticated dashboard preview chat) had no rate limiting**, unlike `/api/widget/chat` and `/api/sales/chat`. Since signup requires no card, a scripted loop against this route with a real session could run up unbounded OpenAI costs — the same abuse pattern the widget route was already hardened against. Added the same `checkRateLimit` pattern, keyed per user.
- **No rate limiting on `/api/bookings/manage`** (public, token-authenticated). A leaked or guessed `manage_token` allowed unlimited reschedule/cancel calls, each firing an owner-notification email with no throttle. Added per-IP and per-token limits, matching the widget route's dual-key shape.
- **SSRF hardening gap in `/api/widget/verify-install`**. The disallowed-host check only pattern-matched the literal hostname string against private IP ranges — it never resolved DNS before fetching (so a hostname that resolves to an internal address or the cloud metadata IP `169.254.169.254` via DNS rebinding sailed through), and `redirect: "follow"` meant a page that simply 302'd to an internal URL bypassed the check entirely regardless of the original host. Now resolves and checks every hop (initial host + each redirect, up to 3) against private/loopback/link-local ranges for both IPv4 and IPv6 (including the `::ffff:`-mapped IPv4 bypass), and caps the response body read at 2MB.

### Verified
- Full multi-file audit of `src/` (all API routes, lib helpers, dashboard/admin pages) run ahead of external alpha; findings cross-checked against CHANGELOG/CHECKLIST to exclude already-tracked issues (ChatShell remount, hydration #418, Resend sandbox sender)
- Standalone test of the new SSRF logic against 10 cases (private ranges, cloud metadata address, the IPv4-mapped-IPv6 bypass attempt, and real public domains) — all correct
- `/api/chat`, `/api/bookings/manage`, `/api/widget/chat` all still respond correctly (401/429 where expected) after the fixes; live-fired a 25-request burst at `/api/bookings/manage` and confirmed the rate limit engages after the 10th request for the same token
- `/api/sales/chat` produces an unchanged, on-brand reply after the shared `email.ts` rewrite, confirming no regression to the unrelated sales chat feature
- `tsc --noEmit` and `npm run lint` both pass with zero new errors/warnings beyond the existing documented baseline (`CalendarView.tsx` unused var, `api/chat/route.ts` unused var, `onboarding/page.tsx` unused var, `ConversationView.tsx`'s deliberately-deferred `react-hooks/set-state-in-effect`)

### Not fixed (flagged, low priority)
- `/api/leads` (GET/POST/PATCH) has zero callers anywhere in the app — `LeadsTable.tsx` updates leads via a direct RLS-scoped browser call instead — and its `PATCH` status whitelist is missing `needs_review`/`awaiting_confirmation`/`cancelled`. Unreviewed, unused attack surface; left in place pending a decision to wire it up properly or delete it.

## 2026-07-06 (Sales chat assistant — Alpha conversion feature)

### Added
- New NiteOwl sales chat assistant on the marketing landing page (`src/app/SalesChatWidget.tsx`, `src/app/api/sales/chat/route.ts`) — a persuasive, outcomes-first sales conversation aimed at converting website visitors into signed-up businesses. Deliberately separate from Remy-as-receptionist (`/api/chat`, `/api/widget/chat`): different persona, different audience, no org/booking/knowledge-base involved
- Dedicated objection handling for the five most common pushbacks ("I already have a receptionist", "we're too small", "it's too expensive", "we're too busy", "why not just hire a receptionist") — recognised even when paraphrased, each reframed into a reason to buy rather than deflected
- Industry personalization: infers the visitor's trade from conversation, asks one clarifying question if genuinely unknown, then reasons out realistic industry-specific missed-enquiry examples — a reusable prompt structure, not a hardcoded per-industry script (verified against plumber, dentist, solicitor, electrician, accountant, restaurant, and an unlisted example — dog grooming — to confirm it generalises)
- Structured, validated, one-field-at-a-time demo lead capture (name → email → phone → company → preferred demo time), backed by a new `sales_leads` table and `src/lib/salesLeadCapture.ts` — regex-validates each field before accepting it, re-asks on invalid input, allows corrections mid-flow, and merges by conversation then by contact details so a returning prospect in a new browser session never creates a duplicate row
- `sendSalesLeadNotification()` (`src/lib/email.ts`) emails the NiteOwl team once a lead is complete, deduplicated via a `notification_sent` flag
- New admin-only `/admin/sales-leads` page — gated by `user.email === process.env.ADMIN_EMAIL`, reads via the service-role client (the table has RLS enabled with zero policies, so no session can query it directly regardless of login)
- Persistent "Start free trial" CTA inside the chat window; prompt logic distinguishes a visitor who's ready now (pointed straight at the trial, no lead form) from one who wants a demo first (routed into the field-collection flow above)

### Fixed (caught during this feature's own testing)
- A returning visitor in a new browser session who gave contact details matching an existing complete lead was getting a duplicate row instead of merging — the first message of any new conversation inserted a row immediately, which then shadowed the contact-based match on the next message. Fixed by not creating a row until a field is actually extracted.
- The demo-detail collection previously also triggered on "I want to sign up" — sending a ready-to-buy visitor through five questions before pointing them at the (already available) self-serve trial. Scoped the five-field collection to genuine demo/contact requests only.

### Verified
- Multi-turn scripted conversations against the live API for every step: persuasive/outcome-first framing, all 5 objections, 6 industries plus one unlisted one, full sequential capture including a deliberately invalid email (rejected and re-asked) and a mid-flow name correction, cross-session duplicate merge (confirmed via direct DB query — exactly one row), and both CTA paths (ready-now vs. wants-a-demo)
- Admin page's unauthenticated redirect confirmed directly; the authenticated render was verified via a Supabase-admin-API-minted session rather than the real password (which isn't available to the assistant) — owner should do one manual pass per the test steps already given
- `tsc --noEmit` and `npm run lint` pass with no new errors/warnings

### Requires action before deploy
- `ADMIN_EMAIL` and `SALES_NOTIFICATION_EMAIL` were added to local `.env.local` only — must be added to Vercel's production environment variables or the admin page denies everyone and lead notifications silently no-op in production
- Sales lead notification emails inherit the existing Resend sandbox-sender limitation (tracked below) — not a new issue, just not yet fixed for this path either

## 2026-07-06 (AI-call reliability bundle)

### Fixed
- **No OpenAI call anywhere had a timeout.** A hang or slow response from OpenAI (routine, not hypothetical) would previously leave a request running until the platform's own function timeout killed it, with no fallback message — directly threatening the "never miss a customer enquiry" promise. Added `AbortSignal.timeout()` to every OpenAI call: 15s on the quick lead-extraction/confidence/datetime-parsing calls (`src/app/api/chat/route.ts`, `src/app/api/widget/chat/route.ts`, `src/lib/leadCapture.ts`, `src/lib/parseDatetime.ts`), 30s on the two streaming reply calls. All of these already had `try/catch` with a graceful fallback (`EMPTY_LEAD`, `needsReview: false`, `iso: null`, or a streamed `__ERROR__` sentinel) — the timeout now actually triggers that existing fallback instead of hanging forever.
- **Dashboard preview chat's `streamChat()` (`src/lib/chat.ts`) had no error handling at all**, unlike `public/widget.js` which already wrapped its fetch/stream loop in `try/catch/finally`. A dropped connection or timeout threw an unhandled rejection, leaving `streaming` stuck `true` and the input permanently disabled — violating the project's rule that dashboard preview and widget must behave identically. Now guarantees exactly one of `onDone`/`onError` fires, matching `widget.js`'s pattern; added a client-side 90s backstop timeout on the `/api/chat` fetch itself, set comfortably above the server's own ~60s worst-case sequential budget (15s extraction + 15s datetime parsing + 30s streaming) so it only fires on a genuine full-stack hang, not a slow-but-healthy request.
- **`/api/chat` trusted a client-supplied `orgId` with no ownership check**, unlike every other authenticated route in the codebase. Added `.eq("owner_id", user.id)` to the org lookup — a spoofed `orgId` for another organisation now correctly resolves to no data instead of leaking that org's identity/knowledge into the reply or writing leads into their CRM.
- Deleted the dead `/api/parse-datetime` route — unauthenticated, unrate-limited, called by nothing in the app, and calling OpenAI on every hit. The shared `parseDatetimeToIso()` function it wrapped is unaffected; server code already calls it directly.

### Verified
- End-to-end against two real disposable test orgs (real auth, real Supabase, deleted afterward): a spoofed cross-tenant `orgId` request no longer receives the target org's paused-billing behavior (proving the ownership check works); a legitimate same-org request is unaffected; the dead route now 404s; simulating a dropped `/api/chat` connection via network-level abort correctly re-enables the dashboard preview chat input with zero unhandled page errors (previously would have left it stuck)
- A follow-up audit caught the client-side timeout (originally 45s) as too short relative to the server's own worst-case sequential latency (~60s), which could abort a legitimate slow request before the server's own graceful fallback ever got a chance to respond — corrected to 90s and re-verified
- `tsc --noEmit`, `next build`, and `npm run lint` all pass with zero new errors/warnings beyond the existing documented baseline (1 pre-existing lint error, 5 pre-existing warnings)

### Known residual (not fixed, low severity, deferred)
- `ChatShell.tsx` remounts `ConversationView` (via `key={activeId ?? "empty"}`) the moment a brand-new conversation is created from the empty state. If the AI call fails on that very first message, `onError` fires after the remount and sets state on an already-unmounted instance, so the error toast silently doesn't render for that one specific case — the input still works fine (the fresh instance mounts clean), so there's no stuck state, just a missed notification. Fixing this properly means revisiting `ChatShell`'s remount-on-conversation-switch strategy, which is a small architectural decision better made deliberately than folded into this bundle.

## 2026-07-06 (Widget installation guide)

### Added
- Professional widget installation guide at `Settings → Website Widget` (`src/app/(dashboard)/settings/widget/WidgetInstallGuide.tsx`), covering WordPress, Wix, Squarespace, Shopify, Webflow, plain HTML, and Google Tag Manager — each with copy-paste-ready numbered steps and a shared embed snippet with a one-click copy button
- Troubleshooting accordion covering the most likely install failure modes: forgetting to republish (Webflow/Wix/Squarespace/GTM all require a separate publish step), page-level vs site-wide placement, ad blockers, and CSP restrictions
- **Live "verify installation" check**: enter a URL and the server fetches that page and confirms whether the widget script and the correct widget key are actually present, rather than the business owner having to guess or wait for a customer to report it broken. New endpoint: `POST /api/widget/verify-install` — authenticated, derives the org strictly from the session (never a client-supplied org id), and rejects localhost/private-IP targets to keep this from becoming an open fetch proxy

### Verified
- End-to-end against a disposable test org (real signup, onboarding, Supabase, deleted afterward): all 7 platform tabs render with correct content, copy button works, troubleshooting accordion expands, and the verify check correctly reports "not confirmed" for a real external page with no widget installed
- `tsc --noEmit`, `next build`, and `npm run lint` all pass with zero new errors/warnings beyond the existing documented baseline (1 pre-existing lint error, 5 pre-existing warnings)

## 2026-07-06 (Stripe migration applied to production; full-app adoption review)

### Database
- Applied the billing migration (`organisations.subscription_status`, `trial_ends_at`, `payment_provider`, `stripe_customer_id`, `stripe_subscription_id`, `current_period_end`) to Supabase via `supabase db push`. Confirmed via a live query that this is a single Supabase project shared by dev and production (real pilot business rows returned), and that all existing orgs were correctly grandfathered to `subscription_status = 'active'`
- Pushed the Stripe billing commit to GitHub; Vercel production deploy built successfully. Smoke-tested: homepage 200, `/api/health` reports DB connectivity OK, `/settings/billing` correctly redirects unauthenticated visitors. Stripe test API keys still need to be added before checkout/portal/webhooks can be exercised (tracked in CHECKLIST.md)

### Reviewed
- Full-app review from a paying business's perspective (security/reliability + product/UX/adoption gaps), requested ahead of building the widget installation guide. Found the installation guide was no longer the single highest-priority item — three issues below outranked it and were fixed first

### Added
- **Persistent dashboard navigation** (`src/components/dashboard/DashboardNav.tsx`, `src/app/(dashboard)/layout.tsx`) — Dashboard, Chat Preview, Knowledge Base, Leads, Calendar, and Settings are now reachable from every page via a sidebar. Previously there was no persistent nav at all (each page was a standalone screen with only a "back to dashboard" breadcrumb), and Leads and Calendar specifically had **no link anywhere in the UI** — a business owner could not reach the CRM or Calendar without guessing the URL, directly undermining the "never miss an enquiry" pitch since the capture destination was invisible. This is the second time this exact bug shape was found (Knowledge Base was the first, patched 2026-07-05 with one dashboard card); the persistent nav closes the whole bug class instead of adding another one-off card
  - Moved `onboarding` out of the `(dashboard)` route group (`src/app/onboarding/`, same URL) so the wizard stays nav-free, since a business mid-signup has no org yet
  - `src/app/(dashboard)/settings/layout.tsx` restructured from a full-page shell with its own sidebar into slim in-page tabs (Business Hours, Website Widget, Billing — the widget embed page is now a proper settings tab instead of an orphaned page), since it now nests inside the new global nav instead of duplicating it
- Rate limiting on the public `POST /api/widget/chat` (`src/lib/rateLimit.ts`) — 15 requests/60s per IP+widgetKey, 60 requests/60s per widgetKey alone. The widget is public and unauthenticated by design (`widgetKey` is visible in every customer site's HTML source), so a scripted client could bypass the widget UI, run up OpenAI costs (up to 3 calls per message), and flood a business's inbox with fake needs-review emails by minting a fresh client-supplied `conversationId` per request to dodge the per-conversation dedup. In-memory limiter, no new infra — sufficient to bound worst-case abuse cost for the current pilot scale

### Fixed
- **Appointment edits via the Leads/Calendar "Edit" panel silently did nothing.** Both `EditPanel` components (`src/app/(dashboard)/leads/LeadsTable.tsx`, `src/app/(dashboard)/calendar/CalendarView.tsx`) wrote a business owner's edited appointment time to `preferred_datetime`, but the Calendar's placement logic reads `appointment_datetime` exclusively — an owner correcting a booking got a "Saved ✓" confirmation while the calendar never moved. Now: once a lead has a confirmed `appointment_datetime`, the field edits that column via a proper `datetime-local` input (previously free text); leads with no confirmed appointment yet still edit `preferred_datetime` as before. Also fixed the same mislabeled read-only display (desktop table, mobile card, and Calendar's Contact section all showed `preferred_datetime` under an "Appointment" heading)

### Verified
- End-to-end against a disposable test org (real signup, real onboarding, real Supabase, deleted afterward): persistent nav renders correctly with no layout breakage (no double sidebars, no horizontal overflow, no console errors) across `/dashboard`, `/chat`, `/knowledge`, `/leads`, `/calendar`, `/settings/hours`, `/settings/billing`, `/settings/widget`
- Seeded a confirmed booking directly, edited its time via the Calendar `EditPanel`, and confirmed `appointment_datetime` in the database changed to the new value and the appointment chip moved to the new day on the calendar
- Hit `/api/widget/chat` 20 times in a row with the same widgetKey — first 15 returned 200, the remaining 5 returned 429
- `tsc --noEmit`, `next build`, and `npm run lint` all pass with zero new errors/warnings beyond the existing documented baseline (1 pre-existing lint error, 5 pre-existing warnings)

## 2026-07-05 (Stripe subscription billing — Phase 1, provider-agnostic)

### Added
- Recurring billing for Remy itself. Ranked against acquiring/converting/retaining paying customers, this came ahead of a business management dashboard, widget install guide, and CSV export because none of those generate revenue — without billing, there is no way to charge anyone at all
- **14-day free trial, no card required**, tracked entirely in our own database (`organisations.trial_ends_at`, defaulted at row creation) rather than via Stripe's trial mechanism — this keeps the trial provider-agnostic by construction, since it has nothing to do with which payment processor (if any) is eventually used
- Provider-agnostic billing architecture so PayPal (or any other processor) can be added later without touching checkout routes, webhook plumbing, or gating logic:
  - `src/lib/billing/access.ts` — `hasActiveAccess()`, the single function every gate checks; it only reads DB columns, never which provider is behind them
  - `src/lib/billing/provider.ts` — a `PaymentProvider` interface + factory; only `stripe` is registered in Phase 1
  - `src/lib/billing/stripe.ts` — the Stripe implementation (customer/checkout/portal session creation, webhook signature verification, event → org-row mapping) — the only file that knows Stripe exists
  - `src/lib/billing/pausedReply.ts` — shared "Remy is paused" streamed reply, matching the existing chunked `\n__DONE__` wire format both `/api/chat` and `/api/widget/chat` already use
- Stripe Checkout (hosted) for the actual subscription — cards (Visa/Mastercard/Amex/debit) and Apple Pay/Google Pay are enabled automatically with no extra code, controlled entirely by the payment methods turned on in the Stripe Dashboard
- New routes: `POST /api/billing/checkout`, `POST /api/billing/portal` (both authed, org-scoped), `POST /api/webhooks/stripe` (public, signature-verified)
- `/settings/billing` — trial countdown / subscription status, "Subscribe now" or "Manage billing" button
- Hard-block enforcement once a trial/subscription lapses: `middleware.ts` redirects dashboard routes to `/settings/billing`; `/api/chat` and `/api/widget/chat` reply with a paused message instead of calling OpenAI. Existing pilot businesses are grandfathered to `active` by the migration below so none of them are affected

### Database (must be run manually — no migrations folder in this repo, same convention as prior schema changes)
- `organisations` gains `subscription_status`, `trial_ends_at`, `payment_provider`, `stripe_customer_id`, `stripe_subscription_id`, `current_period_end`. SQL is additive plus one grandfathering `UPDATE` — provided separately, not committed, since it must be run in the Supabase SQL editor before this code can work at all

### Not yet verified — blocked on setup outside this repo
- **This must not be deployed before the migration SQL runs on the production database.** `/api/widget/chat` already treats a query error as an invalid widget key, so a missing column would 401 every real widget request until the columns exist
- No Stripe API keys exist in this project yet (test or live) — `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_PRICE_ID` placeholders added to `.env.local`, but checkout/portal/webhook have not been exercised against a real Stripe test account
- `tsc --noEmit`, `next build`, and `npm run lint` all pass with zero new errors/warnings beyond the existing documented baseline (1 pre-existing lint error, 5 pre-existing warnings)

## 2026-07-05 (Knowledge Base wasn't reachable after onboarding)

### Fixed
- Reported as "does the Knowledge Base management page exist?" — it already did (`src/app/(dashboard)/knowledge`, full create/edit/delete UI, matching the exact categories the AI prompt reads: FAQ, Service, Pricing, Opening Hours, Policy, Custom Instruction), so no new page or CRUD logic was built. The real gap: the *only* link to it was inside `SetupChecklist.tsx` on the main dashboard, which does `if (allComplete) return null` — once onboarding is finished, that checklist (and its only link to `/knowledge`) disappears. There is no persistent sidebar/nav anywhere in the dashboard; every page is a standalone screen with just a "back to Dashboard" breadcrumb
- Added a permanent "Knowledge Base" card to the main dashboard (`dashboard/page.tsx`), styled to match the existing "Chat with Remy" card, so it's reachable at any time regardless of onboarding-checklist state

### Verified
- `tsc --noEmit` and `next build` pass
- Fetched the rendered `/dashboard` HTML for a disposable test account and confirmed the Knowledge Base card renders with the correct link, alongside the existing Chat card; test user/org deleted afterward

## 2026-07-05 (investigated: sales FAQ escalation)

### Investigated, not a code bug
- Reported: Remy escalates standard sales questions ("How much does it cost?", "Is there a free trial?", "Can I cancel anytime?", "Can Remy integrate with my website?", "How long does setup take?", "Do I need technical knowledge?") for the "NiteOwl Test" dogfooding business instead of answering directly. Set up a disposable test org locally with knowledge base entries covering half these topics and confirmed Remy answers confidently and correctly once matching content exists — the confidence gate and system prompt already work as designed; there was no remaining code gap like the earlier business-identity/website ones
- Root cause is a content gap, not a code gap: the business's Knowledge Base has no entries for these topics, so Remy correctly declines to invent pricing/policy answers (per the "never invent prices, hours, services, or policies not listed" rule) and escalates instead
- Drafted and verified all six answers end-to-end against a disposable test org (real auth, real OpenAI, dev DB, deleted afterward) — three from the actual product (embed-script integration, ~15 min onboarding wizard, no technical knowledge needed) and three confirmed with the business owner (free during Alpha, no formal trial, no contract to cancel). Provided as ready-to-paste Knowledge Base entries since this session has no write access to the production database — added via Settings → Knowledge Base by the business owner, not via a code change

## 2026-07-05 (human handoff now keeps the lead instead of redirecting the customer)

### Changed
- When a customer asks to speak to a person, a team member, or for the business's contact details, Remy no longer deflects ("suggest the customer contacts the team", which the model was free to phrase as "check our website") — it now behaves like a receptionist taking a message: offers a callback and collects name, phone, email, and preferred contact time directly in the chat. Added as a new standing rule in `buildSystemPrompt` (both `/api/chat` and `/api/widget/chat`), since tracing showed this exact phrasing ("Can I speak to someone?") is usually classified as an answerable `question` intent and never reaches the low-confidence handoff path at all — the old generic "contact the team" rule was the only thing governing it
- Also hardened the existing low-confidence `HUMAN HANDOFF MODE` prompt block (used when the confidence gate does flag a message) to ask for a preferred contact time alongside name/email/phone, and to explicitly forbid pointing the customer elsewhere for contact details, for consistency with the new standing rule

### Verified
- `tsc --noEmit` and `next build` pass
- Traced the exact reported case first: "Can I speak to someone?" extracts as `question` intent and the confidence gate does not flag it for review, so it was governed only by the generic deflect-to-contacts rule — confirming this needed a standing-rule fix, not a change to intent classification or lead capture
- Re-tested against a disposable test org (real auth, real OpenAI, dev DB): "Can I speak to someone?", "I'd like to talk to a real person please", and "Can you give me your phone number?" all now offer a callback and ask for the customer's name instead of deflecting
- Multi-turn check: after the handoff offer, supplying "I'm John Smith, call me on 07911223344, best time is tomorrow afternoon" correctly created a real lead row (name, phone, status `new`) — confirms the existing `contact_update` capture path (unchanged) still works once details are given
- Applied identically to both `/api/chat` and `/api/widget/chat`; test org/user/leads/conversations deleted afterward

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

