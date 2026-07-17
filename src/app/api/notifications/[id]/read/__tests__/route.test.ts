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
  decodeJwtClaims: vi.fn(),
}))

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand:  vi.fn(function (this: unknown, input: unknown) { return { __type: 'Query', input } }),
  UpdateCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Update', input } }),
}))

import { decodeJwtClaims } from '@/lib/token'
import { POST } from '../route'

const ORG_ID = 'org-abc123'

function makeRequest(): NextRequest {
  return {} as NextRequest
}

describe('POST /api/notifications/[id]/read', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
    vi.mocked(decodeJwtClaims).mockReturnValue({
      sub: 'user-1', email: 'a@b.com', exp: 9999999999, 'custom:org_id': ORG_ID,
    })
  })

  it('returns 401 when no auth cookie is present', async () => {
    mockCookieGet.mockReturnValue(undefined)
    const res = await POST(makeRequest(), { params: { id: 'n1' } })
    expect(res.status).toBe(401)
  })

  it('returns 404 when the notification does not exist for this org', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] })
    const res = await POST(makeRequest(), { params: { id: 'missing' } })
    expect(res.status).toBe(404)
  })

  it('marks the matching notification as read, scoped to the caller org', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [{ PK: `ORG#${ORG_ID}`, SK: 'NOTIFICATION#2026-07-17T10:00:00Z#n1', notificationId: 'n1' }] })
      .mockResolvedValueOnce({})

    const res = await POST(makeRequest(), { params: { id: 'n1' } })

    expect(res.status).toBe(200)
    expect(mockSend).toHaveBeenCalledTimes(2)

    const queryInput  = mockSend.mock.calls[0][0].input
    const updateInput = mockSend.mock.calls[1][0].input
    expect(queryInput.ExpressionAttributeValues[':pk']).toBe(`ORG#${ORG_ID}`)
    expect(updateInput.Key).toEqual({ PK: `ORG#${ORG_ID}`, SK: 'NOTIFICATION#2026-07-17T10:00:00Z#n1' })
  })
})
