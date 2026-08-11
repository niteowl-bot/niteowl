# Handoff — booking date parsing & calendar scopes

Last updated: 2026-08-08

Two pieces of work landed. One is deployed; one is committed but not
pushed. A third, larger fix is specified below and **not started**.

---

## What was fixed

### 1. Deterministic appointment date parsing — commit `1e14b60` (committed, NOT pushed)

`"20/08/26 at 2pm"` was handed to `gpt-4o-mini` like any other phrase
and came back as a different date, read as US `MM/DD`. The customer had
stated the date exactly; we changed it silently, and the availability
check, the calendar event and the spoken confirmation all inherited the
wrong day.

`DD/MM/YY` → an instant is arithmetic, not language, so it is now
computed in code **before** the network call and the model is never
consulted for an explicit date. Explicit-date bookings also survive an
OpenAI outage as a side effect.

- This locale is `DD/MM`. `05/09/26` is 5 September, never 9 May.
- Times read strictly: `2pm`, `2:30pm`, `14:00`, `09:30`.
- Anything that could mean two instants is **refused, not guessed**: a
  bare `"at 2"`, or an impossible date (`32/08`, `31/02`, `13/20` — the
  last valid only if re-read as `MM/DD`, which we do not). These return
  a new optional `needsClarification` flag.
- Conversational expressions (`tomorrow`, `next Monday`, `20th August`)
  are untouched — the parser returns `null` unless it sees
  separator-delimited numerals, so they take the existing model path.

### 2. Google Calendar least-privilege scopes — commit `326dc93` (deployed)

Replaced `calendar.readonly` with `calendar.calendarlist.readonly` +
`calendar.freebusy`, retaining `calendar.events`, `openid`, `email`, in
both `GOOGLE_SCOPES` and `GOOGLE_REQUIRED_SCOPES`. Privacy policy
updated to state these as limits Google enforces rather than promises we
make. Deployed and verified live on `326dc93`.

**Not yet in effect.** `include_granted_scopes=true` means a plain
reconnect returns the *union* of old and new scopes. The existing grant
must be **revoked** at myaccount.google.com/permissions, then
reconnected, for the narrowing to actually apply. Not done — needs a
human.

---

## Files changed

| File | Change |
|---|---|
| `src/lib/parseDatetime.ts` | `parseExplicitNumericDatetime()`, wired ahead of the model call; `needsClarification` added to `ParseDatetimeResult` |
| `tests/explicitDateParsing.test.mjs` | new, 27 tests |
| `src/lib/integrations/providers/google.ts` | scope constants (deployed) |
| `src/app/privacy/page.tsx` | Google Calendar disclosure (deployed) |

---

## Tests / results

- **674 pass / 0 fail**, 130 suites (was 647 before this work).
- `npx tsc --noEmit` clean. `npx eslint` clean on all changed files.
- The model stub in `explicitDateParsing.test.mjs` returns a
  **deliberately wrong** date, so each correctness test doubles as proof
  the model was never called (`stubs.calls.openai === 0`).
- Voice suites green and untouched: `voiceConversation`, `voiceEndCall`,
  `voiceAvailability`, `voiceLeadIsolation`, `callerId`.

Repo-wide lint still reports 10 pre-existing `react-hooks` problems in
files unrelated to this work.

---

## What remains unfixed

1. **Chat and widget never consult the connected Google Calendar.**
   `leadCapture.ts:859-862` calls only `isWithinBusinessHours` +
   `checkSlotCapacity` (internal engine). `checkBookingSlot`
   (`bookingAvailability.ts:116`), which adds the external free/busy
   lookup, is called only from `voice/availabilityTool.ts:467` and
   `calendarSync.ts:245,385` (pre-write re-check). **A slot busy on the
   real Google Calendar is reported available on chat/widget.**
   Violates invariant "an unavailable slot must never be presented as
   available."

2. **`booked` is only calendar-backed for allowlisted orgs.**
   `requiresCalendarBacking()` + `mayConfirmBooking()` correctly refuse
   to mark a lead `booked` unless the calendar write succeeded — but the
   gate is `isCalendarEventCreationEnabled(orgId)`, and
   `CALENDAR_EVENT_CREATION_ORG_IDS` is currently the test org alone. For
   every other org `booked` is decided locally with no calendar write.
   The invariant holds where writes are enabled and is vacuous elsewhere.

3. **Hardcoded timezone.** `resolveAppointmentDatetime`
   (`leadCapture.ts:598`) passes `"Europe/London"` instead of
   `getOrgTimezone(orgId)`. A business in another timezone has its dates
   parsed in London time.

4. **`needsClarification` is produced but not consumed.** `leadCapture`
   ignores it, so `"20/08/26"` with no time currently captures no
   appointment rather than prompting "what time?". Safer than guessing,
   but not yet the asking behaviour.

5. **`DD/MM` without a year** (`"20/08 at 2pm"`) still goes to the
   model. Unchanged behaviour, not deterministic.

6. Conversational ordering (asking for a name before a time exists) is
   reply-model behaviour. The mutation already runs before the reply
   model, which is constrained by the Availability Note and
   `bookingOutcome.ts` — but nothing forces a datetime to exist first.

---

## Exact proposed next step

**One reviewable step, awaiting approval:**

1. Route `leadCapture` availability through `checkBookingSlot` instead of
   the two internal calls — preserving the `excludeLeadId` reschedule
   exemption and the fail-closed `lookup_failed` reason (a failed lookup
   is never "free").
2. Pass `getOrgTimezone(orgId)` into `resolveAppointmentDatetime`.
3. Consume `needsClarification` so Remy asks for the missing time.
4. Regression-test **both** chat preview and a live phone booking.

This changes live booking behaviour for **every** org on a path phone
calls also use, and makes bookings depend on a Google API call that can
fail. It was deliberately not bundled with the parser fix.

---

## Phone / voice guardrails

- `parseDatetimeToIso` **is shared** — chat, widget, post-call voice
  capture, and sales all use it. The parser change is safe for voice
  because it only claims separator-delimited numerals; a transcript says
  "the twentieth of August", which still takes the old model path.
- **Untouched, and must stay untouched unless explicitly scoped:**
  `voice/assistant.ts` (the 13-rule prompt), `voice/vapi.ts` (including
  `serverMessages` — dropping it silently kills all end-of-call
  reports), `voice/availabilityTool.ts`, `checkBookingSlot`,
  `availability.ts`, `calendarSync.ts`.
- Before any live call test: verify the marker exists on `origin/main`
  **and** on the deployed SHA. A live call has three times been run
  against a pre-fix prompt because the change was committed but not
  deployed.
- Voice mid-call availability already goes through `checkBookingSlot`.
  Do not "fix" it again — the gap is on the chat side only.

---

## Known risks

- **Scope narrowing is inert until the grant is revoked.** Reconnecting
  without revoking silently keeps `calendar.readonly`.
- Routing chat through `checkBookingSlot` adds an external API call to
  the booking path — latency and a new failure mode. Fail-closed is
  correct but will refuse bookings during a Google outage.
- Enabling calendar writes beyond the test org means `booked` starts
  depending on a successful Google write for real customers. Widen
  `CALENDAR_EVENT_CREATION_ORG_IDS` deliberately, one org at a time.
- Residual check-to-create race: the window is milliseconds and the
  loser gets a 409, but it is not zero.
- `needs_reauth` has **no owner notification** anywhere outside
  Settings → Integrations. A silently expired token is invisible.
- `supabase/.temp/` is untracked CLI machine state. Do not commit it;
  consider a `.gitignore` entry.

---

## Do not implement anything else

Nothing beyond the four numbered steps above without explicit approval.
No refactors, no prompt rewrites, no widening of the calendar allowlist,
no Google Cloud changes, no pushes or deploys unless asked.
