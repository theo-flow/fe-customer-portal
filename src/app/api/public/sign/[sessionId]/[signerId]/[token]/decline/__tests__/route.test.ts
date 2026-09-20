import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import type { SignSession, Signer } from '@/lib/sign'

const { mockDdbSend, mockNotice } = vi.hoisted(() => ({ mockDdbSend: vi.fn(), mockNotice: vi.fn() }))

vi.mock('@/lib/aws', () => ({ ddbDocClient: () => ({ send: mockDdbSend }), TABLE: 'daai-insure-orgs' }))
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
  PutCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Put', input } }),
}))
vi.mock('@/lib/sign-notify', () => ({ enqueueSignNotice: mockNotice }))

import { hashToken } from '@/lib/sign'
import { POST } from '../route'

const signer = (n: number, over: Partial<Signer> = {}): Signer => ({
  signer_id: `signer-${n}`, name: `Person ${n}`, email: `p${n}@example.com`, role: n === 1 ? 'Customer' : 'Witness 1', order: n,
  status: 'PENDING', token_hash: hashToken(`tok${n}`), token_expires_at: '2999-01-01T00:00:00.000Z', token_used: false,
  signed_at: null, ip_address: null, user_agent: null, signature_type: null, signature_data: null, place_data: null, email_sent: true,
  ...over,
})
const session = (over: Partial<SignSession> = {}, signers: Signer[] = [signer(1), signer(2)]): SignSession => ({
  session_id: 's1', source_document: { s3_key: 'sign/source/s1/aoa.pdf', sha256: 'a', uploaded_at: 't' },
  working_document: {}, signers, status: 'IN_PROGRESS', created_at: 't', updated_at: '2026-01-02T00:00:00.000Z',
  metadata: { created_by_email: 'owner@example.com', form_name: 'New AOA' }, ...over,
})

const req = (b?: unknown) => ({ json: async () => { if (b === undefined) throw new Error('no body'); return b }, headers: new Headers({ 'x-forwarded-for': '203.0.113.9', 'user-agent': 'Test/1' }) }) as unknown as NextRequest
const params = (n: number, token = `tok${n}`) => ({ params: { sessionId: 's1', signerId: `signer-${n}`, token } })

function reads(...states: (SignSession | null)[]) {
  let i = 0
  mockDdbSend.mockImplementation(async (cmd: { __type: string }) => {
    if (cmd.__type === 'Get') {
      const s = states[Math.min(i++, states.length - 1)]
      return s ? { Item: structuredClone(s) } : {}
    }
    return {}
  })
}
const puts = () => mockDdbSend.mock.calls.map(([c]) => c).filter(c => c.__type === 'Put')
const saved = () => puts().pop()!.input.Item as SignSession
const clash = Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' })

describe('POST /api/public/sign/.../decline', () => {
  beforeEach(() => { vi.clearAllMocks(); mockNotice.mockResolvedValue(true); reads(session()) })

  it('records the decision, the reason and who and when, and ends the session', async () => {
    const res = await POST(req({ reason: 'I do not agree with clause 3' }), params(1))
    expect(res.status).toBe(200)
    const s = saved()
    expect(s.status).toBe('DECLINED')
    expect(s.signers[0]).toMatchObject({ status: 'DECLINED', decline_reason: 'I do not agree with clause 3', token_used: true, ip_address: '203.0.113.9', user_agent: 'Test/1' })
    expect(s.signers[0].declined_at).toBeTruthy()
    expect(s.signers[1].status).toBe('PENDING')    // the others are untouched, but the session is over
  })

  it('a reason is optional, and no body at all still declines', async () => {
    expect((await POST(req({}), params(1))).status).toBe(200)
    expect(saved().signers[0].decline_reason).toBeNull()
    reads(session())
    expect((await POST(req(undefined), params(1))).status).toBe(200)
  })

  it('cleans the reason: one line, capped', async () => {
    await POST(req({ reason: '  line one\nline two ' + 'x'.repeat(1000) }), params(1))
    const reason = saved().signers[0].decline_reason!
    expect(reason.startsWith('line one line two x')).toBe(true)
    expect(reason.length).toBe(300)
  })

  it('tells whoever sent it, with the reason, and never blocks on the notice', async () => {
    await POST(req({ reason: 'Not my form' }), params(1))
    expect(mockNotice).toHaveBeenCalledTimes(1)
    const n = mockNotice.mock.calls[0][0]
    expect(n).toMatchObject({ correlationId: 's1', notificationType: 'SIGN_DECLINED', toEmail: 'owner@example.com', subject: 'Declined: New AOA' })
    expect(n.bodyText).toContain('Person 1 (Customer) declined to sign New AOA')
    expect(n.bodyText).toContain('Reason given: Not my form')
    expect(n.bodyText).not.toContain(String.fromCharCode(0x2014))

    mockNotice.mockResolvedValue(false)   // queue down: the decline still stands
    reads(session())
    expect((await POST(req({}), params(1))).status).toBe(200)
  })

  it('omits the reason line when none was given', async () => {
    await POST(req({}), params(1))
    expect(mockNotice.mock.calls[0][0].bodyText).not.toContain('Reason given')
  })

  it.each([
    ['a wrong token', params(1, 'wrong'), 403],
    ['another signer\'s token', params(1, 'tok2'), 403],
    ['an unknown signer', { params: { sessionId: 's1', signerId: 'nobody', token: 'x' } }, 404],
  ])('refuses %s and writes nothing', async (_l, p, status) => {
    const res = await POST(req({}), p)
    expect(res.status).toBe(status)
    expect(puts()).toHaveLength(0)
    expect(mockNotice).not.toHaveBeenCalled()
  })

  it('refuses an expired or already used link, and a session that does not exist', async () => {
    reads(session({}, [signer(1, { token_expires_at: '2000-01-01T00:00:00.000Z' }), signer(2)]))
    expect((await POST(req({}), params(1))).status).toBe(403)
    reads(session({}, [signer(1, { token_used: true }), signer(2)]))
    expect((await POST(req({}), params(1))).status).toBe(403)
    reads(null)
    expect((await POST(req({}), params(1))).status).toBe(404)
  })

  it('cannot decline after signing', async () => {
    reads(session({}, [signer(1, { status: 'SIGNED' }), signer(2)]))
    expect((await POST(req({}), params(1))).status).toBe(409)
  })

  it.each(['DRAFT', 'SIGNED', 'CANCELLED', 'EXPIRED', 'FAILED', 'DECLINED'] as const)('cannot decline a %s session', async (status) => {
    reads(session({ status }))
    expect((await POST(req({}), params(1))).status).toBe(409)
    expect(puts()).toHaveLength(0)
    expect(mockNotice).not.toHaveBeenCalled()
  })

  it('never overwrites someone who signed at the same moment: it re-reads and applies on top', async () => {
    const withSignature = session({ updated_at: '2026-01-03T00:00:00.000Z' }, [signer(1), signer(2, { status: 'SIGNED', token_used: true, signature_data: 'Sipho' })])
    reads(session(), withSignature)
    const original = mockDdbSend.getMockImplementation()!
    let n = 0
    mockDdbSend.mockImplementation(async (cmd: { __type: string }) => {
      if (cmd.__type === 'Put' && n++ === 0) throw clash
      return original(cmd)
    })
    expect((await POST(req({}), params(1))).status).toBe(200)
    const attempts = puts()
    expect(attempts).toHaveLength(2)
    expect(attempts[1].input.ExpressionAttributeValues[':prev']).toBe('2026-01-03T00:00:00.000Z')
    const final = attempts[1].input.Item as SignSession
    expect(final.signers[1]).toMatchObject({ status: 'SIGNED', signature_data: 'Sipho' })   // the other signature survives
    expect(final.status).toBe('DECLINED')
    expect(mockNotice).toHaveBeenCalledTimes(1)
  })

  it('gives up politely if the session keeps changing, and tells nobody', async () => {
    const original = mockDdbSend.getMockImplementation()!
    mockDdbSend.mockImplementation(async (cmd: { __type: string }) => {
      if (cmd.__type === 'Put') throw clash
      return original(cmd)
    })
    expect((await POST(req({}), params(1))).status).toBe(409)
    expect(puts()).toHaveLength(5)
    expect(mockNotice).not.toHaveBeenCalled()
  })

  it('returns 500 on an unexpected write failure and tells nobody', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const original = mockDdbSend.getMockImplementation()!
    mockDdbSend.mockImplementation(async (cmd: { __type: string }) => {
      if (cmd.__type === 'Put') throw new Error('boom')
      return original(cmd)
    })
    expect((await POST(req({}), params(1))).status).toBe(500)
    expect(mockNotice).not.toHaveBeenCalled()
  })
})
