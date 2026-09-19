'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useOrg } from '@/lib/org-context'

interface SessionSigner {
  signerId: string
  name:     string
  email:    string
  status:   'PENDING' | 'SIGNED' | 'EXPIRED' | 'DECLINED'
  declineReason?: string | null
  declinedAt?:    string | null
}

interface SessionSummary {
  sessionId:    string
  status:       'DRAFT' | 'PENDING' | 'IN_PROGRESS' | 'SIGNED' | 'EXPIRED' | 'CANCELLED' | 'DECLINED' | 'FAILED'
  createdAt:    string
  updatedAt:    string
  submissionId: string | null
  completedKey: string | null
  completedSha256: string | null
  signers:      SessionSigner[]
}

function StatusPill({ status }: { status: SessionSummary['status'] }) {
  const map: Record<SessionSummary['status'], { label: string; cls: string; dot: string }> = {
    DRAFT:       { label: 'Not sent yet',          cls: 'bg-gray-100 text-gray-500',  dot: 'bg-gray-400' },
    PENDING:     { label: 'Awaiting signatures', cls: 'bg-gray-100 text-gray-500',   dot: 'bg-gray-400' },
    IN_PROGRESS: { label: 'In progress',          cls: 'bg-amber-50 text-amber-700', dot: 'bg-amber-400 animate-pulse' },
    SIGNED:      { label: 'Signed',                cls: 'bg-green-50 text-green-700', dot: 'bg-green-500' },
    EXPIRED:     { label: 'Expired',               cls: 'bg-gray-100 text-gray-500',  dot: 'bg-gray-400' },
    CANCELLED:   { label: 'Cancelled',             cls: 'bg-gray-100 text-gray-500',  dot: 'bg-gray-400' },
    DECLINED:    { label: 'Declined',              cls: 'bg-red-50 text-red-600',     dot: 'bg-red-500' },
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
  const declined = session.signers.filter(s => s.status === 'DECLINED')
  const [opening, setOpening] = useState(false)
  const [busy, setBusy]       = useState<string | null>(null)
  const [notice, setNotice]   = useState<string | null>(null)

  const isOpen = session.status === 'PENDING' || session.status === 'IN_PROGRESS' || session.status === 'EXPIRED'

  async function cancelSession() {
    if (!window.confirm('Cancel this signing session? Signers will no longer be able to sign.')) return
    setBusy('cancel')
    setNotice(null)
    try {
      const res = await fetch(`/api/sign/sessions/${session.sessionId}/cancel`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      setNotice(res.ok ? 'Session cancelled.' : (data.error ?? 'Could not cancel this session.'))
    } catch {
      setNotice('Could not cancel this session. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function resendLink(signer: SessionSigner) {
    setBusy(signer.signerId)
    setNotice(null)
    try {
      const res = await fetch(`/api/sign/sessions/${session.sessionId}/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signerId: signer.signerId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNotice(data.error ?? 'Could not send a new link.')
        return
      }
      // Copy the new link too, so the org can pass it on by hand if the email is slow.
      await navigator.clipboard.writeText(data.signUrl).catch(() => {})
      setNotice(
        data.emailQueued
          ? `New link emailed to ${signer.email} and copied to your clipboard.`
          : `The email could not be queued. The new link is copied to your clipboard, send it to ${signer.email} directly.`,
      )
    } catch {
      setNotice('Could not send a new link. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function viewDocument() {
    setOpening(true)
    try {
      const res = await fetch(`/api/sign/sessions/${session.sessionId}/document`)
      const data = await res.json()
      if (res.ok && data.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer')
      }
    } catch {
      // Silent -- this is a "nice to have" action, not worth an error banner
    } finally {
      setOpening(false)
    }
  }

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
      <div className="mt-3 pt-3 border-t border-black/[0.06] flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {session.signers.map(s => (
            <span key={s.signerId} className="text-[12px] text-gray-500">
              {s.name}{' '}
              <span className={s.status === 'SIGNED' ? 'text-green-600' : s.status === 'EXPIRED' ? 'text-amber-600' : s.status === 'DECLINED' ? 'text-red-600' : 'text-gray-300'}>
                {s.status === 'SIGNED' ? '✓' : s.status === 'EXPIRED' ? 'link expired' : s.status === 'DECLINED' ? 'declined' : '·'}
              </span>
              {isOpen && (s.status === 'PENDING' || s.status === 'EXPIRED') && (
                <button
                  type="button"
                  onClick={() => resendLink(s)}
                  disabled={busy !== null}
                  className="ml-2 text-[11px] font-medium text-indigo-500 hover:text-indigo-700 transition-colors disabled:opacity-50">
                  {busy === s.signerId ? 'Sending…' : 'Send new link'}
                </button>
              )}
            </span>
          ))}
        </div>
        {isOpen && (
          <button
            type="button"
            onClick={cancelSession}
            disabled={busy !== null}
            className="text-[12px] font-medium text-red-500 hover:text-red-700 transition-colors disabled:opacity-50 whitespace-nowrap">
            {busy === 'cancel' ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
        <button
          type="button"
          onClick={viewDocument}
          disabled={opening}
          className="text-[12px] font-medium text-indigo-500 hover:text-indigo-700 transition-colors disabled:opacity-50 whitespace-nowrap">
          {opening ? 'Opening…' : session.completedKey ? 'View signed document' : 'View document'}
        </button>
      </div>
      {notice && <p className="mt-2 text-[12px] text-gray-500" role="status">{notice}</p>}
      {declined.map(d => (
        <p key={d.signerId} className="mt-2 text-[12px] text-red-600">
          {d.name} declined to sign{d.declineReason ? `: ${d.declineReason}` : '.'}
        </p>
      ))}
      {session.completedSha256 && (
        <p className="mt-2 text-[11px] text-gray-400" title={session.completedSha256}>
          Signed file fingerprint (SHA-256): {session.completedSha256.slice(0, 16)}…
        </p>
      )}
    </div>
  )
}

export default function SignSessionsPage() {
  const { orgName, loading: orgLoading } = useOrg()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    function poll() {
      return fetch('/api/sign/sessions')
        .then(r => r.ok ? r.json() : null)
        .then(d => d && setSessions(d.sessions))
        .catch(() => {})
        .finally(() => setLoading(false))
    }

    poll()
    // Sessions list has no single terminal state to stop on (many sessions,
    // many statuses) -- keep polling every 5s, same cadence as the Decode
    // /status page, for as long as the dashboard is mounted.
    const t = setInterval(poll, 5000)
    return () => clearInterval(t)
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
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link href="/sign/send"
                className="px-5 py-2.5 rounded-full bg-black text-white text-[13px] font-semibold
                           hover:bg-gray-800 transition-colors whitespace-nowrap">
            Send a form
          </Link>
          <Link href="/sign/new"
                className="px-5 py-2.5 rounded-full border border-black/[0.15] text-black text-[13px] font-semibold
                           hover:border-black/40 transition-colors whitespace-nowrap">
            Other document
          </Link>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-2xl border border-black/[0.06] py-20 text-center">
          <p className="text-[15px] font-semibold text-black mb-1">No signing sessions yet</p>
          <p className="text-[13px] text-gray-400 mb-5">
            Request a signature from a document's status page, or upload a document directly.
          </p>
          <Link href="/sign/send"
                className="inline-block text-[13px] font-semibold px-5 py-2.5 rounded-full bg-black
                           text-white hover:bg-gray-800 transition-colors">
            Send a form
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
