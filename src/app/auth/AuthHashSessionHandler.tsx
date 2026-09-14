'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { consumeAuthHashSession, postAuthHashPath } from '@/lib/auth/hashSession'

// Mounted once, in the root layout, because Supabase sends an implicit-
// flow redirect to whichever URL the link named — the Site URL for a
// magic link, /auth/confirm-reset (then /reset-password) for recovery —
// so the consumer cannot live on a single page. It renders nothing and,
// on a page with no auth fragment, creates no client and does no work.
//
// On success the visitor is sent to a FIXED destination chosen from the
// fragment's `type` (see postAuthHashPath); nothing in the URL can pick
// the target. On failure the fragment has already been removed and the
// page is left exactly as it was — signed out.
export default function AuthHashSessionHandler() {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false

    consumeAuthHashSession(() => createClient(), window).then((outcome) => {
      if (cancelled || outcome.kind !== 'session') return
      const target = postAuthHashPath(outcome.type)
      if (window.location.pathname !== target) {
        router.replace(target)
      }
      // The session was written to cookies client-side; server components
      // and middleware re-read them on refresh, as after a password login.
      router.refresh()
    })

    return () => {
      cancelled = true
    }
  }, [router])

  return null
}
