'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import PartialReviewPanel, { type ReviewData } from '@/components/PartialReviewPanel'

type Status = 'done' | 'active' | 'pending' | 'failed'

interface Stage {
  n:      string
  label:  string
  detail: string
  status: Status
}

const PIPELINE: Omit<Stage, 'status'>[] = [
  { n: '01', label: 'Received',   detail: 'File validated and assigned a document ID'  },
  { n: '02', label: 'Classified', detail: 'AI identifies the form type'                },
  { n: '03', label: 'Extracted',  detail: 'Every field read and confidence-scored'     },
  { n: '04', label: 'Validated',  detail: 'Rules engine checks completeness'           },
  { n: '05', label: 'Filed',      detail: 'PDF stored in document hub'                 },
  { n: '06', label: 'Notified',   detail: 'User and operator confirmed via email'      },
]

function buildStages(activeStage: number, failed: boolean): Stage[] {
  return PIPELINE.map((s, i) => ({
    ...s,
    status: activeStage === -1
      ? 'done'
      : i < activeStage
        ? 'done'
        : i === activeStage
          ? (failed ? 'failed' : 'active')
          : 'pending',
  }))
}

function StepIcon({ status, n }: { status: Status; n: string }) {
  if (status === 'done') {
    return (
      <div className="w-6 h-6 rounded-full bg-black flex items-center justify-center flex-shrink-0">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 10 10">
          <path d="M2 5l2.5 2.5 3.5-4" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>
    )
  }
  if (status === 'active') {
    return (
      <div className="w-6 h-6 rounded-full border-2 border-black flex items-center justify-center flex-shrink-0">
        <div className="w-2 h-2 rounded-full bg-black animate-pulse"/>
      </div>
    )
  }
  if (status === 'failed') {
    return (
      <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 10 10">
          <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>
    )
  }
  return (
    <div className="w-6 h-6 rounded-full border border-black/[0.15] flex items-center justify-center
                    flex-shrink-0 text-[11px] font-semibold text-gray-300">
      {n}
    </div>
  )
}

interface DocMeta {
  filename:  string
  fileSize:  number
  product:   string
  docType:   string
  createdAt: string
}

interface SignerRow {
  name:  string
  email: string
  role:  string
}

interface SignerLink {
  signerId: string
  name:     string
  email:    string
  signUrl:  string
}

export default function StatusPage() {
  const { id } = useParams<{ id: string }>()
  const [stages,     setStages]     = useState<Stage[]>(buildStages(0, false))
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [meta,       setMeta]       = useState<DocMeta | null>(null)
  const [failed,     setFailed]     = useState(false)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [review,     setReview]     = useState<ReviewData | null>(null)

  // TheoFlow Sign / Print actions (Module 9)
  const [showSignForm,    setShowSignForm]    = useState(false)
  const [signerRows,      setSignerRows]      = useState<SignerRow[]>([{ name: '', email: '', role: '' }])
  const [signSubmitting,  setSignSubmitting]  = useState(false)
  const [signError,       setSignError]       = useState<string | null>(null)
  const [signLinks,       setSignLinks]       = useState<SignerLink[] | null>(null)
  const [printSubmitting, setPrintSubmitting] = useState(false)
  const [printMessage,    setPrintMessage]    = useState<string | null>(null)
  const [copiedLink,      setCopiedLink]      = useState<string | null>(null)

  useEffect(() => {
    let stopped = false

    async function poll() {
      try {
        const res = await fetch(`/api/status/${id}`)
        if (!res.ok) {
          if (res.status === 404) {
            setError('Document not found. The reference ID may be incorrect.')
          } else {
            setError(`Could not load status (${res.status}).`)
          }
          return
        }
        const data = await res.json() as {
          activeStage: number; failed?: boolean; validationErrors?: string[]; review?: ReviewData | null
        } & DocMeta
        setStages(buildStages(data.activeStage, !!data.failed))
        setFailed(!!data.failed)
        setValidationErrors(data.validationErrors ?? [])
        setReview(data.review ?? null)
        setMeta({ filename: data.filename, fileSize: data.fileSize, product: data.product, docType: data.docType, createdAt: data.createdAt })
        setError('')
        // Terminal states (filed/complete or rejected) never change again — stop polling.
        // PARTIAL keeps polling: once the human accepts, the next tick picks up
        // the transition to VALIDATED on its own.
        if (data.activeStage === -1 || data.failed) stopped = true
      } catch {
        setError('Connection error — retrying…')
      } finally {
        setLoading(false)
      }
    }

    poll()
    const t = setInterval(() => { if (stopped) clearInterval(t); else poll() }, 5000)
    return () => { stopped = true; clearInterval(t) }
  }, [id])

  const doneCount   = stages.filter(s => s.status === 'done').length
  const allDone     = doneCount === stages.length
  const pct         = Math.round((doneCount / stages.length) * 100)
  const needsReview = !!review

  function handleAccepted() {
    // Optimistic: hide the panel immediately, the next poll (≤5s) confirms
    // the transition to VALIDATED and updates the pipeline stages.
    setReview(null)
  }

  function updateSignerRow(i: number, field: keyof SignerRow, value: string) {
    setSignerRows(rows => rows.map((r, idx) => idx === i ? { ...r, [field]: value } : r))
  }

  function addSignerRow() {
    setSignerRows(rows => [...rows, { name: '', email: '', role: '' }])
  }

  function removeSignerRow(i: number) {
    setSignerRows(rows => rows.filter((_, idx) => idx !== i))
  }

  async function submitSignRequest() {
    setSignError(null)
    const signers = signerRows
      .filter(r => r.name.trim() || r.email.trim())
      .map(r => ({ name: r.name.trim(), email: r.email.trim(), role: r.role.trim() || undefined }))

    if (signers.length === 0) {
      setSignError('Add at least one signer.')
      return
    }

    setSignSubmitting(true)
    try {
      const res = await fetch('/api/sign/sessions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ submissionId: id, signers }),
      })
      const data = await res.json()
      if (res.ok) {
        setSignLinks(data.signers)
      } else {
        setSignError(data.error ?? 'Failed to create signing session.')
      }
    } catch {
      setSignError('Something went wrong. Please try again.')
    } finally {
      setSignSubmitting(false)
    }
  }

  function copyLink(url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedLink(url)
      setTimeout(() => setCopiedLink(null), 2000)
    })
  }

  async function triggerGeneratePdf() {
    setPrintMessage(null)
    setPrintSubmitting(true)
    try {
      const res = await fetch('/api/print/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ submissionId: id }),
      })
      const data = await res.json()
      setPrintMessage(res.ok ? 'PDF generation started.' : (data.error ?? 'Failed to start PDF generation.'))
    } catch {
      setPrintMessage('Something went wrong. Please try again.')
    } finally {
      setPrintSubmitting(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto pb-4">

      {/* Header */}
      <div className="mb-10">
        <p className={`text-[11px] font-semibold uppercase tracking-[0.12em] mb-1 ${
          failed ? 'text-red-500' : needsReview ? 'text-amber-600' : 'text-gray-400'
        }`}>
          {loading ? 'Loading…' : failed ? 'Needs attention' : needsReview ? 'Needs your review' : allDone ? 'Complete' : 'Processing'}
        </p>
        <h1 className="font-display text-[2rem] leading-tight text-black mb-1">
          {loading ? 'Checking status'
            : failed ? 'We couldn’t validate this document'
            : needsReview ? 'A few fields need your input'
            : allDone ? 'Document filed'
            : 'In the pipeline'}
        </h1>
        <p className="font-mono text-[13px] text-gray-400">{id}</p>
        {error && (
          <p className="mt-2 text-[12px] text-red-500">{error}</p>
        )}
        {failed && validationErrors.length > 0 && (
          <ul className="mt-3 space-y-1">
            {validationErrors.map((msg, i) => (
              <li key={i} className="text-[12px] text-red-500">{msg}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Progress bar */}
      <div className="mb-8">
        <div className="flex justify-between text-[11px] text-gray-400 mb-1.5">
          <span>{doneCount} of {stages.length} steps complete</span>
          <span>{pct}%</span>
        </div>
        <div className="h-[3px] bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-black rounded-full transition-all duration-700"
               style={{ width: `${pct}%` }}/>
        </div>
      </div>

      {/* Pipeline steps */}
      <div className="mb-10">
        {stages.map((s, i) => (
          <div key={s.n} className="flex gap-4 items-start">
            <div className="flex flex-col items-center flex-shrink-0 w-6">
              <StepIcon status={s.status} n={s.n}/>
              {i < stages.length - 1 && (
                <div className={`w-px my-1 ${s.status === 'done' ? 'bg-black/25' : 'bg-black/[0.06]'}`}
                     style={{ minHeight: 28 }}/>
              )}
            </div>
            <div className="pb-5 flex-1">
              <div className="flex items-center gap-2">
                <p className={`text-[13px] font-semibold ${
                  s.status === 'done'    ? 'text-black'    :
                  s.status === 'active'  ? 'text-black'    :
                  s.status === 'failed'  ? 'text-red-600'  :
                                          'text-gray-300'
                }`}>
                  {s.label}
                </p>
                {s.status === 'active' && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full
                                   border border-amber-300 text-amber-600 leading-none">
                    {needsReview ? 'Needs review' : 'In progress'}
                  </span>
                )}
                {s.status === 'failed' && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full
                                   bg-red-500 text-white leading-none">
                    Rejected
                  </span>
                )}
                {s.status === 'done' && i === 0 && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full
                                   bg-black text-white leading-none">
                    Done
                  </span>
                )}
              </div>
              <p className={`text-[12px] mt-0.5 leading-snug ${
                s.status === 'pending' ? 'text-gray-200' : 'text-gray-400'
              }`}>
                {s.detail}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Human review panel — surfaces when the pipeline reports PARTIAL */}
      {review && (
        <PartialReviewPanel docId={id} review={review} onAccepted={handleAccepted} />
      )}

      {/* Document ref card */}
      <div className="border border-black/[0.08] rounded-2xl p-5 mb-8 bg-gray-50/60">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-3">
          Document reference
        </p>
        <p className="font-mono text-[1.1rem] font-semibold text-black">{id}</p>

        {meta && (
          <div className="mt-4 pt-4 border-t border-black/[0.06] space-y-2">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg border border-black/[0.08] bg-white flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5
                       7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504
                       -1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504
                       1.125-1.125V11.25a9 9 0 00-9-9z"/>
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-black truncate">{meta.filename}</p>
                <p className="text-[12px] text-gray-400">
                  {meta.fileSize ? `${(meta.fileSize / 1024 / 1024).toFixed(1)} MB · ` : ''}
                  {meta.product} · {meta.docType}
                </p>
              </div>
            </div>
          </div>
        )}

        <p className="text-[12px] text-gray-400 mt-3">
          Use this reference to track or query your document.
        </p>
      </div>

      {/* TheoFlow Sign / Print — VALIDATED-attach entry points (Module 9) */}
      {allDone && !failed && (
        <div className="border border-black/[0.08] rounded-2xl p-5 mb-8 space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
            Next steps
          </p>

          <div className="flex gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => setShowSignForm(v => !v)}
              className="px-5 py-2.5 rounded-full border border-black/[0.12] text-[13px] font-medium
                         text-gray-700 hover:border-black hover:text-black transition-colors">
              Request signature
            </button>
            <button
              type="button"
              onClick={triggerGeneratePdf}
              disabled={printSubmitting}
              className="px-5 py-2.5 rounded-full border border-black/[0.12] text-[13px] font-medium
                         text-gray-700 hover:border-black hover:text-black transition-colors disabled:opacity-50">
              {printSubmitting ? 'Starting…' : 'Generate PDF'}
            </button>
          </div>

          {printMessage && <p className="text-[12px] text-gray-500">{printMessage}</p>}

          {showSignForm && !signLinks && (
            <div className="space-y-3 pt-2 border-t border-black/[0.06]">
              {signerRows.map((row, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    type="text" placeholder="Signer name" value={row.name}
                    onChange={e => updateSignerRow(i, 'name', e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg border border-black/[0.12] text-[13px] outline-none focus:border-black/40"
                  />
                  <input
                    type="email" placeholder="Email" value={row.email}
                    onChange={e => updateSignerRow(i, 'email', e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg border border-black/[0.12] text-[13px] outline-none focus:border-black/40"
                  />
                  <input
                    type="text" placeholder="Role (optional)" value={row.role}
                    onChange={e => updateSignerRow(i, 'role', e.target.value)}
                    className="w-32 px-3 py-2 rounded-lg border border-black/[0.12] text-[13px] outline-none focus:border-black/40"
                  />
                  {signerRows.length > 1 && (
                    <button type="button" onClick={() => removeSignerRow(i)}
                            className="text-gray-300 hover:text-red-500 transition-colors px-1">✕</button>
                  )}
                </div>
              ))}
              <button type="button" onClick={addSignerRow}
                      className="text-[12px] font-medium text-gray-400 hover:text-black transition-colors">
                + Add signer
              </button>
              {signError && <p className="text-[12px] text-red-500">{signError}</p>}
              <button
                type="button"
                onClick={submitSignRequest}
                disabled={signSubmitting}
                className="px-5 py-2.5 rounded-full bg-black text-white text-[13px] font-medium
                           hover:bg-gray-900 transition-colors disabled:opacity-50">
                {signSubmitting ? 'Sending…' : 'Send for signature'}
              </button>
            </div>
          )}

          {signLinks && (
            <div className="space-y-2 pt-2 border-t border-black/[0.06]">
              <p className="text-[12px] text-gray-500">Share these links with each signer:</p>
              {signLinks.map(link => (
                <div key={link.signerId} className="flex items-center justify-between gap-3 bg-gray-50 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-black truncate">{link.name}</p>
                    <p className="text-[11px] text-gray-400 truncate">{link.email}</p>
                  </div>
                  <button type="button" onClick={() => copyLink(link.signUrl)}
                          className="text-[12px] font-medium text-indigo-500 hover:text-indigo-700 transition-colors whitespace-nowrap">
                    {copiedLink === link.signUrl ? '✓ Copied' : 'Copy link'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 flex-wrap">
        <Link href="/upload"
          className="px-6 py-3 rounded-full bg-black text-white text-[13px] font-medium
                     hover:bg-gray-900 transition-colors">
          Upload another
        </Link>
        <Link href="/dashboard"
          className="px-6 py-3 rounded-full border border-black/[0.12] text-[13px]
                     font-medium text-gray-600 hover:border-black hover:text-black transition-colors">
          View all documents
        </Link>
      </div>

      <p className="mt-8 text-[11px] text-gray-300">
        POPIA compliant · Data stored in South Africa (af-south-1) · 256-bit TLS in transit
      </p>
    </div>
  )
}
