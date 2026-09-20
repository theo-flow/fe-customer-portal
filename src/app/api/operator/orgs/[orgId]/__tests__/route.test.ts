import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

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
vi.mock('@/lib/operator', () => ({ isOperatorEmail: (e: string) => e === 'ops@theoflow.co.za' }))

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  UpdateCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Update', input } }),
}))

import { verifyJwtClaims } from '@/lib/token'
import { PATCH } from '../route'

const operator = { sub: 'op-1', email: 'ops@theoflow.co.za', exp: 9999999999 }

function call(body: unknown, orgId = 'org-1') {
  return PATCH({ json: async () => body } as unknown as NextRequest, { params: { orgId } })
}

describe('PATCH /api/operator/orgs/[orgId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
    vi.mocked(verifyJwtClaims).mockResolvedValue(operator)
    mockSend.mockResolvedValue({})
  })

  it('returns 403 to an org admin who is not an operator', async () => {
    vi.mocked(verifyJwtClaims).mockResolvedValue({ ...operator, email: 'boss@org.com', 'custom:org_id': 'org-1', 'custom:role': 'admin' })
    expect((await call({ subscribedProducts: ['sign'] })).status).toBe(403)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('rejects a missing or malformed product list', async () => {
    expect((await call({})).status).toBe(400)
    expect((await call({ subscribedProducts: 'sign' })).status).toBe(400)
    expect((await call({ subscribedProducts: ['nonsense'] })).status).toBe(400)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('does not accept seats: those come from the plan now', async () => {
    const res = await call({ subscribedProducts: ['sign'], seatsPurchased: 50 })
    expect(res.status).toBe(200)
    const update = mockSend.mock.calls[0][0].input
    expect(update.UpdateExpression).toBe('SET subscribed_products = :p')
    expect(update.ExpressionAttributeValues).not.toHaveProperty(':seats')
  })

  it('updates the product list on the org profile', async () => {
    const res = await call({ subscribedProducts: ['sign', 'forge'] })
    expect(res.status).toBe(200)
    const update = mockSend.mock.calls[0][0].input
    expect(update.Key).toEqual({ PK: 'ORG#org-1', SK: 'PROFILE' })
    expect(update.ExpressionAttributeValues[':p']).toEqual(['sign', 'forge'])
  })

  it('returns 404 rather than creating a stray profile for an unknown org', async () => {
    mockSend.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'ConditionalCheckFailedException' }))
    const res = await call({ subscribedProducts: ['sign'] }, 'org-typo')
    expect(res.status).toBe(404)
  })
})
