'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Stage = 'checking' | 'form' | 'done' | 'invalid'

export default function ResetPasswordPage() {
  const router = useRouter()
  const supabase = createClient()

  const [stage, setStage] = useState<Stage>('checking')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // /auth/confirm-reset already exchanged the emailed link's code for a
  // session before redirecting here — this only confirms that session
  // actually exists, so someone can't land on this form (and change a
  // password) without a valid, single-use recovery link.
  useEffect(() => {
    let cancelled = false
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return
      setStage(data.user ? 'form' : 'invalid')
    })
    return () => {
      cancelled = true
    }
  }, [supabase])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSaving(false)

    if (error) {
      setError(error.message)
      return
    }

    setStage('done')
    setTimeout(() => {
      router.push('/dashboard')
      router.refresh()
    }, 1500)
  }

  if (stage === 'checking') {
    return (
      <div className="w-full max-w-sm">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 text-center text-slate-400 text-sm">
          Verifying your reset link…
        </div>
      </div>
    )
  }

  if (stage === 'invalid') {
    return (
      <div className="w-full max-w-sm">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 text-center">
          <h2 className="text-white font-bold text-xl mb-2">Link expired or invalid</h2>
          <p className="text-slate-400 text-sm leading-relaxed">
            This password reset link is no longer valid. Request a new one to continue.
          </p>
        </div>
        <p className="text-slate-500 text-sm text-center mt-5">
          <a href="/forgot-password" className="text-indigo-400 hover:text-indigo-300 font-medium">
            Request a new reset link
          </a>
        </p>
      </div>
    )
  }

  if (stage === 'done') {
    return (
      <div className="w-full max-w-sm">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 text-center">
          <div className="w-12 h-12 bg-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-white font-bold text-xl mb-2">Password updated</h2>
          <p className="text-slate-400 text-sm leading-relaxed">
            Taking you to your dashboard…
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8">
        <h1 className="text-white font-bold text-2xl mb-1">Choose a new password</h1>
        <p className="text-slate-400 text-sm mb-7">
          Make it at least 8 characters.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-slate-300 text-sm font-medium mb-1.5">
              New password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              className="w-full bg-slate-800 border border-slate-600 text-white placeholder-slate-500 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-slate-300 text-sm font-medium mb-1.5">
              Confirm new password
            </label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter your new password"
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
            disabled={saving}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
          >
            {saving ? 'Saving…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  )
}
