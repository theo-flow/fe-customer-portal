'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { signUp, friendlyError } from '@/lib/auth'
import Link from 'next/link'
import { LogoMark } from '@/components/LogoMark'

// ── Constants ──────────────────────────────────────────────────────────────
const ORG_TYPES = [
  'Agriculture, Forestry & Fishing',
  'Construction & Engineering',
  'Manufacturing',
  'Retail & Wholesale Trade',
  'Information Technology (ICT)',
  'Financial & Professional Services',
  'Healthcare & Medical Services',
  'Education & Training',
  'Hospitality, Tourism & Events',
  'Transport, Logistics & Automotive',
  'Real Estate & Property Services',
  'Creative, Media & Personal Services',
  'Other',
]

// ── Types ──────────────────────────────────────────────────────────────────
type Step = 'org' | 'credentials' | 'submitting'

// Mirrors the Cognito user pool's actual password policy exactly
// (infrastructure/modules/auth/main.tf: length>=12, upper, lower, number
// all mandatory; symbols are NOT required) -- all 4 must pass, not "any 3",
// or a password that looks "Strong" here can still be rejected by Cognito.
function pwStrength(p: string) {
  let s = 0
  if (p.length >= 12)  s++
  if (/[A-Z]/.test(p)) s++
  if (/[a-z]/.test(p)) s++
  if (/[0-9]/.test(p)) s++
  return s
}

// South African phone: +27XXXXXXXXX or 0XXXXXXXXX (9 digits after prefix)
const PHONE_RE = /^(\+27|0)[0-9]{9}$/
function validatePhone(raw: string): boolean {
  const normalised = raw.replace(/[\s\-().]/g, '')
  return PHONE_RE.test(normalised)
}
const SMETA = [
  null,
  { label: 'Weak',   bar: 'bg-red-500',  text: 'text-red-400'   },
  { label: 'Fair',   bar: 'bg-amber-500', text: 'text-amber-400' },
  { label: 'Good',   bar: 'bg-blue-400',  text: 'text-blue-300'  },
  { label: 'Strong', bar: 'bg-white',     text: 'text-white'     },
]
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ── Component ──────────────────────────────────────────────────────────────
export default function RegisterPage() {
  const router = useRouter()

  const [step, setStep]             = useState<Step>('org')
  const [orgName, setOrgName]       = useState('')
  const [regNumber, setRegNumber]   = useState('')
  const [orgType, setOrgType]       = useState('')
  const [otherIndustry, setOtherIndustry] = useState('')
  const [orgPhone, setOrgPhone]     = useState('')

  const [adminName, setAdminName]   = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [password, setPassword]     = useState('')
  const [confirm, setConfirm]       = useState('')
  const [error, setError]           = useState('')

  // ── Step navigation with validation ──────────────────────────────────

  const goCredentials = () => {
    const name = orgName.trim()
    if (!name)            { setError('Organisation name is required.'); return }
    if (name.length < 2)  { setError('Organisation name must be at least 2 characters.'); return }
    if (name.length > 100){ setError('Organisation name must be 100 characters or fewer.'); return }
    if (orgPhone.trim() && !validatePhone(orgPhone.trim())) {
      setError('Enter a valid phone number (e.g. +27821234567 or 0821234567).')
      return
    }
    setError('')
    setStep('credentials')
  }

  const s     = pwStrength(password)
  const smeta = SMETA[s]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Step 4 field validation
    if (!adminName.trim()) { setError('Full name is required.'); return }
    if (!EMAIL_RE.test(adminEmail.trim())) { setError('Enter a valid email address.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (s < 4) { setError('Use 12+ characters with an uppercase letter, a lowercase letter, and a number.'); return }

    setError('')
    setStep('submitting')

    try {
      const email = adminEmail.trim().toLowerCase()

      // 1. Register org
      const res = await fetch('/api/organizations/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgName:   orgName.trim(),
          regNumber: regNumber.trim(),
          orgType:   orgType === 'Other' ? (otherIndustry.trim() || 'Other') : orgType,
          phone:     orgPhone.trim(),
          adminName: adminName.trim(),
          adminEmail: email,
        }),
      })
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: 'Server error' }))
        throw new Error(msg ?? `Server error ${res.status}`)
      }
      const { orgId } = await res.json() as { orgId: string }

      // 2. Create Cognito user — last so a duplicate email fails before any writes
      await signUp(email, password, adminName.trim(), orgId)
      sessionStorage.setItem('tf_pending_email', email)
      sessionStorage.setItem('tf_org_id', orgId)
      router.push('/verify')
    } catch (err: unknown) {
      setError(friendlyError(err as { code?: string; message?: string }))
      setStep('credentials')
    }
  }

  // ── Step indicator meta ────────────────────────────────────────────────
  const STEPS: Step[] = ['org', 'credentials']
  const stepLabels = ['Organisation', 'Account']
  const stepIdx = STEPS.indexOf(step === 'submitting' ? 'credentials' : step)

  return (
    <div className="flex lg:h-[100dvh]" style={{ background: '#0B0B0B', minHeight: '100dvh' }}>

      {/* ── LEFT panel ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col px-6 py-8 sm:px-10 lg:px-14 overflow-y-auto"
           style={{ minHeight: '100dvh' }}>

        {/* Logo */}
        <Link href="/" className="inline-flex flex-shrink-0">
          <motion.div className="flex items-center gap-2.5"
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}>
            <LogoMark size={40} className="text-white"/>
            <span className="font-display text-[1rem] tracking-tight text-white">theoflow</span>
          </motion.div>
        </Link>

        {/* Step indicator */}
        {step !== 'submitting' && (
          <motion.div className="flex items-center gap-3 mt-10 mb-8 flex-shrink-0"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, delay: 0.15 }}>
            {stepLabels.map((label, i) => (
              <div key={label} className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold
                                 flex-shrink-0 transition-all
                  ${i < stepIdx   ? 'bg-white text-black'
                  : i === stepIdx ? 'border-2 border-white text-white'
                  :                 'text-[rgba(255,255,255,0.2)]'}`}
                  style={i > stepIdx ? { border:'1px solid rgba(255,255,255,0.15)' } : {}}>
                  {i < stepIdx
                    ? <svg className="w-3 h-3" fill="none" viewBox="0 0 10 10">
                        <path d="M2 5l2.5 2.5 3.5-4" stroke="black" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    : i + 1}
                </div>
                <span className={`text-[12px] font-medium hidden sm:block transition-colors
                  ${i === stepIdx ? 'text-white' : 'text-[rgba(255,255,255,0.2)]'}`}>
                  {label}
                </span>
                {i < stepLabels.length - 1 && (
                  <div className="w-5 h-px hidden sm:block"
                       style={{ background:'rgba(255,255,255,0.12)' }}/>
                )}
              </div>
            ))}
          </motion.div>
        )}

        {/* ── STEP 1: Organisation ── */}
        {step === 'org' && (
          <motion.div className="w-full max-w-[420px]"
            initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}>

            <h1 className="font-display text-[2.4rem] leading-tight text-white mb-2">
              Register your organisation
            </h1>
            <p className="text-[13px] mb-8" style={{ color:'rgba(255,255,255,0.36)' }}>
              Tell us about the entity that will be using this platform.
            </p>

            {error && <DarkError msg={error}/>}

            <div className="space-y-5">
              <DarkField label="Organisation name *">
                <DarkInput value={orgName} onChange={setOrgName}
                  placeholder="e.g. ABC Brokers (Pty) Ltd" autoFocus/>
              </DarkField>

              <DarkField label="CIPC registration number">
                <DarkInput value={regNumber} onChange={setRegNumber}
                  placeholder="2020/123456/07 (optional)"/>
                <p className="mt-1.5 text-[11px]" style={{ color:'rgba(255,255,255,0.25)' }}>
                  Not required — you can add this later.
                </p>
              </DarkField>

              <DarkField label="Organisation type">
                <DarkSelect value={orgType} onChange={v => { setOrgType(v); if (v !== 'Other') setOtherIndustry('') }}
                  options={ORG_TYPES} placeholder="Select type…"/>
                {orgType === 'Other' && (
                  <div className="mt-3">
                    <DarkInput
                      value={otherIndustry}
                      onChange={setOtherIndustry}
                      placeholder="Describe your industry…"
                    />
                  </div>
                )}
              </DarkField>

              <DarkField label="Contact phone">
                <DarkInput value={orgPhone} onChange={setOrgPhone}
                  placeholder="+27 11 000 0000" type="tel"/>
              </DarkField>
            </div>

            <div className="mt-8 flex items-center gap-5">
              <button onClick={goCredentials}
                className="px-8 py-3 rounded-full text-[14px] font-medium text-black bg-white
                           hover:bg-white/90 active:bg-white/80 transition-all flex-shrink-0">
                Continue
              </button>
              <a href="/login" className="text-[13px]" style={{ color:'rgba(255,255,255,0.35)' }}>
                Already registered?{' '}
                <span style={{ color:'#7BA8E0' }}>Sign in</span>
              </a>
            </div>
          </motion.div>
        )}

        {/* ── STEP 2: Credentials ── */}
        {step === 'credentials' && (
          <motion.div className="w-full max-w-[420px]"
            initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}>

            <BackButton onClick={() => { setError(''); setStep('org') }}/>

            <h1 className="font-display text-[2.4rem] leading-tight text-white mb-2">
              Create your account
            </h1>
            <p className="text-[13px] mb-9" style={{ color:'rgba(255,255,255,0.36)' }}>
              Admin account for{' '}
              <span className="text-white font-medium">{orgName}</span>.
            </p>

            {error && <DarkError msg={error}/>}

            <form onSubmit={handleSubmit} noValidate>
              <div className="space-y-5">
                <DarkField label="Full name *">
                  <DarkInput value={adminName} onChange={setAdminName}
                    placeholder="Thabo Nkosi" autoFocus/>
                </DarkField>

                <DarkField label="Work email address *">
                  <DarkInput value={adminEmail} onChange={setAdminEmail}
                    placeholder="you@example.com" type="email"/>
                </DarkField>

                <DarkField label="Password *">
                  <DarkInput value={password} onChange={setPassword}
                    placeholder="Min. 12 characters" type="password"/>
                  {password && smeta && (
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
                          s < 4
                            ? 'must include 12+ chars, uppercase, lowercase, and a number'
                            : 'password meets requirements'
                        }
                      </p>
                    </div>
                  )}
                </DarkField>

                <DarkField label="Confirm password *">
                  <DarkInput value={confirm} onChange={setConfirm}
                    placeholder="Repeat password" type="password"/>
                  {confirm.length > 0 && password !== confirm && (
                    <p className="mt-1.5 text-[11px] text-red-400">Passwords do not match.</p>
                  )}
                </DarkField>
              </div>

              <p className="mt-4 text-[11px]" style={{ color:'rgba(255,255,255,0.2)' }}>
                * Required fields
              </p>

              <div className="mt-7">
                <button type="submit"
                  className="px-8 py-3 rounded-full text-[14px] font-medium text-black bg-white
                             hover:bg-white/90 active:bg-white/80 transition-all">
                  Register organisation
                </button>
              </div>
            </form>

            <div className="mt-10 flex items-center gap-1.5 text-[0.68rem]"
                 style={{ color:'rgba(255,255,255,0.2)' }}>
              <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24"
                   stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0
                     002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0
                     00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
              </svg>
              256-bit TLS · POPIA compliant · Data stays in South Africa
            </div>
          </motion.div>
        )}

        {/* ── SUBMITTING ── */}
        {step === 'submitting' && (
          <div className="flex-1 flex flex-col items-start justify-center max-w-[400px]">
            <div className="w-10 h-10 rounded-full border-2 border-white border-t-transparent
                            animate-spin mb-6"/>
            <h2 className="font-display text-[1.8rem] leading-tight text-white mb-2">
              Setting up your organisation…
            </h2>
            <p className="text-[13px]" style={{ color:'rgba(255,255,255,0.36)' }}>
              Creating your profile and registering your account.
            </p>
          </div>
        )}
      </div>

      {/* ── RIGHT panel: gradient art ────────────────────────────── */}
      <div className="hidden lg:block lg:w-[55%] xl:w-[58%] flex-shrink-0 p-5">
        <div className="w-full h-full rounded-3xl relative" style={{ minHeight:'94vh', contain:'paint' }}>
          <div className="absolute inset-0" style={{ background:'#F5EDD8' }}/>
          <div className="absolute" style={{ top:'0', right:'0', width:'88%', height:'80%', transform:'translate(8%,-8%)', background:'radial-gradient(ellipse at 58% 38%, #F2C060 0%, #E8A030 52%, transparent 78%)', filter:'blur(64px)', opacity:0.95 }}/>
          <div className="absolute" style={{ bottom:'0', left:'0', width:'85%', height:'82%', transform:'translate(-8%,12%)', background:'radial-gradient(ellipse at 38% 62%, #4E82CC 0%, #3668B8 48%, transparent 75%)', filter:'blur(64px)', opacity:0.92 }}/>
          <div className="absolute" style={{ top:'0', left:'0', width:'68%', height:'65%', transform:'translate(-5%,-5%)', background:'radial-gradient(ellipse at 32% 32%, #7AAEE0 0%, #5890D4 52%, transparent 76%)', filter:'blur(56px)', opacity:0.75 }}/>
          <div className="absolute" style={{ top:'22%', left:'18%', width:'62%', height:'56%', background:'radial-gradient(ellipse at 50% 50%, #FBF0D5 0%, #F5DFA8 62%, transparent 82%)', filter:'blur(52px)', opacity:0.68 }}/>
          <div className="absolute" style={{ bottom:'0', right:'0', width:'62%', height:'58%', transform:'translate(4%,4%)', background:'radial-gradient(ellipse at 62% 65%, #F0B850 0%, #E89820 56%, transparent 78%)', filter:'blur(58px)', opacity:0.82 }}/>
          <svg className="absolute inset-0 w-full h-full pointer-events-none"
               style={{ opacity:0.45, mixBlendMode:'overlay' }}>
            <filter id="grain-reg">
              <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="4" stitchTiles="stitch"/>
              <feColorMatrix type="saturate" values="0"/>
            </filter>
            <rect width="100%" height="100%" filter="url(#grain-reg)"/>
          </svg>

        </div>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 mb-7 text-[12px] font-medium transition-colors"
      style={{ color:'rgba(255,255,255,0.35)' }}
      onMouseEnter={e => (e.currentTarget.style.color = 'white')}
      onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.35)')}>
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
      </svg>
      Back
    </button>
  )
}

function DarkField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-semibold tracking-wide uppercase mb-2"
             style={{ color:'rgba(255,255,255,0.45)' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function DarkInput({ value, onChange, placeholder, type = 'text', autoFocus }: {
  value: string; onChange: (v: string) => void
  placeholder: string; type?: string; autoFocus?: boolean
}) {
  return (
    <input type={type} value={value} autoFocus={autoFocus}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ width:'100%', padding:'15px 18px', borderRadius:'12px', fontSize:'15px',
               color:'white', background:'#0B0B0B',
               border:'1px solid rgba(255,255,255,0.22)', outline:'none',
               transition:'border-color 0.15s' }}
      onFocus={e => { e.target.style.borderColor = 'rgba(255,255,255,0.55)' }}
      onBlur={e  => { e.target.style.borderColor = 'rgba(255,255,255,0.22)' }}
    />
  )
}

function DarkSelect({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void; options: string[]; placeholder: string
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ width:'100%', padding:'15px 18px', borderRadius:'12px', fontSize:'15px',
               color: value ? 'white' : 'rgba(255,255,255,0.35)',
               background:'#131313', border:'1px solid rgba(255,255,255,0.22)',
               outline:'none', appearance:'none', transition:'border-color 0.15s' }}
      onFocus={e => { e.target.style.borderColor = 'rgba(255,255,255,0.55)' }}
      onBlur={e  => { e.target.style.borderColor = 'rgba(255,255,255,0.22)' }}>
      <option value="" style={{ background:'#131313', color:'rgba(255,255,255,0.35)' }}>
        {placeholder}
      </option>
      {options.map(o => (
        <option key={o} value={o} style={{ background:'#131313', color:'white' }}>{o}</option>
      ))}
    </select>
  )
}

function DarkError({ msg }: { msg: string }) {
  return (
    <div role="alert" className="mb-6 px-4 py-3 rounded-xl text-red-400 text-[13px]"
         style={{ background:'rgba(239,68,68,0.12)', border:'1px solid rgba(239,68,68,0.25)' }}>
      {msg}
    </div>
  )
}
