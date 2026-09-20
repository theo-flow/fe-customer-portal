import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import type { FormLayout } from '@/lib/sign-form'

const { mockCookieGet, mockDdbSend, mockPresign, mockS3Send } = vi.hoisted(() => {
  process.env.OPERATOR_EMAILS = 'ops@theoflow.test'
  return { mockCookieGet: vi.fn(), mockDdbSend: vi.fn(), mockPresign: vi.fn(), mockS3Send: vi.fn() }
})

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookieGet }) }))
vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockDdbSend }),
  s3Client: () => ({ send: mockS3Send }),
  TABLE: 'daai-insure-orgs', BUCKET: 'daai-insure-intake', SIGN_BUCKET: 'daai-insure-sign',
}))
vi.mock('@/lib/token', () => ({ verifyJwtClaims: vi.fn() }))
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand:           vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
  TransactWriteCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Tx', input } }),
  QueryCommand:         vi.fn(function (this: unknown, input: unknown) { return { __type: 'Query', input } }),
  DeleteCommand:        vi.fn(function (this: unknown, input: unknown) { return { __type: 'Delete', input } }),
}))
vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'S3Get', input } }),
  DeleteObjectCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'S3Delete', input } }),
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: mockPresign }))

import { verifyJwtClaims } from '@/lib/token'
import { DELETE, GET, PUT } from '../route'

const FORM_ID = '11111111-2222-3333-4444-555555555555'
const params = { params: { orgId: 'org-abc123', formId: FORM_ID } }
const SAMPLE = `sign/forms/org-abc123/${FORM_ID}/sample.pdf`

const layout = (over: Partial<FormLayout> = {}): FormLayout => ({
  name: 'New AOA', page_count: 3, page_width: 595.32, page_height: 841.92,
  roles: ['Customer', 'Witness 1'],
  anchors: [], role_defaults: [],
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
      expect(update.Update.ExpressionAttributeValues).toMatchObject({ ':next': 3, ':base': 2, ':fc': 2, ':valid': true, ':anchors': [] })
      // "name" and "roles" are DynamoDB reserved words, so they must be aliased
      expect(update.Update.ExpressionAttributeNames).toEqual({ '#n': 'name', '#roles': 'roles', '#valid': 'valid' })
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

    it('saves recognition phrases on the version and on the pointer the customer screens read', async () => {
      const withAnchors = layout({ anchors: [{ page: 1, text: 'AMENDMENT OF AGREEMENT' }, { page: 2, text: 'In presence of the undersigned witnesses' }] })
      const res = await PUT(req({ baseVersion: 2, layout: withAnchors }), params)
      expect(res.status).toBe(200)
      const tx = mockDdbSend.mock.calls.map(([c]) => c).find(c => c.__type === 'Tx')
      expect(tx.input.TransactItems[0].Put.Item.anchors).toHaveLength(2)
      expect(tx.input.TransactItems[1].Update.ExpressionAttributeValues[':anchors']).toEqual(withAnchors.anchors)
    })

    it('rejects a recognition phrase that is too short or on a page that does not exist', async () => {
      expect((await PUT(req({ baseVersion: 2, layout: layout({ anchors: [{ page: 1, text: 'Hi' }] }) }), params)).status).toBe(400)
      expect((await PUT(req({ baseVersion: 2, layout: layout({ anchors: [{ page: 9, text: 'AMENDMENT OF AGREEMENT' }] }) }), params)).status).toBe(400)
    })

    it('keeps where the recipient is read from, and the usual people, on the pointer the customer screens read', async () => {
      const withReads = layout({
        roles: ['Customer', 'Witness 1'],
        fields: [
          ...layout().fields,
          { field_id: 'r1', field_type: 'read_name', role: 'Customer', page: 1, x: 0.3, y: 0.33, width: 0.3, height: 0.03, instruction: 'Read from the document', required: true },
          { field_id: 'r2', field_type: 'read_email', role: 'Customer', page: 1, x: 0.3, y: 0.5, width: 0.4, height: 0.03, instruction: 'Read from the document', required: true },
        ],
        role_defaults: [{ role: 'Witness 1', name: 'Anele Botha', email: 'anele@bank.example' }],
      })
      const res = await PUT(req({ baseVersion: 2, layout: withReads }), params)
      expect(res.status).toBe(200)
      const tx = mockDdbSend.mock.calls.map(([c]) => c).find(c => c.__type === 'Tx')
      const values = tx.input.TransactItems[1].Update.ExpressionAttributeValues
      expect(values[':reads']).toEqual([
        { role: 'Customer', kind: 'name', page: 1, x: 0.3, y: 0.33, width: 0.3, height: 0.03 },
        { role: 'Customer', kind: 'email', page: 1, x: 0.3, y: 0.5, width: 0.4, height: 0.03 },
      ])
      expect(values[':rd']).toEqual([{ role: 'Witness 1', name: 'Anele Botha', email: 'anele@bank.example' }])
      // "reads" is a DynamoDB reserved word, so the attribute has another name
      expect(tx.input.TransactItems[1].Update.UpdateExpression).toContain('read_boxes = :reads')
      expect(tx.input.TransactItems[0].Put.Item.role_defaults).toHaveLength(1)
    })

    it('saves an empty list when the form has no read boxes or default people', async () => {
      await PUT(req({ baseVersion: 2, layout: layout() }), params)
      const tx = mockDdbSend.mock.calls.map(([c]) => c).find(c => c.__type === 'Tx')
      expect(tx.input.TransactItems[1].Update.ExpressionAttributeValues[':reads']).toEqual([])
      expect(tx.input.TransactItems[1].Update.ExpressionAttributeValues[':rd']).toEqual([])
    })

    it('rejects a default person with an invalid email, and writes nothing', async () => {
      const res = await PUT(req({ baseVersion: 2, layout: layout({ role_defaults: [{ role: 'Customer', name: 'A', email: 'nope' }] }) }), params)
      expect(res.status).toBe(400)
      expect(mockDdbSend.mock.calls.some(([c]) => c.__type === 'Tx')).toBe(false)
    })

    it('returns the usual people when the editor loads', async () => {
      ddb({ version: { ...layout({ role_defaults: [{ role: 'Customer', name: 'Anele', email: 'a@b.co' }] }), version: 2, valid: true, sample_key: SAMPLE } })
      const body = await (await GET({} as NextRequest, params)).json()
      expect(body.layout.role_defaults).toEqual([{ role: 'Customer', name: 'Anele', email: 'a@b.co' }])
    })

    it('cleans instruction text on the way in', async () => {
      const dirty = layout()
      dirty.fields[0].instruction = 'Sign — here'
      await PUT(req({ baseVersion: 2, layout: dirty }), params)
      const tx = mockDdbSend.mock.calls.map(([c]) => c).find(c => c.__type === 'Tx')
      expect(tx.input.TransactItems[0].Put.Item.fields[0].instruction).toBe('Sign - here')
    })
    it('never puts a DynamoDB reserved word into the update expression bare (the real service rejects it)', async () => {
      await PUT(req({ baseVersion: 2, layout: layout() }), params)
      const tx = mockDdbSend.mock.calls.map(([c]) => c).find(c => c.__type === 'Tx')
      const update = tx.input.TransactItems[1].Update
      // roles is reserved: it must go through an alias
      expect(update.UpdateExpression).not.toMatch(/(^|[ ,])roles = /)
      expect(update.UpdateExpression).toContain('#roles = :roles')
      expect(update.ExpressionAttributeNames).toMatchObject({ '#n': 'name', '#roles': 'roles' })
    })
  })
})

describe('DELETE /api/operator/orgs/[orgId]/sign-forms/[formId]', () => {
  const VERSIONS = [`SIGNFORMV#${FORM_ID}#0001`, `SIGNFORMV#${FORM_ID}#0002`]
  const deletes = () => mockDdbSend.mock.calls.map(([c]) => c).filter(c => c.__type === 'Delete').map(c => c.input.Key)

  function world(opts: { pointer?: boolean; queryError?: unknown } = {}) {
    mockDdbSend.mockImplementation(async (cmd: { __type: string; input: { Key?: { SK: string } } }) => {
      if (cmd.__type === 'Get') return opts.pointer === false ? {} : { Item: { form_id: FORM_ID } }
      if (cmd.__type === 'Query') {
        if (opts.queryError) throw opts.queryError
        return { Items: VERSIONS.map(SK => ({ PK: 'ORG#org-abc123', SK })) }
      }
      return {}
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 't' })
    vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'u', email: 'ops@theoflow.test', exp: 9999999999 })
    mockS3Send.mockResolvedValue({})
    world()
  })

  it.each([
    ['no cookie', () => mockCookieGet.mockReturnValue(undefined), 401],
    ['not an operator', () => vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'u', email: 'c@example.com', exp: 9999999999 }), 403],
  ])('is refused for %s and deletes nothing', async (_l, arrange, status) => {
    arrange()
    expect((await DELETE({} as NextRequest, params)).status).toBe(status)
    expect(mockS3Send).not.toHaveBeenCalled()
    expect(deletes()).toHaveLength(0)
  })

  it('rejects unsafe ids', async () => {
    expect((await DELETE({} as NextRequest, { params: { orgId: '../x', formId: FORM_ID } })).status).toBe(400)
    expect((await DELETE({} as NextRequest, { params: { orgId: 'org-abc123', formId: 'a/b' } })).status).toBe(400)
  })

  it('404s for a form that does not exist', async () => {
    world({ pointer: false })
    expect((await DELETE({} as NextRequest, params)).status).toBe(404)
    expect(mockS3Send).not.toHaveBeenCalled()
  })

  it('deletes the sample, every version, then the form itself last', async () => {
    const res = await DELETE({} as NextRequest, params)
    expect(res.status).toBe(200)
    expect(mockS3Send.mock.calls[0][0].input).toEqual({ Bucket: 'daai-insure-sign', Key: SAMPLE })   // key derived from the ids
    const query = mockDdbSend.mock.calls.map(([c]) => c).find(c => c.__type === 'Query')
    expect(query.input.ExpressionAttributeValues).toEqual({ ':pk': 'ORG#org-abc123', ':prefix': `SIGNFORMV#${FORM_ID}#` })
    expect(deletes()).toEqual([
      { PK: 'ORG#org-abc123', SK: VERSIONS[0] }, { PK: 'ORG#org-abc123', SK: VERSIONS[1] },
      { PK: 'ORG#org-abc123', SK: `SIGNFORM#${FORM_ID}` },
    ])
  })

  it('changes nothing else if the sample cannot be deleted, so it can be retried', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockS3Send.mockRejectedValue(new Error('denied'))
    const res = await DELETE({} as NextRequest, params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Could not delete the form. Please try again.')
    expect(deletes()).toHaveLength(0)
  })

  it('keeps the form listed if it fails part way, so it can be deleted again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    world({ queryError: new Error('boom') })
    expect((await DELETE({} as NextRequest, params)).status).toBe(500)
    expect(deletes().some(k => k.SK === `SIGNFORM#${FORM_ID}`)).toBe(false)
  })
})
