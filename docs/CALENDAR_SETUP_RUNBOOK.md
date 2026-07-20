# Google Calendar Integration — Setup Runbook

Step 1 of the Calendar & Appointment Management feature (connection foundation).
Follow this in order. Steps here are the **owner's manual setup**; the code items
they enable are already merged. Nothing in Step 1 changes any booking or AI
behaviour — it only lets a business connect/disconnect its Google Calendar and
see the connection status.

---

## 1. Run the database SQL

Run in the Supabase SQL editor, per this repo's no-migrations-folder convention,
on **both** projects (dev first, then prod):

- dev: `kioljdihgbcboxlnwghv`
- prod: `sklcqvvnuigpewzarbiv`

Files (in this order):
1. `docs/sql/2026-07-20_calendar_connections.sql`
2. `docs/sql/2026-07-20_calendar_connections_verify.sql` — confirm expected results
   (table exists, RLS enabled, one owner-read `select` policy, 11 columns, provider
   check constraint mentions `google` and `outlook`).

Additive and idempotent — safe to re-run.

## 2. Create the Google Cloud project + OAuth client

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a new
   project (e.g. `niteowl-calendar`).
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - App name, support email, developer contact — fill in.
   - **Scopes**: add
     - `https://www.googleapis.com/auth/calendar.events`
     - `https://www.googleapis.com/auth/calendar.readonly`
     - (`openid` and `email` are added automatically for sign-in.)
   - **Test users**: add each pilot business's Google account email here.
     **This is the key alpha shortcut** — while the app is in "Testing" status,
     only listed test users can connect, but it needs **no Google verification**.
     Google's verification for these sensitive calendar scopes can otherwise take
     weeks. The test-user list is capped at 100, which comfortably covers alpha.
     Only submit for verification when going past ~100 businesses / out of testing.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized redirect URIs**: add
     - `https://niteowlhq.com/api/calendar/google/callback` (production)
     - `http://localhost:3000/api/calendar/google/callback` (local dev, optional)
   - Save the **Client ID** and **Client secret**.

## 3. Generate the token-encryption key

Refresh tokens are encrypted at rest (AES-256-GCM) before being stored. Generate a
32-byte base64 key:

```
openssl rand -base64 32
```

## 4. Set environment variables

Add to `.env.local` (local) and to Vercel **Production** (and Preview if used):

```
GOOGLE_OAUTH_CLIENT_ID=<client id from step 2>
GOOGLE_OAUTH_CLIENT_SECRET=<client secret from step 2>
CALENDAR_TOKEN_ENC_KEY=<base64 key from step 3>
```

`NEXT_PUBLIC_APP_URL` must already be set correctly (the redirect URI is derived
from it). After adding vars in Vercel, **redeploy** — env vars are baked in at
build time.

> **Do not rotate `CALENDAR_TOKEN_ENC_KEY` after businesses have connected** — every
> stored token is encrypted with it, and changing it makes existing connections
> undecryptable (they'd each need to reconnect). If it ever must be rotated, plan a
> re-connect for all connected businesses.

## 5. Connect a calendar

As a signed-in business owner: **Settings → Calendar → Connect Google Calendar** →
complete Google consent → you're returned to the Calendar settings page showing
**Connected as `<your email>`**. **Disconnect** revokes access and clears the stored
tokens.

---

## What Step 1 does NOT do yet

Reading availability from the calendar, and writing/updating/cancelling real
calendar events on booking, are later steps (2–4). After Step 1, a connected
calendar is stored but does not yet affect any booking — that's intentional and
safe.
