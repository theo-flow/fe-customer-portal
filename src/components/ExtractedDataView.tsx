import type { Field as SchemaField, FieldFlag } from './FieldInput'

export interface ExtractionData {
  fields:            Record<string, string>
  schemaFields:       SchemaField[]
  aiResolvedFields:   string[]
  flaggedFields:      string[]
  unresolvedFields:   string[]
}

const FLAG_BADGE: Record<FieldFlag, { text: string; className: string }> = {
  ai:             { text: 'AI-matched',     className: 'border-indigo-200 text-indigo-600' },
  low_confidence: { text: 'Low confidence', className: 'border-amber-300 text-amber-600' },
  missing:        { text: 'Not found',      className: 'border-red-200 text-red-500' },
}

function flagFor(key: string, data: ExtractionData): FieldFlag | undefined {
  if (data.unresolvedFields.includes(key))  return 'missing'
  if (data.aiResolvedFields.includes(key))  return 'ai'
  if (data.flaggedFields.includes(key))     return 'low_confidence'
  return undefined
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function labelFor(key: string, schemaFields: SchemaField[]): string {
  return schemaFields.find(f => f.key === key)?.label ?? humanizeKey(key)
}

// Every field the pipeline classified and extracted -- matched, flagged,
// AI-resolved, or unmatched -- rendered read-only, at every status, the
// moment the data exists. This is the "return, unconditional" half of
// docs/decode-redesign.md Phase 1: seeing the data is never gated behind a
// status or an action. Confirm/correct/clarify (PartialReviewPanel) is a
// separate, additive layer that only applies while pipelineStatus is
// PARTIAL -- it edits on top of this, it doesn't gate it.
export default function ExtractedDataView({ data }: { data: ExtractionData }) {
  const knownKeys = new Set(Object.keys(data.fields))
  const missingSchemaFields = data.schemaFields.filter(f => !knownKeys.has(f.key))

  const rows = [
    ...Object.entries(data.fields)
      .filter(([key]) => key !== '__tables__')
      .map(([key, value]) => ({
        key, value, label: labelFor(key, data.schemaFields), flag: flagFor(key, data),
      })),
    ...missingSchemaFields.map(f => ({
      key: f.key, value: '', label: f.label, flag: 'missing' as FieldFlag,
    })),
  ]

  if (rows.length === 0) return null

  return (
    <div className="border border-black/[0.08] rounded-2xl p-5 mb-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-4">
        Extracted data
      </p>
      <div className="divide-y divide-black/[0.04]">
        {rows.map(row => {
          const badge = row.flag ? FLAG_BADGE[row.flag] : null
          return (
            <div key={row.key} className="py-2.5 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] text-gray-400">{row.label}</p>
                <p className={`text-[13px] mt-0.5 ${row.value ? 'text-black' : 'text-gray-300 italic'}`}>
                  {row.value || 'No value extracted'}
                </p>
              </div>
              {badge && (
                <span className={`flex-shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full
                                  border leading-none whitespace-nowrap ${badge.className}`}>
                  {badge.text}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
