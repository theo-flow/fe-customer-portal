import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { mockPush, mockSignOut, mockPath, mockOrg } = vi.hoisted(() => ({
  mockPush:    vi.fn(),
  mockSignOut: vi.fn(),
  mockPath:    { current: '/dashboard' },
  mockOrg:     { current: {} as Record<string, unknown> },
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mockPath.current,
  useRouter:   () => ({ push: mockPush }),
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
