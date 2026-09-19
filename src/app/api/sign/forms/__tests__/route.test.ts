import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCookieGet, mockDdbSend } = vi.hoisted(() => ({ mockCookieGet: vi.fn(), mockDdbSend: vi.fn() }))

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookieGet }) }))
vi.mock('@/lib/aws', () => ({ ddbDocClient: () => ({ send: mockDdbSend }), TABLE: 'daai-insure-orgs' }))
vi.mock('@/lib/token', () => ({ verifyJwtClaims: vi.fn() }))
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Query', input } }),
}))

import { verifyJwtClaims } from '@/lib/token'
import { GET } from '../route'

const pointer = (over: Record<string, unknown> = {}) => ({
  form_id: 'f1', name: 'New AOA', current_version: 3, page_count: 3, page_width: 595.32, page_height: 841.92,
  roles: ['Customer', 'Seller'], anchors: [{ page: 1, text: 'AMENDMENT OF AGREEMENT' }], valid: true,
  form_status: 'ACTIVE', updated_at: '2026-09-01T00:00:00Z', ...over,
})

describe('GET /api/sign/forms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 't' })
    vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'u', email: 'staff@acme.test', exp: 9999999999, 'custom:org_id': 'org-abc123' })
    mockDdbSend.mockResolvedValue({ Items: [pointer()] })
  })

  it('returns 401 without a cookie and 403 without an org', async () => {
    mockCookieGet.mockReturnValue(undefined)
    expect((await GET()).status).toBe(401)
    mockCookieGet.mockReturnValue({ value: 't' })
    vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'u', email: 'a@b.com', exp: 9999999999 })
    expect((await GET()).status).toBe(403)
  })

  it('reads only the caller\'s own organisation, taken from the verified token', async () => {
    await GET()
    const q = mockDdbSend.mock.calls[0][0]
    expect(q.input.ExpressionAttributeValues).toEqual({ ':pk': 'ORG#org-abc123', ':prefix': 'SIGNFORM#' })
  })

  it('returns what the send screen needs to recognise an upload', async () => {
    const { forms } = await (await GET()).json()
    expect(forms).toEqual([{
      formId: 'f1', name: 'New AOA', currentVersion: 3, pageCount: 3, pageWidth: 595.32, pageHeight: 841.92,
      roles: ['Customer', 'Seller'], anchors: [{ page: 1, text: 'AMENDMENT OF AGREEMENT' }],
    }])
  })

  it('hides forms that are not ready and archived ones, and sorts by name', async () => {
    mockDdbSend.mockResolvedValue({ Items: [
      pointer({ form_id: 'z', name: 'Zed form' }),
      pointer({ form_id: 'n', name: 'Not ready', valid: false }),
      pointer({ form_id: 'g', name: 'Gone', form_status: 'ARCHIVED' }),
      pointer({ form_id: 'a', name: 'Alpha form' }),
    ] })
    const { forms } = await (await GET()).json()
    expect(forms.map((f: { name: string }) => f.name)).toEqual(['Alpha form', 'Zed form'])
  })

  it('returns an empty list for an organisation with no forms', async () => {
    mockDdbSend.mockResolvedValue({ Items: [] })
    expect((await (await GET()).json()).forms).toEqual([])
  })

  it('returns 500 if the query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockDdbSend.mockRejectedValue(new Error('boom'))
    expect((await GET()).status).toBe(500)
  })
})
