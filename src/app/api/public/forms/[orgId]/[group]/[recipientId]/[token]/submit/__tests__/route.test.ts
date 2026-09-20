import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const { mockSend, mockNotify, mockReplyEmail } = vi.hoisted(() => ({
  mockSend:       vi.fn(),
  mockNotify:     vi.fn(),
  mockReplyEmail: vi.fn(),
}))

vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockSend }),
  TABLE: 'daai-insure-orgs',
}))

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand:    vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
  PutCommand:    vi.fn(function (this: unknown, input: unknown) { return { __type: 'Put', input } }),
  UpdateCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Update', input } }),
}))

vi.mock('@/lib/notifications', () => ({ notifyHarvestSubmission: mockNotify }))
vi.mock('@/lib/notify-queue',  () => ({ enqueueSubmissionReplyEmail: mockReplyEmail }))

import { hashToken } from '@/lib/sign'
vi.mock('@/lib/org-access', () => ({ orgLocked: vi.fn(async () => null) }))

import { POST } from '../route'

const RAW_TOKEN = 'raw-token'

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}

const params = { orgId: 'org-1', group: 'claim', recipientId: 'r-1', token: RAW_TOKEN }

const readySchema = {
  status:      'READY',
  group_label: 'Motor Car Claim',
  fields: [{ key: 'full_name', label: 'Full Name', field_type: 'text', required: true, options: null }],
}

function recipient(overrides: Record<string, unknown> = {}) {
  return {
    recipient_id: 'r-1', name: 'Jane Doe', email: 'jane@example.com',
    token_hash: hashToken(RAW_TOKEN), token_expires_at: '2999-01-01T00:00:00Z',
    status: 'PENDING', sent_by_sub: 'agent-1', sent_by_email: 'agent@org.com',
    ...overrides,
  }
}

function primeSuccess(rec: Record<string, unknown>, sender: Record<string, unknown> | null = { status: 'active' }) {
  mockSend
    .mockResolvedValueOnce({ Item: rec })          // recipient fetch
    .mockResolvedValueOnce({ Item: readySchema })  // schema fetch
    .mockResolvedValueOnce({})                     // submission put
    .mockResolvedValueOnce({})                     // recipient update
    .mockResolvedValueOnce({ Item: sender ?? undefined })  // sender membership lookup
}

describe('POST /api/public/forms/[orgId]/[group]/[recipientId]/[token]/submit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks keeps unconsumed mockResolvedValueOnce values, which would
    // leak into the next test when a route makes fewer calls than were queued.
    mockSend.mockReset()
  })

  it('notifies only the sending agent, in-portal and by email', async () => {
    primeSuccess(recipient())

    const res = await POST(makeRequest({ values: { full_name: 'Jane Doe' } }), { params })
    expect(res.status).toBe(201)

    const { referenceId } = await res.json()
    expect(mockNotify).toHaveBeenCalledWith('org-1', expect.objectContaining({
      submissionId: referenceId, group: 'claim', targetSub: 'agent-1', recipientName: 'Jane Doe',
    }))
    expect(mockReplyEmail).toHaveBeenCalledWith(expect.objectContaining({
      toEmail: 'agent@org.com', recipientName: 'Jane Doe', groupLabel: 'Motor Car Claim',
      submissionUrl: expect.stringContaining(`/submissions/${referenceId}`),
    }))
  })

  it('falls back to an org-wide notification and sends no email for links without a sender', async () => {
    primeSuccess(recipient({ sent_by_sub: undefined, sent_by_email: undefined }))

    const res = await POST(makeRequest({ values: { full_name: 'Jane Doe' } }), { params })
    expect(res.status).toBe(201)

    expect(mockNotify).toHaveBeenCalledWith('org-1', expect.objectContaining({ targetSub: null }))
    expect(mockReplyEmail).not.toHaveBeenCalled()
  })

  it('falls back to the whole org, with no email, when the sending agent has been removed', async () => {
    primeSuccess(recipient(), { status: 'removed' })

    await POST(makeRequest({ values: { full_name: 'Jane Doe' } }), { params })

    expect(mockNotify).toHaveBeenCalledWith('org-1', expect.objectContaining({ targetSub: null, recipientName: 'Jane Doe' }))
    expect(mockReplyEmail).not.toHaveBeenCalled()
  })

  it('falls back to the whole org when the sender has no membership record', async () => {
    primeSuccess(recipient(), null)
    await POST(makeRequest({ values: { full_name: 'Jane Doe' } }), { params })
    expect(mockNotify).toHaveBeenCalledWith('org-1', expect.objectContaining({ targetSub: null }))
  })

  it('checks the sender by their own membership record, not by anything in the request', async () => {
    primeSuccess(recipient())
    await POST(makeRequest({ values: { full_name: 'Jane Doe' } }), { params })
    expect(mockSend.mock.calls[4][0].input.Key).toEqual({ PK: 'USER#agent-1', SK: 'ORG_MEMBERSHIP' })
  })

  it('stores the recipient identity on the submission', async () => {
    primeSuccess(recipient())
    await POST(makeRequest({ values: { full_name: 'Jane Doe' } }), { params })

    const put = mockSend.mock.calls[2][0].input.Item
    expect(put.recipient_name).toBe('Jane Doe')
    expect(put.recipient_email).toBe('jane@example.com')
  })

  it('notifies nobody when the token is wrong', async () => {
    mockSend.mockResolvedValueOnce({ Item: recipient() })
    const res = await POST(makeRequest({ values: {} }), { params: { ...params, token: 'nope' } })

    expect(res.status).toBe(404)
    expect(mockNotify).not.toHaveBeenCalled()
    expect(mockReplyEmail).not.toHaveBeenCalled()
  })
})
