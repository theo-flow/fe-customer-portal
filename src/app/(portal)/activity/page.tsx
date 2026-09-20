'use client'
import { useState, useEffect, useCallback } from 'react'
import { useOrg } from '@/lib/org-context'
import { fmtDate, fmtTime } from '@/lib/format'
import { AUDIT_LABELS, type AuditEntry } from '@/lib/audit-labels'

export default function ActivityPage() {
  const { orgName, role, loading: orgLoading } = useOrg()
  const [entries, setEntries]   = useState<AuditEntry[]>([])
  const [cursor, setCursor]     = useState<string | null>(null)
  const [loading, setLoading]   = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]       = useState('')

  const load = useCallback(async (next: string | null) => {
    const res = await fetch(next ? `/api/activity?cursor=${encodeURIComponent(next)}` : '/api/activity')
    if (!res.ok) throw new Error('failed')
    const body = await res.json() as { entries: AuditEntry[]; nextCursor: string | null }
    setEntries(prev => next ? [...prev, ...body.entries] : body.entries)
    setCursor(body.nextCursor)
  }, [])

  useEffect(() => {
    if (orgLoading) return
    if (role !== 'admin') { setLoading(false); return }
    load(null).catch(() => setError('Could not load the activity log. Please try again.')).finally(() => setLoading(false))
  }, [orgLoading, role, load])

  async function more() {
    setLoadingMore(true)
    setError('')
    try { await load(cursor) } catch { setError('Could not load more. Please try again.') } finally { setLoadingMore(false) }
  }

  if (orgLoading || loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-14 rounded-2xl border border-black/[0.06] animate-pulse bg-gray-50"/>
        ))}
      </div>
    )
  }

  if (role !== 'admin') {
    return (
      <div className="rounded-2xl border border-black/[0.06] py-20 text-center">
        <p className="text-[15px] font-semibold text-black mb-1">Admins only</p>
        <p className="text-[13px] text-gray-400">Ask your organisation admin to see the activity log.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-1">
          {orgName} · Organisation
        </p>
        <h1 className="font-display text-[2.1rem] leading-tight text-black">Activity</h1>
        <p className="text-[13px] text-gray-400 mt-1">
          Who did what in your organisation, newest first.
        </p>
      </div>

      {error && <p role="alert" className="mb-4 text-[12px] text-red-600">{error}</p>}

      {entries.length === 0 ? (
        <div className="rounded-2xl border border-black/[0.06] py-20 text-center">
          <p className="text-[15px] font-semibold text-black mb-1">No activity yet</p>
          <p className="text-[13px] text-gray-400">Actions your team takes will appear here.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-black/[0.08] overflow-hidden divide-y divide-black/[0.04]">
          {entries.map(e => (
            <div key={e.auditId} className="flex items-start gap-4 px-5 py-3.5">
              <div className="w-32 flex-shrink-0">
                <p className="text-[12px] text-gray-600">{fmtDate(e.at)}</p>
                <p className="text-[11px] text-gray-400">{fmtTime(e.at)}</p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-black">
                  {AUDIT_LABELS[e.action] ?? e.action}
                  {e.target && <span className="text-gray-500">: {e.target}</span>}
                </p>
                <p className="text-[12px] text-gray-400 truncate">
                  {e.actorEmail} · {e.actorRole === 'admin' ? 'Admin' : 'Agent'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {cursor && (
        <div className="mt-5 text-center">
          <button onClick={more} disabled={loadingMore}
                  className="px-6 py-2.5 rounded-full text-[13px] font-medium text-black border border-black/[0.15] hover:bg-gray-50 transition-colors disabled:opacity-50">
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}
