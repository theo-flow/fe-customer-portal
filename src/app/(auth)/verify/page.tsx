'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { confirmSignUp, resendCode, friendlyError } from '@/lib/auth'

export default function VerifyPage() {
  const router  = useRouter()
  const [email] = useState<string>(() => {
    if (typeof sessionStorage === 'undefined') return ''
    return sessionStorage.getItem('tf_pending_email') ?? ''
  })
  const [digits, setDigits]     = useState(['', '', '', '', '', ''])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [resent, setResent]     = useState(false)
  const [countdown, setCountdown] = useState(0)
  const inputs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => { inputs.current[0]?.focus() }, [])

  useEffect(() => {
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown(c => c - 1), 1000)
      return () => clearTimeout(t)
    }
  }, [countdown])

  const handleDigit = (i: number, val: string) => {
    if (!/^\d*$/.test(val)) return
    const next = [...digits]
    next[i] = val.slice(-1)
    setDigits(next)
    if (val && i < 5) inputs.current[i + 1]?.focus()
    if (next.every(d => d)) handleVerify(next.join(''))
  }

  const handleKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) inputs.current[i - 1]?.focus()
  }

  const handleVerify = async (code: string) => {
    if (!email) { setError('Email not found — please register again.'); return }
    setError('')
    setLoading(true)
    try {
      await confirmSignUp(email, code)
      sessionStorage.removeItem('tf_pending_email')
      router.push('/login?verified=1')
    } catch (err: unknown) {
      setError(friendlyError(err as { code?: string; message?: string }))
      setDigits(['', '', '', '', '', ''])
      inputs.current[0]?.focus()
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    if (!email) return
    setError('')
    try {
      await resendCode(email)
      setResent(true)
      setCountdown(60)
    } catch (err: unknown) {
      setError(friendlyError(err as { code?: string; message?: string }))
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[380px]">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-12">
          <div className="w-7 h-7 rounded-lg bg-black flex items-center justify-center flex-shrink-0">
            <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 16 16" fill="none">
              <path d="M3 4h10M3 8h7M3 12h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="font-display text-[1rem] tracking-tight text-black">theoflow</span>
        </div>

        <h1 className="font-display text-[2.4rem] leading-tight text-black mb-2">Check your email</h1>
        <p className="text-[13px] text-gray-400 mb-8 leading-relaxed">
          We sent a 6-digit code to{' '}
          <span className="text-black font-medium">{email || 'your email address'}</span>.
          Enter it below to verify your account.
        </p>

        {error && (
          <div role="alert"
               className="mb-6 px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-[13px]">
            {error}
          </div>
        )}

        {/* OTP digit inputs */}
        <div className="flex gap-2 mb-8" role="group" aria-label="Verification code">
          {digits.map((digit, i) => (
            <input
              key={i}
              ref={el => { inputs.current[i] = el }}
              type="text" inputMode="numeric" maxLength={1}
              value={digit} aria-label={`Digit ${i + 1}`}
              onChange={e => handleDigit(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              className="w-full aspect-square text-center text-xl font-semibold rounded-xl
                         border-2 border-gray-200 focus:border-black focus:outline-none
                         transition-colors text-gray-900"
            />
          ))}
        </div>

        <button
          onClick={() => handleVerify(digits.join(''))}
          disabled={digits.join('').length < 6 || loading}
          className="btn-black">
          {loading
            ? <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
                Verifying…
              </span>
            : 'Verify account'}
        </button>

        <div className="mt-6 text-center text-[13px] text-gray-400">
          {countdown > 0 ? (
            <p>Resend code in <span className="font-medium text-gray-700">{countdown}s</span></p>
          ) : (
            <button onClick={handleResend}
                    className="text-black font-medium hover:underline underline-offset-2 transition-colors">
              {resent ? '✓ Code resent — check your inbox' : 'Resend code'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
