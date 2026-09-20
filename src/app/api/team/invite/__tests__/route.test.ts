import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const { mockCookieGet, mockDdbSend, mockCognitoSend, mockLoadTeam, mockSeats } = vi.hoisted(() => ({
  mockCookieGet:   vi.fn(),
  mockDdbSend:     vi.fn(),
  mockCognitoSend: vi.fn(),
  mockLoadTeam:    vi.fn(),
  mockSeats:       vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookieGet }) }))

vi.mock('@/lib/aws', () => ({
  ddbDocClient:  () => ({ send: mockDdbSend }),
  cognitoClient: () => ({ send: mockCognitoSend }),
  TABLE:         'daai-insure-orgs',
  USER_POOL_ID:  'pool-1',
}))

vi.mock('@/lib/token', () => ({ verifyJwtClaims: vi.fn() }))

vi.mock('@/lib/team', async (orig) => ({
  ...(await orig<typeof import('@/lib/team')>()),
  loadTeam:        mockLoadTeam,
  seatAllowance:   mockSeats,
}))

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  PutCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Put', input } }),
}))

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  AdminCreateUserCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Create', input } }),
  AdminDeleteUserCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Delete', input } }),
}))

import { verifyJwtClaims } from '@/lib/token'
import { POST } from '../route'

const ORG_ID = 'org-abc123'
const admin  = { sub: 'admin-1', email: 'boss@org.com', exp: 9999999999, 'custom:org_id': ORG_ID, 'custom:role': 'admin' }

const adminMember = { sub: 'admin-1', email: 'boss@org.com', name: 'Boss', role: 'admin', status: 'active', invitedBy: null, createdAt: '2026-09-01T00:00:00Z' }

const allowance = (over: Record<string, unknown> = {}) => ({
  state: 'active', planName: 'Starter', totalSeats: 5, canChangeSeats: true,
  monthlyTotalZar: 2450, nextSeatPriceZar: 450, docsIncluded: 250, trialEndsAt: null, daysLeft: null, ...over,
})

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}

const valid = { name: 'Jane Agent', email: 'Jane@Org.com' }

describe('POST /api/team/invite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
    vi.mocked(verifyJwtClaims).mockResolvedValue(admin)
    mockLoadTeam.mockResolvedValue([adminMember])
    mockSeats.mockResolvedValue(allowance())
    mockDdbSend.mockResolvedValue({})
    mockCognitoSend.mockResolvedValue({ User: { Attributes: [{ Name: 'sub', Value: 'new-sub' }] } })
  })

  it('returns 401 with no cookie', async () => {
    mockCookieGet.mockReturnValue(undefined)
    expect((await POST(makeRequest(valid))).status).toBe(401)
  })

  it('returns 403 for an agent and creates nothing', async () => {
    vi.mocked(verifyJwtClaims).mockResolvedValue({ ...admin, 'custom:role': 'agent' })
    const res = await POST(makeRequest(valid))
    expect(res.status).toBe(403)
    expect(mockCognitoSend).not.toHaveBeenCalled()
  })

  it('returns 403 for a token with no role claim (fails closed)', async () => {
    const { 'custom:role': _omit, ...noRole } = admin
    vi.mocked(verifyJwtClaims).mockResolvedValue(noRole)
    expect((await POST(makeRequest(valid))).status).toBe(403)
  })

  it('rejects a missing name and a bad email', async () => {
    expect((await POST(makeRequest({ email: 'a@b.com' }))).status).toBe(400)
    expect((await POST(makeRequest({ name: 'X', email: 'not-an-email' }))).status).toBe(400)
    expect(mockCognitoSend).not.toHaveBeenCalled()
  })

  it('tells a paid org whose seats are all taken to add a seat, counting pending invites', async () => {
    mockSeats.mockResolvedValue(allowance({ totalSeats: 2 }))
    mockLoadTeam.mockResolvedValue([adminMember, { ...adminMember, sub: 'x', email: 'x@org.com', role: 'agent', status: 'invited' }])

    const res = await POST(makeRequest(valid))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toBe('All 2 seats are in use. Add a seat to invite someone else.')
    expect(body.canChangeSeats).toBe(true)
    expect(mockCognitoSend).not.toHaveBeenCalled()
  })

  it('tells a pilot, which has one seat, to start the paid plan', async () => {
    mockSeats.mockResolvedValue(allowance({ state: 'trial', planName: 'Pilot', totalSeats: 1, canChangeSeats: false }))
    const res = await POST(makeRequest(valid))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toBe('Your pilot has one seat. Start the paid plan to add people to your team.')
    expect(body.canChangeSeats).toBe(false)
    expect(mockCognitoSend).not.toHaveBeenCalled()
  })

  it('does not count removed members against the seats', async () => {
    mockSeats.mockResolvedValue(allowance({ totalSeats: 2 }))
    mockLoadTeam.mockResolvedValue([adminMember, { ...adminMember, sub: 'x', email: 'x@org.com', role: 'agent', status: 'removed' }])
    expect((await POST(makeRequest(valid))).status).toBe(201)
  })

  it('refuses someone already on the team', async () => {
    mockLoadTeam.mockResolvedValue([adminMember, { ...adminMember, sub: 'x', email: 'jane@org.com', role: 'agent' }])
    expect((await POST(makeRequest(valid))).status).toBe(409)
    expect(mockCognitoSend).not.toHaveBeenCalled()
  })

  it('creates the Cognito user in this org and writes both membership records as an invited agent', async () => {
    const res = await POST(makeRequest(valid))
    expect(res.status).toBe(201)

    const create = mockCognitoSend.mock.calls[0][0].input
    expect(create.Username).toBe('jane@org.com')
    expect(create.UserAttributes).toContainEqual({ Name: 'custom:org_id', Value: ORG_ID })

    const [membership, listing] = mockDdbSend.mock.calls.map(c => c[0].input.Item)
    expect(membership).toMatchObject({ PK: 'USER#new-sub', SK: 'ORG_MEMBERSHIP', orgId: ORG_ID, role: 'agent', status: 'invited' })
    expect(listing).toMatchObject({ PK: `ORG#${ORG_ID}`, SK: 'MEMBER#new-sub', role: 'agent', status: 'invited', invitedBy: 'admin-1' })
  })

  it('takes the org from the caller token, never from the request body', async () => {
    await POST(makeRequest({ ...valid, orgId: 'org-someone-else', role: 'admin' }))
    const create = mockCognitoSend.mock.calls[0][0].input
    expect(create.UserAttributes).toContainEqual({ Name: 'custom:org_id', Value: ORG_ID })
    expect(mockDdbSend.mock.calls[0][0].input.Item.role).toBe('agent')
  })

  it('returns 409 when the email already has a TheoFlow account', async () => {
    mockCognitoSend.mockRejectedValueOnce(Object.assign(new Error('exists'), { name: 'UsernameExistsException' }))
    const res = await POST(makeRequest(valid))
    expect(res.status).toBe(409)
    expect(mockDdbSend).not.toHaveBeenCalled()
  })

  it('removes the Cognito user again if the membership write fails', async () => {
    mockDdbSend.mockRejectedValueOnce(new Error('ddb down'))
    const res = await POST(makeRequest(valid))

    expect(res.status).toBe(500)
    const cleanup = mockCognitoSend.mock.calls[1][0]
    expect(cleanup.__type).toBe('Delete')
    expect(cleanup.input.Username).toBe('jane@org.com')
  })
})
