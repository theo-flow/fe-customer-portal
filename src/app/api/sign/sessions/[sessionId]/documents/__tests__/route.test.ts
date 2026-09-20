import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import { ORG_ID, SESSION_ID, makeSession, makeSigner, ddbRouter } from '@/lib/__tests__/sign-fixtures'
import type { SignSession } from '@/lib/sign'

const { mockCookieGet, mockSend, mockS3Send } = vi.hoisted(() => ({
  mockCookieGet: vi.fn(), mockSend: vi.fn(), mockS3Send: vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookieGet }) }))
vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockSend }), s3Client: () => ({ send: mockS3Send }),
  TABLE: 'daai-insure-orgs', BUCKET: 'daai-insure-intake',
}))
vi.mock('@/lib/token', () => ({ verifyJwtClaims: vi.fn() }))
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
  PutCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Put', input } }),
}))
vi.mock('@aws-sdk/client-s3', () => ({
  DeleteObjectCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'S3Delete', input } }),
}))

import { verifyJwtClaims } from '@/lib/token'
import { DELETE } from '../route'

const req = {} as unknown as NextRequest
const params = { params: { sessionId: SESSION_ID } }
const clash = Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' })

const signed = (): SignSession => ({
  ...makeSession('SIGNED', [makeSigner({
    name: 'Thandi Nkosi', email: 'thandi@example.com', status: 'SIGNED', token_used: true, signed_at: '2026-01-02T00:00:00.000Z',
    ip_address: '203.0.113.9', user_agent: 'Mozilla/5.0', signature_type: 'TYPED', signature_data: 'Thandi Nkosi', place_data: 'Cape Town',
    consent_at: '2026-01-02T00:00:00.000Z', role: 'Customer',
  })]),
  completed_document: { s3_key: `sign/completed/${SESSION_ID}/completed.pdf`, sealed_at: '2026-01-02T00:01:00.000Z', sha256: 'sealedhash' },
  working_document: { detected_fields: [{ field_type: 'signature', signer_order: 1, page: 1, x: 0, y: 0, width: 0.1, height: 0.1, source: 'org_configured', confidence: 1 }] },
  metadata: { created_by_email: 'staff@acme.test', form_name: 'New AOA', org_name: 'Acme', submission_id: 'DOC-1' },
})

const puts = () => mockSend.mock.calls.map(([c]) => c).filter(c => c.__type === 'Put')
const deleted = () => mockS3Send.mock.calls.map(([c]) => c.input.Key)

describe('DELETE /api/sign/sessions/[sessionId]/documents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
    vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'u', email: 'owner@example.com', exp: 9999999999, 'custom:org_id': ORG_ID })
    mockS3Send.mockResolvedValue({})
    mockSend.mockImplementation(ddbRouter({ session: signed() }))
  })

  it.each([
    ['no cookie', () => mockCookieGet.mockReturnValue(undefined), 401],
    ['a bad token', () => vi.mocked(verifyJwtClaims).mockResolvedValue(null), 401],
    ['no org claim', () => vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'u', email: 'a@b.com', exp: 9999999999 }), 403],
    ['another org\'s session', () => mockSend.mockImplementation(ddbRouter({ session: signed(), pointer: false })), 404],
  ])('refuses %s and deletes nothing', async (_l, arrange, status) => {
    arrange()
    expect((await DELETE(req, params)).status).toBe(status)
    expect(mockS3Send).not.toHaveBeenCalled()
    expect(puts()).toHaveLength(0)
  })

  it('deletes the source and the sealed file, then leaves only a tombstone', async () => {
    const res = await DELETE(req, params)
    expect(res.status).toBe(200)
    expect(deleted()).toEqual([`sign/source/${SESSION_ID}/agreement.pdf`, `sign/completed/${SESSION_ID}/completed.pdf`])

    const item = puts()[0].input.Item
    expect(item).toMatchObject({ PK: `SESSION#${SESSION_ID}`, SK: 'SESSION', status: 'SIGNED' })
    expect(puts()[0].input.ConditionExpression).toBe('updated_at = :prev')
    expect(puts()[0].input.ExpressionAttributeValues).toEqual({ ':prev': '2026-01-02T00:00:00.000Z' })
    const dump = JSON.stringify(item)
    for (const personal of ['Thandi', 'thandi@example.com', '203.0.113.9', 'Mozilla', 'Cape Town', 'staff@acme.test', 'Acme', 'old-hash', 'detected_fields']) {
      expect(dump).not.toContain(personal)
    }
    expect(item.completed_document).toEqual({ sealed_at: '2026-01-02T00:01:00.000Z', sha256: 'sealedhash' })
    expect(item.metadata).toMatchObject({ form_name: 'New AOA', submission_id: 'DOC-1' })
    expect(item.metadata.documents_deleted_at).toBeTruthy()
    expect(item.signers[0]).toMatchObject({ role: 'Customer', status: 'SIGNED', name: '', email: '' })
  })

  it.each(['CANCELLED', 'EXPIRED', 'DECLINED', 'FAILED'] as const)('works for a %s session (source only)', async (status) => {
    mockSend.mockImplementation(ddbRouter({ session: makeSession(status) }))
    expect((await DELETE(req, params)).status).toBe(200)
    expect(deleted()).toEqual([`sign/source/${SESSION_ID}/agreement.pdf`])
  })

  it.each(['DRAFT', 'PENDING', 'IN_PROGRESS'] as const)('refuses a %s session: cancel it first', async (status) => {
    mockSend.mockImplementation(ddbRouter({ session: makeSession(status) }))
    const res = await DELETE(req, params)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Cancel this session first, then delete its documents.')
    expect(mockS3Send).not.toHaveBeenCalled()
  })

  it('refuses a session whose documents were already deleted', async () => {
    const already = { ...signed(), metadata: { documents_deleted_at: '2026-02-01T00:00:00.000Z' } }
    mockSend.mockImplementation(ddbRouter({ session: already }))
    expect((await DELETE(req, params)).status).toBe(409)
    expect(mockS3Send).not.toHaveBeenCalled()
  })

  it('never deletes a key outside the sign folders', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const odd = signed()
    odd.source_document.s3_key = 'raw/someone-elses-upload.pdf'
    mockSend.mockImplementation(ddbRouter({ session: odd }))
    expect((await DELETE(req, params)).status).toBe(500)
    expect(mockS3Send).not.toHaveBeenCalled()
    expect(puts()).toHaveLength(0)
  })

  it('leaves the record alone when a file cannot be deleted, so it can be retried', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockS3Send.mockRejectedValue(new Error('denied'))
    const res = await DELETE(req, params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Could not delete the documents. Please try again.')
    expect(puts()).toHaveLength(0)
  })

  it('does not overwrite a session that changed while it was being deleted', async () => {
    mockSend.mockImplementation(ddbRouter({ session: signed(), writeError: clash }))
    const res = await DELETE(req, params)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('This session just changed. Refresh and try again.')
  })

  it('returns 500 on an unexpected write failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSend.mockImplementation(ddbRouter({ session: signed(), writeError: new Error('boom') }))
    expect((await DELETE(req, params)).status).toBe(500)
  })
})
