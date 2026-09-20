'use client'
import { useMemo, useState, useEffect, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { isValidWorkspaceId } from '@/lib/workspace-id'

// Platform-wide. Gated server-side by the operator-email allowlist (see
// /api/operator/orgs and src/lib/operator.ts); operators reach it from the sidebar.
//
// The list is the way in: pick an organisation. Opening a workspace by id is the fallback
// below it, for a closed account (no organisation profile, so not in the list, yet a
// data-erasure request for it can still arrive) and for when the list itself fails.

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
  const router = useRouter()
  const [orgs, setOrgs]           = useState<OrgRow[]>([])
  const [loading, setLoading]     = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [listFailed, setListFailed] = useState(false)

  const [query, setQuery]         = useState('')
  const [wsId, setWsId]           = useState('')
  const [wsError, setWsError]     = useState('')

  useEffect(() => {
    fetch('/api/operator/orgs')
      .then(r => {
        if (r.status === 403 || r.status === 401) { setForbidden(true); return null }
        if (!r.ok) { setListFailed(true); return null }
        return r.json()
      })
      .then(d => d?.orgs && setOrgs(d.orgs))
      .catch(() => setListFailed(true))
      .finally(() => setLoading(false))
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? orgs.filter(o => o.orgName.toLowerCase().includes(q) || o.orgId.toLowerCase().includes(q)) : orgs
  }, [orgs, query])

  function openWorkspace(e: FormEvent) {
    e.preventDefault()
    const id = wsId.trim()
    if (!isValidWorkspaceId(id)) {
      setWsError('Enter a workspace id: letters, numbers, hyphens and underscores only.')
      return
    }
    setWsError('')
    router.push(`/operator/orgs/${id}`)
  }

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
          {listFailed
            ? 'Platform-wide tools for operators.'
            : `Platform-wide tools for operators. ${orgs.length} organisation${orgs.length === 1 ? '' : 's'} in total.`}
        </p>
      </div>

      {listFailed ? (
        <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-[13px] text-amber-800">
          The organisation list could not be loaded, so organisations cannot be browsed right now.
          You can still open a workspace by its id below.
        </div>
      ) : orgs.length === 0 ? (
        <div className="rounded-2xl border border-black/[0.06] py-16 text-center">
          <p className="text-[13px] text-gray-400">No organisations yet.</p>
        </div>
      ) : (
        <>
          <div className="relative mb-3 max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"/>
            <input type="search" value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search organisations" aria-label="Search organisations"
              className="w-full rounded-full border border-black/[0.12] py-2 pl-8 pr-3 text-[13px] outline-none focus:border-black/40"/>
          </div>

          {shown.length === 0 ? (
            <p className="py-6 text-[13px] text-gray-400">No organisations match &quot;{query.trim()}&quot;.</p>
          ) : (
            <div className="bg-white rounded-2xl border border-black/[0.08] overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/[0.06]" style={{ background: 'rgba(0,0,0,0.02)' }}>
                    {['Org', 'Status', 'Products', 'Subscription', 'Documents', ''].map(h => (
                      <th key={h} className="text-left px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04]">
                  {shown.map(org => (
                    <tr key={org.orgId} className="hover:bg-gray-50/60 transition-colors">
                      <td className="px-5 py-3.5">
                        <Link href={`/operator/orgs/${org.orgId}`} className="block hover:underline">
                          <p className="text-[13px] font-medium text-black">{org.orgName || '(unnamed)'}</p>
                          <p className="text-[11px] font-mono text-gray-400">{org.orgId}</p>
                        </Link>
                      </td>
                      <td className="px-5 py-3.5"><StatusPill status={org.status} /></td>
                      <td className="px-5 py-3.5 text-[12px] text-gray-500">
                        {org.subscribedProducts.length ? org.subscribedProducts.join(', ') : '-'}
                      </td>
                      <td className="px-5 py-3.5 text-[12px] text-gray-500">
                        {org.subscription
                          ? `${org.subscription.planName} (${org.subscription.status})`
                          : 'No subscription'}
                      </td>
                      <td className="px-5 py-3.5 text-[13px] font-medium text-black">{org.totalDocuments}</td>
                      <td className="px-5 py-3.5 text-right">
                        <Link href={`/operator/orgs/${org.orgId}`} className="text-[12px] font-medium text-blue-600 hover:text-blue-700">
                          Manage →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <form onSubmit={openWorkspace} className="mt-10 max-w-xl rounded-2xl border border-black/[0.08] p-5">
        <label htmlFor="open-workspace" className="block text-[13px] font-semibold text-black">Open a workspace</label>
        <p className="mt-0.5 text-[12px] text-gray-500">
          Not in the list, for example a closed account? Open it by its id, such as <span className="font-mono">org-84a4d521</span>.
        </p>
        <div className="mt-3 flex gap-2">
          <input id="open-workspace" value={wsId} onChange={e => { setWsId(e.target.value); setWsError('') }}
            autoComplete="off" spellCheck={false} placeholder="Workspace id"
            className="min-w-0 flex-1 rounded-lg border border-black/[0.12] px-3 py-2 font-mono text-[13px] outline-none focus:border-black/40"/>
          <button type="submit"
            className="rounded-full bg-black px-5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-gray-900">
            Open
          </button>
        </div>
        {wsError && <p role="alert" className="mt-2 text-[12px] text-red-600">{wsError}</p>}
      </form>
    </div>
  )
}
