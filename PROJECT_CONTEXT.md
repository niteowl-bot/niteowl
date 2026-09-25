# NiteOwl AI - Project Context

## Project

NiteOwl AI is a SaaS platform for small and medium businesses.

The first product is **Remy**, an AI Receptionist that answers customer enquiries, books appointments, captures leads and escalates unusual requests to the business.

This repository is the source of truth.

GitHub should always reflect the latest working state.

## How to use this file, and where everything else lives

**PROJECT_CONTEXT.md carries current state once, and points at the canonical record of
everything else. A fact whose home is `docs/ARCHITECTURE.md`, `CHANGELOG.md` or
`docs/REMY_BEHAVIOUR_RULES.md` is referenced here, never restated here.**

This file is loaded into every session through `CLAUDE.md`. It is deliberately kept small
enough to load whole. Nothing has been deleted to achieve that — the material that left this
file on 2026-09-15 moved, verbatim, to the document that canonically owns it, and every
pointer below resolves.

| Document | Owns | Read it when |
|---|---|---|
| **`PROJECT_CONTEXT.md`** (this file) | Current state · shipped / NOT STARTED status · active roadmap · unresolved decisions · hard operating rules · invariants · the canonical-document index | Always — it is auto-loaded |
| **`docs/REMY_BEHAVIOUR_RULES.md`** | The **standing behaviour rules** that keep shipped Remy behaviour from regressing, each with its PR, merge SHA and verification status; the deferred service-matching investigation and its rejected approaches; the PRs #27–#40 live-production verification record | **Before touching voice, booking, timezone, calendar, lead-capture or auth code.** Indexed section by section below |
| **`docs/ARCHITECTURE.md`** | **The sole architecture canon, Parts I–XV.** §21 is the single canonical architecture diagram; the canonical `DecisionRecord` is defined once, at §20.7 | Before any architecture discussion, and before any work that touches a contract |
| **`docs/AGENT_ACCESS_LAYER.md`** | The governed Agent Access Layer, capability registry, autonomy ladder and free-product distribution architecture | Agent authority, capability or free-product distribution questions |
| **`CHANGELOG.md`** | The chronological shipped / PR / verification history — dated entries with SHAs, test totals and production verification | To find out what a given PR did and how it was proved |
| **`CHECKLIST.md`** | Alpha-launch readiness items | Launch-readiness questions |

**Architecture lives in exactly two documents** — `docs/ARCHITECTURE.md` and
`docs/AGENT_ACCESS_LAYER.md` — **and every review extends them rather than adding a third.**
All of it is **documentation only**; nothing in either document has been implemented, and
neither asks for implementation now.

### The architecture parts, and what each settled

Each is a pointer. **Do not restate a Part here** — read it in `docs/ARCHITECTURE.md`.

| Part | Subject | Standing |
|---|---|---|
| **I** | Future-compatibility guardrail; current shape, tenancy, calendar | — |
| **II** | Provider independence and resilience | — |
| **III** | Compounding moat and outcome intelligence; **§20.5 Outcome Spine, §20.6 provenance, §20.7 the canonical `DecisionRecord`, §21 the single diagram, §23 the five link tiers, §24 the Cross-Product Learning Contract, §26 free products, §27 the five privacy gates** | Foundational |
| **IV** | Outcome intelligence, governed agents, resource control (M7–M9) | — |
| **V** | Operational sovereignty and diagnostic intelligence; **§42 the Finding, §43 the Recommendation** (M10–M12) | — |
| **VI** | The Business Problem Case (M13, M14) | — |
| **VII** | Cross-product outcome learning and decision intelligence — **M15–M19, P26–P32.** NOW: none | — |
| **VIII** | Sovereignty and provider escape routes; **§63 the NiteOwl Sovereignty Principle** — *rent commodity capability, own strategic state, intelligence and control*. NOW: none | Two deferred qualifications stand at §68.1: the **Supabase restore has never been tested** and its keyring custody is unverified, and the **phone number's account of record appears to be Vapi's** |
| **IX** | The Intelligence Ownership Layer — **§70's three invariants** (derived never primary; dependencies downward only; rent the computation, own the corpus, recipe and evaluation); S1–S4, P33–P37. NOW: none | — |
| **X** | Compounding advantage and category leadership — **N1–N4** (a customer-owned external system may never become load-bearing; **P39: a free-scan estimate never becomes a measured outcome or a baseline**; a published case study is a governed disclosure; a competitive development is never on its own a NOW). NOW: none | — |
| **XI** | The Business Opportunity Scan MVP contract — **a contract, not a plan** | Phase 1 logic has shipped; the persistence and consent flow it describes have not |
| **XII** | The Scan's three Phase 1 contract decisions | — |
| **XIII** | Decision, Outcome and Impact Provenance; the canonical ten-stage provenance chain — **T1–T3, P44–P46.** NOW: none | — |
| **XIV** | The Scan's intelligence contracts — the funnel, clusters, hypotheses, dependencies, evidence gaps, impact classification. NOW: none | All six contracts are now built (PRs #92, #94, #99) |
| **XV** | **Outcome Learning and Cross-Product Decision Intelligence closeout** (PR #107, merge `3f292c1`, production-verified 2026-09-15; closed out by PR #108, merge `e4c53c7`) — §§109–115. NOW: none | See the standing entry below |

**Parts VII–XV do not redraw §21**, and no Part has created a second `DecisionRecord`.

### Part XV — the standing summary that must not be lost

**"NiteOwl Decision Intelligence" is a name for the coordinated operation of existing
architecture layers 4, 5, 6 and 9** — the Outcome Spine, Decision & Outcome Memory,
Provenance and the Learning Layer — **and is NOT a new service, component, runtime, layer,
store, database, table or second system of record.** The canonical **`DecisionRecord`
(§20.7), Decision Provenance (§93) and Outcome Provenance (§94, §95) are unchanged**, as is
§24's Cross-Product Learning Contract.

Three contracts were added, and all three are **documentation only**:

- **M20 (§110) — the Learned Pattern contract.** A fifth profile of the existing §58.1
  derived artefact — **no table, no store, no record type** — with `maturity`
  (`observation` → `repeated_correlation` → `weak_pattern` → `supported_pattern` →
  `validated_rule`), **no automatic promotion between levels** and `validated_rule` only on
  one of §23's admissible causal bases; denominator discipline; retained
  `contradicting_evidence[]`; **decay by re-measurement, never an arithmetic half-life** — an
  expired pattern is stale, never false; retained supersession; and a **self-citation
  prohibition**. It proposes and never writes facts.
- **M21 (§111) — `support_independence`** (`independent` / `mixed` / `niteowl_influenced`),
  **derived from the provenance of the supporting population, never asserted and never a
  flag**, with a **`validated_rule` ceiling** where the support is wholly NiteOwl-influenced.
  It stops NiteOwl's own recommendations reappearing as independent evidence.
- **M22 (§112) — retention is declared with the record class before the first row** of that
  class is written, never as a per-row judgement afterwards; **no regulatory period is
  invented**; erasure-by-reference and the existing consent boundaries are preserved.

**§114's staged implementation sequence is DOCUMENTED AND NOT STARTED.**
**§114 Phase B (Outcome Learning) is NOT STARTED.** *(Distinct from the Business
Opportunity Scan's acquisition Phase B in §7, whose BC-0 contract is approved and whose
BC-1–BC-3 increments have shipped — two different things that share a letter.)*
**Stage 1 — one append-only tenant-scoped `business_events` mechanism beginning with
`appointment.booked` at the existing booking choke point — is NOT STARTED and NOT APPROVED**,
and its trigger is unchanged and qualitative: the first paying business and sufficient live
use, a reliable production booking path, and enough real resolved outcomes for an evaluation
to mean anything. **No numeric threshold is invented.** **NOW: none** — three PREPARE items
(P52–P54), one LATER (L36). **Remy V1 is unchanged**, and **attendance / no-show learning and
caller sentiment remain explicitly not introduced and not recommended** (§115.3). §115.1
records the risk that now dominates: **the architecture is sufficiently mature that premature
implementation is a larger risk than missing architecture.**
---


# Current Status

**Remy V1 implementation is COMPLETE** under the canonical Definition of Done — *"Does this
stop a normal paying customer from reliably using Remy V1?"*

## Shipped and tested

Complete with no PR recorded against them here: **AI Receptionist · Website Chat Widget ·
Dashboard Preview Chat · Dashboard · Knowledge Base (create/edit/delete) · Business Hours ·
Capacity Management · Double Booking Prevention · Calendar · Lead CRM · Four-step Onboarding
Wizard · Dashboard Setup Checklist · Needs Review Workflow · Dashboard Preview Lead
Separation · GitHub Workflow.**

Everything below shipped with a PR. **Full narratives — root cause, test counts, mutation
results, deployment ids — are in `CHANGELOG.md` and in git history at each merge commit.**
The standing behaviour each one established is in **`docs/REMY_BEHAVIOUR_RULES.md`**.

| Shipped | PR / merge | Caveat that must not be lost |
|---|---|---|
| Dashboard timezone correctness | #17, live 2026-08-14 | — |
| Customer manage-link timezone correctness | #19, live 2026-08-14 | — |
| Email appointment timezone correctness | #21, live 2026-08-14 | — |
| Voice calendar booking | #23, merged 2026-08-18 | **Verified live end-to-end 2026-08-27** |
| External-calendar rescheduling correctness | #25, live 2026-08-19 | — |
| Owner call-summary booking status | #27, live 2026-08-26 | — |
| Service-matcher morphology | #28, live 2026-08-26 | — |
| Truthful voice booking closing | #30, live 2026-08-27 | Live production smoke test PASS |
| Callback urgency owner visibility | #34, deployed 2026-08-31 | **#34 did NOT work end-to-end — a live regression was found the same day.** Corrected by **#35**, live-verified 2026-08-31 |
| Owner booking-status accuracy | #37, live-verified 2026-08-31 | A booking outcome is reported only when a time was actually requested |
| Caller-name integrity | #39, live-verified 2026-09-01 | An email address can no longer manufacture a caller name |
| Required fields before closing | #40, live-verified 2026-09-01 | **Finding A CLOSED.** A model-behaviour prompt correction — only a live call could close it |
| Service-address integrity | #42 `e4d3a95`, 2026-09-01 | **This is what actually closed Finding B**, as deterministic code — not the prompt-only change that entry once proposed |
| Caller-name / email-digit integrity | #43 `c104449`, verified 2026-09-02 | A digit-suffixed email can no longer condemn the caller's real name |
| Canonical owner surfaces | #45 `a7d5102`, verified 2026-09-02 | — |
| Per-call metadata integrity | #46 `869d815`, verified 2026-09-02 | A per-call fact can no longer outlive its call |
| Calendar canonical service location | #47 `97948e3`, verified 2026-09-02 | — |
| Provider-summary source containment | #48 `7c13e6c`, verified 2026-09-02 | **F4 Step 1** |
| Canonical owner facts | #49 `38028df`, verified 2026-09-02 | **F4 Step 2** |
| Narrative-only provider summary | #51 `8906564`, live-verified 2026-09-03 | **F4 Step 3, completing F4** |
| Caller-grounded service integrity | #54 `36805b8`, 2026-09-03 | **F5.** The last of the five caller-supplied voice fields to get a guard |
| Fallback service contract alignment | #56 `a71815d`, 2026-09-03 | The two producers of `service` no longer disagree |
| Empty `structuredData` fallback recovery | #58 `3fdb8df`, 2026-09-03 | Semantic substance, not container existence |
| Service-address authority integrity | #60 `a07a06a`, 2026-09-04 | A same-street house-number conflict records nothing rather than booking the wrong door |
| Partial-`structuredData` email recovery | #62 `c2d48b7`, 2026-09-04 | **The FIRST partial-field recovery; the other omitted fields remain open** |
| Partial-`structuredData` requested-timing recovery | #66 `bd5853a`, 2026-09-07 | **The SECOND; `urgency` and `service` remain open** |
| Urgency representability hardening | #68 `c390f53`, 2026-09-07 | **REPRESENTATION ONLY and behaviour-neutral. NO transcript urgency recovery was implemented; it remains V1.1/later** |
| Returning-customer booking isolation | #70 `8833896`, 2026-09-07 | **Same-conversation rescheduling and voice are unchanged** |
| Auth fragment session consumption | #96 `eeed1f7`, 2026-09-14, SHA-verified | Previously **no code path could consume an implicit-flow fragment** |
| Cross-device password recovery | #97 `8ccddc6`, 2026-09-14 | **V1-VERIFIED in production 2026-09-14.** Production template switched to the `token_hash` link **after** the route was live |

**Feature commits**, where the table above records only the merge commit: #51 `8b41a46` · #54
`97c37b9` · #56 `ea6c0bb` · #58 `eb4641a` · #60 `373cf3b` and `e001f0f` · #62 `6289418` · #66
`837caa7` · #68 `a2c483f` · #70 `72717f5`.

**Free products and industry landing pages** — status and PRs in *Free-Product Strategy*
§1–§3, §7 and §8 below; closeouts in `CHANGELOG.md`.

**Deployment-to-merge correspondence — two evidence classes, recorded rather than glossed
over.** PRs #54, #58, #60, #62, #66, #68, #70, #89, #92 and #94 could not be SHA-verified
(`vercel inspect` exposed no Git metadata; identification rests on the deployment appearing
seconds after the merge with the production aliases). PR #40 and every production PR from #96
to #125 **was SHA-verified** from `githubCommitSha` or the build log's `Commit:` line.

## Standing behaviour rules — index

**Read the rule before changing the behaviour it governs.** Every rule below lives in full,
with its PR, merge SHA and verification status, in **`docs/REMY_BEHAVIOUR_RULES.md`**.

| Rule | Governs | Closed by |
|---|---|---|
| Dashboard timezone | Dashboard appointment times mean the **business's** timezone | PR #17 |
| Customer manage-link timezone | A customer-picked time means business-local; unresolvable zone **fails closed** | PR #19 |
| Email timezone | Emails render in the business's timezone; display **fails soft** | PR #21 |
| **Standing timezone rule** | Instants are stored **UTC always**; a tenant timezone is never hardcoded | all three |
| **Password-recovery and auth-callback** | A recovery link must work from **any** browser or device; fragments consumed once through `setSession()` | PRs #96, #97 |
| **Cross-conversation lead matching** | Identifying the **person** is not identifying the **appointment** | PR #70 |
| Reschedule availability | A reschedule is judged by the same decision every booking path makes; an appointment never conflicts with itself | PR #25 |
| Voice calendar booking status | `VOICE_CALENDAR_BOOKING_ENABLED` is **set in production**; verified end-to-end 2026-08-27 | PR #23 |
| **Voice booking closing** | A live call **cannot know a booking exists**; the spoken closing may claim only what is authoritative | PR #30 |
| **Callback urgency** | Urgency is **not** a callback time; the flag has three states and only `true` acts | PRs #34, #35, #68 |
| **Caller-name integrity** | An email address must never manufacture a caller name | PRs #39, #43 |
| **Closing-gate** | Closing dialogue is forbidden until the required-field gate is satisfied; urgency never opens the gate | PR #40 |
| **Service-integrity** | The canonical service must be grounded in the **caller's own speech**; both producers ask for the same thing | PRs #54, #56, #58 |
| **Service-address authority** | A provider value is not authoritative merely because it is well formed; where neither source can be trusted, **nothing is recorded** | PR #60 |
| **Caller-email evidence** | The provider wins first; evidence is cue- or question-anchored, caller turns only | PR #62 |
| **Caller-timing evidence** | An urgency answer is an **answer**, not an absence; evidence must pin a **day** of its own | PR #66 |
| **Service matching — one known false positive, DEFERRED** | `isServiceConfirmedByKnowledge` can confirm a service the business does not offer, and **fails open**. **`extracted.service` is NOT a trusted service identity.** A list of investigated-and-rejected approaches is recorded there — **do not casually retry any of them** | open |
| Historical record — PR-number discrepancy in `main` | Deliberately **not** corrected; `main` history is not rewritten for a cosmetic message | — |

**The canonical-information architecture below is the invariant all of those rules serve, and
it stays here because it governs every change to the voice path.**
Canonical-information architecture (established across PRs #39, #42, #43, #45, #46, #47, #48, #49, #51, #54):

**ONE CANONICAL FACT → MANY RENDERINGS.** Never several independent readings of the same call, hoping they agree.

- every caller-supplied field is resolved **once**, at the single convergence point in `toExtractedLead` (`voice/calls.ts`), by a deterministic guard: `resolveCallerName`, `resolveCallerEmail`, `resolveServiceAddress`, `resolveRequestedDatetime` and `resolveRequestedService`, plus `resolveCallbackUrgency` alongside. **All five caller-supplied fields are now guarded**; PR #54 closed the last gap. PR #62 replaced the email guard's normaliser-only form with `resolveCallerEmail`, which still calls the unchanged `normaliseSpokenEmail` first, and PR #66 did the same for timing with `resolveRequestedDatetime`, which still calls the unchanged `sanitisePreferredDatetime` first — **four of the five now read the transcript as evidence in their own right** (name, service address, email, requested timing), and only `service` remains null-in/null-out
- **the requested timing is resolved in `processCallEnded` and PASSED IN**, rather than derived inside `toExtractedLead`, because the owner's urgency decision, booking-status gate and requested-time row need the same answer. One derivation, several readers — the parameter is required, with no default, so the field cannot be silently lost by a caller that forgets it
- every downstream consumer reads that **resolved** value — the lead row, the lead's metadata, the calendar event, the owner email and the dashboard. A consumer that reads the raw extraction, or re-reads a stored value independently, is the defect pattern all of these PRs exist to remove
- the facts the owner can now read from **canonical structured rows**, without depending on any generated prose: **Caller · Caller ID · Alternate number · Email · Service address · Service needed · Appointment / Requested appointment / Requested callback · Callback urgency · Booking status**
- **a guard resolves the value, and a provider candidate does not win by default (PR #60).** Being well formed is not the same as being authoritative: where deterministic caller evidence contradicts a candidate, the caller's own words are canonical, and where two sources genuinely disagree with no evidence to settle it, the guard records nothing. **Correct information or safe uncertainty** — never whichever source happened to be read first
- **absence is rendered as absence.** A value a guard refused produces no row, never a fallback and never an older value — the owner is not shown an email nothing was sent to, or an address no engineer was given
- the **provider-generated narrative remains contextual prose and is NOT an authoritative fact source.** It is kept in `voice_calls.summary`, in `leads.message`, and in the owner email beneath the rows, for review and audit. It decides nothing: PR #48 removed it as an extraction input and as a service fallback, and PR #51 removed the seven factual labels it used to restate, so it no longer offers a second reading of any fact a row already carries
- **booking truth outranks completeness.** A confirmed instant is shown only when the calendar actually accepted the booking (`ownerBookingStatus` is the single place that is decided, and it fails closed); a time that was merely requested is shown as requested, in the caller's own words, never re-parsed; urgency is never rendered as a time

Deferred and non-blocking (do **not** pick these up as part of other work):

**CLOSED — recorded here only so a reader scanning the open items does not go looking for them.**

Each closed item's **standing rule** is in the rules sections below. Historical detail (root
cause, validation counts, mutation results, production closeout) is recoverable from Git
history at the named merge commit and, where needed, from this file's pre-condensation
revision using `git show <commit>^:PROJECT_CONTEXT.md`. `CHANGELOG.md` contains the earlier
recorded history where applicable. **Do not re-litigate or re-open these.**

| Item | Closed by | Standing rule / note |
|---|---|---|
| **Finding A** — closing before required fields complete | PR #40, `91d2bc3`, live-verified 2026-09-01 | Closing-gate rule |
| **Finding B** — mangled house number accepted | PR #42 `e4d3a95`, extended by #45 `a7d5102`, #46 `869d815`, #47 `97948e3`, #60 `a07a06a` | Service-address authority rule. Residual facts below |
| **F4** — provider prose restating canonical facts | PRs #48 `7c13e6c`, #49 `38028df`, #51 `8906564`, live-verified 2026-09-03 | Canonical-information architecture |
| **F5** — ungrounded canonical service | PR #54 `36805b8`, deployed 2026-09-03 | Service-integrity rule |
| **Fallback extractor contract** — producer/consumer disagreement on `service` | PR #56 `a71815d`, deployed 2026-09-03 | Service-integrity rule (both producers ask for the same thing) |
| **`structuredData: {}` suppressing the fallback** | PR #58 `3fdb8df`, deployed 2026-09-03 | Service-integrity rule (semantic substance, not container existence) |
| **Service-address authority** — a well-formed provider address outranking the caller | PR #60 `a07a06a`, deployed 2026-09-04 | Service-address authority rule |
| **Partial-`structuredData` EMAIL recovery** (1st field) | PR #62 `c2d48b7`, deployed 2026-09-04 | Caller-email evidence rule |
| **Partial-`structuredData` REQUESTED-TIMING recovery** (2nd field) | PR #66 `bd5853a`, deployed 2026-09-07 | Caller-timing evidence rule |
| **Urgency REPRESENTABILITY** (`true` / `false` / `null`) | PR #68 `c390f53`, deployed 2026-09-07 | Callback urgency rule. **Representation only — urgency RECOVERY is NOT closed and stays V1.1/later** |
| **Returning-customer booking overwrite** (chat/widget; voice never affected) | PR #70 `8833896`, deployed 2026-09-07 | Cross-conversation lead matching rule. Documentation is now consistent: `docs/ARCHITECTURE.md` C3 records it **CLOSED by PR #70**, and `CHECKLIST.md` records it resolved — **no discrepancy remains for this finding** |

**Facts from those closures that are still live and must not be lost:**

- **Speech-to-text mangling is provider-side and is NOT fixed.** The guards refuse noise
  rather than recovering digits, so a caller whose house number is misheard must still
  correct it. **Nova-3 has not been implemented or evaluated**, and no provider or
  transcriber-model change has been made.
- **The transcriber IS repository-side**, contrary to an earlier claim in this file that said
  otherwise. It is added in `buildVapiAssistantResponse` (`src/lib/voice/vapi.ts`), not in
  `buildVoiceAssistantConfig`; the effective production config read back from a live call is
  **`provider: deepgram`, `model: nova-2`, `language: en-GB`**. Keyterm boosting, formatting,
  endpointing, confidence thresholds and fallback transcriber are unset and fall to
  Deepgram/Vapi defaults.
- **NEVER locate an email by enumerating substrings until one validates** (PR #62's rejected
  prototype). Shortest-first turned `john dot smith at gmail dot com` into `smith@gmail.com`;
  longest-first absorbed surrounding speech. A wrong address here is *deliverable*. Candidates
  are whole clauses bounded by the caller's own commas and sentence ends.
- **A mutation that reports clean is a claim about the TESTS, not about the code.** Inert
  mutations were found and the tests fixed — not the claim — in PRs #60, #62, #68 and #70. A
  mutation that fails to apply proves nothing: CRLF/LF anchor mismatches silently no-opped
  edits twice (PRs #60, #68), so **verify the edit landed before trusting a green run**.
- **F5's sixteen regression failures were STALE FIXTURES, not a defect.** Each supplied a
  service its own caller transcript never contained. They were repaired by giving each
  scenario realistic caller speech; **no production invariant was weakened and no assertion
  was loosened to obtain green.**
- **A deterministic code guard CAN be closed by tests driving the real `processCallEnded`; a
  model-behaviour prompt correction CANNOT.** PRs #43, #54, #58, #60, #62, #66, #68 and #70
  needed no live call. PRs #34 and #40 did — an all-green suite proved nothing there.

**OPEN — still deferred:**

- **Magic-link production verification, V1.1/later, NOT a V1 blocker (classified 2026-09-14).** PR #96's fragment consumer is the only code path that can sign a magic link in, and it has been proven by tests and by the recovery flow's fragment forwarding, but a live magic-link sign-in has not been performed: the app issues none, and the dashboard's *Send magic link* can only target production. Check it opportunistically (dashboard action on the test user, fresh Incognito, expect fragment gone and `/dashboard`); **do not record it as verified without doing it.** Related tidy-ups, same classification: the temporary **preview entry in the Supabase Redirect URL allow-list** is no longer needed and its removal is **not yet confirmed**; the mail-scanner single-use exposure of `token_hash` links is unchanged from before and its click-to-confirm mitigation is V1.1.
- **Two production observations are still outstanding, and neither justifies a deliberate call.**
  - **PR #51 (F4).** The verification call was a complete happy path, so it never exercised
    whether the model prefers **silence** over `"Not provided"` on a call with genuinely
    missing fields. Observe on the next naturally incomplete call.
  - **PR #56.** Model obedience to the aligned fallback `service` instruction is unproven. The
    fallback only runs when Vapi returns no `structuredData`, so a deliberate call cannot
    reliably reach it. Confirm on the next real fallback call — log line
    `[voice] provider returned no structured data`.

- **Partial structuredData is never completed from the transcript, NOT started.** When the
  provider supplies *some* substantive fields, that object stays authoritative and the fallback
  extractor does **not** run to fill the gaps — so a call whose transcript plainly contains a
  missing field can still record it as absent. This is today's deliberate all-or-nothing
  producer selection, and PR #58 pins it with a test rather than changing it: running a second
  extractor to complete fields would put two independent readings of one call in play, the
  pattern the canonical-information architecture exists to remove. **Field-by-field completion
  is a separate architectural question and is NOT solved.**
  - **PRs #62 and #66 have closed exactly one field each** — email, then requested timing. PR
    #60 fixed the investigation's one *corruption* finding, on `service_address`, and closed
    none of this. **The remaining information-LOSS findings are open**: an **urgency** and a
    **service** the transcript plainly contains can each still be recorded as absent when
    partial `structuredData` omits them — and a lost `service` additionally closes the booking
    gate, so a legitimate appointment becomes a `needs_review` lead. Do not read any of these
    PRs as evidence that partial `structuredData` is handled.
  - **NEXT: no field is approved.** Email went first because `normaliseSpokenEmail` already
    existed as a deterministic guard and the customer being silently unreachable was the
    sharpest consequence; timing went second because it is the one field Remy's core promise
    cannot function without, and because the recovery is *evidence selection*, not datetime
    parsing. The remaining fields are **not** a queue to work through by default: each needs
    its own investigation, because each needs its own deterministic provenance rule and neither
    of them has one yet.
  - **SERVICE RECOVERY IS V1.1/LATER (classified 2026-09-07).** Under the canonical rule the
    answer is **no**: the owner is told **correctly** — with a requested time present they get
    the *REQUIRES REVIEW* block plus caller, number, email, address, requested time, transcript
    and narrative — so the enquiry is not missed. And the fix is **not deterministic-safe**:
    F5's whole guarantee is that the result is a subsequence of the model's own candidate, and
    with no candidate there is nothing to constrain, so recovery would mean *identifying* a
    service from raw speech — the `requested_service` architecture that is **deferred and not
    approved**, and the approaches its rejected list already forbids. A wrongly recovered
    service is **corruption** reaching the engineer's job title, the KB gate (which has a known
    fail-**open** `requiredMatches` false positive) and the customer's confirmation email.
    **Do not reopen it because PRs #62 and #66 built adjacent machinery** — neither supplies the
    missing piece.
  - **URGENCY RECOVERY IS V1.1/LATER (investigated 2026-09-07).** The loss **fails safe**
    (nothing fabricated, nothing misrouted), **no workflow consumes urgency** — no priority
    queue, routing, SLA or capacity effect, and `organisations.emergency_mode_enabled` is an
    unrelated business-hours setting — the lead is still created in every ordinary shape, and
    the owner still receives a per-call summary carrying the caller's number, the transcript
    and a narrative stating why it is urgent. What is lost is **one advisory row**. **PR #68
    shipped the investigation's independent representability Part only; transcript-based
    urgency recovery is NOT started and is NOT a V1 blocker.**

- **Structured-data observability, NOT started.** Production logs cannot distinguish **no `structuredData`**, **null**, **semantically empty** and **substantive** payloads: the one log line, `[voice] provider returned no structured data`, now covers the first three alike. That is why the real-world frequency of empty envelopes is **unknown**, and why PR #58 could record the shape as schema-permitted but not as observed. **PR #58 deliberately added no logging** — the fix had to stand on deterministic evidence, and telemetry is its own decision. Keep it separate.
- **`intent` counts as substance in the PR #58 emptiness test, NOT a defect and NOT to be changed casually.** A payload of `{intent: "question"}` alone is substantive, so it suppresses the fallback. That is correct under the stated contract — the provider did tell us something — but `intent` is the least caller-derived of the supported fields, so it is named here rather than left as a surprise. **Do not alter `intent` semantics as a side effect of other work.**
- **The customer booking-confirmation surface is not directly observed by any test, NOT started.** `leadCapture` passes the resolved `extracted.service` into `sendBookingConfirmationEmails`, but that email is dispatched inside `after()`, which the voice test harnesses do not flush — so the only surface the **customer** reads is asserted nowhere. This is a **pre-existing coverage gap across every voice suite**, surfaced by PR #56 rather than caused by it. Closing it means teaching the harness to flush `after()`, which is test-infrastructure work. **PR #62 did NOT close it** — it proved the recovered email reaches the `if (customerEmail)` guard's input, but the asynchronous send itself is still asserted nowhere.
- **`stemServiceWord` morphology asymmetry, observed not fixed.** `stemServiceWord("service")` yields `service` but `("servicing")` yields `servic`, so they do not match — a caller saying *"my boiler needs servicing"* reduces the candidate `Boiler service` to `Boiler`. **This predates F5, is shared with service matching and booking permission, and was NOT shown to be an F5 regression**: it fails in the safe direction (reduction, never invention) and breaks no test. It was deliberately **not** changed inside the F5 work, because widening that table would alter PR #28's proven Knowledge Base behaviour for a reason unrelated to it. Keep it separate.
- The remaining `requiredMatches` false positive is **explicitly deferred** pending a safer service-identity architecture. It is **not** to be closed with a matcher tweak — see the service-matching section below for the approaches already investigated and rejected.
- The `requested_service` architectural seam remains **deferred and not approved** (same section).
- **Rule 11 recap wording, minor and pre-existing.** The recap can still say the team will contact the caller by phone while the final closing points at the confirmation email. Both statements are true and the closing itself is single and coherent, so no truthfulness rule is broken. It predates PR #30 and was deliberately left alone.
- **Speech-to-text noise, observed not fixed.** The 2026-08-27 smoke test mis-heard a spoken email twice before the read-back loop settled on the correct address, and stored "Galway" as "Galloway". The read-back behaved correctly; these are transcription artefacts, not booking defects.

---

# Current Work

**Remy V1 implementation is COMPLETE** under the canonical Definition of Done —
*"Does this stop a normal paying customer from reliably using Remy V1?"* A read-only
reconciliation across PROJECT_CONTEXT.md, CHECKLIST.md and docs/ARCHITECTURE.md found no
remaining production-reachable V1 implementation blocker.

**One V1 blocker WAS found after that reconciliation, and is now CLOSED (2026-09-14):**
password recovery did not work in production — closed by **PR #96** (merge `eeed1f7`) and
**PR #97** (merge `8ccddc6`), **V1-verified in production 2026-09-14**; judged by the canonical
rule (a locked-out customer cannot use Remy V1), not by appetite. Magic-link sign-in is
**deferred to V1.1/later and is not a V1 blocker**. Record: the *Password-recovery and
auth-callback* rule in `docs/REMY_BEHAVIOUR_RULES.md`; `CHANGELOG.md` 2026-09-14.

**The one remaining launch prerequisite is EXTERNAL and is not Remy work.**

- **Google consent screen: PUBLISHED / In production (2026-09-07).** Audience is External;
  the app is no longer in *Testing*.
- **Google OAuth / Data access verification: SUBMITTED — UNDER REVIEW BY GOOGLE
  (2026-09-07).** Branding is verified and Google is reviewing the submitted requirements.
  **This is NOT approved, and must not be recorded as completed until Google actually
  approves it.**
- The sensitive scopes under review are **`calendar.events`**,
  **`calendar.calendarlist.readonly`** and **`calendar.freebusy`**, plus non-sensitive
  **`openid`** and **`email`**. (`calendar.readonly` was deliberately dropped and is not
  requested — `src/lib/integrations/providers/google.ts:42-48, 65-71`.)
- **No code, scope, credential or configuration change can advance the review.** Nothing
  further is required from us unless Google's reviewers come back with questions.
- **The 7-day Testing-mode refresh-token expiry risk is CLOSED**, because publication ended
  it: a business's calendar connection will no longer silently drop after a week. While
  review is pending the app may still show an unverified-app warning and remains subject to
  Google's unverified-app user cap — a friction and scale limit, not the disconnection bug.

The full record lives in `CHECKLIST.md` (the OAuth items and the published consent screen);
PR #74 recorded this status and its production closeout passed — deployment Ready on the
production aliases, `/api/health` HTTP 200 with `"database":"ok"`, homepage HTTP 200.

**WHILE GOOGLE REVIEW IS PENDING, DO NOT INVENT ADDITIONAL V1 WORK TO FILL THE WAITING
PERIOD.** The correct state is waiting, not building.

- **All V1.1/later items remain deferred and must not be reopened**: transcript urgency
  recovery, partial-`structuredData` service recovery, the appointment/customer/enquiry
  identity-model redesign, the `requiredMatches` matcher false positive, booking-confirmation
  test infrastructure, structured-data observability, `stemServiceWord` morphology, Rule 11 /
  STT wording, the prompt budget, the dashboard-preview toast, **magic-link production
  verification, and the click-to-confirm mitigation for `token_hash` link pre-fetching**.
- **The timezone-selection UI stays conditional and deferred.** No code path writes
  `organisations.timezone`, so every organisation inherits `Europe/London`. That is correct
  for the current Ireland/UK-compatible launch scope and harmless there. **It becomes a V1
  blocker the moment a business outside that offset is onboarded**, and must ship before any
  such expansion.
- **Booking buffer — V1.1/later candidate, NOT implemented and NOT approved**: configurable
  minimum gap between a new appointment and an existing calendar event. If approved later,
  design it fresh against the current provider-independent booking/integration architecture;
  do not reuse the superseded PR #1 implementation.
- **Newly discovered work is judged by the canonical rule, not by appetite.** If it stops a
  normal paying customer from reliably using Remy V1 **and is reachable in production code**,
  investigate it as a possible V1 blocker. If it does not, it belongs in V1.1/later — a nicer
  implementation, a theoretical edge case, cleaner architecture or added convenience is never
  on its own a reason to promote something into V1.

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

# Free-Product Strategy

**Canonical as of 2026-09-09.** This section records the free-product **line-up, positioning
and routing**. It deliberately adds **no architecture**: the architecture for free products
already exists and is not restated here —

- `docs/ARCHITECTURE.md` **§26** — the staged model, full value delivered before any account
  exists, assessment data in its own namespace with no `org_id` until explicit consent,
  self-reported inputs promoted as `business_provided` and never `verified`, and findings that
  carry their confidence and their evidence
- `docs/AGENT_ACCESS_LAYER.md` **§25** — repeat usage linked by a bearer token the visitor
  holds and never by an inferred identity, structural namespace isolation, and the provenance
  floor on cross-visitor learning
- `docs/ARCHITECTURE.md` **§76 (N2)** and **§77 (N3)** — Part X's two rules about what a free
  scan may assert and what may later be published about a named customer

**Free products are an extension of the canonical architecture, not a second one.** They sit
under the same hierarchy: provider-neutral canonical data → Business Graph → Business Memory →
orchestration and governed action → cross-product measured outcome learning → proprietary
Decision Intelligence (`docs/ARCHITECTURE.md` §63.1, unchanged).

**Status of everything below: NOT STARTED unless explicitly marked shipped.** Nothing here is
Remy V1 or V1.1 work and nothing here is a NOW item. What has shipped is recorded once, in the
tables that own it: the Setup Kit (§3), the Business Opportunity Scan's six Phase 1 increments
(§1 *What has shipped*), the Organic Acquisition Engine phases (§7) and the industry landing
pages (§8). Nothing else is started or approved for implementation.

## 1. Flagship — NiteOwl Business Opportunity Scan

The flagship free acquisition and discovery product. Its purpose is to identify
evidence-backed opportunities and problems: revenue leakage · missed enquiries · weak
follow-up · unused capacity · booking and scheduling friction · cash-flow friction · marketing
inefficiency · operational bottlenecks · retention problems · repeat-business opportunities.

**Its contracts are `docs/ARCHITECTURE.md` Part XI (§80–§86, the MVP contract — *a contract,
not a plan*), Part XII (§87–§90, the three Phase 1 decisions) and Part XIV (§100–§108, the
intelligence contracts).** Parts XI and XII schedule nothing and create no NOW item.

**It must distinguish four things, and the distinction is the product:**

| It says | Which means | Already expressible as |
|---|---|---|
| **Observed fact** | Something that happened, or a value read | `observed` (§20.6), with `evidence_scope` (§57.1) |
| **Inferred finding** | A judgement NiteOwl made on evidence | A Finding — §42.2, with its `hypotheses[]` and `contradicting_evidence` |
| **Estimate** | A number NiteOwl produced, not one it measured | `derived`, never `observed` — Part X **P39** |
| **Assumption** | What had to be taken as true to get there | `assumed` (§20.6), carried in the Finding's `assumptions` |

**Where impact is estimated, the evidence, assumptions and confidence are exposed rather than
invented precision** (§26, §43.2). Part X **P39** adds the one the commercial framing makes
easy to forget: **an estimate never enters the Outcome Spine as a measured outcome, and never
becomes the baseline a later paid outcome is graded against.**

### What has shipped

**Each entry's full closeout — files, test counts, mutation checks, deployment ids, the
"what this merge does NOT approve" list — is in `CHANGELOG.md` at the dated entry for that
PR.** Nothing below is Remy V1 or V1.1 work.

| Increment | PR / merge | What it is |
|---|---|---|
| Phase 1 pure logic | **#84** `7d242d8`, 2026-09-11 | Five pure modules under `src/lib/freetools/` — the nine questions, validation, the deterministic finding engine over three condition codes, E1 Lost Revenue sizing, the frozen `estimate_basis`. **Logic only, no product surface** |
| Phase 1 recommendation layer | **#87** `6055f64`, 2026-09-11 | One deterministic recommendation per finding, keyed by `finding.condition` alone. `proposed` / `recommend` / `derived_deterministic` — **it authorises nothing**. Q1/Q2-aware routing deferred |
| Phase 1 public surface | **#89** `f3ab620`, 2026-09-12 | The questionnaire and report a visitor actually uses. **It stores nothing** — no storage, cookie, query string, API route, database write or network call |
| Enquiry funnel diagnosis (**PR D**) | **#92** `97dda2b`, 2026-09-13 | The five-stage funnel, earliest-leak detection, versioned prioritisation, dependencies, four-state impact classification, evidence gaps. **No stage can ever be `observed`** |
| Opportunity clusters (**PR E**) | **#94** `4cfd87d`, 2026-09-13 | Deterministic pairwise relations between existing findings. Phase 1 emits `sequential_in_one_process` and `independent` only; the other three stay declared and unreachable until their canonical models exist |
| Diagnostic hypotheses (**PR F**) | **#99** `33171f0`, 2026-09-14 | *"What might be behind this"* — evidence-referenced candidate explanations from a closed rule table, ranked with **no winner**, tentative wording only. **An explanatory layer, never proof of causation**; `shared_cause_candidate` NOT activated |

**All six Part XIV contracts are now built. PRs D, E and F are complete and closed.**

### What is NOT built, and what none of those merges approves

Persistence of a run · run identity or bearer-token linkage · the consent and promotion flow
(Part XII §89) · any database, schema, migration or RLS · tenant or `org_id` identity · a
`DecisionRecord`, Spine event, Business Memory or Business Graph write · outcome or impact
measurement · any Part XIII provenance runtime · cross-product learning · any model call,
prompt or provider change · Q1/Q2-aware routing · Setup Kit pre-fill · scenario output
(**L35**) · `evidence_refs[].role` (**P49**) · `shared_cause_candidate` activation · a second
business process · a fourth condition code · and every later Scan phase. **Each is its own
decision, and the next Scan increment needs its own approval.**

### Open non-blocking items

- **S1–S5 and N.1–N.4** from the PR #84 reviews — confidence levels and cap policy the
  implementation chose and canon does not yet specify; a displayed low of 0 after outward
  rounding; recomputation not re-running eligibility; two stale prose comments. Recorded in
  `CHANGELOG.md` under PR #84.
- **Keyboard-only navigation of the Scan surface was NOT performed** (PR #89). It is an
  **unperformed manual check, not a pass**, carried to V1.1/later. The non-blocking judgement
  rests on code evidence — native interactive elements throughout, no `tabIndex` override, no
  custom widget or focus trap, errors already carrying `role="alert"`. **Do not later record
  it as verified without actually performing it.**
## 2. Lost Revenue Scan

**PHASE 1 SIZING LOGIC SHIPPED with PR #84 (`scanLostRevenue.ts` — E1 only); the entry
experience SHIPPED with PR #105 (A-2b, §7) — framing / entry only, no shorter questionnaire.** A **major module and acquisition hook within** the Business Opportunity Scan —
not a separate product line. It may also be surfaced as a **narrower standalone entry
experience** where that is commercially useful; the underlying finding is the same finding.

The canonical relationship:

```
Business Opportunity Scan  →  Lost Revenue finding  →  recommended action
```

**A finding needs no new artefact.** Everything the scan's findings must carry already has a
canonical home, and duplicating it would create the rival record §48.3 exists to prevent:

| A finding carries | Where it already lives |
|---|---|
| Evidence and provenance | §20.6, §20.7's `evidence_refs`, as-of per **M15** |
| Diagnosis | The Finding profile — §42.2 |
| Confidence | §20.6, on the assertion that carries it |
| Estimated impact where appropriate | `expected_effect` — §43.2's range / direction / *unknown* rule |
| Assumptions | §42.2 `assumptions`, source type `assumed` |
| Recommended action | A `DecisionRecord` with `action_status: proposed`, `addresses_finding_id` — §43.1 |
| Relevant NiteOwl product or capability | A **routing attribute** on the recommendation, expressible with the existing `source_product` / capability references — not a new record type |
| Measurable success criteria | §20.7 rule 7 — **written before the outcome is known** |

## 3. AI Receptionist Business Setup Kit — COMPLETE

**SHIPPED. DO NOT REBUILD.** V2.0 is complete per the owner; the repository carries no version
marker, so that version number is recorded as stated rather than verified. The surface is
`src/app/free-tools/ai-receptionist-setup-kit`, shipped by **PR #77** (`d5081f2`) and **PR #78**
(`f702d78`, PDF save/export).

**What it is, verified in the code rather than assumed:** a client-side wizard with **no
persistence, no auth, no network, no API route, no database table and no cookie** — the answers
live in client memory for one page view — and **no Remy or provider imports**: nothing reaches
`leadCapture`, `lib/voice`, availability, `calendarSync` or integrations. It therefore satisfies
§26's staged model trivially, because it stores nothing at all.

Its canonical position in the line-up:

```
Business Opportunity Scan  →  Lost Revenue / enquiry finding
    →  AI Receptionist Business Setup Kit
    →  Remy, where continuous automation is justified
```

**It remains useful without buying Remy**, which is the point — it helps a business define and
improve call and enquiry handling, booking rules, FAQs and approved business knowledge,
escalation, human handoff, follow-up and reception workflows, whether or not anything is ever
automated.

## 4. FAQ / Knowledge Builder — retained, repositioned

**NOT IMPLEMENTED, NOT STARTED, and deliberately not implemented as part of recording this
strategy.** The previously planned *NiteOwl Free Tools — FAQ / Knowledge Builder — Phase 1 only*
is **retained but repositioned as a supporting free tool, not the flagship acquisition
product** — that position now belongs to the Business Opportunity Scan.

Its eventual role is to help a business create **structured, approved knowledge** that is useful
on its own and can later support Remy and other authorised NiteOwl capabilities. Structured
knowledge with an approval step already exists in this codebase as `business_knowledge`'s
staged → review → approve → publish pipeline (§20.6), which is what such a tool would eventually
feed **through explicit consent**, never directly.

## 5. Canonical free-product funnel

```
free tool  →  identify measurable value or problem  →  evidence and diagnosis
   →  recommended action  →  practical implementation help where appropriate
   →  relevant paid NiteOwl product  →  measured outcome  →  learning
```

**DO NOT ROUTE EVERY PROBLEM TO REMY.** A scan that finds a cash-flow problem and recommends an
AI receptionist is the failure this line exists to prevent. Each finding routes to the product
that actually addresses it:

| Problem class | Product |
|---|---|
| Missed enquiries, reception, booking and scheduling friction | **Remy** |
| Cash-flow friction, overdue cash, margin | **Ledger** |
| Opportunity discovery and new demand | **Scout** |
| Marketing inefficiency and attribution | **Pulse** |
| Operational bottlenecks and process exceptions | **Forge** |
| Retention problems and repeat-business opportunities | **Beacon** |
| Personal execution and follow-through | **Nova** |
| Anything else | A future NiteOwl product, or **no product** — see below |

**Only Remy exists.** Ledger, Scout, Pulse, Forge, Beacon and Nova are named here to fix
routing boundaries, exactly as Parts III–X name them; none is built, scaffolded or depended on
anywhere in this repository, and naming one here starts nothing. Where no NiteOwl product
addresses a genuine finding, **the honest output is the finding and its recommended action with
no product attached** — §50.4's *NiteOwl is allowed not to know* applied to the commercial side.

## 6. Distribution flywheel

```
useful free product  →  measurable value  →  trust  →  sharing and referrals
   →  adoption  →  paid product where appropriate  →  measured outcome
   →  stronger Decision Intelligence  →  better future outcomes  →  more adoption
```

**A free product must deliver genuine standalone value and must never be deliberately crippled
to force conversion.** §26 already states the architectural half — *if the report is worthless
without signing up, it is an advertisement wearing a diagnostic's clothes* — and this is the
commercial half of the same rule.

Two existing constraints govern the arrows the flywheel adds, and neither is relaxed here: what
compounds is **which recommendations were acted on and what measurably changed**, never what
visitors reported (`AGENT_ACCESS_LAYER.md` §25.2); and **sharing a named customer's result is a
governed disclosure**, with per-claim consent and evidence frozen as of publication, that is an
**output of the learning loop and never an input to it** (Part X **N3 / P40**).

## 7. Organic Acquisition Engine

**Canonical as of 2026-09-14. An extension of the existing architecture, not a second one.**
The engine is the distribution / acquisition layer on top of §1–§6 above and the architecture
they already rest on — `docs/ARCHITECTURE.md` §26, §72.2 S3, §76, §77, §84.3 and
`docs/AGENT_ACCESS_LAYER.md` §25. A read-only reconciliation against canon found **no
conflict**.

**Binding rules for every phase:** free value is delivered before any commercial ask, and
never crippled to force one · **no visitor identity is ever inferred** (no fingerprint, IP,
domain or behavioural matching) · acquisition surfaces reuse the canonical Scan findings,
hypotheses, recommendations and routing — **no parallel SEO diagnosis or recommendation
engine** · **no invented statistics, benchmarks, reviews, ratings, customer results or
location pages** · **a free Scan estimate never becomes a measured outcome** · every external
SEO / analytics / email provider is registered under S3 / P37 before it is depended on ·
**aggregate acquisition measurement, visitor journey tracking and measured business outcomes
are three different things** and are never conflated · **a competitive or growth argument is
never on its own a NOW** (§78).

| Phase | Scope | Status |
|---|---|---|
| **A-1 — Discoverability Foundation** | public-route inventory, `sitemap.xml`, `robots.txt`, per-free-tool canonical / OpenGraph / Twitter metadata, truthful JSON-LD, internal-link verification | **SHIPPED** — PR **#101** `fcd2e68`, production-verified 2026-09-14 |
| **A-2a — Problem-led discovery pages** | three indexable problem pages, one per canonical condition class, canonical wording only, every CTA into the unchanged nine-question Scan | **SHIPPED** — PR **#103** `adb30c7`, production-verified 2026-09-14 |
| **A-2b — Lost-Revenue entry** | a Lost-Revenue *framing / entry* page into the same nine-question Scan — no shorter questionnaire | **SHIPPED** — PR **#105** `31bbd45`, production-verified 2026-09-14 |
| **Homepage direct Scan entry** (not a new phase — one marketing line on an existing page) | the flagship free product one click from the homepage: a secondary CTA beneath the existing primary free-trial CTA, linking the canonical `SCAN_PATH` bare | **SHIPPED** — PR **#131** `a25ccfd`, production-verified 2026-09-20 |
| **B — Optional post-result contact** | one optional contact card after the complete report — **contact only**: no measurement, no visitor identity, no continuity, no product routing | **CONTRACT APPROVED (BC-0, 2026-09-20); BC-1 SHIPPED (PR #135); BC-2 SHIPPED (PR #137, production-verified 2026-09-24); BC-3 SHIPPED (PR #139, production-verified 2026-09-25) — Phase B COMPLETE** — scope locked below. Aggregate measurement was **removed from Phase B** and is excluded |
| **C — Consented continuity** | save / return to a result, repeat-run comparison, governed personalised share — the `AAL §25.1` / §89.1 bearer-token run identity | **NOT STARTED** — its own approved increment; §86.1 / §108.1 NOT IN until then |
| **D — Governed outcome-based compounding** | measured conversion / outcome learning, privacy-safe cohorts, governed benchmarks and case studies, cross-product decision intelligence | **NOT STARTED** — only when paid products produce real measured outcomes on the Spine and canonical provenance permits it |

**Full closeouts for A-1, A-2a, A-2b and the homepage Scan CTA — files, tests, pinned
guarantees, production
verification — are in `CHANGELOG.md` at the dated entries for PRs #101, #103, #105 and
#131**, and every guarantee they established is pinned by `tests/organicDiscoverability.test.mjs`
and `tests/organicLostRevenueEntry.test.mjs`. Two are **do-not-repeat rules that stay here**: every
Scan CTA is the literal Scan path with **no query string, hash, prefill or carried state**; and
**`isPrivatePath` is segment-aware — a substring check wrongly flags `/booking` inside
`…/problems/booking-back-and-forth`; do not repeat that check.** The sitemap now carries
**twelve** approved public URLs — the ten above plus the two industry pages in §8.

**The homepage direct Scan CTA (PR #131, merge `a25ccfd`, production-verified 2026-09-20) is
SHIPPED and is marketing content only.** One secondary line sits beneath the unchanged primary
**Start Your Free 14-Day Trial** CTA — *"Not ready to start? Run the free Business Opportunity
Scan — nine questions, no account, nothing stored."* — linking the canonical `SCAN_PATH`
**bare**, under the same do-not-repeat rule above: no query string, hash, prefill, carried
state, tracking parameter or visitor identifier, and the literal path is never written by hand
on the page. The general **Free tools** navigation link is unchanged and remains the broader
path. **No account, no storage and no tracking are introduced** — the merge added no analytics,
cookie, storage, email, telemetry or PII collection, and the tests pin that. **The Business
Opportunity Scan itself is unchanged and remains the canonical free acquisition product** (§1):
no Scan implementation, question set, `SCAN_QUESTION_SET_VERSION`, route, metadata, sitemap
entry or product architecture changed, and **no Remy V1 code was touched.** Phase B was
**NOT STARTED** at that merge — a homepage link is not a contact capture or a measurement
mechanism; Phase B shipped later, below.

### Phase B — the optional post-result contact: CONTRACT APPROVED (BC-0), BC-1, BC-2 and BC-3 SHIPPED — COMPLETE

**The contract is approved and lives in `docs/ARCHITECTURE.md` §26.1 — read it before any
Phase B work.** **BC-1 is SHIPPED (PR #135, merge `6e4a40b`) — the pure validation module only. BC-2 is SHIPPED (PR #137, merge `19d1274`, production-verified 2026-09-24) — the `/api/free-tools/scan-contact` intake and the nullable `sales_leads.source` column; closeout in `CHANGELOG.md`. BC-3 is SHIPPED (PR #139, merge `f6a5ee6`, production-verified 2026-09-25)** — `ScanContactCard.tsx` below the complete report, screen-only, no props, posting only the validated contact; the intro wording corrected; closeout in `CHANGELOG.md`. **Phase B is COMPLETE; no further Phase B increment exists or is approved. Remy V1 and the
Business Opportunity Scan engine are untouched.**

**Observation, NOT a Phase B change and NOT approved work:** the site-wide client Sentry SDK
(`src/instrumentation-client.ts`, since `79cf835`, 2026-07-04) sends `session` envelopes from
every page, the Scan included. Verified 2026-09-25 to carry no answer, report or contact
data — but it is a request to a third party that the Scan's "nothing is sent" wording does not
mention. **Recorded for an owner decision; nothing was changed.**

**Phase B adds exactly one thing: an optional contact card after a complete Scan report** —
name, one of email or phone, optional business name, optional message — stored through the
existing `sales_leads` path. **The report stays unconditional, complete and printable whether
the card is used or ignored, and the anti-funnel suite must pass unmodified.** No measurement,
no visitor identity, no continuity, no product routing, no analytics, cookie or fingerprint.

**The two rules this rests on are promoted into `docs/ARCHITECTURE.md` §26 and are not
restated in full here: NO FREE-TOOL OUTPUT TRAVELS WITH A CONTACT, AND NONE IS EVER JOINED
TO ONE** — no answer, finding, recommendation, estimate, condition code, version stamp, run,
session or visitor id, and **no prefill in either direction** — **and A CONTACT IS A NITEOWL
FUNNEL RECORD, NOT ASSESSMENT DATA**, so it lives in the existing `sales_leads` separation,
never in the assessment namespace, never with an `org_id`, never matched against
`organisations`.

**Three owner decisions, approved 2026-09-20 and recorded in full at §26.1:** a **nullable,
no-default, no-backfill `sales_leads.source`** column, whose migration is **verified against
the confirmed production Supabase project, never assumed** · **12-month retention for
Scan-originated contact leads ONLY** — a documented rule with no purge automation, leaving
every other `sales_leads` row's lifecycle **unchanged** · **the existing `checkRateLimit`
pattern**, where request-header / IP data is transient rate-limit input that is never
persisted, attached to the lead, cookied, fingerprinted or treated as visitor identity.

**Deferred by name: Scan Next-Action Routing (`scan-next-action`)** — linking a report to Remy
or another product. **NOT APPROVED, and approving Phase B does not authorise it.** It carries
**no BC number on purpose**, so deferring it can never be read as deferring **BC-2, which is
REQUIRED** — the card depends on that intake. **Anonymous funnel measurement is EXCLUDED from
Phase B.** Still excluded: Scan run persistence · bearer-token run identity (**Phase C**) ·
§89 consent and promotion · emailing the report · Spine / Memory / Graph writes · **Stage 1** ·
**Phase D**.

| Increment | Scope | Status |
|---|---|---|
| **BC-0** | The §26.1 contract, its two promoted §26 rules and the retention declaration | **APPROVED 2026-09-20** |
| **BC-1** | `src/lib/freetools/scanContact.ts` — pure field list, validation, refusal codes | **SHIPPED** — PR #135, head `54862d6`, merge `6e4a40b`, 2026-09-20 |
| **BC-2** | Intake: `/api/free-tools/scan-contact`, the additive `sales_leads` entry point, the `source` migration, the existing email notification, `checkRateLimit`. **REQUIRED** | **SHIPPED** — PR #137, head `36d271b`, merge `19d1274`, production-verified 2026-09-24 |
| **BC-3** | `ScanContactCard.tsx` below the report, the intro-wording correction, extended surface pins, print-hidden | **SHIPPED** — PR #139, head `ccfb02b`, merge `f6a5ee6`, production-verified 2026-09-25 |

**The unresolved A-2 decision, preserved rather than assumed: do NOT create a shorter
Lost-Revenue questionnaire.** The Scan's input contract is nine load-bearing questions, six
required (§87.2), with `validateScanAnswers` the sole refusal authority and one
`SCAN_QUESTION_SET_VERSION`. **A Lost-Revenue surface remains framing / entry only** — a
different landing and emphasis into the same nine questions and the same `buildScanReport` —
**unless a separately approved decision creates a new `SCAN_QUESTION_SET_VERSION`** and states
its §107.3 comparability consequences.

**The public-content rule, now established by A-2a and A-2b:** a problem or entry page takes
its business wording from canonical constants, may explain general mechanisms in hedged terms,
and **may not assert a cause for a specific business, a statistic, a benchmark, a customer
result or a location**; no page exists without genuine content.

## 8. Industry landing pages

**Canonical as of 2026-09-16. Marketing / acquisition surfaces for the ONE Remy — not separate
Remy implementations.** Each page is one content constant in `src/lib/site/industryPages.ts`
rendered by the **ONE shared `IndustryPageView`**; presentation varies only through
**controlled typed presentation variants** (closed unions, static classes, every default the
plain shared page) and there is **no per-industry implementation fork** — a third industry is one
more constant, never a bespoke view. Nothing under Remy core is keyed by industry (pinned by
test). Funnel: industry page → the unchanged nine-question Scan → Remy. **Two live pages**, both
in the sitemap: `/ai-receptionist-for-plumbers` (PR #112, merge `e8a26e6`) and
`/ai-receptionist-for-electricians` (PR #118, merge `9a17b2c`), production-verified 2026-09-16.

**Rules.** Industry-specific wording — the FAQ heading included — belongs in the content object,
never hard-coded in the shared view (PR #119, merge `b731acd`). **The truthfulness guard is
mandatory: no visual, workflow or copy may imply booked, dispatched, diagnosed, certified or any
outcome Remy did not produce** — a visual shows the request or captured state; the
`tests/industryPresentation`, `industryPainLayouts` and `industryWorkflow` suites pin it page-wide.

**Differentiation ships in slices, each through the same typed contract:**

| Slice | Status (each shipped slice production-verified on its dated entry) |
|---|---|
| **1** — presentation contract + hero visuals (`theme`, `hero_visual`) | **SHIPPED** — PR #121, merge `8838934` |
| **2** — pain layouts, capability priority, trade copy (`pain_layout`) | **SHIPPED** — PR #123, merge `e06d266` |
| **3** — workflow motifs, section order, mid-page Scan CTA (`workflow`, `section_order`, `mid_cta`) | **SHIPPED** — PR #125, head `762bfb9`, merge `3565411` |
| **4a** — how-it-works copy differentiation | **SHIPPED** — PR #128, head `374b4d6`, merge `f6a03cb`, production-verified 2026-09-17 |
| **4b** — FAQ copy differentiation | **SHIPPED** — PR #130, merge `fa0e542`, live-confirmed 2026-09-20 |

**Current variants:** plumbers = `job_ticket` + cyan + `timeline` + `flow_curve`; electricians =
`enquiry_panel` + amber + `contrast` + `flow_circuit` — structural and content-specific
differentiation, not colour alone. Union values, node sequences, section orders and per-slice
verification: `CHANGELOG.md`, PRs #112, #114, #116, #118, #119, #121, #123, #125, #128, #130.

**Slice 4a (PR #128, reviewed head `374b4d6`, merge `f6a03cb`, production-verified 2026-09-17) is a
CONTENT-ONLY change through the existing `how_it_works` field** — a differentiated heading and
steps 2–4 per trade, with **no new union, interface, presentation variant, renderer or view
branch and no per-industry implementation fork**. **Step 1 stays canonical and byte-identical on
both pages** (the Scan is the same unchanged nine questions for everyone) and **both pages keep
exactly four steps**. **The FAQ is untouched** — seven entries and the same `faq_heading` on each
page, so the rendered `FAQPage` JSON-LD is unchanged — and every truthfulness guard above is
preserved.

**Slice 4b (PR #130, reviewed head `893fb6e`, merge `fa0e542`, deployed from that SHA and
live-confirmed 2026-09-20) is a CONTENT-ONLY change through the existing `faqs` field** —
FAQ 1, 3 and 6 differentiated by trade, FAQ 2 already trade-specific and unchanged, and **FAQ 4,
5 and 7 byte-identical across both pages** so the shared floor cannot silently fork. **Seven FAQs
per page, the established order and both `faq_heading`s are unchanged**, so the rendered
`FAQPage` JSON-LD still builds from the same `page.faqs` array. **No new union, interface,
presentation variant, renderer or view branch and no per-industry implementation fork** —
`IndustryPageView.tsx` is untouched — and every truthfulness guard above is preserved, the
booking FAQ asking about booking **requests** under a books-it-itself guard. **Production
verification was not recorded at merge time; this is deployed-and-live-confirmed, not
backdated.**

**Slice 4 is therefore COMPLETE — 4a is PR #128 and 4b is PR #130 — and that completes the
approved four-slice differentiation plan. No Slice 5 exists, and none is created or approved by
this closeout.**
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

- **Google OAuth / Data access verification — SUBMITTED, UNDER REVIEW BY GOOGLE.** The one
  remaining launch dependency, and it is external: see *Current Work* above. Not approved
- monitoring
- production testing

Shipped (previously listed as remaining or future):

- production deployment
- custom domain
- email confirmations
- cancellation/reschedule emails
- Voice AI
- Google Calendar
- **cross-device password recovery** (PRs #96 and #97, V1-verified in production 2026-09-14;
  magic-link sign-in deferred to V1.1/later)

Free products and acquisition surfaces (none of it V1 or V1.1 work; **status in *Free-Product
Strategy* above, closeouts in `CHANGELOG.md`**): **Setup Kit SHIPPED, do not rebuild** (§3) ·
**Scan Phase 1 SHIPPED and LIVE; persistence, consent, outcome measurement and every later
phase NOT started and not approved** (§1) · **Lost Revenue Scan — no separate questionnaire
without an approved `SCAN_QUESTION_SET_VERSION` decision** (§2) · **FAQ / Knowledge Builder
NOT started** (§4) · **Organic Acquisition Engine A-1, A-2a, A-2b, the homepage direct Scan CTA (#131) and
Phase B (BC-1–BC-3, PRs #135, #137, #139) SHIPPED; C, D NOT started**
(§7) · **Industry landing pages — Slices 1–4 SHIPPED; Slice 4 complete (4a PR #128, 4b PR #130)** (§8)
Future:

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
11. Update `PROJECT_CONTEXT.md` **only if current state changed** — a status line, never a
    narrative.

---

# Documentation Ownership and Size Discipline

*Established 2026-09-15, when this file reached 165,612 characters and exceeded the active
context limit. Nothing was deleted to fix it: the material moved to the document that
canonically owns it.*

**The rule:**

> **PROJECT_CONTEXT.md carries current state once, and points at the canonical record of
> everything else. A fact whose home is `docs/ARCHITECTURE.md`, `CHANGELOG.md` or
> `docs/REMY_BEHAVIOUR_RULES.md` is referenced here, never restated here.**

How that is kept:

1. **A merged PR updates `CHANGELOG.md`** (workflow step 9). It adds at most a **one-line
   status change** here, and only if current state changed.
2. **Architecture goes in `docs/ARCHITECTURE.md`.** This file gets one pointer row per Part,
   not a paragraph.
3. **A new standing behaviour rule goes in `docs/REMY_BEHAVIOUR_RULES.md`**, with one index
   line here.
4. **Size discipline: 75,000 characters soft, 100,000 hard.** At the soft limit the next
   closeout triggers a maintenance pass. The hard ceiling is two-thirds of the tool limit, so
   one closeout can never cross it. Check with `wc -c PROJECT_CONTEXT.md`.
5. **Nothing is deleted to make room.** Over budget means *move it to its canonical owner*,
   never *summarise it away*. A safety rule is moved verbatim, never paraphrased into
   something weaker.
6. **Every move leaves a pointer**, and the pointer names the document and the section.

*Maintenance passes:* 2026-09-15 (165,612 → under budget; material moved to canonical owners) ·
2026-09-16 (70,042 → under 65,000; duplicates merged, two stale statements corrected, the
industry-page record given §8 — no rule paraphrased, every moved fact left a pointer).
