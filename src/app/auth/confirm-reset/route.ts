import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { parseRecoveryLinkParams } from '@/lib/auth/recoveryLink'

// Password-recovery link target. Mirrors /auth/callback's code exchange
// exactly, but redirects to /reset-password afterwards instead of
// /dashboard — recovery must land on a "set a new password" form, not
// silently sign the owner in with their old (forgotten) password still
// unchanged.
//
// Two link shapes are accepted (src/lib/auth/recoveryLink.ts):
//   token_hash + type=recovery — verified server-side with verifyOtp, so
//     the link works from ANY browser or device. This is what the Reset
//     Password email template sends.
//   code — the PKCE exchange, kept as it was for links already issued.
// Both establish the session through the same SSR cookie plumbing; the
// only difference is which Supabase call proves the link.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const link = parseRecoveryLinkParams(searchParams)

  if (link.kind === 'token_hash' || link.kind === 'code') {
    const cookieStore = await cookies()

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {}
          },
        },
      }
    )

    // The type is fixed HERE, never read from the URL: the URL's `type`
    // only gates entry to this branch, so a token issued for a magic link
    // or signup can never be turned into a recovery session by relabelling.
    const { error } =
      link.kind === 'token_hash'
        ? await supabase.auth.verifyOtp({ type: 'recovery', token_hash: link.token_hash })
        : await supabase.auth.exchangeCodeForSession(link.code)
    if (!error) {
      return NextResponse.redirect(new URL('/reset-password', origin))
    }

    // Expired or already-used link — send back to request a fresh one.
    return NextResponse.redirect(new URL('/forgot-password?error=link', origin))
  }

  // A recognisable but malformed or ambiguous link (a type without a
  // hash, a hash with the wrong type, both shapes at once) is refused
  // outright rather than guessed at.
  if (link.kind === 'invalid') {
    return NextResponse.redirect(new URL('/forgot-password?error=link', origin))
  }

  // No credential at all. Supabase's implicit flow delivers the recovery
  // session in the URL FRAGMENT, which never reaches a server handler —
  // so "no code" is not "no link", and treating it as expired sent every
  // fragment-based recovery straight to the error page. Browsers keep the
  // fragment across a redirect, so forward it to the reset page, where
  // the client consumes it (src/lib/auth/hashSession.ts) and then still
  // insists on a real session before showing the form. A genuinely empty
  // visit lands on that page's "link expired or invalid" state.
  return NextResponse.redirect(new URL('/reset-password', origin))
}
