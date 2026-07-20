import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const { mockPush, mockGetAuthCookie, mockSignOut } = vi.hoisted(() => ({
  mockPush:          vi.fn(),
  mockGetAuthCookie: vi.fn(),
  mockSignOut:       vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter:   () => ({ push: mockPush }),
  usePathname: () => '/dashboard',
}))

vi.mock('@/lib/auth', () => ({
  getAuthCookie: mockGetAuthCookie,
  signOut:       mockSignOut,
}))

import SessionWatcher from '../SessionWatcher'

// Mirrors middleware.test.ts's token fixture -- a real base64url-encoded
// JWT shape with a given exp, since decodeJwtClaims actually decodes it.
function makeToken(expiresInSeconds: number): string {
  const payload = { sub: 'user-1', exp: Math.floor(Date.now() / 1000) + expiresInSeconds }
  const b64url = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${b64url}.signature`
}

describe('SessionWatcher', () => {
  beforeEach(() => { vi.clearAllMocks() })

  // Regression test for the bug: a never-authenticated user (no cookie at
  // all) was being redirected with reason=expired, identical to someone
  // whose token genuinely expired -- middleware.ts already made this
  // distinction correctly; this locks SessionWatcher to the same behavior.
  it('does not set reason=expired when there was never a token', () => {
    mockGetAuthCookie.mockReturnValue(null)
    render(<SessionWatcher />)

    expect(mockSignOut).toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalledTimes(1)
    const url = mockPush.mock.calls[0][0] as string
    expect(url).not.toContain('reason=expired')
    expect(url).toBe('/login?next=%2Fdashboard')
  })

  it('sets reason=expired when a token existed but is expired', () => {
    mockGetAuthCookie.mockReturnValue(makeToken(-10))
    render(<SessionWatcher />)

    expect(mockSignOut).toHaveBeenCalled()
    const url = mockPush.mock.calls[0][0] as string
    expect(url).toContain('reason=expired')
  })

  it('does not sign out or redirect when the token is valid', () => {
    mockGetAuthCookie.mockReturnValue(makeToken(3600))
    render(<SessionWatcher />)

    expect(mockSignOut).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })
})
