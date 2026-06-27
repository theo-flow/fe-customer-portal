import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Hoist mock references so they're accessible inside vi.mock factory ── */
const { mockNext, mockRedirect } = vi.hoisted(() => ({
  mockNext:     vi.fn(() => ({ type: 'next' })),
  mockRedirect: vi.fn((url: URL) => ({ type: 'redirect', url: url.toString() })),
}))

vi.mock('next/server', () => ({
  NextResponse: { next: mockNext, redirect: mockRedirect },
}))

import { middleware } from '../../middleware'

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

  it('allows authenticated users to access /upload', () => {
    middleware(makeRequest('/upload', 'valid-jwt-token'))
    expect(mockNext).toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('allows authenticated users to access /dashboard', () => {
    middleware(makeRequest('/dashboard', 'valid-jwt-token'))
    expect(mockNext).toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})

describe('middleware — auth pages', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('redirects already-authenticated users away from /login to /dashboard', () => {
    middleware(makeRequest('/login', 'valid-jwt-token'))
    expect(mockRedirect).toHaveBeenCalledTimes(1)
    expect(mockRedirect.mock.calls[0][0].toString()).toContain('/dashboard')
  })

  it('redirects already-authenticated users away from /register to /dashboard', () => {
    middleware(makeRequest('/register', 'valid-jwt-token'))
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
})
