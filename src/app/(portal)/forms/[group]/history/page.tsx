'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useOrg } from '@/lib/org-context'
import type { ForgeStatus } from '@/lib/forms-types'

interface VersionRow {
  version:         number
  status:          ForgeStatus
  processingStage: string | null
  errorMessage:    string | null
  fieldCount:      number
  brandingSource:  string | null
  createdAt:       string
  updatedAt:       string
  sourceS3Key:     string
  published:       boolean
}

// Mirrors fn-00-template-analyser's 6-stage pipeline (Module 8).
const STAGE_ORDER = ['QUEUED', 'OCR', 'STRUCTURING', 'DOCUMENT_INTELLIGENCE', 'FIELD_INFERENCE', 'LLM', 'VALIDATION']
const STAGE_LABELS: Record<string, string> = {
  QUEUED:                'Queued',
  OCR:                   'Reading document',
  STRUCTURING:           'Structuring fields',
  DOCUMENT_INTELLIGENCE: 'Assessing complexity',
  FIELD_INFERENCE:       'Inferring field types',
  LLM:                   'Resolving ambiguous fields',
  VALIDATION:            'Validating schema',
}

function StageProgress({ stage }: { stage: string | null }) {
  const idx = stage ? STAGE_ORDER.indexOf(stage) : 0
  const pct = idx < 0 ? 8 : Math.round(((idx + 1) / STAGE_ORDER.length) * 100)
  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0"/>
        <p className="text-[11px] font-medium text-amber-700">
          {stage && STAGE_LABELS[stage] ? STAGE_LABELS[stage] : 'Analysing'}
        </p>
      </div>
      <div className="h-[2px] w-40 bg-amber-100 rounded-full overflow-hidden">
        <div className="h-full bg-amber-400 rounded-full transition-all duration-700" style={{ width: `${pct}%` }}/>
      </div>
    </div>
  )
}

// Versions migrated from before per-version history existed (Module 7) never
// had a created_at recorded -- show that plainly instead of "Invalid Date".
function formatForgedDate(createdAt: string): string {
  if (!createdAt) return 'date unknown'
  const d = new Date(createdAt)
  return Number.isNaN(d.getTime()) ? 'date unknown' : d.toLocaleString()
}

// Different uploads to the same group can look identical at a glance
// (same field count, forged minutes apart) -- the source filename is the
// one thing that reliably tells versions of genuinely different documents
// apart, so every row shows it rather than just a version number.
function filenameFromKey(sourceS3Key: string): string {
  if (!sourceS3Key) return 'unknown file'
  return sourceS3Key.split('/').pop() || 'unknown file'
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
  if (status === 'NEEDS_REVIEW') return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1
                     rounded-full bg-amber-50 text-amber-700">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500"/>Needs review
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1
                     rounded-full bg-red-50 text-red-600">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500"/>Error
    </span>
  )
}

function VersionRow({ v, group, onPublish, publishing }: {
  v:          VersionRow
  group:      string
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
          {/* Only something actually published earns the word "Version" --
              everything else is a draft attempt, whether it succeeded or not. */}
          {v.published ? `Version ${v.version}` : `Draft ${v.version}`}
          {v.published && (
            <span className="ml-2 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
              Published
            </span>
          )}
        </p>
        <p className="text-[12px] font-medium text-gray-600 mt-0.5 truncate">
          {filenameFromKey(v.sourceS3Key)}
        </p>
        <p className="text-[12px] text-gray-400 mt-0.5">
          {v.fieldCount} field{v.fieldCount !== 1 ? 's' : ''} · forged {formatForgedDate(v.createdAt)}
          {v.brandingSource === 'extracted' && ' · branding detected'}
        </p>
        {v.status === 'ANALYZING' && <StageProgress stage={v.processingStage}/>}
        {v.status === 'ERROR' && (
          <p className="text-[12px] text-red-600 mt-1.5">
            {v.errorMessage || 'Something went wrong while analysing this template.'}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 flex-shrink-0 self-start">
        <StatusPill status={v.status}/>
        {v.status === 'NEEDS_REVIEW' && (
          <Link
            href={`/forms/${group}/review/${v.version}`}
            className="text-[12px] font-semibold px-4 py-2 rounded-full bg-black text-white
                       hover:bg-gray-800 transition-colors whitespace-nowrap"
          >
            Review →
          </Link>
        )}
        {v.status === 'READY' && (
          <Link
            href={`/forms/${group}/preview/${v.version}`}
            className="text-[12px] font-semibold px-4 py-2 rounded-full border border-black/[0.12]
                       text-gray-700 hover:border-black hover:text-black transition-colors whitespace-nowrap"
          >
            Preview
          </Link>
        )}
        {!v.published && v.status === 'READY' && (
          <button
            onClick={() => onPublish(v.version)}
            disabled={publishing !== null}
            className="text-[12px] font-semibold px-4 py-2 rounded-full bg-black text-white
                       hover:bg-gray-800 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {publishing === v.version ? 'Publishing…' : 'Publish this draft'}
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
  // Failed forge attempts are noise once a group has a working draft --
  // keep them out of the way by default, but never make them unreachable.
  const [showErrors, setShowErrors] = useState(false)

  const load = useCallback((showLoading = true) => {
    if (showLoading) setLoading(true)
    return fetch(`/api/forms/${group}/versions`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setVersions(d.versions); return d as { versions: VersionRow[] } | null })
      .catch(() => null)
      .finally(() => { if (showLoading) setLoading(false) })
  }, [group])

  useEffect(() => { load() }, [load])

  // Poll silently (no skeleton flash) while any version is still analysing —
  // this is what actually shows the pipeline stages progressing, matching
  // the equivalent live-polling pattern on the Decode status page.
  useEffect(() => {
    if (!versions.some(v => v.status === 'ANALYZING')) return
    const t = setInterval(() => { load(false) }, 5000)
    return () => clearInterval(t)
  }, [versions, load])

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

  const groupLabel  = formGroups.find(fg => fg.group === group)?.groupLabel ?? group
  const errorCount  = versions.filter(v => v.status === 'ERROR').length
  const visibleVersions = showErrors ? versions : versions.filter(v => v.status !== 'ERROR')

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
          Every forge attempt is kept as a draft. Preview one, then publish it to make it live on Channel.
        </p>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-3 mb-4 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {versions.length === 0 ? (
        <div className="rounded-2xl border border-black/[0.06] py-20 text-center">
          <p className="text-[15px] font-semibold text-black mb-1">No history yet</p>
          <p className="text-[13px] text-gray-400">Upload a template on the Templates page to forge the first draft.</p>
        </div>
      ) : (
        <>
          {errorCount > 0 && (
            <button
              onClick={() => setShowErrors(s => !s)}
              className="text-[12px] font-medium text-gray-400 hover:text-black transition-colors mb-3"
            >
              {showErrors
                ? 'Hide failed attempts'
                : `${errorCount} failed attempt${errorCount !== 1 ? 's' : ''} hidden — show`}
            </button>
          )}

          {visibleVersions.length === 0 ? (
            <div className="rounded-2xl border border-black/[0.06] py-20 text-center">
              <p className="text-[15px] font-semibold text-black mb-1">Every attempt so far has failed</p>
              <p className="text-[13px] text-gray-400">Upload a different file, or show the failed attempts above for details.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleVersions.map(v => (
                <VersionRow key={v.version} v={v} group={group} onPublish={handlePublish} publishing={publishing}/>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
