'use client'
import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { signIn, friendlyError } from '@/lib/auth'
import { LogoMark } from '@/components/LogoMark'

// TEMPORARY — diagnosing a production "session expired immediately after
// login" bug that can't be reproduced with DevTools (blocked in the
// tester's environment). Gated behind an unguessable query param so it
// never shows for real traffic. Remove once the root cause is confirmed
// fixed. Deliberately does not render the raw token -- only derived,
// non-sensitive diagnostic values.
const DEBUG_ACTIVE_KEY  = 'tf_debug_active'
const DEBUG_PRESEND_KEY = 'tf_debug_presend'

function snapshotCookieLines(label: string): string {
  const match = document.cookie.match(/(?:^|;\s*)tf_token=([^;]*)/)
  if (!match) return `[${label}] tf_token cookie: NOT PRESENT`
  const token = match[1]
  const lines = [`[${label}] tf_token cookie: PRESENT (length ${token.length})`]
  const parts = token.split('.')
  lines.push(`[${label}] JWT segments: ${parts.length}`)
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    const nowSec = Date.now() / 1000
    lines.push(`[${label}] exp: ${payload.exp} (${new Date(payload.exp * 1000).toISOString()})`)
    lines.push(`[${label}] iat: ${payload.iat} (${new Date(payload.iat * 1000).toISOString()})`)
    lines.push(`[${label}] browser now: ${nowSec.toFixed(0)} (${new Date().toISOString()})`)
    lines.push(`[${label}] isExpired would return: ${nowSec > payload.exp}`)
    lines.push(`[${label}] token_use: ${payload.token_use ?? 'n/a'}`)
    lines.push(`[${label}] aud/client_id: ${payload.aud ?? payload.client_id ?? 'n/a'}`)
  } catch (e) {
    lines.push(`[${label}] DECODE FAILED: ${e instanceof Error ? e.message : String(e)}`)
  }
  return lines.join('\n')
}

function CookieDebugPanel() {
  const [info, setInfo] = useState<string | null>(null)

  useEffect(() => {
    const presend = sessionStorage.getItem(DEBUG_PRESEND_KEY)
    const current = snapshotCookieLines('CURRENT — after landing on this page')
    setInfo([
      presend ? presend : '[PRE-SEND] no snapshot captured yet — submit the login form with this debug session active first',
      '',
      current,
    ].join('\n'))
  }, [])

  return (
    <pre role="status" className="mb-5 px-4 py-3 rounded-xl text-[11px] whitespace-pre-wrap"
         style={{ background: 'rgba(59,130,246,0.10)', border: '1px solid rgba(59,130,246,0.3)', color: '#93c5fd' }}>
      {info ?? 'loading cookie diagnostics…'}
    </pre>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const searchParams = useSearchParams()
  // Validate the redirect target is a relative path to prevent open redirect
  const rawNext = searchParams.get('next') ?? ''
  const next    = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard'

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const verified = searchParams.get('verified') === '1'
  const resetDone = searchParams.get('reset') === '1'
  const sessionExpired = searchParams.get('reason') === 'expired'
  const debugParam = searchParams.get('debug') === 'sm2026diag'
  useEffect(() => {
    // Debug mode survives the middleware bounce (which strips unknown query
    // params) by persisting a flag across the navigation in sessionStorage.
    if (debugParam) sessionStorage.setItem(DEBUG_ACTIVE_KEY, '1')
  }, [debugParam])
  const showDebug = debugParam || (typeof window !== 'undefined' && sessionStorage.getItem(DEBUG_ACTIVE_KEY) === '1')

  useEffect(() => {
    // reason=expired is a one-time signal from middleware's redirect, not a
    // durable fact about this URL -- without stripping it, hitting back,
    // reloading, or revisiting a stale/shared link keeps re-showing "session
    // expired" to someone who may never have had a session on this visit.
    if (!sessionExpired) return
    const params = new URLSearchParams(window.location.search)
    params.delete('reason')
    const qs = params.toString()
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname)
  }, [sessionExpired])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email.trim())    { setError('Email address is required.'); return }
    if (!password)        { setError('Password is required.'); return }
    setLoading(true)
    try {
      await signIn(email.trim(), password)
      if (showDebug) {
        sessionStorage.setItem(DEBUG_PRESEND_KEY, snapshotCookieLines('PRE-SEND — right after signIn(), before navigating'))
      }
      // Hard navigation, not router.push: middleware's auth check must see
      // the cookie we just set via a fresh top-level request. A soft
      // client-side push can be served from Next's client route cache
      // (or otherwise diverge from a real page load), which was
      // reproducing as an immediate false "session expired" bounce
      // straight after a successful sign-in.
      window.location.href = next
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

        <Link href="/" className="inline-flex">
          <motion.div className="flex items-center gap-2.5"
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}>
            <Mark />
            <span className="font-display text-[1rem] tracking-tight text-white">theoflow</span>
          </motion.div>
        </Link>

        <div className="flex-1 flex items-end pb-[10vh]">
          <motion.div className="w-full"
            initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}>

            <h1 className="font-display text-[2.8rem] leading-tight text-white mb-2">Sign in</h1>
            <p className="text-[13px] mb-9" style={{ color: 'rgba(255,255,255,0.36)' }}>
              Welcome back — enter your credentials below.
            </p>

            {showDebug && <CookieDebugPanel />}
            {verified && (
              <div role="status"
                   className="mb-5 px-4 py-3 rounded-xl text-green-400 text-[13px]"
                   style={{ background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.25)' }}>
                Email verified — you can now sign in.
              </div>
            )}
            {resetDone && (
              <div role="status"
                   className="mb-5 px-4 py-3 rounded-xl text-green-400 text-[13px]"
                   style={{ background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.25)' }}>
                Password reset successfully — sign in with your new password.
              </div>
            )}
            {sessionExpired && (
              <div role="status"
                   className="mb-5 px-4 py-3 rounded-xl text-amber-400 text-[13px]"
                   style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.25)' }}>
                Your session has expired. Please sign in again.
              </div>
            )}
            {error && (
              <div role="alert"
                   className="mb-5 px-4 py-3 rounded-xl text-red-400 text-[13px]"
                   style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate>
              <div className="space-y-4">
                <div>
                  <label htmlFor="email"
                         className="block text-[12px] font-semibold tracking-wide uppercase mb-2"
                         style={{ color: 'rgba(255,255,255,0.45)' }}>
                    Email address
                  </label>
                  <DarkInput
                    id="email" type="email" autoComplete="email" value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com" required
                  />
                </div>

                <div>
                  <label htmlFor="password"
                         className="block text-[12px] font-semibold tracking-wide uppercase mb-2"
                         style={{ color: 'rgba(255,255,255,0.45)' }}>
                    Password
                  </label>
                  <DarkInput
                    id="password" type="password" autoComplete="current-password" value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Enter your password" required
                  />
                </div>
              </div>

              <div className="mt-7 flex items-center gap-5">
                <button type="submit" disabled={loading}
                        className="px-8 py-3 rounded-full text-[14px] font-medium text-black bg-white
                                   hover:bg-white/90 active:bg-white/80 transition-all
                                   disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0">
                  {loading
                    ? <span className="flex items-center gap-2">
                        <Spinner /> Signing in…
                      </span>
                    : 'Sign in'}
                </button>
                <Link href="/forgot-password" className="text-[13px]"
                      style={{ color: 'rgba(255,255,255,0.35)' }}>
                  Forgot password?
                </Link>
              </div>
            </form>

            <p className="mt-8 text-[13px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Don&apos;t have an account?{' '}
              <Link href="/register" className="font-semibold" style={{ color: '#7BA8E0' }}>
                Sign up
              </Link>
            </p>
          </motion.div>
        </div>

      </div>

      {/* ── RIGHT: Animated gradient art ── */}
      <div className="hidden lg:block lg:w-[55%] xl:w-[58%] flex-shrink-0 p-5">
        <div className="w-full h-full rounded-3xl relative" style={{ minHeight: '94vh', contain: 'paint' }}>
          <div className="absolute inset-0" style={{ background: '#F5EDD8' }}/>
          <div className="absolute" style={{ top:'0', right:'0', width:'88%', height:'80%', transform:'translate(8%,-8%)', background:'radial-gradient(ellipse at 58% 38%, #F2C060 0%, #E8A030 52%, transparent 78%)', filter:'blur(64px)', opacity:0.95 }}/>
          <div className="absolute" style={{ bottom:'0', left:'0', width:'85%', height:'82%', transform:'translate(-8%,12%)', background:'radial-gradient(ellipse at 38% 62%, #4E82CC 0%, #3668B8 48%, transparent 75%)', filter:'blur(64px)', opacity:0.92 }}/>
          <div className="absolute" style={{ top:'0', left:'0', width:'68%', height:'65%', transform:'translate(-5%,-5%)', background:'radial-gradient(ellipse at 32% 32%, #7AAEE0 0%, #5890D4 52%, transparent 76%)', filter:'blur(56px)', opacity:0.75 }}/>
          <div className="absolute" style={{ top:'22%', left:'18%', width:'62%', height:'56%', background:'radial-gradient(ellipse at 50% 50%, #FBF0D5 0%, #F5DFA8 62%, transparent 82%)', filter:'blur(52px)', opacity:0.68 }}/>
          <div className="absolute" style={{ bottom:'0', right:'0', width:'62%', height:'58%', transform:'translate(4%,4%)', background:'radial-gradient(ellipse at 62% 65%, #F0B850 0%, #E89820 56%, transparent 78%)', filter:'blur(58px)', opacity:0.82 }}/>
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity:0.45, mixBlendMode:'overlay' }}>
            <filter id="grain-login"><feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="4" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
            <rect width="100%" height="100%" filter="url(#grain-login)"/>
          </svg>
        </div>
      </div>
    </div>
  )
}


function Mark() {
  return <LogoMark size={40} className="text-white"/>
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
