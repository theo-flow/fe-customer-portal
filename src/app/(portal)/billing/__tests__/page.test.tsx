import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { mockOrg, mockRefetch } = vi.hoisted(() => ({
  mockOrg:     { current: { role: 'admin' } as Record<string, unknown> },
  mockRefetch: vi.fn(),
}))

vi.mock('@/lib/org-context', () => ({ useOrg: () => ({ ...mockOrg.current, refetch: mockRefetch }) }))

import BillingPage from '../page'
import UpgradePage from '../upgrade/page'

const subscription = {
  planName: 'Starter', status: 'active',
  billingPeriodStart: '2026-10-10T12:00:00+00:00', billingPeriodEnd: '2026-11-10T12:00:00+00:00',
  docsIncluded: 250, overageRateZar: 7, docsUsed: 10, overageDocs: 0, estimatedOverageZar: 0,
  seats: 5, seatLines: [{ seats: 4, unitPriceZar: 500, subtotalZar: 2000 }, { seats: 1, unitPriceZar: 450, subtotalZar: 450 }],
  seatsChargeZar: 2450, estimatedTotalZar: 2450,
}
const planState = (over: Record<string, unknown> = {}) => ({
  state: 'trial', trialDays: 7, trialEndsAt: '2026-10-12T00:00:00+00:00', daysLeft: 2, seats: 1, monthlyTotalZar: 0,
  canManage: true, docsPerSeat: 50, overageRateZar: 7,
  bands: [
    { label: 'Seats 1-4', priceZar: 500 }, { label: 'Seats 5-9', priceZar: 450 },
    { label: 'Seat 10', priceZar: 400 }, { label: 'Seat 11 and up', priceZar: 350 },
  ],
  ...over,
})

type Routes = Record<string, unknown>
let posts: { url: string; body: unknown }[] = []

function stubFetch(routes: Routes) {
  posts = []
  vi.stubGlobal('fetch', vi.fn((url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === 'POST') {
      posts.push({ url, body: init.body ? JSON.parse(init.body) : undefined })
      const body = routes[`POST ${url}`] ?? {}
      return Promise.resolve({ ok: !(body as { error?: string }).error, json: async () => body })
    }
    const body = routes[url]
    return Promise.resolve({ ok: body !== undefined, json: async () => body })
  }))
}

const billingRoutes = (plan: unknown, sub: unknown = null): Routes => ({
  '/api/billing/subscription': { subscription: sub },
  '/api/billing/invoices':     { items: [] },
  '/api/billing/plans':        plan,
})

describe('Billing page', () => {
  beforeEach(() => { mockRefetch.mockClear(); mockOrg.current = { role: 'admin' } })
  afterEach(() => vi.unstubAllGlobals())

  it('shows a pilot how long it has left and what happens next', async () => {
    stubFetch(billingRoutes(planState()))
    render(<BillingPage />)

    expect(await screen.findByText('2 days left in your pilot')).toBeInTheDocument()
    expect(screen.getByText(/moves? to the Starter plan/i)).toBeInTheDocument()
    expect(screen.getByText(/R500 a month for one seat/)).toBeInTheDocument()
    expect(screen.getByText(/Cancel any time before it ends and you will not be charged/)).toBeInTheDocument()
  })

  it('does not promise an invoice to an org with no pilot end date, such as an excluded test account', async () => {
    stubFetch(billingRoutes(planState({ trialEndsAt: null, daysLeft: null })))
    render(<BillingPage />)

    expect(await screen.findByText('You are on the free pilot')).toBeInTheDocument()
    expect(screen.getByText(/no pilot end date, so nothing is charged automatically/)).toBeInTheDocument()
    expect(screen.queryByText(/you move to the Starter plan/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Ends /)).not.toBeInTheDocument()
  })

  it('lets an admin start the paid plan now', async () => {
    stubFetch(billingRoutes(planState()))
    render(<BillingPage />)
    expect(await screen.findByRole('link', { name: 'Start paid plan now' })).toHaveAttribute('href', '/billing/upgrade')
  })

  it('cancels the pilot only after a confirmation, then refreshes so the lock applies', async () => {
    stubFetch({ ...billingRoutes(planState()), 'POST /api/billing/cancel-pilot': { ok: true } })
    const user = userEvent.setup()
    render(<BillingPage />)

    await user.click(await screen.findByRole('button', { name: 'Cancel pilot' }))
    expect(posts).toHaveLength(0)                                    // asked first
    expect(screen.getByText(/products lock until you start the paid plan/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Confirm cancel' }))
    await waitFor(() => expect(posts).toEqual([{ url: '/api/billing/cancel-pilot', body: undefined }]))
    await waitFor(() => expect(mockRefetch).toHaveBeenCalled())
  })

  it('lets the admin change their mind at the confirmation', async () => {
    stubFetch(billingRoutes(planState()))
    const user = userEvent.setup()
    render(<BillingPage />)

    await user.click(await screen.findByRole('button', { name: 'Cancel pilot' }))
    await user.click(screen.getByRole('button', { name: 'Keep pilot' }))
    expect(screen.getByRole('button', { name: 'Cancel pilot' })).toBeInTheDocument()
    expect(posts).toHaveLength(0)
  })

  it('shows an invited member the pilot, with nothing they could press', async () => {
    mockOrg.current = { role: 'agent' }
    stubFetch(billingRoutes(planState()))
    render(<BillingPage />)

    await screen.findByText('2 days left in your pilot')
    expect(screen.queryByRole('link', { name: 'Start paid plan now' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel pilot' })).not.toBeInTheDocument()
    expect(screen.getByText(/Ask your organisation admin to manage the plan/)).toBeInTheDocument()
  })

  it('tells a locked org how to come back, and a member to ask their admin', async () => {
    stubFetch(billingRoutes(planState({ state: 'locked', daysLeft: null })))
    const admin = render(<BillingPage />)
    expect(await screen.findByText('Your products are locked')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start paid plan' })).toHaveAttribute('href', '/billing/upgrade')
    admin.unmount()

    mockOrg.current = { role: 'agent' }
    render(<BillingPage />)
    await screen.findByText('Your products are locked')
    expect(screen.queryByRole('link', { name: 'Start paid plan' })).not.toBeInTheDocument()
    expect(screen.getByText(/Ask your organisation admin to start the paid plan/)).toBeInTheDocument()
  })

  it('shows a paid org its seats broken down by price band', async () => {
    stubFetch(billingRoutes(planState({ state: 'active', daysLeft: null, seats: 5 }), subscription))
    render(<BillingPage />)

    expect(await screen.findByText('Starter')).toBeInTheDocument()
    expect(screen.getByText('5 seats / month')).toBeInTheDocument()
    expect(screen.getByText(/4 seats at R500/)).toBeInTheDocument()
    expect(screen.getByText(/1 seat at R450/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Change seats' })).toHaveAttribute('href', '/team')
    expect(screen.queryByText(/free pilot/i)).not.toBeInTheDocument()
  })

  it('hides Change seats from an invited member', async () => {
    mockOrg.current = { role: 'agent' }
    stubFetch(billingRoutes(planState({ state: 'active', daysLeft: null }), subscription))
    render(<BillingPage />)
    await screen.findByText('Starter')
    expect(screen.queryByRole('link', { name: 'Change seats' })).not.toBeInTheDocument()
  })

  it('uses no em dashes or double dashes', async () => {
    stubFetch(billingRoutes(planState()))
    const { container } = render(<BillingPage />)
    await screen.findByText('2 days left in your pilot')
    expect(container.textContent).not.toMatch(/—|--/)
  })
})

describe('Choose your seats page', () => {
  beforeEach(() => { mockRefetch.mockClear(); mockOrg.current = { role: 'admin' } })
  afterEach(() => vi.unstubAllGlobals())

  const zar = (n: number) => `R${n.toLocaleString('en-ZA')}`

  it('shows what each seat costs and starts at one seat', async () => {
    stubFetch({ '/api/billing/plans': planState() })
    render(<UpgradePage />)

    expect(await screen.findByText('Choose your seats')).toBeInTheDocument()
    for (const row of ['Seats 1-4', 'Seats 5-9', 'Seat 10', 'Seat 11 and up']) expect(screen.getByText(row)).toBeInTheDocument()
    expect((screen.getByLabelText('Number of seats') as HTMLInputElement).value).toBe('1')
    expect(screen.getByText('Per month').parentElement?.textContent).toContain(zar(500))
  })

  it('prices the seats by position as you type, and says what they include', async () => {
    stubFetch({ '/api/billing/plans': planState() })
    const user = userEvent.setup()
    render(<UpgradePage />)

    const input = await screen.findByLabelText('Number of seats')
    await user.clear(input)
    await user.type(input, '12')

    expect(screen.getByText('Per month').parentElement?.textContent).toContain(zar(5350))
    expect(screen.getByText(/4 seats at R500/)).toBeInTheDocument()
    expect(screen.getByText(/2 seats at R350/)).toBeInTheDocument()
    expect(screen.getByText(/Includes 600 documents a month/)).toBeInTheDocument()
  })

  it('starts the paid plan only after a confirmation, sending the seat count', async () => {
    stubFetch({
      '/api/billing/plans': planState(),
      'POST /api/billing/subscribe': { ok: true, seats: 5, monthlyTotalZar: 2450 },
    })
    const user = userEvent.setup()
    render(<UpgradePage />)

    const input = await screen.findByLabelText('Number of seats')
    await user.clear(input)
    await user.type(input, '5')
    await user.click(screen.getByRole('button', { name: 'Start paid plan now' }))
    expect(posts).toHaveLength(0)
    expect(screen.getByText(/invoiced by EFT/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Confirm and start' }))

    expect(await screen.findByText('You are on the Starter plan.')).toBeInTheDocument()
    expect(posts).toEqual([{ url: '/api/billing/subscribe', body: { seats: 5 } }])
    expect(screen.getByText(/first\s+invoice will be emailed to you within a day/)).toBeInTheDocument()
    expect(mockRefetch).toHaveBeenCalled()
  })

  it('shows a server refusal instead of pretending it worked', async () => {
    stubFetch({ '/api/billing/plans': planState(), 'POST /api/billing/subscribe': { error: 'Your plan just changed. Refresh and try again.' } })
    const user = userEvent.setup()
    render(<UpgradePage />)

    await user.click(await screen.findByRole('button', { name: 'Start paid plan now' }))
    await user.click(screen.getByRole('button', { name: 'Confirm and start' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Your plan just changed')
    expect(screen.queryByText('You are on the Starter plan.')).not.toBeInTheDocument()
  })

  it('offers a locked org a way back', async () => {
    stubFetch({ '/api/billing/plans': planState({ state: 'locked', daysLeft: null }) })
    render(<UpgradePage />)
    expect(await screen.findByRole('button', { name: 'Restart on the paid plan' })).toBeInTheDocument()
  })

  it('shows an invited member the prices but nothing to press', async () => {
    stubFetch({ '/api/billing/plans': planState({ canManage: false }) })
    render(<UpgradePage />)

    expect(await screen.findByText(/Only your organisation admin can start the paid plan/)).toBeInTheDocument()
    expect(screen.getByText('Seats 1-4')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Start paid plan|Restart/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Number of seats')).toBeDisabled()
  })

  it('sends a paid org to Team to change its seats instead', async () => {
    stubFetch({ '/api/billing/plans': planState({ state: 'active', daysLeft: null, seats: 5 }) })
    render(<UpgradePage />)

    expect(await screen.findByText(/already on the Starter plan with 5 seats/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Change your seats' })).toHaveAttribute('href', '/team')
    expect(screen.queryByRole('button', { name: /Start paid plan/ })).not.toBeInTheDocument()
  })

  it('reassures a pilot that nothing is needed yet', async () => {
    stubFetch({ '/api/billing/plans': planState() })
    render(<UpgradePage />)
    expect(await screen.findByText(/You do not have to do this yet/)).toBeInTheDocument()
  })
})
