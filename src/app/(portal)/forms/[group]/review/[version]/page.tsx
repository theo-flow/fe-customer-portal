'use client'
import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useOrg } from '@/lib/org-context'
import { VALID_FIELD_TYPES, type FormField, type ReviewNote } from '@/lib/forms-types'

interface VersionData {
  version:     number
  groupLabel:  string
  status:      string
  fields:      FormField[]
  reviewNotes: ReviewNote[]
}

// Reasons come from fn-00-template-analyser as free-text (self-reported model
// notes, or a description of why two extraction passes disagreed) -- not a
// fixed enum, so this just makes the raw string a bit more readable rather
// than trying to map every possible reason.
function humanizeReason(reason: string): string {
  return reason.replace(/_/g, ' ')
}

function fieldTypeLabel(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, ' ')
}

export default function ReviewVersionPage() {
  const { formGroups } = useOrg()
  const { group, version } = useParams<{ group: string; version: string }>()
  const router = useRouter()

  const [data, setData]           = useState<VersionData | null>(null)
  const [fields, setFields]       = useState<FormField[]>([])
  const [optionsText, setOptionsText] = useState<Record<string, string>>({})
  const [loading, setLoading]     = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting]   = useState(false)

  useEffect(() => {
    fetch(`/api/forms/${group}/versions/${version}`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.error ?? 'Failed to load this version.')
        }
        return r.json() as Promise<VersionData>
      })
      .then(d => {
        setData(d)
        setFields(d.fields)
        const initialOptionsText: Record<string, string> = {}
        for (const f of d.fields) {
          if (f.field_type === 'select') initialOptionsText[f.key] = (f.options ?? []).join('\n')
        }
        setOptionsText(initialOptionsText)
      })
      .catch(e => setLoadError(e.message))
      .finally(() => setLoading(false))
  }, [group, version])

  const flaggedKeys = useMemo(
    () => new Set((data?.reviewNotes ?? []).map(n => n.key)),
    [data],
  )
  const reasonFor = useMemo(
    () => new Map((data?.reviewNotes ?? []).map(n => [n.key, n.reason])),
    [data],
  )

  const groupLabel = formGroups.find(fg => fg.group === group)?.groupLabel ?? group

  function updateField(key: string, patch: Partial<FormField>) {
    setFields(prev => prev.map(f => f.key === key ? { ...f, ...patch } : f))
  }

  function validate(): string | null {
    for (const f of fields) {
      if (!flaggedKeys.has(f.key)) continue
      if (!f.label.trim()) return `"${f.key}" needs a label.`
      if (f.field_type === 'select') {
        const opts = (optionsText[f.key] ?? '').split('\n').map(s => s.trim()).filter(Boolean)
        if (opts.length === 0) return `"${f.label || f.key}" is a select field but has no options.`
      }
    }
    return null
  }

  async function handleSubmit() {
    setSubmitError(null)
    const validationError = validate()
    if (validationError) { setSubmitError(validationError); return }

    const finalFields = fields.map(f => {
      if (!flaggedKeys.has(f.key)) return f
      if (f.field_type === 'select') {
        return { ...f, options: (optionsText[f.key] ?? '').split('\n').map(s => s.trim()).filter(Boolean) }
      }
      return { ...f, options: null }
    })

    setSubmitting(true)
    try {
      const res = await fetch(`/api/forms/${group}/versions/${version}/review`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ fields: finalFields }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setSubmitError(body.error ?? 'Failed to submit review.')
        return
      }
      router.push(`/forms/${group}/history`)
    } catch {
      setSubmitError('Something went wrong — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto py-16">
        <div className="h-64 rounded-2xl border border-black/[0.06] animate-pulse bg-gray-50"/>
      </div>
    )
  }

  if (loadError || !data) {
    return (
      <div className="max-w-lg mx-auto py-16 text-center">
        <p className="text-[15px] font-semibold text-black mb-1">Can't load this version</p>
        <p className="text-[13px] text-gray-400 mb-6">{loadError}</p>
        <Link href={`/forms/${group}/history`}
              className="text-[12px] font-medium text-gray-400 hover:text-black transition-colors">
          ← Back to history
        </Link>
      </div>
    )
  }

  if (data.status !== 'NEEDS_REVIEW') {
    return (
      <div className="max-w-lg mx-auto py-16 text-center">
        <p className="text-[15px] font-semibold text-black mb-1">This version has already been reviewed</p>
        <p className="text-[13px] text-gray-400 mb-6">
          Its status is now {data.status.toLowerCase().replace('_', ' ')}.
        </p>
        <Link href={`/forms/${group}/history`}
              className="text-[12px] font-medium text-gray-400 hover:text-black transition-colors">
          ← Back to history
        </Link>
      </div>
    )
  }

  const flagged   = fields.filter(f => flaggedKeys.has(f.key))
  const unflagged = fields.filter(f => !flaggedKeys.has(f.key))

  return (
    <div className="max-w-2xl mx-auto">
      <Link href={`/forms/${group}/history`} className="text-[12px] font-medium text-gray-400 hover:text-black transition-colors">
        ← Back to history
      </Link>

      <div className="mt-4 mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-1">
          {groupLabel} · v{data.version}
        </p>
        <h1 className="font-display text-[1.8rem] leading-tight text-black">Review flagged fields</h1>
        <p className="text-[13px] text-gray-400 mt-1">
          {flagged.length} field{flagged.length !== 1 ? 's' : ''} need{flagged.length === 1 ? 's' : ''} review
          before this version can be published. Confirm or correct them below.
        </p>
      </div>

      {submitError && (
        <div className="mb-5 px-4 py-3 rounded-xl text-[13px] text-red-600 bg-red-50 border border-red-100">
          {submitError}
        </div>
      )}

      <div className="space-y-4 mb-8">
        {flagged.map(f => (
          <div key={f.key} className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <p className="text-[11px] font-mono text-gray-400">{f.key}</p>
              <p className="text-[11px] text-amber-700 font-medium text-right">
                {humanizeReason(reasonFor.get(f.key) ?? 'flagged for review')}
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Label</label>
                <input
                  type="text" value={f.label}
                  onChange={e => updateField(f.key, { label: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-black/[0.12] text-[13px] outline-none focus:border-black/40"
                />
              </div>

              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Field type</label>
                  <select
                    value={f.field_type}
                    onChange={e => updateField(f.key, { field_type: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-black/[0.12] text-[13px] outline-none focus:border-black/40 bg-white"
                  >
                    {VALID_FIELD_TYPES.map(t => (
                      <option key={t} value={t}>{fieldTypeLabel(t)}</option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 pt-5 flex-shrink-0">
                  <input
                    type="checkbox" checked={f.required}
                    onChange={e => updateField(f.key, { required: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 accent-black"
                  />
                  <span className="text-[12px] font-medium text-gray-600">Required</span>
                </label>
              </div>

              {f.field_type === 'select' && (
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                    Options (one per line)
                  </label>
                  <textarea
                    value={optionsText[f.key] ?? ''}
                    onChange={e => setOptionsText(prev => ({ ...prev, [f.key]: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-black/[0.12] text-[13px] outline-none focus:border-black/40 min-h-[72px]"
                  />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {unflagged.length > 0 && (
        <div className="mb-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-3">
            {unflagged.length} other field{unflagged.length !== 1 ? 's' : ''} (already resolved)
          </p>
          <div className="rounded-2xl border border-black/[0.06] divide-y divide-black/[0.04]">
            {unflagged.map(f => (
              <div key={f.key} className="flex items-center justify-between px-4 py-2.5">
                <p className="text-[13px] text-gray-500">{f.label}</p>
                <p className="text-[11px] text-gray-300">{fieldTypeLabel(f.field_type)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full py-3 rounded-xl bg-black text-white text-[13px] font-semibold
                   hover:bg-gray-900 transition-colors disabled:opacity-50"
      >
        {submitting ? 'Saving…' : 'Mark as reviewed'}
      </button>
    </div>
  )
}
