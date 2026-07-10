# Voice AI — Production Setup Runbook (owner steps)

Date: 2026-07-10
Code status: Step 1 is deployed-safe and fully verified against the dev project
(see CHANGELOG 2026-07-09). Everything below is **outside-the-repo setup**; no
code changes are involved. Voice stays completely dark until the final step.

**Do the steps in this order.** Each one is safe on its own; nothing goes live
until Step 5.

---

## Step 1 — Run both SQL files on REAL production

Project: **`sklcqvvnuigpewzarbiv`** (real production — *not* the dev/test
project `kioljdihgbcboxlnwghv`; see the 2026-07-06 incident in CHECKLIST).

In the Supabase dashboard → SQL editor, run, in this order:

1. `docs/sql/2026-07-09_voice_tables.sql`
2. `docs/sql/2026-07-09_leads_source_voice.sql`

Both are idempotent (safe to re-run) and purely additive. Verify afterwards:

```sql
-- All three tables should be listed:
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('voice_events', 'voice_calls', 'voice_settings');

-- The constraint should now include 'voice':
select pg_get_constraintdef(oid) from pg_constraint
where conname = 'leads_source_check';
```

## Step 2 — Vapi account + test number (Step 0 of the plan, if not already done)

1. Create an account at vapi.ai.
2. **Set a spend cap immediately** (Organization → Billing) — e.g. $10/month
   to start — and a **max call duration** of 10 minutes. Do this before
   buying a number.
3. Buy one test phone number (~$2/mo). UK number if available; note it in
   **E.164 format** (e.g. `+447700900123`).

Optional but recommended from the plan: make a couple of browser test calls to
a dashboard-configured prototype assistant first to get a feel for latency and
voice quality. No repo impact either way.

## Step 3 — Point the Vapi number at the app

In the Vapi dashboard, on the phone number (not on any assistant):

- **Server URL**: `https://<production-app-url>/api/voice/incoming`
  — use exactly the domain that `NEXT_PUBLIC_APP_URL` is set to in Vercel
  production (the niteowlhq.com app URL). Vapi will POST an
  `assistant-request` here on every incoming call and our server returns the
  per-org assistant built live from the Knowledge Base — do **not** attach a
  dashboard-built assistant to the number. **This mistake actually happened on
  2026-07-10:** with an assistant assigned, Vapi answers calls with that canned
  assistant and never contacts our server — the call "works" but bypasses the
  Knowledge Base, call records, lead capture, and summary emails entirely, and
  looks deceptively like a successful test. The number's assistant field must
  be empty; only the Server URL should be set.
- **Server URL secret**: generate a long random value (e.g.
  `openssl rand -hex 32` or a password manager). Vapi sends it as the
  `x-vapi-secret` header; our routes reject anything that doesn't match.
  Keep it — you'll paste the same value into Vercel in Step 5.

## Step 4 — Insert the voice_settings row for the test org

Voice resolves which business a call belongs to by the **dialled number**, so
the org needs a `voice_settings` row. In the production SQL editor:

```sql
-- Find the org id first:
select id, name from public.organisations order by created_at;

-- Then (fill in both values; phone must be E.164 and match the Vapi number):
insert into public.voice_settings (org_id, enabled, phone_number)
values ('<ORG_ID>', true, '+44XXXXXXXXXX')
on conflict (org_id) do update
  set enabled = true, phone_number = excluded.phone_number, updated_at = now();
```

`enabled = false` is the per-org kill switch if you ever want one org dark
while others stay live.

## Step 5 — Vercel environment variables (this is what turns voice on)

Only after Steps 1–4. In Vercel → Project → Settings → Environment Variables
(Production):

| Variable | Value |
|---|---|
| `VAPI_WEBHOOK_SECRET` | the exact secret from Step 3 |
| `VOICE_ENABLED` | `true` |

Redeploy (or trigger a redeploy) so the env vars take effect — env changes do
not apply to the already-running deployment.

## Step 6 — Live end-to-end test call

Call the Vapi number from a real phone and book a test appointment
("tomorrow at 2pm" style). Then verify each link of the chain:

1. Remy answers, sounds right, and answers a question **from the Knowledge
   Base** (proves `assistant-request` → org lookup → KB prompt).
2. After hanging up: a row in `voice_calls` (status `completed`, duration,
   summary, cost populated).
3. A lead in the dashboard with **source `voice`**, your caller ID as the
   phone, and the appointment at the correct date/time.
4. The owner **call-summary email** arrives (plus the booking-confirmation
   email if the call booked something).
5. Tick off the remaining Voice items in CHECKLIST.md and delete the test
   lead/call rows afterwards.

If anything fails mid-chain, the raw event is preserved in `voice_events`
(with `processing_error` if processing failed) — nothing is lost and the
failure point will be visible there. Report it and we'll trace from the logs
before changing anything (standard debugging workflow).

## Rollback

Set `VOICE_ENABLED` to `false` (or remove it) in Vercel and redeploy — the
entire `/api/voice/*` surface answers 404 again. No SQL needs reverting; the
tables are inert without traffic. Per-org: set `voice_settings.enabled =
false`.
