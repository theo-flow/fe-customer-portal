import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import type { FormLayout } from '@/lib/sign-form'

const { mockCookieGet, mockDdbSend, mockPresign } = vi.hoisted(() => {
  process.env.OPERATOR_EMAILS = 'ops@theoflow.test'
  return { mockCookieGet: vi.fn(), mockDdbSend: vi.fn(), mockPresign: vi.fn() }
})

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookieGet }) }))
vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockDdbSend }),
  s3Client: () => ({}),
  TABLE: 'daai-insure-orgs', BUCKET: 'daai-insure-intake',
}))
vi.mock('@/lib/token', () => ({ verifyJwtClaims: vi.fn() }))
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand:           vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
  TransactWriteCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Tx', input } }),
}))
vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'S3Get', input } }),
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: mockPresign }))

import { verifyJwtClaims } from '@/lib/token'
import { GET, PUT } from '../route'

const FORM_ID = '11111111-2222-3333-4444-555555555555'
const params = { params: { orgId: 'org-abc123', formId: FORM_ID } }
const SAMPLE = `sign/forms/org-abc123/${FORM_ID}/sample.pdf`

const layout = (over: Partial<FormLayout> = {}): FormLayout => ({
  name: 'New AOA', page_count: 3, page_width: 595.32, page_height: 841.92,
  roles: ['Customer', 'Witness 1'],
  anchors: [],
  fields: [
    { field_id: 'a', field_type: 'signature', role: 'Customer', page: 2, x: 0.1, y: 0.79, width: 0.28, height: 0.03, instruction: 'Sign here', required: true },
    { field_id: 'b', field_type: 'signature', role: 'Witness 1', page: 3, x: 0.3, y: 0.05, width: 0.25, height: 0.04, instruction: 'Sign as witness', required: true },
  ],
  ...over,
})

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest

function ddb(opts: { pointer?: Record<string, unknown> | null; version?: Record<string, unknown> | null; txError?: unknown; orgExists?: boolean } = {}) {
  const pointer = opts.pointer === undefined
    ? { form_id: FORM_ID, form_status: 'ACTIVE', name: 'New AOA', current_version: 2, page_count: 3, page_width: 595.32, page_height: 841.92 }
    : opts.pointer
  const version = opts.version === undefined
    ? { ...layout(), version: 2, valid: true, sample_key: SAMPLE }
    : opts.version
  mockDdbSend.mockImplementation(async (cmd: { __type: string; input: { Key?: { PK: string; SK: string } } }) => {
    if (cmd.__type === 'Get') {
      const sk = cmd.input.Key!.SK
      if (sk === 'PROFILE') return opts.orgExists === false ? {} : { Item: { orgId: 'org-abc123' } }
      if (sk.startsWith('SIGNFORMV#')) return version ? { Item: version } : {}
      return pointer ? { Item: pointer } : {}
    }
    if (cmd.__type === 'Tx') { if (opts.txError) throw opts.txError; return {} }
    return {}
  })
}

describe('operator sign-form (one form)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 't' })
    vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'u', email: 'ops@theoflow.test', exp: 9999999999 })
    mockPresign.mockResolvedValue('https://s3.example/sample.pdf')
    ddb()
  })

  describe('GET', () => {
    it('is refused for a non-operator', async () => {
      vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'u', email: 'c@example.com', exp: 9999999999 })
      expect((await GET({} as NextRequest, params)).status).toBe(403)
    })

    it('rejects unsafe ids', async () => {
      expect((await GET({} as NextRequest, { params: { orgId: 'org-abc123', formId: '../x' } })).status).toBe(400)
    })

    it('returns 404 for an unknown or archived form', async () => {
      ddb({ pointer: null })
      expect((await GET({} as NextRequest, params)).status).toBe(404)
      ddb({ pointer: { form_status: 'ARCHIVED', current_version: 1 } })
      expect((await GET({} as NextRequest, params)).status).toBe(404)
    })

    it('returns the current version, its layout and a presigned link to the sample', async () => {
      const res = await GET({} as NextRequest, params)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toMatchObject({ formId: FORM_ID, version: 2, valid: true, sampleUrl: 'https://s3.example/sample.pdf' })
      expect(body.layout.roles).toEqual(['Customer', 'Witness 1'])
      expect(body.layout.fields).toHaveLength(2)
      expect(mockPresign.mock.calls[0][1].input.Key).toBe(SAMPLE)
    })

    it('reads the version the pointer says is current', async () => {
      await GET({} as NextRequest, params)
      const versionGet = mockDdbSend.mock.calls.map(([c]) => c).find(c => c.__type === 'Get' && c.input.Key.SK.startsWith('SIGNFORMV#'))
      expect(versionGet.input.Key.SK).toBe(`SIGNFORMV#${FORM_ID}#0002`)
    })
  })

  describe('PUT (save a new version)', () => {
    it('is refused for a non-operator', async () => {
      vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'u', email: 'c@example.com', exp: 9999999999 })
      expect((await PUT(req({ baseVersion: 2, layout: layout() }), params)).status).toBe(403)
    })

    it('requires a base version', async () => {
      expect((await PUT(req({ layout: layout() }), params)).status).toBe(400)
    })

    it('rejects an invalid layout with a readable message and writes nothing', async () => {
      const res = await PUT(req({ baseVersion: 2, layout: layout({ roles: [] }) }), params)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/role/i)
      expect(mockDdbSend.mock.calls.some(([c]) => c.__type === 'Tx')).toBe(false)
    })

    it('returns 409 when someone saved after the editor opened', async () => {
      const res = await PUT(req({ baseVersion: 1, layout: layout() }), params)   // pointer is at 2
      expect(res.status).toBe(409)
      expect(mockDdbSend.mock.calls.some(([c]) => c.__type === 'Tx')).toBe(false)
    })

    it('refuses to change the page count or size (they come from the sample)', async () => {
      expect((await PUT(req({ baseVersion: 2, layout: layout({ page_count: 5 }) }), params)).status).toBe(400)
      expect((await PUT(req({ baseVersion: 2, layout: layout({ page_width: 800 }) }), params)).status).toBe(400)
    })

    it('returns 404 for an unknown form', async () => {
      ddb({ pointer: null })
      expect((await PUT(req({ baseVersion: 2, layout: layout() }), params)).status).toBe(404)
    })

    it('writes an immutable NEXT version and moves the pointer, conditional on the base version', async () => {
      const res = await PUT(req({ baseVersion: 2, layout: layout() }), params)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ version: 3, valid: true, warnings: [] })

      const tx = mockDdbSend.mock.calls.map(([c]) => c).find(c => c.__type === 'Tx')
      const [put, update] = tx.input.TransactItems
      expect(put.Put.Item).toMatchObject({
        PK: 'ORG#org-abc123', SK: `SIGNFORMV#${FORM_ID}#0003`, version: 3, valid: true,
        sample_key: SAMPLE, created_by: 'ops@theoflow.test',
      })
      expect(put.Put.Item.fields).toHaveLength(2)
      expect(put.Put.ConditionExpression).toBe('attribute_not_exists(PK)')
      expect(update.Update.Key).toEqual({ PK: 'ORG#org-abc123', SK: `SIGNFORM#${FORM_ID}` })
      expect(update.Update.ConditionExpression).toBe('current_version = :base')
      expect(update.Update.ExpressionAttributeValues).toMatchObject({ ':next': 3, ':base': 2, ':fc': 2, ':valid': true })
      // "name" is a DynamoDB reserved word, so it must be aliased
      expect(update.Update.ExpressionAttributeNames).toEqual({ '#n': 'name' })
    })

    it('saves an unfinished layout but reports it as not ready, with a reason', async () => {
      const unfinished = layout({ fields: [layout().fields[0]] })   // Witness 1 never signs
      const res = await PUT(req({ baseVersion: 2, layout: unfinished }), params)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.valid).toBe(false)
      expect(body.warnings.join(' ')).toContain('Witness 1 has no signature box')
    })

    it('never writes a status attribute (shared sparse index)', async () => {
      await PUT(req({ baseVersion: 2, layout: layout() }), params)
      const tx = mockDdbSend.mock.calls.map(([c]) => c).find(c => c.__type === 'Tx')
      expect(Object.keys(tx.input.TransactItems[0].Put.Item)).not.toContain('status')
      expect(tx.input.TransactItems[1].Update.UpdateExpression).not.toMatch(/\bstatus\b/)
    })

    it('returns 409 when the pointer moved between the read and the write', async () => {
      ddb({ txError: Object.assign(new Error('x'), { name: 'TransactionCanceledException' }) })
      expect((await PUT(req({ baseVersion: 2, layout: layout() }), params)).status).toBe(409)
    })

    it('cleans instruction text on the way in', async () => {
      const dirty = layout()
      dirty.fields[0].instruction = 'Sign — here'
      await PUT(req({ baseVersion: 2, layout: dirty }), params)
      const tx = mockDdbSend.mock.calls.map(([c]) => c).find(c => c.__type === 'Tx')
      expect(tx.input.TransactItems[0].Put.Item.fields[0].instruction).toBe('Sign - here')
    })
  })
})
