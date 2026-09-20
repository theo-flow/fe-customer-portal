import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCookieGet, mockAccess } = vi.hoisted(() => ({
  mockCookieGet: vi.fn(),
  mockAccess:    vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookieGet }) }))
vi.mock('@/lib/token', () => ({ verifyJwtClaims: vi.fn() }))
vi.mock('@/lib/org-access', () => ({ orgAccess: mockAccess }))

import { verifyJwtClaims } from '@/lib/token'
import { GET } from '../route'

const ORG_ID = 'org-abc123'
const admin  = { sub: 'a', email: 'boss@org.com', exp: 9999999999, 'custom:org_id': ORG_ID, 'custom:role': 'admin' }

describe('GET /api/billing/plans: what the Choose your seats screen needs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
    vi.mocked(verifyJwtClaims).mockResolvedValue(admin)
    mockAccess.mockResolvedValue({ state: 'trial', trialEndsAt: '2026-10-12T00:00:00+00:00', daysLeft: 2, seats: 1 })
  })

  it('returns 401 with no cookie and 403 with no org', async () => {
    mockCookieGet.mockReturnValue(undefined)
    expect((await GET()).status).toBe(401)

    mockCookieGet.mockReturnValue({ value: 't' })
    vi.mocked(verifyJwtClaims).mockResolvedValue({ sub: 'x', email: 'x@y.com', exp: 9999999999 })
    expect((await GET()).status).toBe(403)
  })

  it('returns the price bands and the per-seat allowance', async () => {
    const body = await (await GET()).json()

    expect(body.bands).toEqual([
      { label: 'Seats 1-4', priceZar: 500 },
      { label: 'Seats 5-9', priceZar: 450 },
      { label: 'Seat 10', priceZar: 400 },
      { label: 'Seat 11 and up', priceZar: 350 },
    ])
    expect(body).toMatchObject({ docsPerSeat: 50, overageRateZar: 7, trialDays: 7 })
  })

  it('describes a pilot: one seat, nothing billed yet, days left', async () => {
    const body = await (await GET()).json()
    expect(body).toMatchObject({ state: 'trial', daysLeft: 2, seats: 1, monthlyTotalZar: 0, canManage: true })
  })

  it('describes a paid org: its seats and what they cost by position', async () => {
    mockAccess.mockResolvedValue({ state: 'active', trialEndsAt: null, daysLeft: null, seats: 5 })
    const body = await (await GET()).json()
    expect(body).toMatchObject({ state: 'active', seats: 5, monthlyTotalZar: 2450 })
  })

  it('tells an invited member they can look but not manage', async () => {
    vi.mocked(verifyJwtClaims).mockResolvedValue({ ...admin, 'custom:role': 'agent' })
    const body = await (await GET()).json()
    expect(body.canManage).toBe(false)
    expect(body.bands).toHaveLength(4)
  })

  it('looks the org up by the caller\'s own login', async () => {
    await GET()
    expect(mockAccess).toHaveBeenCalledWith(ORG_ID)
  })
})
