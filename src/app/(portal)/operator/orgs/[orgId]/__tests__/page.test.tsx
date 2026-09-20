import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ManageOrgPage from '../page'

vi.mock('next/navigation', () => ({ useParams: () => ({ orgId: 'org-84a4d521' }) }))

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response
const INV = { objectVersions: 3, deleteMarkers: 0, bytes: 30, files: 3, folders: 2 }

function install(orgs: Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    url === '/api/operator/orgs' ? orgs : json({ inventory: INV, history: [] })))
}

describe('operator org page', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('shows the erasure section alongside the products when the org loads', async () => {
    install(json({ orgs: [{ orgId: 'org-84a4d521', orgName: 'Mizana', subscribedProducts: ['forge'] }] }))
    render(<ManageOrgPage />)
    expect(await screen.findByText('Mizana')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Erase Gate-Keep data' })).toBeEnabled()
  })

  it('STILL offers the erasure when the org list cannot be loaded', async () => {
    install(json({ error: 'Failed to load orgs' }, 500))
    render(<ManageOrgPage />)
    expect(await screen.findByText(/No organisation profile could be loaded/)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Erase Gate-Keep data' })).toBeEnabled()
    expect(screen.queryByText('Org not found.')).not.toBeInTheDocument()
  })

  it('STILL offers the erasure for a closed account whose profile is gone', async () => {
    install(json({ orgs: [{ orgId: 'someone-else', orgName: 'Other', subscribedProducts: [] }] }))
    render(<ManageOrgPage />)
    expect(await screen.findByText(/No organisation profile could be loaded/)).toBeInTheDocument()
    expect(screen.getByText('org-84a4d521')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Erase Gate-Keep data' })).toBeEnabled()
  })

  it('shows nothing operator-only to someone who is not an operator', async () => {
    install(json({ error: 'Forbidden' }, 403))
    render(<ManageOrgPage />)
    expect(await screen.findByText('Not authorized')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Erase Gate-Keep data' })).not.toBeInTheDocument()
  })
})
