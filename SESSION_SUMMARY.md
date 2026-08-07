# Session Summary — 2026-08-04

Written at the end of the session, on stopping for usage limits. Save-only:
no feature work was done after this document was started.

---

## 1. Current project status

Two separate strands were worked on today.

**Strand A — voice + calendar UI (COMPLETE, DEPLOYED, LIVE).**
The end-of-call conversation flow was reordered, the prompt trimmed back under its
size budget, five spoken-wording defects fixed, and a month-view calendar bug fixed.
All of it is pushed and running in production.

**Strand B — external calendar integration (IN PROGRESS, DEPLOYED BUT INERT).**
Milestones 1, 1b and 2 of seven are pushed and therefore present in production, but
every code path is behind `INTEGRATIONS_ENABLED`, which is **not set anywhere**. With
the flag unset the routes return 404, the Settings tab does not render, and no
booking path calls anything new.

Milestone 3 is code-complete and **is wired — but only into the phone call.**
`src/lib/voice/availabilityTool.ts` calls `checkBookingSlot()` for every mid-call
availability question (added `e1f8ce6`). Website chat, the embedded widget and
post-call lead capture still do NOT call it.

**The external calendar is nevertheless not consulted yet**, because
`checkBookingSlot`'s external branch is gated by `CALENDAR_SYNC_ENABLED`: with that
flag unset `resolveOrgCalendar` short-circuits to `not_connected` before any query
runs. Enabling it would take effect on live calls immediately — that is no longer an
inert change.

---

## 2. What was completed in this session

### Voice conversation flow (strand A)
- Reordered the end of a call to **recap → caller confirms → "anything else?" → goodbye**.
  Previously the caller was asked whether they needed anything more *before* a single
  detail had been read back to them.
- Made the recap complete: service, appointment date, appointment time, name, callback
  number, address and any important note.
- Trimmed the prompt from 12,138 back to **11,351 characters**, under the 11,399 budget,
  by removing duplicated phrasing only — no rule, safeguard or gate was removed.
- Five spoken-wording fixes from a live call: business-name pronunciation, a natural
  email question, half-corrected addresses, duplicated words, and "anything else?" being
  asked more than once.

### Calendar UI (strand A)
- Month view: `+N more` was a plain `<p>` with no handler, so appointments beyond the
  third were unreachable. It is now a button opening a popover with the day's full list.

### Integration Framework (strand B)
- **Milestone 1** — schema, credential encryption, provider abstraction.
- **Milestone 1b** — generalised from a calendar-specific design into an Integration
  Framework every future integration reuses.
- **Milestone 2** — OAuth connection lifecycle: connect, callback, disconnect, resource
  selection, refresh-on-use, status transitions, and the Settings → Integrations page.
- **Milestone 3 (uncommitted at time of writing, committed by this save)** — the
  composed availability engine and the org-level calendar service. **Not wired in.**

---

## 3. Git commit hashes

| Hash | Milestone / change |
| --- | --- |
| `990c766` | fix(voice): recap and confirm before asking "anything else?" |
| `e26126a` | refactor(voice): trim the prompt back under the length budget |
| `860b8d5` | fix(voice): five spoken-wording fixes from the live call |
| `35f736d` | fix(calendar): make hidden month-view appointments reachable |
| `65b71e4` | feat(calendar): milestone 1 — schema, encryption, provider abstraction |
| `b75cc98` | refactor(integrations): milestone 1b — generalise to an Integration Framework |
| `3473b35` | feat(integrations): milestone 2 — OAuth connection lifecycle |
| *(this save)* | milestone 3 — availability engine, inactive; plus session documentation |

Session started at `595afcb`.

---

## 4. Files modified (existing files changed)

| File | Why | Deployed? |
| --- | --- | --- |
| `src/lib/voice/assistant.ts` | Voice prompt: recap flow, trim, five wording fixes | ✅ live |
| `src/app/(dashboard)/calendar/CalendarView.tsx` | Month-view popover | ✅ live |
| `src/app/(dashboard)/settings/layout.tsx` | Client → server, so it can read the feature flag | ✅ live |
| `src/lib/availability.ts` | **Additive only** — optional timezone parameter, optional slot predicate, two new exported helpers | committed by this save, inert |
| `src/lib/integrations/connections.ts` | One new function (`getPrimaryResourceWithConnection`) | committed by this save, inert |
| `tests/voiceConversation.test.mjs`, `tests/callerId.test.mjs` | Wording updates for the prompt changes | ✅ live |
| `CHANGELOG.md`, `CHECKLIST.md` | Documentation | — |

`src/lib/availability.ts` is the only live booking file touched by strand B. Its diff
removes exactly five lines, each re-added with a default that preserves current
behaviour: `getLondonParts` gained an optional `timezone` defaulting to `Europe/London`,
and `findNextAvailableSlot` gained an optional predicate which, when omitted, leaves the
loop identical. The 173 existing voice/booking tests pass unchanged against it.

---

## 5. Files added

**Integration Framework (generic):**
`src/lib/integrations/{types,registry,crypto,errors,auth,flags,http,oauthState,session,connections}.ts`

**Providers:** `src/lib/integrations/providers/{google,index}.ts`

**Capability service:** `src/lib/integrations/capabilities/calendarService.ts`

**Booking engine composition:** `src/lib/bookingAvailability.ts`

**Domain util:** `src/lib/calendar/timezone.ts`

**Routes:** `src/app/api/integrations/[provider]/{connect,callback,disconnect,resources}/route.ts`

**UI:** `src/app/(dashboard)/settings/integrations/{page,IntegrationsClient}.tsx`,
`src/app/(dashboard)/settings/SettingsNav.tsx`

**SQL:** `docs/sql/2026-08-04_integration_framework.sql`,
`docs/sql/2026-08-04_integration_framework_verify.sql`

**Tests:** `tests/{integrationCrypto,integrationRegistry,integrationAuth,googleIntegration,oauthState,calendarTimezone,bookingAvailability}.test.mjs`

---

## 6. Database migration status

⚠️ **The dev migration is PARTIALLY APPLIED.** Verified directly, read-only, this session:

| Object | Dev (`kioljdihgbcboxlnwghv`) | Prod (`sklcqvvnuigpewzarbiv`) |
| --- | --- | --- |
| `integration_connections` | ✅ present | ❓ **not verified** |
| `integration_resources` | ✅ present | ❓ **not verified** |
| `integration_jobs` | ✅ present | ❓ **not verified** |
| `integration_links` | ✅ present | ❓ **not verified** |
| `organisations.timezone` | ❌ **ABSENT** | ❓ **not verified** |

The four tables exist on dev but the final `alter table organisations` did not take
effect. Because the Supabase SQL editor runs a multi-statement script as one
transaction, an error would have rolled everything back — so this looks like the script
was run in parts, or truncated before the last statement.

**Production could not be checked from this environment.** `.env.local` points at dev,
and prod is unreachable locally (a long-standing constraint recorded in earlier notes).

**Security property verified on dev:** the anon key cannot even *see* the four tables —
PostgREST does not expose them, which is the strongest possible denial and exactly the
intended design for the credential tables.

---

## 7. Outstanding SQL required

**On dev — complete the partial migration:**

```sql
alter table public.organisations
  add column if not exists timezone text not null default 'Europe/London';
```

**On prod — run the whole migration, then the verify script:**

1. `docs/sql/2026-08-04_integration_framework.sql`
2. `docs/sql/2026-08-04_integration_framework_verify.sql`

In the verify output, **query 3 is the one that matters**: it must return exactly two
rows (`integration_resources` and `integration_links`, both SELECT, both
`{authenticated}`). If `integration_connections` or `integration_jobs` appears there at
all, encrypted credentials would be readable through the public anon key — stop and fix
before going further. Query 11 confirms no earlier draft was applied by mistake.

---

## 8. Environment variables required

All six are **missing from `.env.local`**. Vercel was not inspected this session.

| Variable | Purpose | Needed by |
| --- | --- | --- |
| `INTEGRATIONS_ENABLED` | Master kill switch | Milestone 2 onward |
| `INTEGRATION_TOKEN_ENCRYPTION_KEY` | AES-256-GCM key, `openssl rand -base64 32` | Milestone 2 onward |
| `GOOGLE_CALENDAR_CLIENT_ID` | Google OAuth | Milestone 2 onward |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Google OAuth | Milestone 2 onward |
| `CALENDAR_SYNC_ENABLED` | Calendar capability | Milestone 3 onward |
| `CALENDAR_AVAILABILITY_BLOCKING` | Allow a busy calendar to refuse a slot | Milestone 4 |

`INTEGRATION_TOKEN_ENCRYPTION_KEY` must **never** be prefixed `NEXT_PUBLIC_`.

---

## 9. Current feature flags

| Flag | Value | Effect right now |
| --- | --- | --- |
| `INTEGRATIONS_ENABLED` | unset ⇒ **off** | All `/api/integrations/*` routes 404; Settings tab hidden; page redirects to `/settings` |
| `CALENDAR_SYNC_ENABLED` | unset ⇒ **off** | Gated by the above; no calendar is ever resolved |
| `CALENDAR_AVAILABILITY_BLOCKING` | unset ⇒ **off** | Log-only: a conflict would be logged, never used to refuse a booking |

Each flag is gated by the one above it, and **only the exact string `"true"` counts** —
unset, empty, `"1"`, `"yes"` or a typo all read as off. Turning off
`INTEGRATIONS_ENABLED` is always sufficient to disable everything.

---

## 10. What IS deployed to production

Everything through `3473b35` is on `origin/main`, and Vercel deploys `main`:

- ✅ The voice prompt changes — **live and affecting real calls**
- ✅ The calendar month-view popover — live in the dashboard
- ✅ The settings layout split (server layout + client nav) — live; renders the same four
  tabs while the flag is off
- ⚪ The entire Integration Framework and all `/api/integrations/*` routes — present in
  the deployed bundle but **inert**: they 404 with the flag unset

---

## 11. What is NOT deployed

- Milestone 3 (the availability engine and calendar service) — committed by this save
  but not yet pushed at the time this file was written; see the handover at the end for
  the final push status.
- Nothing else. There is no code sitting only on this machine.

---

## 12. What is committed / what is not

**Committed and pushed:** all seven commits listed in section 3.

**Committed by this save:** milestone 3 files, `CHANGELOG.md`, `CHECKLIST.md`, this
document.

**Not committed:** nothing. The working tree is clean after this save.

---

## 13. Risks and warnings

1. 🔴 **Google OAuth verification has not been started.** `calendar.events` and
   `calendar.readonly` are *sensitive* scopes requiring Google app review before
   external users can consent at scale. Review takes days to weeks and **gates real
   customers, not code**. This is the longest lead time in the project.
2. 🔴 **An OAuth app left in *Testing* mode issues refresh tokens that expire after 7
   days.** This will look exactly like a random disconnection bug. Publish the consent
   screen before any real business connects.
3. 🟠 **The dev migration is partially applied** (section 6). `organisations.timezone`
   is missing. Code fails soft — `getOrgTimezone()` falls back to `Europe/London` — so
   nothing breaks, but per-organisation timezones cannot work until it exists.
4. 🟠 **Production migration state is unknown.** It must be verified before any flag is
   turned on.
5. 🟡 **`settings/layout.tsx` was restructured and is deployed.** Behaviour should be
   identical with the flag off, but it is a real change to a page real users visit.
6. 🟡 **The voice prompt is 11,351 characters, close to the 11,399 budget.** Milestone 8
   (live in-call availability) will need prompt space that does not currently exist.
7. 🟡 **Lint has 10 pre-existing problems** (7 errors, 3 warnings) in dashboard/import
   files. They predate this session and were not touched.

---

## 14. Exact next steps, in order

1. **Complete the dev migration** — run the `alter table` in section 7 against dev.
2. **Run the full migration on prod**, then the verify script; check query 3 first.
3. **Generate `INTEGRATION_TOKEN_ENCRYPTION_KEY`** (`openssl rand -base64 32`) and set it
   in `.env.local` and Vercel.
4. **Create the Google Cloud OAuth client** (section 16) and set the client id/secret.
5. **Start Google verification** — do this as early as possible; it is the long pole.
6. **Enable `INTEGRATIONS_ENABLED=true` on dev only** and test connect → pick calendar →
   disconnect → reconnect against a real Google account.
7. **Wire `checkBookingSlot()` into lead capture** — chat, the embedded widget and
   post-call capture still do not call it. The phone call already does, via
   `voice/availabilityTool.ts`; there, enabling `CALENDAR_SYNC_ENABLED` is what makes
   the external lookup live.
8. Milestone 4 (enable blocking after validating the log-only data), then 5, 6, 7.

---

## 15. Manual tasks remaining

- Run the two SQL scripts (dev completion, prod full) — cannot be done from this
  environment.
- Paste back verify query 3's output.
- Set six environment variables in `.env.local` and Vercel.
- Create the Google Cloud OAuth client and start verification.
- Register the Microsoft (Entra ID) app when milestone 7 approaches.
- Live-test the voice changes: listen specifically for whether the business name is
  still spoken as "Night Owl Test" (if so it is the TTS voice, not the prompt, and needs
  a Vapi pronunciation setting), and whether "anything else?" now comes only once, after
  the recap.

---

## 16. Google / Microsoft OAuth setup remaining

**Google — nothing has been created yet.**
- Google Cloud project with the **Google Calendar API** enabled.
- OAuth client of type **Web application**.
- Authorised redirect URIs:
  - `https://niteowlhq.com/api/integrations/google/callback`
  - `http://localhost:3000/api/integrations/google/callback`
- Scopes requested by the code: `openid`, `email`,
  `https://www.googleapis.com/auth/calendar.events`,
  `https://www.googleapis.com/auth/calendar.readonly`
- **Publish the consent screen** (see risk 2) and submit for verification.

**Microsoft — not started, and not needed until milestone 7.**
- Entra ID (Azure AD) app registration, `common` endpoint so both Outlook.com and
  Microsoft 365 accounts work.
- Scopes: `Calendars.ReadWrite`, `offline_access`, `User.Read`.
- Redirect URI: `https://niteowlhq.com/api/integrations/microsoft/callback`.
- No framework change is needed — registering it is a two-line addition to
  `src/lib/integrations/providers/index.ts`.

---

## 17. Verification status

| Item | Status |
| --- | --- |
| Unit/integration test suite | ✅ 325 passing, 0 failing |
| Voice + booking regression | ✅ 173 passing, unchanged |
| `tsc --noEmit` | ✅ clean |
| `next build` | ✅ clean |
| Lint | ✅ unchanged (same 10 pre-existing problems) |
| Feature dark with flag off | ✅ verified against a running dev server — all four routes 404, page redirects |
| Auth gating with flag on | ✅ verified — every route 401s or redirects to login when unauthenticated |
| Anon key denied on credential tables | ✅ verified against dev |
| Dev migration complete | ❌ partially applied |
| Prod migration | ❓ not verified |
| Live Google connection | ❌ never attempted — no credentials exist |
| Live voice call against new prompt | ❌ not yet tested by the owner |
| Calendar popover clicked in a browser | ❌ not click-tested (auth-gated; no browser tooling available in session) |

---

## 18. Test results

`npm test` — **325 passing, 0 failing, 66 suites.** Progression through the session:
163 → 168 → 173 → 231 → 258 → 311 → 325.

Breakdown of what was added: 58 (milestone 1), 27 (1b), 53 (2), 14 (3), plus voice and
calendar test updates.

---

## 19. Known issues

1. `organisations.timezone` missing on dev (section 6).
2. Production migration state unknown.
3. Google/Microsoft OAuth apps do not exist, so no live connection has ever been made.
4. The calendar month-view popover was verified structurally (server-rendered HTML shows
   a real `<button aria-label="Show all 5 appointments">`) but **not click-tested** —
   `/calendar` is auth-gated and no browser automation was available.
5. Voice prompt changes are unproven on a live call.
6. 10 pre-existing lint problems, untouched.
7. The voice prompt has only 48 characters of headroom under its budget.

---

## 20. Architecture decisions, and why

**1. An Integration Framework, not a calendar integration.**
Google Calendar, Microsoft, CRMs, WhatsApp, Instagram and SMS all need the same four
things — a connection with credentials, a selection of remote objects, a job queue, and
a link between a local record and its remote counterpart. Only the *capability* and the
*auth strategy* differ, so those are columns and interfaces rather than new tables and
new routes. Adding an integration is a provider file plus two lines in the composition
root.

**2. Credentials are one encrypted JSON blob, not `access_token`/`refresh_token` columns.**
Those columns fit Google and Microsoft and then block the first non-OAuth integration:
Twilio is an account SID plus auth token, CalDAV is a username plus app password, an ICS
feed has no credential at all. The blob's shape is chosen by a pluggable auth strategy.

**3. The schema is multi-calendar from day one, with no `UNIQUE(org_id)` anywhere.**
Version 1 exposes one calendar, but that rule lives in a *partial unique index* on the
primary flag, which extends to one-primary-per-staff without a schema redesign.

**4. `provider` and `operation` are unconstrained text.**
A CHECK constraint would mean a migration every time an integration is added. The
allowed set is owned by the registry in code.

**5. Credential tables have RLS enabled with NO policies.**
Deny-all to anon *and* authenticated — so a signed-in owner cannot read their own
encrypted tokens through the public anon key. Only the service-role client reaches them,
and every query still carries an explicit `org_id`.

**6. The external-calendar layer composes ON TOP of `availability.ts`, not inside it.**
`bookingAvailability.ts` imports the existing engine; the engine knows nothing about
integrations, so chat, the widget and post-call capture gain no new import and no new
failure mode. The phone call, which now calls `checkBookingSlot()`, does gain one once
`CALENDAR_SYNC_ENABLED` is on: an unreadable calendar becomes "availability unknown"
rather than a spoken time.

**7. "Cannot check" is never "free".**
A provider outage, an expired token or an unreadable calendar returns a failure, never
an empty busy list. Treating an unknown as free is how a customer gets double-booked.
The caller must refuse to confirm and send the lead for review.

**8. Availability blocking is a separate flag from the rest of the feature.**
It runs in log-only mode first: conflicts are recorded but bookings still go through, so
the log can be compared against reality before the system is ever allowed to turn a
customer away.

**9. Timezone validation is membership of `Intl.supportedValuesOf("timeZone")`, not a
`try/catch`.** `Intl` *accepts* `"BST"` and silently resolves it to `Asia/Dhaka` (UTC+6);
`"EST"` becomes `America/Panama`. An owner picking "BST" for British Summer Time would
have had every appointment six hours out with no error anywhere.

**10. Providers receive local wall time plus an IANA zone, never a UTC offset.**
A stored offset stops being true at a daylight-saving transition, silently shifting
every affected appointment by an hour.

**11. One generic route pair serves every integration.**
`/api/integrations/[provider]/{connect,callback,disconnect,resources}` — the provider is
a path segment resolved through the registry, so Microsoft or Meta need no new endpoint.

**12. `await connection()` instead of `export const dynamic`.**
`dynamic` is not in Next 16's route segment config. Without this the Integrations page
prerendered as static, baking in the flag-off redirect and continuing to serve it after
the flag was switched on.

---

## 21. Confirmation: unchanged production behaviour

Verified with `git diff --name-only 595afcb..HEAD` against each file.

| Area | Status |
| --- | --- |
| Vapi integration (`src/lib/voice/vapi.ts`) | ✅ **untouched** |
| Voice webhook + handler (`voice/handler.ts`, `api/voice/*`) | ✅ **untouched** |
| Twilio | ✅ **untouched** (no Twilio-specific file exists in the repo) |
| Lead capture (`src/lib/leadCapture.ts`) | ✅ **untouched** |
| Callback flow / booking manage (`api/bookings/manage`) | ✅ **untouched** |
| Chat route (`api/chat/route.ts`) | ✅ **untouched** |
| Chat widget (`api/widget/chat/route.ts`) | ✅ **untouched** |
| Notifications / email (`src/lib/email.ts`) | ✅ **untouched** |
| Booking engine behaviour (`src/lib/availability.ts`) | ⚠️ **file changed, behaviour preserved** — additive only, defaults reproduce the previous behaviour exactly; 173 existing tests pass unchanged |
| Database schema for existing tables | ✅ **untouched** — `leads` gains nothing; only `organisations` gains one defaulted column, and that has not been applied |

⚠️ **One important correction to the blanket claim: the receptionist prompt WAS changed
this session.** `src/lib/voice/assistant.ts` was deliberately edited at your request —
the recap/confirmation reordering, the length trim, and the five wording fixes — and
those changes are committed, pushed and **live in production**. They were made *before*
the calendar work began, and **no integration milestone touched the voice prompt at
all.** The prompt has been unchanged since commit `860b8d5`.

---

## 22. Confirmation: is the new code inactive?

**Yes, with one caveat.**

- All Integration Framework code, all `/api/integrations/*` routes and the Settings →
  Integrations page are behind `INTEGRATIONS_ENABLED`, which is unset. Verified against
  a running server: routes 404, page redirects.
- Milestone 3's engine (`bookingAvailability.ts`, `calendarService.ts`) **is now called
  from the phone-call path** (`voice/availabilityTool.ts`). The old claim that it had no
  call site at all was true when written and stopped being true at `e1f8ce6`. What keeps
  the external lookup inactive today is therefore the flag alone — `CALENDAR_SYNC_ENABLED`
  is unset, so `resolveOrgCalendar` returns before any query — and not the absence of a
  caller. Chat, the widget and post-call capture do still have no call site.
- **The caveat:** `src/lib/availability.ts` and `src/app/(dashboard)/settings/layout.tsx`
  are live files that were genuinely edited. Both are behaviour-preserving by
  construction (defaulted parameters; same tabs while the flag is off) and covered by
  the passing test suite, but they are not "inactive code" in the strict sense.
