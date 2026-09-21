import { describe, it, expect } from 'vitest'
import { sanitizeNumeric } from '../numeric-input'

describe('sanitizeNumeric currency', () => {
  it('keeps digits and one decimal point', () => {
    expect(sanitizeNumeric('1500.75', 'currency')).toBe('1500.75')
  })
  it('drops letters, spaces, currency symbols and minus', () => {
    expect(sanitizeNumeric('R 1 500abc', 'currency')).toBe('1500')
    expect(sanitizeNumeric('-25', 'currency')).toBe('25')
  })
  it('turns a comma decimal into a point', () => {
    expect(sanitizeNumeric('12,5', 'currency')).toBe('12.5')
  })
  it('keeps only the first decimal point', () => {
    expect(sanitizeNumeric('1.2.3', 'currency')).toBe('1.23')
    expect(sanitizeNumeric('1..5', 'currency')).toBe('1.5')
  })
  it('allows a trailing point while typing', () => {
    expect(sanitizeNumeric('10.', 'currency')).toBe('10.')
  })
  it('allows an empty box', () => {
    expect(sanitizeNumeric('', 'currency')).toBe('')
  })
})

describe('sanitizeNumeric number', () => {
  it('keeps digits only, including leading zeros', () => {
    expect(sanitizeNumeric('00123', 'number')).toBe('00123')
    expect(sanitizeNumeric('12a3.4', 'number')).toBe('1234')
  })
})
