import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const { mockCookieGet, mockDdbSend, mockPresign } = vi.hoisted(() => {
  process.env.OPERATOR_EMAILS = 'ops@theoflow.test'
  return { mockCookieGet: vi.fn(), mockDdbSend: vi.fn(), mockPresign: vi.fn() }
})

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookieGet }) }))
vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockDdbSend }),
  s3Client: () => ({}),
  TABLE: 'daai-insure-orgs', BUCKET: 'daai-insure-intake', SIGN_BUCKET: 'daai-insure-sign',
}))
vi.mock('@/lib/token', () => ({ verifyJwtClaims: vi.fn() }))
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
}))
vi.mock('@aws-sdk/client-s3', () => ({
  PutObjectCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'S3Put', input } }),
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: mockPresign }))

import { verifyJwtClaims } from '@/lib/token'
import { POST } from '../route'

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest
const params = { params: { orgId: 'org-abc123' } }

describe('POST /api/operator/orgs/[orgId]/sign-forms/sample', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 't' })
    vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'u', email: 'ops@theoflow.test', exp: 9999999999 })
    mockDdbSend.mockResolvedValue({ Item: { orgId: 'org-abc123' } })
    mockPresign.mockResolvedValue('https://s3.example/upload')
  })

  it('returns 401 without a cookie', async () => {
    mockCookieGet.mockReturnValue(undefined)
    expect((await POST(req({}), params)).status).toBe(401)
  })

  it('returns 403 for a signed-in user who is not an operator', async () => {
    vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'u', email: 'customer@example.com', exp: 9999999999 })
    expect((await POST(req({}), params)).status).toBe(403)
    expect(mockPresign).not.toHaveBeenCalled()
  })

  it('rejects an unsafe organisation id before touching anything', async () => {
    const res = await POST(req({}), { params: { orgId: '../other' } })
    expect(res.status).toBe(400)
    expect(mockDdbSend).not.toHaveBeenCalled()
  })

  it('returns 404 for an organisation that does not exist', async () => {
    mockDdbSend.mockResolvedValue({})
    expect((await POST(req({}), params)).status).toBe(404)
  })

  it('rejects an oversized file', async () => {
    expect((await POST(req({ contentLength: 60 * 1024 * 1024 }), params)).status).toBe(413)
  })

  it('mints a form id and presigns an upload to a key the server chose', async () => {
    const res = await POST(req({ contentLength: 1000 }), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.formId).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.uploadUrl).toBe('https://s3.example/upload')

    const cmd = mockPresign.mock.calls[0][1]
    expect(cmd.input.Key).toBe(`sign/forms/org-abc123/${body.formId}/sample.pdf`)
    expect(cmd.input.ContentType).toBe('application/pdf')
    expect(cmd.input.Bucket).toBe('daai-insure-sign')   // samples live in the Sign bucket
  })
})
