import type { Field } from '@/components/FieldInput'

// Forge records the printed heading each field sits under (`section`) and any
// larger printed part containing it (`section_group`, e.g. "Section A"). A form
// is drawn as its printed blocks only when those are present; older forms and
// forms with no headings keep the existing layout.
export interface FormBlock {
  group:     string | null
  title:     string | null
  showGroup: boolean   // print the group heading once, above its first block
  fields:    Field[]
}

export function hasSections(fields: Field[]): boolean {
  return fields.some(f => Boolean(f.section) || Boolean(f.section_group))
}

// Consecutive fields under the same (group, heading) are one block, in printed
// order. A box with no heading (e.g. a stand-alone "surplus/deficit" box) is its
// own block with no title bar.
export function buildBlocks(fields: Field[]): FormBlock[] {
  const blocks: FormBlock[] = []
  for (const f of fields) {
    const group = f.section_group ?? null
    const title = f.section ?? null
    const last  = blocks[blocks.length - 1]
    if (last && last.group === group && last.title === title) {
      last.fields.push(f)
    } else {
      blocks.push({ group, title, showGroup: false, fields: [f] })
    }
  }
  let prevGroup: string | null | undefined
  for (const b of blocks) {
    b.showGroup = Boolean(b.group) && b.group !== prevGroup
    prevGroup = b.group
  }
  return blocks
}

// Two columns, filled in printed order: the left column takes blocks until it
// holds half the rows, the rest go right. On a narrow screen the two columns
// stack, which keeps the printed order.
export function splitColumns(blocks: FormBlock[]): [FormBlock[], FormBlock[]] {
  const half = blocks.reduce((n, b) => n + b.fields.length, 0) / 2
  const left: FormBlock[] = []
  const right: FormBlock[] = []
  let running = 0
  for (const b of blocks) {
    (running < half ? left : right).push(b)
    running += b.fields.length
  }
  return [left, right]
}
