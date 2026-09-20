import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCookieGet, mockDdbSend } = vi.hoisted(() => ({
  mockCookieGet: vi.fn(),
  mockDdbSend:   vi.fn(),
}))

const { mockAudit } = vi.hoisted(() => ({ mockAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/audit', () => ({ writeAudit: mockAudit }))

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookieGet }) }))

vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockDdbSend }),
  TABLE:        'daai-insure-orgs',
}))

vi.mock('@/lib/token', () => ({ verifyJwtClaims: vi.fn() }))

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand:    vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
  UpdateCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Update', input } }),
}))

import { verifyJwtClaims } from '@/lib/token'
import { POST } from '../route'

const ORG_ID = 'org-abc123'
const claims = { sub: 'agent-1', email: 'jane@org.com', exp: 9999999999, 'custom:org_id': ORG_ID, 'custom:role': 'agent' }

describe('POST /api/team/activate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
    vi.mocked(verifyJwtClaims).mockResolvedValue(claims)
    mockDdbSend.mockResolvedValue({})
  })

  it('returns 401 with no cookie and 403 with no org', async () => {
    mockCookieGet.mockReturnValue(undefined)
    expect((await POST()).status).toBe(401)

    mockCookieGet.mockReturnValue({ value: 't' })
    vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'x', email: 'x@y.com', exp: 9999999999 })
    expect((await POST()).status).toBe(403)
  })

  it('flips only the caller\'s own invited records to active', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: { status: 'invited' } })
    const res = await POST()

    expect(res.status).toBe(200)
    const updates = mockDdbSend.mock.calls.slice(1).map(c => c[0].input)
    expect(updates[0].Key).toEqual({ PK: 'USER#agent-1', SK: 'ORG_MEMBERSHIP' })
    expect(updates[1].Key).toEqual({ PK: `ORG#${ORG_ID}`, SK: 'MEMBER#agent-1' })
    expect(updates[0].ExpressionAttributeValues[':active']).toBe('active')
  })

  it('does nothing for someone who is already active (or was removed)', async () => {
    for (const status of ['active', 'removed']) {
      mockDdbSend.mockClear()
      mockDdbSend.mockResolvedValueOnce({ Item: { status } })
      expect((await POST()).status).toBe(200)
      expect(mockDdbSend).toHaveBeenCalledTimes(1)
    }
  })


  it('records when an invited agent joins, but not for someone already active', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: { status: 'active' } })
    await POST()
    expect(mockAudit).not.toHaveBeenCalled()

    mockDdbSend.mockResolvedValueOnce({ Item: { status: 'invited' } })
    await POST()
    expect(mockAudit).toHaveBeenCalledTimes(1)
    expect(mockAudit).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ sub: 'agent-1' }), 'team.joined')
  })
})
