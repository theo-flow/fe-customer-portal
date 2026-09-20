import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

const { mockCookieGet, mockSend, mockAccess } = vi.hoisted(() => ({
  mockCookieGet: vi.fn(),
  mockSend:      vi.fn(),
  mockAccess:    vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookieGet }) }))

vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockSend }),
  TABLE:        'daai-insure-orgs',
}))

vi.mock('@/lib/token', () => ({ verifyJwtClaims: vi.fn() }))
vi.mock('@/lib/org-access', () => ({ orgAccess: mockAccess }))

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand:    vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
  PutCommand:    vi.fn(function (this: unknown, input: unknown) { return { __type: 'Put', input } }),
  UpdateCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Update', input } }),
}))

import { verifyJwtClaims } from '@/lib/token'
import { POST } from '../route'

const ORG_ID = 'org-abc123'
const admin  = { sub: 'admin-1', email: 'boss@org.com', exp: 9999999999, 'custom:org_id': ORG_ID, 'custom:role': 'admin' }
const call   = (seats: unknown) => POST({ json: async () => ({ seats }) } as unknown as NextRequest)

describe('POST /api/billing/subscribe: start the paid plan now', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockReset()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'))
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
    vi.mocked(verifyJwtClaims).mockResolvedValue(admin)
    mockAccess.mockResolvedValue({ state: 'trial' })
    mockSend.mockResolvedValue({})
  })
  afterEach(() => vi.useRealTimers())

  it('returns 401 with no cookie', async () => {
    mockCookieGet.mockReturnValue(undefined)
    expect((await call(1)).status).toBe(401)
  })

  it('refuses an invited member and changes nothing', async () => {
    vi.mocked(verifyJwtClaims).mockResolvedValue({ ...admin, 'custom:role': 'agent' })
    expect((await call(1)).status).toBe(403)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('rejects anything that is not a whole number of seats in range', async () => {
    for (const bad of [0, -1, 2.5, 501, '3', null, undefined]) expect((await call(bad)).status).toBe(400)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('creates the Subscription due for its first invoice now, and marks the pilot converted', async () => {
    mockSend.mockResolvedValueOnce({})                         // no subscription yet
    const res = await call(5)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, seats: 5, monthlyTotalZar: 2450 })

    const put = mockSend.mock.calls[1][0].input
    expect(put.Item).toMatchObject({
      PK: `ORG#${ORG_ID}`, SK: 'SUBSCRIPTION', org_id: ORG_ID, plan_id: 'starter', status: 'active',
      billing_period_start: '2026-10-10T12:00:00+00:00',
      billing_period_end:   '2026-11-10T12:00:00+00:00',
      next_invoice_at:      '2026-10-10T12:00:00+00:00',
    })
    expect(put.ConditionExpression).toBe('attribute_not_exists(PK)')

    const profile = mockSend.mock.calls[2][0].input
    expect(profile.Key).toEqual({ PK: `ORG#${ORG_ID}`, SK: 'PROFILE' })
    expect(profile.ExpressionAttributeValues).toEqual({ ':seats': 5, ':converted': 'converted' })
  })

  it('takes the org from the login, never from the request', async () => {
    mockSend.mockResolvedValueOnce({})
    await POST({ json: async () => ({ seats: 1, orgId: 'org-someone-else' }) } as unknown as NextRequest)
    for (const c of mockSend.mock.calls) {
      const input = c[0].input
      expect((input.Key ?? input.Item).PK).toBe(`ORG#${ORG_ID}`)
    }
  })

  it('lets a locked org come back, reviving a cancelled subscription', async () => {
    mockAccess.mockResolvedValue({ state: 'locked' })
    mockSend.mockResolvedValueOnce({ Item: { status: 'cancelled' } })

    const res = await call(2)

    expect(res.status).toBe(200)
    const update = mockSend.mock.calls[1][0].input
    expect(update.ConditionExpression).toBe('#st = :cancelled')
    expect(update.ExpressionAttributeValues[':active']).toBe('active')
    expect(update.ExpressionAttributeValues[':now']).toBe('2026-10-10T12:00:00+00:00')
  })

  it('will not start it twice for an org already on the paid plan', async () => {
    mockAccess.mockResolvedValue({ state: 'active' })
    const res = await call(3)

    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/Change your seats from Team/)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('returns 409 if the plan changed while the admin was deciding', async () => {
    mockSend.mockResolvedValueOnce({}).mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'ConditionalCheckFailedException' }))
    expect((await call(1)).status).toBe(409)
  })

  it('returns a generic error, not internals, if a write fails', async () => {
    mockSend.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('boom'))
    const res = await call(1)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toMatch(/boom/)
  })
})
