import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Hoist mock references so they're accessible inside vi.mock factory ── */
const { mockNext, mockRedirect, mockCookiesDelete } = vi.hoisted(() => {
  const mockCookiesDelete = vi.fn()
  return {
    mockCookiesDelete,
    mockNext:     vi.fn(() => ({ type: 'next' })),
    mockRedirect: vi.fn((url: URL) => ({
      type: 'redirect', url: url.toString(), cookies: { delete: mockCookiesDelete },
    })),
  }
})

vi.mock('next/server', () => ({
  NextResponse: { next: mockNext, redirect: mockRedirect },
}))

import { middleware } from '../middleware'

/* ── Helper: build a real base64url-encoded JWT shape with a given exp ──
   The real middleware decodes payload -> exp via atob, so a bare string
   like the old 'valid-jwt-token' fixture is *always* treated as expired
   (atob throws on non-base64 input, caught, isExpired returns true) --
   that was silently masked before because the test suite was importing a
   stale, dead root-level middleware.ts instead of this real one. ── */
function makeToken(expiresInSeconds: number): string {
  const payload = { sub: 'user-1', exp: Math.floor(Date.now() / 1000) + expiresInSeconds }
  const b64url = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${b64url}.signature`
}

const VALID_TOKEN   = () => makeToken(3600)   // expires an hour from now
const EXPIRED_TOKEN  = () => makeToken(-10)    // expired 10s ago

/* ── Helper: build a minimal NextRequest-like object ── */
function makeRequest(pathname: string, token?: string) {
  return {
    nextUrl: { pathname },
    cookies: {
      get: (name: string) => (name === 'tf_token' && token ? { value: token } : undefined),
    },
    url: `http://localhost:3000${pathname}`,
  } as unknown as Parameters<typeof middleware>[0]
}

describe('middleware — protected routes', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('redirects unauthenticated users from /upload to /login', () => {
    middleware(makeRequest('/upload'))
    expect(mockRedirect).toHaveBeenCalledTimes(1)
    const redirectUrl = mockRedirect.mock.calls[0][0].toString()
    expect(redirectUrl).toContain('/login')
  })

  it('redirects unauthenticated users from /dashboard to /login', () => {
    middleware(makeRequest('/dashboard'))
    expect(mockRedirect).toHaveBeenCalledTimes(1)
    expect(mockRedirect.mock.calls[0][0].toString()).toContain('/login')
  })

  it('redirects unauthenticated users from /status/:id to /login', () => {
    middleware(makeRequest('/status/abc-123'))
    expect(mockRedirect).toHaveBeenCalledTimes(1)
    expect(mockRedirect.mock.calls[0][0].toString()).toContain('/login')
  })

  it('includes ?next= param so login can redirect back', () => {
    middleware(makeRequest('/upload'))
    const url = mockRedirect.mock.calls[0][0] as URL
    expect(url.searchParams.get('next')).toBe('/upload')
  })

  it('does not set reason=expired when there was never a token', () => {
    middleware(makeRequest('/upload'))
    const url = mockRedirect.mock.calls[0][0] as URL
    expect(url.searchParams.get('reason')).toBeNull()
  })

  it('does not attempt to clear a cookie that was never set', () => {
    middleware(makeRequest('/upload'))
    expect(mockCookiesDelete).not.toHaveBeenCalled()
  })

  it('allows authenticated users to access /upload', () => {
    middleware(makeRequest('/upload', VALID_TOKEN()))
    expect(mockNext).toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('allows authenticated users to access /dashboard', () => {
    middleware(makeRequest('/dashboard', VALID_TOKEN()))
    expect(mockNext).toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('redirects users with an expired token from /upload to /login', () => {
    middleware(makeRequest('/upload', EXPIRED_TOKEN()))
    expect(mockRedirect).toHaveBeenCalledTimes(1)
    expect(mockRedirect.mock.calls[0][0].toString()).toContain('/login')
  })

  it('sets reason=expired when the token was present but expired', () => {
    middleware(makeRequest('/upload', EXPIRED_TOKEN()))
    const url = mockRedirect.mock.calls[0][0] as URL
    expect(url.searchParams.get('reason')).toBe('expired')
  })

  it('still includes ?next= alongside reason=expired', () => {
    middleware(makeRequest('/upload', EXPIRED_TOKEN()))
    const url = mockRedirect.mock.calls[0][0] as URL
    expect(url.searchParams.get('next')).toBe('/upload')
  })

  it('clears the stale tf_token cookie on the redirect response when expired', () => {
    middleware(makeRequest('/upload', EXPIRED_TOKEN()))
    expect(mockCookiesDelete).toHaveBeenCalledWith('tf_token')
  })
})

describe('middleware — auth pages', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('redirects already-authenticated users away from /login to /dashboard', () => {
    middleware(makeRequest('/login', VALID_TOKEN()))
    expect(mockRedirect).toHaveBeenCalledTimes(1)
    expect(mockRedirect.mock.calls[0][0].toString()).toContain('/dashboard')
  })

  it('redirects already-authenticated users away from /register to /dashboard', () => {
    middleware(makeRequest('/register', VALID_TOKEN()))
    expect(mockRedirect).toHaveBeenCalledTimes(1)
    expect(mockRedirect.mock.calls[0][0].toString()).toContain('/dashboard')
  })

  it('allows unauthenticated users to access /login', () => {
    middleware(makeRequest('/login'))
    expect(mockNext).toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('allows unauthenticated users to access /register', () => {
    middleware(makeRequest('/register'))
    expect(mockNext).toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('treats an expired token as unauthenticated -- does not bounce away from /login', () => {
    middleware(makeRequest('/login', EXPIRED_TOKEN()))
    expect(mockNext).toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})
