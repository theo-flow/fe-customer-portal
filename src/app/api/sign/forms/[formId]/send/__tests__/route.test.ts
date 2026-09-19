import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const { mockCookieGet, mockDdbSend, mockS3Send, mockSqsSend } = vi.hoisted(() => {
  process.env.SQS_SIGN_URL = 'https://sqs.af-south-1.amazonaws.com/1/daai-insure-sign'
  return { mockCookieGet: vi.fn(), mockDdbSend: vi.fn(), mockS3Send: vi.fn(), mockSqsSend: vi.fn() }
})

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookieGet }) }))
vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockDdbSend }), s3Client: () => ({ send: mockS3Send }), sqsClient: () => ({ send: mockSqsSend }),
  TABLE: 'daai-insure-orgs', BUCKET: 'daai-insure-intake',
}))
vi.mock('@/lib/token', () => ({ verifyJwtClaims: vi.fn() }))
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
  PutCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Put', input } }),
}))
vi.mock('@aws-sdk/client-s3', () => ({
  HeadObjectCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'S3Head', input } }),
  GetObjectCommand:  vi.fn(function (this: unknown, input: unknown) { return { __type: 'S3Get', input } }),
}))
vi.mock('@aws-sdk/client-sqs', () => ({
  SendMessageCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Sqs', input } }),
}))

import { verifyJwtClaims } from '@/lib/token'
import { hashToken } from '@/lib/sign'
import { POST } from '../route'

const FORM_ID = 'form-aoa'
const SESSION_ID = 'sess-1'
const params = { params: { formId: FORM_ID } }
const PDF = new TextEncoder().encode('%PDF-1.7 rest')
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const ROLES = ['Customer', 'Witness 1', 'Seller']
const FIELDS = [
  { field_id: 'i1', field_type: 'initials', role: 'Customer', page: 1, x: 0.85, y: 0.94, width: 0.1, height: 0.04, instruction: 'Initial here', required: true },
  { field_id: 's1', field_type: 'signature', role: 'Customer', page: 2, x: 0.1, y: 0.79, width: 0.28, height: 0.03, instruction: 'Sign here', required: true },
  { field_id: 'd1', field_type: 'date', role: 'Customer', page: 2, x: 0.1, y: 0.82, width: 0.3, height: 0.03, instruction: 'Date', required: true, date_format: 'day_month' },
  { field_id: 'w1', field_type: 'signature', role: 'Witness 1', page: 2, x: 0.28, y: 0.86, width: 0.22, height: 0.03, instruction: 'Sign as a witness', required: true },
  { field_id: 'l1', field_type: 'signature', role: 'Seller', page: 3, x: 0.3, y: 0.05, width: 0.25, height: 0.04, instruction: 'Sign for the seller', required: true },
]

const body = (over: Record<string, unknown> = {}) => ({
  formVersion: 3,
  sourceDocument: { sessionId: SESSION_ID, s3Key: `sign/source/${SESSION_ID}/thandi-aoa.pdf`, sha256: 'abc', filename: 'thandi-aoa.pdf' },
  signers: [
    { role: 'Customer', name: 'Thandi Nkosi', email: 'thandi@example.com' },
    { role: 'Witness 1', name: 'Sipho Dlamini', email: 'sipho@example.com' },
    { role: 'Seller', name: 'Anele Bank', email: 'anele@bank.example' },
  ],
  ...over,
})
const req = (b: unknown) => ({ json: async () => b, nextUrl: { origin: 'https://theoflow.test' } }) as unknown as NextRequest

function ddb(opts: { pointer?: Record<string, unknown> | null; version?: Record<string, unknown> | null; putError?: unknown } = {}) {
  const pointer = opts.pointer === undefined ? { form_status: 'ACTIVE', current_version: 3 } : opts.pointer
  const version = opts.version === undefined
    ? { version: 3, name: 'New AOA', valid: true, roles: ROLES, fields: FIELDS, page_count: 3 } : opts.version
  mockDdbSend.mockImplementation(async (cmd: { __type: string; input: { Key?: { PK: string; SK: string }; Item?: { SK: string } } }) => {
    if (cmd.__type === 'Get') {
      const sk = cmd.input.Key!.SK
      if (sk === 'PROFILE') return { Item: { orgName: 'Acme Brokers' } }
      if (sk.startsWith('SIGNFORMV#')) return version ? { Item: version } : {}
      return pointer ? { Item: pointer } : {}
    }
    if (cmd.__type === 'Put' && opts.putError && cmd.input.Item!.SK === 'SESSION') throw opts.putError
    return {}
  })
}
function s3(bytes: Uint8Array | null) {
  mockS3Send.mockImplementation(async (cmd: { __type: string }) => {
    if (bytes === null) throw new Error('NotFound')
    return cmd.__type === 'S3Get' ? { Body: { transformToByteArray: async () => bytes } } : {}
  })
}
const sessionPut = () => mockDdbSend.mock.calls.map(([c]) => c).find(c => c.__type === 'Put' && c.input.Item.SK === 'SESSION')
const puts = () => mockDdbSend.mock.calls.map(([c]) => c).filter(c => c.__type === 'Put')

describe('POST /api/sign/forms/[formId]/send', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 't' })
    vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'u', email: 'staff@acme.test', exp: 9999999999, 'custom:org_id': 'org-abc123' })
    mockSqsSend.mockResolvedValue({})
    ddb(); s3(PDF)
  })

  describe('access', () => {
    it('401 without a cookie, 403 without an org', async () => {
      mockCookieGet.mockReturnValue(undefined)
      expect((await POST(req(body()), params)).status).toBe(401)
      mockCookieGet.mockReturnValue({ value: 't' })
      vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'u', email: 'a@b.com', exp: 9999999999 })
      expect((await POST(req(body()), params)).status).toBe(403)
    })

    it('reads the form from the caller\'s own organisation only', async () => {
      await POST(req(body()), params)
      const formGets = mockDdbSend.mock.calls.map(([c]) => c).filter(c => c.__type === 'Get' && c.input.Key.SK.startsWith('SIGNFORM'))
      expect(formGets.every(g => g.input.Key.PK === 'ORG#org-abc123')).toBe(true)
    })

    it('404 for a form that does not exist, is archived, or belongs to another organisation', async () => {
      ddb({ pointer: null })
      expect((await POST(req(body()), params)).status).toBe(404)
      ddb({ pointer: { form_status: 'ARCHIVED', current_version: 3 } })
      expect((await POST(req(body()), params)).status).toBe(404)
    })

    it('rejects an unsafe form id', async () => {
      expect((await POST(req(body()), { params: { formId: '../x' } })).status).toBe(400)
    })
  })

  describe('the form', () => {
    it('refuses a form that is not ready to send', async () => {
      ddb({ version: { version: 3, valid: false, roles: ROLES, fields: FIELDS } })
      expect((await POST(req(body()), params)).status).toBe(409)
      expect(puts()).toHaveLength(0)
    })

    it('asks to reload when the form changed since the screen loaded', async () => {
      const res = await POST(req(body({ formVersion: 2 })), params)
      expect(res.status).toBe(409)
      expect((await res.json()).error).toMatch(/updated/)
      expect(puts()).toHaveLength(0)
    })
  })

  describe('the people', () => {
    it.each([
      ['a role is missing', { signers: body().signers.slice(0, 2) }],
      ['an extra person', { signers: [...body().signers, { role: 'Ghost', name: 'G', email: 'g@example.com' }] }],
      ['an unknown role', { signers: body().signers.map(s => (s.role === 'Seller' ? { ...s, role: 'Buyer' } : s)) }],
      ['a blank name', { signers: body().signers.map(s => (s.role === 'Seller' ? { ...s, name: '  ' } : s)) }],
      ['an invalid email', { signers: body().signers.map(s => (s.role === 'Seller' ? { ...s, email: 'not-an-email' } : s)) }],
      ['a missing email', { signers: body().signers.map(s => (s.role === 'Seller' ? { ...s, email: undefined } : s)) }],
    ])('rejects %s', async (_l, over) => {
      const res = await POST(req(body(over)), params)
      expect(res.status).toBe(400)
      expect(puts()).toHaveLength(0)
      expect(mockSqsSend).not.toHaveBeenCalled()
    })

    it('rejects the same email used for two roles, however it is capitalised', async () => {
      const dup = body().signers.map(s => (s.role === 'Witness 1' ? { ...s, email: 'THANDI@example.com' } : s))
      const res = await POST(req(body({ signers: dup })), params)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/own email/)
    })
  })

  describe('the uploaded document', () => {
    it.each([
      ['missing fields', { sourceDocument: { sessionId: SESSION_ID } }],
      ['an unsafe session id', { sourceDocument: { sessionId: '../x', s3Key: 'sign/source/../x/a.pdf', sha256: 'a' } }],
      ['a key outside the upload area the server issued', { sourceDocument: { sessionId: SESSION_ID, s3Key: 'raw/other-org/secret.pdf', sha256: 'a' } }],
      ['a key for a different session', { sourceDocument: { sessionId: SESSION_ID, s3Key: 'sign/source/other-session/a.pdf', sha256: 'a' } }],
    ])('rejects %s', async (_l, over) => {
      expect((await POST(req(body(over)), params)).status).toBe(400)
      expect(puts()).toHaveLength(0)
    })

    it('rejects an upload that is not there or is not a PDF', async () => {
      s3(null)
      expect((await POST(req(body()), params)).status).toBe(400)
      s3(PNG)
      const res = await POST(req(body()), params)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/PDF/)
      expect(puts()).toHaveLength(0)
    })
  })

  describe('a successful send', () => {
    it('creates a live session from the saved layout, one signer per role in role order', async () => {
      const res = await POST(req(body()), params)
      expect(res.status).toBe(201)
      const { item } = { item: sessionPut().input.Item }

      expect(item).toMatchObject({ PK: `SESSION#${SESSION_ID}`, SK: 'SESSION', session_id: SESSION_ID, status: 'PENDING' })
      expect(item.signers.map((s: { role: string; order: number }) => [s.order, s.role]))
        .toEqual([[1, 'Customer'], [2, 'Witness 1'], [3, 'Seller']])
      expect(item.source_document).toMatchObject({ s3_key: `sign/source/${SESSION_ID}/thandi-aoa.pdf`, sha256: 'abc' })
      expect(item.working_document.detection_status).toBe('DONE')
      expect(item.working_document.form).toEqual({ form_id: FORM_ID, version: 3, name: 'New AOA' })
    })

    it('maps every box to the signer of its role and keeps instructions and date formats', async () => {
      await POST(req(body()), params)
      const fields = sessionPut().input.Item.working_document.detected_fields
      expect(fields).toHaveLength(5)
      const byId = Object.fromEntries(fields.map((f: { field_id: string }) => [f.field_id, f]))
      expect(byId.i1).toMatchObject({ field_type: 'initials', signer_order: 1, signer_role: 'Customer', page: 1, instruction: 'Initial here', confirmed_by_org: true, source: 'org_configured' })
      expect(byId.d1).toMatchObject({ field_type: 'date', signer_order: 1, date_format: 'day_month' })
      expect(byId.w1).toMatchObject({ signer_order: 2, signer_role: 'Witness 1' })
      expect(byId.l1).toMatchObject({ signer_order: 3, page: 3 })
      expect(byId.s1.date_format).toBeUndefined()
    })

    it('never turns a box that only READS the recipient into something a signer must do', async () => {
      const withReads = [
        ...FIELDS,
        { field_id: 'r1', field_type: 'read_name', role: 'Customer', page: 1, x: 0.3, y: 0.33, width: 0.3, height: 0.03, instruction: 'Read from the document', required: true },
        { field_id: 'r2', field_type: 'read_email', role: 'Customer', page: 1, x: 0.3, y: 0.5, width: 0.4, height: 0.03, instruction: 'Read from the document', required: true },
      ]
      ddb({ version: { version: 3, name: 'New AOA', valid: true, roles: ROLES, fields: withReads, page_count: 3 } })
      const res = await POST(req(body()), params)
      expect(res.status).toBe(201)
      const saved = sessionPut().input.Item.working_document.detected_fields
      expect(saved).toHaveLength(FIELDS.length)
      expect(saved.map((f: { field_id: string }) => f.field_id)).not.toContain('r1')
      expect(saved.map((f: { field_id: string }) => f.field_id)).not.toContain('r2')
      expect(saved.every((f: { field_type: string }) => !f.field_type.startsWith('read_'))).toBe(true)
    })

    it('records who sent it and the form it came from, for the requester emails and the page-count guard', async () => {
      await POST(req(body()), params)
      expect(sessionPut().input.Item.metadata).toEqual({
        created_by_email: 'staff@acme.test', form_id: FORM_ID, form_version: 3, form_name: 'New AOA', form_page_count: 3,
      })
    })

    it('never overwrites an existing session and lists it under the caller\'s organisation', async () => {
      await POST(req(body()), params)
      expect(sessionPut().input.ConditionExpression).toBe('attribute_not_exists(PK)')
      const pointerPut = puts().find(c => c.input.Item.SK === `SESSION#${SESSION_ID}`)
      expect(pointerPut.input.Item).toMatchObject({ PK: 'ORG#org-abc123', sessionId: SESSION_ID, orgId: 'org-abc123', signerCount: 3 })
    })

    it('stores only hashes of the signing tokens, and returns working links that match them', async () => {
      const res = await POST(req(body()), params)
      const out = await res.json()
      const saved = sessionPut().input.Item.signers
      expect(out.signers).toHaveLength(3)
      for (const link of out.signers) {
        const raw = link.signUrl.split('/').pop()
        const signer = saved.find((s: { signer_id: string }) => s.signer_id === link.signerId)
        expect(hashToken(raw)).toBe(signer.token_hash)
        expect(JSON.stringify(saved)).not.toContain(raw)
        expect(link.signUrl).toBe(`https://theoflow.test/sign/${SESSION_ID}/${link.signerId}/${raw}`)
      }
      expect(new Set(out.signers.map((l: { signUrl: string }) => l.signUrl.split('/').pop())).size).toBe(3)
      expect(out.signers.map((l: { role: string }) => l.role)).toEqual(ROLES)
    })

    it('queues one notify_signers message with every link and the organisation name', async () => {
      const out = await (await POST(req(body()), params)).json()
      expect(mockSqsSend).toHaveBeenCalledTimes(1)
      const msg = JSON.parse(mockSqsSend.mock.calls[0][0].input.MessageBody)
      expect(msg).toMatchObject({ session_id: SESSION_ID, action: 'notify_signers', requested_by: 'Acme Brokers' })
      expect(msg.signer_links).toEqual(out.signers.map((l: { signerId: string; signUrl: string }) => ({ signer_id: l.signerId, sign_url: l.signUrl })))
      expect(out.emailQueued).toBe(true)
    })

    it('still succeeds, and returns the links, when the email queue is down', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSqsSend.mockRejectedValue(new Error('sqs down'))
      const res = await POST(req(body()), params)
      expect(res.status).toBe(201)
      const out = await res.json()
      expect(out.emailQueued).toBe(false)
      expect(out.signers[0].signUrl).toContain('/sign/')
    })

    it('trims names and collapses spaces', async () => {
      const spaced = body().signers.map(s => ({ ...s, name: `  ${s.name.replace(' ', '   ')}  ` }))
      await POST(req(body({ signers: spaced })), params)
      expect(sessionPut().input.Item.signers[0].name).toBe('Thandi Nkosi')
    })

    it('returns 409 if the upload was already sent', async () => {
      ddb({ putError: Object.assign(new Error('x'), { name: 'ConditionalCheckFailedException' }) })
      expect((await POST(req(body()), params)).status).toBe(409)
      expect(mockSqsSend).not.toHaveBeenCalled()
    })

    it('returns 500 and queues nothing if the session cannot be written', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      ddb({ putError: new Error('boom') })
      expect((await POST(req(body()), params)).status).toBe(500)
      expect(mockSqsSend).not.toHaveBeenCalled()
    })
  })
})
