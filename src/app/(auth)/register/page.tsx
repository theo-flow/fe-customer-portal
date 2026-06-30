'use client'
import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { signUp, friendlyError } from '@/lib/auth'
import Link from 'next/link'
import { LogoMark } from '@/components/LogoMark'

// ── Constants ──────────────────────────────────────────────────────────────
const THEOFLOW_PRODUCTS = [
  { key: 'forge',   label: 'TheoFlow Forge',   description: 'Convert physical documents into structured digital forms.' },
  { key: 'channel', label: 'TheoFlow Channel', description: 'Publish and route forms to users and systems.' },
  { key: 'harvest', label: 'TheoFlow Harvest', description: 'Capture structured responses from users at scale.' },
  { key: 'decode',  label: 'TheoFlow Decode',  description: 'Convert unstructured documents into structured intelligence.' },
]

const FORM_GROUPS = [
  { key: 'onboarding',      label: 'Onboarding',      description: 'New client, account, member, or employee registration' },
  { key: 'application',     label: 'Application',     description: 'Applying for a product, policy, loan, or service' },
  { key: 'claim',           label: 'Claim',           description: 'Requesting compensation, reporting a loss, or invoking a right' },
  { key: 'declaration',     label: 'Declaration',     description: 'Disclosing facts — health, financial, risk, or material' },
  { key: 'consent',         label: 'Consent',         description: 'Permission and authorisation — POPIA, payment mandate, treatment' },
  { key: 'assessment',      label: 'Assessment',      description: 'Risk, needs analysis, survey, inspection, or credit evaluation' },
  { key: 'compliance',      label: 'Compliance',      description: 'Regulatory requirements — FICA, KYC, AML, B-BBEE, tax' },
  { key: 'amendment',       label: 'Amendment',       description: 'Changing existing records — address, beneficiary, contact details' },
  { key: 'agreement',       label: 'Agreement',       description: 'Contracts and terms — service agreements, indemnity, SLA' },
  { key: 'incident_report', label: 'Incident Report', description: 'Documenting events — accidents, complaints, near-misses, breaches' },
]
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
type Step = 'org' | 'products' | 'forms' | 'templates' | 'credentials' | 'submitting'
interface Template    { group: string; groupLabel: string; file: File | null; skip: boolean }
interface CustomGroup { id: string; name: string }

function pwStrength(p: string) {
  let s = 0
  if (p.length >= 12)          s++
  if (/[A-Z]/.test(p))         s++
  if (/[0-9]/.test(p))         s++
  if (/[^A-Za-z0-9]/.test(p))  s++
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

  const [selectedProducts, setSelectedProducts] = useState<string[]>([])
  const [selectedGroups, setSelectedGroups]     = useState<string[]>([])
  const [customGroups, setCustomGroups]         = useState<CustomGroup[]>([])

  const [templates, setTemplates] = useState<Template[]>([])
  const [adminName, setAdminName]   = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [password, setPassword]     = useState('')
  const [confirm, setConfirm]       = useState('')
  const [error, setError]           = useState('')

  // ── Product toggles ───────────────────────────────────────────────────
  const toggleProduct = (key: string) =>
    setSelectedProducts(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    )

  // ── Form group toggles ────────────────────────────────────────────────
  const toggleGroup = (key: string) =>
    setSelectedGroups(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    )

  // ── Custom group helpers ──────────────────────────────────────────────
  const addCustomGroup = () =>
    setCustomGroups(prev => [...prev, { id: `c-${Date.now()}`, name: '' }])

  const removeCustomGroup = (id: string) =>
    setCustomGroups(prev => prev.filter(c => c.id !== id))

  const updateCustomGroupName = (id: string, name: string) =>
    setCustomGroups(prev => prev.map(c => c.id === id ? { ...c, name } : c))

  // ── Template helpers ──────────────────────────────────────────────────
  const updateTemplate = (idx: number, patch: Partial<Template>) =>
    setTemplates(prev => prev.map((t, i) => i === idx ? { ...t, ...patch } : t))

  // ── Step navigation with validation ──────────────────────────────────

  const goProducts = () => {
    const name = orgName.trim()
    if (!name)            { setError('Organisation name is required.'); return }
    if (name.length < 2)  { setError('Organisation name must be at least 2 characters.'); return }
    if (name.length > 100){ setError('Organisation name must be 100 characters or fewer.'); return }
    if (orgPhone.trim() && !validatePhone(orgPhone.trim())) {
      setError('Enter a valid phone number (e.g. +27821234567 or 0821234567).')
      return
    }
    setError('')
    setStep('products')
  }

  const goFromProducts = () => {
    if (!selectedProducts.length) {
      setError('Select at least one TheoFlow product to continue.')
      return
    }
    setError('')
    const needsForms = selectedProducts.includes('forge') || selectedProducts.includes('decode')
    setStep(needsForms ? 'forms' : 'credentials')
  }

  const goTemplates = () => {
    const validCustom = customGroups.filter(c => c.name.trim().length > 0)

    const allGroups = [
      ...selectedGroups.map(key => {
        const g = FORM_GROUPS.find(g => g.key === key)!
        return { group: key, groupLabel: g.label }
      }),
      ...validCustom.map(c => ({ group: c.id, groupLabel: c.name.trim() })),
    ]

    if (!allGroups.length) {
      setError('Select at least one form group, or add a custom group.')
      return
    }

    setError('')
    setTemplates(allGroups.map(g => ({ ...g, file: null, skip: false })))
    setStep('templates')
  }

  const goCredentials = () => {
    const unresolved = templates.filter(t => !t.file && !t.skip)
    if (unresolved.length > 0) {
      const n = unresolved.length
      setError(
        `${n} template${n > 1 ? 's' : ''} ${n > 1 ? 'need' : 'needs'} either a file upload or "Use standard template" ticked.`
      )
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
    if (s < 3) { setError('Use 12+ characters with an uppercase letter, a number, and a symbol.'); return }

    setError('')
    setStep('submitting')

    try {
      const email   = adminEmail.trim().toLowerCase()
      const toUpload = templates.filter(t => t.file && !t.skip)

      // 1. Register org + get presigned upload URLs
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
          subscribedProducts: selectedProducts,
          formGroups: templates.map(t => ({ group: t.group, groupLabel: t.groupLabel })),
          templates: toUpload.map(t => ({
            group:       t.group,
            groupLabel:  t.groupLabel,
            filename:    t.file!.name,
            contentType: t.file!.type || 'application/pdf',
          })),
        }),
      })
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: 'Server error' }))
        throw new Error(msg ?? `Server error ${res.status}`)
      }
      const { orgId, uploadUrls } = await res.json() as {
        orgId: string
        uploadUrls: { group: string; groupLabel: string; uploadUrl: string }[]
      }

      // 2. Upload template files directly to S3
      await Promise.all(
        toUpload.map(t => {
          const entry = uploadUrls.find(u => u.group === t.group)
          if (!entry) return Promise.resolve()
          return fetch(entry.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': t.file!.type || 'application/pdf' },
            body: t.file!,
          })
        })
      )

      // 3. Create Cognito user — last so a duplicate email fails before any writes
      await signUp(email, password, adminName.trim(), orgId)
      sessionStorage.setItem('tf_pending_email', email)
      sessionStorage.setItem('tf_org_id', orgId)
      router.push('/verify')
    } catch (err: unknown) {
      setError(friendlyError(err as { code?: string; message?: string }))
      setStep('credentials')
    }
  }

  // ── Step indicator meta (dynamic based on selected products) ─────────
  const needsForms     = selectedProducts.includes('forge') || selectedProducts.includes('decode')
  const needsTemplates = selectedProducts.includes('forge')

  const STEPS: Step[] = [
    'org', 'products',
    ...(needsForms     ? ['forms'     as Step] : []),
    ...(needsTemplates ? ['templates' as Step] : []),
    'credentials',
  ]
  const stepLabels = [
    'Organisation', 'Products',
    ...(needsForms     ? ['Form groups'] : []),
    ...(needsTemplates ? ['Templates']   : []),
    'Account',
  ]
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
              <button onClick={goProducts}
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

        {/* ── STEP 2: Products ── */}
        {step === 'products' && (
          <motion.div className="w-full max-w-[480px]"
            initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}>

            <BackButton onClick={() => { setError(''); setStep('org') }}/>

            <h1 className="font-display text-[2.1rem] leading-tight text-white mb-2">
              Choose your products
            </h1>
            <p className="text-[13px] mb-7" style={{ color:'rgba(255,255,255,0.36)' }}>
              Select the TheoFlow products your organisation will use.
              You can change this later.
            </p>

            {error && <DarkError msg={error}/>}

            <div className="space-y-2.5 mb-8">
              {THEOFLOW_PRODUCTS.map(({ key, label, description }) => {
                const selected = selectedProducts.includes(key)
                return (
                  <button
                    key={key}
                    onClick={() => toggleProduct(key)}
                    className="w-full text-left rounded-xl px-5 py-4 transition-all"
                    style={{
                      border:     selected ? '1px solid rgba(255,255,255,0.4)' : '1px solid rgba(255,255,255,0.08)',
                      background: selected ? 'rgba(255,255,255,0.06)' : 'transparent',
                    }}>
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold text-white mb-0.5">{label}</p>
                        <p className="text-[12px]" style={{ color:'rgba(255,255,255,0.38)' }}>{description}</p>
                      </div>
                      <div className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center transition-all"
                        style={{
                          background: selected ? 'white' : 'transparent',
                          border:     selected ? '1px solid white' : '1px solid rgba(255,255,255,0.25)',
                        }}>
                        {selected && (
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 10 10">
                            <path d="M1.5 5l2.5 2.5 4.5-4" stroke="black" strokeWidth="1.5" strokeLinecap="round"/>
                          </svg>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            <button onClick={goFromProducts}
              className="px-8 py-3 rounded-full text-[14px] font-medium text-black bg-white
                         hover:bg-white/90 transition-all">
              Continue
            </button>
          </motion.div>
        )}

        {/* ── STEP 3: Form groups ── */}
        {step === 'forms' && (
          <motion.div className="w-full max-w-[540px]"
            initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}>

            <BackButton onClick={() => { setError(''); setStep('products') }}/>

            <h1 className="font-display text-[2.1rem] leading-tight text-white mb-2">
              Select your form groups
            </h1>
            <p className="text-[13px] mb-7" style={{ color:'rgba(255,255,255,0.36)' }}>
              Choose the categories of forms your organisation works with.
              You can add custom groups below if yours is not listed.
            </p>

            {error && <DarkError msg={error}/>}

            {/* Standard form groups — 2-column grid */}
            <div className="grid grid-cols-2 gap-2 mb-6">
              {FORM_GROUPS.map(({ key, label, description }) => {
                const selected = selectedGroups.includes(key)
                return (
                  <button
                    key={key}
                    onClick={() => toggleGroup(key)}
                    className="text-left rounded-xl px-4 py-3.5 transition-all"
                    style={{
                      border:     selected ? '1px solid rgba(255,255,255,0.35)' : '1px solid rgba(255,255,255,0.08)',
                      background: selected ? 'rgba(255,255,255,0.06)' : 'transparent',
                    }}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-[13px] font-semibold text-white leading-snug">{label}</p>
                      <div className="w-4 h-4 rounded flex-shrink-0 mt-0.5 flex items-center justify-center transition-all"
                        style={{
                          background: selected ? 'white' : 'transparent',
                          border:     selected ? '1px solid white' : '1px solid rgba(255,255,255,0.25)',
                        }}>
                        {selected && (
                          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 10 10">
                            <path d="M1.5 5l2.5 2.5 4.5-4" stroke="black" strokeWidth="1.5" strokeLinecap="round"/>
                          </svg>
                        )}
                      </div>
                    </div>
                    <p className="text-[11px] leading-relaxed" style={{ color:'rgba(255,255,255,0.35)' }}>
                      {description}
                    </p>
                  </button>
                )
              })}
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 mb-5">
              <div className="flex-1 h-px" style={{ background:'rgba(255,255,255,0.10)' }}/>
              <span className="text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color:'rgba(255,255,255,0.3)' }}>
                Other / Custom
              </span>
              <div className="flex-1 h-px" style={{ background:'rgba(255,255,255,0.10)' }}/>
            </div>

            {/* Custom group rows */}
            {customGroups.length > 0 && (
              <div className="space-y-2 mb-4">
                {customGroups.map((cg, idx) => (
                  <div key={cg.id}
                    className="rounded-xl px-4 py-3 flex items-center gap-2 transition-all"
                    style={{
                      border:     cg.name.trim() ? '1px solid rgba(255,255,255,0.28)' : '1px solid rgba(255,255,255,0.12)',
                      background: cg.name.trim() ? 'rgba(255,255,255,0.04)' : 'transparent',
                    }}>
                    <input
                      value={cg.name}
                      onChange={e => updateCustomGroupName(cg.id, e.target.value)}
                      placeholder={`Custom group ${idx + 1} name…`}
                      className="flex-1 bg-transparent text-[13px] font-semibold text-white
                                 placeholder:text-white/25 outline-none"
                    />
                    <button
                      aria-label="Remove custom group"
                      onClick={() => removeCustomGroup(cg.id)}
                      className="flex-shrink-0 transition-colors"
                      style={{ color:'rgba(255,255,255,0.25)' }}
                      onMouseEnter={e => (e.currentTarget.style.color='rgba(239,68,68,0.8)')}
                      onMouseLeave={e => (e.currentTarget.style.color='rgba(255,255,255,0.25)')}>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add custom group button */}
            <button onClick={addCustomGroup}
              className="flex items-center gap-2 text-[12px] font-medium mb-8 transition-colors"
              style={{ color:'rgba(255,255,255,0.4)' }}
              onMouseEnter={e => (e.currentTarget.style.color='white')}
              onMouseLeave={e => (e.currentTarget.style.color='rgba(255,255,255,0.4)')}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
              </svg>
              Add custom group
            </button>

            {/* Selection count */}
            {(selectedGroups.length + customGroups.filter(c => c.name.trim()).length > 0) && (
              <p className="text-[12px] mb-6" style={{ color:'rgba(255,255,255,0.35)' }}>
                {selectedGroups.length + customGroups.filter(c => c.name.trim()).length} group{
                  (selectedGroups.length + customGroups.filter(c => c.name.trim()).length) !== 1 ? 's' : ''
                } selected
              </p>
            )}

            <button onClick={goTemplates}
              className="px-8 py-3 rounded-full text-[14px] font-medium text-black bg-white
                         hover:bg-white/90 transition-all">
              Continue
            </button>
          </motion.div>
        )}

        {/* ── STEP 3: Templates ── */}
        {step === 'templates' && (
          <motion.div className="w-full max-w-[500px]"
            initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}>

            <BackButton onClick={() => { setError(''); setStep('forms') }}/>

            <h1 className="font-display text-[2.1rem] leading-tight text-white mb-2">
              Upload your blank templates
            </h1>
            <p className="text-[13px] mb-2" style={{ color:'rgba(255,255,255,0.36)' }}>
              Upload the blank version of each form so the system can learn to digitize it.
            </p>
            <p className="text-[12px] mb-7 px-3 py-2 rounded-lg"
               style={{ color:'rgba(255,255,255,0.45)', background:'rgba(255,255,255,0.05)',
                        border:'1px solid rgba(255,255,255,0.08)' }}>
              Each template must have a file uploaded <em>or</em> &ldquo;Use standard template&rdquo; ticked — you cannot proceed until all are resolved.
            </p>

            {error && <DarkError msg={error}/>}

            <div className="space-y-3 mb-8">
              {templates.map((t, idx) => (
                <DarkTemplateCard
                  key={t.group}
                  template={t}
                  onFile={f  => updateTemplate(idx, { file: f, skip: false })}
                  onSkip={()  => updateTemplate(idx, { skip: !t.skip, file: null })}
                />
              ))}
            </div>

            {/* Completion indicator */}
            <div className="flex items-center gap-3 mb-6">
              <div className="flex-1 h-[3px] rounded-full overflow-hidden"
                   style={{ background:'rgba(255,255,255,0.08)' }}>
                <div className="h-full rounded-full transition-all duration-500"
                     style={{
                       background: 'white',
                       width: `${Math.round((templates.filter(t => t.file || t.skip).length / (templates.length || 1)) * 100)}%`,
                     }}/>
              </div>
              <span className="text-[11px] flex-shrink-0" style={{ color:'rgba(255,255,255,0.35)' }}>
                {templates.filter(t => t.file || t.skip).length} / {templates.length} resolved
              </span>
            </div>

            <button onClick={goCredentials}
              className="px-8 py-3 rounded-full text-[14px] font-medium text-black bg-white
                         hover:bg-white/90 transition-all">
              Continue
            </button>
          </motion.div>
        )}

        {/* ── STEP 4: Credentials ── */}
        {step === 'credentials' && (
          <motion.div className="w-full max-w-[420px]"
            initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}>

            <BackButton onClick={() => {
              setError('')
              if (needsTemplates)     setStep('templates')
              else if (needsForms)    setStep('forms')
              else                    setStep('products')
            }}/>

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
                          s < 3
                            ? 'must include 12+ chars, uppercase, number, and symbol'
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
              Creating your profile, uploading templates and registering your account.
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

function DarkCheckbox({ checked, label, onChange }: {
  checked: boolean; label: string; onChange: () => void
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none" onClick={onChange}>
      <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all"
        style={{
          background: checked ? 'white' : 'transparent',
          border:     checked ? '1px solid white' : '1px solid rgba(255,255,255,0.25)',
        }}>
        {checked && (
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 10 10">
            <path d="M1.5 5l2.5 2.5 4.5-4" stroke="black" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        )}
      </div>
      <span className="text-[12px] font-medium"
            style={{ color: checked ? 'white' : 'rgba(255,255,255,0.4)' }}>
        {label}
      </span>
    </label>
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

function DarkTemplateCard({ template, onFile, onSkip }: {
  template: Template; onFile: (f: File | null) => void; onSkip: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDrag(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }, [onFile])

  const resolved = template.file || template.skip

  return (
    <div className="rounded-xl p-4 transition-all"
      style={{
        border: template.skip
          ? '1px solid rgba(255,255,255,0.06)'
          : template.file
          ? '1px solid rgba(255,255,255,0.28)'
          : '1px solid rgba(255,255,255,0.12)',
        background: resolved ? 'transparent' : 'rgba(239,68,68,0.03)',
        opacity:    template.skip ? 0.55 : 1,
      }}>

      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-white truncate">{template.groupLabel}</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Resolved indicator */}
          {resolved && (
            <div className="w-4 h-4 rounded-full bg-white flex items-center justify-center">
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 10 10">
                <path d="M1.5 5l2.5 2.5 4.5-4" stroke="black" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
          )}
          {/* Skip checkbox */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none" onClick={onSkip}>
            <div className="w-4 h-4 rounded flex items-center justify-center transition-all"
              style={{
                background: template.skip ? 'white' : 'transparent',
                border:     template.skip ? '1px solid white' : '1px solid rgba(255,255,255,0.25)',
              }}>
              {template.skip && (
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 10 10">
                  <path d="M1.5 5l2.5 2.5 4.5-4" stroke="black" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              )}
            </div>
            <span className="text-[11px] font-medium" style={{ color:'rgba(255,255,255,0.4)' }}>
              Standard
            </span>
          </label>
        </div>
      </div>

      {!template.skip && (
        template.file ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
               style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)' }}>
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24"
                 stroke="rgba(255,255,255,0.4)" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0
                   0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25
                   0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125
                   1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>
            </svg>
            <span className="text-[12px] text-white truncate flex-1">{template.file.name}</span>
            <button onClick={() => onFile(null)}
              className="flex-shrink-0 transition-colors"
              style={{ color:'rgba(255,255,255,0.3)' }}
              onMouseEnter={e => (e.currentTarget.style.color='white')}
              onMouseLeave={e => (e.currentTarget.style.color='rgba(255,255,255,0.3)')}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
        ) : (
          <div onDrop={onDrop}
            onDragOver={e => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onClick={() => inputRef.current?.click()}
            className="cursor-pointer rounded-lg flex items-center justify-center gap-2 py-3 transition-all text-[12px]"
            style={{
              border:     `2px dashed ${drag ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)'}`,
              background: drag ? 'rgba(255,255,255,0.04)' : 'transparent',
            }}>
            <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }}/>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24"
                 stroke="rgba(255,255,255,0.3)" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5
                   m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
            </svg>
            <span style={{ color:'rgba(255,255,255,0.4)' }}>
              Drop file here or{' '}
              <span className="font-medium text-white">browse</span>
            </span>
          </div>
        )
      )}
    </div>
  )
}
