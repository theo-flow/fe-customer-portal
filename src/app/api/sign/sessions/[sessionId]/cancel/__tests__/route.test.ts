import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import { ORG_ID, SESSION_ID, makeSession, ddbRouter } from '@/lib/__tests__/sign-fixtures'

const { mockCookieGet, mockSend } = vi.hoisted(() => ({
  mockCookieGet: vi.fn(),
  mockSend:      vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookieGet }) }))
vi.mock('@/lib/aws', () => ({ ddbDocClient: () => ({ send: mockSend }), TABLE: 'daai-insure-orgs' }))
vi.mock('@/lib/token', () => ({ verifyJwtClaims: vi.fn() }))
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand:    vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
  UpdateCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Update', input } }),
}))

import { verifyJwtClaims } from '@/lib/token'
import { POST } from '../route'

const req = {} as unknown as NextRequest
const params = { params: { sessionId: SESSION_ID } }

describe('POST /api/sign/sessions/[sessionId]/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
    vi.mocked(verifyJwtClaims).mockResolvedValue({
      sub: 'user-1', email: 'owner@example.com', exp: 9999999999, 'custom:org_id': ORG_ID,
    })
    mockSend.mockImplementation(ddbRouter({ session: makeSession('PENDING') }))
  })

  it('returns 401 without a cookie', async () => {
    mockCookieGet.mockReturnValue(undefined)
    expect((await POST(req, params)).status).toBe(401)
  })

  it('returns 401 when the token fails verification', async () => {
    vi.mocked(verifyJwtClaims).mockResolvedValue(null)
    expect((await POST(req, params)).status).toBe(401)
  })

  it('returns 403 when the token has no org claim', async () => {
    vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'u', email: 'a@b.com', exp: 9999999999 })
    expect((await POST(req, params)).status).toBe(403)
  })

  it('returns 404 for a session that is not in the caller\'s org (no cross-org probing)', async () => {
    mockSend.mockImplementation(ddbRouter({ session: makeSession('PENDING'), pointer: false }))
    expect((await POST(req, params)).status).toBe(404)
    // the SESSION# item itself was never read or written
    const writes = mockSend.mock.calls.filter(([c]) => c.__type === 'Update')
    expect(writes).toHaveLength(0)
  })

  it.each(['SIGNED', 'CANCELLED', 'FAILED'] as const)('returns 409 for a %s session', async (status) => {
    mockSend.mockImplementation(ddbRouter({ session: makeSession(status) }))
    expect((await POST(req, params)).status).toBe(409)
    expect(mockSend.mock.calls.filter(([c]) => c.__type === 'Update')).toHaveLength(0)
  })

  it.each(['PENDING', 'IN_PROGRESS', 'EXPIRED'] as const)('cancels a %s session with a status condition', async (status) => {
    mockSend.mockImplementation(ddbRouter({ session: makeSession(status) }))
    const res = await POST(req, params)
    expect(res.status).toBe(200)

    const update = mockSend.mock.calls.map(([c]) => c).find(c => c.__type === 'Update')
    expect(update.input.Key).toEqual({ PK: `SESSION#${SESSION_ID}`, SK: 'SESSION' })
    expect(update.input.ExpressionAttributeValues[':cancelled']).toBe('CANCELLED')
    // guards against cancelling a session that was sealed a moment ago
    expect(update.input.ConditionExpression).toContain('IN')
    expect(update.input.ConditionExpression).not.toContain(':signed')
  })

  it('returns 409 when the session was sealed between the read and the write', async () => {
    const conflict = Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' })
    mockSend.mockImplementation(ddbRouter({ session: makeSession('IN_PROGRESS'), writeError: conflict }))
    expect((await POST(req, params)).status).toBe(409)
  })

  it('returns 500 on an unexpected write failure', async () => {
    mockSend.mockImplementation(ddbRouter({ session: makeSession('PENDING'), writeError: new Error('boom') }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await POST(req, params)).status).toBe(500)
  })
})
