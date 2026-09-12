# NiteOwl AI - Project Context

## Project

NiteOwl AI is a SaaS platform for small and medium businesses.

The first product is **Remy**, an AI Receptionist that answers customer enquiries, books appointments, captures leads and escalates unusual requests to the business.

This repository is the source of truth.

GitHub should always reflect the latest working state.

**Canonical architecture set.** Architecture lives in exactly two documents, and every
review extends them rather than adding a third:

- `docs/ARCHITECTURE.md` — **Parts I–XIV.** Part I future-compatibility guardrail, Part II
  provider independence and resilience, Part III compounding moat and outcome intelligence,
  Part IV outcome intelligence / governed agents / resource control, Part V operational
  sovereignty and diagnostic intelligence, Part VI the Business Problem Case, Part VII
  cross-product outcome learning and decision intelligence, Part VIII sovereignty and
  provider escape routes, Part IX the Intelligence Ownership Layer, Part X compounding
  advantage and category leadership, Part XI the Business Opportunity Scan MVP contract
  (**a contract, not a plan** — its Phase 1 pure logic has since shipped as PR #84; the
  product surface, persistence and consent flow it describes have not), Part XII the
  Scan's three Phase 1 contract decisions, Part XIII the Decision, Outcome and Impact
  Provenance contracts and the canonical provenance chain, Part XIV the Business Opportunity
  Scan's intelligence contracts. **§21 is the single canonical
  architecture diagram**, and Parts VII–XIV do not redraw it.
- `docs/AGENT_ACCESS_LAYER.md` — the governed Agent Access Layer, capability registry,
  autonomy ladder and free-product distribution architecture.

All of it is **documentation only**; nothing in either document has been implemented, and
neither asks for implementation now. The canonical `DecisionRecord` is defined once, at
`docs/ARCHITECTURE.md` §20.7.

Part VII (added 2026-09-03) found sixteen of its twenty-four requirements already answered and
added five findings, **M15–M19** — as-of evidence references so a decision can be re-judged on
what was known at the time; an evaluation denominator that keeps rejected and unmeasured
recommendations in the count; `action_status: withheld` so a comparison group can ever exist;
`evidence_scope` so a claim says whose experience supports it; and rebuild-without deletion so
the erasure promise over derived artefacts is keepable. All seven of its items are **PREPARE**
(P26–P32). **NOW: none** — no code, schema, flag, prompt or provider change.

Part VIII (added 2026-09-04) is the sovereignty and provider-escape-route pass. Like Part VII,
most of what it was asked for already existed — §41 wrote the sovereignty principle, §28 the
ownership line, Part II the whole provider-independence assessment — so its new work is narrow:
it **registers the three providers that appeared in no previous table** (GitHub, the telephony
carrier and the phone number, and STT/TTS, all missed because none is a runtime import), adds
the **A/B/C ownership classification** and the **recoverability set** §41.3 had deferred, and
answers the exit test per provider. **NOW: none** — no provider replaced, no vendor added, no
self-hosting adopted, no code, schema, flag, prompt or provider change. Its canonical rule is
the **NiteOwl Sovereignty Principle** (§63): *rent commodity capability, own strategic state,
intelligence and control.*

**Every band-A asset is NiteOwl-resident today**, so a provider loss cannot reach the moat. Two
qualifications are recorded rather than softened, and both are cheap: the Supabase **restore has
never been tested** and depends on an encryption keyring whose separate custody is **unverified**
(B6 plus §11, both pre-existing); and the **phone number's account of record appears to be
Vapi's**, which is the one identified loss no backup restores. Neither is a reason to migrate
anything — see §68.1's HARDEN SOON list. Part VIII also corrected two stale facts in place:
§12's *"no `vercel.json`"* (one now exists, with a single cron) and the OpenAI call-site count
(**11 sites across 9 files**, not 9).

Part IX (added 2026-09-04) treats Part VIII as canonical and extends it, making **cross-product
measured-outcome learning and proprietary Decision Intelligence** binding as the layer above
Business Memory and orchestration. Three invariants: the layer is **derived, never primary**
(rebuildable from Spine + Memory, which is what makes it erasable, provider-loss-proof, portable
and — the part nobody expects — retirable by NiteOwl itself); dependency points **downward
only**, so removing the layer may make an outcome *worse* but never *wrong* and never
*impossible*; and NiteOwl **rents the computation while owning the corpus, the recipe and the
evaluation**. §70.4 states the payoff: the intelligence layer sitting on top is the mechanism
that keeps every layer beneath it swappable, because evaluation datasets are what let NiteOwl
tell whether a replacement provider is worse.

**The one genuinely new finding is S1 (§71): a provider substitution can preserve every row and
still reset the learning.** Part VIII proved the data survives; it never asked whether the corpus
stays *comparable* across a swap. If a provider is a **dimension** of a canonical concept rather
than an **attribute** of a record, the corpus silently splits into before/after and the
comparison that would have justified the substitution is the one it destroyed. Today's code
already complies — `"vapi"` never reaches `leads.source`, which records the **channel** — so
**P33 is a rule to keep, not a defect to fix.** Also new: S2/S4, that a provider-resident
artefact must never stand in for a NiteOwl-owned one on a production path (the **2026-07-10
dashboard-assistant incident**, re-read as a sovereignty event — a call that "worked" while
bypassing the Knowledge Base, lead capture and every record), and S3, classify a dependency at
**adoption** rather than at review, which would have caught all three providers Part VIII found
unregistered. **NOW: none** — five PREPARE items (P33–P37), one LATER (L30), no code, schema,
flag, prompt, provider or configuration change. Part VIII's two HARDEN SOON qualifications
(untested Supabase restore, phone-number account of record) stand exactly as §68.1 left them and
are **deliberately deferred**.

Part X (added 2026-09-09) is the compounding-advantage and category-leadership pass, and it is
the emptiest of the ten by design: the six-layer hierarchy, the learning loop, the recommendation
contract, the copy test, the free-product distribution loop and the cross-product contract were
**all already written**, several more precisely than the directive that asked for them. Its four
findings are all places where the *commercial* side of category leadership could corrupt the
*analytical* side. **N1 (§75)** is the one it exists for: a customer's own CRM, accounting or
field-service system is a **fourth class of dependency** — NiteOwl has no contract with it, no
substitution path, and it can leave NiteOwl rather than the reverse — so an external system of
record may be read, referenced and written to but **may never become load-bearing for NiteOwl's
own history**; the test is whether the history stays readable and comparable after the customer
disconnects it. **N2 (§76)** forbids a free-scan estimate ever entering the Spine as a measured
outcome or becoming the baseline a later paid outcome is graded against — M11's
recommendation-grading-itself failure moved earlier in time so nobody recognises it. **N3 (§77)**
makes a published case study a governed disclosure (per-claim consent, evidence frozen as-of
publication, the metric named in advance, honest revocation limits) that is an **output of the
learning loop and never an input to it**. **N4 (§78)** writes down the competitive-evaluation
procedure that had been executed nine times and recorded zero times, and binds its output to the
existing bands: **a competitive development is never on its own a NOW.** **NOW: none** — three
PREPARE items (P38–P40), one LATER (L31), no code, schema, flag, prompt, provider or
configuration change, **no product started, no integration proposed and no V1 work created.**

Part XIII (added 2026-09-11) makes **Decision Provenance, Outcome Provenance and Impact
Provenance** explicit, provider-neutral, cross-product contracts, and states the **canonical
ten-stage provenance chain** once — observation → business state → diagnosis →
recommendation/decision → evidence → authority → action → outcome → impact → learning — with
each stage mapped to the carrier it already has. Twelve of the fifteen things it was asked to
define already existed and are consolidated rather than rewritten; three were real: **T1 (§95)**,
the architecture had an outcome and no **impact** — *"£640 of revenue"* and `appointment.booked`
are different assertions with different evidential standards, and the first had nowhere to live
except an estimate P39 forbids from ever becoming measured — so the **Impact assertion** is
defined as §23's attribution row given its full shape (category, quantity, unit, window,
`measurement_basis`, assumptions, confidence, tier, `evidence_scope`), never an event, never an
outcome, never a baseline, opposing impacts kept and never netted, no cross-product currency;
**T2 (§94)**, the Outcome group could not say *partial*, *contested*, *reversed* or *not yet due*,
so `outcome_resolution` and `outcome_contradicting_evidence` are added, with learnability still
derived and never a flag; **T3 (§93.2)**, `evidence_refs[].role` (what was relied on vs merely
available), `approval_status` (including `expired` and `overridden`, an override being a new
human decision with its own outcome slot) and `supersedes`. Its governing principle: **every
stage carries its own provenance, confidence and timestamp, and none inherits any of the three
from the stage before it**; hidden model chain-of-thought is never stored on any stage. §20.7
gains rule 9 (an outcome is not an impact) and the new fields in place; §23's attribution row
points at §95.2. **NOW: none** — three PREPARE items (P44–P46), one LATER (L34), no code, schema,
flag, prompt, provider or configuration change, no store, no service, no table, no layer, no
chain table, no product started, no boundary moved, **and no V1 work created.**

Part XIV (added 2026-09-12) is the **architecture strengthening the Business Opportunity Scan
intelligence review required before PR D could start**, and it is deliberately the narrowest of
the fourteen. The review found the largest available improvement to the Scan's report needs no
new question, no persistence, no model and no provider — only that the report say which finding
matters most, how the findings relate, and what NiteOwl is *not* claiming. Two boundaries stood
in the way and both were real. **First, §86.1 excluded *"a scoring model, ranking model or
learned prioritisation"* as one undifferentiated item**, which would also have excluded a
deterministic, explainable, versioned, product-scoped ordering over rules the architecture
already holds — something §43.3 has always permitted every product. That sentence is **narrowed
to what it always meant** (no opaque score, no learned or probabilistic ranking, no hidden
weights), and §43.3 gains the matching statement plus the rule that **an ordering is versioned
separately from the rules it orders**. **Second, the Atlas boundary had never been written
down.** §100.3 writes it in both directions: the Scan may reason about **order and adjacency
within the one process it questioned directly**, name the earliest stage where work appears to
be lost, express hypotheses, identify dependencies and say what is *not* the immediate problem;
it may **never assert a cause, never reason across domains and never become a general causal
analysis engine**. Atlas's charter is untouched, and a Scan finding may be **one input** to an
Atlas synthesis but never the synthesis.

Six contracts are defined — the enquiry funnel and its four stage states (§101), opportunity
clusters (§102), the narrowed hypothesis form (§103), dependencies (§104), evidence gaps (§105)
and the four-state impact classification (§106). **Four of the six are narrowings of things
Parts XI–XIII already held** — §42.2's `hypotheses[]` (*a ranked list, not a winner*), §82.3's
first-class unknown, §92's per-stage provenance and §43.3's versioned ranking — and only the
funnel and the cluster are new shapes, both of them analytical representations of answers the
owner already gave. Three rules carry the most weight: **no stage is ever `observed`** (the Scan
observes nothing, and a type that cannot express an observation cannot claim one); a **cluster
or dependency is never invented to create a narrative**, so `independent` is a real output; and
`expected_information_gain` on an evidence gap is **a claim about NiteOwl's own rules, never
about the business** — *"this would let us put a range on it"* is verifiable, *"this would
reveal £X"* is an estimate wearing a gap's clothing and P39 bars it. §107.4 restates the
anti-funnel rule as properties the contracts must have: a zero-findings report stays reachable
with **empty** prioritisation, clustering and dependency output, `recommended_product: null` and
`free_tool_handoff: null` stay simultaneously reachable, and prioritisation **ranks genuine
findings only**. **NOW: none** — five PREPARE items (P47–P51), one LATER (L35), no code, schema,
migration, flag, prompt, provider, route, UI, test or configuration change, no store, no
service, no table, no layer, no runtime, **no product started, no live Scan behaviour changed
and no V1 work created. PR D is NOT started and is not authorised by this part.**

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
- Service-Address Integrity (PR #42, merged `e4d3a95` 2026-09-01 and deployed — speech-to-text noise can no longer become the canonical service address; **this is what actually closed Finding B**, and as deterministic code, not the prompt-only change that entry once proposed)
- Caller-Name / Email-Digit Integrity (PR #43, merged `c104449`, deployed and production-verified 2026-09-02 — a digit-suffixed email can no longer condemn the caller's real name)
- Canonical Owner Surfaces (PR #45, merged `a7d5102`, deployed and production-verified 2026-09-02 — the owner email shows the canonical **email**, and the dashboard shows the canonical **service address**)
- Per-Call Metadata Integrity (PR #46, merged `869d815`, deployed and production-verified 2026-09-02 — a per-call fact can no longer outlive the call it belonged to)
- Calendar Canonical Service Location (PR #47, merged `97948e3`, deployed and production-verified 2026-09-02 — the calendar UPDATE path uses the current call's resolved address instead of a dead metadata read)
- Provider-Summary Source Containment (PR #48, merged `7c13e6c`, deployed and production-verified 2026-09-02 — **F4 Step 1**: provider prose is no longer an extraction input or a service fallback)
- Canonical Owner Facts (PR #49, merged `38028df`, deployed and production-verified 2026-09-02 — **F4 Step 2**: canonical **Service needed** and **Appointment / Requested appointment / Requested callback** rows, in the organisation's timezone)
- Narrative-Only Provider Summary (PR #51, implementation `8b41a46`, merged `8906564`, deployed and **live-production verified 2026-09-03** — **F4 Step 3, which completes F4**: the seven factual labels are gone from `buildSummaryInstructions` and the paragraph is context only)
- Caller-Grounded Service Integrity (PR #54, feature commit `97c37b9`, merged `36805b8` 2026-09-03 and deployed — **F5**: a service label the caller never spoke can no longer become the canonical service. `service` was the last of the five caller-supplied voice fields with no deterministic guard)
- Fallback Service Contract Alignment (PR #56, feature commit `ea6c0bb`, merged `a71815d` 2026-09-03 and deployed — the transcript-fallback extractor now asks for the caller's own service wording, so the two producers of `service` no longer disagree)
- Empty StructuredData Fallback Recovery (PR #58, feature commit `eb4641a`, merged `3fdb8df` 2026-09-03 and deployed — a semantically empty provider envelope no longer suppresses the transcript fallback, so caller evidence the transcript holds is no longer discarded)
- Service-Address Authority Integrity (PR #60, feature commits `373cf3b` and `e001f0f`, merged `a07a06a` 2026-09-04 and deployed — a plausible provider address can no longer outrank the caller's own words, and a same-street house-number conflict records nothing rather than booking the wrong door)
- Partial-StructuredData Email Recovery (PR #62, feature commit `6289418`, merged `c2d48b7` 2026-09-04 and deployed — a caller's spoken email is recovered deterministically when a partial provider payload omits the field, so a booking can no longer complete with the customer never written to. **The FIRST partial-field recovery; the other omitted fields remain open**)
- Partial-StructuredData Requested-Timing Recovery (PR #66, feature commit `837caa7`, merged `bd5853a` 2026-09-07 and deployed — the caller's requested day and time is recovered deterministically when a partial provider payload omits the field, so a caller who said when they wanted the visit no longer gets a request nobody can act on. **The SECOND partial-field recovery; `urgency` and `service` remain open**)
- Urgency Representability Hardening (PR #68, feature commit `a2c483f`, merged `c390f53` 2026-09-07 and deployed — `urgent` is now `true` / `false` / `null`, so an untold urgency is no longer indistinguishable from a provider stating "not urgent". **REPRESENTATION ONLY and behaviour-neutral: NO transcript urgency recovery was implemented, and it remains V1.1/later**)
- Returning-Customer Booking Isolation (PR #70, feature commit `72717f5`, merged `8833896` 2026-09-07 and deployed — a returning chat/widget customer booking again in a NEW conversation can no longer match their already-`booked` lead, so a second booking creates a separate lead instead of silently overwriting and rescheduling the appointment they already had. **Same-conversation rescheduling and voice are unchanged**)

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
| **Returning-customer booking overwrite** (chat/widget; voice never affected) | PR #70 `8833896`, deployed 2026-09-07 | Cross-conversation lead matching rule. `CHECKLIST.md` and `docs/ARCHITECTURE.md` C3 still describe it as open — **this record is current** |

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
- **Deployment-to-merge correspondence is usually NOT SHA-verified.** `vercel inspect` exposed
  no Git-source metadata for PRs #54, #58, #60, #62, #66, #68 and #70, so identification rests
  on the new production deployment appearing seconds after the merge and carrying the
  `niteowlhq.com` / `www` / `git-main` aliases. PR #40 could read `githubCommitSha` directly;
  that is the stronger evidence, and the difference is recorded rather than glossed over.
- **A deterministic code guard CAN be closed by tests driving the real `processCallEnded`; a
  model-behaviour prompt correction CANNOT.** PRs #43, #54, #58, #60, #62, #66, #68 and #70
  needed no live call. PRs #34 and #40 did — an all-green suite proved nothing there.

**OPEN — still deferred:**

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

---

# Current Work

**Remy V1 implementation is COMPLETE** under the canonical Definition of Done —
*"Does this stop a normal paying customer from reliably using Remy V1?"* A read-only
reconciliation across PROJECT_CONTEXT.md, CHECKLIST.md and docs/ARCHITECTURE.md found no
remaining production-reachable V1 implementation blocker.

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
  STT wording, the prompt budget and the dashboard-preview toast.
- **The timezone-selection UI stays conditional and deferred.** No code path writes
  `organisations.timezone`, so every organisation inherits `Europe/London`. That is correct
  for the current Ireland/UK-compatible launch scope and harmless there. **It becomes a V1
  blocker the moment a business outside that offset is onboarded**, and must ship before any
  such expansion.
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
Remy V1 or V1.1 work and nothing here is a NOW item. Four things have shipped: the Setup Kit
(complete), the **Business Opportunity Scan's Phase 1 pure logic** (PR #84 — logic only, no
product surface), the **Scan's Phase 1 recommendation layer** (PR #87 — likewise logic only)
and the **Scan's Phase 1 public surface** (PR #89 — the questionnaire and report a visitor
actually uses, live and production-verified 2026-09-12; see §1 below). Nothing else is
started or approved for implementation.

## 1. Flagship — NiteOwl Business Opportunity Scan

**PHASE 1 PURE LOGIC: IMPLEMENTED AND SHIPPED (PR #84, merge `7d242d8`, deployed and
production-health verified 2026-09-11). THE PRODUCT ITSELF: NOT BUILT AT THAT TIME — the
public surface shipped later, in PR #89; see below.**

What PR #84 delivered is exactly the deterministic Phase 1 contract logic, as five pure modules
under `src/lib/freetools/` (`scanTypes`, `scanQuestions`, `scanValidation`, `scanFindings`,
`scanLostRevenue`) with their four test suites (`tests/freeToolsScan*.test.mjs`):

- the canonical nine-question set, allowed values and required/optional split (§87.2);
- the validator — refuses and never repairs or coerces, `not_sure` first-class, Q4 > Q3
  surfaced as an inconsistency and never resolved (§87.4);
- the deterministic finding engine over the three condition codes, ranked by the enumeration
  and by nothing else (§87.1, §87.3);
- the Phase 1 Lost Revenue sizing — E1 only, a range never a point, UNKNOWN as a first-class
  result for the other two codes and for every §88.3 gate (§88.1–§88.3);
- the frozen `estimate_basis` and the executable recomputation that makes the result
  reproducible from its basis alone (§88.4).

It is pure, deterministic, provider-independent and tenant-free: no model, network, storage,
clock, randomness or `org_id` is reachable from it, and a structural boundary suite pins that.
D1–D4 hardening (pre-rounding eligibility, an accurate `no_permitted_expression` reason, one
shared rule-set version, requiredness read from the question definitions) landed before merge.

**What Phase 1 does NOT include, and what is therefore still not built or approved:** a public
route or page, any UI or product surface, persistence of a run, the bearer-token run linkage,
the consent and promotion flow (Part XII §89), routing to a recommendation, cross-product
outcome learning, any Part XIII provenance runtime, and every later Scan phase. Nothing
outside the five modules imports them today. **Shipping the logic did not approve the
product**: each of those is its own decision.

**PHASE 1 RECOMMENDATION LAYER SHIPPED (PR #87, approved head `21e0ea3`, normal merge commit
`6055f64` 2026-09-11, deployed as `dpl_GWa2YAHEagFrBzYM2Zwv4DJbAmwE` with the deployed SHA
equal to the merge commit, and production-health verified — `/api/health` HTTP 200
`database: ok`, homepage HTTP 200). THE SCAN PRODUCT ITSELF WAS STILL NOT BUILT AT THAT
TIME — see the PR #89 entry below.** What is
shipped is exactly two pure-logic increments — **PR #84**, the Phase 1 deterministic
foundations (questions, validation, findings, E1 sizing, `estimate_basis`), and **PR #87**,
the recommendation layer described here. What is **NOT built**: a route, page or UI;
persistence; run identity or bearer-token linkage; the consent and promotion flow; outcome
measurement; any Part XIII provenance runtime; any learning runtime; and every later phase.
A recommendation here is a **proposed** suggestion at authority level **recommend** with
source type **derived_deterministic** — it is not a decision that was taken, not an action,
not an outcome and not learning, and it authorises nothing. A sixth pure module, `src/lib/freetools/scanRecommendations.ts`, gives every
rendered finding exactly one deterministic, owner-actionable recommendation, keyed by
`finding.condition` alone — never by impact, estimate size, confidence, cap reason, provider,
tenant, clock or model. `buildScanReport` attaches it after sizing. Fixed owner-facing text
pinned verbatim by test; Phase 1 routing follows §84.3's class table: `enquiry.unanswered` →
Remy, `enquiry.no_followup` → no product (the structural anti-funnel case, §81.2), and
`booking.friction` → Remy as where the answer lives **plus** a **link-only** Setup Kit
handoff as the first step of §84.4's path (no answers, pre-fill, token, state or consent —
the handoff and the product are separate fields, and the next step is useful without
either). Q1/Q2-aware routing (§87.2) is **deferred and not implemented**. **D-B1** is represented as
`threshold_rule: "improvement_from_stated_baseline"` read with a `direction` (`decrease` for
Q4 unanswered enquiries and Q7 messages to book, `increase` for Q9's share of *answered*
enquiries becoming work); the criterion is declared here and evaluated nowhere in this layer; the
baseline is the owner's raw stated answer quoted with its question id, never
`EstimateBasis.result`, and is `null` — with wording that says one must be established
first — whenever the answer has no position on the scale (`not_sure`, absent,
`varies_a_lot`). `action_status: proposed`, `authority_level: recommend`,
`source_type: derived_deterministic`, shared `SCAN_RULE_SET_VERSION`, `review_window_days: 28`,
no `expected_effect` (W.2 deferred). **PR #87 is pure logic: no UI, no route, no
persistence, no consent/promotion, no outcome comparator, no Part XIII runtime**, and its
merge does not approve or start any of the items in the previous paragraph. Two non-blocking
cosmetic follow-ups (a stale comparison-oriented comment; the `enquiry.no_followup` next-step
prose not repeating the criterion's exact denominator) are recorded in `CHANGELOG.md` and
left for a separate tidy. Full record in `CHANGELOG.md`.

**PHASE 1 PUBLIC SURFACE SHIPPED (PR #89, approved head `61b82f9`, normal merge commit
`f3ab620` 2026-09-12, deployed as `dpl_7m7mdyDGdTk3H4BzedgEUxJNEY9o` — Ready on the
production aliases — and production smoke-verified: `/api/health` HTTP 200 `database: ok`,
homepage HTTP 200, `/free-tools` HTTP 200 and linking to the Scan, and
`/free-tools/business-opportunity-scan` HTTP 200 serving the questionnaire). **THE SCAN IS
NOW USABLE BY A VISITOR — this supersedes the "not built" wording in the two paragraphs
above, which remain as the record of what PRs #84 and #87 each delivered.** Five files:
`src/app/free-tools/business-opportunity-scan/page.tsx`, `ScanClient.tsx` and
`scanPresentation.ts`, `tests/freeToolsScanSurface.test.mjs`, and the listing entry in
`src/app/free-tools/page.tsx`. **No `src/lib/freetools/` module changed** — the Phase 1 logic
is consumed, not modified.

- **It stores nothing.** No `localStorage`, no `sessionStorage`, no cookie, no query string,
  no API route, no database write, no network call. Answers live in client memory for one
  page view and a refresh clears them, which is why §26's staged model is satisfied
  trivially — the same way the Setup Kit satisfies it.
- **Three screens split by POSITION in the contract order, never by question id**, and
  `validateScanAnswers` is the sole authority on refusal. The surface never repairs, coerces
  or second-guesses an answer.
- **KEYBOARD-ONLY NAVIGATION WAS NOT PERFORMED.** It is recorded as an **unperformed manual
  check, NOT a pass**, and is a **documented non-blocking accessibility verification gap**
  carried to V1.1/later. The non-blocking judgement rests on code evidence and never on a
  substituted result: native interactive elements throughout, no `tabIndex` override
  anywhere, no `onClick` on a non-interactive element, no custom widget, modal or focus trap,
  and errors already carrying `role="alert"`, `aria-invalid` and `aria-describedby`. **Do not
  later record this as verified without actually performing it.**
- **Deployment-to-merge correspondence is NOT SHA-verified** — `vercel inspect` exposed no
  Git-source metadata, as for PRs #54, #58, #60, #62, #66, #68 and #70 — so identification
  rests on the production deployment appearing two seconds after the merge and carrying the
  production aliases.
- **What is STILL not built, and what this merge does not approve:** persistence of a run;
  run identity or bearer-token linkage; the consent and promotion flow (Part XII §89); any
  database, schema, migration or RLS; tenant or `org_id` identity; a `DecisionRecord`, Spine
  event, Business Memory or Business Graph write; outcome or impact measurement; any Part XIII
  provenance runtime; cross-product learning; any model call, prompt or provider change;
  Setup Kit pre-fill; Q1/Q2-aware routing; the standalone Lost Revenue entry; and every later
  Scan phase. `docs/ARCHITECTURE.md` is unchanged and no Remy code, flag, schema or
  configuration was touched. **PR D has NOT started.**

**Documented non-blocking follow-ups from the PR #84 reviews, all still open:** S1–S5
(confidence levels and cap policy that the implementation chose and canon does not yet
specify) and N.1–N.4 (a displayed low of 0 after outward rounding, recomputation not
re-running eligibility, two stale prose comments). Recorded in `CHANGELOG.md` under PR #84.

**Its MVP contract is `docs/ARCHITECTURE.md` Part XI (§80–§86)** — the promise, the three
Phase 1 finding classes, the Lost Revenue sizing module, the finding and input contracts,
routing, the outcome loop and the IN / NOT IN / PREPARE / LATER classification. Part XI is a
**contract, not a plan**: it schedules nothing and creates no NOW item.

**Its three Phase 1 contract decisions are resolved in Part XII (§87–§90)** — the three
condition codes and nine owner-facing questions, **one** permitted Lost Revenue expression
(two of the three candidates were rejected as unsizeable without an invented rate, so
`enquiry.no_followup` and `booking.friction` always report impact UNKNOWN in Phase 1), the
`estimate_basis` recomputability contract, and the consent and promotion wording. **Parts XI
and XII remain contracts: PR #84 implemented the Phase 1 logic they specify, and nothing
beyond it — the consent and promotion flow in particular is unimplemented.**

The flagship free acquisition and discovery product. Its purpose is to identify
evidence-backed opportunities and problems: revenue leakage · missed enquiries · weak
follow-up · unused capacity · booking and scheduling friction · cash-flow friction · marketing
inefficiency · operational bottlenecks · retention problems · repeat-business opportunities.

**It must distinguish four things, and the distinction is the product:**

| It says | Which means | Already expressible as |
|---|---|---|
| **Observed fact** | Something that happened, or a value read | `observed` (§20.6), with `evidence_scope` (§57.1) |
| **Inferred finding** | A judgement NiteOwl made on evidence | A Finding — §42.2, with its `hypotheses[]` and `contradicting_evidence` |
| **Estimate** | A number NiteOwl produced, not one it measured | `derived`, never `observed` — Part X **P39** |
| **Assumption** | What had to be taken as true to get there | `assumed` (§20.6), carried in the Finding's `assumptions` |

**Where impact is estimated, the evidence, assumptions and confidence are exposed rather than
invented precision.** This is not a new rule — §26 already states that visible assumptions are
what separate a finding from a sales figure, and §43.2 already requires a range, a direction or
*"unknown"* rather than a fabricated number. Part X **P39** adds the one the commercial framing
makes easy to forget: **an estimate never enters the Outcome Spine as a measured outcome, and
never becomes the baseline a later paid outcome is graded against.**

## 2. Lost Revenue Scan

**PHASE 1 SIZING LOGIC SHIPPED with PR #84 (`scanLostRevenue.ts` — E1 only); the standalone
entry experience is NOT started.** A **major module and acquisition hook within** the Business Opportunity Scan —
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

Free products (see *Free-Product Strategy* above — none of this is V1 work):

- **AI Receptionist Business Setup Kit — SHIPPED** (PRs #77, #78). Do not rebuild
- **NiteOwl Business Opportunity Scan** — the flagship free acquisition product. **Phase 1
  pure logic SHIPPED** (PR #84), **Phase 1 recommendation layer SHIPPED** (PR #87, merge
  `6055f64`) and the **Phase 1 public surface SHIPPED, LIVE and production-verified** (PR #89,
  merge `f3ab620`, 2026-09-12) — a visitor can now complete the Scan and read a report.
  Persistence, run identity, consent flow, outcome measurement, Part XIII runtime and later
  phases NOT started and not approved
- **Lost Revenue Scan** — a module and acquisition hook within the Scan, optionally surfaced as
  a narrower standalone entry. Phase 1 sizing logic shipped inside PR #84; the standalone
  entry NOT started
- **FAQ / Knowledge Builder** — retained as a *supporting* free tool, no longer the flagship.
  NOT started

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
