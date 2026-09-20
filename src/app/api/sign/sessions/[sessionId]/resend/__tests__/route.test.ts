import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import { ORG_ID, SESSION_ID, makeSession, makeSigner, ddbRouter } from '@/lib/__tests__/sign-fixtures'

const { mockCookieGet, mockSend, mockSqsSend } = vi.hoisted(() => {
  // read at module load by the route
  process.env.SQS_SIGN_URL = 'https://sqs.af-south-1.amazonaws.com/1/daai-insure-sign'
  return { mockCookieGet: vi.fn(), mockSend: vi.fn(), mockSqsSend: vi.fn() }
})

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookieGet }) }))
vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockSend }),
  sqsClient:    () => ({ send: mockSqsSend }),
  TABLE: 'daai-insure-orgs',
}))
vi.mock('@/lib/token', () => ({ verifyJwtClaims: vi.fn() }))
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
  PutCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Put', input } }),
}))
vi.mock('@aws-sdk/client-sqs', () => ({
  SendMessageCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Sqs', input } }),
}))

import { verifyJwtClaims } from '@/lib/token'
import { hashToken } from '@/lib/sign'
import { POST } from '../route'

function makeReq(body: unknown): NextRequest {
  return { json: async () => body, nextUrl: { origin: 'https://theoflow.test' } } as unknown as NextRequest
}
const params = { params: { sessionId: SESSION_ID } }

function lastPut() {
  return mockSend.mock.calls.map(([c]) => c).filter(c => c.__type === 'Put').pop()
}

describe('POST /api/sign/sessions/[sessionId]/resend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
    vi.mocked(verifyJwtClaims).mockResolvedValue({
      sub: 'user-1', email: 'owner@example.com', exp: 9999999999, 'custom:org_id': ORG_ID,
    })
    mockSqsSend.mockResolvedValue({})
    mockSend.mockImplementation(ddbRouter({ session: makeSession('EXPIRED', [makeSigner({ status: 'EXPIRED', email_sent: true })]) }))
  })

  it('returns 401 without a cookie', async () => {
    mockCookieGet.mockReturnValue(undefined)
    expect((await POST(makeReq({ signerId: 'signer-1' }), params)).status).toBe(401)
  })

  it('returns 400 when signerId is missing', async () => {
    expect((await POST(makeReq({}), params)).status).toBe(400)
  })

  it('returns 404 for a session in another org', async () => {
    mockSend.mockImplementation(ddbRouter({ session: makeSession('EXPIRED'), pointer: false }))
    expect((await POST(makeReq({ signerId: 'signer-1' }), params)).status).toBe(404)
    expect(lastPut()).toBeUndefined()
  })

  it('returns 404 for an unknown signer', async () => {
    expect((await POST(makeReq({ signerId: 'nobody' }), params)).status).toBe(404)
  })

  it.each(['SIGNED', 'CANCELLED', 'FAILED'] as const)('returns 409 when the session is %s', async (status) => {
    mockSend.mockImplementation(ddbRouter({ session: makeSession(status) }))
    expect((await POST(makeReq({ signerId: 'signer-1' }), params)).status).toBe(409)
  })

  it('returns 409 when the signer has already signed', async () => {
    mockSend.mockImplementation(ddbRouter({
      session: makeSession('IN_PROGRESS', [makeSigner({ status: 'SIGNED', token_used: true })]),
    }))
    expect((await POST(makeReq({ signerId: 'signer-1' }), params)).status).toBe(409)
    expect(lastPut()).toBeUndefined()
  })

  it('mints a new token, revives the session and emails only that signer', async () => {
    const res = await POST(makeReq({ signerId: 'signer-1' }), params)
    expect(res.status).toBe(200)
    const body = await res.json()

    const put = lastPut()
    const saved = put.input.Item
    const signer = saved.signers[0]

    // the old link is dead: its hash was replaced, and the new raw token matches the new hash
    expect(signer.token_hash).not.toBe('old-hash')
    const rawToken = body.signUrl.split('/').pop()
    expect(hashToken(rawToken)).toBe(signer.token_hash)
    expect(body.signUrl).toBe(`https://theoflow.test/sign/${SESSION_ID}/signer-1/${rawToken}`)

    expect(signer.status).toBe('PENDING')
    expect(signer.token_used).toBe(false)
    expect(signer.expired_at).toBeNull()
    expect(signer.email_sent).toBe(false)
    expect(new Date(signer.token_expires_at).getTime()).toBeGreaterThan(Date.now())

    // nobody had signed, so an EXPIRED session goes back to PENDING
    expect(saved.status).toBe('PENDING')

    // optimistic concurrency against the value we read
    expect(put.input.ConditionExpression).toBe('updated_at = :prev')
    expect(put.input.ExpressionAttributeValues[':prev']).toBe('2026-01-02T00:00:00.000Z')

    const msg = JSON.parse(mockSqsSend.mock.calls[0][0].input.MessageBody)
    expect(msg.session_id).toBe(SESSION_ID)
    expect(msg.signer_links).toEqual([{ signer_id: 'signer-1', sign_url: body.signUrl }])
    expect(msg.requested_by).toBe('Acme Brokers')
    expect(body.emailQueued).toBe(true)
  })

  it('brings an expired session back to IN_PROGRESS when someone has already signed', async () => {
    mockSend.mockImplementation(ddbRouter({
      session: makeSession('EXPIRED', [
        makeSigner({ signer_id: 's1', status: 'SIGNED', token_used: true }),
        makeSigner({ signer_id: 's2', order: 2, status: 'EXPIRED' }),
      ]),
    }))
    await POST(makeReq({ signerId: 's2' }), params)
    expect(lastPut().input.Item.status).toBe('IN_PROGRESS')
    // the signature that was already given is untouched
    expect(lastPut().input.Item.signers[0].status).toBe('SIGNED')
  })

  it('returns 409 when the session changed since it was read', async () => {
    const conflict = Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' })
    mockSend.mockImplementation(ddbRouter({ session: makeSession('EXPIRED', [makeSigner({ status: 'EXPIRED' })]), writeError: conflict }))
    expect((await POST(makeReq({ signerId: 'signer-1' }), params)).status).toBe(409)
    expect(mockSqsSend).not.toHaveBeenCalled()
  })

  it('still returns the new link when the email cannot be queued', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSqsSend.mockRejectedValue(new Error('sqs down'))
    const res = await POST(makeReq({ signerId: 'signer-1' }), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.emailQueued).toBe(false)
    expect(body.signUrl).toContain('/sign/')
  })
})
