'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useOrg } from '@/lib/org-context'
import { fmtDate } from '@/lib/format'
import { computeSeatCharge, MAX_SEATS } from '@/lib/seat-pricing'

interface Member {
  sub:       string
  email:     string
  name:      string
  role:      'admin' | 'agent'
  status:    'active' | 'invited'
  createdAt: string
}

interface Seats {
  state:            'trial' | 'active' | 'locked'
  planName:         string
  totalSeats:       number
  canChangeSeats:   boolean
  monthlyTotalZar:  number
  trialEndsAt:      string | null
  daysLeft:         number | null
}

interface Team {
  members:   Member[]
  seatsUsed: number
  seats:     Seats
}

function zar(n: number): string {
  return `R${n.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

function Pill({ tone, children }: { tone: 'green' | 'amber' | 'gray'; children: React.ReactNode }) {
  const styles = {
    green: 'bg-green-50 text-green-700',
    amber: 'bg-amber-50 text-amber-700',
    gray:  'bg-gray-100 text-gray-500',
  }[tone]
  return (
    <span className={`inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-full ${styles}`}>
      {children}
    </span>
  )
}

export default function TeamPage() {
  const { orgName, role, loading: orgLoading } = useOrg()
  const [team, setTeam]         = useState<Team | null>(null)
  const [loading, setLoading]   = useState(true)
  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [sending, setSending]   = useState(false)
  const [error, setError]       = useState('')
  const [notice, setNotice]     = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [seatCount, setSeatCount]   = useState('')
  const [savingSeats, setSavingSeats] = useState(false)

  const load = useCallback(() => {
    fetch('/api/team')
      .then(r => r.ok ? r.json() : null)
      .then((d: Team | null) => { if (d) { setTeam(d); setSeatCount(String(d.seats.totalSeats)) } })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!orgLoading && role === 'admin') load()
    else if (!orgLoading) setLoading(false)
  }, [orgLoading, role, load])

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setNotice('')
    setSending(true)
    try {
      const res  = await fetch('/api/team/invite', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, email }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'Could not send the invite. Please try again.')
        return
      }
      setNotice(`Invite sent to ${email.trim()}. They will get an email with a temporary password.`)
      setName('')
      setEmail('')
      load()
    } catch {
      setError('Could not send the invite. Please try again.')
    } finally {
      setSending(false)
    }
  }

  async function remove(sub: string) {
    setError('')
    setNotice('')
    const res = await fetch(`/api/team/${sub}`, { method: 'DELETE' })
    setConfirming(null)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not remove that person. Please try again.')
      return
    }
    load()
  }

  async function saveSeats() {
    setError('')
    setNotice('')
    setSavingSeats(true)
    try {
      const res  = await fetch('/api/team/seats', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ seats: Number(seatCount) }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error ?? 'Could not update seats. Please try again.'); return }
      setNotice(`You now have ${body.seats} seat${body.seats !== 1 ? 's' : ''}. The new price applies from your next invoice.`)
      load()
    } catch {
      setError('Could not update seats. Please try again.')
    } finally {
      setSavingSeats(false)
    }
  }

  if (orgLoading || loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-16 rounded-2xl border border-black/[0.06] animate-pulse bg-gray-50"/>
        ))}
      </div>
    )
  }

  if (role !== 'admin') {
    return (
      <div className="rounded-2xl border border-black/[0.06] py-20 text-center">
        <p className="text-[15px] font-semibold text-black mb-1">Admins only</p>
        <p className="text-[13px] text-gray-400">Ask your organisation admin to manage the team.</p>
      </div>
    )
  }

  const seats = team?.seats
  const used  = team?.seatsUsed ?? 0
  const total = seats?.totalSeats ?? 1
  const full  = used >= total

  const wanted        = Number(seatCount)
  const wantedValid   = Number.isInteger(wanted) && wanted >= Math.max(1, used) && wanted <= MAX_SEATS
  const wantedTotal   = wantedValid ? computeSeatCharge(wanted).totalZar : null

  return (
    <div>
      <div className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-1">
          {orgName} · Organisation
        </p>
        <h1 className="font-display text-[2.1rem] leading-tight text-black">Your team</h1>
        <p className="text-[13px] text-gray-400 mt-1">
          {seats?.planName} plan · {used} of {total} seat{total !== 1 ? 's' : ''} used
        </p>
        <div className="mt-3 h-1.5 w-48 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
          <div className={`h-full rounded-full ${full ? 'bg-amber-400' : 'bg-black'}`}
               style={{ width: `${Math.min(100, (used / total) * 100)}%` }}/>
        </div>
      </div>

      {/* Pilot: when it ends, and the way to start paying now */}
      {seats?.state === 'trial' && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 mb-6 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[13px] font-semibold text-amber-900">
              {seats.daysLeft === null
                ? 'You are on the free pilot.'
                : seats.daysLeft === 0
                  ? 'Your pilot ends today.'
                  : `Your pilot ends in ${seats.daysLeft} day${seats.daysLeft !== 1 ? 's' : ''}.`}
            </p>
            <p className="text-[12px] text-amber-800 mt-0.5">
              Your pilot has one seat. Start the paid plan to add people to your team.
            </p>
          </div>
          <Link href="/billing/upgrade"
                className="px-5 py-2 rounded-full text-[13px] font-medium text-white bg-black hover:bg-black/85 transition-colors">
            Start paid plan
          </Link>
        </div>
      )}

      {/* Paid: how many seats the org has */}
      {seats?.canChangeSeats && (
        <div className="rounded-2xl border border-black/[0.08] p-5 mb-6">
          <p className="text-[13px] font-semibold text-black mb-3">Seats</p>
          <div className="flex items-end gap-3 flex-wrap">
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Number of seats</span>
              <input type="number" min={Math.max(1, used)} max={MAX_SEATS} step={1} value={seatCount}
                     onChange={e => setSeatCount(e.target.value)}
                     className="w-28 rounded-xl border border-black/[0.12] px-3.5 py-2.5 text-[14px]"/>
            </label>
            <button onClick={saveSeats}
                    disabled={savingSeats || !wantedValid || wanted === total}
                    className="px-6 py-2.5 rounded-full text-[13px] font-medium text-white bg-black
                               hover:bg-black/85 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {savingSeats ? 'Saving…' : 'Update seats'}
            </button>
            {wantedTotal !== null && wanted !== total && (
              <p className="text-[12px] text-gray-500 pb-3">
                {wanted} seat{wanted !== 1 ? 's' : ''} is {zar(wantedTotal)} a month, from your next invoice.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Invite */}
      <form onSubmit={invite}
            className="rounded-2xl border border-black/[0.08] p-5 mb-8">
        <p className="text-[13px] font-semibold text-black mb-1">Invite an agent</p>
        <p className="text-[12px] text-gray-400 mb-4">
          Agents can use the platform with their own login. Only admins can manage the team.
        </p>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end">
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Name</span>
            <input value={name} onChange={e => setName(e.target.value)} disabled={full || sending}
                   className="w-full rounded-xl border border-black/[0.12] px-3.5 py-2.5 text-[14px] disabled:bg-gray-50"
                   placeholder="Jane Dlamini" autoComplete="off"/>
          </label>
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Email</span>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} disabled={full || sending}
                   className="w-full rounded-xl border border-black/[0.12] px-3.5 py-2.5 text-[14px] disabled:bg-gray-50"
                   placeholder="jane@company.co.za" autoComplete="off"/>
          </label>
          <button type="submit" disabled={full || sending || !name.trim() || !email.trim()}
                  className="px-6 py-2.5 rounded-full text-[13px] font-medium text-white bg-black
                             hover:bg-black/85 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {sending ? 'Sending…' : 'Send invite'}
          </button>
        </div>
        {full && seats?.canChangeSeats && (
          <p className="mt-3 text-[12px] text-amber-700">
            All seats are in use. Add a seat above to invite someone else.
          </p>
        )}
        {error  && <p role="alert"  className="mt-3 text-[12px] text-red-600">{error}</p>}
        {notice && <p role="status" className="mt-3 text-[12px] text-green-700">{notice}</p>}
      </form>

      {/* Members */}
      <div className="bg-white rounded-2xl border border-black/[0.08] overflow-hidden divide-y divide-black/[0.04]">
        {(team?.members ?? []).map(m => (
          <div key={m.sub} className="flex items-center gap-4 px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-black truncate">{m.name || m.email}</p>
              <p className="text-[12px] text-gray-400 truncate">{m.email}</p>
            </div>
            <div className="hidden sm:block text-[12px] text-gray-400 w-28">Added {fmtDate(m.createdAt)}</div>
            <Pill tone="gray">{m.role === 'admin' ? 'Admin' : 'Agent'}</Pill>
            <Pill tone={m.status === 'active' ? 'green' : 'amber'}>{m.status === 'active' ? 'Active' : 'Invited'}</Pill>
            <div className="w-28 text-right">
              {m.role === 'agent' && (
                confirming === m.sub ? (
                  <span className="inline-flex gap-2">
                    <button onClick={() => remove(m.sub)}
                            className="text-[12px] font-semibold text-red-600 hover:underline">Confirm</button>
                    <button onClick={() => setConfirming(null)}
                            className="text-[12px] text-gray-400 hover:underline">Cancel</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirming(m.sub)}
                          className="text-[12px] text-gray-400 hover:text-red-600 hover:underline">Remove</button>
                )
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
