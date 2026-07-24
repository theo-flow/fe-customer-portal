import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  QueryCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Query', input } }),
}))

import { verifyJwtClaims } from '@/lib/token'
import { GET } from '../route'

const ORG_ID = 'org-abc123'

describe('GET /api/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
    vi.mocked(verifyJwtClaims).mockResolvedValue({
      sub: 'user-1', email: 'a@b.com', exp: 9999999999, 'custom:org_id': ORG_ID,
    })
  })

  it('returns 401 when no auth cookie is present', async () => {
    mockCookieGet.mockReturnValue(undefined)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns 401 when the token fails signature verification', async () => {
    vi.mocked(verifyJwtClaims).mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns 403 when the token has no org claim', async () => {
    vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'user-1', email: 'a@b.com', exp: 9999999999 })
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('returns an empty list with unreadCount 0 when there are no notifications', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] })
    const res = await GET()
    const body = await res.json()

    expect(body.notifications).toEqual([])
    expect(body.unreadCount).toBe(0)
  })

  it('computes unreadCount from unread items only', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        { notificationId: 'n1', submissionId: 's1', group: 'claim', groupLabel: 'Claim', message: 'New submission received for Claim', status: 'DONE',  read: false, createdAt: '2026-07-17T10:00:00Z' },
        { notificationId: 'n2', submissionId: 's2', group: 'claim', groupLabel: 'Claim', message: 'New submission received for Claim', status: 'DONE',  read: true,  createdAt: '2026-07-16T10:00:00Z' },
        { notificationId: 'n3', submissionId: 's3', group: 'claim', groupLabel: 'Claim', message: 'New submission received for Claim', status: 'ERROR', read: false, createdAt: '2026-07-15T10:00:00Z' },
      ],
    })

    const res = await GET()
    const body = await res.json()

    expect(body.notifications).toHaveLength(3)
    expect(body.unreadCount).toBe(2)
    expect(body.notifications[2].status).toBe('ERROR')

    const call = mockSend.mock.calls[0][0].input
    expect(call.ExpressionAttributeValues[':pk']).toBe(`ORG#${ORG_ID}`)
    expect(call.ScanIndexForward).toBe(false)
  })
})
