'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useOrg } from '@/lib/org-context'
import { fmtDate, fmtTime } from '@/lib/format'

interface Submission {
  submissionId: string
  group:        string
  groupLabel:   string
  submittedAt:  string
  status:       string
}

export default function SubmissionsPage() {
  const router = useRouter()
  const { orgName, loading: orgLoading } = useOrg()
  const [submissions, setSubmissions]    = useState<Submission[]>([])
  const [loading, setLoading]            = useState(true)

  useEffect(() => {
    fetch('/api/submissions')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setSubmissions(d.submissions))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (orgLoading || loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i}
               className="h-16 rounded-2xl border border-black/[0.06] animate-pulse bg-gray-50"/>
        ))}
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-1">
          {orgName} · TheoFlow Harvest
        </p>
        <h1 className="font-display text-[2.1rem] leading-tight text-black">Submissions</h1>
        <p className="text-[13px] text-gray-400 mt-1">
          {submissions.length} submission{submissions.length !== 1 ? 's' : ''} received
        </p>
      </div>

      {submissions.length === 0 ? (
        <div className="rounded-2xl border border-black/[0.06] py-20 text-center">
          <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-gray-300" fill="none" viewBox="0 0 24 24"
                 stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round"
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0
                       012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2
                       2 0 012 2v2M7 7h10"/>
            </svg>
          </div>
          <p className="text-[15px] font-semibold text-black mb-1">No submissions yet</p>
          <p className="text-[13px] text-gray-400">
            Share your form links and submissions will appear here.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-black/[0.08] overflow-hidden">
          {/* Desktop table */}
          <table className="hidden sm:table w-full text-sm">
            <thead>
              <tr className="border-b border-black/[0.06]"
                  style={{ background: 'rgba(0,0,0,0.02)' }}>
                {['Form', 'Date', 'Time', 'Reference'].map(h => (
                  <th key={h}
                      className="text-left px-5 py-3 text-[11px] font-semibold text-gray-400
                                 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {submissions.map(sub => (
                <tr key={sub.submissionId}
                    onClick={() => router.push(`/submissions/${sub.submissionId}`)}
                    className="hover:bg-gray-50/60 transition-colors cursor-pointer">
                  <td className="px-5 py-3.5">
                    <p className="text-[13px] font-medium text-black">{sub.groupLabel}</p>
                    <p className="text-[11px] text-gray-400 uppercase tracking-wide mt-0.5">
                      {sub.group}
                    </p>
                  </td>
                  <td className="px-5 py-3.5 text-[13px] text-gray-600">
                    {fmtDate(sub.submittedAt)}
                  </td>
                  <td className="px-5 py-3.5 text-[13px] text-gray-400">
                    {fmtTime(sub.submittedAt)}
                  </td>
                  <td className="px-5 py-3.5 font-mono text-[11px] text-gray-400">
                    {sub.submissionId.slice(0, 8)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Mobile list */}
          <div className="sm:hidden divide-y divide-black/[0.04]">
            {submissions.map(sub => (
              <Link key={sub.submissionId} href={`/submissions/${sub.submissionId}`}
                    className="block px-4 py-4 active:bg-gray-50/60 transition-colors">
                <p className="text-[14px] font-semibold text-black">{sub.groupLabel}</p>
                <p className="text-[12px] text-gray-400 mt-0.5">
                  {fmtDate(sub.submittedAt)} at {fmtTime(sub.submittedAt)}
                </p>
                <p className="font-mono text-[11px] text-gray-300 mt-1">
                  {sub.submissionId.slice(0, 8)}…
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
