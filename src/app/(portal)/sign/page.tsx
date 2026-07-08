'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useOrg } from '@/lib/org-context'

interface SessionSigner {
  signerId: string
  name:     string
  email:    string
  status:   'PENDING' | 'SIGNED' | 'EXPIRED' | 'DECLINED'
}

interface SessionSummary {
  sessionId:    string
  status:       'PENDING' | 'IN_PROGRESS' | 'SIGNED' | 'EXPIRED' | 'CANCELLED' | 'FAILED'
  createdAt:    string
  updatedAt:    string
  submissionId: string | null
  completedKey: string | null
  signers:      SessionSigner[]
}

function StatusPill({ status }: { status: SessionSummary['status'] }) {
  const map: Record<SessionSummary['status'], { label: string; cls: string; dot: string }> = {
    PENDING:     { label: 'Awaiting signatures', cls: 'bg-gray-100 text-gray-500',   dot: 'bg-gray-400' },
    IN_PROGRESS: { label: 'In progress',          cls: 'bg-amber-50 text-amber-700', dot: 'bg-amber-400 animate-pulse' },
    SIGNED:      { label: 'Signed',                cls: 'bg-green-50 text-green-700', dot: 'bg-green-500' },
    EXPIRED:     { label: 'Expired',               cls: 'bg-gray-100 text-gray-500',  dot: 'bg-gray-400' },
    CANCELLED:   { label: 'Cancelled',             cls: 'bg-gray-100 text-gray-500',  dot: 'bg-gray-400' },
    FAILED:      { label: 'Failed',                cls: 'bg-red-50 text-red-600',     dot: 'bg-red-500' },
  }
  const m = map[status]
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full ${m.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`}/>{m.label}
    </span>
  )
}

function SessionRow({ session }: { session: SessionSummary }) {
  const signedCount = session.signers.filter(s => s.status === 'SIGNED').length

  return (
    <div className="rounded-2xl border border-black/[0.08] px-5 py-4">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-indigo-50 flex-shrink-0 flex items-center justify-center">
          <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round"
                  d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.83a4 4 0 01-1.414.94l-3.114 1.04 1.04-3.114a4 4 0 01.94-1.414z"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-black">
            {session.submissionId ? `Attached to ${session.submissionId}` : 'Standalone document'}
          </p>
          <p className="text-[12px] text-gray-400 mt-0.5">
            {signedCount} of {session.signers.length} signer{session.signers.length !== 1 ? 's' : ''} signed
          </p>
        </div>
        <StatusPill status={session.status}/>
      </div>
      <div className="mt-3 pt-3 border-t border-black/[0.06] flex flex-wrap gap-x-4 gap-y-1">
        {session.signers.map(s => (
          <span key={s.signerId} className="text-[12px] text-gray-500">
            {s.name} <span className={s.status === 'SIGNED' ? 'text-green-600' : 'text-gray-300'}>
              {s.status === 'SIGNED' ? '✓' : '·'}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

export default function SignSessionsPage() {
  const { orgName, loading: orgLoading } = useOrg()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    fetch('/api/sign/sessions')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setSessions(d.sessions))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (orgLoading || loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-[88px] rounded-2xl border border-black/[0.06] animate-pulse bg-gray-50"/>
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-1">
            {orgName} · TheoFlow Sign
          </p>
          <h1 className="font-display text-[2.1rem] leading-tight text-black">Signing sessions</h1>
        </div>
        <Link href="/sign/new"
              className="px-5 py-2.5 rounded-full bg-black text-white text-[13px] font-semibold
                         hover:bg-gray-800 transition-colors whitespace-nowrap">
          New signing session
        </Link>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-2xl border border-black/[0.06] py-20 text-center">
          <p className="text-[15px] font-semibold text-black mb-1">No signing sessions yet</p>
          <p className="text-[13px] text-gray-400 mb-5">
            Request a signature from a document's status page, or upload a document directly.
          </p>
          <Link href="/sign/new"
                className="inline-block text-[13px] font-semibold px-5 py-2.5 rounded-full bg-black
                           text-white hover:bg-gray-800 transition-colors">
            New signing session
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map(s => <SessionRow key={s.sessionId} session={s}/>)}
        </div>
      )}
    </div>
  )
}
