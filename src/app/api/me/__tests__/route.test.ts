import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCookieGet, mockSend, mockAccess } = vi.hoisted(() => ({
  mockCookieGet: vi.fn(),
  mockSend:      vi.fn(),
  mockAccess:    vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookieGet }) }))

vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockSend }),
  TABLE:        'daai-insure-orgs',
}))

vi.mock('@/lib/token', async (orig) => ({
  ...(await orig<typeof import('@/lib/token')>()),
  verifyJwtClaims: vi.fn(),
}))

// productsFor stays real: it is the rule under test.
vi.mock('@/lib/org-access', async (orig) => ({
  ...(await orig<typeof import('@/lib/org-access')>()),
  orgAccess: mockAccess,
}))

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
}))

import { verifyJwtClaims } from '@/lib/token'
import { GET } from '../route'

const claims = { sub: 'u1', email: 'a@b.com', name: 'Ann Bee', exp: 9999999999, 'custom:org_id': 'org-1', 'custom:role': 'admin' }
const ALL = ['forge', 'channel', 'harvest', 'decode', 'sign', 'print']

describe('GET /api/me', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockReset()
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
    vi.mocked(verifyJwtClaims).mockResolvedValue(claims)
    mockSend.mockResolvedValue({ Item: { orgName: 'Acme', form_groups: [{ group: 'claim', groupLabel: 'Claim' }], subscribed_products: ['sign'] } })
    mockAccess.mockResolvedValue({ state: 'trial', trialEndsAt: '2026-10-12T00:00:00+00:00', daysLeft: 2 })
  })

  it('returns 401 with no cookie', async () => {
    mockCookieGet.mockReturnValue(undefined)
    expect((await GET()).status).toBe(401)
  })

  it('gives a pilot every product, whatever the profile says it subscribed to', async () => {
    const body = await (await GET()).json()
    expect(body.subscribedProducts).toEqual(ALL)
    expect(body.access).toEqual({ state: 'trial', daysLeft: 2, trialEndsAt: '2026-10-12T00:00:00+00:00' })
    expect(body).toMatchObject({ orgName: 'Acme', role: 'admin', orgId: 'org-1' })
  })

  it('gives a paid org every product', async () => {
    mockAccess.mockResolvedValue({ state: 'active', trialEndsAt: null, daysLeft: null })
    expect((await (await GET()).json()).subscribedProducts).toEqual(ALL)
  })

  it('gives a locked org no products, and says it is locked', async () => {
    mockAccess.mockResolvedValue({ state: 'locked', trialEndsAt: null, daysLeft: null })
    const body = await (await GET()).json()
    expect(body.subscribedProducts).toEqual([])
    expect(body.access.state).toBe('locked')
  })

  it('does not lock anyone out over a transient lookup failure', async () => {
    mockAccess.mockRejectedValue(new Error('ddb down'))
    const body = await (await GET()).json()
    expect(body.access.state).toBe('active')
    expect(body.subscribedProducts).toEqual(ALL)
  })

  it('reports the caller\'s role from the token, agent when the claim is missing', async () => {
    const { 'custom:role': _omit, ...noRole } = claims
    vi.mocked(verifyJwtClaims).mockResolvedValue(noRole)
    expect((await (await GET()).json()).role).toBe('agent')
  })
})
