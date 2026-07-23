import { describe, it, expect, afterEach } from 'vitest'
import { decodeJwtClaims, initialsFromName } from '../token'

function makeToken(claims: object): string {
  const b64url = (s: string) => {
    const binary = Array.from(new TextEncoder().encode(s), b => String.fromCharCode(b)).join('')
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  return `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify(claims))}.sig`
}

describe('decodeJwtClaims', () => {
  it('decodes a well-formed token', () => {
    const token = makeToken({ sub: 'user-1', email: 'a@b.com', exp: 123 })
    expect(decodeJwtClaims(token)).toMatchObject({ sub: 'user-1', email: 'a@b.com', exp: 123 })
  })

  it('decodes multi-byte UTF-8 claims correctly', () => {
    const token = makeToken({ sub: 'user-1', name: 'Renée Müller', exp: 123 })
    expect(decodeJwtClaims(token).name).toBe('Renée Müller')
  })

  it('returns zeroed claims (not a throw) on a malformed token', () => {
    expect(decodeJwtClaims('not-a-jwt')).toEqual({ sub: '', email: '', exp: 0 })
  })

  // Regression test: decodeJwtClaims must not depend on the Node-only
  // `Buffer` global. SessionWatcher.tsx calls this client-side, where
  // Buffer is undefined in a real browser (no polyfill in this app) --
  // Vitest normally masks that because it runs under Node, where Buffer
  // genuinely exists. Removing it here forces the test to fail the way a
  // real browser would if this regresses to a Buffer-based implementation.
  describe('without the Node Buffer global (simulates a real browser)', () => {
    const originalBuffer = globalThis.Buffer
    afterEach(() => { globalThis.Buffer = originalBuffer })

    it('still decodes correctly', () => {
      // @ts-expect-error -- deliberately simulating a browser environment
      delete globalThis.Buffer
      const token = makeToken({ sub: 'user-1', email: 'a@b.com', exp: 123 })
      expect(decodeJwtClaims(token)).toMatchObject({ sub: 'user-1', email: 'a@b.com', exp: 123 })
    })
  })
})

describe('initialsFromName', () => {
  it('uses first and last initial when a name is present', () => {
    expect(initialsFromName('Jane Doe', 'jane@example.com')).toBe('JD')
  })

  it('falls back to email when name is absent', () => {
    expect(initialsFromName(undefined, 'jane@example.com')).toBe('JA')
  })
})
