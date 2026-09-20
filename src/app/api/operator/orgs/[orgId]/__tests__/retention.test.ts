import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

const { cookie, send, audit, verify } = vi.hoisted(() => ({ cookie: vi.fn(), send: vi.fn(), audit: vi.fn(), verify: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: () => ({ get: cookie }) }))
vi.mock('@/lib/aws', () => ({ ddbDocClient: () => ({ send }), TABLE: 'orgs' }))
vi.mock('@/lib/token', () => ({ verifyJwtClaims: verify }))
vi.mock('@/lib/audit', () => ({ writeAudit: audit }))
vi.mock('@aws-sdk/lib-dynamodb', () => ({ UpdateCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Update', input } }) }))

import { PATCH } from '../route'

const operator = { sub: 'op-1', email: 'ops@theoflow.example' }
const call = (body: unknown, orgId = 'org-1') => PATCH({ json: async () => body } as unknown as NextRequest, { params: { orgId } })
const update = () => send.mock.calls[0][0].input

describe('PATCH /api/operator/orgs/[orgId]: the end-of-life period agreed with an organisation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OPERATOR_EMAILS = 'ops@theoflow.example'
    cookie.mockReturnValue({ value: 't' })
    verify.mockResolvedValue(operator)
    send.mockResolvedValue({})
  })
  afterEach(() => { delete process.env.OPERATOR_EMAILS })

  it.each([5, 6, 7])('records %i years on that organisation\'s profile and audits who did it', async years => {
    const res = await call({ retentionYears: years })
    expect(res.status).toBe(200)
    expect(update()).toMatchObject({
      Key: { PK: 'ORG#org-1', SK: 'PROFILE' },
      UpdateExpression: 'SET retention_years = :y',
      ExpressionAttributeValues: { ':y': years },
      ConditionExpression: 'attribute_exists(PK)',
    })
    expect(audit).toHaveBeenCalledWith('org-1', operator, 'gate_keep.eol_set', `${years} years`)
  })

  it('null removes the agreement (files added from then on are not expired)', async () => {
    expect((await call({ retentionYears: null })).status).toBe(200)
    expect(update().UpdateExpression).toBe(' REMOVE retention_years')
    expect(update()).not.toHaveProperty('ExpressionAttributeValues')
    expect(audit).toHaveBeenCalledWith('org-1', operator, 'gate_keep.eol_set', 'none')
  })

  it.each([[1], [4], [8], [10], [5.5], ['5'], [-5], [0], [{}]])('refuses %j, and changes nothing', async bad => {
    const res = await call({ retentionYears: bad })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('retentionYears must be 5, 6, 7 or null')
    expect(send).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('can set the products and the period together, in one update', async () => {
    await call({ subscribedProducts: ['forge'], retentionYears: 7 })
    expect(update().UpdateExpression).toBe('SET subscribed_products = :p, retention_years = :y')
    expect(update().ExpressionAttributeValues).toEqual({ ':p': ['forge'], ':y': 7 })
  })

  it('changing only the products neither touches the period nor writes an erasure-period audit entry', async () => {
    await call({ subscribedProducts: ['forge'] })
    expect(update().UpdateExpression).toBe('SET subscribed_products = :p')
    expect(audit).not.toHaveBeenCalled()
  })

  it('needs something to change', async () => {
    expect((await call({})).status).toBe(400)
    expect(send).not.toHaveBeenCalled()
  })

  it('only an operator can do it', async () => {
    verify.mockResolvedValue({ sub: 'u', email: 'admin@customer.example' })
    expect((await call({ retentionYears: 5 })).status).toBe(403)
    cookie.mockReturnValue(undefined)
    expect((await call({ retentionYears: 5 })).status).toBe(401)
    expect(send).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('an unknown organisation is a 404, not a stray profile', async () => {
    send.mockRejectedValue(Object.assign(new Error('c'), { name: 'ConditionalCheckFailedException' }))
    const res = await call({ retentionYears: 5 }, 'org-ghost')
    expect(res.status).toBe(404)
    expect(audit).not.toHaveBeenCalled()
  })
})
