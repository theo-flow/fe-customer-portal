'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import type SignatureCanvas from 'react-signature-canvas'
import type { DetectedField } from '@/lib/sign'
import {
  boxesOf, buildGroups, cleanPlace, dateBounds, dateProblem, formatChosenDate, GROUP_TITLES, initialsFromName,
  instructionOf, pagesPhrase, summariseGroups, todaySAST, validateSubmission,
  type GroupId, type MarkType, type Submission,
} from '@/lib/sign-tasks'
import type { BoxValue } from './DocumentPreview'
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

interface Mark { type: MarkType; data: string }

const bigTyped = 'w-full px-4 py-3 rounded-xl border border-black/[0.12] text-[22px] italic bg-white outline-none focus:border-black/40 focus:ring-2 focus:ring-black/5 transition-all'
const smallInput = 'w-full px-4 py-2.5 rounded-xl border border-black/[0.12] text-[14px] bg-white outline-none focus:border-black/40 focus:ring-2 focus:ring-black/5 transition-all'

// The signer works ON the document. They are walked through one KIND of thing
// at a time (their signature, their initials, the date, where they signed);
// the pages and boxes it applies to light up, and what they enter appears
// inside every one of those boxes straight away. Doing it once fills every box
// of that kind, so initials on seven pages is a single task.
export default function SignCapture({
  sessionId, signerId, token,
}: {
  sessionId: string
  signerId:  string
  token:     string
}) {
  const [data, setData]           = useState<DocumentData | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)

  const [stepIndex, setStepIndex]   = useState(0)
  const [error, setError]           = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone]             = useState(false)

  // signature and initials: what is being drawn or typed now, and what was applied
  const [sigMode, setSigMode]   = useState<MarkMode>('draw')
  const [sigTyped, setSigTyped] = useState('')
  const sigRef = useRef<SignatureCanvas>(null)
  const [sigApplied, setSigApplied] = useState<Mark | null>(null)

  const [iniMode, setIniMode]   = useState<MarkMode>('type')
  const [iniTyped, setIniTyped] = useState('')
  const [iniTouched, setIniTouched] = useState(false)
  const iniRef = useRef<SignatureCanvas>(null)
  const [iniApplied, setIniApplied] = useState<Mark | null>(null)

  const [dateDraft, setDateDraft]     = useState(todaySAST())
  const [dateApplied, setDateApplied] = useState<string | null>(null)
  const [placeDraft, setPlaceDraft]     = useState('')
  const [placeApplied, setPlaceApplied] = useState<string | null>(null)

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

  const fields = useMemo(() => data?.fields ?? [], [data])
  const groups = useMemo(() => buildGroups(fields), [fields])
  const hasBoxes = fields.length > 0
  // intro (only when there are boxes to explain), one step per kind of task, then the final check
  const steps = useMemo(() => [...(hasBoxes ? ['intro'] : []), ...groups, 'finish'] as (GroupId | 'intro' | 'finish')[], [hasBoxes, groups])
  const step = steps[Math.min(stepIndex, steps.length - 1)]
  const group = (groups as string[]).includes(step) ? (step as GroupId) : null
  const groupNumber = group ? groups.indexOf(group) + 1 : 0

  // ---- what each box should be showing right now ----
  const values = useMemo(() => {
    const out: Record<string, BoxValue> = {}
    const asValue = (applied: Mark | null, active: boolean, mode: MarkMode, typed: string): BoxValue | undefined => {
      if (active && mode === 'type' && typed.trim()) return { kind: 'text', value: typed.trim() }
      if (!applied) return undefined
      return applied.type === 'DRAWN' ? { kind: 'image', value: applied.data } : { kind: 'text', value: applied.data }
    }
    for (const box of fields) {
      if (!box.field_id) continue
      let v: BoxValue | undefined
      if (box.field_type === 'signature') v = asValue(sigApplied, group === 'signature', sigMode, sigTyped)
      else if (box.field_type === 'initials') v = asValue(iniApplied, group === 'initials', iniMode, iniTyped)
      else if (box.field_type === 'date') {
        const text = formatChosenDate(group === 'date' ? dateDraft : (dateApplied ?? ''), box.date_format)
        if (text) v = { kind: 'text', value: text }
      } else if (box.field_type === 'place') {
        const text = cleanPlace(group === 'place' ? placeDraft : (placeApplied ?? ''))
        if (text) v = { kind: 'text', value: text }
      } else if (box.field_type === 'name' && data?.signerName) v = { kind: 'text', value: data.signerName }
      if (v) out[box.field_id] = v
    }
    return out
  }, [fields, group, sigApplied, sigMode, sigTyped, iniApplied, iniMode, iniTyped, dateDraft, dateApplied, placeDraft, placeApplied, data?.signerName])

  // ---- reading a drawn or typed mark ----
  function readMark(mode: MarkMode, typed: string, ref: React.RefObject<SignatureCanvas>): Mark | null {
    if (mode === 'draw') {
      if (!ref.current || ref.current.isEmpty()) return null
      return { type: 'DRAWN', data: ref.current.toDataURL('image/png') }
    }
    return typed.trim() ? { type: 'TYPED', data: typed.trim() } : null
  }

  // Applies what is entered for this kind of task to every box of that kind,
  // then moves to the next task.
  function applyAndContinue() {
    if (!group) return
    if (group === 'signature') {
      const m = readMark(sigMode, sigTyped, sigRef)
      if (!m) { setError('Please add your signature.'); return }
      setSigApplied(m)
    } else if (group === 'initials') {
      const m = readMark(iniMode, iniTyped, iniRef)
      if (!m) { setError('Please add your initials.'); return }
      setIniApplied(m)
    } else if (group === 'date') {
      const problem = dateProblem(dateDraft)
      if (problem) { setError(problem); return }
      setDateApplied(dateDraft)
    } else {
      const text = cleanPlace(placeDraft)
      if (!text) { setError('Please say where you are signing.'); return }
      setPlaceApplied(text)
    }
    setError(null)
    setStepIndex(i => Math.min(i + 1, steps.length - 1))
  }

  const back = () => { setError(null); setStepIndex(i => Math.max(i - 1, 0)) }

  // Clicking a box on the document jumps to the task it belongs to.
  function onBoxClick(field: DetectedField) {
    const target = (groups as string[]).indexOf(field.field_type)
    if (target < 0) return
    setError(null)
    setStepIndex((hasBoxes ? 1 : 0) + target)
  }

  function buildSubmission(): Submission {
    const placeBoxes = boxesOf(fields, 'place')
    const placeValues: Record<string, string> = {}
    for (const b of placeBoxes) if (b.field_id && placeApplied) placeValues[b.field_id] = placeApplied
    return {
      signatureType: sigApplied?.type, signatureData: sigApplied?.data,
      initialsType:  iniApplied?.type, initialsData:  iniApplied?.data,
      signingDate:   dateApplied ?? undefined,
      placeValues,
      // older boxes have no id, so they take the single place answer
      placeData:     placeApplied ?? undefined,
    }
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

  const boxes = group ? boxesOf(fields, group) : []
  const instruction = boxes.length > 0 ? instructionOf(boxes[0]) : ''
  const dateBoxes = boxesOf(fields, 'date')
  const written = Array.from(new Set(dateBoxes.map(b => formatChosenDate(dateDraft, b.date_format)).filter(Boolean)))
  const bounds = dateBounds()
  const isLast = step === 'finish'

  const enter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); applyAndContinue() } }

  return (
    <div className="space-y-4">
      {!previewFailed && (
        <DocumentPreview
          url={data.url}
          fields={fields}
          values={values}
          activeType={group}
          onError={() => setPreviewFailed(true)}
          onBoxClick={hasBoxes ? onBoxClick : undefined}
        />
      )}

      <div className="sticky bottom-3 z-10 rounded-2xl border border-black/[0.1] bg-white shadow-lg px-5 py-4 space-y-3">
        {step === 'intro' && (
          <div>
            <h2 className="text-[16px] font-semibold text-black mb-1">
              {data.signerName ? `${data.signerName}, here is what you need to do` : 'Here is what you need to do'}
            </h2>
            {data.signerRole && (
              <p className="text-[12px] text-gray-500 mb-2">You are signing as <span className="font-medium text-black">{data.signerRole}</span>.</p>
            )}
            <ol className="space-y-1.5 mb-3">
              {summariseGroups(fields).map((g, i) => (
                <li key={g.group} className="flex gap-2.5 text-[13px] text-black">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-black text-white text-[11px] font-semibold flex items-center justify-center">{i + 1}</span>
                  <span>{g.text}</span>
                </li>
              ))}
            </ol>
            <p className="text-[12px] text-gray-400 mb-3">
              The boxes on the document above show where each one goes. Nothing is sent until you press the final button.
            </p>
            <button type="button" onClick={() => setStepIndex(1)}
                    className="w-full py-3 rounded-xl bg-black text-white text-[14px] font-semibold hover:bg-gray-800 transition-colors">
              Start
            </button>
          </div>
        )}

        {group && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-400">Step {groupNumber} of {groups.length}</p>
              <p className="text-[11px] text-gray-400">{boxes.length > 0 ? `Applies to ${pagesPhrase(boxes)}` : ''}</p>
            </div>
            <h2 className="text-[16px] font-semibold text-black mb-0.5">{GROUP_TITLES[group]}</h2>
            {instruction && <p className="text-[13px] text-gray-500 mb-3">{instruction}</p>}
          </div>
        )}

        {/* the inputs stay mounted so a drawn signature survives Back and Next */}
        {groups.includes('signature') && (
          <div hidden={group !== 'signature'}>
            <AdoptMark label="signature" mode={sigMode} onMode={setSigMode} canvasRef={sigRef} typed={sigTyped} onTyped={setSigTyped}
                       typedLabel="Type your full name" typedPlaceholder="Your full name" typedClass={bigTyped} visible />
          </div>
        )}
        {groups.includes('initials') && (
          <div hidden={group !== 'initials'}>
            <AdoptMark label="initials" mode={iniMode} onMode={setIniMode} canvasRef={iniRef} typed={iniTyped}
                       onTyped={v => { setIniTouched(true); setIniTyped(v) }}
                       typedLabel="Type your initials" typedPlaceholder="For example TN" typedClass={bigTyped} visible />
          </div>
        )}
        {group === 'date' && (
          <div>
            <label className="block text-[13px] font-medium text-black mb-1.5" htmlFor="chosen-date">Choose the date</label>
            <input id="chosen-date" type="date" value={dateDraft} min={bounds.min} max={bounds.max}
                   onChange={e => setDateDraft(e.target.value)} onKeyDown={enter} className={smallInput} />
            {written.length > 0 && (
              <p className="text-[12px] text-gray-500 mt-2">It will be written on the form as: <span className="font-medium text-black">{written.join(' and ')}</span></p>
            )}
          </div>
        )}
        {group === 'place' && (
          <div>
            <label className="block text-[13px] font-medium text-black mb-1.5" htmlFor="chosen-place">Where are you signing?</label>
            <input id="chosen-place" type="text" value={placeDraft} maxLength={100} onChange={e => setPlaceDraft(e.target.value)}
                   onKeyDown={enter} placeholder="For example Cape Town" className={smallInput} />
          </div>
        )}

        {isLast && (
          <div>
            <h2 className="text-[16px] font-semibold text-black mb-1">That is everything</h2>
            <p className="text-[13px] text-gray-500">Check the document above. If something is wrong, tap that box to change it. Then submit.</p>
          </div>
        )}

        {error && (
          <div role="alert" className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-[13px] text-red-700">{error}</div>
        )}

        {step !== 'intro' && (
          <div className="flex gap-3">
            {stepIndex > 0 && (
              <button type="button" onClick={back}
                      className="px-5 py-3 rounded-xl border border-black/[0.15] text-[14px] font-semibold text-black">
                Back
              </button>
            )}
            {isLast ? (
              <button type="button" onClick={submit} disabled={submitting}
                      className="flex-1 py-3 rounded-xl bg-black text-white text-[14px] font-semibold hover:bg-gray-800
                                 active:bg-gray-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {submitting ? 'Submitting…' : 'Submit and finish'}
              </button>
            ) : (
              <button type="button" onClick={applyAndContinue}
                      className="flex-1 py-3 rounded-xl bg-black text-white text-[14px] font-semibold hover:bg-gray-800 active:bg-gray-900 transition-colors">
                {group === 'signature' ? 'Use this signature' : group === 'initials' ? 'Use these initials' : group === 'date' ? 'Use this date' : 'Use this place'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
