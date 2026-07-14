export interface FieldPosition {
  page:   number
  x:      number
  y:      number
  width:  number
  height: number
}

export interface Field {
  key:        string
  label:      string
  field_type: string
  required:   boolean
  options:    string[] | null
  // Normalized (0.0-1.0) Textract bounding box, present on every field
  // extracted since Module 8 -- used to lay the form out like the
  // original document instead of a generic linear list. Absent on older/
  // migrated records, which fall back to the linear list entirely.
  position?:  FieldPosition
}

export type FieldFlag = 'ai' | 'missing' | 'low_confidence'

const FLAG_COPY: Record<FieldFlag, string> = {
  ai:              'AI-matched — please confirm',
  missing:         'Not found — please fill in',
  low_confidence:  'Low-confidence match — please confirm',
}

export default function FieldInput({ field, value, error, onChange, flag, compact }: {
  field:    Field
  value:    string
  error?:   string
  onChange: (val: string) => void
  flag?:    FieldFlag
  // Tighter label/spacing for use inside a small positioned chip on
  // PositionedFormCanvas -- same input/validation behavior, less chrome.
  compact?: boolean
}) {
  const base = `w-full rounded-xl border bg-white outline-none transition-all
               ${compact ? 'px-2.5 py-1.5 text-[13px]' : 'px-4 py-3 text-[14px]'}
               ${error
                 ? 'border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-100'
                 : flag
                 ? 'border-amber-300 focus:border-amber-400 focus:ring-2 focus:ring-amber-100'
                 : 'border-black/[0.12] focus:border-black/40 focus:ring-2 focus:ring-black/5'}`

  const label = (
    <label className={`block font-medium text-black ${compact ? 'text-[11px] mb-0.5 truncate' : 'text-[13px] mb-1.5'}`}>
      {field.label}
      {field.required && <span className="text-red-500 ml-1">*</span>}
      {!compact && flag && <span className="ml-2 text-[11px] font-normal text-amber-600">⚠ {FLAG_COPY[flag]}</span>}
      {!compact && !flag && !error && <span className="ml-2 text-[11px] font-normal text-green-600">✓</span>}
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
          {flag && <span className="ml-2 text-[11px] font-normal text-amber-600">⚠ {FLAG_COPY[flag]}</span>}
        </label>
      </div>
    )
  } else if (field.field_type === 'textarea') {
    input = (
      <textarea
        className={`${base} ${compact ? 'min-h-[48px]' : 'min-h-[96px]'} resize-y`}
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
    <div className={compact ? 'w-full' : undefined}>
      {label}
      {input}
      {error && <p className={`text-red-500 ${compact ? 'mt-0.5 text-[10px]' : 'mt-1.5 text-[12px]'}`}>{error}</p>}
    </div>
  )
}
