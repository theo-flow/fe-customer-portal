import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const { mockCookieGet, mockDdbSend, mockS3Send } = vi.hoisted(() => {
  process.env.OPERATOR_EMAILS = 'ops@theoflow.test'
  return { mockCookieGet: vi.fn(), mockDdbSend: vi.fn(), mockS3Send: vi.fn() }
})

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookieGet }) }))
vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockDdbSend }),
  s3Client: () => ({ send: mockS3Send }),
  TABLE: 'daai-insure-orgs', BUCKET: 'daai-insure-intake',
}))
vi.mock('@/lib/token', () => ({ verifyJwtClaims: vi.fn() }))
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand:           vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
  QueryCommand:         vi.fn(function (this: unknown, input: unknown) { return { __type: 'Query', input } }),
  TransactWriteCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Tx', input } }),
}))
vi.mock('@aws-sdk/client-s3', () => ({
  HeadObjectCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'S3Head', input } }),
  GetObjectCommand:  vi.fn(function (this: unknown, input: unknown) { return { __type: 'S3Get', input } }),
}))

import { verifyJwtClaims } from '@/lib/token'
import { GET, POST } from '../route'

const params = { params: { orgId: 'org-abc123' } }
const FORM_ID = '11111111-2222-3333-4444-555555555555'
const PDF = new TextEncoder().encode('%PDF-1.7 rest')
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest
const goodBody = { formId: FORM_ID, name: 'New AOA', pageCount: 3, pageWidth: 595.32, pageHeight: 841.92 }

function ddb(opts: { orgExists?: boolean; items?: Record<string, unknown>[]; txError?: unknown } = {}) {
  mockDdbSend.mockImplementation(async (cmd: { __type: string; input: { Key?: { SK: string } } }) => {
    if (cmd.__type === 'Get') return opts.orgExists === false ? {} : { Item: { orgId: 'org-abc123' } }
    if (cmd.__type === 'Query') return { Items: opts.items ?? [] }
    if (cmd.__type === 'Tx') { if (opts.txError) throw opts.txError; return {} }
    return {}
  })
}
function s3(bytes: Uint8Array | null) {
  mockS3Send.mockImplementation(async (cmd: { __type: string }) => {
    if (bytes === null) throw new Error('NotFound')
    if (cmd.__type === 'S3Get') return { Body: { transformToByteArray: async () => bytes } }
    return {}
  })
}

describe('operator sign-forms collection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 't' })
    vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'u', email: 'ops@theoflow.test', exp: 9999999999 })
    ddb(); s3(PDF)
  })

  describe('GET', () => {
    it.each([
      ['no cookie', () => mockCookieGet.mockReturnValue(undefined), 401],
      ['not an operator', () => vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'u', email: 'c@example.com', exp: 9999999999 }), 403],
    ])('is refused for %s', async (_l, arrange, status) => {
      arrange()
      expect((await GET({} as NextRequest, params)).status).toBe(status)
    })

    it('returns 404 for a missing organisation', async () => {
      ddb({ orgExists: false })
      expect((await GET({} as NextRequest, params)).status).toBe(404)
    })

    it('lists forms newest change first and hides archived ones', async () => {
      ddb({ items: [
        { form_id: 'a', name: 'Old', current_version: 2, page_count: 2, roles: ['Customer'], field_count: 3, valid: true, updated_at: '2026-01-01T00:00:00Z' },
        { form_id: 'b', name: 'New AOA', current_version: 5, page_count: 3, roles: ['Customer', 'Seller'], field_count: 9, valid: true, updated_at: '2026-09-01T00:00:00Z' },
        { form_id: 'c', name: 'Gone', current_version: 1, page_count: 1, roles: [], field_count: 0, valid: false, updated_at: '2026-10-01T00:00:00Z', form_status: 'ARCHIVED' },
      ] })
      const res = await GET({} as NextRequest, params)
      const { forms } = await res.json()
      expect(forms.map((f: { name: string }) => f.name)).toEqual(['New AOA', 'Old'])
      expect(forms[0]).toMatchObject({ formId: 'b', currentVersion: 5, pageCount: 3, fieldCount: 9, valid: true })
    })

    it('queries only this organisation\'s form pointers, not their versions', async () => {
      await GET({} as NextRequest, params)
      const query = mockDdbSend.mock.calls.map(([c]) => c).find(c => c.__type === 'Query')
      expect(query.input.ExpressionAttributeValues).toEqual({ ':pk': 'ORG#org-abc123', ':prefix': 'SIGNFORM#' })
    })
  })

  describe('POST (create)', () => {
    it('is refused for a non-operator', async () => {
      vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'u', email: 'c@example.com', exp: 9999999999 })
      expect((await POST(req(goodBody), params)).status).toBe(403)
    })

    it.each([
      ['unsafe form id', { ...goodBody, formId: '../x' }],
      ['blank name', { ...goodBody, name: '  ' }],
      ['no page count', { ...goodBody, pageCount: undefined }],
      ['zero page size', { ...goodBody, pageWidth: 0 }],
    ])('rejects %s', async (_l, body) => {
      const res = await POST(req(body), params)
      expect(res.status).toBe(400)
      expect(mockDdbSend.mock.calls.some(([c]) => c.__type === 'Tx')).toBe(false)
    })

    it('rejects a missing sample upload', async () => {
      s3(null)
      const res = await POST(req(goodBody), params)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/upload/i)
    })

    it('rejects a sample that is not a PDF', async () => {
      s3(PNG)
      const res = await POST(req(goodBody), params)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/PDF/)
    })

    it('creates the pointer and version 1 together, with the server-derived sample key', async () => {
      const res = await POST(req(goodBody), params)
      expect(res.status).toBe(201)
      expect(await res.json()).toEqual({ formId: FORM_ID, version: 1 })

      const tx = mockDdbSend.mock.calls.map(([c]) => c).find(c => c.__type === 'Tx')
      const [pointer, version] = tx.input.TransactItems.map((t: { Put: { Item: Record<string, unknown> } }) => t.Put.Item)
      expect(pointer).toMatchObject({ PK: 'ORG#org-abc123', SK: `SIGNFORM#${FORM_ID}`, name: 'New AOA', current_version: 1, page_count: 3 })
      expect(version).toMatchObject({
        PK: 'ORG#org-abc123', SK: `SIGNFORMV#${FORM_ID}#0001`, version: 1, fields: [],
        sample_key: `sign/forms/org-abc123/${FORM_ID}/sample.pdf`, created_by: 'ops@theoflow.test',
      })
      expect(tx.input.TransactItems.every((t: { Put: { ConditionExpression: string } }) =>
        t.Put.ConditionExpression === 'attribute_not_exists(PK)')).toBe(true)
    })

    it('never puts an attribute called "status" on the pointer (shared sparse index)', async () => {
      await POST(req(goodBody), params)
      const tx = mockDdbSend.mock.calls.map(([c]) => c).find(c => c.__type === 'Tx')
      for (const t of tx.input.TransactItems) {
        expect(Object.keys(t.Put.Item)).not.toContain('status')
      }
      expect(tx.input.TransactItems[0].Put.Item.form_status).toBe('ACTIVE')
    })

    it('returns 409 if the form id already exists', async () => {
      ddb({ txError: Object.assign(new Error('x'), { name: 'TransactionCanceledException' }) })
      expect((await POST(req(goodBody), params)).status).toBe(409)
    })
  })
})
