'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { StatusBadge } from '@/components/StatusBadge'

interface Doc {
  docId:     string
  product:   string
  docType:   string
  filename:  string
  status:    'pending' | 'received' | 'processing' | 'complete' | 'failed'
  createdAt: string
}

interface Summary { items: Doc[]; total: number; processing: number; complete: number; failed: number }

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function DashboardPage() {
  const [data,    setData]    = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    fetch('/api/documents')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: Summary) => setData(d))
      .catch(() => setError('Could not load documents.'))
      .finally(() => setLoading(false))
  }, [])

  const stats = [
    { label: 'Total',      value: data?.total      ?? 0 },
    { label: 'In progress',value: data?.processing  ?? 0 },
    { label: 'Complete',   value: data?.complete    ?? 0 },
    { label: 'Failed',     value: data?.failed      ?? 0 },
  ]

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-0.5">
            My documents
          </p>
          <h1 className="font-display text-[1.8rem] sm:text-[2.1rem] leading-tight text-black">
            Submissions
          </h1>
        </div>
        <Link href="/upload"
          className="flex-shrink-0 flex items-center gap-2 bg-black text-white
                     text-[13px] font-medium px-5 py-2.5 rounded-full
                     hover:bg-gray-900 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"
               stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
          </svg>
          <span className="hidden sm:inline">Upload</span>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {stats.map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-black/[0.08] px-4 py-4">
            <p className="font-display text-[1.8rem] leading-none text-black">
              {loading ? '—' : s.value}
            </p>
            <p className="text-[12px] text-gray-400 mt-1.5">{s.label}</p>
          </div>
        ))}
      </div>

      {error && (
        <p className="text-[13px] text-red-500 mb-4">{error}</p>
      )}

      {/* Empty state */}
      {!loading && !error && data?.total === 0 && (
        <div className="bg-white rounded-2xl border border-black/[0.08] flex flex-col
                        items-center justify-center py-20 px-6 text-center">
          <div className="w-12 h-12 rounded-xl border border-black/[0.08] bg-gray-50
                          flex items-center justify-center mb-4">
            <svg className="w-5 h-5 text-gray-300" fill="none" viewBox="0 0 24 24"
                 stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125
                   0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12H9m1.5-12H5.625
                   c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621
                   0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>
            </svg>
          </div>
          <p className="text-[15px] font-semibold text-black mb-1">No documents yet</p>
          <p className="text-[13px] text-gray-400 mb-6 max-w-xs">
            Upload your first form and it will appear here.
          </p>
          <Link href="/upload"
            className="px-6 py-2.5 bg-black text-white text-[13px] font-medium
                       rounded-full hover:bg-gray-900 transition-colors">
            Upload a document
          </Link>
        </div>
      )}

      {/* Submissions table */}
      {!loading && data && data.total > 0 && (
        <div className="bg-white rounded-2xl border border-black/[0.08] overflow-hidden">

          {/* Desktop table */}
          <table className="hidden sm:table w-full text-sm">
            <thead>
              <tr className="border-b border-black/[0.06]" style={{ background: 'rgba(0,0,0,0.02)' }}>
                <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Reference</th>
                <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Document</th>
                <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Uploaded</th>
                <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                <th className="px-5 py-3.5"/>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {data.items.map(doc => (
                <tr key={doc.docId} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-5 py-4 font-mono text-[12px] text-gray-500">{doc.docId}</td>
                  <td className="px-5 py-4">
                    <p className="text-[13px] font-medium text-black">{doc.product}</p>
                    <p className="text-[12px] text-gray-400">{doc.docType}</p>
                  </td>
                  <td className="px-5 py-4 text-[13px] text-gray-400">{fmtDate(doc.createdAt)}</td>
                  <td className="px-5 py-4"><StatusBadge status={doc.status}/></td>
                  <td className="px-5 py-4 text-right">
                    <Link href={`/status/${doc.docId}`}
                      className="text-[12px] font-medium text-black hover:text-gray-500 transition-colors">
                      {doc.status === 'complete' ? 'View →' : 'Track →'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Mobile card list */}
          <div className="sm:hidden divide-y divide-black/[0.04]">
            {data.items.map(doc => (
              <Link key={doc.docId} href={`/status/${doc.docId}`}
                className="flex items-center gap-4 px-4 py-4 hover:bg-gray-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-black truncate mb-0.5">{doc.product}</p>
                  <p className="text-[12px] text-gray-400">{doc.docType}</p>
                  <p className="font-mono text-[11px] text-gray-400 mt-1">{doc.docId}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{fmtDate(doc.createdAt)}</p>
                  <div className="mt-2"><StatusBadge status={doc.status}/></div>
                </div>
                <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none"
                     viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                </svg>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="bg-white rounded-2xl border border-black/[0.08] overflow-hidden">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex gap-4 px-5 py-4 border-b border-black/[0.04]">
              <div className="h-4 bg-gray-100 rounded animate-pulse w-40"/>
              <div className="h-4 bg-gray-100 rounded animate-pulse flex-1"/>
              <div className="h-4 bg-gray-100 rounded animate-pulse w-24"/>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
