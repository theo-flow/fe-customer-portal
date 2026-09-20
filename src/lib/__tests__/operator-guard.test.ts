import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { cookie, verify } = vi.hoisted(() => ({ cookie: vi.fn(), verify: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: () => ({ get: cookie }) }))
vi.mock('@/lib/token', () => ({ verifyJwtClaims: verify }))

import { requireOperatorClaims } from '../operator-guard'

const status = (r: unknown) => (r as Response).status

describe('requireOperatorClaims', () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.OPERATOR_EMAILS = 'ops@theoflow.example, second@theoflow.example' })
  afterEach(() => { delete process.env.OPERATOR_EMAILS })

  it('401 with no session cookie', async () => {
    cookie.mockReturnValue(undefined)
    expect(status(await requireOperatorClaims())).toBe(401)
    expect(verify).not.toHaveBeenCalled()
  })

  it('401 for a token that does not verify', async () => {
    cookie.mockReturnValue({ value: 'bad' })
    verify.mockResolvedValue(null)
    expect(status(await requireOperatorClaims())).toBe(401)
  })

  it('403 for a signed-in user who is not an operator, even an org admin', async () => {
    cookie.mockReturnValue({ value: 't' })
    verify.mockResolvedValue({ sub: 'u', email: 'admin@customer.example', 'custom:role': 'admin' })
    expect(status(await requireOperatorClaims())).toBe(403)
  })

  it('returns the claims for an allowlisted operator (case-insensitive)', async () => {
    const claims = { sub: 'op', email: 'OPS@theoflow.example' }
    cookie.mockReturnValue({ value: 't' })
    verify.mockResolvedValue(claims)
    expect(await requireOperatorClaims()).toBe(claims)
  })

  it('nobody is an operator when the allowlist is empty', async () => {
    process.env.OPERATOR_EMAILS = ''
    cookie.mockReturnValue({ value: 't' })
    verify.mockResolvedValue({ sub: 'op', email: 'ops@theoflow.example' })
    expect(status(await requireOperatorClaims())).toBe(403)
  })
})
