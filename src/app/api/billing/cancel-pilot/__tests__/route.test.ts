import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCookieGet, mockSend } = vi.hoisted(() => ({
  mockCookieGet: vi.fn(),
  mockSend:      vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookieGet }) }))

vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockSend }),
  TABLE:        'daai-insure-orgs',
}))

vi.mock('@/lib/token', () => ({ verifyJwtClaims: vi.fn() }))

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  UpdateCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Update', input } }),
}))

import { verifyJwtClaims } from '@/lib/token'
import { POST } from '../route'

const ORG_ID = 'org-abc123'
const admin  = { sub: 'admin-1', email: 'boss@org.com', exp: 9999999999, 'custom:org_id': ORG_ID, 'custom:role': 'admin' }

describe('POST /api/billing/cancel-pilot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockReset()
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
    vi.mocked(verifyJwtClaims).mockResolvedValue(admin)
    mockSend.mockResolvedValue({})
  })

  it('returns 401 with no cookie and 403 with no org', async () => {
    mockCookieGet.mockReturnValue(undefined)
    expect((await POST()).status).toBe(401)

    mockCookieGet.mockReturnValue({ value: 't' })
    vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'x', email: 'x@y.com', exp: 9999999999 })
    expect((await POST()).status).toBe(403)
  })

  it('refuses an invited member: only the admin can cancel', async () => {
    vi.mocked(verifyJwtClaims).mockResolvedValue({ ...admin, 'custom:role': 'agent' })
    expect((await POST()).status).toBe(403)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('marks the caller\'s own org cancelled, only if its pilot is still running', async () => {
    const res = await POST()

    expect(res.status).toBe(200)
    const update = mockSend.mock.calls[0][0].input
    expect(update.Key).toEqual({ PK: `ORG#${ORG_ID}`, SK: 'PROFILE' })
    expect(update.ExpressionAttributeValues).toEqual({ ':cancelled': 'cancelled', ':active': 'active' })
    expect(update.ConditionExpression).toBe('trial_status = :active')
  })

  it('will not cancel a pilot that already converted or was already cancelled', async () => {
    mockSend.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'ConditionalCheckFailedException' }))
    const res = await POST()

    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Only a running pilot can be cancelled.')
  })

  it('returns a generic error, not internals, if the write fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('boom'))
    const res = await POST()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toMatch(/boom/)
  })
})
