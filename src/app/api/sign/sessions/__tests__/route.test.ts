import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import { ORG_ID } from '@/lib/__tests__/sign-fixtures'

const { mockCookieGet, mockDdbSend, mockS3Send, mockSqsSend } = vi.hoisted(() => {
  process.env.SQS_SIGN_URL = 'https://sqs.af-south-1.amazonaws.com/1/daai-insure-sign'
  return { mockCookieGet: vi.fn(), mockDdbSend: vi.fn(), mockS3Send: vi.fn(), mockSqsSend: vi.fn() }
})

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookieGet }) }))
vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockDdbSend }),
  s3Client:     () => ({ send: mockS3Send }),
  sqsClient:    () => ({ send: mockSqsSend }),
  TABLE: 'daai-insure-orgs',
  BUCKET: 'daai-insure-intake',
}))
vi.mock('@/lib/token', () => ({ verifyJwtClaims: vi.fn() }))
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand:   vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
  PutCommand:   vi.fn(function (this: unknown, input: unknown) { return { __type: 'Put', input } }),
  QueryCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Query', input } }),
}))
vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand:  vi.fn(function (this: unknown, input: unknown) { return { __type: 'S3Get', input } }),
  HeadObjectCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'S3Head', input } }),
  PutObjectCommand:  vi.fn(function (this: unknown, input: unknown) { return { __type: 'S3Put', input } }),
}))
vi.mock('@aws-sdk/client-sqs', () => ({
  SendMessageCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Sqs', input } }),
}))

import { verifyJwtClaims } from '@/lib/token'
import { GET, POST } from '../route'

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7 rest of file')
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function makeReq(body: unknown): NextRequest {
  return { json: async () => body, nextUrl: { origin: 'https://theoflow.test' } } as unknown as NextRequest
}

function s3Returns(bytes: Uint8Array) {
  mockS3Send.mockImplementation(async (cmd: { __type: string }) => {
    if (cmd.__type === 'S3Head') return {}
    if (cmd.__type === 'S3Get') return { Body: { transformToByteArray: async () => bytes } }
    return {}
  })
}

const signers = [{ name: 'Jane Smith', email: 'jane@example.com' }]
const standalone = { sessionId: 'sess-1', s3Key: 'sign/source/sess-1/a.pdf', sha256: 'abc', filename: 'a.pdf' }

function sessionPuts() {
  return mockDdbSend.mock.calls.map(([c]) => c).filter(c => c.__type === 'Put' && c.input.Item.SK === 'SESSION')
}

describe('POST /api/sign/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
    vi.mocked(verifyJwtClaims).mockResolvedValue({
      sub: 'user-1', email: 'owner@example.com', exp: 9999999999, 'custom:org_id': ORG_ID,
    })
    mockSqsSend.mockResolvedValue({})
    mockDdbSend.mockImplementation(async (cmd: { __type: string; input: { Key?: { PK: string; SK: string } } }) => {
      if (cmd.__type === 'Get') {
        const key = cmd.input.Key!
        if (key.PK.startsWith('DOC#')) return { Item: { orgId: ORG_ID, filename: 'claim.pdf', s3Key: 'raw/claim.pdf' } }
        if (key.SK === 'PROFILE') return { Item: { orgName: 'Acme Brokers' } }
      }
      return {}
    })
    s3Returns(PDF_BYTES)
  })

  it('records who started the session so they can be notified later', async () => {
    const res = await POST(makeReq({ signers, sourceDocument: standalone }))
    expect(res.status).toBe(201)
    const [put] = sessionPuts()
    expect(put.input.Item.metadata).toEqual({ created_by_email: 'owner@example.com' })
  })

  it('keeps the submission id alongside the requester when attached to a Decode document', async () => {
    const res = await POST(makeReq({ signers, submissionId: 'DAI-1' }))
    expect(res.status).toBe(201)
    const [put] = sessionPuts()
    expect(put.input.Item.metadata).toEqual({ created_by_email: 'owner@example.com', submission_id: 'DAI-1' })
  })

  it('rejects an uploaded file that is not really a PDF', async () => {
    s3Returns(PNG_BYTES)
    const res = await POST(makeReq({ signers, sourceDocument: standalone }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/PDF/)
    expect(sessionPuts()).toHaveLength(0)
    expect(mockSqsSend).not.toHaveBeenCalled()
  })

  it('rejects attaching a Decode document that is an image instead of stamping it as a PDF', async () => {
    s3Returns(PNG_BYTES)
    const res = await POST(makeReq({ signers, submissionId: 'DAI-1' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/PDF/)
    expect(sessionPuts()).toHaveLength(0)
    const s3Puts = mockS3Send.mock.calls.filter(([c]) => c.__type === 'S3Put')
    expect(s3Puts).toHaveLength(0)
  })

  it('still requires either a submission or an uploaded document', async () => {
    const res = await POST(makeReq({ signers }))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/sign/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
    vi.mocked(verifyJwtClaims).mockResolvedValue({
      sub: 'user-1', email: 'owner@example.com', exp: 9999999999, 'custom:org_id': ORG_ID,
    })
  })

  it('lists a declined session with who declined and the reason they gave', async () => {
    const session = {
      session_id: 's1', status: 'DECLINED', created_at: 'c', updated_at: 'u', metadata: {},
      signers: [
        { signer_id: 'a', name: 'Thandi', email: 't@example.com', status: 'DECLINED', decline_reason: 'Wrong amount', declined_at: '2026-01-02T00:00:00.000Z' },
        { signer_id: 'b', name: 'Sipho', email: 's@example.com', status: 'PENDING' },
      ],
    }
    mockDdbSend.mockImplementation(async (cmd: { __type: string }) => {
      if (cmd.__type === 'Query') return { Items: [{ sessionId: 's1' }] }
      if (cmd.__type === 'Get') return { Item: session }
      return {}
    })
    const res = await GET({} as unknown as NextRequest)
    const { sessions } = await res.json()
    expect(sessions[0].status).toBe('DECLINED')
    expect(sessions[0].signers[0]).toMatchObject({ status: 'DECLINED', declineReason: 'Wrong amount', declinedAt: '2026-01-02T00:00:00.000Z' })
    expect(sessions[0].signers[1]).toMatchObject({ declineReason: null, declinedAt: null })
  })
})
