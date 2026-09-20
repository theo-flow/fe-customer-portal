import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { mockOrg } = vi.hoisted(() => ({ mockOrg: { current: {} as Record<string, unknown> } }))

vi.mock('@/lib/org-context', () => ({ useOrg: () => mockOrg.current }))

import TeamPage from '../page'

const admin = { sub: 'a1', email: 'boss@org.com', name: 'Boss', role: 'admin', status: 'active', createdAt: '2026-09-01T00:00:00Z' }
const agent = { sub: 'g1', email: 'jane@org.com', name: 'Jane', role: 'agent', status: 'invited', createdAt: '2026-09-02T00:00:00Z' }

const pilotTeam = (daysLeft: number | null = 2) => ({
  members: [admin], seatsUsed: 1,
  seats: {
    state: 'trial', planName: 'Pilot', totalSeats: 1, canChangeSeats: false, monthlyTotalZar: 0,
    nextSeatPriceZar: 500, docsIncluded: 0, trialEndsAt: '2026-10-12T00:00:00+00:00', daysLeft,
  },
})

const paidTeam = (totalSeats = 5, members = [admin, agent]) => ({
  members, seatsUsed: members.length,
  seats: {
    state: 'active', planName: 'Starter', totalSeats, canChangeSeats: true, monthlyTotalZar: 2450,
    nextSeatPriceZar: 450, docsIncluded: 250, trialEndsAt: null, daysLeft: null,
  },
})

let calls: { url: string; method?: string; body?: unknown }[] = []

function stubFetch(team: unknown, posts: Record<string, unknown> = {}) {
  calls = []
  vi.stubGlobal('fetch', vi.fn((url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined })
    const body = init?.method ? (posts[`${init.method} ${url}`] ?? {}) : team
    return Promise.resolve({ ok: !(body as { error?: string }).error, json: async () => body })
  }))
}

describe('Team page', () => {
  beforeEach(() => { mockOrg.current = { orgName: 'Onte Ika', role: 'admin', loading: false } })
  afterEach(() => vi.unstubAllGlobals())

  it('shows only admins the team, and tells a member to ask their admin', async () => {
    mockOrg.current = { orgName: 'Onte Ika', role: 'agent', loading: false }
    stubFetch(pilotTeam())
    render(<TeamPage />)

    expect(await screen.findByText('Admins only')).toBeInTheDocument()
    expect(calls).toEqual([])                                     // never even asks for the team
  })

  describe('during the pilot', () => {
    it('says how long is left and sends the admin to start the paid plan', async () => {
      stubFetch(pilotTeam(2))
      render(<TeamPage />)

      expect(await screen.findByText('Your pilot ends in 2 days.')).toBeInTheDocument()
      expect(screen.getByText('Pilot plan · 1 of 1 seat used')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Start paid plan' })).toHaveAttribute('href', '/billing/upgrade')
    })

    it('says "today" and "1 day" in the right places', async () => {
      stubFetch(pilotTeam(0))
      const zero = render(<TeamPage />)
      expect(await screen.findByText('Your pilot ends today.')).toBeInTheDocument()
      zero.unmount()

      stubFetch(pilotTeam(1))
      render(<TeamPage />)
      expect(await screen.findByText('Your pilot ends in 1 day.')).toBeInTheDocument()
    })

    it('has no way to add seats or invite: a pilot has one seat', async () => {
      stubFetch(pilotTeam())
      render(<TeamPage />)

      await screen.findByText('Your pilot ends in 2 days.')
      expect(screen.queryByLabelText('Number of seats')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Send invite' })).toBeDisabled()
      expect(screen.getByPlaceholderText('Jane Dlamini')).toBeDisabled()
    })
  })

  describe('on the paid plan', () => {
    it('shows the plan and seats used, and no standing price sentence', async () => {
      stubFetch(paidTeam())
      const { container } = render(<TeamPage />)

      expect(await screen.findByText('Starter plan · 2 of 5 seats used')).toBeInTheDocument()
      expect(screen.queryByText(/Your pilot ends/)).not.toBeInTheDocument()
      expect(container.textContent).not.toMatch(/Each seat is|Your seats cost|One more seat would add/)
    })

    it('shows what the new seat count costs only when the admin is about to change it', async () => {
      stubFetch(paidTeam())
      const user = userEvent.setup()
      render(<TeamPage />)

      const input = await screen.findByLabelText('Number of seats')
      expect(screen.queryByText(/a month, from your next invoice/)).not.toBeInTheDocument()

      await user.clear(input)
      await user.type(input, '7')
      expect(screen.getByText(/7 seats is R3.350 a month, from your next invoice/)).toBeInTheDocument()   // 4 x 500 + 3 x 450
    })

    it('saves the seat count and tells the admin the price applies from the next invoice', async () => {
      stubFetch(paidTeam(), { 'POST /api/team/seats': { ok: true, seats: 7, monthlyTotalZar: 3350 } })
      const user = userEvent.setup()
      render(<TeamPage />)

      const input = await screen.findByLabelText('Number of seats')
      await user.clear(input)
      await user.type(input, '7')
      await user.click(screen.getByRole('button', { name: 'Update seats' }))

      expect(await screen.findByRole('status')).toHaveTextContent('You now have 7 seats. The new price applies from your next invoice.')
      expect(calls.find(c => c.url === '/api/team/seats')?.body).toEqual({ seats: 7 })
    })

    it('will not offer a seat count below the people already on the team', async () => {
      stubFetch(paidTeam(5, [admin, agent, { ...agent, sub: 'g2', email: 'x@org.com' }]))
      const user = userEvent.setup()
      render(<TeamPage />)

      const input = await screen.findByLabelText('Number of seats')
      await user.clear(input)
      await user.type(input, '2')
      expect(screen.getByRole('button', { name: 'Update seats' })).toBeDisabled()
    })

    it('shows the server\'s reason when a seat change is refused', async () => {
      stubFetch(paidTeam(), { 'POST /api/team/seats': { error: 'Start the paid plan to add seats.' } })
      const user = userEvent.setup()
      render(<TeamPage />)

      const input = await screen.findByLabelText('Number of seats')
      await user.clear(input)
      await user.type(input, '6')
      await user.click(screen.getByRole('button', { name: 'Update seats' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Start the paid plan to add seats.')
    })

    it('tells a full team to add a seat, and blocks the invite until they do', async () => {
      stubFetch(paidTeam(2))
      render(<TeamPage />)

      expect(await screen.findByText('All seats are in use. Add a seat above to invite someone else.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Send invite' })).toBeDisabled()
    })

    it('invites someone when there is a free seat', async () => {
      stubFetch(paidTeam(5), { 'POST /api/team/invite': { member: agent } })
      const user = userEvent.setup()
      render(<TeamPage />)

      await user.type(await screen.findByPlaceholderText('Jane Dlamini'), 'Sam Agent')
      await user.type(screen.getByPlaceholderText('jane@company.co.za'), 'sam@org.com')
      await user.click(screen.getByRole('button', { name: 'Send invite' }))

      await waitFor(() => expect(calls.find(c => c.url === '/api/team/invite')?.body).toEqual({ name: 'Sam Agent', email: 'sam@org.com' }))
      expect(await screen.findByRole('status')).toHaveTextContent('Invite sent to sam@org.com')
    })
  })

  it('uses no em dashes or double dashes', async () => {
    stubFetch(pilotTeam())
    const { container } = render(<TeamPage />)
    await screen.findByText('Your pilot ends in 2 days.')
    expect(container.textContent).not.toMatch(/—|--/)
  })
})
