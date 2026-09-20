import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))

vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockSend }),
  TABLE:        'daai-insure-orgs',
}))

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand:   vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
  PutCommand:   vi.fn(function (this: unknown, input: unknown) { return { __type: 'Put', input } }),
  QueryCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Query', input } }),
}))

import { loadTeam, seatAllowance, seatsUsed, type Member } from '../team'

const admin = { sub: 'admin-1', email: 'boss@org.com', name: 'Boss', exp: 9999999999, 'custom:org_id': 'org-1', 'custom:role': 'admin' }

const member = (over: Partial<Member>): Member => ({
  sub: 's', email: 'a@b.com', name: 'A', role: 'agent', status: 'active', invitedBy: null, createdAt: '2026-09-01T00:00:00Z', ...over,
})

describe('loadTeam', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds the caller to the list and writes their listing item when it is missing', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] }).mockResolvedValueOnce({ Item: {} }).mockResolvedValueOnce({})

    const members = await loadTeam('org-1', admin)

    expect(members).toHaveLength(1)
    expect(members[0]).toMatchObject({ sub: 'admin-1', role: 'admin', status: 'active' })
    const put = mockSend.mock.calls[2][0].input
    expect(put.Item).toMatchObject({ PK: 'ORG#org-1', SK: 'MEMBER#admin-1' })
    expect(put.ConditionExpression).toBe('attribute_not_exists(PK)')
  })

  it('does not write anything when the caller is already listed', async () => {
    mockSend.mockResolvedValueOnce({ Items: [{ sub: 'admin-1', email: 'boss@org.com', role: 'admin', status: 'active', createdAt: 'x' }] })
    await loadTeam('org-1', admin)
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('survives losing a race to create the listing item', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] }).mockResolvedValueOnce({ Item: {} })
      .mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'ConditionalCheckFailedException' }))
    await expect(loadTeam('org-1', admin)).resolves.toHaveLength(1)
  })

  it('dates the original admin from when the org registered, not from first opening Team', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Item: { createdAt: '2026-07-13T14:14:50.480Z' } })
      .mockResolvedValueOnce({})

    const [me] = await loadTeam('org-1', admin)

    expect(me.createdAt).toBe('2026-07-13T14:14:50.480Z')
    expect(mockSend.mock.calls[1][0].input.Key).toEqual({ PK: 'ORG#org-1', SK: 'PROFILE' })
  })

  it('falls back to now when the org has no date or the lookup fails', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] }).mockRejectedValueOnce(new Error('ddb')).mockResolvedValueOnce({})
    const [me] = await loadTeam('org-1', admin)
    expect(Date.now() - new Date(me.createdAt).getTime()).toBeLessThan(5000)
  })

  it('only ever queries the caller\'s own org partition', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] }).mockResolvedValueOnce({ Item: {} }).mockResolvedValueOnce({})
    await loadTeam('org-1', admin)
    expect(mockSend.mock.calls[0][0].input.ExpressionAttributeValues[':pk']).toBe('ORG#org-1')
  })
})

describe('seatsUsed', () => {
  it('counts active and invited members and ignores removed ones', () => {
    expect(seatsUsed([member({}), member({ status: 'invited' }), member({ status: 'removed' })])).toBe(2)
  })
})

describe('seatAllowance', () => {
  beforeEach(() => { vi.clearAllMocks(); mockSend.mockReset() })

  // seatAllowance reads the org PROFILE first, then the SUBSCRIPTION.
  const primed = (profile: unknown, sub: unknown) =>
    mockSend.mockResolvedValueOnce({ Item: profile }).mockResolvedValueOnce({ Item: sub })

  it('gives a pilot one seat, and no way to change it: it starts the paid plan instead', async () => {
    primed({ trial_status: 'active', trial_ends_at: '2099-01-01T00:00:00+00:00', seats: 1 }, undefined)
    expect(await seatAllowance('org-1')).toMatchObject({
      state: 'trial', planName: 'Pilot', totalSeats: 1, canChangeSeats: false, monthlyTotalZar: 0, docsIncluded: 0,
    })
  })

  it('ignores a stray seat count on a pilot', async () => {
    primed({ trial_status: 'active', seats: 9 }, undefined)
    expect((await seatAllowance('org-1')).totalSeats).toBe(1)
  })

  it('gives a paid org the seats it set, priced by position', async () => {
    primed({ trial_status: 'converted', seats: 5 }, { status: 'active' })
    expect(await seatAllowance('org-1')).toMatchObject({
      state: 'active', planName: 'Starter', totalSeats: 5, canChangeSeats: true,
      monthlyTotalZar: 2450, docsIncluded: 250, nextSeatPriceZar: 450,
    })
  })

  it('reports what one more seat would add at each band boundary', async () => {
    for (const [seats, next] of [[1, 500], [4, 450], [9, 400], [10, 350], [15, 350]] as const) {
      primed({ trial_status: 'converted', seats }, { status: 'active' })
      expect((await seatAllowance('org-1')).nextSeatPriceZar).toBe(next)
    }
  })

  it('reads this org only', async () => {
    primed({}, undefined)
    await seatAllowance('org-1')
    expect(mockSend.mock.calls[0][0].input.Key).toEqual({ PK: 'ORG#org-1', SK: 'PROFILE' })
    expect(mockSend.mock.calls[1][0].input.Key).toEqual({ PK: 'ORG#org-1', SK: 'SUBSCRIPTION' })
  })
})
