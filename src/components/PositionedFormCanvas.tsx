'use client'
import FieldInput, { type Field } from '@/components/FieldInput'

// Textract's bounding box marks the printed LABEL text on the original
// document, not the blank/answer space beside it -- a physical form packs
// a label tight against its line with far less vertical room than a real
// input control (border, padding, touch target) needs. Placing fields at
// literal x/y percentages inside a fixed-height page box therefore
// overlaps on any reasonably dense form. So position only decides READING
// ORDER and same-row grouping here; actual layout is a flex-wrap flow,
// which can never overlap no matter how tightly packed the source was.
const MIN_FIELD_WIDTH = 0.15
const ROW_THRESHOLD   = 0.025

interface Props {
  fields:     Field[]
  values:     Record<string, string>
  errors:     Record<string, string>
  onChange:   (key: string, value: string) => void
  brandColor?: string | null
}

function groupIntoRows(pageFields: Field[]): Field[][] {
  const sorted = [...pageFields].sort((a, b) => a.position!.y - b.position!.y)
  const rows: Field[][] = []
  for (const field of sorted) {
    const lastRow = rows[rows.length - 1]
    const rowY = lastRow?.[0].position!.y
    if (lastRow && Math.abs(field.position!.y - rowY!) <= ROW_THRESHOLD) {
      lastRow.push(field)
    } else {
      rows.push([field])
    }
  }
  for (const row of rows) row.sort((a, b) => a.position!.x - b.position!.x)
  return rows
}

export default function PositionedFormCanvas({ fields, values, errors, onChange, brandColor }: Props) {
  const positioned: Field[] = []
  const unpositioned: Field[] = []

  for (const f of fields) {
    const p = f.position
    if (p && Number.isFinite(p.page) && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      positioned.push(f)
    } else {
      unpositioned.push(f)
    }
  }

  const pageNumbers = Array.from(new Set(positioned.map(f => f.position!.page))).sort((a, b) => a - b)

  return (
    <div className="space-y-6">
      {pageNumbers.map(page => {
        const rows = groupIntoRows(positioned.filter(f => f.position!.page === page))
        return (
          <div key={page}>
            {pageNumbers.length > 1 && (
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-400 mb-2">
                Page {page}
              </p>
            )}
            <div
              className="w-full bg-white border border-black/[0.08] rounded-2xl shadow-sm p-5 space-y-4"
              style={{
                borderTopWidth: brandColor ? '4px' : undefined,
                borderTopColor: brandColor ?? undefined,
              }}
            >
              {rows.map((row, i) => (
                <div key={i} className="flex flex-wrap gap-3">
                  {row.map(field => (
                    <div
                      key={field.key}
                      className="flex-grow"
                      style={{ flexBasis: `${Math.min(Math.max(field.position!.width, MIN_FIELD_WIDTH), 1) * 100}%` }}
                    >
                      <FieldInput
                        field={field}
                        value={values[field.key] ?? ''}
                        error={errors[field.key]}
                        onChange={val => onChange(field.key, val)}
                        compact
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {unpositioned.length > 0 && (
        <div className="space-y-5 pt-2">
          {pageNumbers.length > 0 && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-400">
              Additional fields
            </p>
          )}
          {unpositioned.map(field => (
            <FieldInput
              key={field.key}
              field={field}
              value={values[field.key] ?? ''}
              error={errors[field.key]}
              onChange={val => onChange(field.key, val)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
