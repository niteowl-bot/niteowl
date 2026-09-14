import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'

// Password-recovery link target. Mirrors /auth/callback's code exchange
// exactly, but redirects to /reset-password afterwards instead of
// /dashboard — recovery must land on a "set a new password" form, not
// silently sign the owner in with their old (forgotten) password still
// unchanged.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
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

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL('/reset-password', origin))
    }

    // Expired or already-used link — send back to request a fresh one.
    return NextResponse.redirect(new URL('/forgot-password?error=link', origin))
  }

  // No code at all. Supabase's implicit flow delivers the recovery
  // session in the URL FRAGMENT, which never reaches a server handler —
  // so "no code" is not "no link", and treating it as expired sent every
  // fragment-based recovery straight to the error page. Browsers keep the
  // fragment across a redirect, so forward it to the reset page, where
  // the client consumes it (src/lib/auth/hashSession.ts) and then still
  // insists on a real session before showing the form. A genuinely empty
  // visit lands on that page's "link expired or invalid" state.
  return NextResponse.redirect(new URL('/reset-password', origin))
}
