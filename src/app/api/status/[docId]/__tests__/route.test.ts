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

import { GET } from '../route'

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
}

describe('GET /api/status/[docId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
  })

  it('returns 401 when no auth cookie is present', async () => {
    mockCookieGet.mockReturnValue(undefined)
    const res = await GET(makeRequest(), { params: { docId: 'doc-1' } })
    expect(res.status).toBe(401)
  })

  it('returns 404 when the document does not exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined })
    const res = await GET(makeRequest(), { params: { docId: 'missing' } })
    expect(res.status).toBe(404)
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
