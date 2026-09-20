'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useOrg } from '@/lib/org-context'
import type { FormSummary, UploadInfo } from '@/lib/sign-form-match'
import { readRecipients, suggestPeople, type Source } from '@/lib/sign-recipients'

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
  const [people, setPeople]         = useState<Record<string, Person>>({})
  // where each pre-filled value came from, so the agent knows what to check
  const [sources, setSources]       = useState<Record<string, { name: Source; email: Source }>>({})

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

  const selected = forms?.find(f => f.formId === selectedId) ?? null

  // Fills the people from what the form says about who it is for: read from the
  // uploaded document first, then the form's fixed default person for a role.
  // Only empty boxes are filled, so nothing the agent typed is overwritten.
  function prefill(form: FormSummary | undefined, upload: UploadInfo | null, current: Record<string, Person>) {
    if (!form) return
    const extracted = upload?.pageItems && form.reads?.length
      ? readRecipients(upload.pageItems, upload.pageWidth, upload.pageHeight, form.reads)
      : {}
    const suggested = suggestPeople(form.roles, extracted, form.roleDefaults ?? [])
    const nextPeople: Record<string, Person> = {}
    const nextSources: Record<string, { name: Source; email: Source }> = {}
    for (const role of form.roles) {
      const cur = current[role] ?? { name: '', email: '' }
      const sg = suggested[role]
      nextPeople[role]  = { name: cur.name.trim() ? cur.name : sg.name, email: cur.email.trim() ? cur.email : sg.email }
      nextSources[role] = { name: cur.name.trim() ? null : sg.nameFrom, email: cur.email.trim() ? null : sg.emailFrom }
    }
    setPeople(nextPeople)
    setSources(nextSources)
  }

  async function pickFile(f: File) {
    setFileError(''); setError(''); setInfo(null); setPeople({}); setSources({})
    if (f.type !== 'application/pdf') { setFileError('Only PDF documents can be sent for signature.'); return }
    if (f.size > MAX_BYTES) { setFileError(`File too large. Max ${MAX_MB} MB.`); return }
    setFile(f)
    setReading(true)
    try {
      const { readUploadInfo } = await import('./pdf-read')
      const read = await readUploadInfo(f)
      setInfo(read)
      // the form was chosen first: read who it is for from this document
      prefill(forms?.find(f => f.formId === selectedId), read, {})
    } catch {
      setFile(null)
      setFileError('That PDF could not be read. Is it damaged or password protected?')
    } finally {
      setReading(false)
    }
  }

  function chooseForm(id: string) {
    setSelectedId(id); setError('')
    const form = forms?.find(f => f.formId === id)
    // keep anything already typed for roles the new form also has
    prefill(form, info, people)
  }

  // What the agent should know about a role's pre-filled details.
  function hintFor(role: string): string {
    const src = sources[role]
    const parts: string[] = []
    if (src?.name === 'document') parts.push('Name read from the document.')
    if (src?.email === 'document') parts.push('Email read from the document.')
    if (src?.name === 'default' || src?.email === 'default') parts.push('Usual person for this form.')
    const expectedName = selected?.reads?.some(r => r.role === role && r.kind === 'name')
    if (expectedName && !src?.name && !people[role]?.name) parts.push('No name could be read from the document. Please type it.')
    return parts.join(' ')
  }

  function setPerson(role: string, patch: Partial<Person>) {
    setPeople(p => ({ ...p, [role]: { ...(p[role] ?? { name: '', email: '' }), ...patch } }))
  }

  const peopleComplete = !!selected && selected.roles.every(r => {
    const p = people[r]
    return p && p.name.trim() && looksLikeEmail(p.email)
  })
  const canSend = !!file && !!info && !!selected && peopleComplete && !sending

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
    setFile(null); setInfo(null); setSelectedId(''); setPeople({}); setSources({})
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
      <Link href="/sign" className="text-[12px] font-medium text-gray-400 hover:text-black">
        &larr; Back to signing sessions
      </Link>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mt-4 mb-1">TheoFlow Sign</p>
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
          <p className="text-[13px] font-semibold text-black mb-2">1. Click the form you are sending</p>
          <div role="radiogroup" aria-label="The form you are sending" className="space-y-2 mb-2">
            {forms.map(f => (
              <label key={f.formId}
                     className={`flex items-start gap-3 rounded-2xl border px-4 py-3 cursor-pointer transition-colors ${
                       selectedId === f.formId ? 'border-black bg-gray-50' : 'border-black/[0.12] hover:border-black/30'}`}>
                <input type="radio" name="sign-form" value={f.formId} checked={selectedId === f.formId}
                       onChange={() => chooseForm(f.formId)} className="mt-1" />
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-black">{f.name}</span>
                  <span className="block text-[12px] text-gray-400">
                    {f.pageCount} page{f.pageCount !== 1 ? 's' : ''} &middot; signed by {f.roles.join(', ')}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {selected && (
            <>
              <p className="text-[13px] font-semibold text-black mt-6 mb-2">2. Add this person's document</p>
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
                  {selected && (
                    <>
                      <p className="text-[13px] font-semibold text-black mt-6 mb-1">3. Who signs</p>
                      <p className="text-[12px] text-gray-400 mb-3">Each person gets their own link and only sees what they need to do.</p>
                      {Object.values(sources).some(s => s.name === 'document' || s.email === 'document') && (
                        <p role="status" className="text-[12px] text-green-700 bg-green-50 rounded-xl px-3 py-2 mb-3">
                          We filled in the people we could from the document. Please check every name and email before you send.
                        </p>
                      )}
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
                            {hintFor(role) && <p className="text-[11px] text-gray-400 mt-1">{hintFor(role)}</p>}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
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
