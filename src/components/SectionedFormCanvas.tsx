'use client'
import FieldInput, { type Field } from '@/components/FieldInput'
import { buildBlocks, splitColumns, type FormBlock } from '@/lib/form-sections'

// Draws a form the way it was printed: each printed heading is a card with its
// rows inside, cards flow into two columns on a wide screen and stack on a
// narrow one, and "Section A" / "Section B" headings sit above their first
// card. Only used when Forge recorded sections for the form (hasSections).
interface Props {
  fields:     Field[]
  values:     Record<string, string>
  errors:     Record<string, string>
  onChange:   (key: string, value: string) => void
  brandColor?: string | null
}

export default function SectionedFormCanvas({ fields, values, errors, onChange, brandColor }: Props) {
  const blocks = buildBlocks(fields)
  const [left, right] = blocks.length > 1 ? splitColumns(blocks) : [blocks, []]

  function column(list: FormBlock[]) {
    return list.map((b, i) => (
      <div key={i}>
        {b.showGroup && (
          <h2 className="text-[15px] font-semibold text-black mt-4 mb-2">({b.group})</h2>
        )}
        <section className="rounded-md border border-black/[0.14] overflow-hidden mb-3.5">
          {b.title && (
            <h3
              className="bg-gray-100 border-b border-black/[0.14] px-2.5 py-2 text-center text-[14px] font-semibold text-black"
              style={brandColor ? { borderTop: `2px solid ${brandColor}` } : undefined}
            >
              {b.title}
            </h3>
          )}
          {b.fields.map(field => (
            <div key={field.key} className="px-2.5 py-1 border-b border-black/[0.08] last:border-b-0">
              <FieldInput
                field={field}
                value={values[field.key] ?? ''}
                error={errors[field.key]}
                onChange={val => onChange(field.key, val)}
                row
              />
            </div>
          ))}
        </section>
      </div>
    ))
  }

  return (
    <div className="grid gap-5 md:grid-cols-2 items-start">
      <div>{column(left)}</div>
      {right.length > 0 && <div>{column(right)}</div>}
    </div>
  )
}
