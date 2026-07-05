import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { hasActiveAccess } from '@/lib/billing/access'

// Paths that require an active trial/subscription. Excludes
// /settings/billing itself (must stay reachable to reactivate) and
// /onboarding (a brand-new org is always within its trial window).
const BILLING_GATED_PATHS = ['/dashboard', '/chat', '/leads', '/calendar', '/knowledge', '/settings']

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session — do not remove this
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Redirect unauthenticated users away from protected routes
  if (!user && pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Redirect authenticated users away from auth pages
  if (user && (pathname === '/login' || pathname === '/signup')) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // Redirect to the billing page once a business's trial/subscription
  // has lapsed. Scoped to known dashboard paths only (not every
  // request) to avoid an extra DB round-trip on public/API routes.
  const isBillingGatedPath =
    user &&
    !pathname.startsWith('/settings/billing') &&
    BILLING_GATED_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))

  if (isBillingGatedPath) {
    const { data: org } = await supabase
      .from('organisations')
      .select('subscription_status, trial_ends_at')
      .eq('owner_id', user!.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (org && !hasActiveAccess(org)) {
      return NextResponse.redirect(new URL('/settings/billing', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
