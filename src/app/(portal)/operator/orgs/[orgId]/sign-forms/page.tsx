'use client'
import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

// Operator only (same gate as the rest of /operator, enforced server-side by
// the API). Lists a customer's Sign forms and starts a new one from the
// company's sample PDF. The layout is then built in the editor.

interface FormRow {
  formId:         string
  name:           string
  currentVersion: number
  pageCount:      number
  roles:          string[]
  fieldCount:     number
  valid:          boolean
  updatedAt:      string
}

const MAX_MB = 50

export default function SignFormsPage() {
  const params = useParams()
  const orgId  = params.orgId as string
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [orgName, setOrgName]     = useState('')
  const [forms, setForms]         = useState<FormRow[]>([])
  const [loading, setLoading]     = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [name, setName]           = useState('')
  const [file, setFile]           = useState<File | null>(null)
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/operator/orgs').then(r => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/operator/orgs/${orgId}/sign-forms`),
    ])
      .then(async ([orgs, formsRes]) => {
        if (formsRes.status === 401 || formsRes.status === 403) { setForbidden(true); return }
        const match = (orgs?.orgs as { orgId: string; orgName: string }[] | undefined)?.find(o => o.orgId === orgId)
        if (match) setOrgName(match.orgName)
        if (formsRes.ok) setForms((await formsRes.json()).forms)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [orgId])

  function pickFile(f: File | undefined) {
    setError('')
    if (!f) return
    if (f.type !== 'application/pdf') { setError('Only PDF documents can be used.'); return }
    if (f.size > MAX_MB * 1024 * 1024) { setError(`File too large. Max ${MAX_MB} MB.`); return }
    setFile(f)
    if (!name.trim()) setName(f.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim())
  }

  async function createForm() {
    setError('')
    if (!name.trim()) { setError('Give the form a name.'); return }
    if (!file) { setError('Choose the sample PDF from the company.'); return }

    setBusy(true)
    try {
      const { readPdfInfo } = await import('./pdf-info')
      const info = await readPdfInfo(file).catch(() => null)
      if (!info) { setError('That PDF could not be read. Is it damaged or password protected?'); return }

      const presign = await fetch(`/api/operator/orgs/${orgId}/sign-forms/sample`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentLength: file.size }),
      })
      const presigned = await presign.json().catch(() => ({}))
      if (!presign.ok) { setError(presigned.error ?? 'Could not prepare the upload.'); return }

      const put = await fetch(presigned.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: file })
      if (!put.ok) { setError('The upload failed. Please try again.'); return }

      const created = await fetch(`/api/operator/orgs/${orgId}/sign-forms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formId: presigned.formId, name: name.trim(), ...info }),
      })
      const data = await created.json().catch(() => ({}))
      if (!created.ok) { setError(data.error ?? 'Could not create the form.'); return }

      router.push(`/operator/orgs/${orgId}/sign-forms/${data.formId}`)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="rounded-2xl border border-black/[0.06] h-64 animate-pulse bg-gray-50" />

  if (forbidden) {
    return (
      <div className="rounded-2xl border border-black/[0.06] py-20 text-center">
        <p className="text-[15px] font-semibold text-black mb-1">Not authorized</p>
        <p className="text-[13px] text-gray-400">This page is restricted to platform operators.</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <Link href={`/operator/orgs/${orgId}`} className="text-[12px] font-medium text-gray-400 hover:text-black">
        ← Back to {orgName || 'organisation'}
      </Link>

      <div className="mt-4 mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-1">
          {orgName || orgId} · TheoFlow Sign
        </p>
        <h1 className="font-display text-[2.1rem] leading-tight text-black">Sign forms</h1>
        <p className="text-[13px] text-gray-400 mt-1">
          Set up each form once: where the signer initials, signs, dates and says where they signed.
          Every time this customer sends that form, the system already knows what to ask for.
        </p>
      </div>

      {forms.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/[0.15] px-5 py-8 text-center mb-8">
          <p className="text-[13px] text-gray-400">No forms set up yet for this customer.</p>
        </div>
      ) : (
        <div className="space-y-2.5 mb-8">
          {forms.map(f => (
            <Link key={f.formId} href={`/operator/orgs/${orgId}/sign-forms/${f.formId}`}
                  className="block rounded-2xl border border-black/[0.08] px-5 py-4 hover:border-black/[0.25] transition-colors">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-black truncate">{f.name}</p>
                  <p className="text-[12px] text-gray-400 mt-0.5">
                    {f.pageCount} page{f.pageCount !== 1 ? 's' : ''} · {f.fieldCount} box{f.fieldCount !== 1 ? 'es' : ''} ·
                    {' '}{f.roles.length ? f.roles.join(', ') : 'no roles'} · version {f.currentVersion}
                  </p>
                </div>
                <span className={`flex-shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                  f.valid ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                  {f.valid ? 'Ready to send' : 'Needs work'}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-black/[0.08] px-5 py-5">
        <h2 className="text-[15px] font-semibold text-black mb-1">Add a form</h2>
        <p className="text-[12px] text-gray-400 mb-4">
          Upload a blank copy of the company's document, with no real person's details on it. It is stored only so you can see the pages while you set the form up, and it is deleted with the form.
        </p>

        {error && (
          <div role="alert" className="mb-4 px-4 py-3 rounded-xl text-red-600 text-[13px] bg-red-50 border border-red-200">{error}</div>
        )}

        <label className="block text-[12px] font-medium text-gray-500 mb-1.5" htmlFor="form-name">Form name</label>
        <input id="form-name" value={name} onChange={e => setName(e.target.value)} maxLength={80}
               placeholder="For example: New AOA"
               className="w-full rounded-xl border border-black/[0.12] px-3.5 py-2.5 text-[14px] mb-4 focus:outline-none focus:border-black/40" />

        <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
               onChange={e => pickFile(e.target.files?.[0])} />
        <button type="button" onClick={() => fileRef.current?.click()}
                className="w-full rounded-xl border border-dashed border-black/[0.2] px-4 py-5 text-[13px] text-gray-500 hover:border-black/40 transition-colors mb-4">
          {file ? file.name : 'Choose the sample PDF'}
        </button>

        <button type="button" onClick={createForm} disabled={busy}
                className="rounded-full bg-black text-white text-[13px] font-semibold px-6 py-2.5 disabled:opacity-50">
          {busy ? 'Setting up…' : 'Continue to the editor'}
        </button>
      </div>
    </div>
  )
}
