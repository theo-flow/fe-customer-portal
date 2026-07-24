import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'

const { mockVerify } = vi.hoisted(() => ({ mockVerify: vi.fn() }))

vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: () => ({ verify: mockVerify }) },
}))

import { decodeJwtClaims, initialsFromName, verifyJwtClaims } from '../token'

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

describe('verifyJwtClaims', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the verified payload when the signature checks out', async () => {
    mockVerify.mockResolvedValueOnce({ sub: 'user-1', email: 'a@b.com', exp: 123 })
    const claims = await verifyJwtClaims('a.b.c')
    expect(claims).toMatchObject({ sub: 'user-1', email: 'a@b.com' })
  })

  it('returns null (not a throw) when signature verification fails', async () => {
    mockVerify.mockRejectedValueOnce(new Error('invalid signature'))
    const claims = await verifyJwtClaims('forged.token.here')
    expect(claims).toBeNull()
  })

  it('returns null for a malformed token', async () => {
    mockVerify.mockRejectedValueOnce(new Error('not a valid JWT'))
    const claims = await verifyJwtClaims('not-a-jwt')
    expect(claims).toBeNull()
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
