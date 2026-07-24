import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

/* ── Hoist mock references so they're accessible inside vi.mock factories ── */
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
  GetCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
}))

import { verifyJwtClaims } from '@/lib/token'
import { GET } from '../route'

const ORG_ID = 'org-abc123'

function makeRequest(): NextRequest {
  return {} as NextRequest
}

const submissionItem = {
  submissionId: 'sub-1',
  group:        'claim',
  group_label:  'Motor Car Claim',
  values:       { id_number: '8001015009087', middle_name: '' },
  submittedAt:  '2026-07-17T10:00:00Z',
  status:       'RECEIVED',
}

const schemaFields = [
  { key: 'id_number',   label: 'ID Number',    field_type: 'sa_id', required: true,  options: null },
  { key: 'middle_name', label: 'Middle Name',  field_type: 'text',  required: false, options: null },
]

describe('GET /api/submissions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
    vi.mocked(verifyJwtClaims).mockResolvedValue({
      sub: 'user-1', email: 'a@b.com', exp: 9999999999, 'custom:org_id': ORG_ID,
    })
  })

  it('returns 401 when no auth cookie is present', async () => {
    mockCookieGet.mockReturnValue(undefined)
    const res = await GET(makeRequest(), { params: { id: 'sub-1' } })
    expect(res.status).toBe(401)
  })

  it('returns 401 when the token fails signature verification', async () => {
    vi.mocked(verifyJwtClaims).mockResolvedValue(null)
    const res = await GET(makeRequest(), { params: { id: 'sub-1' } })
    expect(res.status).toBe(401)
  })

  it('returns 403 when the token has no org claim', async () => {
    vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'user-1', email: 'a@b.com', exp: 9999999999 })
    const res = await GET(makeRequest(), { params: { id: 'sub-1' } })
    expect(res.status).toBe(403)
  })

  it('returns 404 when the submission does not exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined })
    const res = await GET(makeRequest(), { params: { id: 'missing' } })
    expect(res.status).toBe(404)
  })

  it('returns 404 for a submission belonging to another org (PK mismatch)', async () => {
    // The route always queries PK=ORG#{callerOrgId} -- a submissionId that
    // exists only under a different org's partition never surfaces here.
    mockSend.mockResolvedValueOnce({ Item: undefined })
    const res = await GET(makeRequest(), { params: { id: 'someone-elses-sub' } })
    expect(res.status).toBe(404)
  })

  it('returns extraction data with answered and blank fields flagged correctly', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: submissionItem })
      .mockResolvedValueOnce({ Item: { fields: schemaFields } })

    const res = await GET(makeRequest(), { params: { id: 'sub-1' } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.submissionId).toBe('sub-1')
    expect(body.groupLabel).toBe('Motor Car Claim')
    expect(body.extraction).toEqual({
      fields:           { id_number: '8001015009087', middle_name: '' },
      schemaFields,
      aiResolvedFields: [],
      flaggedFields:    [],
      unresolvedFields: ['middle_name'],
    })
  })

  it('falls back to an empty schema (no crash) when the schema lookup fails', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: submissionItem })
      .mockRejectedValueOnce(new Error('schema gone'))

    const res = await GET(makeRequest(), { params: { id: 'sub-1' } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.extraction.schemaFields).toEqual([])
    expect(body.extraction.unresolvedFields).toEqual([])
  })
})
