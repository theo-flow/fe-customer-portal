'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useOrg } from '@/lib/org-context'
import { fmtDate, fmtTime } from '@/lib/format'
import ExtractedDataView, { type ExtractionData } from '@/components/ExtractedDataView'

interface SubmissionDetail {
  submissionId: string
  group:        string
  groupLabel:   string
  submittedAt:  string
  status:       string
  extraction:   ExtractionData
}

export default function SubmissionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { orgName, loading: orgLoading } = useOrg()
  const [data,    setData]    = useState<SubmissionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  // Integration Hub sub-phase 4 -- identity-only export, see
  // docs/integration-hub-status-and-next-steps.md for the current scope cut.
  const [exportSubmitting, setExportSubmitting] = useState(false)
  const [exportMessage,    setExportMessage]    = useState<string | null>(null)

  async function triggerExport() {
    setExportMessage(null)
    setExportSubmitting(true)
    try {
      const res = await fetch(`/api/submissions/${id}/export`, { method: 'POST' })
      const body = await res.json()
      setExportMessage(res.ok ? 'Export requested.' : (body.error ?? 'Failed to start export.'))
    } catch {
      setExportMessage('Something went wrong. Please try again.')
    } finally {
      setExportSubmitting(false)
    }
  }

  useEffect(() => {
    fetch(`/api/submissions/${id}`)
      .then(async r => {
        if (!r.ok) {
          setError(r.status === 404
            ? 'Submission not found. The reference ID may be incorrect.'
            : `Could not load submission (${r.status}).`)
          return
        }
        setData(await r.json())
      })
      .catch(() => setError('Could not load submission.'))
      .finally(() => setLoading(false))
  }, [id])

  if (orgLoading || loading) {
    return (
      <div className="space-y-4">
        <div className="h-4 w-24 rounded bg-gray-100 animate-pulse"/>
        <div className="h-24 rounded-2xl border border-black/[0.06] animate-pulse bg-gray-50"/>
        <div className="h-64 rounded-2xl border border-black/[0.06] animate-pulse bg-gray-50"/>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div>
        <Link href="/submissions" className="text-[13px] text-gray-400 hover:text-black transition-colors">
          ← Back to submissions
        </Link>
        <div className="mt-6 rounded-2xl border border-black/[0.06] py-20 text-center">
          <p className="text-[15px] font-semibold text-black mb-1">Submission not found</p>
          <p className="text-[13px] text-gray-400">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Link href="/submissions" className="text-[13px] text-gray-400 hover:text-black transition-colors">
        ← Back to submissions
      </Link>

      <div className="mt-4 mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-1">
          {orgName} · TheoFlow Harvest
        </p>
        <h1 className="font-display text-[2.1rem] leading-tight text-black">{data.groupLabel}</h1>
        <p className="text-[13px] text-gray-400 mt-1">
          Submitted {fmtDate(data.submittedAt)} at {fmtTime(data.submittedAt)}
          {' · '}
          <span className="font-mono">{data.submissionId}</span>
        </p>
      </div>

      <div className="border border-black/[0.08] rounded-2xl p-5 mb-8 space-y-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
          Next steps
        </p>
        <div className="flex gap-3 flex-wrap">
          <button
            type="button"
            onClick={triggerExport}
            disabled={exportSubmitting}
            className="px-5 py-2.5 rounded-full border border-black/[0.12] text-[13px] font-medium
                       text-gray-700 hover:border-black hover:text-black transition-colors disabled:opacity-50">
            {exportSubmitting ? 'Exporting…' : 'Export'}
          </button>
        </div>
        {exportMessage && <p className="text-[12px] text-gray-500">{exportMessage}</p>}
      </div>

      <ExtractedDataView data={data.extraction} />
    </div>
  )
}
