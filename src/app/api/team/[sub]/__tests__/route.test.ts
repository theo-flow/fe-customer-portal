import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const { mockCookieGet, mockDdbSend, mockCognitoSend } = vi.hoisted(() => ({
  mockCookieGet:   vi.fn(),
  mockDdbSend:     vi.fn(),
  mockCognitoSend: vi.fn(),
}))

const { mockAudit } = vi.hoisted(() => ({ mockAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/audit', () => ({ writeAudit: mockAudit }))

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookieGet }) }))

vi.mock('@/lib/aws', () => ({
  ddbDocClient:  () => ({ send: mockDdbSend }),
  cognitoClient: () => ({ send: mockCognitoSend }),
  TABLE:         'daai-insure-orgs',
  USER_POOL_ID:  'pool-1',
}))

vi.mock('@/lib/token', () => ({ verifyJwtClaims: vi.fn() }))

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand:    vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
  UpdateCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Update', input } }),
}))

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  AdminDisableUserCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Disable', input } }),
}))

import { verifyJwtClaims } from '@/lib/token'
import { DELETE } from '../route'

const ORG_ID = 'org-abc123'
const admin  = { sub: 'admin-1', email: 'boss@org.com', exp: 9999999999, 'custom:org_id': ORG_ID, 'custom:role': 'admin' }
const agent  = { PK: `ORG#${ORG_ID}`, SK: 'MEMBER#agent-1', sub: 'agent-1', email: 'jane@org.com', role: 'agent', status: 'active' }

const call = (sub: string) => DELETE({} as NextRequest, { params: { sub } })

describe('DELETE /api/team/[sub]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
    vi.mocked(verifyJwtClaims).mockResolvedValue(admin)
    mockCognitoSend.mockResolvedValue({})
  })

  it('returns 403 for an agent', async () => {
    vi.mocked(verifyJwtClaims).mockResolvedValue({ ...admin, 'custom:role': 'agent' })
    expect((await call('agent-1')).status).toBe(403)
    expect(mockDdbSend).not.toHaveBeenCalled()
  })

  it('will not let an admin remove themselves', async () => {
    expect((await call('admin-1')).status).toBe(400)
    expect(mockDdbSend).not.toHaveBeenCalled()
  })

  it('looks the member up in the caller\'s own org, so another org\'s member is not found', async () => {
    mockDdbSend.mockResolvedValueOnce({})
    const res = await call('agent-in-other-org')

    expect(res.status).toBe(404)
    expect(mockDdbSend.mock.calls[0][0].input.Key).toEqual({ PK: `ORG#${ORG_ID}`, SK: 'MEMBER#agent-in-other-org' })
    expect(mockCognitoSend).not.toHaveBeenCalled()
  })

  it('will not remove an admin', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: { ...agent, role: 'admin' } })
    expect((await call('agent-1')).status).toBe(400)
  })

  it('marks both records removed (the USER# one is what locks them out) and disables the Cognito user', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: agent }).mockResolvedValue({})
    const res = await call('agent-1')

    expect(res.status).toBe(200)
    const updates = mockDdbSend.mock.calls.slice(1).map(c => c[0].input)
    expect(updates[0].Key).toEqual({ PK: 'USER#agent-1', SK: 'ORG_MEMBERSHIP' })
    expect(updates[1].Key).toEqual({ PK: `ORG#${ORG_ID}`, SK: 'MEMBER#agent-1' })
    expect(updates.every(u => u.ExpressionAttributeValues[':removed'] === 'removed')).toBe(true)
    expect(mockCognitoSend.mock.calls[0][0].input).toEqual({ UserPoolId: 'pool-1', Username: 'jane@org.com' })
  })

  it('still succeeds if disabling in Cognito fails, because fn-21 already blocks new tokens', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: agent }).mockResolvedValue({})
    mockCognitoSend.mockRejectedValueOnce(new Error('cognito down'))
    expect((await call('agent-1')).status).toBe(200)
  })

  it('returns 404 for an already-removed member', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: { ...agent, status: 'removed' } })
    expect((await call('agent-1')).status).toBe(404)
  })


  it('records who removed whom', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: agent }).mockResolvedValue({})
    await call('agent-1')
    expect(mockAudit).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ sub: 'admin-1' }), 'team.remove', 'jane@org.com')
  })

  it('records nothing for a refused removal', async () => {
    await call('admin-1')                                               // themselves
    mockDdbSend.mockResolvedValueOnce({})
    await call('agent-in-other-org')                                    // not in this org
    expect(mockAudit).not.toHaveBeenCalled()
  })
})
