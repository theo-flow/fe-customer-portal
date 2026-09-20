import { describe, it, expect } from 'vitest'
import { addOneMonth, isoUtc } from '../dates'

describe('isoUtc', () => {
  it('writes the same shape fn-16 does: UTC, whole seconds, +00:00', () => {
    expect(isoUtc(new Date('2026-10-10T12:00:00.789Z'))).toBe('2026-10-10T12:00:00+00:00')
  })
})

// Mirrors the cases in fn-16's tests for _add_one_month.
describe('addOneMonth', () => {
  const add = (iso: string) => isoUtc(addOneMonth(new Date(iso)))

  it('moves to the same day next month', () => {
    expect(add('2026-07-01T00:00:00Z')).toBe('2026-08-01T00:00:00+00:00')
    expect(add('2026-10-10T12:30:15Z')).toBe('2026-11-10T12:30:15+00:00')
  })

  it('rolls the year over', () => {
    expect(add('2026-12-01T00:00:00Z')).toBe('2027-01-01T00:00:00+00:00')
  })

  it('clamps to the last day of a shorter month instead of spilling into the next', () => {
    expect(add('2026-01-31T00:00:00Z')).toBe('2026-02-28T00:00:00+00:00')
    expect(add('2028-01-31T00:00:00Z')).toBe('2028-02-29T00:00:00+00:00')
    expect(add('2026-12-31T00:00:00Z')).toBe('2027-01-31T00:00:00+00:00')
    expect(add('2026-03-31T00:00:00Z')).toBe('2026-04-30T00:00:00+00:00')
  })
})
