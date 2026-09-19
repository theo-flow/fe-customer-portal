import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

const { mockCookieGet, mockDdbSend, mockSqsSend } = vi.hoisted(() => {
  process.env.OPERATOR_EMAILS = 'ops@theoflow.test'
  process.env.SQS_SIGN_URL = 'https://sqs.af-south-1.amazonaws.com/1/daai-insure-sign'
  return { mockCookieGet: vi.fn(), mockDdbSend: vi.fn(), mockSqsSend: vi.fn() }
})

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookieGet }) }))
vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockDdbSend }),
  sqsClient:    () => ({ send: mockSqsSend }),
  TABLE: 'daai-insure-orgs',
}))
vi.mock('@/lib/token', () => ({ verifyJwtClaims: vi.fn() }))
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand:    vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
  PutCommand:    vi.fn(function (this: unknown, input: unknown) { return { __type: 'Put', input } }),
  DeleteCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Delete', input } }),
}))
vi.mock('@aws-sdk/client-sqs', () => ({
  SendMessageCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Sqs', input } }),
}))

import { verifyJwtClaims } from '@/lib/token'
import { GET, POST } from '../route'

const params = { params: { orgId: 'org-abc123', formId: 'form-1' } }
const req = {} as NextRequest
const now = () => new Date().toISOString()

// The form exists, and (optionally) a suggestion item is already there.
function world(opts: { formExists?: boolean; suggestion?: Record<string, unknown> | null } = {}) {
  const { formExists = true, suggestion = null } = opts
  mockDdbSend.mockImplementation(async (cmd: { __type: string; input: { Key?: { SK: string } } }) => {
    if (cmd.__type === 'Get') {
      const sk = cmd.input.Key!.SK
      if (sk === 'SIGNFORM#form-1') return formExists ? { Item: { form_status: 'ACTIVE', current_version: 1 } } : {}
      if (sk === 'SIGNFORMV#form-1#0001') return formExists ? { Item: { version: 1 } } : {}
      if (sk === 'SIGNSUGG#form-1') return suggestion ? { Item: suggestion } : {}
    }
    return {}
  })
}
const puts = () => mockDdbSend.mock.calls.map(([c]) => c).filter(c => c.__type === 'Put')

describe('operator sign-forms suggest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 't' })
    vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'u', email: 'ops@theoflow.test', exp: 9999999999 })
    mockSqsSend.mockResolvedValue({})
    world()
  })
  afterEach(() => { vi.useRealTimers() })

  describe('POST', () => {
    it.each([
      ['no cookie', () => mockCookieGet.mockReturnValue(undefined), 401],
      ['not an operator', () => vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'u', email: 'c@example.com', exp: 9999999999 }), 403],
    ])('is refused for %s', async (_l, arrange, status) => {
      arrange()
      expect((await POST(req, params)).status).toBe(status)
      expect(mockSqsSend).not.toHaveBeenCalled()
    })

    it('rejects unsafe ids', async () => {
      expect((await POST(req, { params: { orgId: '../x', formId: 'form-1' } })).status).toBe(400)
      expect((await POST(req, { params: { orgId: 'org-abc123', formId: 'a/b' } })).status).toBe(400)
    })

    it('404s for a form that does not exist, without queueing anything', async () => {
      world({ formExists: false })
      expect((await POST(req, params)).status).toBe(404)
      expect(mockSqsSend).not.toHaveBeenCalled()
    })

    it('records a pending request, queues detect_form with the same request id, and answers 202', async () => {
      const res = await POST(req, params)
      expect(res.status).toBe(202)
      const { requestId } = await res.json()
      const item = puts()[0].input.Item
      expect(item).toMatchObject({ PK: 'ORG#org-abc123', SK: 'SIGNSUGG#form-1', request_id: requestId, suggestion_status: 'PENDING', requested_by: 'ops@theoflow.test' })
      expect(Object.keys(item)).not.toContain('status')      // never the shared sparse-index attribute
      const sent = mockSqsSend.mock.calls[0][0].input
      expect(sent.QueueUrl).toBe('https://sqs.af-south-1.amazonaws.com/1/daai-insure-sign')
      expect(JSON.parse(sent.MessageBody)).toEqual({ action: 'detect_form', org_id: 'org-abc123', form_id: 'form-1', request_id: requestId })
    })

    it('does not start a second run while one is in progress', async () => {
      world({ suggestion: { request_id: 'running', suggestion_status: 'PENDING', requested_at: now() } })
      const res = await POST(req, params)
      expect(res.status).toBe(202)
      expect(await res.json()).toEqual({ requestId: 'running', alreadyRunning: true })
      expect(puts()).toHaveLength(0)
      expect(mockSqsSend).not.toHaveBeenCalled()
    })

    it('starts again when the last request was lost, or already finished', async () => {
      world({ suggestion: { request_id: 'old', suggestion_status: 'PENDING', requested_at: '2020-01-01T00:00:00.000Z' } })
      expect((await POST(req, params)).status).toBe(202)
      expect(mockSqsSend).toHaveBeenCalledTimes(1)
      world({ suggestion: { request_id: 'done', suggestion_status: 'DONE', fields: [] } })
      expect((await POST(req, params)).status).toBe(202)
      expect(mockSqsSend).toHaveBeenCalledTimes(2)
    })

    it('when the queue is down it says so and leaves no pending item to block a retry', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSqsSend.mockRejectedValue(new Error('sqs down'))
      const res = await POST(req, params)
      expect(res.status).toBe(502)
      const deletes = mockDdbSend.mock.calls.map(([c]) => c).filter(c => c.__type === 'Delete')
      expect(deletes).toHaveLength(1)
      expect(deletes[0].input.Key).toEqual({ PK: 'ORG#org-abc123', SK: 'SIGNSUGG#form-1' })
    })
  })

  describe('GET', () => {
    it('is refused for a non-operator', async () => {
      vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'u', email: 'c@example.com', exp: 9999999999 })
      expect((await GET(req, params)).status).toBe(403)
    })

    it('says NONE when nothing was ever requested', async () => {
      expect(await (await GET(req, params)).json()).toEqual({ status: 'NONE' })
    })

    it('says PENDING while it is running', async () => {
      world({ suggestion: { request_id: 'r1', suggestion_status: 'PENDING', requested_at: now() } })
      expect(await (await GET(req, params)).json()).toEqual({ status: 'PENDING', requestId: 'r1' })
    })

    it('says FAILED when a pending request has been lost', async () => {
      world({ suggestion: { request_id: 'r1', suggestion_status: 'PENDING', requested_at: '2020-01-01T00:00:00.000Z' } })
      expect(await (await GET(req, params)).json()).toEqual({ status: 'FAILED', requestId: 'r1' })
    })

    it('returns the suggested boxes when done', async () => {
      const fields = [{ field_type: 'signature', page: 1 }]
      world({ suggestion: { request_id: 'r1', suggestion_status: 'DONE', fields } })
      expect(await (await GET(req, params)).json()).toEqual({ status: 'DONE', requestId: 'r1', fields })
    })
  })
})
