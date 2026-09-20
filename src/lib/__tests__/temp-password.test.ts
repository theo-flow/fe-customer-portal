import { describe, it, expect } from 'vitest'
import { generateTempPassword } from '../temp-password'

describe('generateTempPassword', () => {
  it('meets the user pool policy every time', () => {
    for (let i = 0; i < 200; i++) {
      const p = generateTempPassword()
      expect(p).toMatch(/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{12,}$/)
      expect(p).not.toMatch(/[01OlI]/)
    }
  })

  it('is different each time', () => {
    expect(new Set(Array.from({ length: 50 }, () => generateTempPassword())).size).toBe(50)
  })
})
