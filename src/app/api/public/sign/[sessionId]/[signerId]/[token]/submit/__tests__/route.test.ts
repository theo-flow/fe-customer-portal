import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import type { DetectedField, SignSession, Signer } from '@/lib/sign'

const { mockDdbSend, mockSqsSend } = vi.hoisted(() => {
  process.env.SQS_SIGN_URL = 'https://sqs.af-south-1.amazonaws.com/1/daai-insure-sign'
  return { mockDdbSend: vi.fn(), mockSqsSend: vi.fn() }
})

vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockDdbSend }), sqsClient: () => ({ send: mockSqsSend }), TABLE: 'daai-insure-orgs',
}))
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
  PutCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Put', input } }),
}))
vi.mock('@aws-sdk/client-sqs', () => ({
  SendMessageCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Sqs', input } }),
}))

import { hashToken } from '@/lib/sign'
import { POST } from '../route'

const SESSION_ID = 'sess-1'
const PNG = 'data:image/png;base64,iVBORw0KGgo='

const box = (over: Partial<DetectedField>): DetectedField => ({
  field_id: 'x', field_type: 'signature', signer_order: 1, page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.04,
  source: 'org_configured', confidence: 1, ...over,
})

const FIELDS: DetectedField[] = [
  box({ field_id: 'i1', field_type: 'initials', signer_order: 1, page: 1 }),
  box({ field_id: 's1', field_type: 'signature', signer_order: 1, page: 2 }),
  box({ field_id: 'p1', field_type: 'place', signer_order: 1, page: 2, y: 0.5 }),
  box({ field_id: 'p2', field_type: 'place', signer_order: 1, page: 3, y: 0.5 }),
  box({ field_id: 'd1', field_type: 'date', signer_order: 1, page: 2, y: 0.6 }),
  box({ field_id: 'w1', field_type: 'signature', signer_order: 2, page: 2, y: 0.8 }),
]

const signer = (n: number, over: Partial<Signer> = {}): Signer => ({
  signer_id: `signer-${n}`, name: `Signer ${n}`, email: `s${n}@example.com`, role: n === 1 ? 'Customer' : 'Witness 1', order: n,
  status: 'PENDING', token_hash: hashToken(`tok${n}`), token_expires_at: '2999-01-01T00:00:00.000Z', token_used: false,
  signed_at: null, ip_address: null, user_agent: null, signature_type: null, signature_data: null, place_data: null, email_sent: true,
  ...over,
})

const session = (over: Partial<SignSession> = {}, signers: Signer[] = [signer(1), signer(2)], fields: DetectedField[] = FIELDS): SignSession => ({
  session_id: SESSION_ID, source_document: { s3_key: 'sign/source/x/a.pdf', sha256: 'a', uploaded_at: 't' },
  working_document: { detected_fields: fields, detection_status: 'DONE' }, signers, status: 'PENDING',
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z', ...over,
})

const req = (b: unknown) => ({ json: async () => b, headers: new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'user-agent': 'TestBrowser/1' }) }) as unknown as NextRequest
const params = (n: number, token = `tok${n}`) => ({ params: { sessionId: SESSION_ID, signerId: `signer-${n}`, token } })

const customerAnswer = {
  signatureType: 'DRAWN', signatureData: PNG, initialsType: 'TYPED', initialsData: 'TN',
  placeValues: { p1: 'Cape Town', p2: 'Durban' },
}

// each read returns the next state in the list (the last one repeats)
function reads(...states: (SignSession | null)[]) {
  let i = 0
  mockDdbSend.mockImplementation(async (cmd: { __type: string }) => {
    if (cmd.__type === 'Get') {
      const s = states[Math.min(i++, states.length - 1)]
      return s ? { Item: structuredClone(s) } : {}   // a real read is a fresh copy every time
    }
    return {}
  })
}
const puts = () => mockDdbSend.mock.calls.map(([c]) => c).filter(c => c.__type === 'Put')
const savedSession = () => puts().pop()!.input.Item as SignSession

describe('POST /api/public/sign/.../submit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSqsSend.mockResolvedValue({})
    reads(session())
  })

  describe('links and session state', () => {
    it.each([
      ['a session that does not exist', () => reads(null), 404],
      ['an unknown signer', () => undefined, 404],
    ])('rejects %s', async (_l, arrange, status) => {
      arrange()
      const res = await POST(req(customerAnswer), _l === 'an unknown signer' ? { params: { sessionId: SESSION_ID, signerId: 'nobody', token: 'x' } } : params(1))
      expect(res.status).toBe(status)
    })

    it('rejects a wrong token, and a token belonging to a different signer', async () => {
      expect((await POST(req(customerAnswer), params(1, 'wrong'))).status).toBe(403)
      expect((await POST(req(customerAnswer), params(1, 'tok2'))).status).toBe(403)
      expect(puts()).toHaveLength(0)
    })

    it('rejects an expired or already used link', async () => {
      reads(session({}, [signer(1, { token_expires_at: '2000-01-01T00:00:00.000Z' }), signer(2)]))
      expect((await POST(req(customerAnswer), params(1))).status).toBe(403)
      reads(session({}, [signer(1, { token_used: true }), signer(2)]))
      expect((await POST(req(customerAnswer), params(1))).status).toBe(403)
    })

    it('rejects a signer who already signed', async () => {
      reads(session({}, [signer(1, { status: 'SIGNED' }), signer(2)]))
      expect((await POST(req(customerAnswer), params(1))).status).toBe(409)
    })

    it.each(['DRAFT', 'CANCELLED', 'EXPIRED', 'FAILED', 'DECLINED'] as const)('rejects a %s session', async (status) => {
      reads(session({ status }))
      expect((await POST(req(customerAnswer), params(1))).status).toBe(409)
      expect(puts()).toHaveLength(0)
    })

    it('rejects a body that is not JSON or not an object', async () => {
      const bad = { json: async () => { throw new Error('x') }, headers: new Headers() } as unknown as NextRequest
      vi.spyOn(console, 'error').mockImplementation(() => {})
      expect((await POST(bad, params(1))).status).toBe(400)
      expect((await POST(req(null), params(1))).status).toBe(400)
    })
  })

  describe('what must be provided (checked on the server)', () => {
    it.each([
      ['no signature', { ...customerAnswer, signatureData: undefined }, 'Please add your signature.'],
      ['no initials', { ...customerAnswer, initialsData: undefined }, 'Please add your initials.'],
      ['a missing place for a box', { ...customerAnswer, placeValues: { p1: 'Cape Town' } }, 'Please say where you are signing (page 3).'],
      ['a drawn signature that is not a PNG', { ...customerAnswer, signatureData: 'data:text/html;base64,PGI+' }, 'Your signature could not be read. Please draw it again.'],
    ])('returns 400 for %s and writes nothing', async (_l, body, message) => {
      const res = await POST(req(body), params(1))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe(message)
      expect(puts()).toHaveLength(0)
      expect(mockSqsSend).not.toHaveBeenCalled()
    })

    it('a witness is asked only for a signature, not for the customer\'s initials or places', async () => {
      const res = await POST(req({ signatureType: 'TYPED', signatureData: 'Sipho Dlamini' }), params(2))
      expect(res.status).toBe(200)
    })

    it('an older session with no boxes needs just a signature, as before', async () => {
      reads(session({ working_document: {} }))
      expect((await POST(req({ signatureType: 'TYPED', signatureData: 'Thandi' }), params(1))).status).toBe(200)
      reads(session({ working_document: {} }))
      expect((await POST(req({}), params(1))).status).toBe(400)
    })
  })

  describe('what is recorded', () => {
    it('stores the signature, initials, each place answer, and who and when', async () => {
      const res = await POST(req(customerAnswer), params(1))
      expect(res.status).toBe(200)
      const s = savedSession().signers[0]
      expect(s).toMatchObject({
        status: 'SIGNED', signature_type: 'DRAWN', signature_data: PNG, initials_type: 'TYPED', initials_data: 'TN',
        place_data: 'Cape Town', token_used: true, ip_address: '203.0.113.9', user_agent: 'TestBrowser/1',
      })
      expect(s.signed_at).toBeTruthy()
      expect(s.field_values).toEqual({ p1: { value: 'Cape Town', at: s.signed_at }, p2: { value: 'Durban', at: s.signed_at } })
    })

    it('cleans place answers and never stores an answer for a box the signer does not have', async () => {
      await POST(req({ ...customerAnswer, placeValues: { p1: '  Cape\nTown ', p2: 'Durban', w1: 'not mine' } }), params(1))
      const s = savedSession().signers[0]
      expect(s.field_values).toEqual({ p1: expect.objectContaining({ value: 'Cape Town' }), p2: expect.objectContaining({ value: 'Durban' }) })
      expect(JSON.stringify(s)).not.toContain('not mine')
    })

    it('leaves the other signer untouched and moves the session to IN_PROGRESS', async () => {
      await POST(req(customerAnswer), params(1))
      const saved = savedSession()
      expect(saved.status).toBe('IN_PROGRESS')
      expect(saved.signers[1]).toMatchObject({ status: 'PENDING', token_used: false, signature_data: null })
    })

    it('records the date the signer chose, separately from the moment they actually signed', async () => {
      const chosen = new Date(Date.now() - 3 * 86400000 + 2 * 3600000).toISOString().slice(0, 10)
      const res = await POST(req({ ...customerAnswer, signingDate: chosen }), params(1))
      expect(res.status).toBe(200)
      const s = savedSession().signers[0]
      expect(s.signing_date).toBe(chosen)
      expect(s.signed_at).not.toContain(chosen)   // signed_at is the real time, not the chosen day
    })

    it('an older page that sends no date still signs, with no chosen date recorded', async () => {
      await POST(req(customerAnswer), params(1))
      expect(savedSession().signers[0].signing_date).toBeNull()
    })

    it.each([
      ['a date in the future', '2999-01-01', 'The date cannot be in the future.'],
      ['a date long ago', '2020-01-01', 'The date cannot be more than 30 days ago.'],
      ['something that is not a date', 'yesterday', 'Please choose a valid date.'],
      ['an impossible date', '2026-02-30', 'Please choose a valid date.'],
    ])('rejects %s and writes nothing', async (_l, signingDate, message) => {
      const res = await POST(req({ ...customerAnswer, signingDate }), params(1))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe(message)
      expect(puts()).toHaveLength(0)
    })

    it('records an older single place answer for a box with no id', async () => {
      const old = [box({ field_id: undefined, field_type: 'signature' }), box({ field_id: undefined, field_type: 'place' })]
      reads(session({}, [signer(1)], old))
      await POST(req({ signatureType: 'TYPED', signatureData: 'A', placeData: 'Cape Town' }), params(1))
      expect(savedSession().signers[0].place_data).toBe('Cape Town')
    })
  })

  describe('sealing', () => {
    it('does not seal while someone still has to sign', async () => {
      await POST(req(customerAnswer), params(1))
      expect(mockSqsSend).not.toHaveBeenCalled()
    })

    it('queues exactly one seal when the last person signs', async () => {
      reads(session({}, [signer(1, { status: 'SIGNED', token_used: true }), signer(2)]))
      const res = await POST(req({ signatureType: 'TYPED', signatureData: 'Sipho' }), params(2))
      expect(res.status).toBe(200)
      expect(mockSqsSend).toHaveBeenCalledTimes(1)
      expect(JSON.parse(mockSqsSend.mock.calls[0][0].input.MessageBody)).toEqual({ session_id: SESSION_ID })
    })

    it('says so if the seal could not be queued (the signature is still recorded)', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSqsSend.mockRejectedValue(new Error('sqs down'))
      reads(session({}, [signer(1, { status: 'SIGNED', token_used: true }), signer(2)]))
      const res = await POST(req({ signatureType: 'TYPED', signatureData: 'Sipho' }), params(2))
      expect(res.status).toBe(500)
      expect((await res.json()).error).toMatch(/Signature recorded/)
      expect(puts()).toHaveLength(1)
    })
  })

  describe('two people signing at the same moment', () => {
    const clash = Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' })

    it('never overwrites the other person: it re-reads and applies its own signature on top', async () => {
      // Witness reads the session, but the customer's signature lands before the witness's write.
      const customerSigned = session({ updated_at: '2026-01-03T00:00:00.000Z' }, [signer(1, { status: 'SIGNED', token_used: true, signature_data: 'Thandi', signature_type: 'TYPED' }), signer(2)])
      reads(session(), customerSigned)
      let putCount = 0
      const original = mockDdbSend.getMockImplementation()!
      mockDdbSend.mockImplementation(async (cmd: { __type: string }) => {
        if (cmd.__type === 'Put' && putCount++ === 0) throw clash
        return original(cmd)
      })

      const res = await POST(req({ signatureType: 'TYPED', signatureData: 'Sipho' }), params(2))
      expect(res.status).toBe(200)

      const attempts = puts()
      expect(attempts).toHaveLength(2)
      // the second attempt was built from the re-read session and conditional on ITS version
      expect(attempts[1].input.ConditionExpression).toBe('updated_at = :prev')
      expect(attempts[1].input.ExpressionAttributeValues[':prev']).toBe('2026-01-03T00:00:00.000Z')
      const final = attempts[1].input.Item as SignSession
      expect(final.signers.map(s => [s.order, s.status, s.signature_data])).toEqual([[1, 'SIGNED', 'Thandi'], [2, 'SIGNED', 'Sipho']])
      // both are now signed, so the seal is queued once, by the submit that completed it
      expect(mockSqsSend).toHaveBeenCalledTimes(1)
    })

    it('every write is conditional on the version that was read', async () => {
      await POST(req(customerAnswer), params(1))
      expect(puts()[0].input.ConditionExpression).toBe('updated_at = :prev')
      expect(puts()[0].input.ExpressionAttributeValues[':prev']).toBe('2026-01-02T00:00:00.000Z')
    })

    it('gives up politely if the session keeps changing, and queues nothing', async () => {
      const original = mockDdbSend.getMockImplementation()!
      mockDdbSend.mockImplementation(async (cmd: { __type: string }) => {
        if (cmd.__type === 'Put') throw clash
        return original(cmd)
      })
      const res = await POST(req(customerAnswer), params(1))
      expect(res.status).toBe(409)
      expect((await res.json()).error).toMatch(/Many people are signing at once/)
      expect(puts()).toHaveLength(5)
      expect(mockSqsSend).not.toHaveBeenCalled()
    })

    it('a different failure is not retried', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const original = mockDdbSend.getMockImplementation()!
      mockDdbSend.mockImplementation(async (cmd: { __type: string }) => {
        if (cmd.__type === 'Put') throw new Error('boom')
        return original(cmd)
      })
      expect((await POST(req(customerAnswer), params(1))).status).toBe(500)
      expect(puts()).toHaveLength(1)
    })

    it('re-checks the link on the re-read: a signer who signed in between cannot sign twice', async () => {
      const alreadySigned = session({ updated_at: '2026-01-03T00:00:00.000Z' }, [signer(1, { status: 'SIGNED', token_used: true }), signer(2)])
      reads(session(), alreadySigned)
      const original = mockDdbSend.getMockImplementation()!
      let n = 0
      mockDdbSend.mockImplementation(async (cmd: { __type: string }) => {
        if (cmd.__type === 'Put' && n++ === 0) throw clash
        return original(cmd)
      })
      const res = await POST(req(customerAnswer), params(1))
      expect(res.status).toBe(403)   // its own link was used by the other request
      expect(puts()).toHaveLength(1)
    })
  })
})
