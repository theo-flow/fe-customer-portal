import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))

vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockSend }),
  TABLE:        'daai-insure-orgs',
}))

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
}))

import { computeAccess, orgAccess, orgLocked, productsFor } from '../org-access'

const NOW = new Date('2026-10-10T12:00:00Z')
const ends = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString()

describe('computeAccess: what an org may do', () => {
  it('a running pilot is in trial, with the whole days it has left', () => {
    const a = computeAccess({ trial_status: 'active', trial_ends_at: ends(2.5) }, undefined, NOW)
    expect(a).toMatchObject({ state: 'trial', daysLeft: 3, seats: 1, hasSubscription: false })
    expect(computeAccess({ trial_status: 'active', trial_ends_at: ends(7) }, undefined, NOW).daysLeft).toBe(7)
  })

  it('a pilot past its end date stays usable (0 days left) until the daily run converts it', () => {
    const a = computeAccess({ trial_status: 'active', trial_ends_at: ends(-3) }, undefined, NOW)
    expect(a).toMatchObject({ state: 'trial', daysLeft: 0 })
  })

  it('an org that predates trials counts as a pilot with no end date, never as locked', () => {
    expect(computeAccess({}, undefined, NOW)).toMatchObject({ state: 'trial', daysLeft: null })
    expect(computeAccess(undefined, undefined, NOW).state).toBe('trial')
  })

  it('a cancelled pilot is locked', () => {
    expect(computeAccess({ trial_status: 'cancelled' }, undefined, NOW)).toMatchObject({ state: 'locked', daysLeft: null })
  })

  it('a converted pilot, or one being converted, is active', () => {
    for (const trial_status of ['converted', 'converting']) {
      expect(computeAccess({ trial_status, seats: 3 }, undefined, NOW)).toMatchObject({ state: 'active', seats: 3 })
    }
  })

  it('an active subscription wins over everything on the profile', () => {
    expect(computeAccess({ trial_status: 'cancelled' }, { status: 'active' }, NOW).state).toBe('active')
    expect(computeAccess({ trial_status: 'active' }, { status: 'past_due' }, NOW).state).toBe('active')
  })

  it('a cancelled subscription locks the org', () => {
    expect(computeAccess({ trial_status: 'converted' }, { status: 'cancelled' }, NOW).state).toBe('locked')
  })

  it('reads seats as a whole number of at least one', () => {
    for (const bad of [0, -2, 1.5, 'lots', undefined]) {
      expect(computeAccess({ seats: bad }, undefined, NOW).seats).toBe(1)
    }
    expect(computeAccess({ seats: 8 }, undefined, NOW).seats).toBe(8)
  })
})

describe('productsFor', () => {
  it('gives every product to a pilot and a paid org, and none to a locked one', () => {
    expect(productsFor({ state: 'trial' })).toEqual(['forge', 'channel', 'harvest', 'decode', 'sign', 'print'])
    expect(productsFor({ state: 'active' })).toHaveLength(6)
    expect(productsFor({ state: 'locked' })).toEqual([])
  })
})

describe('orgAccess and orgLocked', () => {
  beforeEach(() => { vi.clearAllMocks(); mockSend.mockReset() })

  // orgAccess reads the org PROFILE first, then the SUBSCRIPTION.
  const primed = (profile: unknown, sub: unknown) =>
    mockSend.mockResolvedValueOnce({ Item: profile }).mockResolvedValueOnce({ Item: sub })

  it('reads only this org\'s own profile and subscription', async () => {
    primed({ trial_status: 'active' }, undefined)
    await orgAccess('org-1')
    expect(mockSend.mock.calls[0][0].input.Key).toEqual({ PK: 'ORG#org-1', SK: 'PROFILE' })
    expect(mockSend.mock.calls[1][0].input.Key).toEqual({ PK: 'ORG#org-1', SK: 'SUBSCRIPTION' })
  })

  it('lets a pilot and a paid org through', async () => {
    primed({ trial_status: 'active' }, undefined)
    expect(await orgLocked('org-1')).toBeNull()
    primed({ trial_status: 'converted' }, { status: 'active' })
    expect(await orgLocked('org-1')).toBeNull()
  })

  it('answers a locked org with a 403 that says why and how to fix it', async () => {
    primed({ trial_status: 'cancelled' }, undefined)
    const res = await orgLocked('org-1')

    expect(res?.status).toBe(403)
    const body = await res!.json()
    expect(body.code).toBe('org_locked')
    expect(body.error).toMatch(/paid plan in Billing/)
    expect(body.error).not.toMatch(/—|--/)
  })
})
