import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const { mockCookieGet, mockSend } = vi.hoisted(() => ({
  mockCookieGet: vi.fn(),
  mockSend:      vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: () => ({ get: mockCookieGet }),
}))

vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockSend }),
  TABLE: 'daai-insure-orgs',
}))

vi.mock('@/lib/token', () => ({
  verifyJwtClaims: vi.fn(),
}))

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand:    vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
  UpdateCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Update', input } }),
}))

import { verifyJwtClaims } from '@/lib/token'
import { POST } from '../route'

const ORG_ID = 'org-abc123'

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}

describe('POST /api/uploads/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
    vi.mocked(verifyJwtClaims).mockResolvedValue({
      sub: 'user-1', email: 'a@b.com', exp: 9999999999, 'custom:org_id': ORG_ID,
    })
  })

  it('returns 401 when no auth cookie is present', async () => {
    mockCookieGet.mockReturnValue(undefined)
    const res = await POST(makeRequest({ docId: 'DAI-1' }))
    expect(res.status).toBe(401)
  })

  it('returns 401 when the token fails signature verification', async () => {
    vi.mocked(verifyJwtClaims).mockResolvedValue(null)
    const res = await POST(makeRequest({ docId: 'DAI-1' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when the token has no org claim', async () => {
    vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'user-1', email: 'a@b.com', exp: 9999999999 })
    const res = await POST(makeRequest({ docId: 'DAI-1' }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when docId is missing', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it('returns 404 when the document does not exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined })
    const res = await POST(makeRequest({ docId: 'missing' }))
    expect(res.status).toBe(404)
  })

  it('returns 403 when the document belongs to a different org (IDOR guard)', async () => {
    mockSend.mockResolvedValueOnce({ Item: { docId: 'DAI-1', orgId: 'other-org' } })
    const res = await POST(makeRequest({ docId: 'DAI-1' }))
    expect(res.status).toBe(403)
    // Must never reach the update calls once the org mismatch is caught
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('confirms the upload and updates both the DOC# and ORG# records for the owning org', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { docId: 'DAI-1', orgId: ORG_ID } })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})

    const res  = await POST(makeRequest({ docId: 'DAI-1' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockSend).toHaveBeenCalledTimes(3)

    const docUpdate = mockSend.mock.calls[1][0].input
    const orgUpdate  = mockSend.mock.calls[2][0].input
    expect(docUpdate.Key).toEqual({ PK: 'DOC#DAI-1', SK: 'STATUS' })
    expect(orgUpdate.Key).toEqual({ PK: `ORG#${ORG_ID}`, SK: 'DOC#DAI-1' })
    expect(docUpdate.ExpressionAttributeValues[':s']).toBe('UPLOADED')
  })
})
