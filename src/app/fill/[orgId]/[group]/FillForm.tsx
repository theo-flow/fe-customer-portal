'use client'
import { useState } from 'react'
import { validateField } from '@/lib/validators'
import FieldInput, { type Field } from '@/components/FieldInput'
import PositionedFormCanvas from '@/components/PositionedFormCanvas'

interface SubmitResult {
  success: boolean
  referenceId?: string
  errors?: Record<string, string>
}

export default function FillForm({ orgId, group, groupLabel, fields, brandColor, preview, recipientId, recipientToken }: {
  orgId:      string
  group:      string
  groupLabel: string
  fields:     Field[]
  brandColor?: string | null
  // Read-only preview of an unpublished version -- renders exactly like the
  // live form but never calls the public submit API, so it can't create a
  // real Harvest submission for a form that isn't actually live yet.
  preview?:   boolean
  // When present, this is a recipient-matched link (see fill/[orgId]/[group]/
  // [recipientId]/[token]/page.tsx) -- submit goes to the recipient-aware
  // route instead of the anonymous one. Absent (today's default usage),
  // behavior is unchanged.
  recipientId?:    string
  recipientToken?: string
}) {
  const [values, setValues]     = useState<Record<string, string>>(
    Object.fromEntries(fields.map(f => [f.key, '']))
  )
  const [errors, setErrors]     = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult]     = useState<SubmitResult | null>(null)

  function setValue(key: string, val: string) {
    setValues(prev => ({ ...prev, [key]: val }))
    if (errors[key]) setErrors(prev => { const e = { ...prev }; delete e[key]; return e })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (preview) return
    setResult(null)

    // Client-side validation first
    const clientErrors: Record<string, string> = {}
    for (const field of fields) {
      const err = validateField(field.field_type, values[field.key] ?? '', field.required, field.label)
      if (err) clientErrors[field.key] = err
    }
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors)
      return
    }

    setSubmitting(true)
    setErrors({})

    try {
      const submitUrl = recipientId && recipientToken
        ? `/api/public/forms/${orgId}/${group}/${recipientId}/${recipientToken}/submit`
        : `/api/public/forms/${orgId}/${group}/submit`
      const res = await fetch(submitUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ values }),
      })
      const data = await res.json()

      if (res.ok) {
        setResult({ success: true, referenceId: data.referenceId })
      } else if (res.status === 422 && data.errors) {
        setErrors(data.errors)
        setResult(null)
      } else {
        setResult({ success: false })
      }
    } catch {
      setResult({ success: false })
    } finally {
      setSubmitting(false)
    }
  }

  if (result?.success) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-5">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24"
               stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
          </svg>
        </div>
        <h2 className="text-[20px] font-semibold text-black mb-2">Submitted successfully</h2>
        <p className="text-[14px] text-gray-500 mb-1">Your response has been received.</p>
        {result.referenceId && (
          <p className="text-[12px] text-gray-400 font-mono">Ref: {result.referenceId}</p>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {/* Mobile: the original clean stacked list -- absolute positioning
          from PositionedFormCanvas isn't legible at this width, and a
          plain list is also just more usable for actual mobile filling. */}
      <div className="md:hidden space-y-5">
        {fields.map(field => (
          <FieldInput
            key={field.key}
            field={field}
            value={values[field.key] ?? ''}
            error={errors[field.key]}
            onChange={val => setValue(field.key, val)}
          />
        ))}
      </div>

      {/* Desktop/tablet: fields laid out at their real extracted positions,
          so the form actually resembles the original document. */}
      <div className="hidden md:block">
        <PositionedFormCanvas
          fields={fields}
          values={values}
          errors={errors}
          onChange={setValue}
          brandColor={brandColor}
        />
      </div>

      {result?.success === false && (
        <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-[13px] text-red-700">
          Something went wrong. Please try again.
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || preview}
        style={brandColor && !preview ? { backgroundColor: brandColor } : undefined}
        title={preview ? 'This is a preview — publish this version to accept real submissions' : undefined}
        className={`w-full py-3.5 rounded-xl text-white text-[14px] font-semibold
                   transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                   ${brandColor && !preview ? '' : 'bg-black hover:bg-gray-800 active:bg-gray-900'}`}>
        {preview ? 'Preview — submission disabled' : submitting ? 'Submitting…' : 'Submit'}
      </button>
    </form>
  )
}
