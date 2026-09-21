import { describe, it, expect } from 'vitest'
import { buildBlocks, hasSections, splitColumns } from '../form-sections'
import type { Field } from '@/components/FieldInput'

const f = (key: string, section: string | null, group: string | null = null): Field => ({
  key, label: key, field_type: 'currency', required: false, options: null,
  section, section_group: group,
})

describe('hasSections', () => {
  it('is false for a form with no headings', () => {
    expect(hasSections([f('a', null), f('b', null)])).toBe(false)
  })
  it('is true when any field has a section or a group', () => {
    expect(hasSections([f('a', null), f('b', 'Income')])).toBe(true)
    expect(hasSections([f('a', null, 'Section A')])).toBe(true)
  })
})

describe('buildBlocks', () => {
  it('keeps the same label in two sections as two separate fields in two blocks', () => {
    const blocks = buildBlocks([
      f('income_pension', 'Total monthly income', 'Section A'),
      f('income_rent', 'Total monthly income', 'Section A'),
      f('expense_pension', 'Total monthly expenditure', 'Section A'),
    ])
    expect(blocks.map(b => b.title)).toEqual(['Total monthly income', 'Total monthly expenditure'])
    expect(blocks[0].fields.map(x => x.key)).toEqual(['income_pension', 'income_rent'])
    expect(blocks[1].fields.map(x => x.key)).toEqual(['expense_pension'])
  })

  it('prints a group heading once, above its first block only', () => {
    const blocks = buildBlocks([
      f('a', 'One', 'Section A'), f('b', 'Two', 'Section A'), f('c', 'Three', 'Section B'),
    ])
    expect(blocks.map(b => b.showGroup)).toEqual([true, false, true])
  })

  it('makes a heading-less box its own block with no title', () => {
    const blocks = buildBlocks([f('a', 'Continued', 'Section A'), f('surplus', null, 'Section A')])
    expect(blocks).toHaveLength(2)
    expect(blocks[1].title).toBeNull()
    expect(blocks[1].showGroup).toBe(false)
  })
})

describe('splitColumns', () => {
  it('fills the left column first and switches once it holds half the rows', () => {
    const blocks = buildBlocks([
      ...Array.from({ length: 11 }, (_, i) => f(`i${i}`, 'Income', 'Section A')),
      ...Array.from({ length: 23 }, (_, i) => f(`e${i}`, 'Expenditure', 'Section A')),
      ...Array.from({ length: 22 }, (_, i) => f(`c${i}`, 'Continued', 'Section B')),
    ])
    const [left, right] = splitColumns(blocks)
    expect(left.map(b => b.title)).toEqual(['Income', 'Expenditure'])
    expect(right.map(b => b.title)).toEqual(['Continued'])
  })
})
