'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useOrg } from '@/lib/org-context'
import { computeSeatCharge, docsIncludedFor, MAX_SEATS } from '@/lib/seat-pricing'

interface PlanState {
  state:          'trial' | 'active' | 'locked'
  trialDays:      number
  trialEndsAt:    string | null
  daysLeft:       number | null
  seats:          number
  canManage:      boolean
  bands:          { label: string; priceZar: number }[]
  docsPerSeat:    number
  overageRateZar: number
}

function zar(n: number): string {
  return `R${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

export default function ChooseSeatsPage() {
  const { refetch } = useOrg()
  const [data, setData]         = useState<PlanState | null>(null)
  const [loading, setLoading]   = useState(true)
  const [seatCount, setSeatCount] = useState('1')
  const [confirming, setConfirming] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError]       = useState('')
  const [done, setDone]         = useState<{ seats: number; monthlyTotalZar: number } | null>(null)

  useEffect(() => {
    fetch('/api/billing/plans')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const seats  = Number(seatCount)
  const valid  = Number.isInteger(seats) && seats >= 1 && seats <= MAX_SEATS
  const charge = valid ? computeSeatCharge(seats) : null

  async function start() {
    setError('')
    setStarting(true)
    try {
      const res  = await fetch('/api/billing/subscribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ seats }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error ?? 'Could not start the paid plan. Please try again.'); return }
      setDone({ seats: body.seats, monthlyTotalZar: body.monthlyTotalZar })
      setConfirming(false)
      refetch()   // unlock the products straight away if the org was locked
    } catch {
      setError('Could not start the paid plan. Please try again.')
    } finally {
      setStarting(false)
    }
  }

  if (loading) {
    return <div className="rounded-2xl border border-black/[0.06] h-64 animate-pulse bg-gray-50"/>
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-black/[0.06] py-20 text-center">
        <p className="text-[13px] text-gray-400">Could not load pricing. Please try again.</p>
      </div>
    )
  }

  return (
    <div className="max-w-[640px]">
      <Link href="/billing" className="text-[12px] font-medium text-gray-400 hover:text-black">
        ← Back to billing
      </Link>

      <div className="mt-4 mb-8">
        <h1 className="font-display text-[2.1rem] leading-tight text-black">Choose your seats</h1>
        <p className="text-[13px] text-gray-400 mt-1">
          Every seat includes all six products and {data.docsPerSeat} documents a month.
        </p>
      </div>

      {done ? (
        <div role="status" className="px-5 py-5 rounded-2xl border border-green-200 bg-green-50 text-[13px] text-green-800">
          <p className="font-semibold">You are on the Starter plan.</p>
          <p className="mt-1">
            {done.seats} seat{done.seats !== 1 ? 's' : ''} at {zar(done.monthlyTotalZar)} a month. Your first
            invoice will be emailed to you within a day, and settles by EFT.
          </p>
          <Link href="/team" className="inline-block mt-3 font-semibold underline">Go to your team</Link>
        </div>
      ) : data.state === 'active' ? (
        <div className="rounded-2xl border border-black/[0.08] px-5 py-5 text-[13px] text-gray-600">
          You are already on the Starter plan with {data.seats} seat{data.seats !== 1 ? 's' : ''}.{' '}
          <Link href="/team" className="font-semibold text-black underline">Change your seats</Link>
        </div>
      ) : (
        <>
          {!data.canManage && (
            <div className="mb-6 px-5 py-4 rounded-2xl border border-black/[0.08] text-[13px] text-gray-500">
              Only your organisation admin can start the paid plan.
            </div>
          )}
          {error && (
            <div role="alert" className="mb-6 px-5 py-4 rounded-2xl border border-red-200 bg-red-50 text-[13px] text-red-700">
              {error}
            </div>
          )}

          <div className="rounded-2xl border border-black/[0.1] p-6">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-3">Price of each seat</p>
            <table className="w-full text-[13px] mb-6">
              <tbody className="divide-y divide-black/[0.06]">
                {data.bands.map(b => (
                  <tr key={b.label}>
                    <td className="py-2 text-gray-600">{b.label}</td>
                    <td className="py-2 text-right font-medium text-black">{zar(b.priceZar)} each</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <label className="block mb-4">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Number of seats</span>
              <input type="number" min={1} max={MAX_SEATS} step={1} value={seatCount}
                     onChange={e => { setSeatCount(e.target.value); setConfirming(false) }}
                     disabled={!data.canManage}
                     className="w-28 rounded-xl border border-black/[0.12] px-3.5 py-2.5 text-[14px] disabled:bg-gray-50"/>
            </label>

            {charge ? (
              <div className="rounded-xl bg-gray-50 px-4 py-3 mb-5 text-[13px]">
                {charge.lines.map(l => (
                  <p key={l.unitPriceZar} className="flex justify-between text-gray-500">
                    <span>{l.seats} seat{l.seats !== 1 ? 's' : ''} at {zar(l.unitPriceZar)}</span>
                    <span>{zar(l.subtotalZar)}</span>
                  </p>
                ))}
                <p className="flex justify-between font-semibold text-black mt-2 pt-2 border-t border-black/[0.06]">
                  <span>Per month</span><span>{zar(charge.totalZar)}</span>
                </p>
                <p className="text-[12px] text-gray-400 mt-2">
                  Includes {docsIncludedFor(seats)} documents a month, then {zar(data.overageRateZar)} each.
                </p>
              </div>
            ) : (
              <p className="text-[12px] text-red-600 mb-5">Enter a whole number of seats from 1 to {MAX_SEATS}.</p>
            )}

            {data.canManage && (
              confirming ? (
                <div>
                  <p className="text-[12px] text-gray-500 mb-3">
                    Start the Starter plan now with {seats} seat{seats !== 1 ? 's' : ''} at {charge ? zar(charge.totalZar) : ''} a month,
                    invoiced by EFT. Your first invoice follows within a day.
                  </p>
                  <div className="flex gap-2">
                    <button onClick={start} disabled={starting}
                            className="px-5 py-2 rounded-full text-[13px] font-medium text-white bg-black hover:bg-black/85 disabled:opacity-50">
                      {starting ? 'Starting…' : 'Confirm and start'}
                    </button>
                    <button onClick={() => setConfirming(false)} disabled={starting}
                            className="px-4 py-2 text-[13px] text-gray-400 hover:text-black">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => { setError(''); setConfirming(true) }} disabled={!valid}
                        className="px-5 py-2 rounded-full text-[13px] font-medium text-white bg-black hover:bg-black/85 transition-colors disabled:opacity-40">
                  {data.state === 'locked' ? 'Restart on the paid plan' : 'Start paid plan now'}
                </button>
              )
            )}
          </div>

          {data.state === 'trial' && data.daysLeft !== null && (
            <p className="mt-4 text-[12px] text-gray-400">
              You do not have to do this yet. Your pilot has {data.daysLeft} day{data.daysLeft !== 1 ? 's' : ''} left,
              and then moves to Starter with one seat automatically.
            </p>
          )}
        </>
      )}
    </div>
  )
}
