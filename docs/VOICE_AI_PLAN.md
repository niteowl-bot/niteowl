# Voice AI Plan — Remy Answers the Phone (Phase 2)

Status: **Planning only. No code written. Production baseline untouched.**
Date: 2026-07-09

Goal: Remy answers phone calls, collects caller details, books appointments,
transfers urgent calls to a human, and emails a call summary to the business owner —
without modifying the existing chat widget, booking flow, sales chat, email
notifications, dashboard, or any production code.

---

## 1. Provider options

| Provider | What it is | Pros | Cons |
|---|---|---|---|
| **Vapi** | Voice-AI orchestration platform (telephony + STT + LLM + TTS + turn-taking as a service) | Webhook-based (fits Vercel serverless), built-in call transfer, built-in end-of-call summaries/transcripts/structured data, tool calling into our own API routes, BYO OpenAI key, phone numbers provisioned in-dashboard | Per-minute platform fee; some vendor lock-in |
| **Retell AI** | Same category as Vapi | Very similar feature set, good post-call analysis, competitive pricing | Slightly smaller ecosystem; same lock-in trade-off |
| **Twilio (raw Programmable Voice + Media Streams)** | Telephony building blocks only | Maximum control, cheapest at scale, industry standard | We would build STT, TTS, interruption handling, and turn-taking ourselves — months of work |
| **OpenAI Realtime API** | Speech-to-speech model (no separate STT/TTS) | Lowest latency, most natural | Requires a **persistent WebSocket server** bridging Twilio Media Streams — Vercel serverless cannot host this; we'd need new infrastructure (Fly/Railway). Telephony, transfers, summaries all DIY |
| Others (Bland.ai, Synthflow, Telnyx Voice AI) | Similar orchestration platforms | Some are no-code | Less mature APIs / weaker tool-calling than Vapi/Retell |

## 2. Recommendation: **Vapi**

- Everything is webhooks + REST — no long-lived connections, so it deploys on the
  existing Vercel setup with zero new infrastructure.
- Transfers, transcripts, summaries, recordings, and structured data extraction are
  built in — the exact features on our list.
- Its "tools" (function calling) can hit our Next.js API routes, so voice booking
  reuses the **same** availability/booking helpers as chat.
- Beginner-friendly dashboard: an assistant can be prototyped with **zero code**.

Retell is a fine plan B with a near-identical architecture; nothing below locks us in
conceptually.

## 3. How incoming calls are answered

1. Each business gets a dedicated phone number (provisioned through Vapi, ~$2/mo).
2. The number's inbound handler points at our **server URL**:
   `POST /api/voice/incoming` (new route).
3. On each call, Vapi sends an `assistant-request` containing the dialed number.
   We look up the org by phone number, build a fresh system prompt from that org's
   **Knowledge Base + business hours + services**, and return the assistant config.
4. Vapi runs the conversation. Because the prompt is built per-call, KB edits take
   effect immediately — no syncing.

## 4. Speech-to-text / text-to-speech

Handled entirely by Vapi's pipeline; we only pick components in config:

- **STT:** Deepgram (default, fast, good on UK accents)
- **LLM:** OpenAI (we can supply our existing `OPENAI_API_KEY`) — e.g. gpt-4o / 4.1-mini
- **TTS:** ElevenLabs, OpenAI TTS, or PlayHT — chosen per assistant
- Turn-taking, barge-in (caller interrupts Remy), and endpointing are Vapi's job.

Typical turn latency ~1s. No audio code in our repo at all.

## 5. Collecting caller details

- **Phone number is free:** caller ID arrives with the call — no need to ask.
- The system prompt instructs Remy to collect name, service needed, preferred time,
  and (optionally) email — with **spell-back confirmation** for names/emails, which
  are the error-prone fields over voice.
- **MVP approach:** Vapi's end-of-call **structured data extraction** with a schema
  mirroring our existing `ExtractedLead` shape (`name / email / phone / service /
  preferred_datetime / intent`). One webhook at call end → we create/update a lead
  via the existing `capturePartialLead` engine with a new source `voice`.
- **Later (Phase B):** real-time tool calls during the conversation for live
  availability checks and booking.

## 6. Call summaries emailed to the owner

1. Call ends → Vapi POSTs an `end-of-call-report` (summary, full transcript,
   structured data, recording URL, duration) to `POST /api/voice/webhook`.
2. We verify the webhook secret, insert a `voice_calls` row, create/update the lead.
3. Send owner email: caller number, time, duration, AI summary, extracted details,
   link to the lead, transcript below the fold. Reuses `getOrgOwnerEmail` and the
   Resend setup — via one **new additive** `sendCallSummaryEmail` function
   (see "files" below for the isolation decision).

## 7. Urgent call transfer to a human

- Vapi has a built-in `transferCall` tool. We give the assistant a transfer
  destination = a new per-org setting `transfer_phone` (the owner's mobile).
- Prompt rule: transfer only for genuinely urgent matters (emergency job, angry
  customer, caller explicitly demands a human).
- If the transfer target doesn't answer, Vapi falls back to the assistant → Remy
  takes a message → lead is flagged `needs_review` (existing workflow, same
  single-notification metadata rule).

## 8. New database tables (additive migrations only)

**`voice_calls`** — one row per call
```
id uuid PK, org_id uuid FK, provider_call_id text unique,
caller_phone text, direction text, started_at timestamptz,
ended_at timestamptz, duration_seconds int, status text,
ended_reason text, summary text, transcript text,
recording_url text, lead_id uuid FK nullable,
metadata jsonb default '{}', created_at timestamptz
```

**`voice_settings`** — one row per org (a new table, so no ALTER on existing tables)
```
org_id uuid PK/FK, enabled boolean default false, phone_number text,
provider_phone_number_id text, transfer_phone text,
greeting text, voice_id text, created_at, updated_at
```

**Leads:** new source value `voice`. If `source` is a plain text column this needs
no migration; if there's a CHECK constraint, one additive migration extends it.
Existing sources (`chat`, `web_widget`, `dashboard_preview`) stay untouched and
voice never pollutes their analytics.

## 9. New environment variables

```
VAPI_API_KEY            # server-side API key
VAPI_WEBHOOK_SECRET     # shared secret to verify inbound webhooks
VOICE_ENABLED           # global kill switch, default "false"
```
(Twilio creds only if we later bring our own numbers.)

## 10. New API routes

| Route | Purpose |
|---|---|
| `POST /api/voice/incoming` | `assistant-request`: look up org by dialed number, return per-call assistant config built from the KB |
| `POST /api/voice/webhook` | End-of-call reports + status events: store call, capture lead, send summary email |
| `POST /api/voice/tools` | **Phase B** — tool calls during the call: check availability, create booking (reusing existing helpers) |

All under `/api/voice/*` — a namespace that does not exist today.

## 11. Files created / touched

**New (isolated):**
- `src/app/api/voice/incoming/route.ts`
- `src/app/api/voice/webhook/route.ts`
- `src/app/api/voice/tools/route.ts` (Phase B)
- `src/lib/voice/assistant.ts` — builds the per-org system prompt from the KB
- `src/lib/voice/vapi.ts` — webhook signature verification + typed payloads
- `src/lib/voice/calls.ts` — store call rows, link leads, trigger summary email
- `src/app/dashboard/calls/page.tsx` — call history UI (**can wait**)
- Supabase migration for the two tables above

**Existing files — at most one additive touch:**
- `src/lib/email.ts`: add a new exported `sendCallSummaryEmail` function (new code
  appended; existing functions, `escapeHtml`, and `sendChecked` untouched).
  Alternative if we want literally zero edits to existing files: a self-contained
  `src/lib/voice/email.ts` — at the cost of duplicating the Resend setup, which the
  architecture rules discourage. **Recommendation: the additive function in
  `email.ts`.** Decide at implementation time.

**Voice code imports existing helpers read-only** (`availability.ts`,
`parseDatetime.ts`, `leadCapture.ts`, `supabase/admin.ts`). Nothing in the existing
codebase imports from `voice/` — if voice breaks, chat/booking/email cannot be
affected.

## 12. Isolation guarantees

- New routes, new lib folder, new tables, new lead source — no shared mutable state.
- Org-level `enabled` flag **and** global `VOICE_ENABLED` env kill switch.
- Vapi outage = phones don't answer; the website widget, dashboard, booking, and
  emails are structurally unaffected.
- Double-booking safety: voice booking goes through the same `isSlotAvailable` /
  capacity helpers and DB constraints as chat, so the two channels can't race past
  each other any more than two chat sessions can today.

## 13. Build order

**Must build now (MVP — "Remy answers and takes a message"):**
1. Vapi account + one test number + dashboard-configured prototype (zero code)
2. `voice_calls` table + `/api/voice/webhook` (store calls, no email yet)
3. `/api/voice/incoming` with KB-driven prompt + `voice_settings`
4. Lead capture from end-of-call structured data (source `voice`)
5. Call summary email to owner

**Second (live booking):**
6. `/api/voice/tools` — availability check + booking, reusing existing engine
7. Spell-back/confirmation prompt hardening

**Third (escalation + polish):**
8. Urgent transfer to `transfer_phone` + needs_review fallback
9. Dashboard call history page, per-org voice settings UI

**Can wait:** outbound calls, SMS follow-ups, voicemail detection, multi-language,
voice analytics, custom voice cloning.

## 14. Cost & complexity

**Running cost (per org, rough):**
- Vapi platform ~$0.05/min + STT/TTS/LLM ≈ **$0.10–0.15 per call-minute** all-in
- Phone number ~$2/mo
- Example: 100 calls/mo × 3 min ≈ **$30–50/mo per business** — must be priced into
  the voice tier. Set Vapi spend caps + max call duration (e.g. 10 min) from day one.

**Build complexity:**
- MVP (steps 1–5): **low–moderate** — mostly webhook handlers and prompt building;
  ~1–2 weeks part-time
- Live booking (6–7): **moderate** — tool-call plumbing + datetime confirmation UX
- Transfers (8): **low** — Vapi built-in

## 15. Key risks before real businesses

1. **Hallucination is worse on the phone** — no visual fallback. Strict prompt +
   the existing needs_review handoff philosophy ("never invent an answer") must
   carry over verbatim.
2. **Misheard details** — names/emails over voice are error-prone. Spell-back
   confirmation; treat caller ID as the canonical phone.
3. **Recording/consent law (UK)** — announce recording in the greeting; GDPR applies
   to transcripts and recordings (PII in `voice_calls`). Decide retention policy
   before launch; consider launching without recordings.
4. **Latency/interruption UX** — a 3-second pause feels broken on the phone. Test
   with real calls before onboarding anyone.
5. **Cost runaway** — a stuck call or spam calls burn per-minute fees. Spend caps,
   max duration, and (later) basic spam screening.
6. **Webhook security** — `/api/voice/*` is public; verify `VAPI_WEBHOOK_SECRET` on
   every request or anyone can inject fake calls/leads.
7. **Emergency expectations** — Remy must say it cannot handle emergencies (not a
   999 substitute); needed in prompt + terms.
8. **Provider dependency** — Vapi down = phones down. Acceptable for alpha; note a
   Retell fallback exists with the same architecture.

## 16. Safest first implementation step

**Step 0 — zero repo changes:** Create a Vapi account, buy one test number, and
configure a prototype assistant entirely in the Vapi dashboard with a hardcoded
prompt for a fictional business. Point its webhooks at webhook.site. Make ~10 real
test calls to validate voice quality, latency, interruption handling, transcript
accuracy on UK accents, and the exact shape of end-of-call payloads.

This costs a few dollars, touches **no code**, risks **nothing** in production, and
produces the real payload samples that make every later step concrete. Only after
that: the first code step is the read-only `/api/voice/webhook` route + `voice_calls`
table — it only receives data and can't affect any existing flow.
