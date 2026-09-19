'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import type SignatureCanvas from 'react-signature-canvas'
import type { DetectedField } from '@/lib/sign'
import {
  buildSteps, buildTasks, initialsFromName, requirements, validateSubmission, STEP_TITLES,
  type MarkType, type StepId, type Submission,
} from '@/lib/sign-tasks'
import AdoptMark, { type MarkMode } from './AdoptMark'

// ssr:false is only permitted inside a Client Component in the App Router
// (this file is one) -- react-pdf needs real browser globals (DOMMatrix
// etc.) that don't exist during Next's server render pass.
const DocumentPreview = dynamic(() => import('./DocumentPreview'), { ssr: false })

interface DocumentData {
  url:        string
  fields:     DetectedField[]
  signerName: string
  signerRole: string | null
  formName:   string | null
}

const bigTyped = 'w-full px-4 py-3 rounded-xl border border-black/[0.12] text-[22px] italic bg-white outline-none focus:border-black/40 focus:ring-2 focus:ring-black/5 transition-all'
const smallInput = 'w-full px-4 py-2.5 rounded-xl border border-black/[0.12] text-[14px] bg-white outline-none focus:border-black/40 focus:ring-2 focus:ring-black/5 transition-all'

const pagesList = (fields: DetectedField[]) => {
  const pages = Array.from(new Set(fields.map(f => f.page))).sort((a, b) => a - b)
  return pages.length === 1 ? `page ${pages[0]}` : `pages ${pages.join(', ')}`
}

export default function SignCapture({
  sessionId, signerId, token,
}: {
  sessionId: string
  signerId:  string
  token:     string
}) {
  const [data, setData]             = useState<DocumentData | null>(null)
  const [loadError, setLoadError]   = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)

  const [stepIndex, setStepIndex]   = useState(0)
  const [error, setError]           = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone]             = useState(false)

  const [sigMode, setSigMode]   = useState<MarkMode>('draw')
  const [sigTyped, setSigTyped] = useState('')
  const sigRef = useRef<SignatureCanvas>(null)

  const [iniMode, setIniMode]   = useState<MarkMode>('type')
  const [iniTyped, setIniTyped] = useState('')
  const [iniTouched, setIniTouched] = useState(false)
  const iniRef = useRef<SignatureCanvas>(null)

  const [places, setPlaces]     = useState<Record<string, string>>({})

  useEffect(() => {
    fetch(`/api/public/sign/${sessionId}/${signerId}/${token}/document`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => setData({
        url: d.url, fields: d.detectedFields ?? [], signerName: d.signerName ?? '', signerRole: d.signerRole ?? null, formName: d.formName ?? null,
      }))
      .catch(() => setLoadError(true))
  }, [sessionId, signerId, token])

  // Initials start as the letters of the signer's name; they can change them.
  useEffect(() => {
    if (data && !iniTouched) setIniTyped(initialsFromName(data.signerName))
  }, [data, iniTouched])

  const fields = data?.fields ?? []
  const steps  = useMemo(() => buildSteps(fields), [fields])
  const tasks  = useMemo(() => buildTasks(fields), [fields])
  const need   = useMemo(() => requirements(fields), [fields])
  const step: StepId = steps[Math.min(stepIndex, steps.length - 1)]

  const sigBoxes = fields.filter(f => f.field_type === 'signature')
  const iniBoxes = fields.filter(f => f.field_type === 'initials')

  // ---- reading what the signer has adopted ----
  function readMark(mode: MarkMode, typed: string, ref: React.RefObject<SignatureCanvas>): { type?: MarkType; data?: string } {
    if (mode === 'draw') {
      if (!ref.current || ref.current.isEmpty()) return {}
      return { type: 'DRAWN', data: ref.current.toDataURL('image/png') }
    }
    return typed.trim() ? { type: 'TYPED', data: typed.trim() } : {}
  }

  function buildSubmission(): Submission {
    const sig = readMark(sigMode, sigTyped, sigRef)
    const ini = readMark(iniMode, iniTyped, iniRef)
    return {
      signatureType: sig.type, signatureData: sig.data,
      initialsType:  ini.type, initialsData:  ini.data,
      placeValues:   places,
      // older boxes have no id, so they take the first place answer
      placeData:     need.places.length > 0 ? (places[need.places[0].field_id ?? ''] ?? '') : undefined,
    }
  }

  // What is still missing for one step, so "Next" can say so right there.
  function stepProblem(id: StepId): string | null {
    if (id === 'signature' && need.signature) {
      const s = buildSubmission()
      return s.signatureData ? null : 'Please add your signature.'
    }
    if (id === 'initials' && need.initials) {
      return buildSubmission().initialsData ? null : 'Please add your initials.'
    }
    if (id === 'place') {
      const missing = need.places.find(f => !(f.field_id ? places[f.field_id] : '')?.trim())
      return missing ? `Please say where you are signing (page ${missing.page}).` : null
    }
    return null
  }

  function next() {
    const problem = stepProblem(step)
    if (problem) { setError(problem); return }
    setError(null)
    setStepIndex(i => Math.min(i + 1, steps.length - 1))
  }

  function back() {
    setError(null)
    setStepIndex(i => Math.max(i - 1, 0))
  }

  async function submit() {
    setError(null)
    const submission = buildSubmission()
    const problem = validateSubmission(fields, submission)
    if (problem) { setError(problem); return }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/public/sign/${sessionId}/${signerId}/${token}/submit`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(submission),
      })
      if (res.ok) {
        setDone(true)
      } else {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Something went wrong. Please try again.')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ---- screens ----
  if (done) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-5">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
          </svg>
        </div>
        <h2 className="text-[20px] font-semibold text-black mb-2">Signed</h2>
        <p className="text-[14px] text-gray-500">Thank you, your signature has been recorded.</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div role="alert" className="rounded-xl bg-red-50 border border-red-100 px-4 py-4 text-[13px] text-red-700">
        <p className="font-semibold mb-1">This document could not be loaded.</p>
        <p className="mb-3">Please reload the page. If it keeps happening, ask the person who sent it to you for a new link.</p>
        <button type="button" onClick={() => window.location.reload()} className="rounded-full bg-black text-white text-[12px] font-semibold px-4 py-2">
          Reload
        </button>
      </div>
    )
  }

  if (!data) return <div className="h-48 rounded-xl bg-gray-50 animate-pulse" aria-label="Loading" />

  const isLast = stepIndex >= steps.length - 1
  const progress = ((stepIndex + 1) / steps.length) * 100

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-gray-400">
            Step {stepIndex + 1} of {steps.length}
          </p>
          <p className="text-[12px] text-gray-400">{STEP_TITLES[step]}</p>
        </div>
        <div className="h-1 rounded-full bg-gray-100 overflow-hidden" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={stepIndex + 1}>
          <div className="h-full bg-black transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {step === 'overview' && (
        <div>
          <h2 className="text-[17px] font-semibold text-black mb-1">
            {data.signerName ? `${data.signerName}, here is what you need to do` : 'Here is what you need to do'}
          </h2>
          {data.signerRole && (
            <p className="text-[13px] text-gray-500 mb-3">You are signing as <span className="font-medium text-black">{data.signerRole}</span>.</p>
          )}
          <ol className="space-y-2 mb-4">
            {tasks.map(t => (
              <li key={`${t.n}-${t.field.field_id ?? t.n}`} className="flex gap-3 rounded-xl border border-black/[0.08] px-4 py-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-black text-white text-[12px] font-semibold flex items-center justify-center">{t.n}</span>
                <span className="text-[13px] text-black">
                  <span className="text-gray-400">Page {t.page}: </span>{t.text}
                  {t.auto && <span className="ml-2 text-[11px] text-green-700 bg-green-50 rounded-full px-2 py-0.5">filled in for you</span>}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-[12px] text-gray-400">The next steps take about a minute. Nothing is sent until you press the final button.</p>
        </div>
      )}

      {steps.includes('signature') && (
        <div hidden={step !== 'signature'}>
          <h2 className="text-[17px] font-semibold text-black mb-1">Your signature</h2>
          <p className="text-[13px] text-gray-500 mb-4">
            {sigBoxes.length > 0 ? `It will be placed on ${pagesList(sigBoxes)}.` : 'It will be added to the document.'} Draw it, or type your name.
          </p>
          <AdoptMark label="signature" mode={sigMode} onMode={setSigMode} canvasRef={sigRef} typed={sigTyped} onTyped={setSigTyped}
                     typedLabel="Type your full name" typedPlaceholder="Your full name" typedClass={bigTyped} visible />
        </div>
      )}

      {steps.includes('initials') && (
        <div hidden={step !== 'initials'}>
          <h2 className="text-[17px] font-semibold text-black mb-1">Your initials</h2>
          <p className="text-[13px] text-gray-500 mb-4">They will be placed on {pagesList(iniBoxes)}. We started you off with the letters of your name.</p>
          <AdoptMark label="initials" mode={iniMode} onMode={setIniMode} canvasRef={iniRef} typed={iniTyped}
                     onTyped={v => { setIniTouched(true); setIniTyped(v) }}
                     typedLabel="Type your initials" typedPlaceholder="For example TN" typedClass={bigTyped} visible />
        </div>
      )}

      {step === 'place' && (
        <div>
          <h2 className="text-[17px] font-semibold text-black mb-1">Where you are signing</h2>
          <p className="text-[13px] text-gray-500 mb-4">This is written on the document next to your signature.</p>
          <div className="space-y-3">
            {need.places.map(f => (
              <div key={f.field_id ?? `${f.page}-${f.y}`}>
                <label className="block text-[13px] font-medium text-black mb-1.5" htmlFor={`place-${f.field_id}`}>
                  Page {f.page}: {f.instruction || 'Where you are signing'}
                </label>
                <input id={`place-${f.field_id}`} type="text" value={places[f.field_id ?? ''] ?? ''} maxLength={100}
                       onChange={e => setPlaces(p => ({ ...p, [f.field_id ?? '']: e.target.value }))}
                       placeholder="For example Cape Town" className={smallInput} />
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 'review' && (
        <div>
          <h2 className="text-[17px] font-semibold text-black mb-1">Check and finish</h2>
          <p className="text-[13px] text-gray-500 mb-4">
            The numbered boxes show where each thing will go. Nothing has been sent yet.
          </p>
          {!previewFailed && (
            <DocumentPreview url={data.url} fields={fields} onError={() => setPreviewFailed(true)} />
          )}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-[13px] text-red-700">{error}</div>
      )}

      <div className="flex gap-3">
        {stepIndex > 0 && (
          <button type="button" onClick={back}
                  className="px-5 py-3.5 rounded-xl border border-black/[0.15] text-[14px] font-semibold text-black">
            Back
          </button>
        )}
        {isLast ? (
          <button type="button" onClick={submit} disabled={submitting}
                  className="flex-1 py-3.5 rounded-xl bg-black text-white text-[14px] font-semibold hover:bg-gray-800
                             active:bg-gray-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {submitting ? 'Submitting…' : 'Submit and finish'}
          </button>
        ) : (
          <button type="button" onClick={next}
                  className="flex-1 py-3.5 rounded-xl bg-black text-white text-[14px] font-semibold hover:bg-gray-800 active:bg-gray-900 transition-colors">
            Next
          </button>
        )}
      </div>
    </div>
  )
}
