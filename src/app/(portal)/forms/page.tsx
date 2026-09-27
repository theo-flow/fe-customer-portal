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

// ── Published form row ────────────────────────────────────────────────────────
// Only published forms are listed here. Uploading, previewing, reviewing and
// publishing a form all happen on the Templates page.

function PublishedRow({ schema, orgId }: { schema: FormSchema; orgId: string }) {
  const [copied, setCopied] = useState(false)
  const { group, groupLabel, fieldCount } = schema

  function copyLink() {
    const url = `${window.location.origin}/fill/${orgId}/${group}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="rounded-2xl border border-black/[0.1] hover:border-black/[0.18] px-5 py-4
                    flex items-center gap-4 transition-all">

      {/* Icon */}
      <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center bg-indigo-50">
        <svg className="w-5 h-5 text-indigo-500"
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
          {fieldCount} field{fieldCount !== 1 ? 's' : ''}
          <button onClick={copyLink}
                  className="ml-3 text-indigo-500 hover:text-indigo-700 font-medium transition-colors">
            {copied ? '✓ Link copied' : 'Copy share link'}
          </button>
        </p>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1
                         rounded-full bg-green-50 text-green-700">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500"/>Published
        </span>
        <Link href={`/forms/${group}/recipients`}
              className="text-[12px] font-medium text-gray-400 hover:text-black transition-colors whitespace-nowrap">
          Recipients →
        </Link>
        <Link href={`/fill/${orgId}/${group}`} target="_blank"
              className="text-[12px] font-medium text-black hover:text-gray-500 transition-colors whitespace-nowrap">
          Open form →
        </Link>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FormsPage() {
  const { orgId, orgName, formGroups, loading: orgLoading } = useOrg()
  const [schemas, setSchemas]         = useState<FormSchema[]>([])
  const [loadingSchemas, setLoading]  = useState(true)

  function loadSchemas() {
    return fetch('/api/forms')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setSchemas(d.forms))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadSchemas() }, [])

  // /api/forms returns every SCHEMA# pointer for the org, which can include
  // orphaned groups left over from earlier form-group configurations that
  // are no longer in the org's current formGroups list -- only list published
  // schemas that still belong to a current group, in the org's group order.
  const schemaMap = Object.fromEntries(schemas.map(s => [s.group, s]))
  const published = formGroups
    .map(fg => schemaMap[fg.group])
    .filter((s): s is FormSchema => s != null && s.publishedVersion != null)

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
          {published.length} published form{published.length !== 1 ? 's' : ''}
        </p>
      </div>

      {published.length === 0 ? (
        <div className="rounded-2xl border border-black/[0.06] py-20 text-center">
          <p className="text-[15px] font-semibold text-black mb-1">No published forms yet</p>
          <p className="text-[13px] text-gray-400 mb-6">
            Upload a blank template, preview it and publish it. It will then appear here with a link to share.
          </p>
          <Link href="/templates"
                className="text-[12px] font-semibold px-4 py-2 rounded-full bg-black text-white
                           hover:bg-gray-800 transition-colors whitespace-nowrap">
            Go to templates →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {published.map(s => (
            <PublishedRow key={s.group} schema={s} orgId={orgId}/>
          ))}
        </div>
      )}
    </div>
  )
}
