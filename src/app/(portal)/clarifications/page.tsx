'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'

interface ClarificationItem {
  documentId:     string
  submissionId:   string
  fieldKey:       string
  extractedValue: string
  documentType:   string
  reviewedAt:     string
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function ClarificationsPage() {
  const [items, setItems]     = useState<ClarificationItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/clarifications')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setItems(d.items))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-16 rounded-2xl border border-black/[0.06] animate-pulse bg-gray-50" />
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-1">
          TheoFlow Decode
        </p>
        <h1 className="font-display text-[2.1rem] leading-tight text-black">Waiting on client</h1>
        <p className="text-[13px] text-gray-400 mt-1">
          {items.length} field{items.length !== 1 ? 's' : ''} flagged for clarification — a reviewer couldn&apos;t
          resolve these themselves; the source document is incomplete until the submitter answers.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-black/[0.06] py-20 text-center">
          <p className="text-[15px] font-semibold text-black mb-1">Nothing waiting</p>
          <p className="text-[13px] text-gray-400">Every flagged field has been resolved or re-reviewed.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-black/[0.08] overflow-hidden">
          <table className="hidden sm:table w-full text-sm">
            <thead>
              <tr className="border-b border-black/[0.06]" style={{ background: 'rgba(0,0,0,0.02)' }}>
                {['Field', 'Document', 'Flagged on', 'Reference'].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {items.map(item => (
                <tr key={`${item.submissionId}-${item.fieldKey}`} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-5 py-3.5">
                    <p className="text-[13px] font-medium text-black">{item.fieldKey}</p>
                    {item.extractedValue && (
                      <p className="text-[11px] text-gray-400 mt-0.5">extracted: {item.extractedValue}</p>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-[13px] text-gray-600">{item.documentType}</td>
                  <td className="px-5 py-3.5 text-[13px] text-gray-400">{fmtDate(item.reviewedAt)}</td>
                  <td className="px-5 py-3.5">
                    <Link href={`/status/${item.documentId}`}
                      className="text-[12px] font-medium text-black hover:text-gray-400 transition-colors">
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="sm:hidden divide-y divide-black/[0.04]">
            {items.map(item => (
              <Link key={`${item.submissionId}-${item.fieldKey}`} href={`/status/${item.documentId}`}
                className="flex items-center gap-4 px-4 py-4 hover:bg-gray-50">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-black truncate">{item.fieldKey}</p>
                  <p className="text-[12px] text-gray-400">{item.documentType} · {fmtDate(item.reviewedAt)}</p>
                </div>
                <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
