import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { mockPush, mockBack, mockSignOut, mockPath, mockOrg } = vi.hoisted(() => ({
  mockPush:    vi.fn(),
  mockBack:    vi.fn(),
  mockSignOut: vi.fn(),
  mockPath:    { current: '/dashboard' },
  mockOrg:     { current: {} as Record<string, unknown> },
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mockPath.current,
  useRouter:   () => ({ push: mockPush, back: mockBack }),
}))
vi.mock('@/lib/org-context', () => ({ useOrg: () => mockOrg.current }))
vi.mock('@/lib/auth', () => ({ signOut: mockSignOut }))
vi.mock('@/components/NotificationBell', () => ({ default: () => <div data-testid="bell"/> }))

import { PortalShell } from '../PortalShell'

const org = (over: Record<string, unknown> = {}) => ({
  name: 'Sipho Dlamini', email: 'sipho@example.com', initials: 'SD', orgName: 'Acme Insure',
  subscribedProducts: ['forge', 'channel', 'harvest', 'decode', 'sign'], loading: false, ...over,
})

// The shell renders the sidebar twice only while the mobile drawer is open, so
// the persistent desktop copy is the one addressed by default.
const mainNav = () => screen.getByRole('navigation', { name: 'Main' })

describe('PortalShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPath.current = '/dashboard'
    mockOrg.current  = org()
  })

  it('renders grouped nav for a full bundle, Gate-Keep included', () => {
    render(<PortalShell><p>page body</p></PortalShell>)
    const nav = within(mainNav())

    for (const label of ['Home', 'Templates', 'Forms', 'Submissions', 'Extract', 'Pending', 'Sign', 'Gate-Keep']) {
      expect(nav.getByRole('link', { name: label })).toBeInTheDocument()
    }
    for (const group of ['Forms', 'Documents', 'Signing', 'Files']) {
      expect(nav.getAllByText(group).length).toBeGreaterThan(0)
    }
    expect(screen.getByText('page body')).toBeInTheDocument()
  })

  it('shows the Team link to admins only', () => {
    mockOrg.current = org({ role: 'admin' })
    const { unmount } = render(<PortalShell><p/></PortalShell>)
    expect(within(mainNav()).getByRole('link', { name: 'Team' })).toHaveAttribute('href', '/team')
    unmount()

    for (const role of ['agent', undefined]) {
      mockOrg.current = org({ role })
      const r = render(<PortalShell><p/></PortalShell>)
      expect(within(mainNav()).queryByRole('link', { name: 'Team' })).not.toBeInTheDocument()
      r.unmount()
    }
  })

  it('shows the Activity link next to Team for admins only', () => {
    mockOrg.current = org({ role: 'admin' })
    const { unmount } = render(<PortalShell><p/></PortalShell>)
    expect(within(mainNav()).getByRole('link', { name: 'Activity' })).toHaveAttribute('href', '/activity')
    unmount()

    for (const role of ['agent', undefined]) {
      mockOrg.current = org({ role })
      const r = render(<PortalShell><p/></PortalShell>)
      expect(within(mainNav()).queryByRole('link', { name: 'Activity' })).not.toBeInTheDocument()
      r.unmount()
    }
  })

  describe('pilot and lock state', () => {
    const locked = { access: { state: 'locked', daysLeft: null, trialEndsAt: null }, subscribedProducts: [] }

    it('shows an admin how long their pilot has left, and nobody else', () => {
      mockOrg.current = org({ role: 'admin', access: { state: 'trial', daysLeft: 3, trialEndsAt: null } })
      const admin = render(<PortalShell><p/></PortalShell>)
      expect(screen.getByRole('link', { name: 'Pilot: 3 days left' })).toHaveAttribute('href', '/billing')
      admin.unmount()

      mockOrg.current = org({ role: 'agent', access: { state: 'trial', daysLeft: 3, trialEndsAt: null } })
      render(<PortalShell><p/></PortalShell>)
      expect(screen.queryByText(/Pilot:/)).not.toBeInTheDocument()
    })

    it('words the last days properly', () => {
      mockOrg.current = org({ role: 'admin', access: { state: 'trial', daysLeft: 0, trialEndsAt: null } })
      const zero = render(<PortalShell><p/></PortalShell>)
      expect(screen.getByText('Pilot: ends today')).toBeInTheDocument()
      zero.unmount()

      mockOrg.current = org({ role: 'admin', access: { state: 'trial', daysLeft: 1, trialEndsAt: null } })
      render(<PortalShell><p/></PortalShell>)
      expect(screen.getByText('Pilot: 1 day left')).toBeInTheDocument()
    })

    it('shows no pilot pill on the paid plan', () => {
      mockOrg.current = org({ role: 'admin', access: { state: 'active', daysLeft: null, trialEndsAt: null } })
      render(<PortalShell><p>page body</p></PortalShell>)
      expect(screen.queryByText(/Pilot:/)).not.toBeInTheDocument()
      expect(screen.getByText('page body')).toBeInTheDocument()
    })

    it("replaces a locked org's pages with a lock screen and a way back for the admin", () => {
      mockOrg.current = org({ role: 'admin', ...locked })
      render(<PortalShell><p>page body</p></PortalShell>)

      expect(screen.queryByText('page body')).not.toBeInTheDocument()
      expect(screen.getByText('Your products are locked')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Start the paid plan' })).toHaveAttribute('href', '/billing/upgrade')
    })

    it("tells a locked org's member to ask their admin instead", () => {
      mockOrg.current = org({ role: 'agent', ...locked })
      render(<PortalShell><p>page body</p></PortalShell>)

      expect(screen.getByText(/Ask your organisation admin to start the paid plan/)).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Start the paid plan' })).not.toBeInTheDocument()
    })

    it('still shows Billing to a locked org, so it can start again', () => {
      mockPath.current = '/billing'
      mockOrg.current = org({ role: 'admin', ...locked })
      render(<PortalShell><p>billing page</p></PortalShell>)

      expect(screen.getByText('billing page')).toBeInTheDocument()
      expect(screen.queryByText('Your products are locked')).not.toBeInTheDocument()
    })

    it('does not flash the lock screen while the org is still loading', () => {
      mockOrg.current = org({ role: 'admin', loading: true, ...locked })
      render(<PortalShell><p>page body</p></PortalShell>)
      expect(screen.getByText('page body')).toBeInTheDocument()
    })
  })

  it('only shows what the org is subscribed to (plus Home and Gate-Keep)', () => {
    mockOrg.current = org({ subscribedProducts: ['sign'] })
    render(<PortalShell><p/></PortalShell>)
    const nav = within(mainNav())

    expect(nav.getByRole('link', { name: 'Sign' })).toBeInTheDocument()
    expect(nav.getByRole('link', { name: 'Gate-Keep' })).toBeInTheDocument()
    expect(nav.queryByRole('link', { name: 'Templates' })).not.toBeInTheDocument()
    expect(nav.queryByRole('link', { name: 'Extract' })).not.toBeInTheDocument()
  })

  it('shows only Home and Gate-Keep while the org is still loading', () => {
    mockOrg.current = org({ loading: true })
    render(<PortalShell><p/></PortalShell>)
    const links = within(mainNav()).getAllByRole('link').map(a => a.textContent)
    expect(links).toEqual(['Home', 'Gate-Keep'])
  })

  it('marks the current page as active', () => {
    mockPath.current = '/gate-keep'
    render(<PortalShell><p/></PortalShell>)
    const nav = within(mainNav())

    expect(nav.getByRole('link', { name: 'Gate-Keep' })).toHaveAttribute('aria-current', 'page')
    expect(nav.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
  })

  it('shows the user, org, and the notification bell only for Harvest orgs', () => {
    const { unmount } = render(<PortalShell><p/></PortalShell>)
    expect(screen.getByText('Sipho Dlamini')).toBeInTheDocument()
    expect(screen.getByText('sipho@example.com')).toBeInTheDocument()
    expect(screen.getByText('Acme Insure')).toBeInTheDocument()
    expect(screen.getByTestId('bell')).toBeInTheDocument()
    unmount()

    mockOrg.current = org({ subscribedProducts: ['decode'] })
    render(<PortalShell><p/></PortalShell>)
    expect(screen.queryByTestId('bell')).not.toBeInTheDocument()
  })

  it('signs out and returns to the marketing home', async () => {
    const user = userEvent.setup()
    render(<PortalShell><p/></PortalShell>)

    await user.click(screen.getByRole('button', { name: /Sign out/ }))
    expect(mockSignOut).toHaveBeenCalledTimes(1)
    expect(mockPush).toHaveBeenCalledWith('/')
  })

  it('opens the mobile drawer from the menu button and closes it with Escape', async () => {
    const user = userEvent.setup()
    render(<PortalShell><p/></PortalShell>)
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    const drawer = screen.getByRole('dialog', { name: 'Menu' })
    expect(within(drawer).getByRole('link', { name: 'Gate-Keep' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument()
  })

  it('closes the drawer from its own close button', async () => {
    const user = userEvent.setup()
    render(<PortalShell><p/></PortalShell>)

    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Menu' })).getByRole('button', { name: 'Close menu' }))
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument()
  })
})

describe('PortalShell: Back', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPath.current = '/dashboard'
    mockOrg.current  = org()
  })

  const backButton = () => screen.queryByRole('button', { name: 'Go back' })

  it('has no Back on Home when nothing came before it', () => {
    render(<PortalShell><p>body</p></PortalShell>)
    expect(backButton()).not.toBeInTheDocument()
  })

  it('a page opened directly goes up to its section', async () => {
    mockPath.current = '/sign/send'
    render(<PortalShell><p>body</p></PortalShell>)
    await userEvent.click(backButton()!)
    expect(mockPush).toHaveBeenCalledWith('/sign')
    expect(mockBack).not.toHaveBeenCalled()
  })

  it('a section page opened directly goes Home', async () => {
    mockPath.current = '/sign'
    render(<PortalShell><p>body</p></PortalShell>)
    await userEvent.click(backButton()!)
    expect(mockPush).toHaveBeenCalledWith('/dashboard')
  })

  it('after clicking through the portal, Back returns to the page the click came from', async () => {
    const { rerender } = render(<PortalShell><p>body</p></PortalShell>)
    expect(backButton()).not.toBeInTheDocument()
    mockPath.current = '/forms'
    rerender(<PortalShell><p>body</p></PortalShell>)
    mockPath.current = '/forms/abc/history'
    rerender(<PortalShell><p>body</p></PortalShell>)
    await userEvent.click(backButton()!)
    expect(mockBack).toHaveBeenCalledTimes(1)
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('once the person has gone all the way back, Back stops using the history', async () => {
    const { rerender } = render(<PortalShell><p>body</p></PortalShell>)
    mockPath.current = '/sign'
    rerender(<PortalShell><p>body</p></PortalShell>)
    // the browser goes back to Home
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
    mockPath.current = '/dashboard'
    rerender(<PortalShell><p>body</p></PortalShell>)
    expect(backButton()).not.toBeInTheDocument()
  })
})

