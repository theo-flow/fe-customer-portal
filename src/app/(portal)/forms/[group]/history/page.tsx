'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useOrg } from '@/lib/org-context'

interface VersionRow {
  version:        number
  status:         'ANALYZING' | 'READY' | 'ERROR'
  fieldCount:      number
  brandingSource:  string | null
  createdAt:       string
  updatedAt:       string
  sourceS3Key:     string
  published:       boolean
}

// Versions migrated from before per-version history existed (Module 7) never
// had a created_at recorded -- show that plainly instead of "Invalid Date".
function formatForgedDate(createdAt: string): string {
  if (!createdAt) return 'date unknown'
  const d = new Date(createdAt)
  return Number.isNaN(d.getTime()) ? 'date unknown' : d.toLocaleString()
}

function StatusPill({ status }: { status: string }) {
  if (status === 'READY') return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1
                     rounded-full bg-green-50 text-green-700">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500"/>Ready
    </span>
  )
  if (status === 'ANALYZING') return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1
                     rounded-full bg-amber-50 text-amber-700">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"/>Analysing
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1
                     rounded-full bg-red-50 text-red-600">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500"/>Error
    </span>
  )
}

function VersionRow({ v, onPublish, publishing }: {
  v:          VersionRow
  onPublish:  (version: number) => void
  publishing: number | null
}) {
  return (
    <div className={`rounded-2xl border px-5 py-4 flex items-center gap-4
                     ${v.published ? 'border-indigo-200 bg-indigo-50/40' : 'border-black/[0.06]'}`}>
      <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center bg-gray-100">
        <span className="text-[13px] font-semibold text-gray-500">v{v.version}</span>
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-black">
          Version {v.version}
          {v.published && (
            <span className="ml-2 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
              Published
            </span>
          )}
        </p>
        <p className="text-[12px] text-gray-400 mt-0.5">
          {v.fieldCount} field{v.fieldCount !== 1 ? 's' : ''} · forged {formatForgedDate(v.createdAt)}
          {v.brandingSource === 'extracted' && ' · branding detected'}
        </p>
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        <StatusPill status={v.status}/>
        {!v.published && v.status === 'READY' && (
          <button
            onClick={() => onPublish(v.version)}
            disabled={publishing !== null}
            className="text-[12px] font-semibold px-4 py-2 rounded-full bg-black text-white
                       hover:bg-gray-800 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {publishing === v.version ? 'Publishing…' : 'Publish this version'}
          </button>
        )}
      </div>
    </div>
  )
}

export default function VersionHistoryPage({ params }: { params: { group: string } }) {
  const { formGroups, loading: orgLoading } = useOrg()
  const { group } = params

  const [versions, setVersions]     = useState<VersionRow[]>([])
  const [loading, setLoading]       = useState(true)
  const [publishing, setPublishing] = useState<number | null>(null)
  const [error, setError]           = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/forms/${group}/versions`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setVersions(d.versions))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [group])

  useEffect(() => { load() }, [load])

  async function handlePublish(version: number) {
    setError(null)
    setPublishing(version)
    try {
      const res = await fetch(`/api/forms/${group}/publish`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ version }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Failed to publish this version.')
      } else {
        load()
      }
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setPublishing(null)
    }
  }

  const groupLabel = formGroups.find(fg => fg.group === group)?.groupLabel ?? group

  if (orgLoading || loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-[72px] rounded-2xl border border-black/[0.06] animate-pulse bg-gray-50"/>
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <Link href="/forms" className="text-[12px] font-medium text-gray-400 hover:text-black transition-colors">
          ← Back to forms
        </Link>
        <h1 className="font-display text-[2.1rem] leading-tight text-black mt-2">{groupLabel} — history</h1>
        <p className="text-[13px] text-gray-400 mt-1">
          Every forge of this form is kept. Choose which version is live on Channel.
        </p>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-3 mb-4 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {versions.length === 0 ? (
        <div className="rounded-2xl border border-black/[0.06] py-20 text-center">
          <p className="text-[15px] font-semibold text-black mb-1">No versions yet</p>
          <p className="text-[13px] text-gray-400">Upload a template on the Templates page to forge the first version.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {versions.map(v => (
            <VersionRow key={v.version} v={v} onPublish={handlePublish} publishing={publishing}/>
          ))}
        </div>
      )}
    </div>
  )
}
