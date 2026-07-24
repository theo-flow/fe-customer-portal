'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

// Platform-wide, gated the same way as /operator (see src/lib/operator.ts).
// The one write action in the operator console: lets an operator turn
// products on for an org after signup, now that registration no longer
// collects product selection up front.

const PRODUCTS = [
  { key: 'forge',   label: 'TheoFlow Forge',   description: 'Convert physical documents into structured digital forms.' },
  { key: 'channel', label: 'TheoFlow Channel', description: 'Publish and route forms to users and systems.' },
  { key: 'harvest', label: 'TheoFlow Harvest', description: 'Capture structured responses from users at scale.' },
  { key: 'decode',  label: 'TheoFlow Decode',  description: 'Convert unstructured documents into structured intelligence.' },
  { key: 'sign',    label: 'TheoFlow Sign',    description: 'Request signatures on validated submissions, or sign any document standalone.' },
]

interface OrgRow {
  orgId:              string
  orgName:            string
  subscribedProducts: string[]
}

export default function ManageOrgPage() {
  const params = useParams()
  const orgId  = params.orgId as string

  const [org, setOrg]           = useState<OrgRow | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading]   = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [error, setError]       = useState('')

  useEffect(() => {
    fetch('/api/operator/orgs')
      .then(r => {
        if (r.status === 403 || r.status === 401) { setForbidden(true); return null }
        return r.ok ? r.json() : null
      })
      .then(d => {
        const match = (d?.orgs as OrgRow[] | undefined)?.find(o => o.orgId === orgId)
        if (match) { setOrg(match); setSelected(match.subscribedProducts) }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [orgId])

  const toggle = (key: string) => {
    setSaved(false)
    setSelected(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  const save = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const res = await fetch(`/api/operator/orgs/${orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscribedProducts: selected }),
      })
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: 'Server error' }))
        throw new Error(msg ?? `Server error ${res.status}`)
      }
      setSaved(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
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

  if (!org) {
    return (
      <div className="rounded-2xl border border-black/[0.06] py-20 text-center">
        <p className="text-[13px] text-gray-400">Org not found.</p>
      </div>
    )
  }

  return (
    <div className="max-w-lg">
      <Link href="/operator" className="text-[12px] font-medium text-gray-400 hover:text-black">
        ← Back to operator console
      </Link>

      <div className="mt-4 mb-8">
        <h1 className="font-display text-[2.1rem] leading-tight text-black">{org.orgName || '(unnamed)'}</h1>
        <p className="text-[13px] text-gray-400 mt-1 font-mono">{org.orgId}</p>
      </div>

      {error && (
        <div role="alert" className="mb-5 px-4 py-3 rounded-xl text-red-600 text-[13px] bg-red-50 border border-red-200">
          {error}
        </div>
      )}

      <div className="space-y-2.5 mb-6">
        {PRODUCTS.map(({ key, label, description }) => {
          const on = selected.includes(key)
          return (
            <button
              key={key}
              onClick={() => toggle(key)}
              className="w-full text-left rounded-xl px-5 py-4 transition-all border"
              style={{
                borderColor: on ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.08)',
                background:  on ? 'rgba(0,0,0,0.03)' : 'transparent',
              }}>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-black mb-0.5">{label}</p>
                  <p className="text-[12px] text-gray-400">{description}</p>
                </div>
                <div className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center border"
                  style={{ background: on ? 'black' : 'transparent', borderColor: on ? 'black' : 'rgba(0,0,0,0.2)' }}>
                  {on && (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 10 10">
                      <path d="M1.5 5l2.5 2.5 4.5-4" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-4">
        <button onClick={save} disabled={saving}
          className="px-6 py-2.5 rounded-full text-[13px] font-medium text-white bg-black hover:bg-black/85 transition-all disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="text-[12px] text-green-600 font-medium">Saved</span>}
      </div>
    </div>
  )
}
