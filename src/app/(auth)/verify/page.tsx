'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { BrandMark } from '@/components/BrandMark'

export default function VerifyPage() {
  const router = useRouter()
  const [code, setCode] = useState(['', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const [resent, setResent] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const inputs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    inputs.current[0]?.focus()
  }, [])

  useEffect(() => {
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown(c => c - 1), 1000)
      return () => clearTimeout(t)
    }
  }, [countdown])

  const handleDigit = (i: number, val: string) => {
    if (!/^\d*$/.test(val)) return
    const next = [...code]
    next[i] = val.slice(-1)
    setCode(next)
    if (val && i < 5) inputs.current[i + 1]?.focus()
    if (next.every(d => d) && next.join('').length === 6) {
      handleVerify(next.join(''))
    }
  }

  const handleKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[i] && i > 0) inputs.current[i - 1]?.focus()
  }

  const handleVerify = async (fullCode?: string) => {
    setLoading(true)
    // TODO: replace with Amplify Auth.confirmSignUp
    await new Promise(r => setTimeout(r, 900))
    router.push('/upload')
  }

  const handleResend = () => {
    setResent(true)
    setCountdown(60)
    // TODO: Amplify Auth.resendSignUpCode
  }

  const full = code.join('')

  return (
    <div className="min-h-screen bg-forest-deep flex flex-col items-center justify-center px-4 py-12">
      <div className="text-center mb-8">
        <BrandMark size="lg" />
        <h1 className="font-display text-3xl text-white mt-4">Check your email</h1>
        <p className="text-slate text-sm mt-2 max-w-xs mx-auto">
          We sent a 6-digit code to your email address. Enter it below to verify your account.
        </p>
      </div>

      <div className="w-full max-w-sm card">
        {/* OTP inputs */}
        <div className="flex gap-2 justify-center mb-6">
          {code.map((digit, i) => (
            <input
              key={i}
              ref={el => { inputs.current[i] = el }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={e => handleDigit(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              className="w-11 h-14 text-center text-xl font-semibold border-2 rounded-xl
                         border-gray-200 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent
                         transition-all text-gray-900"
            />
          ))}
        </div>

        <button
          onClick={() => handleVerify()}
          disabled={full.length < 6 || loading}
          className="btn-primary"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Verifying…
            </span>
          ) : 'Verify account'}
        </button>

        <div className="mt-6 pt-6 border-t border-gray-100 text-center text-sm text-gray-500">
          {countdown > 0 ? (
            <p>Resend code in <span className="font-medium text-gray-700">{countdown}s</span></p>
          ) : (
            <button onClick={handleResend} className="text-accent hover:text-green-600 transition-colors">
              {resent ? 'Code resent — check your email' : 'Resend code'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
