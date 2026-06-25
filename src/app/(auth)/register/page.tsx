'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function RegisterPage() {
  const router = useRouter()
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const strength = (p: string) => {
    let s = 0
    if (p.length >= 8) s++
    if (/[A-Z]/.test(p)) s++
    if (/[0-9]/.test(p)) s++
    if (/[^A-Za-z0-9]/.test(p)) s++
    return s
  }
  const s = strength(form.password)
  const strengthMeta = [
    null,
    { label: 'Weak',   bars: 'bg-red-400',      text: 'text-red-500'   },
    { label: 'Fair',   bars: 'bg-amber-400',     text: 'text-amber-600' },
    { label: 'Good',   bars: 'bg-emerald-400',   text: 'text-emerald-600' },
    { label: 'Strong', bars: 'bg-black',          text: 'text-gray-800'  },
  ][s]

  const update = (f: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [f]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return }
    if (s < 3) { setError('Use 8+ characters, uppercase letter, number, and symbol.'); return }
    setError('')
    setLoading(true)
    await new Promise(r => setTimeout(r, 900))
    router.push('/verify')
  }

  return (
    <div className="min-h-screen flex bg-white">

      {/* ── LEFT: Form ── */}
      <div className="flex-1 flex flex-col px-8 py-10 sm:px-12 lg:px-16">

        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-black flex items-center justify-center flex-shrink-0">
            <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 16 16" fill="none">
              <path d="M3 4h10M3 8h7M3 12h5" stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="font-display text-[1.1rem] tracking-tight text-black">theoflow</span>
        </div>

        {/* Form — vertically centred */}
        <div className="flex-1 flex items-center">
          <div className="w-full max-w-[340px]">
            <h1 className="font-display text-[2.6rem] leading-tight text-black mb-1">Create account</h1>
            <p className="text-gray-400 text-sm mb-10">Free to get started</p>

            {error && (
              <div className="mb-6 px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-7">
              <div>
                <label className="block text-[0.7rem] font-semibold text-gray-400 mb-2.5 uppercase tracking-widest">
                  Full name
                </label>
                <input type="text" autoComplete="name" value={form.name}
                  onChange={update('name')} placeholder="Thabo Nkosi" required
                  className="input-line" />
              </div>

              <div>
                <label className="block text-[0.7rem] font-semibold text-gray-400 mb-2.5 uppercase tracking-widest">
                  Email address
                </label>
                <input type="email" autoComplete="email" value={form.email}
                  onChange={update('email')} placeholder="you@example.com" required
                  className="input-line" />
              </div>

              <div>
                <label className="block text-[0.7rem] font-semibold text-gray-400 mb-2.5 uppercase tracking-widest">
                  Password
                </label>
                <input type="password" autoComplete="new-password" value={form.password}
                  onChange={update('password')} placeholder="Min. 8 characters" required
                  className="input-line" />
                {form.password && strengthMeta && (
                  <div className="mt-3">
                    <div className="flex gap-1 h-0.5">
                      {[1,2,3,4].map(i => (
                        <div key={i} className={`flex-1 rounded-full transition-all duration-300 ${i <= s ? strengthMeta.bars : 'bg-gray-200'}`} />
                      ))}
                    </div>
                    <p className={`text-[0.7rem] mt-1.5 font-medium ${strengthMeta.text}`}>{strengthMeta.label} password</p>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[0.7rem] font-semibold text-gray-400 mb-2.5 uppercase tracking-widest">
                  Confirm password
                </label>
                <input type="password" autoComplete="new-password" value={form.confirm}
                  onChange={update('confirm')} placeholder="Repeat password" required
                  className="input-line" />
              </div>

              <div className="pt-2">
                <button type="submit" disabled={loading} className="btn-black">
                  {loading
                    ? <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                        </svg>
                        Creating account…
                      </span>
                    : 'Create account'}
                </button>
              </div>
            </form>

            <p className="mt-8 text-sm text-gray-400">
              Already have an account?{' '}
              <Link href="/login" className="text-black font-medium hover:underline underline-offset-2">
                Sign in
              </Link>
            </p>

            <div className="mt-16 flex items-center gap-1.5 text-gray-300 text-[0.7rem]">
              <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
              </svg>
              256-bit TLS · POPIA compliant · Data stays in South Africa
            </div>
          </div>
        </div>
      </div>

      {/* ── RIGHT: Fluid gradient art (same as login, slightly different timing) ── */}
      <div className="hidden lg:block lg:w-[54%] xl:w-[58%] flex-shrink-0 p-6 bg-[#F6F4F0]">
        <div className="w-full h-full rounded-3xl overflow-hidden relative" style={{ minHeight: '92vh' }}>
          <div className="absolute inset-0" style={{ background: '#EEF0E8' }} />

          {/* Teal — top right anchor */}
          <div className="blob-two absolute rounded-full"
               style={{
                 top: '0%', right: '5%',
                 width: '60%', height: '58%',
                 background: 'radial-gradient(ellipse at 55% 35%, #60C8C0 0%, #40B4A8 40%, transparent 72%)',
                 filter: 'blur(56px)', opacity: 0.70, mixBlendMode: 'multiply',
               }} />

          {/* Warm yellow — left */}
          <div className="blob-one absolute rounded-full"
               style={{
                 top: '15%', left: '0%',
                 width: '58%', height: '54%',
                 background: 'radial-gradient(ellipse at 40% 45%, #ECC040 0%, #E0A828 40%, transparent 74%)',
                 filter: 'blur(54px)', opacity: 0.68, mixBlendMode: 'multiply',
               }} />

          {/* Cream centre */}
          <div className="blob-three absolute rounded-full"
               style={{
                 top: '28%', left: '20%',
                 width: '55%', height: '50%',
                 background: 'radial-gradient(ellipse at 50% 50%, #FBF4DC 0%, #F2E4A8 50%, transparent 75%)',
                 filter: 'blur(48px)', opacity: 0.88, mixBlendMode: 'normal',
               }} />

          {/* Sky blue — bottom */}
          <div className="blob-four absolute rounded-full"
               style={{
                 bottom: '8%', left: '15%',
                 width: '58%', height: '52%',
                 background: 'radial-gradient(ellipse at 45% 60%, #60B0E0 0%, #3A98D0 40%, transparent 72%)',
                 filter: 'blur(58px)', opacity: 0.52, mixBlendMode: 'multiply',
               }} />

          {/* Amber accent — bottom right */}
          <div className="blob-five absolute rounded-full"
               style={{
                 bottom: '5%', right: '0%',
                 width: '48%', height: '44%',
                 background: 'radial-gradient(ellipse at 55% 55%, #F0A850 0%, #E88830 50%, transparent 74%)',
                 filter: 'blur(52px)', opacity: 0.48, mixBlendMode: 'multiply',
               }} />

          {/* Animated SVG waves */}
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 700 700"
               preserveAspectRatio="xMidYMid slice" style={{ opacity: 0.15 }}>
            <path fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
              <animate attributeName="d"
                values="M0,180 C100,130 220,240 370,180 C510,120 620,210 700,180;M0,180 C130,240 240,110 370,190 C500,270 620,150 700,180;M0,180 C100,130 220,240 370,180 C510,120 620,210 700,180"
                dur="9s" repeatCount="indefinite" calcMode="spline"
                keyTimes="0;0.5;1" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
            </path>
            <path fill="none" stroke="white" strokeWidth="1.2" strokeLinecap="round">
              <animate attributeName="d"
                values="M0,340 C120,300 260,400 400,340 C530,280 640,360 700,340;M0,340 C150,390 280,270 400,350 C520,420 640,310 700,340;M0,340 C120,300 260,400 400,340 C530,280 640,360 700,340"
                dur="12s" begin="3s" repeatCount="indefinite" calcMode="spline"
                keyTimes="0;0.5;1" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
            </path>
            <path fill="none" stroke="white" strokeWidth="1" strokeLinecap="round">
              <animate attributeName="d"
                values="M0,500 C90,470 210,530 370,500 C510,470 620,520 700,500;M0,500 C110,530 240,460 370,510 C500,550 620,480 700,500;M0,500 C90,470 210,530 370,500 C510,470 620,520 700,500"
                dur="10s" begin="1.5s" repeatCount="indefinite" calcMode="spline"
                keyTimes="0;0.5;1" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
            </path>
          </svg>

          {/* Vignette */}
          <div className="absolute inset-0 rounded-3xl"
               style={{ background: 'radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(238,240,232,0.45) 100%)' }} />
        </div>
      </div>

    </div>
  )
}
