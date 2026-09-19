'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useOrg } from '@/lib/org-context'
import { suggestForm, type FormSummary, type UploadInfo, type MatchResult } from '@/lib/sign-form-match'

// Send one of the organisation's saved Sign forms to one set of people.
// The operator has already set up where each person initials, signs and dates;
// here the customer's staff just upload THIS person's PDF, check it is the
// right form, and say who signs each role.

const MAX_MB = 50
const MAX_BYTES = MAX_MB * 1024 * 1024

interface SignerLink { signerId: string; role: string; name: string; email: string; signUrl: string }
interface Person { name: string; email: string }

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

const STATUS_LABEL: Record<MatchResult['status'], string> = {
  match: 'looks right',
  unsure: 'check needed',
  mismatch: 'does not fit this document',
}

export default function SendFormPage() {
  const { loading: orgLoading } = useOrg()
  const inputRef = useRef<HTMLInputElement>(null)

  const [forms, setForms]           = useState<FormSummary[] | null>(null)
  const [formsError, setFormsError] = useState(false)

  const [file, setFile]         = useState<File | null>(null)
  const [info, setInfo]         = useState<UploadInfo | null>(null)
  const [reading, setReading]   = useState(false)
  const [fileError, setFileError] = useState('')

  const [selectedId, setSelectedId] = useState('')
  const [confirmed, setConfirmed]   = useState(false)
  const [people, setPeople]         = useState<Record<string, Person>>({})

  const [sending, setSending] = useState(false)
  const [error, setError]     = useState('')
  const [result, setResult]   = useState<{ signers: SignerLink[]; emailQueued: boolean } | null>(null)
  const [copied, setCopied]   = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/sign/forms')
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => setForms(d.forms as FormSummary[]))
      .catch(() => setFormsError(true))
  }, [])

  const matching = useMemo(() => (info && forms ? suggestForm(info, forms) : null), [info, forms])
  const selected = forms?.find(f => f.formId === selectedId) ?? null
  const selectedResult = selected && matching ? matching.results[selected.formId] : null

  async function pickFile(f: File) {
    setFileError(''); setError(''); setConfirmed(false); setInfo(null); setSelectedId('')
    if (f.type !== 'application/pdf') { setFileError('Only PDF documents can be sent for signature.'); return }
    if (f.size > MAX_BYTES) { setFileError(`File too large. Max ${MAX_MB} MB.`); return }
    setFile(f)
    setReading(true)
    try {
      const { readUploadInfo } = await import('./pdf-read')
      const read = await readUploadInfo(f)
      setInfo(read)
      if (forms) {
        const { suggested } = suggestForm(read, forms)
        // one clear match is pre-selected; a lone form is pre-selected too (its check still shows)
        setSelectedId(suggested?.formId ?? (forms.length === 1 ? forms[0].formId : ''))
      }
    } catch {
      setFile(null)
      setFileError('That PDF could not be read. Is it damaged or password protected?')
    } finally {
      setReading(false)
    }
  }

  function chooseForm(id: string) {
    setSelectedId(id); setConfirmed(false); setError('')
    const form = forms?.find(f => f.formId === id)
    // keep anything already typed for roles the new form also has
    setPeople(prev => Object.fromEntries((form?.roles ?? []).map(r => [r, prev[r] ?? { name: '', email: '' }])))
  }

  function setPerson(role: string, patch: Partial<Person>) {
    setPeople(p => ({ ...p, [role]: { ...(p[role] ?? { name: '', email: '' }), ...patch } }))
  }

  const peopleComplete = !!selected && selected.roles.every(r => {
    const p = people[r]
    return p && p.name.trim() && looksLikeEmail(p.email)
  })
  const fits = !!selectedResult && selectedResult.status !== 'mismatch' && (selectedResult.status !== 'unsure' || confirmed)
  const canSend = !!file && !!info && !!selected && fits && peopleComplete && !sending

  async function send() {
    if (!canSend || !file || !selected) return
    setError(''); setSending(true)
    try {
      const presignRes = await fetch('/api/sign/upload/presign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type, contentLength: file.size }),
      })
      const presign = await presignRes.json().catch(() => ({}))
      if (!presignRes.ok) { setError(presign.error ?? 'Failed to prepare the upload.'); return }

      const put = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
      if (!put.ok) { setError('Failed to upload the document.'); return }

      const res = await fetch(`/api/sign/forms/${selected.formId}/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formVersion: selected.currentVersion,
          sourceDocument: { sessionId: presign.sessionId, s3Key: presign.key, sha256: await sha256Hex(file), filename: file.name },
          signers: selected.roles.map(role => ({ role, name: people[role].name.trim(), email: people[role].email.trim() })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'Failed to send the form.'); return }
      setResult({ signers: data.signers, emailQueued: !!data.emailQueued })
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSending(false)
    }
  }

  function reset() {
    setFile(null); setInfo(null); setSelectedId(''); setConfirmed(false); setPeople({})
    setResult(null); setError(''); setFileError('')
  }

  function copyLink(url: string) {
    navigator.clipboard.writeText(url).then(() => { setCopied(url); setTimeout(() => setCopied(null), 2000) }).catch(() => {})
  }

  if (orgLoading) return null

  if (result) {
    return (
      <div className="max-w-xl">
        <h1 className="font-display text-[2.1rem] leading-tight text-black mb-2">Form sent</h1>
        <p className="text-[13px] text-gray-400 mb-6">
          {result.emailQueued
            ? 'Each person is being emailed their own signing link. You can also share the links yourself:'
            : 'The emails could not be queued. Send each person their own link yourself:'}
        </p>
        <div className="space-y-2 mb-6">
          {result.signers.map(s => (
            <div key={s.signerId} className="flex items-center justify-between gap-3 bg-gray-50 rounded-xl px-4 py-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-black truncate">{s.role}: {s.name}</p>
                <p className="text-[11px] text-gray-400 truncate">{s.email}</p>
              </div>
              <button type="button" onClick={() => copyLink(s.signUrl)}
                      className="text-[12px] font-medium text-indigo-500 hover:text-indigo-700 whitespace-nowrap">
                {copied === s.signUrl ? '✓ Copied' : 'Copy link'}
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={reset} className="rounded-full bg-black text-white text-[13px] font-semibold px-5 py-2.5">
            Send another form
          </button>
          <Link href="/sign" className="rounded-full border border-black/[0.15] text-[13px] font-semibold px-5 py-2.5">
            Back to signing sessions
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-xl">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-1">TheoFlow Sign</p>
      <h1 className="font-display text-[2.1rem] leading-tight text-black mb-6">Send a form</h1>

      {formsError && (
        <div role="alert" className="mb-4 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-[13px] text-red-700">
          Your forms could not be loaded. Please reload the page.
        </div>
      )}

      {forms && forms.length === 0 && (
        <div className="rounded-2xl border border-dashed border-black/[0.15] px-5 py-8 text-center">
          <p className="text-[14px] font-semibold text-black mb-1">No forms are set up yet</p>
          <p className="text-[13px] text-gray-400">
            Forms are set up for you by TheoFlow. Contact us with the form you want to send and we will get it ready.
          </p>
        </div>
      )}

      {forms && forms.length > 0 && (
        <>
          <p className="text-[13px] font-semibold text-black mb-2">1. The document</p>
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) pickFile(f) }}
            onClick={() => inputRef.current?.click()}
            className="rounded-2xl border-2 border-dashed border-black/[0.12] p-8 text-center cursor-pointer hover:border-black/25 transition-colors mb-2">
            <input ref={inputRef} type="file" accept="application/pdf" className="hidden" aria-label="Choose the PDF"
                   onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f) }} />
            {file ? (
              <p className="text-[14px] font-medium text-black">{file.name}</p>
            ) : (
              <>
                <p className="text-[14px] font-medium text-black mb-1">Drop this person's PDF here, or click to choose</p>
                <p className="text-[12px] text-gray-400">Max {MAX_MB} MB</p>
              </>
            )}
          </div>
          {reading && <p className="text-[12px] text-gray-400 mb-2" role="status">Reading the document…</p>}
          {fileError && <p role="alert" className="text-[12px] text-red-500 mb-2">{fileError}</p>}

          {info && (
            <>
              <p className="text-[13px] font-semibold text-black mt-6 mb-2">2. Which form is this?</p>
              {matching?.suggested && selectedId === matching.suggested.formId && (
                <p className="text-[13px] text-green-700 mb-2" role="status">This looks like {matching.suggested.name}.</p>
              )}
              <select aria-label="Which form is this?" value={selectedId} onChange={e => chooseForm(e.target.value)}
                      className="w-full rounded-lg border border-black/[0.12] px-3 py-2.5 text-[13px] mb-2">
                <option value="">Choose a form</option>
                {forms.map(f => (
                  <option key={f.formId} value={f.formId}>
                    {f.name} ({matching ? STATUS_LABEL[matching.results[f.formId].status] : ''})
                  </option>
                ))}
              </select>

              {selectedResult && selectedResult.status === 'match' && (
                <p className="text-[12px] text-green-700 mb-2">This document matches {selected!.name}.</p>
              )}
              {selectedResult && selectedResult.status !== 'match' && (
                <div role="alert" className={`rounded-xl px-4 py-3 text-[12px] mb-2 ${
                  selectedResult.status === 'mismatch' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>
                  <p className="font-semibold mb-1">
                    {selectedResult.status === 'mismatch'
                      ? `This document does not fit ${selected!.name}, so it cannot be sent as that form.`
                      : `We could not be sure this is ${selected!.name}.`}
                  </p>
                  <ul className="list-disc pl-4">{selectedResult.problems.map(p => <li key={p}>{p}</li>)}</ul>
                  {selectedResult.status === 'unsure' && (
                    <label className="flex items-center gap-2 mt-2">
                      <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
                      I have checked that this is the right form
                    </label>
                  )}
                </div>
              )}

              {selected && (
                <>
                  <p className="text-[13px] font-semibold text-black mt-6 mb-1">3. Who signs</p>
                  <p className="text-[12px] text-gray-400 mb-3">Each person gets their own link and only sees what they need to do.</p>
                  <div className="space-y-3">
                    {selected.roles.map(role => (
                      <div key={role}>
                        <p className="text-[12px] font-medium text-gray-500 mb-1">{role}</p>
                        <div className="flex gap-2">
                          <input type="text" placeholder="Full name" aria-label={`Name for ${role}`}
                                 value={people[role]?.name ?? ''} onChange={e => setPerson(role, { name: e.target.value })}
                                 className="flex-1 px-3 py-2.5 rounded-lg border border-black/[0.12] text-[13px] outline-none focus:border-black/40" />
                          <input type="email" placeholder="Email" aria-label={`Email for ${role}`}
                                 value={people[role]?.email ?? ''} onChange={e => setPerson(role, { email: e.target.value })}
                                 className="flex-1 px-3 py-2.5 rounded-lg border border-black/[0.12] text-[13px] outline-none focus:border-black/40" />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {error && (
            <div role="alert" className="mt-4 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-[13px] text-red-700">{error}</div>
          )}

          <button type="button" onClick={send} disabled={!canSend}
                  className="mt-6 w-full rounded-full bg-black text-white text-[14px] font-semibold py-3 disabled:opacity-40">
            {sending ? 'Sending…' : 'Send for signature'}
          </button>
        </>
      )}
    </div>
  )
}
