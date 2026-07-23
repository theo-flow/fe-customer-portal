'use client'
import { useState, useEffect } from 'react'

// Platform-wide, read-only. Gated server-side by the same operator-email
// allowlist as /admin/leads (see /api/operator/orgs and src/lib/operator.ts).
// No nav link deliberately -- direct URL only. No write actions anywhere on
// this page -- visibility only, not a management console.

interface OrgRow {
  orgId:              string
  orgName:            string
  status:             string
  subscribedProducts: string[]
  subscription:       { planId: string; planName: string; status: string } | null
  totalDocuments:      number
}

function StatusPill({ status }: { status: string }) {
  const config: Record<string, string> = {
    active:               'bg-green-50 text-green-700 border-green-200',
    pending_verification: 'bg-amber-50 text-amber-700 border-amber-200',
    suspended:            'bg-red-50 text-red-700 border-red-200',
  }
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${config[status] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

export default function OperatorConsolePage() {
  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)

  useEffect(() => {
    fetch('/api/operator/orgs')
      .then(r => {
        if (r.status === 403 || r.status === 401) { setForbidden(true); return null }
        return r.ok ? r.json() : null
      })
      .then(d => d?.orgs && setOrgs(d.orgs))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="rounded-2xl border border-black/[0.06] h-64 animate-pulse bg-gray-50" />
  }

  if (forbidden) {
    return (
      <div className="rounded-2xl border border-black/[0.06] py-20 text-center">
        <p className="text-[15px] font-semibold text-black mb-1">Not authorized</p>
        <p className="text-[13px] text-gray-400">This page is restricted to platform operators.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-[2.1rem] leading-tight text-black">Operator console</h1>
        <p className="text-[13px] text-gray-400 mt-1">
          Cross-org visibility, read-only — {orgs.length} organisation{orgs.length === 1 ? '' : 's'} total.
        </p>
      </div>

      {orgs.length === 0 ? (
        <div className="rounded-2xl border border-black/[0.06] py-20 text-center">
          <p className="text-[13px] text-gray-400">No orgs found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-black/[0.08] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/[0.06]" style={{ background: 'rgba(0,0,0,0.02)' }}>
                {['Org', 'Status', 'Products', 'Subscription', 'Documents'].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {orgs.map(org => (
                <tr key={org.orgId} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-5 py-3.5">
                    <p className="text-[13px] font-medium text-black">{org.orgName || '(unnamed)'}</p>
                    <p className="text-[11px] font-mono text-gray-400">{org.orgId}</p>
                  </td>
                  <td className="px-5 py-3.5"><StatusPill status={org.status} /></td>
                  <td className="px-5 py-3.5 text-[12px] text-gray-500">
                    {org.subscribedProducts.length ? org.subscribedProducts.join(', ') : '—'}
                  </td>
                  <td className="px-5 py-3.5 text-[12px] text-gray-500">
                    {org.subscription
                      ? `${org.subscription.planName} (${org.subscription.status})`
                      : 'No subscription'}
                  </td>
                  <td className="px-5 py-3.5 text-[13px] font-medium text-black">{org.totalDocuments}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
