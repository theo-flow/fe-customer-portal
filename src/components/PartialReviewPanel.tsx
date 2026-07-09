'use client'
import { useState } from 'react'
import FieldInput, { type Field, type FieldFlag } from './FieldInput'
import { validateField } from '@/lib/validators'

export interface ReviewData {
  fields:            Record<string, string>
  schemaFields:       Field[]
  aiResolvedFields:   string[]
  flaggedFields:      string[]
  unresolvedFields:   string[]
}

const NUMBER_RE = /^-?\d+(\.\d+)?$/

// Mirrors the accept route's server-side validateAgainstSchema -- gives
// instant feedback before the round trip, the server re-checks regardless.
function clientValidate(field: Field, value: string): string | null {
  const err = validateField(field.field_type, value, field.required, field.label)
  if (err) return err
  if (!value || !value.trim()) return null

  if (field.field_type === 'select' && field.options && !field.options.includes(value)) {
    return `${field.label} must be one of the allowed options`
  }
  if (field.field_type === 'number' && !NUMBER_RE.test(value.trim())) {
    return `${field.label} must be a valid number`
  }
  if (field.field_type === 'checkbox' && !['true', 'false'].includes(value.trim().toLowerCase())) {
    return `${field.label} must be checked or unchecked`
  }
  return null
}

function flagFor(key: string, review: ReviewData): FieldFlag | undefined {
  if (review.aiResolvedFields.includes(key))   return 'ai'
  if (review.unresolvedFields.includes(key))   return 'missing'
  if (review.flaggedFields.includes(key))      return 'low_confidence'
  return undefined
}

export default function PartialReviewPanel({ docId, review, onAccepted }: {
  docId:      string
  review:     ReviewData
  onAccepted: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(review.schemaFields.map(f => [f.key, review.fields[f.key] ?? '']))
  )
  const [errors, setErrors]           = useState<Record<string, string>>({})
  const [submitting, setSubmitting]   = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  function setValue(key: string, val: string) {
    setValues(prev => ({ ...prev, [key]: val }))
    if (errors[key]) setErrors(prev => { const e = { ...prev }; delete e[key]; return e })
  }

  async function handleAccept() {
    setSubmitError(null)

    const clientErrors: Record<string, string> = {}
    for (const field of review.schemaFields) {
      const err = clientValidate(field, values[field.key] ?? '')
      if (err) clientErrors[field.key] = err
    }
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors)
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/status/${docId}/accept`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ fields: values }),
      })
      const data = await res.json()
      if (res.ok) {
        onAccepted()
      } else if (res.status === 422 && data.errors) {
        setErrors(data.errors)
      } else {
        setSubmitError(data.error ?? 'Failed to accept submission.')
      }
    } catch {
      setSubmitError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="border border-amber-200 bg-amber-50/40 rounded-2xl p-5 mb-8 space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-600 mb-1">
          Needs your review
        </p>
        <p className="text-[12px] text-gray-500 leading-snug">
          Some fields were matched by AI, are low-confidence, or couldn&apos;t be found.
          Review and correct them below, then accept to continue.
        </p>
      </div>

      <div className="space-y-4">
        {review.schemaFields.map(field => (
          <FieldInput
            key={field.key}
            field={field}
            value={values[field.key] ?? ''}
            error={errors[field.key]}
            onChange={val => setValue(field.key, val)}
            flag={flagFor(field.key, review)}
          />
        ))}
      </div>

      {submitError && <p className="text-[12px] text-red-500">{submitError}</p>}

      <button
        type="button"
        onClick={handleAccept}
        disabled={submitting}
        className="w-full py-3 rounded-xl bg-black text-white text-[13px] font-semibold
                   hover:bg-gray-900 transition-colors disabled:opacity-50">
        {submitting ? 'Accepting…' : 'Accept and continue'}
      </button>
    </div>
  )
}
