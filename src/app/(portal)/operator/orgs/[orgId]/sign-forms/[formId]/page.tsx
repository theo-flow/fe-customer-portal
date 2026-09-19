'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import type { EditorInitial } from './SignFormEditor'

// pdfjs cannot be evaluated during server rendering, so the editor is loaded
// in the browser only. Same pattern the signer page uses for its document view.
const SignFormEditor = dynamic(() => import('./SignFormEditor'), {
  ssr: false,
  loading: () => <div className="rounded-2xl border border-black/[0.06] h-96 animate-pulse bg-gray-50" />,
})

export default function SignFormEditorPage() {
  const params = useParams()
  const orgId  = params.orgId as string
  const formId = params.formId as string

  const [data, setData]           = useState<EditorInitial | null>(null)
  const [loading, setLoading]     = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [missing, setMissing]     = useState(false)

  useEffect(() => {
    fetch(`/api/operator/orgs/${orgId}/sign-forms/${formId}`)
      .then(async r => {
        if (r.status === 401 || r.status === 403) { setForbidden(true); return }
        if (r.status === 404) { setMissing(true); return }
        if (r.ok) {
          const d = await r.json()
          setData({ version: d.version, valid: d.valid, sampleUrl: d.sampleUrl, layout: d.layout })
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [orgId, formId])

  if (loading) return <div className="rounded-2xl border border-black/[0.06] h-64 animate-pulse bg-gray-50" />

  if (forbidden) {
    return (
      <div className="rounded-2xl border border-black/[0.06] py-20 text-center">
        <p className="text-[15px] font-semibold text-black mb-1">Not authorized</p>
        <p className="text-[13px] text-gray-400">This page is restricted to platform operators.</p>
      </div>
    )
  }

  if (missing || !data) {
    return (
      <div className="rounded-2xl border border-black/[0.06] py-20 text-center">
        <p className="text-[13px] text-gray-400">{missing ? 'Form not found.' : 'Could not load this form.'}</p>
        <Link href={`/operator/orgs/${orgId}/sign-forms`} className="text-[12px] font-medium text-indigo-500 mt-2 inline-block">Back to forms</Link>
      </div>
    )
  }

  return (
    <div>
      <Link href={`/operator/orgs/${orgId}/sign-forms`} className="text-[12px] font-medium text-gray-400 hover:text-black">
        ← Back to Sign forms
      </Link>
      <div className="mt-4 mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-1">TheoFlow Sign · Set up a form</p>
        <h1 className="font-display text-[2.1rem] leading-tight text-black">{data.layout.name}</h1>
        <p className="text-[13px] text-gray-400 mt-1">
          Add the roles, then click on the pages where each person has to initial, sign, date or say where they signed.
        </p>
      </div>
      <SignFormEditor orgId={orgId} formId={formId} initial={data} />
    </div>
  )
}
