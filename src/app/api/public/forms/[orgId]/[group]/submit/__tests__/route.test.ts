import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))

vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockSend }),
  TABLE: 'daai-insure-orgs',
}))

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
  PutCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Put', input } }),
}))

import { POST } from '../route'

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}

const readySchema = {
  status:      'READY',
  group_label: 'Motor Car Claim',
  fields: [
    { key: 'full_name', label: 'Full Name', field_type: 'text', required: true, options: null },
  ],
}

describe('POST /api/public/forms/[orgId]/[group]/submit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 404 when the form schema is not READY', async () => {
    mockSend.mockResolvedValueOnce({ Item: { status: 'ANALYZING' } })
    const res = await POST(makeRequest({ values: {} }), { params: { orgId: 'org-1', group: 'claim' } })
    expect(res.status).toBe(404)
  })

  it('returns 422 with field errors and writes nothing when a required field is missing', async () => {
    mockSend.mockResolvedValueOnce({ Item: readySchema })
    const res = await POST(makeRequest({ values: {} }), { params: { orgId: 'org-1', group: 'claim' } })
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.errors.full_name).toBeTruthy()
    // Only the schema GetCommand ran -- no submission or notification write.
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('writes the submission and a DONE notification on a valid submit', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: readySchema })  // schema fetch
      .mockResolvedValueOnce({})                      // submission put
      .mockResolvedValueOnce({})                      // notification put

    const res = await POST(
      makeRequest({ values: { full_name: 'Jane Doe' } }),
      { params: { orgId: 'org-1', group: 'claim' } },
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.referenceId).toBeTruthy()
    expect(mockSend).toHaveBeenCalledTimes(3)

    const submissionPut = mockSend.mock.calls[1][0].input
    expect(submissionPut.Item.PK).toBe('ORG#org-1')
    expect(submissionPut.Item.SK).toMatch(/^SUBMISSION#/)
    expect(submissionPut.Item.values).toEqual({ full_name: 'Jane Doe' })

    const notificationPut = mockSend.mock.calls[2][0].input
    expect(notificationPut.Item.PK).toBe('ORG#org-1')
    expect(notificationPut.Item.SK).toMatch(/^NOTIFICATION#/)
    expect(notificationPut.Item.status).toBe('DONE')
    expect(notificationPut.Item.groupLabel).toBe('Motor Car Claim')
    expect(notificationPut.Item.submissionId).toBe(body.referenceId)
  })

  it('still returns success when the notification write fails, and attempts an ERROR fallback write', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: readySchema })          // schema fetch
      .mockResolvedValueOnce({})                              // submission put succeeds
      .mockRejectedValueOnce(new Error('ddb throttled'))       // notification DONE write fails
      .mockResolvedValueOnce({})                              // notification ERROR fallback write succeeds

    const res = await POST(
      makeRequest({ values: { full_name: 'Jane Doe' } }),
      { params: { orgId: 'org-1', group: 'claim' } },
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.referenceId).toBeTruthy()
    expect(mockSend).toHaveBeenCalledTimes(4)

    const fallbackPut = mockSend.mock.calls[3][0].input
    expect(fallbackPut.Item.status).toBe('ERROR')
  })
})
