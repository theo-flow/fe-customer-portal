import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

import OperatorConsolePage from '../page'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response
const ORGS = [
  { orgId: 'org-1', orgName: 'Acme Insure', status: 'active', subscribedProducts: ['forge'], subscription: null, totalDocuments: 4 },
  { orgId: 'org-2', orgName: 'Mizana', status: 'active', subscribedProducts: [], subscription: null, totalDocuments: 0 },
]
const install = (res: Response | Promise<Response>) => vi.stubGlobal('fetch', vi.fn(async () => res))

describe('operator console', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('lists organisations with a link to each workspace', async () => {
    install(json({ orgs: ORGS }))
    render(<OperatorConsolePage />)
    expect(await screen.findByText('Acme Insure')).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: /Manage/ })
    expect(links.map(l => l.getAttribute('href'))).toEqual(['/operator/orgs/org-1', '/operator/orgs/org-2'])
  })

  it('searches by name or id', async () => {
    const user = userEvent.setup()
    install(json({ orgs: ORGS }))
    render(<OperatorConsolePage />)
    await screen.findByText('Acme Insure')

    await user.type(screen.getByLabelText('Search organisations'), 'mizana')
    expect(screen.queryByText('Acme Insure')).not.toBeInTheDocument()
    expect(screen.getByText('Mizana')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Search organisations'))
    await user.type(screen.getByLabelText('Search organisations'), 'org-1')
    expect(screen.getByText('Acme Insure')).toBeInTheDocument()
    expect(screen.queryByText('Mizana')).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('Search organisations'))
    await user.type(screen.getByLabelText('Search organisations'), 'zzz')
    expect(screen.getByText('No organisations match "zzz".')).toBeInTheDocument()
  })

  it('opens a workspace by its id', async () => {
    const user = userEvent.setup()
    install(json({ orgs: ORGS }))
    render(<OperatorConsolePage />)
    await screen.findByText('Acme Insure')

    await user.type(screen.getByLabelText('Open a workspace'), '  org-84a4d521 ')
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(push).toHaveBeenCalledWith('/operator/orgs/org-84a4d521')
  })

  it.each(['', 'WS#org-1', 'org-1/x', '../x', 'a b'])('refuses to navigate to the invalid id %j', async id => {
    const user = userEvent.setup()
    install(json({ orgs: ORGS }))
    render(<OperatorConsolePage />)
    await screen.findByText('Acme Insure')

    if (id) await user.type(screen.getByLabelText('Open a workspace'), id)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a workspace id')
    expect(push).not.toHaveBeenCalled()
  })

  it('when the list cannot be loaded it says so, and the by-id route still works', async () => {
    const user = userEvent.setup()
    install(json({ error: 'Failed to load orgs' }, 500))
    render(<OperatorConsolePage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('The organisation list could not be loaded')
    expect(screen.queryByText('No organisations yet.')).not.toBeInTheDocument()
    expect(screen.queryByText('No orgs found.')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Open a workspace'), 'org-84a4d521')
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(push).toHaveBeenCalledWith('/operator/orgs/org-84a4d521')
  })

  it('a network failure is reported the same way, not as an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    render(<OperatorConsolePage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('The organisation list could not be loaded')
  })

  it('says so plainly when there are genuinely no organisations', async () => {
    install(json({ orgs: [] }))
    render(<OperatorConsolePage />)
    expect(await screen.findByText('No organisations yet.')).toBeInTheDocument()
  })

  it('shows nothing operator-only to a non-operator', async () => {
    install(json({ error: 'Forbidden' }, 403))
    render(<OperatorConsolePage />)
    expect(await screen.findByText('Not authorized')).toBeInTheDocument()
    expect(screen.queryByLabelText('Open a workspace')).not.toBeInTheDocument()
  })
})
