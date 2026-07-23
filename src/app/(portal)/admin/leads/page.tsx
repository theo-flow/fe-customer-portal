'use client'
import { useState, useEffect } from 'react'

// Platform-wide, not org-scoped -- gated server-side by an operator-email
// allowlist (see /api/admin/leads and src/lib/operator.ts), not by which
// org the viewer belongs to. No nav link points here deliberately -- direct
// URL only, same as Phase 5's operator console will be.

interface Lead {
  messageId: string
  name:      string
  email:     string
  org:       string
  message:   string
  status:    string
  createdAt: string
}

const STATUSES = ['new', 'contacted', 'converted'] as const

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

function StatusPill({ status }: { status: string }) {
  const config: Record<string, string> = {
    new:       'bg-blue-50 text-blue-700 border-blue-200',
    contacted: 'bg-amber-50 text-amber-700 border-amber-200',
    converted: 'bg-green-50 text-green-700 border-green-200',
  }
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${config[status] ?? config.new}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

export default function AdminLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [updating, setUpdating] = useState<string | null>(null)

  const load = () => {
    fetch('/api/admin/leads')
      .then(r => {
        if (r.status === 403 || r.status === 401) { setForbidden(true); return null }
        return r.ok ? r.json() : null
      })
      .then(d => d?.items && setLeads(d.items))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  async function updateStatus(messageId: string, status: string) {
    setUpdating(messageId)
    setLeads(prev => prev.map(l => l.messageId === messageId ? { ...l, status } : l))
    await fetch('/api/admin/leads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, status }),
    }).catch(() => {})
    setUpdating(null)
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
        <h1 className="font-display text-[2.1rem] leading-tight text-black">Leads</h1>
        <p className="text-[13px] text-gray-400 mt-1">
          Marketing site contact-form submissions — platform-wide, not tied to any org.
        </p>
      </div>

      {leads.length === 0 ? (
        <div className="rounded-2xl border border-black/[0.06] py-20 text-center">
          <p className="text-[13px] text-gray-400">No leads yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-black/[0.08] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/[0.06]" style={{ background: 'rgba(0,0,0,0.02)' }}>
                {['Date', 'Name', 'Email', 'Org', 'Message', 'Status'].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {leads.map(lead => (
                <tr key={lead.messageId} className="hover:bg-gray-50/60 transition-colors align-top">
                  <td className="px-5 py-3.5 text-[12px] text-gray-400 whitespace-nowrap">{fmtDate(lead.createdAt)}</td>
                  <td className="px-5 py-3.5 text-[13px] font-medium text-black whitespace-nowrap">{lead.name}</td>
                  <td className="px-5 py-3.5 text-[13px] text-gray-500 whitespace-nowrap">{lead.email}</td>
                  <td className="px-5 py-3.5 text-[13px] text-gray-500 whitespace-nowrap">{lead.org || '—'}</td>
                  <td className="px-5 py-3.5 text-[13px] text-gray-500 max-w-xs">{lead.message}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <StatusPill status={lead.status} />
                      <select
                        value={lead.status}
                        disabled={updating === lead.messageId}
                        onChange={e => updateStatus(lead.messageId, e.target.value)}
                        className="text-[12px] border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600"
                      >
                        {STATUSES.map(s => (
                          <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                        ))}
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
