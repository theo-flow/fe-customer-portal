import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))

vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: vi.fn(function () { return {} }) }))
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  PutCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Put', input } }),
}))
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () { return {} }),
  PutObjectCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'PutObject', input } }),
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn(async () => 'https://signed') }))
vi.mock('@aws-sdk/credential-providers', () => ({ fromIni: vi.fn() }))

import { POST } from '../route'

const call = (body: Record<string, unknown>) => POST({ json: async () => body } as unknown as NextRequest)
const valid = { orgName: 'Acme', adminEmail: 'Boss@Acme.co.za', adminName: 'Boss' }

describe('POST /api/organizations/register: starts the pilot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockReset()
    mockSend.mockResolvedValue({})
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('starts a 7 day pilot with one seat', async () => {
    const res = await call(valid)

    expect(res.status).toBe(200)
    const item = mockSend.mock.calls[0][0].input.Item
    expect(item).toMatchObject({
      SK: 'PROFILE', seats: 1, trial_status: 'active',
      trial_ends_at: '2026-10-17T12:00:00+00:00',
    })
    expect(item.trial_reminder_sent_at).toBeUndefined()      // the reminder is fn-16's to send
  })

  it('still creates the org the way it always did', async () => {
    const body = await (await call(valid)).json()
    const item = mockSend.mock.calls[0][0].input.Item

    expect(body.orgId).toMatch(/^org-/)
    expect(item).toMatchObject({ PK: `ORG#${body.orgId}`, adminEmail: 'boss@acme.co.za', status: 'pending_verification' })
  })

  it('does not start a pilot for a request that is refused', async () => {
    expect((await call({ orgName: 'Acme' })).status).toBe(400)
    expect((await call({ ...valid, adminEmail: 'nope' })).status).toBe(400)
    expect(mockSend).not.toHaveBeenCalled()
  })
})
