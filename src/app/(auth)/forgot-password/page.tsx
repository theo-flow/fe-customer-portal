'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { forgotPassword, confirmNewPassword, friendlyError } from '@/lib/auth'

const EMAIL_RE  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DIGIT_RE  = /^\d{6}$/

function pwStrength(p: string) {
  let s = 0
  if (p.length >= 12)          s++
  if (/[A-Z]/.test(p))         s++
  if (/[0-9]/.test(p))         s++
  if (/[^A-Za-z0-9]/.test(p))  s++
  return s
}
const SMETA = [
  null,
  { label: 'Weak',   bar: 'bg-red-500',  text: 'text-red-400'   },
  { label: 'Fair',   bar: 'bg-amber-500', text: 'text-amber-400' },
  { label: 'Good',   bar: 'bg-blue-400',  text: 'text-blue-300'  },
  { label: 'Strong', bar: 'bg-white',     text: 'text-white'     },
]

export default function ForgotPasswordPage() {
  const router  = useRouter()

  const [phase, setPhase]         = useState<'email' | 'reset'>('email')
  const [email, setEmail]         = useState('')
  const [code, setCode]           = useState('')
  const [newPassword, setNew]     = useState('')
  const [confirm, setConfirm]     = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [codeSent, setCodeSent]   = useState(false)

  const s     = pwStrength(newPassword)
  const smeta = SMETA[s]

  // Phase 1 — request code
  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email.trim())                { setError('Email address is required.'); return }
    if (!EMAIL_RE.test(email.trim())) { setError('Enter a valid email address.'); return }
    setLoading(true)
    try {
      await forgotPassword(email.trim().toLowerCase())
      setCodeSent(true)
      setPhase('reset')
    } catch (err: unknown) {
      // Always show a generic message — don't reveal whether email exists
      const raw = err as { code?: string }
      if (raw.code === 'UserNotFoundException') {
        // Silently succeed to prevent enumeration — user sees the same UI
        setCodeSent(true)
        setPhase('reset')
      } else {
        setError(friendlyError(raw as { code?: string; message?: string }))
      }
    } finally {
      setLoading(false)
    }
  }

  // Phase 2 — submit new password
  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!DIGIT_RE.test(code.replace(/\s/g, ''))) {
      setError('Enter the 6-digit code from your email.')
      return
    }
    if (s < 3) {
      setError('Use 12+ characters with an uppercase letter, a number, and a symbol.')
      return
    }
    if (newPassword !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      await confirmNewPassword(email.trim().toLowerCase(), code.replace(/\s/g, ''), newPassword)
      router.push('/login?reset=1')
    } catch (err: unknown) {
      setError(friendlyError(err as { code?: string; message?: string }))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex" style={{ background: '#0B0B0B', minHeight: '100dvh' }}>

      {/* ── LEFT: form panel ── */}
      <div className="flex-1 flex flex-col px-6 py-8 sm:px-12 lg:px-16 min-h-[100dvh]">

        <motion.div className="flex items-center gap-2.5"
          initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}>
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
               style={{ background:'rgba(255,255,255,0.10)', border:'1px solid rgba(255,255,255,0.16)' }}>
            <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 16 16" fill="none">
              <path d="M3 4h10M3 8h7M3 12h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="font-display text-[1rem] tracking-tight text-white">theoflow</span>
        </motion.div>

        <div className="flex-1 flex items-end pb-[10vh]">
          <motion.div className="w-full max-w-[400px]"
            initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}>

            {phase === 'email' ? (
              <>
                <h1 className="font-display text-[2.8rem] leading-tight text-white mb-2">
                  Reset password
                </h1>
                <p className="text-[13px] mb-9" style={{ color: 'rgba(255,255,255,0.36)' }}>
                  Enter your email and we&apos;ll send a reset code.
                </p>

                {error && <ErrorBanner msg={error} />}

                <form onSubmit={handleRequestCode} noValidate>
                  <div>
                    <label htmlFor="email"
                           className="block text-[12px] font-semibold tracking-wide uppercase mb-2"
                           style={{ color: 'rgba(255,255,255,0.45)' }}>
                      Email address
                    </label>
                    <DarkInput
                      id="email" type="email" autoComplete="email"
                      value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="you@example.com" required
                    />
                  </div>

                  <div className="mt-7 flex items-center gap-5">
                    <button type="submit" disabled={loading}
                            className="px-8 py-3 rounded-full text-[14px] font-medium text-black bg-white
                                       hover:bg-white/90 active:bg-white/80 transition-all
                                       disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0">
                      {loading
                        ? <span className="flex items-center gap-2"><Spinner /> Sending…</span>
                        : 'Send reset code'}
                    </button>
                    <Link href="/login" className="text-[13px]"
                          style={{ color: 'rgba(255,255,255,0.35)' }}>
                      Back to sign in
                    </Link>
                  </div>
                </form>
              </>
            ) : (
              <>
                <h1 className="font-display text-[2.8rem] leading-tight text-white mb-2">
                  Check your email
                </h1>
                <p className="text-[13px] mb-9" style={{ color: 'rgba(255,255,255,0.36)' }}>
                  {codeSent
                    ? <>We sent a 6-digit code to <span className="text-white font-medium">{email}</span>. Enter it below along with your new password.</>
                    : 'Enter the code from your email and choose a new password.'}
                </p>

                {error && <ErrorBanner msg={error} />}

                <form onSubmit={handleReset} noValidate>
                  <div className="space-y-5">
                    <div>
                      <label htmlFor="code"
                             className="block text-[12px] font-semibold tracking-wide uppercase mb-2"
                             style={{ color: 'rgba(255,255,255,0.45)' }}>
                        Reset code
                      </label>
                      <DarkInput
                        id="code" type="text" inputMode="numeric" autoComplete="one-time-code"
                        value={code} onChange={e => setCode(e.target.value)}
                        placeholder="6-digit code" maxLength={6} required
                      />
                    </div>

                    <div>
                      <label htmlFor="new-password"
                             className="block text-[12px] font-semibold tracking-wide uppercase mb-2"
                             style={{ color: 'rgba(255,255,255,0.45)' }}>
                        New password
                      </label>
                      <DarkInput
                        id="new-password" type="password" autoComplete="new-password"
                        value={newPassword} onChange={e => setNew(e.target.value)}
                        placeholder="Min. 12 characters" required
                      />
                      {newPassword && smeta && (
                        <div className="mt-3">
                          <div className="flex gap-1 h-0.5">
                            {[1,2,3,4].map(i => (
                              <div key={i}
                                className={`flex-1 rounded-full transition-all duration-300
                                  ${i <= s ? smeta.bar : 'bg-white/10'}`}/>
                            ))}
                          </div>
                          <p className={`text-[0.7rem] mt-1.5 font-medium ${smeta.text}`}>
                            {smeta.label} — {
                              s < 3
                                ? 'must include 12+ chars, uppercase, number, and symbol'
                                : 'password meets requirements'
                            }
                          </p>
                        </div>
                      )}
                    </div>

                    <div>
                      <label htmlFor="confirm-password"
                             className="block text-[12px] font-semibold tracking-wide uppercase mb-2"
                             style={{ color: 'rgba(255,255,255,0.45)' }}>
                        Confirm new password
                      </label>
                      <DarkInput
                        id="confirm-password" type="password" autoComplete="new-password"
                        value={confirm} onChange={e => setConfirm(e.target.value)}
                        placeholder="Repeat password" required
                      />
                      {confirm.length > 0 && newPassword !== confirm && (
                        <p className="mt-1.5 text-[11px] text-red-400">Passwords do not match.</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-7 flex items-center gap-5">
                    <button type="submit" disabled={loading}
                            className="px-8 py-3 rounded-full text-[14px] font-medium text-black bg-white
                                       hover:bg-white/90 active:bg-white/80 transition-all
                                       disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0">
                      {loading
                        ? <span className="flex items-center gap-2"><Spinner /> Resetting…</span>
                        : 'Set new password'}
                    </button>
                    <button type="button"
                            onClick={() => { setPhase('email'); setError('') }}
                            className="text-[13px]"
                            style={{ color: 'rgba(255,255,255,0.35)' }}>
                      Resend code
                    </button>
                  </div>
                </form>
              </>
            )}
          </motion.div>
        </div>
      </div>

      {/* ── RIGHT: gradient art ── */}
      <div className="hidden lg:block lg:w-[55%] xl:w-[58%] flex-shrink-0 p-5">
        <div className="w-full h-full rounded-3xl overflow-hidden relative" style={{ minHeight: '94vh' }}>
          <div className="absolute inset-0" style={{ background: '#F5EDD8' }}/>
          <div className="blob-one absolute" style={{ top:'-8%', right:'-8%', width:'88%', height:'80%', background:'radial-gradient(ellipse at 58% 38%, #F2C060 0%, #E8A030 52%, transparent 78%)', filter:'blur(64px)', opacity:0.95, willChange:'transform' }}/>
          <div className="blob-two absolute" style={{ bottom:'-12%', left:'-8%', width:'85%', height:'82%', background:'radial-gradient(ellipse at 38% 62%, #4E82CC 0%, #3668B8 48%, transparent 75%)', filter:'blur(64px)', opacity:0.92, willChange:'transform' }}/>
          <div className="blob-three absolute" style={{ top:'-5%', left:'-5%', width:'68%', height:'65%', background:'radial-gradient(ellipse at 32% 32%, #7AAEE0 0%, #5890D4 52%, transparent 76%)', filter:'blur(56px)', opacity:0.75, willChange:'transform' }}/>
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity:0.45, mixBlendMode:'overlay' }}>
            <filter id="grain-fp"><feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="4" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
            <rect width="100%" height="100%" filter="url(#grain-fp)"/>
          </svg>
        </div>
      </div>
    </div>
  )
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div role="alert"
         className="mb-5 px-4 py-3 rounded-xl text-red-400 text-[13px]"
         style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
      {msg}
    </div>
  )
}

function DarkInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props} className="dark-input"
      style={{ width:'100%', padding:'15px 18px', borderRadius:'12px', fontSize:'15px',
               color:'white', background:'#0B0B0B', border:'1px solid rgba(255,255,255,0.22)',
               outline:'none', transition:'border-color 0.15s' }}
      onFocus={e => { e.target.style.borderColor = 'rgba(255,255,255,0.55)'; props.onFocus?.(e) }}
      onBlur={e  => { e.target.style.borderColor = 'rgba(255,255,255,0.22)'; props.onBlur?.(e) }}
    />
  )
}

function Spinner() {
  return (
    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
    </svg>
  )
}
