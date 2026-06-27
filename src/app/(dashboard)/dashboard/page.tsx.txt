import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const name = user.user_metadata?.full_name?.split(' ')[0] ?? 'there'

  return (
    <div className="min-h-screen bg-slate-950">

      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <span className="text-white font-bold text-xl tracking-tight">
          niteowl<span className="text-indigo-400">.</span>
        </span>
        <div className="flex items-center gap-4">
          <span className="text-slate-400 text-sm">{user.email}</span>
          <SignOutButton />
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-16 text-center">
        <div className="inline-flex items-center gap-2 bg-indigo-950 border border-indigo-800 text-indigo-300 text-xs font-medium px-3 py-1.5 rounded-full mb-6">
          <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
          Remy is setting up
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">
          Welcome, {name} 👋
        </h1>
        <p className="text-slate-400 text-lg mb-12 max-w-xl mx-auto">
          Your Niteowl account is active. The dashboard is being built — check back soon.
        </p>

        {/* Placeholder stat cards */}
        <div className="grid sm:grid-cols-3 gap-4 mb-12">
          {[
            { label: 'Open conversations', value: '0' },
            { label: 'Contacts', value: '0' },
            { label: 'AI messages sent', value: '0' },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-slate-900 border border-slate-700 rounded-xl px-5 py-5 text-left"
            >
              <p className="text-slate-400 text-sm mb-1">{stat.label}</p>
              <p className="text-white font-bold text-3xl">{stat.value}</p>
            </div>
          ))}
        </div>

        <div className="bg-slate-900 border border-slate-700 rounded-xl p-8">
          <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </div>
          <h2 className="text-white font-semibold text-lg mb-2">Next step: set up your business</h2>
          <p className="text-slate-400 text-sm mb-5">
            Tell Remy about your business so it can start replying to your customers.
          </p>
          <a
            href="/onboarding"
            className="inline-block bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
          >
            Set up my business
          </a>
        </div>
      </main>
    </div>
  )
}

function SignOutButton() {
  return (
    <form action="/auth/signout" method="POST">
      <button
        type="submit"
        className="text-slate-400 hover:text-white text-sm transition-colors"
      >
        Sign out
      </button>
    </form>
  )
}
