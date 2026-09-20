import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import { ORG_ID, SESSION_ID, makeSession, ddbRouter } from '@/lib/__tests__/sign-fixtures'

const { mockCookieGet, mockSend, mockPresign } = vi.hoisted(() => ({
  mockCookieGet: vi.fn(), mockSend: vi.fn(), mockPresign: vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookieGet }) }))
vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockSend }), s3Client: () => ({}), TABLE: 'daai-insure-orgs', BUCKET: 'daai-insure-intake', SIGN_BUCKET: 'daai-insure-sign',
}))
vi.mock('@/lib/token', () => ({ verifyJwtClaims: vi.fn() }))
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
}))
vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'S3Get', input } }),
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: mockPresign }))

import { verifyJwtClaims } from '@/lib/token'
import { GET } from '../route'

const req = {} as unknown as NextRequest
const params = { params: { sessionId: SESSION_ID } }

describe('GET /api/sign/sessions/[sessionId]/document', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
    vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'u', email: 'owner@example.com', exp: 9999999999, 'custom:org_id': ORG_ID })
    mockPresign.mockResolvedValue('https://s3.example/signed-url')
  })

  it('returns a link to the source while signing is still open', async () => {
    mockSend.mockImplementation(ddbRouter({ session: makeSession('PENDING') }))
    const res = await GET(req, params)
    expect(await res.json()).toEqual({ url: 'https://s3.example/signed-url', isCompleted: false })
    expect(mockPresign.mock.calls[0][1].input.Key).toBe(`sign/source/${SESSION_ID}/agreement.pdf`)
    expect(mockPresign.mock.calls[0][1].input.Bucket).toBe('daai-insure-sign')
  })

  it('returns 404 for another org\'s session', async () => {
    mockSend.mockImplementation(ddbRouter({ session: makeSession('PENDING'), pointer: false }))
    expect((await GET(req, params)).status).toBe(404)
    expect(mockPresign).not.toHaveBeenCalled()
  })

  it('returns 410 once the documents were deleted, and hands out no link', async () => {
    const gone = { ...makeSession('SIGNED'), metadata: { documents_deleted_at: '2026-02-01T00:00:00.000Z' } }
    mockSend.mockImplementation(ddbRouter({ session: gone }))
    const res = await GET(req, params)
    expect(res.status).toBe(410)
    expect((await res.json()).error).toBe('The documents for this session were deleted.')
    expect(mockPresign).not.toHaveBeenCalled()
  })
})
