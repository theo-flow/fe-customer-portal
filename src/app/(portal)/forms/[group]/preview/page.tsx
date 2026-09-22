'use client'
import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'

// The version-numbered page (./[version]/page.tsx) is the only place that
// actually renders a preview -- this route exists so there is exactly one
// stable link ("Preview" on the Forms page) that always lands on the
// CURRENT version, instead of someone having to know or guess which of
// several forged version numbers is the latest. Re-forging a template
// (e.g. while still configuring a form) creates a new immutable version
// every time; History intentionally keeps every one of those browsable,
// but that list is not meant to be how you find "what does the form look
// like right now" -- this page is.
export default function LatestPreviewRedirect() {
  const router = useRouter()
  const { group } = useParams<{ group: string }>()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/forms/${group}`)
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Failed to load this form')
        return r.json()
      })
      .then(({ schema }) => {
        if (cancelled) return
        const latest = schema?.latest_version as number | undefined
        if (!latest || latest < 1) {
          setError('This form has not been forged yet.')
          return
        }
        router.replace(`/forms/${group}/preview/${latest}`)
      })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [group, router])

  return (
    <div className="max-w-lg mx-auto py-16 text-center">
      {error ? (
        <>
          <p className="text-[15px] font-semibold text-black mb-1">Can&apos;t open the preview</p>
          <p className="text-[13px] text-gray-400">{error}</p>
        </>
      ) : (
        <div className="h-64 rounded-2xl border border-black/[0.06] animate-pulse bg-gray-50" />
      )}
    </div>
  )
}
