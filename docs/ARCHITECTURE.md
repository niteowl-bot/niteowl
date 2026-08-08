# NiteOwl / Remy — Architecture and Future-Compatibility Guardrail

**Status: documentation only.** Nothing in this document was implemented as part of
writing it. No schema was changed, no route was changed, no environment variable was
changed, no working code was refactored. Written 2026-08-08 against commit `8b4862e`.

**Part I** (§1–5) is the future-infrastructure guardrail review: architecture, tenancy,
entity model, NiteOwl Core and Business Graph compatibility.
**Part II** (§6–13) extends it with the provider-independence and resilience review —
provider inventory and risk, failure isolation, truthful degradation, idempotency,
source of truth, portability and recovery. Part II does not repeat Part I; where a
finding belongs to both, Part II references it by its Part I label (C1, C2, C3, P1).

Governing principle for every recommendation below:

> **MINIMUM CHANGE NOW, MAXIMUM COMPATIBILITY LATER.**

The immediate priority remains Remy's calendar and receptionist work — reliable
booking, cancellation and rescheduling. Everything here is either an observation
about what already exists, or a *deferred* recommendation with a stated trigger.
Where this document names a future NiteOwl product (Scout, Pulse, Beacon, Ledger,
Forge, Atlas, Nova), it does so only to mark a boundary. **None of them is built,
scaffolded or depended on anywhere in this repository, and nothing here creates a
dependency on one.**

Companion documents, which this one does not duplicate:

| Document | What it holds |
|---|---|
| `PROJECT_CONTEXT.md` | Product definition, development principles, roadmap |
| `SESSION_SUMMARY.md` §20 | The twelve integration-framework architecture decisions and their reasoning |
| `CHECKLIST.md` | Live launch-readiness state, per-feature verification status |
| `CHANGELOG.md` | Every change, with root causes |
| `docs/VOICE_AI_PLAN.md` | Voice platform design and isolation guarantees |
| `docs/sql/*.sql` | The schema itself — hand-run, additive, each file self-documenting |

---

## 1. Current architecture

### 1.1 Shape

A single Next.js 16 application on Vercel, one Supabase Postgres per environment
(dev `kioljdihgbcboxlnwghv`, prod `sklcqvvnuigpewzarbiv`), OpenAI for language,
Vapi for telephony, Resend for email, Stripe for billing. There are no
microservices, no message broker and no separate worker. That is the correct shape
for the current product and this document recommends no change to it.

### 1.2 Channels

Four customer-facing entry points share one engine:

```
website widget ─┐
dashboard chat ─┼─→ capturePartialLead()  ─→ leads
public /booking ┤        (leadCapture.ts)
phone call ─────┘─→ voice/calls.ts ────────┘
```

Only `leads.source` differs (`chat`, `web_widget`, `dashboard_preview`, `voice`),
which is what keeps dashboard testing out of production analytics. This is a real
architectural strength and should be preserved: a booking rule can only be enforced
once if there is only one place that books.

### 1.3 Entities that exist today

| Table | Tenant key | Notes |
|---|---|---|
| `organisations` | `id` (is the tenant) | `owner_id` → `auth.users`. Holds business identity, hours defaults, `timezone`, `appointment_duration_minutes`, `max_concurrent_bookings`, `emergency_mode_enabled`, `notification_email`, `widget_key`, Stripe/billing state |
| `leads` | `org_id` | The customer, the enquiry **and the appointment, all in one row** |
| `business_hours` | `org_id` | One row per weekday |
| `business_knowledge` (+ `_revisions`) | `org_id` | The Knowledge Base; RLS-owner-scoped, audit + revision triggers |
| `knowledge_imports` / `_files` / `knowledge_staged_items` | `org_id` | AI import staging |
| `conversations`, `messages` | `org_id` | Chat history |
| `voice_calls`, `voice_events`, `voice_settings` | `org_id` | `voice_events` is append-only raw payloads; `voice_settings.phone_number` is the inbound tenant key |
| `integration_connections` / `_resources` / `_jobs` / `_links` | `org_id` | The integration framework (2026-08-04) |
| `sales_leads` | *none* | NiteOwl's **own** marketing funnel, not tenant data. Correctly separate |

### 1.4 Multi-tenant isolation — inspected, and sound

Every business-owned table carries `org_id` (or is `organisations` itself). Two
distinct trust models are used, deliberately:

1. **RLS-scoped server client** (`lib/supabase/server.ts`) for authenticated
   dashboard reads. Policies are of the form
   `org_id in (select id from organisations where owner_id = auth.uid())`.
2. **Service-role client** (`lib/supabase/admin.ts`) for unauthenticated paths —
   the public widget, the voice webhook, the token-authenticated booking-manage
   page. RLS is bypassed, so **every query must carry an explicit `org_id`**, and
   the file says so.

Inspection findings:

- Every service-role query reviewed either filters by an explicit `org_id`, or
  filters by a primary key that was itself resolved from an org-scoped or
  token-scoped lookup. No query was found that could operate across businesses.
- `/api/leads` verifies `organisations.owner_id = user.id` before both GET and
  POST, and rejects with 403 rather than trusting the client-supplied `org_id`.
- Credential tables (`integration_connections`, `integration_jobs`) have RLS
  enabled with **no policies at all** — deny-all to anon *and* authenticated, so a
  signed-in owner cannot read their own encrypted tokens through the public key.

**Verified against production, read-only, 2026-08-08** (counts only; no row
contents, keys or PII were printed):

| Table | service-role rows | anon-key rows |
|---|---|---|
| `integration_connections` | 1 | **0** |
| `integration_resources` | 1 | 0 (owner-policy table; no session on the probe) |
| `leads` | 5 | **0** |
| `integration_jobs` | 0 | 0 — *empty, so not conclusive* |
| `integration_links` | 0 | 0 — *empty, so not conclusive* |

`integration_connections` holding a row that the public key cannot see is direct
proof that encrypted Google credentials are not readable via the anon key. This
closes the outstanding item at `CHECKLIST.md` line 55 for the table that matters;
`integration_jobs` remains formally unproven only because it has no rows yet.

**Assessment: tenant isolation is adequate. Do not redesign it.**

### 1.5 Calendar architecture

```
booking caller
   │
   ├─ checkBookingSlot()                    lib/bookingAvailability.ts
   │     business hours → internal capacity → external calendar
   │                                          (in that order, short-circuiting)
   │
   ├─ availability.ts                        the internal engine. Imports NO
   │                                         integration module — the external
   │                                         layer composes ON TOP of it
   │
   └─ calendarService.ts                     the org-level capability contract
          resolveOrgCalendar / getOrgBusyIntervals /
          createOrgEvent / updateOrgEvent / cancelOrgEvent
                     │
                     ▼
          registry → CalendarCapability      lib/integrations/types.ts
                     │
                     ▼
          providers/google.ts                the only adapter today
```

Three rules already hold and must not be weakened:

1. **"Not connected" is not an error.** The flag is checked before any query, so an
   org with no calendar costs zero database round trips and behaves exactly as it
   did before the feature existed.
2. **"Cannot check" is never "free."** An outage, an expired token or an unreadable
   calendar returns `lookup_failed`/`needs_reauth`, never an empty busy list. The
   caller must refuse to confirm.
3. **One provider request per question.** `getBusyIntervals` covers the whole
   14-day window once; candidate scanning reuses the returned list rather than
   re-asking per candidate.

**Live state (verified 2026-08-08).** `INTEGRATIONS_ENABLED`,
`CALENDAR_SYNC_ENABLED` and `CALENDAR_AVAILABILITY_BLOCKING` are all present in
Vercel production. Google Calendar is connected and a primary calendar is selected
for org `e3a9ae40…`. Reads are wired **only** into the phone path
(`voice/availabilityTool.ts`). Writes are **not wired at all** —
`createOrgEvent`, `updateOrgEvent` and `cancelOrgEvent` have zero call sites, and
nothing has ever written a row to `integration_links`.

---

## 2. Findings

Classified per the guardrail: **CRITICAL NOW** (a real current risk),
**PREPARE NOW** (small, low-risk, clearly justified), **LATER** (default).

### CRITICAL NOW

> **RESOLVED 2026-08-08 (not yet deployed).** Capacity is now an interval
> overlap, and both it and the business-hours read fail closed. The finding is
> kept below as the record of what was wrong and why. See the note after it for
> what the fix does and does not cover.

#### C1. The internal capacity check compares exact timestamps, so overlapping appointments are not prevented

`isSlotAvailable` (`src/lib/availability.ts:438`) counts booked leads with
`.eq("appointment_datetime", isoDatetime)` — **exact equality**, not overlap. With
the production settings of `appointment_duration_minutes = 60` and
`max_concurrent_bookings = 1`, a booking at 10:00 and a booking at 10:30 both pass:
neither timestamp equals the other, so each sees a count of zero.

`overlapsBusy()` — correct half-open interval logic — already exists in the same
file, but it is applied only to *external* busy intervals, never to the org's own
bookings.

- **Why it is critical:** `PROJECT_CONTEXT.md` lists "Double Booking Prevention" as
  complete and tested. It prevents *identical-timestamp* double booking only. Every
  channel is affected, because every channel reaches this function.
- **Why it is not fixed here:** the fix changes core booking logic, and would
  change which bookings are accepted for every existing org. That needs the owner's
  explicit approval, and a decision about whether duration comes from the org
  default or from a per-appointment value (see C3).
- **Scope of a fix, when approved:** replace the equality predicate with an overlap
  query over `[start, start + duration)`, reusing `overlapsBusy`'s existing
  semantics so back-to-back bookings stay legal. One function.

#### C1/R1 — what the 2026-08-08 fix actually covers

**Fixed.** One overlap definition (`appointmentOverlapWindow` /
`appointmentsOverlap`) now serves the shared capacity check *and* the voice
held-slot check, expressed as a strict range on `appointment_datetime` so
Postgres can still answer it with an index range scan. Half-open is preserved,
so back-to-back appointments remain bookable. Both the capacity read and the
business-hours read fail closed, with `lookup_failed` kept distinct from
`no_hours_configured` — the latter still fails open, which is what a business
mid-setup depends on.

**Two limits worth recording, neither introduced by the fix:**

1. **Duration is org-level.** Every appointment is
   `organisations.appointment_duration_minutes` long, so all intervals are the
   same width and one can never strictly *contain* another — containment
   reduces to partial overlap. Changing the org default retroactively changes
   every stored appointment's implied end, and therefore which historical
   bookings would now be considered clashes. This is L2, and it is the thing to
   fix before per-service or per-staff durations arrive.
2. **The overlap is checked, not claimed.** Two concurrent bookings can still
   both pass the check before either writes, because nothing takes a lock. That
   is the check-to-create race in §R3, and it is why §R3 asks for the internal
   claim to precede the external write at milestone 5.

**A behaviour change the fix required.** Capacity now excludes the lead being
rescheduled (`excludeLeadId`). Under exact-match a lead moving 10:00 → 10:30
never met itself; under overlap it does, so without the exclusion every short
reschedule would be refused as a clash with its own booking. `capturePartialLead`
resolves the existing lead *before* the availability check for this reason — the
only structural change in the pass.

#### C2. Chat and the widget book without consulting the calendar, while the phone refuses on the same calendar

`capturePartialLead` calls `isWithinBusinessHours` + `isSlotAvailable` directly
(`src/lib/leadCapture.ts:717`). It never calls `checkBookingSlot`. The phone path
does. With `CALENDAR_AVAILABILITY_BLOCKING` live in production, the two channels
now disagree: a caller is turned away from a slot that a website visitor can book
straight over, and the website booking is never written to Google Calendar (no
write path is wired), so the phone will not see it either.

- This is **already the top open item** in `CHECKLIST.md` (line 61) and needs no new
  architecture — only the wiring that is next in the milestone plan.
- It is listed as CRITICAL NOW because turning blocking on made one channel strict
  while leaving the others unchanged, and the asymmetry is live against real
  configuration today.
- **`/api/bookings/manage` has the same gap**, and one more besides: a customer
  self-service reschedule or cancel goes through neither `checkBookingSlot` nor any
  calendar write, so once event sync is wired it will silently desynchronise the
  external event. Wire all four paths in one pass, not three.

#### C3. A lead is a customer, an enquiry and an appointment at once — so a returning customer's second booking overwrites their first

There is no `appointments` table. An appointment *is* a `leads` row with
`status='booked'` and `appointment_datetime` set, guarded by a CHECK constraint and
by `bookingInvariant.ts`. For one enquiry that becomes one booking, this is a clean
and deliberate simplification, and it should not be dismantled casually.

The failure appears on the **second** booking. `findOpenLeadForCapture` layer 2
matches on email or phone across conversations with no time bound, and
`MERGEABLE_STATUSES` includes `booked`. So a chat or widget customer who books
Tuesday 10:00 and comes back a month later to book Friday 14:00 has their existing
row mutated: `appointment_datetime` becomes Friday, the Tuesday appointment
disappears from the calendar, and no confirmation email is sent — the send is
guarded by `existing.status !== "booked"`, which is false.

- Voice is **not** affected: layer 2 is skipped for `source='voice'`, so each call
  creates an isolated lead (fixed 2026-08, for a different reason).
- Verify the real-world incidence before choosing a fix — production currently holds
  test orgs only, so this may have no live victims yet.
- **This is also the single most important decision for future compatibility.** See
  §3.1 and P1.

### PREPARE NOW

#### P1. Decide appointment identity *before* wiring calendar event creation

This is a decision, not a build, and it costs nothing today. It becomes expensive
the moment milestone 5 runs.

`integration_links` carries `unique (subject_type, subject_id, connection_id,
capability)`. When `createOrgEvent` is finally wired, whatever is passed as
`subject_id` becomes the permanent, stored identity of "the thing that has a
calendar event". If that is the **lead id**, then one lead can hold exactly one
calendar event forever, and C3's rebooking case cannot be represented at all —
un-baking it later means a data migration over live rows plus reconciliation
against Google.

The framework already anticipates this: `subject_type` is deliberately
unconstrained text with a default of `'lead'`, so choosing `'appointment'` later
costs nothing *in the schema*. What it costs is the rows already written under the
other choice.

Recommended decision, to be taken before milestone 5 and recorded here:

- Wire event creation with `subject_type = 'appointment'`, and make `subject_id`
  the identity of an appointment.
- **Today that identity can still be the lead's id** — one lead, one appointment,
  no new table, no migration, no behaviour change. Nothing is built.
- If and when appointments are separated from leads (§3.1), `subject_type` already
  says what the row means, and only the id values need reconciling — not the shape,
  not the index, not the semantics.

The same argument applies to `CalendarEventInput.idempotencyKey`, which must be
derived from the appointment identity rather than the lead id if the two ever
diverge.

#### P2. This document

`docs/ARCHITECTURE.md` did not exist. The architecture decisions were real and
well-reasoned but scattered across `SESSION_SUMMARY.md` §20, individual SQL file
headers and long code comments — each excellent in isolation, none of them a map.

### LATER

Each carries the trigger that should promote it. Default to leaving these alone.

| # | Item | Trigger |
|---|---|---|
| L1 | **Split `appointments` from `leads`** (§3.1) | The first of: repeat bookings become common; per-appointment duration is needed; multi-staff arrives; schedule recovery is built |
| L2 | **Per-appointment duration.** Duration is org-level and read at query time, so changing the org default retroactively changes every historical appointment's implied end | Duration becomes per-service or per-staff — which is exactly when Dynamic Schedule Recovery needs it |
| L3 | **Remaining hardcoded `Europe/London`** — `availability.ts` `getLondonParts` default, `leadCapture.ts` `resolveAppointmentDatetime`, `bookings/manage` `londonWallTimeToUtcIso`. `organisations.timezone` exists and defaults to the same value, so behaviour is identical for every org today | Already staged: Stage 2 is the resume point on branch `timezone-aware-availability`. The first non-UK org makes it urgent |
| L4 | **Structured event log** (§3.3) | A second consumer of "what happened", or the first analytics requirement that a query over `leads` cannot answer |
| L5 | **AI permission model** (§3.4) | The first action Remy takes that a business would want to withhold — cancelling, moving a confirmed customer, or messaging out |
| L6 | **Business Operating Profile consolidation** (§3.2) | Configuration outgrows `organisations` columns — realistically at multi-location or multi-staff |
| L7 | **Organisation membership** (staff logins). `organisations.owner_id` is a single owner; there is no memberships table | The first business that needs two people signed in |
| L8 | **`lead_summary` security-definer view** — still outstanding from the 2026-07-15 RLS work | Before any non-owner role reads it |
| L9 | **`/api/leads` is dead code** with an incomplete status whitelist | Decide: wire it up or delete it. Already flagged in `CHECKLIST.md` |
| L10 | **Provider adapters beyond calendar** (messaging, telephony, email) | A second provider in that category. `CapabilityId` is deliberately `"calendar"` only |

---

## 3. Future-compatibility notes

Each subsection answers one question: *does today's architecture block this, and
what is the smallest seam that keeps it open?* None of it is to be built now.

### 3.1 Appointments and the Business Graph

The conceptual graph — Business, Customer, Lead, Service, Appointment, Employee,
Location, Conversation, Outcome — is a **modelling target, not a storage
technology**. Relational Postgres remains entirely appropriate; nothing here argues
for a graph database, and introducing one would be exactly the speculative
infrastructure the guardrail forbids.

What matters is that entities have stable identities and honest relationships.
Today's model collapses three graph nodes into one row:

```
                    today                          eventual
  Conversation ──→ ┌──────────┐          Conversation ──→ Lead ──→ Appointment
                   │  leads   │                             │           │
  Customer ──────→ │  (one    │          Customer ──────────┘           │
                   │   row)   │                                         │
  Appointment ───→ └──────────┘          Service ────────────────────────┘
```

The collapse is *fine* while one enquiry means one booking. It stops being fine at
the first of: a customer with two appointments, an appointment that outlives its
enquiry, appointments assigned to staff, or an appointment history worth learning
from. C3 shows the first of those already produces wrong behaviour.

Seams that already exist and cost nothing to keep:

- `integration_links.subject_type` is polymorphic text — a calendar event can be
  linked to an appointment without a schema change (P1).
- `integration_resources.staff_id` exists with no foreign key, reserved for
  multi-staff routing, and the primary-resource uniqueness is a *partial* index per
  staff — so one-calendar-per-staff needs no redesign.
- `voice_calls.lead_id` and `leads.conversation_id` already express real edges.

Seams to avoid closing: do not add a second unique constraint that assumes one
appointment per lead, and do not write external event ids as columns on `leads` —
`integration_links` already exists precisely so that never happens.

### 3.2 Business Operating Profile

The eventual structured profile — identity, locations, hours, services, pricing,
staff, calendars, policies, appointment/cancellation/callback rules, notification
preferences, etiquette, escalation, AI permissions, travel and buffer rules — today
lives in three places: columns on `organisations`, rows in `business_hours`, and
free text in `business_knowledge`.

That is adequate and should not be consolidated now. The direction, when the
trigger arrives (L6), is **additive**: keep `organisations` as the identity row,
and add profile sections as their own tables keyed by `org_id`, each with the
metadata the guardrail asks for — `source`, `updated_at`, `approval_status`, and
`confidence` where an AI extracted the value. The knowledge-import pipeline already
demonstrates that pattern working (staged items → review → approve → commit →
publish, with revisions and an audit trigger), so it is a proven shape in this
codebase rather than a new invention.

The one thing to avoid: do not let `business_knowledge` become the profile. It is
prose for a language model. Structured operating rules that the *booking engine*
must enforce belong in structured storage — the existing split, where hours drive
both the validator and the prompt from one source, is the correct precedent.

### 3.3 Events and operational history

The application does not emit structured events. Operational history is inferable
from `leads` status transitions, `voice_calls`, `conversations` and Vercel logs.

There is, however, already a **working durable-event pattern** in this codebase,
used twice and worth reusing rather than reinventing:

- `voice_events` — raw payload stored *before* processing, `dedupe_key` unique so
  provider retries are idempotent, `processed_at` NULL plus `processing_error` for
  replay.
- `integration_jobs` — the same idea for outbound work: `dedupe_key` unique,
  `attempts`/`max_attempts`/`next_attempt_at`, payload snapshotted so a retry does
  not depend on the subject still looking the same.

When L4's trigger arrives, an `events` table following that shape — `org_id`,
`event_type`, `occurred_at`, `source`, `actor`, `subject_type`/`subject_id`,
`correlation_id`, `metadata` jsonb, `dedupe_key` — is a small additive step, and
emission can be added at existing call sites without restructuring them. **Do not
build an event bus.** A table plus the existing `after()` pattern is sufficient for
a single application, and a broker would be infrastructure with no consumer.

On shared versus product events: only a handful of concepts are plausibly meaningful
outside Remy — `customer.created`, `lead.created`, `appointment.booked`,
`appointment.cancelled`, `appointment.completed`, `customer.feedback_received`.
Everything else (call ringing, transcript processed, knowledge published) is
internal. The rule to respect today is simply: **never let another consumer read
Remy's tables directly.** A stable event or a service call, or nothing.

### 3.4 Permissions, action safety and audit

Nothing in Remy takes an autonomous consequential action today. It books, and it
escalates. Every write is a direct consequence of a customer message in a live
conversation, and there is no path that cancels, moves, refunds or discounts.

That means the four-level model (Observe → Recommend → Approval required →
Automatic) has nothing to govern yet, and building it now would be governing an
empty set. The architectural obligation today is narrower and worth stating
plainly: **the first action Remy takes that a business would want to withhold is the
moment the permission model becomes mandatory, and it must not ship in the same
change as the action it governs.**

Two properties already hold and should be preserved deliberately, because they are
what a permission and audit layer will later attach to:

- **Idempotency is designed in, not bolted on.** `integration_jobs.dedupe_key`,
  `integration_links`' unique indexes, `CalendarEventInput.idempotencyKey`,
  `voice_events.dedupe_key`, and the needs-review `metadata` flag are five
  independent guards against an action happening twice.
- **Consequential actions already funnel through single choke points** —
  `capturePartialLead` for booking, `calendarService` for the calendar. A
  permission check has somewhere obvious to go. Keep it that way; a second booking
  path is what would make this genuinely hard.

Audit today is `console.log` to Vercel plus Sentry. That is thin but honest, and the
`events` table in §3.3 is the natural home for provenance when it is needed.

### 3.5 Reception Intelligence, Schedule Recovery, Revenue Recovery

All three are Remy-owned, none is built, and none is blocked — but each has one
concrete dependency worth recording:

- **Reception Intelligence / Adaptive Etiquette** depends on interaction outcomes
  being distinguishable. `leads.status` already carries a coarse outcome, and
  `metadata` jsonb absorbs detail without migrations. Not blocked.
- **Dynamic Schedule Recovery** is the most demanding, and depends on exactly the
  things C1, C3, L1 and L2 concern: appointment identity, a real end time (not an
  org-default duration), assigned staff, and reschedule history. It cannot be built
  meaningfully on today's model. **This is the strongest argument for treating C3
  and P1 as real** — not because recovery is imminent, but because every appointment
  written before the model is fixed is data that recovery would later have to
  reinterpret.
- **Revenue Recovery** wants missed calls, abandoned enquiries, unfilled
  cancellation slots and unanswered callbacks. `voice_calls.ended_reason` and lead
  statuses already capture most of the raw signal. Not blocked. Keep the *sales
  pipeline* half of this out of Remy — that is Scout's domain, and Remy's job stops
  at the reception-entry opportunity.

### 3.6 Business Memory and the Shared Business Brain

Remy's eventual contribution to a shared brain is reception and customer-entry
intelligence: what customers ask for, when demand peaks, which services are
requested, where booking friction occurs, what escalates. It should not become
responsible for understanding other domains.

The discipline to hold today is about *what gets stored*, and it is already mostly
right: `business_knowledge` is structured and editable with revisions and audit;
transcripts are stored on `voice_calls` and windowed to the last 10 messages when
used for notifications; the needs-review dedup flag is a structured field, not a
log line. Two things to keep resisting: storing conversation transcripts as a
substitute for structured facts, and collecting anything without a current use.

A future memory layer must distinguish verified business facts from AI-inferred
observations, with source and confidence. The knowledge-import tables already model
exactly that distinction (staged, reviewed, approved, published, with confidence on
AI extraction) — reuse it rather than inventing a parallel scheme.

### 3.7 Privacy and data separation

Three categories, and the current architecture keeps them apart correctly:

- **Business/customer operational data** — `leads`, `conversations`, `voice_calls`,
  `business_knowledge`. Tenant-owned, `org_id`-scoped, RLS-protected.
- **NiteOwl's own software and business data** — the code, and `sales_leads` (the
  marketing funnel, correctly having no `org_id` and living behind an `ADMIN_EMAIL`
  gate).
- **Derived intelligence** — does not exist yet.

Nothing today aggregates across businesses, and nothing should start without a
lawful basis, permissions, minimisation and a retention rule decided first. No
change is recommended and none was made. One live item carried over from
`project_pilot_baseline`: sales-chat diagnostic logging containing PII is
deliberately still on in production for the pilot and should be removed afterwards
— that is a pre-existing, owner-known decision, restated here so it is not lost.

### 3.8 Provider independence

**This is the part of the guardrail the codebase already satisfies**, and it needs
no work. `CalendarCapability` expresses NiteOwl domain semantics —
`getBusyIntervals`, `createEvent`, `updateEvent`, `cancelEvent` — not a wrapped
Google API, and emphatically not a `provider.execute(action)` escape hatch. The
booking engine asks `checkBookingSlot`; it never learns which vendor answered.

Deliberate restraints worth preserving:

- `CapabilityId` is `"calendar"` and nothing else. Messaging and CRM interfaces are
  explicitly *not* defined, because inventing message-threading semantics with no
  product behind them bakes in a guess, and a wrong guess is worse than no
  abstraction.
- Credentials are one encrypted blob whose shape the auth strategy chooses, not
  `access_token`/`refresh_token` columns — which is what keeps the first non-OAuth
  integration from needing a migration.
- Providers receive local wall time plus an IANA zone, never a UTC offset.
- Provider implementations are stateless; decryption, refresh and status transitions
  belong to the connection layer.

The one seam to watch: `resolveOrgCalendar` returns a single primary calendar. That
is the right version-1 rule, and it lives in a partial unique index rather than the
table shape, so multi-calendar and per-staff calendars need no redesign.

### 3.9 NiteOwl Core boundaries, and the network

**Nothing should be extracted into a shared core yet.** Every candidate capability
— identity, permissions, integrations, events, audit — has exactly one consumer.
The trigger for extraction is **a second real consumer**, not a possible one.

When that day comes, the natural candidates, in the order they would earn it:

1. **Business identity + membership** — the thing a business should not have eight
   copies of. Today `organisations` + `owner_id`.
2. **The integration framework** — already generic enough to serve another product
   unchanged; it is the least Remy-specific code in the repository.
3. **Events and audit** — only once they exist (§3.3).

Everything else in Remy — booking, availability, reception behaviour, the voice
adapter, the knowledge base, lead capture — is Remy's specialist domain and should
stay Remy's, permanently.

On the opt-in network (routing an unfulfillable request to another participating
business): nothing in the current architecture makes this prohibitively difficult.
It needs stable business identity, service definitions, availability and consent —
the first three exist in some form, and consent is a permission-model concern
(§3.4). No marketplace, directory, routing engine or matching system is built or
recommended. The only thing that would genuinely block it later is per-business
data that cannot be described in shared terms, which is not the case today.

---

## 4. NiteOwl Compatibility Map

Documentation only. **The application must not be restructured to match this
table.**

| Subsystem | Classification | Note |
|---|---|---|
| Booking engine / availability | **Remy-owned permanently** | Remy's core domain. C1 applies |
| Calendar capability contract | Provider-adapter seam — **already correct** | §3.8 |
| Google provider adapter | Provider-specific adapter | Replaceable without touching booking |
| Integration framework (4 tables + registry) | **Likely future NiteOwl Core** | Least Remy-specific code here. Do not extract until a second consumer |
| Appointments | **Remy-owned**, future Business Graph participant | Currently fused into `leads` — C3, P1, L1 |
| Leads | Remy-owned; **shared entity reference candidate** | `lead.created` is a plausible shared event |
| Customers | Not modelled separately today | Would be a Business Graph node and a Core identity candidate — L1 |
| Conversations / messages | Remy-owned permanently | Reception domain |
| Voice / telephony | Remy-owned; provider-adapter candidate | Vapi is directly integrated, not behind a capability contract. Fine — one provider, one consumer |
| Knowledge Base + import | Remy-owned; **future Shared Business Brain contributor** | Already has provenance, review and revisions |
| Business configuration (`organisations`, hours) | **Future NiteOwl Core** (Business Operating Profile) | §3.2, L6 |
| Staff | Does not exist | Seam reserved: `integration_resources.staff_id` |
| Services | Prose in `business_knowledge` only | Structured services are an L6 concern |
| Notifications / email | Remy-owned; shared-contract candidate | Resend behind `lib/email.ts` — one seam already |
| AI / model usage | Remy-owned; provider-adapter candidate | OpenAI called directly. No action — one provider |
| Analytics | Does not exist | Future cross-product event consumer — L4 |
| Authentication | **Future NiteOwl Core** | Supabase Auth. Single-owner today — L7. **Do not migrate now** |
| Permissions | Does not exist | Future Core capability — L5, §3.4 |
| Audit / activity history | Logs + Sentry only | Future Core capability — L4 |
| Billing (Stripe) | Remy-owned today, Core-shaped later | Per-org subscription. Untouched |
| `sales_leads` / marketing site | **NiteOwl-owned, never tenant data** | Correctly separate already |

---

## 5. Verdict

Remy's architecture is in good shape for what is being asked of it. The integration
framework in particular already implements the capability-contract pattern this
guardrail asks for, with better reasoning than most greenfield attempts, and it
should be left alone. Tenant isolation is sound and was verified against production.

The one genuine structural gap is that **a lead, a customer and an appointment are
the same row**. That is a defensible simplification for one-enquiry-one-booking, it
produces one wrong behaviour today (C3), it hides a second (C1), and it is the
single thing that future scheduling capability most depends on. It does not need to
be fixed now. It needs to be *decided* before calendar event writes bake the current
identity into stored external references (P1).

Everything else defaults to LATER, as it should.

---
---

# Part II — Provider Independence and Resilience

Added 2026-08-08, same commit, same rules: **documentation only**, nothing implemented,
no provider migrated, no vendor added, no working integration touched.

Governing principle for this part:

> **MINIMUM CHANGE NOW, MAXIMUM RECOVERABILITY AND PORTABILITY LATER.**

Two things worth saying before the findings, because they shape everything below.

**First: the calendar integration already satisfies most of what a provider-independence
review asks for.** `CalendarCapability` is a genuine domain contract, `IntegrationError`
is a provider-neutral taxonomy, `integrationFetch` gives every provider one timeout and
one retry classification, and Google's client-supplied event id makes creation idempotent
at the provider. That work does not need redoing and this part recommends no change to it.

**Second: the weak points are not where the abstraction is missing — they are where
failure meets truth.** The three findings that matter are all about what Remy *says*
when something below it breaks, and about state that exists nowhere durable.

---

## 6. Provider inventory and coupling

| Provider | Capability | Depended on by | Coupling today | Abstraction justified? |
|---|---|---|---|---|
| **Supabase** (Postgres + RLS + Auth + Storage) | System of record, identity, file storage | Everything | Deep, and deliberately so | **No.** It *is* the source of truth, not a swappable capability |
| **Vercel** | Hosting, serverless runtime | Everything | Thin — see §12 | No |
| **Google Calendar** | Calendar | `providers/google.ts` only | **Fully isolated** behind `CalendarCapability` | Already done |
| **OpenAI** | Language, extraction, datetime parsing | **9 direct `fetch` call sites** | Direct, repeated, no shared client | Later — §8 |
| **Vapi** | Telephony + voice AI | `lib/voice/*` (adapter layer exists) | Moderate; prompt lives in our code | Later — §9 |
| **Resend** | Email | `lib/email.ts` (single seam) | One module, module-scope client | Later; the seam already exists |
| **Stripe** | Billing | `lib/billing/{stripe,provider}.ts` | Behind a provider indirection already | No |
| **Sentry** | Observability | `instrumentation*.ts`, `next.config.ts` | Thin, non-blocking — §10 | No |
| Twilio, Microsoft/Outlook, SMS | — | **Not integrated.** No groundwork beyond the framework's readiness | — | No |

Applying the §5 abstraction test honestly: only OpenAI and Vapi score enough "yes"
answers to be worth a contract *eventually*, and neither scores enough to be worth one
*now*. Everything else is either already abstracted, or is infrastructure rather than a
replaceable capability.

### 6.1 Provider risk matrix

| Provider | Scope | 5-min outage | Multi-hour outage | Account loss | Replace difficulty | Current fallback | Target level | Priority |
|---|---|---|---|---|---|---|---|---|
| **Supabase** | Core candidate | Total: every channel down | Total | **Existential** — all operational state | Very high (Auth + PostgREST + RLS) | None. Backups exist, restore unproven | L2 | **P0** |
| **Vercel** | Core candidate | Total outage | Total | Severe but recoverable — repo is the app | Low–moderate | None | L1 | **P1** |
| **OpenAI** | Remy | Chat/voice cannot answer or extract | Same | Severe: no second provider wired | Moderate (9 sites, 2 models) | Truthful failure everywhere; no fabrication | L3 | **P1** |
| **Vapi** | Remy | Phone line down; web unaffected | Same | Severe: number + assistant config live there | High (real work) | Web/dashboard/calendar continue | L3 | **P1** |
| **Google Calendar** | Provider-specific | Availability unknown → phone stops confirming | Same, indefinitely, **and silently** | One org's calendar only | **Low** — the contract exists | Truthful "unknown"; internal engine continues | L3 | **P2** |
| **Resend** | Shared candidate | Confirmations silently undelivered | Same | Moderate — domain is ours, sender is portable | Low | **None. Not retried, not recorded** | L3 | **P2** |
| **Stripe** | Core candidate | Checkout/portal unavailable | Same; existing access unaffected (grandfathered) | Severe commercially, not operationally | Moderate | Access already granted continues | L2 | **P2** |
| **Sentry** | Core candidate | Monitoring blind | Same | Low | Very low | Operations unaffected — verified §10 | L3 | **P3** |

Nothing else reaches P2. Twilio, Microsoft and SMS are not dependencies because they are
not integrated.

---

## 7. Findings

### CRITICAL NOW

#### R1. A database read failure makes chat and the widget confirm a booking they never actually checked

`getBusinessHoursForOrg` (`src/lib/availability.ts:96`) returns `[]` on **both** "this
business has configured no hours" and "the query failed" — it has the `error` object in
hand and discards the distinction. `isWithinBusinessHours` reads an empty list as
`no_hours_configured` and returns `isAvailable: true`. `isSlotAvailable` fails open too,
returning `true` on a query error with the comment *"don't block bookings on a query
error."*

So a transient Supabase error on the booking path does not produce a degraded answer — it
produces a **confirmed booking**, emailed to the customer, for a time that may be outside
business hours or over capacity.

The codebase already knows this. `voice/availabilityTool.ts:391–406` guards against
exactly it, and says so:

> *"It is wrong on a live call: it would have Remy tell a customer 3 PM is free on the
> strength of a database error, which is exactly what the engine's own 'could not check is
> never it is free' rule forbids."*

That guard is **voice-only, deliberately** — the comment explains it was scoped narrowly
so shared behaviour would not change. The consequence is that the rule the whole calendar
design turns on is enforced on the phone and not on the website.

- **Why CRITICAL NOW:** it violates truthful customer outcomes, on the customer-facing
  path, with no compensating signal. It also compounds C2 from Part I — chat and the
  widget already skip the external calendar, and this means they can skip the *internal*
  checks too without anyone knowing.
- **Why not fixed here:** the fail-open behaviour is deliberate and load-bearing for the
  genuine no-hours-configured case. Distinguishing the two cases is small, but it changes
  what happens to real bookings during a database blip, and that is the owner's call.
- **Smallest honest fix:** have `getBusinessHoursForOrg` return "failed" distinctly from
  "empty", and treat only "empty" as fail-open. `isSlotAvailable`'s error branch gets the
  same treatment. Roughly one function plus two call sites; no schema change.

### PREPARE NOW

#### R2. Fix the idempotency-key contract before calendar writes are wired

`toGoogleEventId(idempotencyKey)` (`providers/google.ts:86`) turns the key into the
**permanent Google event id**, and `createEvent` maps Google's 409 to
`{ alreadyExisted: true }` — which is exactly right, and is the strongest duplicate guard
available.

It becomes a trap the moment writes are wired, in one specific way: if the key is derived
from the lead id (the obvious choice, and the same choice Part I's P1 concerns), then a
**rescheduled** appointment re-deriving the same key will hit the existing event and come
back `alreadyExisted: true` — carrying the *old* time. A caller that reads that as
success reports "booked" for a time Google never moved.

This is a decision plus one rule, not a build:

- The idempotency key must identify **this version of this appointment**, not the lead.
- `alreadyExisted: true` must never be treated as "the calendar now matches" without
  either an update call or a verification read. The field exists precisely so the caller
  has to look.
- Pairs directly with Part I's P1 (`subject_type = 'appointment'`); take both together,
  once, before milestone 5.

> **ADDRESSED 2026-08-08 by milestone 5 (not yet deployed).** `src/lib/calendarSync.ts`
> implements protections 1, 3, 4 and 5 below; protection 2 is satisfied by Google's
> client-supplied event id. The residual race is stated at the end of this section.

#### R3. The check-to-create race, and what an offered slot actually guarantees

Recorded now because it is cheap to design for and expensive to retrofit, and because
the voice flow already offers alternatives that a caller can accept.

**What is guaranteed today.** An alternative offered mid-call is *not* a second guess.
`gatherAlternatives` derives every candidate from the **same authoritative result** as
the original decision: the one `busy` list `checkBookingSlot` already fetched, plus
`findNextAvailableSlot` enforcing opening hours, closed days, lunch, must-finish-before-
closing and internal capacity, plus `fetchHeldSlots` excluding slots another caller has
already requested. A candidate past `externalBusyWindowEndIso` is refused rather than
offered, because silence outside the fetched window is not evidence of free.

So when a caller accepts an offered alternative, that slot was validated against the
external calendar and the internal engine at the moment it was offered. **Re-checking on
acceptance is redundant** and would cost a provider round trip mid-call; the voice model
sometimes does it anyway, which is harmless. *No code change is warranted, and none was
made.*

**What is NOT guaranteed, and will matter the moment `createOrgEvent` is wired.** The
window between "we checked" and "we wrote" is currently unbounded — seconds of
conversation, plus post-call processing. Nothing prevents the calendar changing inside
it: the owner books over the slot in Google, another caller takes it, or a second Remy
call runs concurrently. Today that is harmless, because nothing is ever written and
nothing is ever called booked. It stops being harmless the instant a create can succeed
against a slot that is no longer free.

The protection required at milestone 5 — design intent, not a build:

1. **Re-verify immediately before the write, not at conversation time.** The freshness
   that matters is at the instant of creation. This is the one place a second freeBusy
   call is justified, and it belongs next to the write rather than in the dialogue.
2. **Let the provider arbitrate, not our read.** A read-then-write is racy however
   tightly it is scoped. Google's client-supplied event id already makes creation
   idempotent (`toGoogleEventId`); the remaining need is a conflict answer from the
   provider rather than a second opinion from us.
3. **Order the internal claim before the external write**, so two concurrent Remy calls
   cannot both pass. The internal capacity check is the only thing we fully control —
   and note it is currently exact-timestamp equality, so C1 must be fixed before it can
   serve as a claim at all.
4. **A failed or conflicted create must never become "booked".** It becomes a request the
   owner sees, exactly as an unreadable calendar does today. The three states —
   available / selected-pending / booked — must stay distinct, and only a *successful*
   create may reach the third.
5. **Never re-check in a way that can silently move the appointment.** If the slot has
   gone, the caller is told; the time is not quietly shifted to the next free one.

The voice prompt is already correct for this and needs no change: it says "preferred
time", never booked, confirmed or reserved.

#### What milestone 5 actually built (2026-08-08)

`confirmAppointmentOnCalendar` in `src/lib/calendarSync.ts` is the only path that writes
an event. It is called from `capturePartialLead` at the two points a lead becomes
`booked`, and the lead's status is decided **from its outcome** rather than before it:

| Outcome | Status | Why |
|---|---|---|
| `no_calendar` | `booked` | Flag off, nothing connected, or sync disabled. Every org today — behaviour byte-identical to before |
| `created` / `already_linked` | `booked` | Google holds the event |
| `conflict` | `needs_review` | The slot went while we were talking |
| `unverified` / `failed` / `stale_link` | `needs_review` | Nothing is known, so nothing is claimed |

- **Protection 1 (re-verify at the write):** `checkBookingSlot` runs immediately before
  the create, not at conversation time. An observed external conflict blocks the write
  **regardless of `CALENDAR_AVAILABILITY_BLOCKING`** — that flag governs whether a
  customer is turned away, but writing on top of a busy window is a double booking in
  the business's own diary and is never acceptable.
- **Protection 3 (internal claim first):** the lead row is written in a pending state
  *before* Google is touched, so a crash between the two leaves a recoverable request
  rather than an event with no lead. This is why C1 had to be fixed first — the capacity
  check can only serve as a claim now that it is overlap-aware.
- **Protection 4:** only `created`/`already_linked` reach `booked`, and the confirmation
  email is gated on the same value.
- **Protection 5:** a conflict returns the engine's suggested alternative; it never
  silently moves the appointment.

**The idempotency key is `leadId + startMs`,** which is what makes `alreadyExisted` safe
to trust: the key encodes the instant, so a 409 can only mean an event for *this*
appointment at *this* time. Keying on the lead alone — the obvious choice — would have
re-derived the same id after a reschedule and reported success carrying the old hour.
That is the §R2 trap, and it is now covered by a test that fails if the key is reduced.

**Residual race, unchanged and accepted.** Two concurrent bookings can still both pass
the pre-write check before either writes, because nothing takes a lock. The window is
now milliseconds rather than minutes, and Google's client-supplied id means the loser
gets a 409 rather than a duplicate event — so the failure mode is a false "already
booked", not two events. Closing it properly needs a database-level claim on the slot,
which is L1/L2 territory.

**Not built:** reschedule and cancel do not yet move or delete the event (milestone 6).
`/api/bookings/manage` can therefore leave a stale event behind; `stale_link` exists so
that state is surfaced for review rather than silently confirmed. **This is the immediate
follow-up** and should land before the flag is enabled for a business that reschedules.

### BEFORE SCALE

| # | Item | Why it matters before paying businesses |
|---|---|---|
| **B1** | **A broken calendar connection is invisible.** `needs_reauth` surfaces **only** on Settings → Integrations — no email, no dashboard banner, nothing proactive. Meanwhile the phone correctly refuses to confirm anything. | This *will* fire: the checklist already flags that an unverified Google app in Testing mode issues refresh tokens that **expire after 7 days**. The owner's experience is "Remy silently stopped booking." Truthful, but invisible |
| **B2** | **Email delivery state is not tracked and never retried.** `sendChecked` throws, the caller catches and logs. A booking exists; the customer is simply never told. | §12's degraded-messaging rule explicitly wants confirmation-delivery state tracked separately. Today there is no such state and no record that a send failed |
| **B3** | **`integration_jobs` exists but nothing drains it.** The durable retry queue — dedupe key, attempts, backoff, payload snapshot — is built, migrated, live in production, and has zero rows and zero consumers | It is the right home for B1's notification and B2's retry. Wire it when the first async operation needs it; do not build a second mechanism |
| **B4** | **Every `console.error` becomes a Sentry event** (`captureConsoleIntegration({ levels: ["error"] })`), and soft-fail paths log errors liberally | Quota and cost, not correctness. One noisy org could bury real alerts |
| **B5** | **Rate limiting is per warm instance** (in-memory `Map`), so the effective limit is × the instance count | Documented and deliberate. Fine as an abuse cap; not a quota |
| **B6** | **Restore has never been tested.** Backups were enabled 2026-07-08 on the production project — a Supabase dashboard setting. *Backup exists* ≠ *recovery is proven* | §11 |
| **B7** | **No provider-health model.** Connection status is per-org (`connected`/`needs_reauth`/`error`) with no global signal and no last-success timestamp used for decisions | §13 |

### LATER

| # | Item | Trigger |
|---|---|---|
| L11 | **AI gateway** — 9 hand-rolled `fetch("https://api.openai.com/…")` sites, `gpt-4o-mini` ×8 and `gpt-4o` ×5 hardcoded, each with its own timeout and parsing | A second model provider, or the first time a model id needs changing in one place |
| L12 | **Voice capability contract** — `lib/voice/` is already an adapter layer, and the reception logic (prompt, tools, extraction, lead capture) is ours | Seriously evaluating a second telephony provider |
| L13 | **Email capability contract** — `lib/email.ts` is already the single seam; a contract is one interface away | A second email provider, or SMS |
| L14 | **Lazy Resend client.** `new Resend(...)` at module scope fails the **entire production build** if the key is missing — this already happened 2026-07-20 | Already logged in `CHECKLIST.md` as owner-deferred. Revisit if it recurs |
| L15 | **Microsoft/Outlook adapter** | Customer demand. The framework is ready; this is one provider file |

---

## 8. AI / model boundary

Current usage is simple and, importantly, **already truthful under failure**: every call
site has an explicit `AbortSignal.timeout`, and every one returns a neutral result rather
than a fabricated one. `parseDatetimeToIso` is the model of how to do this — it returns
`{ iso: null, failed: true }`, and the caller's `enforceBookedInvariant` then downgrades
the lead to `needs_review` rather than booking a guessed time. It also applies
`snapToNamedWeekday`, a **deterministic correction over model output**, which is the right
instinct: trust the model for interpretation, verify with code.

What is missing is not safety, it is a single place to change a model id, a timeout or a
retry policy. That is a maintainability argument, not a resilience one, so it stays LATER.

The clean future seam, when it earns its place: one `generateStructuredResult()`-shaped
function taking a task name, returning either a parsed result or an explicit failure —
and never a fabricated one. **Do not build automatic model switching.** Silently falling
back to a different model changes behaviour that tests and prompts are pinned to.

---

## 9. Voice / telephony boundary

The division is already close to correct. NiteOwl code owns the receptionist prompt and
its 13 rules, tool definitions, availability checking, callback/appointment distinction,
lead capture, escalation, extraction and post-call processing. Vapi owns call transport,
audio, and webhook shape — handled in `lib/voice/vapi.ts` and `handler.ts`.

Two things genuinely live at the provider and would have to be recreated on a migration:
the phone number, and the assistant-request/webhook contract. That is an acceptable and
normal cost, and it is far smaller than it would be if the conversation logic lived in
Vapi's dashboard — which was explicitly avoided (the checklist records un-assigning the
dashboard-built assistant so calls hit our server instead).

Post-call durability is genuinely good: `voice_events` stores the raw payload **before**
processing, `(provider, dedupe_key)` makes retries idempotent, and a processing failure
leaves `processed_at` NULL for replay. Two independent structured-extraction paths exist
because the provider's own `structuredData` returns NULL in practice — the transcript
fallback is what carries every real call. That is graceful degradation working.

**No change recommended. Do not migrate.**

---

## 10. Observability resilience — assessed, and fine

- `Sentry.init` runs in `instrumentation.ts` `register()` with `tracesSampleRate: 0`. A
  missing or unreachable DSN disables reporting; it does not prevent startup.
- `captureConsoleIntegration` hooks `console.error` and buffers asynchronously. No
  business path awaits a Sentry response.
- No route reads from Sentry, and no customer-facing outcome depends on it.

**Verdict: observability is correctly non-blocking. No correction needed.** The only
Sentry item is B4, which is about cost, not availability.

---

## 11. Failure isolation, truthful degradation, and recovery

### What happens today, per provider

| Failure | Actual behaviour | Truthful? |
|---|---|---|
| **Google Calendar unavailable** | `getOrgBusyIntervals` → `lookup_failed`; `checkBookingSlot` → `externalCheckFailed`; voice → `unknown`, takes a preference instead of confirming. Lead capture continues, callbacks continue | ✅ Yes — and this is the design's best feature |
| **Google connection dead (`needs_reauth`)** | Same as above, **indefinitely and silently** — B1 | ✅ Truthful, ❌ invisible |
| **OpenAI unavailable** | Datetime parse → `failed`, lead downgraded to `needs_review`; extraction → empty; chat → error to the user | ✅ Yes — nothing fabricated |
| **Vapi unavailable** | Phone line down. Dashboard, widget, calendar, database all unaffected | ✅ Correctly isolated |
| **Sentry unavailable** | Monitoring blind only | ✅ §10 |
| **Resend unavailable** | Booking succeeds, confirmation silently never arrives, nothing recorded — B2 | ⚠️ Partial |
| **Supabase read blip on the booking path** | **Booking confirmed without being checked** — R1 | ❌ **No** |
| **Supabase fully unavailable** | Everything stops. Honest and unavoidable — it is the system of record, not a replaceable capability | ✅ Correct boundary |

### Recovery

- **Point-in-time backups**: enabled on production 2026-07-08. Never restore-tested (B6).
- **Provider mappings survive a restore**: connections, resources and links are all in
  Postgres, not in provider-side state.
- **OAuth reconnection is a supported path**: `saveOAuthConnection` updates the existing
  row on reconnect rather than inserting, and `disconnectConnection` nulls credentials
  rather than merely flagging them.
- **Recovery gap**: `INTEGRATION_TOKEN_ENCRYPTION_KEY` is not part of the database backup.
  A database restored without the matching key holds credentials nobody can decrypt. The
  keyring already supports versioned keys, so this is a *key-custody* question, not an
  architecture one — but it should be written down wherever the restore procedure lives.

---

## 12. Portability — hosting and backend

### Vercel — **ACCEPTABLE**

No `@vercel/*` import anywhere. No `vercel.json`. No KV, Blob, Edge Config or Cron. The
only platform-shaped things are `export const maxDuration = 300` on one route (a no-op
elsewhere) and `after()` from `next/server` (framework, not platform). This is a standard
Next.js application that would run on any Node host. **Do not sacrifice current simplicity
for further portability.**

### Supabase — **WATCH**, and correctly so

| Dependency | Assessment |
|---|---|
| Postgres + SQL + RLS | **ACCEPTABLE** — plain Postgres. Policies are standard SQL. Fully portable |
| PostgREST query builder (`.eq()`, `.or()`, `.maybeSingle()`) | **ACCEPTABLE** — mechanical to port, spread wide but shallow |
| **Supabase Auth** | **WATCH** — the real lock-in. 32 `getUser()` sites, middleware, OAuth, password reset, `auth.admin.getUserById`, and `organisations.owner_id` → `auth.users` FK |
| Supabase Storage | **ACCEPTABLE** — 2 call sites, knowledge import only |
| Realtime / Edge Functions / RPC | **Not used at all** — nothing to unpick |

Auth is a deliberate, high-value trade: it provides sessions, OAuth, password reset and
email confirmation that would otherwise be weeks of work. **Its value currently outweighs
its lock-in.** The one thing to keep true is that `organisations.owner_id` is the only
place identity crosses into business data — which it is.

**Middleware note, checked rather than assumed:** the matcher covers nearly every request
including `/api/*`, but `getUser()` short-circuits locally with `AuthSessionMissingError`
when there is no session cookie (verified in the installed `auth-js` source), so the
widget and voice webhook paths pay **no** auth round trip. Authenticated dashboard requests
do hit Supabase Auth per request; an outage there resolves to `user: null`, which logs
dashboard users out but leaves public routes untouched. Contained.

### Data portability — **gap, documented not built**

There is no export feature. The data is all in Postgres with clean `org_id` scoping, so a
per-tenant export is a straightforward query set rather than an architectural problem. The
categories that should be exportable — configuration, customers, leads, appointments,
knowledge, call metadata — are all structured. Secrets, `credentials_encrypted` and
internal system state must be excluded. **Build when a customer asks or a regulation
requires; nothing today blocks it.**

---

## 13. Provider health, retries and connection model

**Connection model — already right.** `integration_connections` holds tenant, provider,
capability array, auth strategy, status, `last_error`, `token_expires_at`,
`last_verified_at`, provider account identity, and an **encrypted** credential blob under
deny-all RLS. That is essentially the model a future Core would want, built for one
consumer. No change.

**Provider health — the one real gap (B7).** Today's status is per-org connection health
only. There is no notion of *global* provider health, which matters because the two need
different responses: one org's dead OAuth token means "tell that owner to reconnect";
Google being down for everyone means "stop hammering it." The fields to derive both
already exist (`status`, `last_error`, `last_verified_at`). This is a small read-model
over existing columns when it is needed — **not a monitoring platform.**

**Retry policy — half built, half unused.** Timeouts, error classification
(`isRetryable`, `requiresReauth`), `Retry-After` parsing and abort-on-deadline are all
implemented and good. What is missing is anything that *acts* on them asynchronously,
because `integration_jobs` has no drain (B3). Today every provider call is synchronous
inside a request, which is correct while the only operation is a read with a caller
waiting. The moment event writes are wired, the queue is the right home — and it already
enforces the duplicate-action rule through its unique `dedupe_key`.

### Idempotency scorecard

| Operation | Guard | Verdict |
|---|---|---|
| Calendar event create | Client-supplied Google event id; 409 → `alreadyExisted` | ✅ Strong — see R2 for the caveat |
| Calendar event cancel | 404/410 → `not_found` → success | ✅ Idempotent |
| Calendar event update | PATCH, naturally idempotent; `external_etag` stored for conflict detection | ✅ |
| Voice webhook | `(provider, dedupe_key)` unique; duplicate → ack without reprocessing | ✅ Strong |
| Voice lead capture | Layer 1 keyed on the provider call id; replay updates the same lead | ✅ |
| Booking confirmation email | Fires only on the `!booked → booked` transition | ✅ Effectively idempotent |
| Needs-review notification | `metadata.needs_review_notification_sent` + conversation id | ✅ |
| Stripe webhook | SDK `constructEvent` signature verification | ✅ |
| Job queue | `unique (dedupe_key)` | ✅ Built, unused (B3) |

**No current duplicate-business-action vulnerability was found.** This is the strongest
part of the architecture and it is not an accident — five independent mechanisms, each
documented at its site.

### Security and account isolation — inspected, no change recommended

Credentials AES-256-GCM encrypted with a versioned keyring, never stored raw, never
returned to the browser, deny-all RLS on the credential tables (proven against production
in §1.4). Least-privilege Google scopes with a stated rationale. Webhook secrets compared
with `timingSafeEqual`. Separate dev and production Supabase projects. No secrets in
source control. Every kill switch fails closed — anything other than the literal `"true"`
reads as off, so a misconfigured environment yields "no integrations", never "half an
integration against real customers".

The one open item is custody of `INTEGRATION_TOKEN_ENCRYPTION_KEY` relative to database
backups (§11).

---

## 14. Remy vs NiteOwl Core — provider-control boundary

Refining Part I §3.9 for provider concerns specifically. **Nothing is extracted; the
trigger remains a second real consumer.**

| Layer | Classification |
|---|---|
| Booking rules, availability, reception behaviour, prompts | **Remy-owned permanently** |
| `CalendarCapability`, `IntegrationError`, `integrationFetch` | **Core candidate** — the most product-neutral code in the repo |
| `integration_connections/_resources/_jobs/_links` + connection lifecycle | **Core candidate** — already generic |
| Provider health read-model (B7) | **Core candidate** when it exists |
| `providers/google.ts` | **Provider-specific**, permanently isolated |
| `lib/voice/vapi.ts`, `handler.ts` | **Provider-specific** adapter |
| Voice reception orchestration (`assistant.ts`, `availabilityTool.ts`, `extraction.ts`) | **Remy-owned** |
| OpenAI call sites | Remy-owned today; a future gateway would be a **Core candidate** |
| `lib/email.ts` | Shared candidate — one seam already |
| Supabase Auth usage | **Core candidate** (identity), but do not migrate — Part I L7 |

## 15. Redundancy maturity — current standing

| Provider | Level 1 Portable | Level 2 Recoverable | Level 3 Gracefully degradable |
|---|---|---|---|
| Google Calendar | ✅ | ✅ | ✅ *(truthful, but invisible — B1)* |
| OpenAI | ⚠️ 9 sites | ✅ | ✅ |
| Vapi | ⚠️ real work | ✅ | ✅ |
| Resend | ✅ | ⚠️ no delivery state | ⚠️ B2 |
| Sentry | ✅ | ✅ | ✅ |
| Vercel | ✅ | ✅ | n/a |
| Supabase | ⚠️ Auth | ⚠️ restore unproven (B6) | n/a — correct boundary |

**Level 4 (failover) is not recommended for any provider.** No current downtime impact
justifies the complexity, and a second calendar or model provider would add more failure
modes than it removes.

## 16. Part II verdict

The provider architecture is in better shape than the resilience gaps suggest, because the
gaps are not abstraction gaps. Portability is already good, idempotency is genuinely
strong, and degradation is truthful nearly everywhere.

The exception is R1, and it is worth being precise about why it matters: the entire
calendar design rests on *"cannot check is never free."* That rule is enforced against
Google, and enforced on the phone — but a database blip on the website path still produces
a confirmed booking that nothing ever checked. The rule should hold against every provider
below Remy, including the one Remy is built on.

