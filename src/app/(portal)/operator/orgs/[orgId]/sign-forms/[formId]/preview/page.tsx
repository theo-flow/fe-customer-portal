'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import type { FormLayout } from '@/lib/sign-form'

// pdfjs runs in the browser only (same pattern as the editor and the signing page).
const SignFormPreview = dynamic(() => import('@/components/SignFormPreview'), {
  ssr: false,
  loading: () => <div className="rounded-2xl border border-black/[0.06] h-96 animate-pulse bg-gray-50" />,
})

export default function SignFormPreviewPage() {
  const params = useParams()
  const orgId  = params.orgId as string
  const formId = params.formId as string
  const [data, setData] = useState<{ sampleUrl: string; layout: FormLayout; version: number } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/operator/orgs/${orgId}/sign-forms/${formId}`)
      .then(async r => {
        if (r.status === 404) { setProblem('This form was not found.'); return }
        if (!r.ok) { setProblem(r.status === 401 || r.status === 403 ? 'You do not have access to this form.' : 'This form could not be loaded. Reload the page to try again.'); return }
        setData(await r.json())
      })
      .catch(() => setProblem('This form could not be loaded. Reload the page to try again.'))
  }, [orgId, formId])

  return (
    <div>
      <Link href={`/operator/orgs/${orgId}/sign-forms/${formId}`} className="text-[12px] font-medium text-gray-400 hover:text-black">&larr; Back to the form</Link>
      <div className="mt-4 mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-1">TheoFlow Sign &middot; Preview</p>
        <h1 className="font-display text-[2.1rem] leading-tight text-black">{data?.layout.name ?? 'Form preview'}</h1>
        {data && <p className="text-[13px] text-gray-400 mt-1">Version {data.version}. This is exactly what is sent when the form goes out.</p>}
      </div>
      {problem && <p role="alert" className="text-[13px] text-red-600">{problem}</p>}
      {!problem && !data && <div className="rounded-2xl border border-black/[0.06] h-96 animate-pulse bg-gray-50" />}
      {data && <SignFormPreview sampleUrl={data.sampleUrl} layout={data.layout} />}
    </div>
  )
}
