'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useOrg } from '@/lib/org-context'
import { StatusBadge } from '@/components/StatusBadge'

// ── Product tile definitions ──────────────────────────────────────────────────

interface ProductMeta {
  key:         string
  name:        string
  tagline:     string
  description: string
  color:       string   // accent colour used in icon bg
  built:       boolean
  href:        string
  actionLabel: string
}

const PRODUCT_META: ProductMeta[] = [
  {
    key: 'forge', name: 'TheoFlow Forge', tagline: 'Form creation',
    description: 'Convert your blank paper forms into structured digital schemas.',
    color: '#F59E0B', built: true, href: '/templates', actionLabel: 'Manage templates',
  },
  {
    key: 'channel', name: 'TheoFlow Channel', tagline: 'Form publishing',
    description: 'Publish forms and route them to clients, staff, or the public.',
    color: '#6366F1', built: true, href: '/forms', actionLabel: 'Manage forms',
  },
  {
    key: 'harvest', name: 'TheoFlow Harvest', tagline: 'Data collection',
    description: 'Capture structured responses from users at scale.',
    color: '#10B981', built: true, href: '/submissions', actionLabel: 'View submissions',
  },
  {
    key: 'decode', name: 'TheoFlow Decode', tagline: 'Document intelligence',
    description: 'Upload filled paper documents and extract structured data automatically.',
    color: '#3B82F6', built: true, href: '/upload', actionLabel: 'Upload document',
  },
  {
    key: 'sign', name: 'TheoFlow Sign', tagline: 'E-signatures',
    description: 'Request signatures on validated submissions, or sign any document standalone.',
    color: '#EC4899', built: true, href: '/sign', actionLabel: 'Manage signatures',
  },
]

// ── Decode stats (only fetched when decode is subscribed) ─────────────────────

interface Summary { total: number; processing: number; complete: number; failed: number }

function useDecodeStats(enabled: boolean) {
  const [stats, setStats] = useState<Summary | null>(null)
  useEffect(() => {
    if (!enabled) return
    fetch('/api/documents')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setStats(d))
      .catch(() => {})
  }, [enabled])
  return stats
}

// ── Components ────────────────────────────────────────────────────────────────

function ProductCard({ meta, stats }: { meta: ProductMeta; stats?: Summary | null }) {
  const isBuilt = meta.built

  return (
    <div className={`rounded-2xl border overflow-hidden flex flex-col transition-all
                     ${isBuilt
                       ? 'border-black/[0.1] hover:border-black/[0.2] hover:shadow-sm'
                       : 'border-black/[0.06]'}`}>

      {/* Header accent strip */}
      <div className="h-1 w-full flex-shrink-0" style={{ background: meta.color }}/>

      <div className="px-5 py-5 flex flex-col flex-1">
        {/* Title row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] mb-0.5"
               style={{ color: meta.color }}>
              {meta.tagline}
            </p>
            <h2 className="text-[16px] font-semibold text-black leading-snug">{meta.name}</h2>
          </div>
          {!isBuilt && (
            <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide
                             px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">
              Coming soon
            </span>
          )}
        </div>

        <p className="text-[13px] text-gray-500 leading-relaxed mb-4">{meta.description}</p>

        {/* Decode: show live stats */}
        {meta.key === 'decode' && stats && (
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              { label: 'Total',      value: stats.total },
              { label: 'Processing', value: stats.processing },
              { label: 'Complete',   value: stats.complete },
            ].map(s => (
              <div key={s.label} className="rounded-xl bg-gray-50 px-3 py-2.5">
                <p className="font-display text-[1.4rem] leading-none text-black">{s.value}</p>
                <p className="text-[11px] text-gray-400 mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Decode: zero state */}
        {meta.key === 'decode' && !stats && (
          <div className="rounded-xl bg-gray-50 px-4 py-3 mb-4">
            <p className="text-[12px] text-gray-400">
              No documents uploaded yet.
            </p>
          </div>
        )}

        {/* Action button */}
        <div className="mt-auto pt-2">
          {isBuilt ? (
            <Link href={meta.href}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full
                         text-[13px] font-medium text-white transition-colors"
              style={{ background: meta.color }}>
              {meta.actionLabel}
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"
                   stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
              </svg>
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full
                             text-[13px] font-medium text-gray-300 bg-gray-100 cursor-default">
              {meta.actionLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Recent Decode submissions (only when decode subscribed) ───────────────────

interface Doc {
  docId: string; group: string; groupLabel: string
  filename: string; status: 'pending'|'received'|'processing'|'complete'|'failed'; createdAt: string
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

function RecentSubmissions({ docs }: { docs: Doc[] }) {
  if (!docs.length) return null
  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[14px] font-semibold text-black">Recent submissions</h2>
        <Link href="/upload" className="text-[12px] text-gray-400 hover:text-black transition-colors">
          Upload new →
        </Link>
      </div>
      <div className="bg-white rounded-2xl border border-black/[0.08] overflow-hidden">
        <table className="hidden sm:table w-full text-sm">
          <thead>
            <tr className="border-b border-black/[0.06]" style={{ background: 'rgba(0,0,0,0.02)' }}>
              {['Reference', 'Document', 'Date', 'Status', ''].map(h => (
                <th key={h} className="text-left px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {docs.slice(0, 5).map(doc => (
              <tr key={doc.docId} className="hover:bg-gray-50/60 transition-colors">
                <td className="px-5 py-3.5 font-mono text-[12px] text-gray-500">{doc.docId}</td>
                <td className="px-5 py-3.5">
                  <p className="text-[13px] font-medium text-black">{doc.groupLabel}</p>
                  <p className="text-[12px] text-gray-400">{doc.filename}</p>
                </td>
                <td className="px-5 py-3.5 text-[13px] text-gray-400">{fmtDate(doc.createdAt)}</td>
                <td className="px-5 py-3.5"><StatusBadge status={doc.status}/></td>
                <td className="px-5 py-3.5 text-right">
                  <Link href={`/status/${doc.docId}`}
                    className="text-[12px] font-medium text-black hover:text-gray-400 transition-colors">
                    {doc.status === 'complete' ? 'View →' : 'Track →'}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="sm:hidden divide-y divide-black/[0.04]">
          {docs.slice(0, 5).map(doc => (
            <Link key={doc.docId} href={`/status/${doc.docId}`}
              className="flex items-center gap-4 px-4 py-4 hover:bg-gray-50">
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-black truncate">{doc.groupLabel}</p>
                <p className="text-[12px] text-gray-400">{doc.filename}</p>
                <div className="mt-1.5"><StatusBadge status={doc.status}/></div>
              </div>
              <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none"
                   viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
              </svg>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { orgName, subscribedProducts, loading } = useOrg()
  const hasDecodeAccess = subscribedProducts.includes('decode')
  const decodeStats = useDecodeStats(hasDecodeAccess)

  const [docs, setDocs] = useState<Doc[]>([])
  useEffect(() => {
    if (!hasDecodeAccess) return
    fetch('/api/documents')
      .then(r => r.ok ? r.json() : null)
      .then(d => d?.items && setDocs(d.items))
      .catch(() => {})
  }, [hasDecodeAccess])

  const myProducts = PRODUCT_META.filter(p => subscribedProducts.includes(p.key))

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[1, 2].map(i => (
          <div key={i} className="rounded-2xl border border-black/[0.06] h-48 animate-pulse bg-gray-50"/>
        ))}
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-1">
          {orgName}
        </p>
        <h1 className="font-display text-[2.1rem] leading-tight text-black">
          Your products
        </h1>
        <p className="text-[13px] text-gray-400 mt-1">
          {myProducts.length === 1
            ? 'You have 1 active product subscription.'
            : `You have ${myProducts.length} active product subscriptions.`}
        </p>
      </div>

      {/* Product tiles */}
      {myProducts.length > 0 ? (
        <div className={`grid gap-4 ${myProducts.length === 1 ? 'grid-cols-1 max-w-md' : 'grid-cols-1 sm:grid-cols-2'}`}>
          {myProducts.map(meta => (
            <ProductCard
              key={meta.key}
              meta={meta}
              stats={meta.key === 'decode' ? decodeStats : undefined}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-black/[0.06] py-20 text-center">
          <p className="text-[15px] font-semibold text-black mb-1">No products subscribed</p>
          <p className="text-[13px] text-gray-400">Contact your administrator to enable TheoFlow products.</p>
        </div>
      )}

      {/* Recent decode submissions */}
      {hasDecodeAccess && <RecentSubmissions docs={docs}/>}
    </div>
  )
}
