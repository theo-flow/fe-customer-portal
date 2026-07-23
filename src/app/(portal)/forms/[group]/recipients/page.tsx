'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useOrg } from '@/lib/org-context'
import { fmtDate, fmtTime } from '@/lib/format'

interface Recipient {
  recipientId: string
  name:        string
  email:       string | null
  status:      'PENDING' | 'SUBMITTED'
  createdAt:   string
  updatedAt:   string
}

export default function RecipientsPage() {
  const { formGroups } = useOrg()
  const { group } = useParams<{ group: string }>()

  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [loading, setLoading]       = useState(true)

  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [newLink, setNewLink]   = useState<{ name: string; fillUrl: string } | null>(null)
  const [copied, setCopied]     = useState(false)

  const groupLabel = formGroups.find(fg => fg.group === group)?.groupLabel ?? group

  function load() {
    fetch(`/api/forms/${group}/recipients`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setRecipients(d.recipients))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(load, [group])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateError(null)
    if (!name.trim()) { setCreateError('Name is required.'); return }

    setCreating(true)
    try {
      const res = await fetch(`/api/forms/${group}/recipients`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: name.trim(), email: email.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCreateError(data.error ?? 'Failed to generate link.')
        return
      }
      setNewLink({ name: data.name, fillUrl: data.fillUrl })
      setCopied(false)
      setName('')
      setEmail('')
      load()
    } catch {
      setCreateError('Something went wrong — please try again.')
    } finally {
      setCreating(false)
    }
  }

  function copyLink() {
    if (!newLink) return
    navigator.clipboard.writeText(newLink.fillUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div>
      <Link href={`/forms/${group}/history`} className="text-[12px] font-medium text-gray-400 hover:text-black transition-colors">
        ← Back to history
      </Link>

      <div className="mt-4 mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-1">
          {groupLabel} · TheoFlow Channel
        </p>
        <h1 className="font-display text-[2.1rem] leading-tight text-black">Recipients</h1>
        <p className="text-[13px] text-gray-400 mt-1">
          Generate a link tied to one person — send it however you like, and their
          submission will show who it came from.
        </p>
      </div>

      <form onSubmit={handleCreate} className="rounded-2xl border border-black/[0.08] p-5 mb-8">
        <div className="flex flex-col sm:flex-row gap-3 mb-3">
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="Recipient name"
            className="flex-1 px-3 py-2 rounded-lg border border-black/[0.12] text-[13px] outline-none focus:border-black/40"
          />
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="Email (optional)"
            className="flex-1 px-3 py-2 rounded-lg border border-black/[0.12] text-[13px] outline-none focus:border-black/40"
          />
          <button
            type="submit" disabled={creating}
            className="px-5 py-2 rounded-lg bg-black text-white text-[13px] font-semibold
                       hover:bg-gray-800 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {creating ? 'Generating…' : 'Generate link'}
          </button>
        </div>
        {createError && <p className="text-[12px] text-red-500">{createError}</p>}

        {newLink && (
          <div className="mt-2 rounded-xl bg-amber-50 border border-amber-100 px-4 py-3">
            <p className="text-[12px] font-semibold text-amber-800 mb-1">
              Link for {newLink.name} — copy it now, it won&apos;t be shown again
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[11px] text-amber-900 bg-white/60 px-2 py-1.5 rounded-lg truncate">
                {newLink.fillUrl}
              </code>
              <button
                type="button" onClick={copyLink}
                className="text-[11px] font-semibold px-3 py-1.5 rounded-full bg-amber-900 text-white
                           hover:bg-amber-800 transition-colors whitespace-nowrap"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </form>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-14 rounded-2xl border border-black/[0.06] animate-pulse bg-gray-50"/>
          ))}
        </div>
      ) : recipients.length === 0 ? (
        <div className="rounded-2xl border border-black/[0.06] py-16 text-center">
          <p className="text-[15px] font-semibold text-black mb-1">No recipients yet</p>
          <p className="text-[13px] text-gray-400">Generate a link above to get started.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-black/[0.08] divide-y divide-black/[0.04]">
          {recipients.map(r => (
            <div key={r.recipientId} className="flex items-center justify-between gap-4 px-5 py-3.5">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-black truncate">{r.name}</p>
                {r.email && <p className="text-[11px] text-gray-400 truncate">{r.email}</p>}
              </div>
              <div className="flex items-center gap-4 flex-shrink-0">
                <p className="text-[11px] text-gray-400">
                  {fmtDate(r.createdAt)} · {fmtTime(r.createdAt)}
                </p>
                {r.status === 'SUBMITTED' ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1
                                   rounded-full bg-green-50 text-green-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500"/>Submitted
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1
                                   rounded-full bg-gray-100 text-gray-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400"/>Pending
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
