'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useOrg } from '@/lib/org-context'
import FillForm from '@/app/fill/[orgId]/[group]/FillForm'
import type { Field } from '@/components/FieldInput'

interface Branding {
  source:        string
  logo_s3_key?:  string
  company_name?: string | null
  slogan?:       string | null
  brand_color?:  string | null
}

interface VersionData {
  version:     number
  groupLabel:  string
  fields:      Field[]
  branding:    Branding | null
  sourceS3Key: string | null
}

function filenameFromKey(sourceS3Key: string | null): string {
  if (!sourceS3Key) return 'unknown file'
  return sourceS3Key.split('/').pop() || 'unknown file'
}

export default function PreviewVersionPage() {
  const { orgId, formGroups } = useOrg()
  const { group, version } = useParams<{ group: string; version: string }>()

  const [data, setData]       = useState<VersionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/forms/${group}/versions/${version}`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.error ?? 'Failed to load this version.')
        }
        return r.json()
      })
      .then(d => setData(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [group, version])

  const groupLabel = formGroups.find(fg => fg.group === group)?.groupLabel ?? group

  if (loading) {
    return (
      <div className="max-w-lg mx-auto py-16">
        <div className="h-64 rounded-2xl border border-black/[0.06] animate-pulse bg-gray-50"/>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="max-w-lg mx-auto py-16 text-center">
        <p className="text-[15px] font-semibold text-black mb-1">Can't preview this version</p>
        <p className="text-[13px] text-gray-400 mb-6">{error}</p>
        <Link href={`/forms/${group}/history`}
              className="text-[12px] font-medium text-gray-400 hover:text-black transition-colors">
          ← Back to history
        </Link>
      </div>
    )
  }

  const branding   = data.branding
  const hasLogo    = branding?.source === 'extracted' && branding.logo_s3_key
  const brandColor = branding?.brand_color ?? null
  const logoUrl    = hasLogo ? `/api/public/branding/${orgId}/${group}/${data.version}` : null

  return (
    <div className="max-w-lg mx-auto">
      <Link href={`/forms/${group}/history`} className="text-[12px] font-medium text-gray-400 hover:text-black transition-colors">
        ← Back to history
      </Link>

      <div className="mt-4 mb-6 rounded-2xl bg-amber-50 border border-amber-100 px-5 py-3.5">
        <p className="text-[13px] font-semibold text-amber-800">
          Preview — v{data.version} · not published
        </p>
        <p className="text-[12px] text-amber-700 mt-0.5 font-mono">
          {filenameFromKey(data.sourceS3Key)}
        </p>
        <p className="text-[12px] text-amber-700 mt-1">
          This is exactly what {groupLabel} will look like once published. Submissions are disabled here.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-black/[0.08] shadow-sm px-6 py-7"
           style={brandColor ? { borderTopWidth: '3px', borderTopColor: brandColor } : undefined}>
        <div className="flex items-center gap-3 mb-6">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={branding?.company_name ?? data.groupLabel}
                 className="h-8 max-w-[120px] object-contain rounded"/>
          ) : null}
          <div>
            <h1 className="text-[20px] font-semibold text-black leading-tight">
              {branding?.company_name || data.groupLabel}
            </h1>
            {branding?.slogan && <p className="text-[12px] text-gray-400">{branding.slogan}</p>}
          </div>
        </div>

        {data.fields.length === 0 ? (
          <p className="text-[13px] text-gray-400">No fields found in this version.</p>
        ) : (
          <FillForm
            orgId={orgId}
            group={group}
            groupLabel={data.groupLabel}
            fields={data.fields}
            brandColor={brandColor}
            preview
          />
        )}
      </div>
    </div>
  )
}
