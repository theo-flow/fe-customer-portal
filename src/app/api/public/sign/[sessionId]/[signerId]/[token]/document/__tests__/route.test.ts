import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import type { DetectedField, SignSession, Signer } from '@/lib/sign'

const { mockDdbSend, mockPresign } = vi.hoisted(() => ({ mockDdbSend: vi.fn(), mockPresign: vi.fn() }))

vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockDdbSend }), s3Client: () => ({}), TABLE: 'daai-insure-orgs', BUCKET: 'daai-insure-intake', SIGN_BUCKET: 'daai-insure-sign',
}))
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
}))
vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'S3Get', input } }),
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: mockPresign }))

import { hashToken } from '@/lib/sign'
import { GET } from '../route'

const box = (order: number, id: string): DetectedField => ({
  field_id: id, field_type: 'signature', signer_order: order, page: 2, x: 0.1, y: 0.8, width: 0.2, height: 0.04,
  source: 'org_configured', confidence: 1, instruction: `Instruction for ${id}`,
})
const signer = (n: number, over: Partial<Signer> = {}): Signer => ({
  signer_id: `signer-${n}`, name: `Person ${n}`, email: `p${n}@example.com`, role: n === 1 ? 'Customer' : 'Witness 1', order: n,
  status: 'PENDING', token_hash: hashToken(`tok${n}`), token_expires_at: '2999-01-01T00:00:00.000Z', token_used: false,
  signed_at: null, ip_address: null, user_agent: null, signature_type: null, signature_data: null, place_data: null, email_sent: true,
  ...over,
})
const session = (over: Partial<SignSession> = {}): SignSession => ({
  session_id: 's1', source_document: { s3_key: 'sign/source/s1/aoa.pdf', sha256: 'a', uploaded_at: 't' },
  working_document: { detected_fields: [box(1, 'mine'), box(2, 'theirs')], form: { form_id: 'f', version: 2, name: 'New AOA' } },
  signers: [signer(1), signer(2)], status: 'PENDING', created_at: 't', updated_at: 't', ...over,
})
const params = (n: number, token = `tok${n}`) => ({ params: { sessionId: 's1', signerId: `signer-${n}`, token } })

describe('GET /api/public/sign/.../document', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPresign.mockResolvedValue('https://s3.example/doc.pdf')
    mockDdbSend.mockResolvedValue({ Item: session() })
  })

  it('returns the document link, and who this person is signing as', async () => {
    const res = await GET({} as NextRequest, params(1))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ url: 'https://s3.example/doc.pdf', signerName: 'Person 1', signerRole: 'Customer', formName: 'New AOA' })
    expect(mockPresign.mock.calls[0][1].input.Key).toBe('sign/source/s1/aoa.pdf')
    expect(mockPresign.mock.calls[0][1].input.Bucket).toBe('daai-insure-sign')
  })

  it('sends only the boxes that belong to this signer, never the other people\'s', async () => {
    const mine = (await (await GET({} as NextRequest, params(1))).json()).detectedFields
    expect(mine.map((f: DetectedField) => f.field_id)).toEqual(['mine'])
    const theirs = (await (await GET({} as NextRequest, params(2))).json()).detectedFields
    expect(theirs.map((f: DetectedField) => f.field_id)).toEqual(['theirs'])
  })

  it('does not leak other signers\' names, emails or signatures', async () => {
    mockDdbSend.mockResolvedValue({ Item: session({ signers: [signer(1), signer(2, { signature_data: 'SECRET-SIGNATURE' })] }) })
    const text = JSON.stringify(await (await GET({} as NextRequest, params(1))).json())
    expect(text).not.toContain('Person 2')
    expect(text).not.toContain('p2@example.com')
    expect(text).not.toContain('SECRET-SIGNATURE')
  })

  it('has no form name for a session that was not created from a form', async () => {
    mockDdbSend.mockResolvedValue({ Item: session({ working_document: {} }) })
    const body = await (await GET({} as NextRequest, params(1))).json()
    expect(body.formName).toBeNull()
    expect(body.detectedFields).toEqual([])
  })

  it.each([
    ['a wrong token', params(1, 'wrong'), 403],
    ['another signer\'s token', params(1, 'tok2'), 403],
    ['an unknown signer', { params: { sessionId: 's1', signerId: 'nobody', token: 'x' } }, 403],
  ])('refuses %s and hands out no link', async (_l, p, status) => {
    const res = await GET({} as NextRequest, p)
    expect(res.status).toBe(status)
    expect(mockPresign).not.toHaveBeenCalled()
  })

  it('refuses an expired link and a session that does not exist', async () => {
    mockDdbSend.mockResolvedValue({ Item: session({ signers: [signer(1, { token_expires_at: '2000-01-01T00:00:00.000Z' }), signer(2)] }) })
    expect((await GET({} as NextRequest, params(1))).status).toBe(403)
    mockDdbSend.mockResolvedValue({})
    expect((await GET({} as NextRequest, params(1))).status).toBe(404)
    expect(mockPresign).not.toHaveBeenCalled()
  })

  it('returns 500 if the link cannot be prepared', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPresign.mockRejectedValue(new Error('s3 down'))
    expect((await GET({} as NextRequest, params(1))).status).toBe(500)
  })
})
