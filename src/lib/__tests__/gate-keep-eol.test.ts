import { describe, it, expect } from 'vitest'
import { EOL_TAG_KEY, EOL_YEARS, eolDate, eolDays, eolTagValue, isEolYears } from '../gate-keep-eol'

describe('end-of-life periods', () => {
  it('are 5, 6 or 7 years (what can be agreed with an organisation), matching the lifecycle rules', () => {
    expect([...EOL_YEARS]).toEqual([5, 6, 7])
    expect(EOL_TAG_KEY).toBe('eol')
    expect(EOL_YEARS.map(eolTagValue)).toEqual(['5y', '6y', '7y'])
  })

  it('accepts only those periods', () => {
    for (const ok of [5, 6, 7]) expect(isEolYears(ok)).toBe(true)
    for (const bad of [0, 1, 4, 8, 10, 5.5, -5, '5', '5y', null, undefined, NaN, {}, [5]]) expect(isEolYears(bad)).toBe(false)
  })

  it('counts days exactly as the lifecycle rule does (ceil(years x 365.25)), so the date shown is the date S3 acts on', () => {
    expect(EOL_YEARS.map(eolDays)).toEqual([1827, 2192, 2557])
  })

  it('dates a file from the moment it was added', () => {
    const added = Date.UTC(2026, 8, 20, 12, 0, 0)
    expect(eolDate(added, 5).toISOString()).toBe(new Date(added + 1827 * 86_400_000).toISOString())
    expect(eolDate(added, 7).getTime()).toBeGreaterThan(eolDate(added, 5).getTime())
    expect(eolDate(added, 5).toISOString().slice(0, 10)).toBe('2031-09-21')
  })
})
