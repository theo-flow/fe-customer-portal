import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const { mockCookieGet, mockSend, mockLoadTeam, mockAllowance } = vi.hoisted(() => ({
  mockCookieGet: vi.fn(),
  mockSend:      vi.fn(),
  mockLoadTeam:  vi.fn(),
  mockAllowance: vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: () => ({ get: mockCookieGet }) }))

vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockSend }),
  TABLE:        'daai-insure-orgs',
}))

vi.mock('@/lib/token', () => ({ verifyJwtClaims: vi.fn() }))

vi.mock('@/lib/team', async (orig) => ({
  ...(await orig<typeof import('@/lib/team')>()),
  loadTeam:      mockLoadTeam,
  seatAllowance: mockAllowance,
}))

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  UpdateCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Update', input } }),
}))

import { verifyJwtClaims } from '@/lib/token'
import { POST } from '../route'

const ORG_ID = 'org-abc123'
const admin  = { sub: 'admin-1', email: 'boss@org.com', exp: 9999999999, 'custom:org_id': ORG_ID, 'custom:role': 'admin' }
const member = (status = 'active') => ({ sub: 's', email: 'a@b.com', name: 'A', role: 'agent', status, invitedBy: null, createdAt: 'x' })

const paid  = { state: 'active', planName: 'Starter', totalSeats: 5, canChangeSeats: true }
const pilot = { state: 'trial', planName: 'Pilot', totalSeats: 1, canChangeSeats: false }
const call  = (seats: unknown) => POST({ json: async () => ({ seats }) } as unknown as NextRequest)

describe('POST /api/team/seats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockReset()
    mockCookieGet.mockReturnValue({ value: 'valid-token' })
    vi.mocked(verifyJwtClaims).mockResolvedValue(admin)
    mockLoadTeam.mockResolvedValue([member()])
    mockAllowance.mockResolvedValue(paid)
    mockSend.mockResolvedValue({})
  })

  it('refuses an agent', async () => {
    vi.mocked(verifyJwtClaims).mockResolvedValue({ ...admin, 'custom:role': 'agent' })
    expect((await call(3)).status).toBe(403)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('rejects anything that is not a whole number in range', async () => {
    for (const bad of [0, -1, 1.5, 501, '3', null, undefined]) {
      expect((await call(bad)).status).toBe(400)
    }
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('sets the seat count on the org profile and reports the monthly price by position', async () => {
    const res = await call(7)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, seats: 7, monthlyTotalZar: 3350 })    // 4 x 500 + 3 x 450
    const update = mockSend.mock.calls[0][0].input
    expect(update.Key).toEqual({ PK: `ORG#${ORG_ID}`, SK: 'PROFILE' })
    expect(update.ExpressionAttributeValues[':n']).toBe(7)
  })

  it('will not change seats during a pilot: it starts the paid plan instead', async () => {
    mockAllowance.mockResolvedValue(pilot)
    const res = await call(3)

    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Start the paid plan to add seats.')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('will not drop below the people already on the team, counting invites and not removed members', async () => {
    mockLoadTeam.mockResolvedValue(Array.from({ length: 6 }, (_, i) => member(i === 0 ? 'removed' : i < 3 ? 'invited' : 'active')))
    // 5 people hold seats.
    expect((await call(4)).status).toBe(409)
    expect((await call(5)).status).toBe(200)
  })
})
