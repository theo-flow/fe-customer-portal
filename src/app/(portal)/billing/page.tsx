'use client'
import { useState, useEffect } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

interface SubscriptionData {
  planId: string
  planName: string
  status: string
  billingPeriodStart: string
  billingPeriodEnd: string
  basePriceZar: number
  docsIncluded: number
  overageRateZar: number
  docsUsed: number
  overageDocs: number
  estimatedOverageZar: number
}

interface Invoice {
  period: string
  planId: string
  docsIncluded: number
  docsUsed: number
  overageDocs: number
  baseAmountZar: number
  overageAmountZar: number
  totalAmountZar: number
  currency: string
  status: string
  createdAt: string
  paidAt: string | null
  downloadUrl: string | null
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function zar(n: number): string {
  return `R${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/billing/subscription').then(r => r.ok ? r.json() : { subscription: null }),
      fetch('/api/billing/invoices').then(r => r.ok ? r.json() : { items: [] }),
    ])
      .then(([subRes, invRes]) => {
        setSubscription(subRes.subscription)
        setInvoices(invRes.items ?? [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

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
          Contractual, invoiced monthly — settled by EFT, not a card-on-file subscription.
        </p>
      </div>

      {!subscription ? (
        <div className="rounded-2xl border border-black/[0.06] py-20 text-center">
          <p className="text-[15px] font-semibold text-black mb-1">No active contract yet</p>
          <p className="text-[13px] text-gray-400">Contact TheoFlow to set up your subscription.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-black/[0.1] px-6 py-6 mb-8">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-400 mb-0.5">
                Current plan
              </p>
              <h2 className="text-[18px] font-semibold text-black">{subscription.planName}</h2>
              <p className="text-[12px] text-gray-400 mt-0.5">
                {fmtDate(subscription.billingPeriodStart)} – {fmtDate(subscription.billingPeriodEnd)}
              </p>
            </div>
            <div className="text-right">
              <p className="font-display text-[1.6rem] leading-none text-black">
                {zar(subscription.basePriceZar)}
              </p>
              <p className="text-[11px] text-gray-400 mt-1">base / month</p>
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

          <p className="mt-4 text-[12px] text-gray-400">
            {subscription.overageRateZar > 0
              ? `Overage billed at R${subscription.overageRateZar.toFixed(2)}/document beyond the included allowance.`
              : 'No overage billing on this plan.'}
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
                  {['Period', 'Documents', 'Total', 'Status', ''].map(h => (
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
                      {inv.docsUsed} / {inv.docsIncluded}
                      {inv.overageDocs > 0 && <span className="text-amber-600"> (+{inv.overageDocs})</span>}
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
                        <span className="text-[12px] text-gray-300">—</span>
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
                    {inv.docsUsed} / {inv.docsIncluded} documents · {zar(inv.totalAmountZar)}
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
