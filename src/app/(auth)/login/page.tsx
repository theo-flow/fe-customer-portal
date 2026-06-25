'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    await new Promise(r => setTimeout(r, 700))
    router.push('/upload')
  }

  return (
    <div className="flex" style={{ background: '#0B0B0B', minHeight: '100dvh' }}>

      {/* ── LEFT: form panel ── */}
      <div className="flex-1 flex flex-col px-10 py-10 sm:px-14 lg:px-16 min-h-screen">

        {/* Logo */}
        <motion.div className="flex items-center gap-2.5"
          initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}>
          <Mark />
          <span className="font-display text-[1rem] tracking-tight text-white">theoflow</span>
        </motion.div>

        {/* Form — lower half of the panel */}
        <div className="flex-1 flex items-end pb-[10vh]">
          <motion.div className="w-full"
            initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}>

            <h1 className="font-display text-[2.8rem] leading-tight text-white mb-2">
              Sign in
            </h1>
            <p className="text-[13px] mb-9" style={{ color: 'rgba(255,255,255,0.36)' }}>
              Welcome back — enter your credentials below.
            </p>

            {error && (
              <div className="mb-5 px-4 py-3 rounded-xl text-red-400 text-[13px]"
                   style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-semibold tracking-wide uppercase mb-2"
                       style={{ color: 'rgba(255,255,255,0.45)' }}>
                  Email address
                </label>
                <DarkInput
                  type="email" autoComplete="email" value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com" required
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold tracking-wide uppercase mb-2"
                       style={{ color: 'rgba(255,255,255,0.45)' }}>
                  Password
                </label>
                <DarkInput
                  type="password" autoComplete="current-password" value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password" required
                />
              </div>
            </div>

            <div className="mt-7 flex items-center gap-5">
              <button
                onClick={handleSubmit as unknown as React.MouseEventHandler}
                disabled={loading}
                className="px-8 py-3 rounded-full text-[14px] font-medium text-black bg-white
                           hover:bg-white/90 active:bg-white/80 transition-all
                           disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0">
                {loading
                  ? <span className="flex items-center gap-2">
                      <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                      </svg>
                      Signing in…
                    </span>
                  : 'Sign in'}
              </button>
              <Link href="#" className="text-[13px]"
                    style={{ color: 'rgba(255,255,255,0.35)' }}>
                Forgot password?
              </Link>
            </div>

            <p className="mt-8 text-[13px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Don&apos;t have an account?{' '}
              <Link href="/register" className="font-semibold" style={{ color: '#7BA8E0' }}>
                Sign up
              </Link>
            </p>
          </motion.div>
        </div>
      </div>

      {/* ── RIGHT: Animated gradient art — no border ── */}
      <div className="hidden lg:block lg:w-[55%] xl:w-[58%] flex-shrink-0 p-5">
        <div className="w-full h-full rounded-3xl overflow-hidden relative" style={{ minHeight: '94vh' }}>

          <div className="absolute inset-0" style={{ background: '#F5EDD8' }}/>

          <div className="blob-one absolute" style={{
            top:'-8%', right:'-8%', width:'88%', height:'80%',
            background:'radial-gradient(ellipse at 58% 38%, #F2C060 0%, #E8A030 52%, transparent 78%)',
            filter:'blur(64px)', opacity:0.95, willChange:'transform',
          }}/>
          <div className="blob-two absolute" style={{
            bottom:'-12%', left:'-8%', width:'85%', height:'82%',
            background:'radial-gradient(ellipse at 38% 62%, #4E82CC 0%, #3668B8 48%, transparent 75%)',
            filter:'blur(64px)', opacity:0.92, willChange:'transform',
          }}/>
          <div className="blob-three absolute" style={{
            top:'-5%', left:'-5%', width:'68%', height:'65%',
            background:'radial-gradient(ellipse at 32% 32%, #7AAEE0 0%, #5890D4 52%, transparent 76%)',
            filter:'blur(56px)', opacity:0.75, willChange:'transform',
          }}/>
          <div className="blob-four absolute" style={{
            top:'22%', left:'18%', width:'62%', height:'56%',
            background:'radial-gradient(ellipse at 50% 50%, #FBF0D5 0%, #F5DFA8 62%, transparent 82%)',
            filter:'blur(52px)', opacity:0.68, willChange:'transform',
          }}/>
          <div className="blob-five absolute" style={{
            bottom:'-4%', right:'-4%', width:'62%', height:'58%',
            background:'radial-gradient(ellipse at 62% 65%, #F0B850 0%, #E89820 56%, transparent 78%)',
            filter:'blur(58px)', opacity:0.82, willChange:'transform',
          }}/>

          {/* Film grain */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none"
               style={{ opacity:0.45, mixBlendMode:'overlay' }}>
            <filter id="grain-login">
              <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="4" stitchTiles="stitch"/>
              <feColorMatrix type="saturate" values="0"/>
            </filter>
            <rect width="100%" height="100%" filter="url(#grain-login)"/>
          </svg>
        </div>
      </div>
    </div>
  )
}

/* ── Shared mark ────────────────────────────────────────────── */
function Mark() {
  return (
    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
         style={{ background:'rgba(255,255,255,0.10)', border:'1px solid rgba(255,255,255,0.16)' }}>
      <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 16 16" fill="none">
        <path d="M3 4h10M3 8h7M3 12h5" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  )
}

/* ── Dark input ─────────────────────────────────────────────── */
function DarkInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="dark-input"
      style={{
        width:        '100%',
        padding:      '15px 18px',
        borderRadius: '12px',
        fontSize:     '15px',
        color:        'white',
        background:   '#0B0B0B',      // pure black — same as page, no grayish tint
        border:       '1px solid rgba(255,255,255,0.22)',
        outline:      'none',
        transition:   'border-color 0.15s',
      }}
      onFocus={e => {
        e.target.style.borderColor = 'rgba(255,255,255,0.55)'
        props.onFocus?.(e)
      }}
      onBlur={e => {
        e.target.style.borderColor = 'rgba(255,255,255,0.22)'
        props.onBlur?.(e)
      }}
    />
  )
}
