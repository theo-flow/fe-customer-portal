'use client'
import { useState, useRef } from 'react'
import { useOrg } from '@/lib/org-context'

const MAX_MB    = 50
const MAX_BYTES = MAX_MB * 1024 * 1024

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

async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export default function NewSignSessionPage() {
  const { loading: orgLoading } = useOrg()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile]         = useState<File | null>(null)
  const [fileError, setFileError] = useState('')
  const [signerRows, setSignerRows] = useState<SignerRow[]>([{ name: '', email: '', role: '' }])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [signLinks, setSignLinks] = useState<SignerLink[] | null>(null)
  const [copiedLink, setCopiedLink] = useState<string | null>(null)

  function pickFile(f: File) {
    if (f.type !== 'application/pdf') { setFileError('Only PDF documents can be signed.'); return }
    if (f.size > MAX_BYTES) { setFileError(`File too large. Max ${MAX_MB} MB.`); return }
    setFileError('')
    setFile(f)
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

  function copyLink(url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedLink(url)
      setTimeout(() => setCopiedLink(null), 2000)
    })
  }

  async function handleSubmit() {
    setError(null)

    if (!file) { setError('Choose a PDF to sign.'); return }
    const signers = signerRows
      .filter(r => r.name.trim() || r.email.trim())
      .map(r => ({ name: r.name.trim(), email: r.email.trim(), role: r.role.trim() || undefined }))
    if (signers.length === 0) { setError('Add at least one signer.'); return }

    setSubmitting(true)
    try {
      const presignRes = await fetch('/api/sign/upload/presign', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ filename: file.name, contentType: file.type, contentLength: file.size }),
      })
      const presignData = await presignRes.json()
      if (!presignRes.ok) { setError(presignData.error ?? 'Failed to prepare upload.'); return }
      const { sessionId, uploadUrl, key } = presignData

      const putRes = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
      if (!putRes.ok) { setError('Failed to upload document.'); return }

      const sha256 = await sha256Hex(file)

      const sessionRes = await fetch('/api/sign/sessions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          sourceDocument: { sessionId, s3Key: key, sha256, filename: file.name },
          signers,
        }),
      })
      const sessionData = await sessionRes.json()
      if (!sessionRes.ok) { setError(sessionData.error ?? 'Failed to create signing session.'); return }

      setSignLinks(sessionData.signers)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (orgLoading) return null

  if (signLinks) {
    return (
      <div className="max-w-xl">
        <h1 className="font-display text-[2.1rem] leading-tight text-black mb-2">Signing session created</h1>
        <p className="text-[13px] text-gray-400 mb-6">Share these links with each signer:</p>
        <div className="space-y-2">
          {signLinks.map(link => (
            <div key={link.signerId} className="flex items-center justify-between gap-3 bg-gray-50 rounded-xl px-4 py-3">
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
      </div>
    )
  }

  return (
    <div className="max-w-xl">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-1">
        TheoFlow Sign
      </p>
      <h1 className="font-display text-[2.1rem] leading-tight text-black mb-6">New signing session</h1>

      <div
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) pickFile(f) }}
        onClick={() => inputRef.current?.click()}
        className="rounded-2xl border-2 border-dashed border-black/[0.12] p-8 text-center cursor-pointer
                   hover:border-black/25 transition-colors mb-2">
        <input ref={inputRef} type="file" accept="application/pdf" className="hidden"
               onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f) }}/>
        {file ? (
          <p className="text-[14px] font-medium text-black">{file.name}</p>
        ) : (
          <>
            <p className="text-[14px] font-medium text-black mb-1">Drop a PDF here, or click to choose</p>
            <p className="text-[12px] text-gray-400">Max {MAX_MB} MB</p>
          </>
        )}
      </div>
      {fileError && <p className="text-[12px] text-red-500 mb-4">{fileError}</p>}

      <p className="text-[13px] font-semibold text-black mt-6 mb-3">Signers</p>
      <div className="space-y-3">
        {signerRows.map((row, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input
              type="text" placeholder="Signer name" value={row.name}
              onChange={e => updateSignerRow(i, 'name', e.target.value)}
              className="flex-1 px-3 py-2.5 rounded-lg border border-black/[0.12] text-[13px] outline-none focus:border-black/40"
            />
            <input
              type="email" placeholder="Email" value={row.email}
              onChange={e => updateSignerRow(i, 'email', e.target.value)}
              className="flex-1 px-3 py-2.5 rounded-lg border border-black/[0.12] text-[13px] outline-none focus:border-black/40"
            />
            <input
              type="text" placeholder="Role (optional)" value={row.role}
              onChange={e => updateSignerRow(i, 'role', e.target.value)}
              className="w-32 px-3 py-2.5 rounded-lg border border-black/[0.12] text-[13px] outline-none focus:border-black/40"
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
      </div>

      {error && (
        <div className="mt-4 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting}
        className="mt-6 px-6 py-3 rounded-full bg-black text-white text-[13px] font-semibold
                   hover:bg-gray-800 transition-colors disabled:opacity-50">
        {submitting ? 'Creating…' : 'Create signing session'}
      </button>
    </div>
  )
}
