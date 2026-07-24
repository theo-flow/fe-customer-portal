import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

/* ── Hoist mock references so they're accessible inside vi.mock factories ── */
const { mockCookieGet, mockDbSend, mockSqsSend } = vi.hoisted(() => ({
  mockCookieGet: vi.fn(),
  mockDbSend:    vi.fn(),
  mockSqsSend:   vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: () => ({ get: mockCookieGet }),
}))

vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockDbSend }),
  sqsClient:    () => ({ send: mockSqsSend }),
  TABLE: 'daai-insure-orgs',
}))

vi.mock('@/lib/token', () => ({
  verifyJwtClaims: vi.fn(),
}))

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand:    vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
  QueryCommand:  vi.fn(function (this: unknown, input: unknown) { return { __type: 'Query', input } }),
  UpdateCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Update', input } }),
  PutCommand:    vi.fn(function (this: unknown, input: unknown) { return { __type: 'Put', input } }),
}))

vi.mock('@aws-sdk/client-sqs', () => ({
  SendMessageCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'SendMessage', input } }),
}))

import { verifyJwtClaims } from '@/lib/token'

const ORG_ID = 'org-abc123'
const GROUP  = 'claim'

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}

// route.ts reads process.env.SQS_GENERATE_URL at module-load time -- reset
// modules and re-import per test so each test's env value actually takes effect.
let POST: typeof import('../route').POST

describe('POST /api/status/[docId]/accept', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env.SQS_GENERATE_URL = 'https://sqs.af-south-1.amazonaws.com/123456789012/daai-insure-generate'
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
    vi.mocked(verifyJwtClaims).mockResolvedValue({
      sub: 'user-1', email: 'a@b.com', exp: 9999999999, 'custom:org_id': ORG_ID,
    })
    ;({ POST } = await import('../route'))
  })

  it('returns 401 when no auth cookie is present', async () => {
    mockCookieGet.mockReturnValue(undefined)
    const res = await POST(makeRequest({ fields: {} }), { params: { docId: 'doc-1' } })
    expect(res.status).toBe(401)
  })

  it('returns 401 when the token fails signature verification', async () => {
    vi.mocked(verifyJwtClaims).mockResolvedValue(null)
    const res = await POST(makeRequest({ fields: {} }), { params: { docId: 'doc-1' } })
    expect(res.status).toBe(401)
  })

  it('returns 403 when the token has no org_id claim', async () => {
    vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'user-1', email: 'a@b.com', exp: 9999999999 })
    const res = await POST(makeRequest({ fields: {} }), { params: { docId: 'doc-1' } })
    expect(res.status).toBe(403)
  })

  it('returns 404 when the submission cannot be found', async () => {
    mockDbSend.mockResolvedValueOnce({ Items: [] })
    const res = await POST(makeRequest({ fields: {} }), { params: { docId: 'doc-1' } })
    expect(res.status).toBe(404)
  })

  it('returns 403 when the submission belongs to a different org', async () => {
    mockDbSend.mockResolvedValueOnce({ Items: [{ org_id: 'other-org', status: 'PARTIAL' }] })
    const res = await POST(makeRequest({ fields: {} }), { params: { docId: 'doc-1' } })
    expect(res.status).toBe(403)
  })

  it('returns 409 when the submission is not PARTIAL', async () => {
    mockDbSend.mockResolvedValueOnce({ Items: [{ org_id: ORG_ID, status: 'VALIDATED' }] })
    const res = await POST(makeRequest({ fields: {} }), { params: { docId: 'doc-1' } })
    expect(res.status).toBe(409)
  })

  it('returns 422 with field errors when a required field is missing', async () => {
    mockDbSend
      .mockResolvedValueOnce({ Items: [{ org_id: ORG_ID, group: GROUP, status: 'PARTIAL', document_id: 'DOC-001' }] })
      .mockResolvedValueOnce({
        Item: { fields: [{ key: 'id_number', label: 'ID Number', field_type: 'sa_id', required: true, options: null }] },
      })

    const res  = await POST(makeRequest({ fields: { id_number: '' } }), { params: { docId: 'doc-1' } })
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.errors.id_number).toContain('required')
  })

  it('rejects a select value outside the schema options', async () => {
    mockDbSend
      .mockResolvedValueOnce({ Items: [{ org_id: ORG_ID, group: GROUP, status: 'PARTIAL', document_id: 'DOC-001' }] })
      .mockResolvedValueOnce({
        Item: {
          fields: [{
            key: 'cover_type', label: 'Cover Type', field_type: 'select', required: true,
            options: ['Comprehensive', 'Third Party'],
          }],
        },
      })

    const res  = await POST(makeRequest({ fields: { cover_type: 'Fire and Theft' } }), { params: { docId: 'doc-1' } })
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.errors.cover_type).toContain('Cover Type')
  })

  it('accepts valid fields, updates DynamoDB, and publishes to the generate queue', async () => {
    mockDbSend
      .mockResolvedValueOnce({
        Items: [{
          org_id: ORG_ID, group: GROUP, status: 'PARTIAL', document_id: 'DOC-001',
          submission_id: 'sub-001', form_type: 'ApplicationForm',
        }],
      })
      .mockResolvedValueOnce({
        Item: { fields: [{ key: 'id_number', label: 'ID Number', field_type: 'sa_id', required: true, options: null }] },
      })
      .mockResolvedValueOnce({}) // UpdateCommand

    mockSqsSend.mockResolvedValueOnce({})

    const res  = await POST(makeRequest({ fields: { id_number: '8001015009087' } }), { params: { docId: 'doc-1' } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockSqsSend).toHaveBeenCalledTimes(1)

    const updateCall = mockDbSend.mock.calls[2][0]
    expect(updateCall.input.Key).toEqual({ document_id: 'DOC-001' })
    expect(updateCall.input.ExpressionAttributeValues[':status']).toBe('VALIDATED')
    expect(updateCall.input.ExpressionAttributeValues[':arf']).toEqual([])

    const sendMsgCall = mockSqsSend.mock.calls[0][0]
    const msgBody = JSON.parse(sendMsgCall.input.MessageBody)
    expect(msgBody.document_id).toBe('DOC-001')
    expect(msgBody.status).toBe('VALID')
  })

  it('writes a correction record per resolution and still completes a normal accept', async () => {
    mockDbSend.mockResolvedValue({}) // fallback for the PutCommand write(s) below
    mockDbSend
      .mockResolvedValueOnce({
        Items: [{
          org_id: ORG_ID, group: GROUP, status: 'PARTIAL', document_id: 'DOC-001',
          submission_id: 'sub-001', form_type: 'ApplicationForm',
          fields_json: JSON.stringify({ id_number: '8001015009087' }),
        }],
      })
      .mockResolvedValueOnce({
        Item: { fields: [{ key: 'id_number', label: 'ID Number', field_type: 'sa_id', required: true, options: null }] },
      })

    mockSqsSend.mockResolvedValueOnce({})

    const res = await POST(
      makeRequest({
        fields: { id_number: '8001015009087' },
        resolutions: [{ fieldKey: 'id_number', resolutionType: 'confirmed' }],
      }),
      { params: { docId: 'doc-1' } },
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)

    const putCall = mockDbSend.mock.calls.find(c => c[0].__type === 'Put')
    expect(putCall).toBeDefined()
    expect(putCall![0].input.Item.resolution_type).toBe('confirmed')
    expect(putCall![0].input.Item.field_key).toBe('id_number')
    expect(putCall![0].input.Item.extracted_value).toBe('8001015009087')

    expect(mockSqsSend).toHaveBeenCalledTimes(1) // normal accept still proceeds -- nothing flagged for clarification
  })

  it('keeps the submission PARTIAL and skips the generate queue when a field is flagged for clarification', async () => {
    mockDbSend.mockResolvedValue({})
    mockDbSend
      .mockResolvedValueOnce({
        Items: [{
          org_id: ORG_ID, group: GROUP, status: 'PARTIAL', document_id: 'DOC-001',
          submission_id: 'sub-001', form_type: 'ApplicationForm',
          fields_json: JSON.stringify({}),
        }],
      })
      .mockResolvedValueOnce({
        Item: { fields: [{ key: 'id_number', label: 'ID Number', field_type: 'sa_id', required: true, options: null }] },
      })

    const res = await POST(
      makeRequest({
        fields: {}, // id_number left blank -- would normally fail required validation
        resolutions: [{ fieldKey: 'id_number', resolutionType: 'clarify' }],
      }),
      { params: { docId: 'doc-1' } },
    )
    const body = await res.json()

    expect(res.status).toBe(200) // not blocked by the missing-required-field check -- it's excluded
    expect(body.pendingClarification).toEqual(['id_number'])
    expect(mockSqsSend).not.toHaveBeenCalled() // never reaches VALID/generate while something's pending

    const updateCall = mockDbSend.mock.calls.find(c => c[0].__type === 'Update')
    expect(updateCall![0].input.ExpressionAttributeValues[':status']).toBe('PARTIAL')
    expect(updateCall![0].input.ExpressionAttributeValues[':uf']).toEqual(['id_number'])

    const putCall = mockDbSend.mock.calls.find(c => c[0].__type === 'Put')
    expect(putCall![0].input.Item.resolution_type).toBe('clarify')
  })

  it('returns 500 when SQS_GENERATE_URL is not configured', async () => {
    delete process.env.SQS_GENERATE_URL
    vi.resetModules()
    ;({ POST } = await import('../route'))

    mockDbSend
      .mockResolvedValueOnce({ Items: [{ org_id: ORG_ID, group: GROUP, status: 'PARTIAL', document_id: 'DOC-001' }] })
      .mockResolvedValueOnce({ Item: { fields: [] } })
      .mockResolvedValueOnce({})

    const res = await POST(makeRequest({ fields: {} }), { params: { docId: 'doc-1' } })
    expect(res.status).toBe(500)
  })
})
