'use client'
import { useState } from 'react'
import { validateField } from '@/lib/validators'

interface Field {
  key:        string
  label:      string
  field_type: string
  required:   boolean
  options:    string[] | null
}

interface SubmitResult {
  success: boolean
  referenceId?: string
  errors?: Record<string, string>
}

function FieldInput({ field, value, error, onChange }: {
  field:    Field
  value:    string
  error?:   string
  onChange: (val: string) => void
}) {
  const base = `w-full px-4 py-3 rounded-xl border text-[14px] bg-white outline-none transition-all
               ${error
                 ? 'border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-100'
                 : 'border-black/[0.12] focus:border-black/40 focus:ring-2 focus:ring-black/5'}`

  const label = (
    <label className="block text-[13px] font-medium text-black mb-1.5">
      {field.label}
      {field.required && <span className="text-red-500 ml-1">*</span>}
    </label>
  )

  let input: React.ReactNode

  if (field.field_type === 'select' && field.options?.length) {
    input = (
      <select className={base} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Select an option…</option>
        {field.options.map(opt => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    )
  } else if (field.field_type === 'checkbox') {
    return (
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          id={field.key}
          checked={value === 'true'}
          onChange={e => onChange(e.target.checked ? 'true' : 'false')}
          className="mt-0.5 w-4 h-4 rounded border-gray-300 accent-black"
        />
        <label htmlFor={field.key} className="text-[13px] font-medium text-black leading-snug">
          {field.label}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </label>
      </div>
    )
  } else if (field.field_type === 'textarea') {
    input = (
      <textarea
        className={`${base} min-h-[96px] resize-y`}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={field.label}
      />
    )
  } else {
    const typeMap: Record<string, string> = {
      date:     'date',
      email:    'email',
      phone:    'tel',
      number:   'number',
      currency: 'number',
      sa_id:    'text',
      text:     'text',
    }
    input = (
      <input
        type={typeMap[field.field_type] ?? 'text'}
        className={base}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={field.label}
        maxLength={field.field_type === 'sa_id' ? 13 : undefined}
        pattern={field.field_type === 'sa_id' ? '\\d{13}' : undefined}
      />
    )
  }

  return (
    <div>
      {label}
      {input}
      {error && <p className="mt-1.5 text-[12px] text-red-500">{error}</p>}
    </div>
  )
}

export default function FillForm({ orgId, group, groupLabel, fields }: {
  orgId:      string
  group:      string
  groupLabel: string
  fields:     Field[]
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
      const res = await fetch(`/api/public/forms/${orgId}/${group}/submit`, {
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
      {fields.map(field => (
        <FieldInput
          key={field.key}
          field={field}
          value={values[field.key] ?? ''}
          error={errors[field.key]}
          onChange={val => setValue(field.key, val)}
        />
      ))}

      {result?.success === false && (
        <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-[13px] text-red-700">
          Something went wrong. Please try again.
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-3.5 rounded-xl bg-black text-white text-[14px] font-semibold
                   hover:bg-gray-800 active:bg-gray-900 transition-colors disabled:opacity-50
                   disabled:cursor-not-allowed">
        {submitting ? 'Submitting…' : 'Submit'}
      </button>
    </form>
  )
}
