'use client'
import { useOrg } from '@/lib/org-context'
import { FileBrowser } from './FileBrowser'

export default function GateKeepPage() {
  const { orgName, loading } = useOrg()

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map(i => (
          <div key={i} className="h-[100px] animate-pulse rounded-2xl border border-black/[0.06] bg-gray-50"/>
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
          {orgName} · Gate-Keep
        </p>
        <h1 className="font-display text-[2.1rem] leading-tight text-black">Your files</h1>
        <p className="mt-1 text-[13px] text-gray-400">
          Keep your documents safe and organised in folders. Upload as many as you like.
        </p>
      </div>

      <FileBrowser />
    </div>
  )
}
