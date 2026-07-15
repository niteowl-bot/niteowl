'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSearchParams } from 'next/navigation'

type Stage = 'form' | 'sent'

export default function ForgotPasswordForm() {
  const supabase = createClient()
  const searchParams = useSearchParams()
  const linkExpired = searchParams.get('error') === 'link'

  const [stage, setStage] = useState<Stage>('form')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/confirm-reset`,
    })

    setLoading(false)

    // Always show the same "check your email" confirmation, whether or
    // not the address has an account — never reveal which emails exist.
    if (error) {
      console.error('[forgot password] resetPasswordForEmail error:', error)
    }
    setStage('sent')
  }

  if (stage === 'sent') {
    return (
      <div className="w-full max-w-sm">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 text-center">
          <div className="w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-white font-bold text-xl mb-2">Check your email</h2>
          <p className="text-slate-400 text-sm leading-relaxed">
            If an account exists for{' '}
            <span className="text-white font-medium">{email}</span>, we&apos;ve
            sent a link to reset your password.
          </p>
          <p className="text-slate-600 text-xs mt-5">
            Didn&apos;t get it? Check your spam folder, or try again below.
          </p>
        </div>
        <p className="text-slate-500 text-sm text-center mt-5">
          <a href="/login" className="text-indigo-400 hover:text-indigo-300 font-medium">
            Back to sign in
          </a>
        </p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8">
        <h1 className="text-white font-bold text-2xl mb-1">Reset your password</h1>
        <p className="text-slate-400 text-sm mb-7">
          Enter the email you sign in with and we&apos;ll send you a link to
          choose a new password.
        </p>

        {linkExpired && (
          <div className="bg-red-950 border border-red-800 text-red-300 text-sm rounded-lg px-3.5 py-2.5 mb-5">
            That reset link has expired or was already used. Request a new one below.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-slate-300 text-sm font-medium mb-1.5">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-slate-800 border border-slate-600 text-white placeholder-slate-500 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {error && (
            <div className="bg-red-950 border border-red-800 text-red-300 text-sm rounded-lg px-3.5 py-2.5">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
          >
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      </div>

      <p className="text-slate-500 text-sm text-center mt-5">
        Remembered your password?{' '}
        <a href="/login" className="text-indigo-400 hover:text-indigo-300 font-medium">
          Sign in
        </a>
      </p>
    </div>
  )
}
