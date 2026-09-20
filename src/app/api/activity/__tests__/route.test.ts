import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const { mockCookieGet, mockSend } = vi.hoisted(() => ({
  mockCookieGet: vi.fn(),
  mockSend:      vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookieGet }) }))

vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockSend }),
  TABLE:        'daai-insure-orgs',
}))

vi.mock('@/lib/token', () => ({ verifyJwtClaims: vi.fn() }))

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Query', input } }),
}))

import { verifyJwtClaims } from '@/lib/token'
import { GET } from '../route'

const ORG_ID = 'org-abc123'
const admin  = { sub: 'a1', email: 'boss@org.com', exp: 9999999999, 'custom:org_id': ORG_ID, 'custom:role': 'admin' }

const row = (n: number, over: Record<string, unknown> = {}) => ({
  PK: `ORG#${ORG_ID}`, SK: `AUDIT#2026-10-10T12:00:0${n}.000Z#id${n}`, auditId: `id${n}`,
  at: `2026-10-10T12:00:0${n}.000Z`, actorSub: 'a1', actorEmail: 'boss@org.com', actorRole: 'admin',
  action: 'team.invite', target: 'jane@org.com', ...over,
})

const call = (query = '') => GET({ nextUrl: new URL(`http://x/api/activity${query}`) } as unknown as NextRequest)
const cursorFor = (key: object) => Buffer.from(JSON.stringify(key)).toString('base64url')

describe('GET /api/activity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockReset()
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
    vi.mocked(verifyJwtClaims).mockResolvedValue(admin)
    mockSend.mockResolvedValue({ Items: [row(2), row(1)] })
  })

  it('returns 401 with no cookie and 403 with no org', async () => {
    mockCookieGet.mockReturnValue(undefined)
    expect((await call()).status).toBe(401)

    mockCookieGet.mockReturnValue({ value: 't' })
    vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'x', email: 'x@y.com', exp: 9999999999 })
    expect((await call()).status).toBe(403)
  })

  it('is for admins only: an invited member is refused and nothing is read', async () => {
    vi.mocked(verifyJwtClaims).mockResolvedValue({ ...admin, 'custom:role': 'agent' })
    expect((await call()).status).toBe(403)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('reads only this org\'s audit items, newest first', async () => {
    await call()
    const q = mockSend.mock.calls[0][0].input
    expect(q.ExpressionAttributeValues).toEqual({ ':pk': `ORG#${ORG_ID}`, ':prefix': 'AUDIT#' })
    expect(q.ScanIndexForward).toBe(false)
  })

  it('returns the entries in a clean shape, without the storage keys', async () => {
    const body = await (await call()).json()
    expect(body.entries).toHaveLength(2)
    expect(body.entries[0]).toEqual({
      auditId: 'id2', at: '2026-10-10T12:00:02.000Z', actorSub: 'a1', actorEmail: 'boss@org.com',
      actorRole: 'admin', action: 'team.invite', target: 'jane@org.com',
    })
    expect(body.nextCursor).toBeNull()
  })

  it('pages: a full page hands back a cursor, and the cursor continues from where it ended', async () => {
    mockSend.mockResolvedValueOnce({ Items: [row(2), row(1)], LastEvaluatedKey: { PK: `ORG#${ORG_ID}`, SK: row(1).SK } })
    const first = await (await call('?limit=2')).json()
    expect(first.nextCursor).toEqual(expect.any(String))
    expect(mockSend.mock.calls[0][0].input.Limit).toBe(2)

    mockSend.mockResolvedValueOnce({ Items: [row(0)] })
    await call(`?cursor=${encodeURIComponent(first.nextCursor)}`)
    expect(mockSend.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ PK: `ORG#${ORG_ID}`, SK: row(1).SK })
  })

  it('keeps the page size sensible', async () => {
    for (const [q, want] of [['', 50], ['?limit=10', 10], ['?limit=100000', 100], ['?limit=-5', 50], ['?limit=abc', 50]] as const) {
      mockSend.mockClear()
      await call(q)
      expect(mockSend.mock.calls[0][0].input.Limit).toBe(want)
    }
  })

  it('refuses a cursor that points outside this org\'s audit log', async () => {
    for (const key of [
      { PK: 'ORG#someone-else', SK: 'AUDIT#2026-10-10T12:00:00.000Z#x' },      // another org
      { PK: `ORG#${ORG_ID}`, SK: 'SUBMISSION#abc' },                            // not audit data
      { PK: `ORG#${ORG_ID}` },                                                  // no sort key
    ]) {
      const res = await call(`?cursor=${encodeURIComponent(cursorFor(key))}`)
      expect(res.status).toBe(400)
    }
    expect((await call('?cursor=not-base64-json')).status).toBe(400)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('reads an unknown role as agent instead of trusting the stored value', async () => {
    mockSend.mockResolvedValueOnce({ Items: [row(1, { actorRole: 'superuser' })] })
    expect((await (await call()).json()).entries[0].actorRole).toBe('agent')
  })
})
