'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useOrg } from '@/lib/org-context'
import type { ForgeStatus } from '@/lib/forms-types'

interface FormSchema {
  group:            string
  groupLabel:       string
  status:           ForgeStatus | 'DRAFT'
  fieldCount:        number
  updatedAt:         string
  latestVersion:     number
  publishedVersion:  number | null
  errorMessage:      string | null
  processingStage:   string | null
  needsReviewCount:  number | null
}

// ── Status pill ───────────────────────────────────────────────────────────────

function SchemaStatus({ status }: { status: string }) {
  if (status === 'READY') return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1
                     rounded-full bg-green-50 text-green-700">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500"/>Published
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
  if (status === 'DRAFT') return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1
                     rounded-full bg-gray-100 text-gray-500">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400"/>Not published
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1
                     rounded-full bg-red-50 text-red-600">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500"/>Error
    </span>
  )
}

// ── Form group row ────────────────────────────────────────────────────────────

function GroupRow({ group, groupLabel, schema, orgId }: {
  group:      string
  groupLabel: string
  schema?:    FormSchema
  orgId:      string
}) {
  const [copied, setCopied] = useState(false)
  const isReady = schema?.status === 'READY'

  function copyLink() {
    const url = `${window.location.origin}/fill/${orgId}/${group}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className={`rounded-2xl border px-5 py-4 flex items-center gap-4 transition-all
                     ${isReady ? 'border-black/[0.1] hover:border-black/[0.18]'
                               : 'border-black/[0.06]'}`}>

      {/* Icon */}
      <div className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center
                       ${isReady ? 'bg-indigo-50' : 'bg-gray-100'}`}>
        <svg className={`w-5 h-5 ${isReady ? 'text-indigo-500' : 'text-gray-300'}`}
             fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0
                   01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z"/>
        </svg>
      </div>

      {/* Label + meta */}
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-black">{groupLabel}</p>
        <p className="text-[12px] text-gray-400 mt-0.5">
          {!schema
            ? 'No template uploaded yet'
            : isReady
              ? `${schema.fieldCount} field${schema.fieldCount !== 1 ? 's' : ''}`
              : schema.status === 'ERROR'
                ? <span className="text-red-600">{schema.errorMessage || 'Something went wrong while analysing this template.'}</span>
                : schema.status === 'NEEDS_REVIEW'
                  ? <span className="text-amber-700">{schema.needsReviewCount} field{schema.needsReviewCount !== 1 ? 's' : ''} need review</span>
                  : schema.status === 'ANALYZING'
                    ? 'Analysing…'
                    : `v${schema.latestVersion} forged — not yet published`}
          {isReady && (
            <button onClick={copyLink}
                    className="ml-3 text-indigo-500 hover:text-indigo-700 font-medium transition-colors">
              {copied ? '✓ Link copied' : 'Copy share link'}
            </button>
          )}
        </p>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {schema ? (
          <>
            <SchemaStatus status={schema.status}/>
            {schema.status === 'ERROR' && (
              <Link href="/templates"
                    className="text-[12px] font-semibold px-4 py-2 rounded-full bg-black text-white
                               hover:bg-gray-800 transition-colors whitespace-nowrap">
                Upload new file →
              </Link>
            )}
            {schema.status === 'NEEDS_REVIEW' && (
              <Link href={`/forms/${group}/review/${schema.latestVersion}`}
                    className="text-[12px] font-semibold px-4 py-2 rounded-full bg-black text-white
                               hover:bg-gray-800 transition-colors whitespace-nowrap">
                Review →
              </Link>
            )}
            {schema.latestVersion > 0 && (
              <Link href={`/forms/${group}/history`}
                    className="text-[12px] font-medium text-gray-400 hover:text-black transition-colors whitespace-nowrap">
                History →
              </Link>
            )}
            {isReady && (
              <Link href={`/fill/${orgId}/${group}`} target="_blank"
                    className="text-[12px] font-medium text-black hover:text-gray-500 transition-colors whitespace-nowrap">
                Preview →
              </Link>
            )}
          </>
        ) : (
          <Link href="/templates"
                className="text-[12px] font-semibold px-4 py-2 rounded-full bg-black
                           text-white hover:bg-gray-800 transition-colors whitespace-nowrap">
            Upload template
          </Link>
        )}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FormsPage() {
  const { orgId, orgName, formGroups, loading: orgLoading } = useOrg()
  const [schemas, setSchemas]         = useState<FormSchema[]>([])
  const [loadingSchemas, setLoading]  = useState(true)

  useEffect(() => {
    fetch('/api/forms')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setSchemas(d.forms))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const schemaMap = Object.fromEntries(schemas.map(s => [s.group, s]))
  // /api/forms returns every SCHEMA# pointer for the org, which can include
  // orphaned groups left over from earlier form-group configurations that
  // are no longer in the org's current formGroups list -- only count READY
  // schemas that still belong to a current group, or this diverges from the
  // "X of Y" denominator (Y = formGroups.length) and produces a nonsensical
  // count like "5 of 3".
  const currentGroupKeys = new Set(formGroups.map(fg => fg.group))
  const readyCount = schemas.filter(s => s.status === 'READY' && currentGroupKeys.has(s.group)).length

  if (orgLoading || loadingSchemas) {
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
      {/* Header */}
      <div className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-1">
          {orgName} · TheoFlow Channel
        </p>
        <h1 className="font-display text-[2.1rem] leading-tight text-black">Your forms</h1>
        <p className="text-[13px] text-gray-400 mt-1">
          {readyCount} of {formGroups.length} form group{formGroups.length !== 1 ? 's' : ''} published
        </p>
      </div>

      {/* How it works banner — shown when no forms ready yet */}
      {readyCount === 0 && formGroups.length > 0 && (
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-5 py-4 mb-6
                        flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24"
                 stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-indigo-900 mb-0.5">How TheoFlow Channel works</p>
            <p className="text-[12px] text-indigo-700 leading-relaxed">
              Upload a blank PDF template for each form group using TheoFlow Forge. Once analysed, a
              shareable link appears here that anyone can use to fill and submit the form — no account required.
            </p>
          </div>
        </div>
      )}

      {/* Form group list */}
      {formGroups.length === 0 ? (
        <div className="rounded-2xl border border-black/[0.06] py-20 text-center">
          <p className="text-[15px] font-semibold text-black mb-1">No form groups configured</p>
          <p className="text-[13px] text-gray-400">Contact your administrator.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {formGroups.map(fg => (
            <GroupRow
              key={fg.group}
              group={fg.group}
              groupLabel={fg.groupLabel}
              schema={schemaMap[fg.group]}
              orgId={orgId}
            />
          ))}
        </div>
      )}
    </div>
  )
}
