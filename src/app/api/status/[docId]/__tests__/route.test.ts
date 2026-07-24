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

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand:   vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
  QueryCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Query', input } }),
}))

vi.mock('@/lib/token', () => ({
  verifyJwtClaims: vi.fn(),
}))

import { verifyJwtClaims } from '@/lib/token'
import { GET } from '../route'

const ORG_ID = 'org-abc123'

function makeRequest(): NextRequest {
  return {} as NextRequest
}

const docStatusItem = {
  status:    'UPLOADED',
  product:   'decode',
  docType:   'application-form',
  filename:  'form.pdf',
  fileSize:  12345,
  createdAt: '2026-07-01T00:00:00Z',
  orgId:     ORG_ID,
}

describe('GET /api/status/[docId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
    vi.mocked(verifyJwtClaims).mockResolvedValue({
      sub: 'user-1', email: 'a@b.com', exp: 9999999999, 'custom:org_id': ORG_ID,
    })
  })

  it('returns 401 when no auth cookie is present', async () => {
    mockCookieGet.mockReturnValue(undefined)
    const res = await GET(makeRequest(), { params: { docId: 'doc-1' } })
    expect(res.status).toBe(401)
  })

  it('returns 401 when the token fails signature verification', async () => {
    vi.mocked(verifyJwtClaims).mockResolvedValue(null)
    const res = await GET(makeRequest(), { params: { docId: 'doc-1' } })
    expect(res.status).toBe(401)
  })

  it('returns 403 when the token has no org claim', async () => {
    vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'user-1', email: 'a@b.com', exp: 9999999999 })
    const res = await GET(makeRequest(), { params: { docId: 'doc-1' } })
    expect(res.status).toBe(403)
  })

  it('returns 404 when the document does not exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined })
    const res = await GET(makeRequest(), { params: { docId: 'missing' } })
    expect(res.status).toBe(404)
  })

  it('returns 403 when the document belongs to a different org (IDOR guard)', async () => {
    mockSend.mockResolvedValueOnce({ Item: { ...docStatusItem, orgId: 'other-org' } })
    const res = await GET(makeRequest(), { params: { docId: 'doc-1' } })
    expect(res.status).toBe(403)
    expect(mockSend).toHaveBeenCalledTimes(1) // never reaches the pipeline-status Query
  })

  it('marks VALID pipeline status as not failed', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: docStatusItem })
      .mockResolvedValueOnce({ Items: [{ status: 'VALID' }] })

    const res = await GET(makeRequest(), { params: { docId: 'doc-1' } })
    const body = await res.json()

    expect(body.activeStage).toBe(4)
    expect(body.failed).toBe(false)
    expect(body.validationErrors).toEqual([])
  })

  it('marks INVALID pipeline status as failed and surfaces validation errors', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: docStatusItem })
      .mockResolvedValueOnce({
        Items: [{ status: 'INVALID', validation_errors: ['ID number is invalid', 'Missing signature'] }],
      })

    const res = await GET(makeRequest(), { params: { docId: 'doc-1' } })
    const body = await res.json()

    expect(body.activeStage).toBe(4)
    expect(body.failed).toBe(true)
    expect(body.validationErrors).toEqual(['ID number is invalid', 'Missing signature'])
  })

  it('does not mark VALIDATED (still in progress) as failed', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: docStatusItem })
      .mockResolvedValueOnce({ Items: [{ status: 'VALIDATED' }] })

    const res = await GET(makeRequest(), { params: { docId: 'doc-1' } })
    const body = await res.json()

    expect(body.failed).toBe(false)
  })

  it('surfaces extraction data and pipelineStatus when the pipeline reports PARTIAL', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: docStatusItem })
      .mockResolvedValueOnce({
        Items: [{
          status:             'PARTIAL',
          document_id:        'DOC-001',
          org_id:             'org-abc123',
          group:              'claim',
          fields_json:        JSON.stringify({ id_number: '8001015009087' }),
          ai_resolved_fields: ['phone'],
          flagged_fields:     [],
          unresolved_fields:  [],
        }],
      })
      .mockResolvedValueOnce({
        Item: { fields: [{ key: 'id_number', label: 'ID Number', field_type: 'sa_id', required: true, options: null }] },
      })

    const res = await GET(makeRequest(), { params: { docId: 'doc-1' } })
    const body = await res.json()

    expect(body.failed).toBe(false)
    expect(body.pipelineStatus).toBe('PARTIAL')
    expect(body.extraction).toEqual({
      fields:            { id_number: '8001015009087' },
      schemaFields:      [{ key: 'id_number', label: 'ID Number', field_type: 'sa_id', required: true, options: null }],
      aiResolvedFields:  ['phone'],
      flaggedFields:     [],
      unresolvedFields:  [],
    })
  })

  // docs/decode-redesign.md Phase 1: extracted data is returned unconditionally,
  // at every status, once it exists -- not gated to PARTIAL. Only the editable
  // accept flow (a frontend concern keyed off pipelineStatus) is PARTIAL-only.
  it('surfaces extraction data for a VALID (non-PARTIAL) status too, when fields_json is present', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: docStatusItem })
      .mockResolvedValueOnce({
        Items: [{
          status:      'VALID',
          org_id:      'org-abc123',
          group:       'claim',
          fields_json: JSON.stringify({ id_number: '8001015009087' }),
        }],
      })
      .mockResolvedValueOnce({
        Item: { fields: [{ key: 'id_number', label: 'ID Number', field_type: 'sa_id', required: true, options: null }] },
      })

    const res = await GET(makeRequest(), { params: { docId: 'doc-1' } })
    const body = await res.json()

    expect(body.pipelineStatus).toBe('VALID')
    expect(body.extraction).toEqual({
      fields:            { id_number: '8001015009087' },
      schemaFields:      [{ key: 'id_number', label: 'ID Number', field_type: 'sa_id', required: true, options: null }],
      aiResolvedFields:  [],
      flaggedFields:     [],
      unresolvedFields:  [],
    })
  })

  it('returns extraction: null when there is no fields_json yet', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: docStatusItem })
      .mockResolvedValueOnce({ Items: [{ status: 'CLASSIFIED' }] })

    const res = await GET(makeRequest(), { params: { docId: 'doc-1' } })
    const body = await res.json()

    expect(body.extraction).toBeNull()
  })

  it('falls back to portal status when the pipeline GSI has no record yet', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: docStatusItem })
      .mockResolvedValueOnce({ Items: [] })

    const res = await GET(makeRequest(), { params: { docId: 'doc-1' } })
    const body = await res.json()

    expect(body.failed).toBe(false)
    expect(body.activeStage).toBe(1) // UPLOADED portal status
  })
})
