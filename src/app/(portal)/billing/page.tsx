'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useOrg } from '@/lib/org-context'

// ── Types ──────────────────────────────────────────────────────────────────

interface SubscriptionData {
  planName: string
  status: string
  billingPeriodStart: string
  billingPeriodEnd: string
  docsIncluded: number
  overageRateZar: number
  docsUsed: number
  overageDocs: number
  estimatedOverageZar: number
  seats: number
  seatLines: { seats: number; unitPriceZar: number; subtotalZar: number }[]
  seatsChargeZar: number
  estimatedTotalZar: number
}

interface PlanState {
  state: 'trial' | 'active' | 'locked'
  trialEndsAt: string | null
  daysLeft: number | null
  seats: number
  monthlyTotalZar: number
}

interface Invoice {
  period: string
  planId: string
  docsIncluded: number
  docsUsed: number
  overageDocs: number
  seats: number
  seatsAmountZar: number
  totalAmountZar: number
  currency: string
  status: string
  createdAt: string
  paidAt: string | null
  downloadUrl: string | null
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function zar(n: number): string {
  return `R${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const config: Record<string, string> = {
    draft: 'bg-gray-50 text-gray-600 border-gray-200',
    sent:  'bg-amber-50 text-amber-700 border-amber-200',
    paid:  'bg-green-50 text-green-700 border-green-200',
  }
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${config[status] ?? config.draft}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

const BUTTON = 'inline-block px-5 py-2 rounded-full text-[13px] font-medium text-white bg-black hover:bg-black/85 transition-colors'

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BillingPage() {
  // Changing the plan is an admin action; the server refuses everyone else, and
  // the buttons are hidden so an invited member isn't offered something they can't do.
  const { role, refetch } = useOrg()
  const isAdmin = role === 'admin'
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null)
  const [plan, setPlan] = useState<PlanState | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() =>
    Promise.all([
      fetch('/api/billing/subscription').then(r => r.ok ? r.json() : { subscription: null }),
      fetch('/api/billing/invoices').then(r => r.ok ? r.json() : { items: [] }),
      fetch('/api/billing/plans').then(r => r.ok ? r.json() : null),
    ])
      .then(([subRes, invRes, planRes]) => {
        setSubscription(subRes.subscription)
        setInvoices(invRes.items ?? [])
        setPlan(planRes)
      })
      .catch(() => {})
      .finally(() => setLoading(false)),
  [])

  useEffect(() => { load() }, [load])

  async function cancelPilot() {
    setError('')
    setCancelling(true)
    try {
      const res = await fetch('/api/billing/cancel-pilot', { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Could not cancel. Please try again.')
        return
      }
      setConfirmingCancel(false)
      await load()
      refetch()   // the lock screen depends on this
    } catch {
      setError('Could not cancel. Please try again.')
    } finally {
      setCancelling(false)
    }
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4">
        <div className="rounded-2xl border border-black/[0.06] h-40 animate-pulse bg-gray-50" />
        <div className="rounded-2xl border border-black/[0.06] h-64 animate-pulse bg-gray-50" />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-[2.1rem] leading-tight text-black">Billing</h1>
        <p className="text-[13px] text-gray-400 mt-1">
          Invoiced monthly and settled by EFT, not a card-on-file subscription.
        </p>
      </div>

      {error && (
        <div role="alert" className="mb-6 px-5 py-4 rounded-2xl border border-red-200 bg-red-50 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {/* Pilot */}
      {plan?.state === 'trial' && !subscription && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-6 mb-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-amber-700 mb-0.5">Free pilot</p>
          <h2 className="text-[18px] font-semibold text-amber-950">
            {plan.daysLeft === null
              ? 'You are on the free pilot'
              : plan.daysLeft === 0
                ? 'Your pilot ends today'
                : `${plan.daysLeft} day${plan.daysLeft !== 1 ? 's' : ''} left in your pilot`}
          </h2>
          {plan.trialEndsAt && (
            <p className="text-[12px] text-amber-800 mt-0.5">Ends {fmtDate(plan.trialEndsAt)}</p>
          )}
          {plan.trialEndsAt ? (
            <p className="text-[13px] text-amber-900 mt-3 max-w-xl">
              When it ends you move to the Starter plan and get your first invoice, R500 a month for one seat.
              We email you before then. Cancel any time before it ends and you will not be charged.
            </p>
          ) : (
            <p className="text-[13px] text-amber-900 mt-3 max-w-xl">
              This organisation has no pilot end date, so nothing is charged automatically.
              You can start the paid plan whenever you like.
            </p>
          )}
          {isAdmin && (
            <div className="mt-5 flex items-center gap-3 flex-wrap">
              <Link href="/billing/upgrade" className={BUTTON}>Start paid plan now</Link>
              {confirmingCancel ? (
                <span className="inline-flex items-center gap-3 text-[13px]">
                  <span className="text-amber-900">Your products lock until you start the paid plan.</span>
                  <button onClick={cancelPilot} disabled={cancelling}
                          className="font-semibold text-red-700 hover:underline disabled:opacity-50">
                    {cancelling ? 'Cancelling…' : 'Confirm cancel'}
                  </button>
                  <button onClick={() => setConfirmingCancel(false)} disabled={cancelling}
                          className="text-amber-800 hover:underline">Keep pilot</button>
                </span>
              ) : (
                <button onClick={() => setConfirmingCancel(true)}
                        className="text-[13px] text-amber-800 hover:text-red-700 hover:underline">
                  Cancel pilot
                </button>
              )}
            </div>
          )}
          {!isAdmin && (
            <p className="mt-4 text-[13px] text-amber-800">Ask your organisation admin to manage the plan.</p>
          )}
        </div>
      )}

      {/* Locked */}
      {plan?.state === 'locked' && (
        <div className="rounded-2xl border border-black/[0.1] px-6 py-8 mb-8 text-center">
          <p className="text-[15px] font-semibold text-black mb-1">Your products are locked</p>
          <p className="text-[13px] text-gray-400 mb-5">Your data is kept. Start the paid plan to carry on where you left off.</p>
          {isAdmin
            ? <Link href="/billing/upgrade" className={BUTTON}>Start paid plan</Link>
            : <p className="text-[13px] text-gray-400">Ask your organisation admin to start the paid plan.</p>}
        </div>
      )}

      {/* Paid */}
      {subscription && (
        <div className="rounded-2xl border border-black/[0.1] px-6 py-6 mb-8">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-400 mb-0.5">
                Current plan
              </p>
              <h2 className="text-[18px] font-semibold text-black">{subscription.planName}</h2>
              <p className="text-[12px] text-gray-400 mt-0.5">
                {fmtDate(subscription.billingPeriodStart)} - {fmtDate(subscription.billingPeriodEnd)}
              </p>
            </div>
            <div className="text-right">
              <p className="font-display text-[1.6rem] leading-none text-black">
                {zar(subscription.seatsChargeZar)}
              </p>
              <p className="text-[11px] text-gray-400 mt-1">
                {subscription.seats} seat{subscription.seats !== 1 ? 's' : ''} / month
              </p>
            </div>
          </div>

          {/* Usage progress */}
          <div className="mb-2 flex items-center justify-between text-[12px]">
            <span className="text-gray-500">
              {subscription.docsUsed} / {subscription.docsIncluded} documents used this period
            </span>
            {subscription.overageDocs > 0 && (
              <span className="font-medium text-amber-600">
                +{subscription.overageDocs} overage · {zar(subscription.estimatedOverageZar)} est.
              </span>
            )}
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div
              className={`h-full rounded-full ${subscription.overageDocs > 0 ? 'bg-amber-400' : 'bg-black'}`}
              style={{
                width: `${Math.min(100, (subscription.docsUsed / Math.max(1, subscription.docsIncluded)) * 100)}%`,
              }}
            />
          </div>

          <div className="mt-5 pt-4 border-t border-black/[0.06] text-[12px]">
            {subscription.seatLines.map(line => (
              <p key={line.unitPriceZar} className="flex justify-between text-gray-500">
                <span>{line.seats} seat{line.seats !== 1 ? 's' : ''} at {zar(line.unitPriceZar)}</span>
                <span>{zar(line.subtotalZar)}</span>
              </p>
            ))}
            <p className="flex justify-between font-medium text-black mt-2">
              <span>Estimated this period</span>
              <span>{zar(subscription.estimatedTotalZar)}</span>
            </p>
          </div>

          {isAdmin && (
            <div className="mt-4">
              <Link href="/team" className={BUTTON}>Change seats</Link>
            </div>
          )}

          <p className="mt-4 text-[12px] text-gray-400">
            Documents beyond your allowance are billed at R{subscription.overageRateZar.toFixed(2)} each, on your next invoice.
          </p>
        </div>
      )}

      {/* Invoice history */}
      <div>
        <h2 className="text-[14px] font-semibold text-black mb-3">Invoice history</h2>
        {invoices.length === 0 ? (
          <div className="rounded-2xl border border-black/[0.06] py-12 text-center">
            <p className="text-[13px] text-gray-400">No invoices generated yet.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-black/[0.08] overflow-hidden">
            <table className="hidden sm:table w-full text-sm">
              <thead>
                <tr className="border-b border-black/[0.06]" style={{ background: 'rgba(0,0,0,0.02)' }}>
                  {['Period', 'Seats', 'Total', 'Status', ''].map(h => (
                    <th key={h} className="text-left px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {invoices.map(inv => (
                  <tr key={inv.period} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-5 py-3.5 text-[13px] font-medium text-black">{inv.period}</td>
                    <td className="px-5 py-3.5 text-[13px] text-gray-500">
                      {inv.seats > 0 ? inv.seats : '-'}
                      {inv.overageDocs > 0 && <span className="text-amber-600"> (+{inv.overageDocs} docs)</span>}
                    </td>
                    <td className="px-5 py-3.5 text-[13px] font-medium text-black">{zar(inv.totalAmountZar)}</td>
                    <td className="px-5 py-3.5"><InvoiceStatusBadge status={inv.status} /></td>
                    <td className="px-5 py-3.5 text-right">
                      {inv.downloadUrl ? (
                        <a href={inv.downloadUrl} target="_blank" rel="noopener noreferrer"
                          className="text-[12px] font-medium text-black hover:text-gray-400 transition-colors">
                          Download →
                        </a>
                      ) : (
                        <span className="text-[12px] text-gray-300">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="sm:hidden divide-y divide-black/[0.04]">
              {invoices.map(inv => (
                <div key={inv.period} className="px-4 py-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[13px] font-semibold text-black">{inv.period}</p>
                    <InvoiceStatusBadge status={inv.status} />
                  </div>
                  <p className="text-[12px] text-gray-400">
                    {inv.seats > 0 ? `${inv.seats} seat${inv.seats !== 1 ? 's' : ''} · ` : ''}{zar(inv.totalAmountZar)}
                  </p>
                  {inv.downloadUrl && (
                    <a href={inv.downloadUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-block mt-2 text-[12px] font-medium text-black">
                      Download →
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
