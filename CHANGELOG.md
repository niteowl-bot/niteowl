# Changelog

All notable changes to NiteOwl will be documented in this file.

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

