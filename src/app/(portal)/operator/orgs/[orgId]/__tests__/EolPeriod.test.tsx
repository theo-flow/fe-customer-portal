import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ManageOrgPage from '../page'

vi.mock('next/navigation', () => ({ useParams: () => ({ orgId: 'org-84a4d521' }) }))

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response
const org = (retentionYears: number | null | undefined) =>
  ({ orgId: 'org-84a4d521', orgName: 'Mizana', subscribedProducts: ['forge'], ...(retentionYears === undefined ? {} : { retentionYears }) })

function install(o: object) {
  const patches: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') { patches.push(JSON.parse(init.body as string)); return json({ ok: true }) }
    if (url === '/api/operator/orgs') return json({ orgs: [o] })
    return json({ inventory: { objectVersions: 0, deleteMarkers: 0, bytes: 0, files: 0, folders: 0 }, history: [] })
  }))
  return patches
}

describe('the end-of-life period on the operator\'s organisation page', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('shows the agreed period, or says there is no agreement', async () => {
    install(org(7))
    const { unmount } = render(<ManageOrgPage />)
    expect(await screen.findByLabelText('Gate-Keep end of life')).toHaveValue('7')
    unmount()

    install(org(null))
    render(<ManageOrgPage />)
    expect(await screen.findByLabelText('Gate-Keep end of life')).toHaveValue('')
  })

  it('offers exactly no agreement, 5, 6 and 7 years', async () => {
    install(org(null))
    render(<ManageOrgPage />)
    const select = await screen.findByLabelText('Gate-Keep end of life')
    expect(Array.from((select as HTMLSelectElement).options).map(o => o.text)).toEqual([
      'No agreement (never deleted automatically)', '5 years', '6 years', '7 years',
    ])
  })

  it('explains that it applies to files added from now on, and that no agreement means no automatic deletion', async () => {
    install(org(5))
    render(<ManageOrgPage />)
    expect(await screen.findByText(/Files added from now on are deleted completely this long after they were added/)).toBeInTheDocument()
    expect(screen.getByText(/Files already stored are not affected/)).toBeInTheDocument()
  })

  it('saves the chosen period together with the products', async () => {
    const user = userEvent.setup()
    const patches = install(org(null))
    render(<ManageOrgPage />)
    await user.selectOptions(await screen.findByLabelText('Gate-Keep end of life'), '6')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(patches).toEqual([{ subscribedProducts: ['forge'], retentionYears: 6 }])
  })

  it('choosing "no agreement" saves null, which removes it', async () => {
    const user = userEvent.setup()
    const patches = install(org(5))
    render(<ManageOrgPage />)
    await user.selectOptions(await screen.findByLabelText('Gate-Keep end of life'), '')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
    expect(patches).toEqual([{ subscribedProducts: ['forge'], retentionYears: null }])
  })

  it('an organisation from before this existed (no field) reads as no agreement', async () => {
    install(org(undefined))
    render(<ManageOrgPage />)
    expect(await screen.findByLabelText('Gate-Keep end of life')).toHaveValue('')
  })
})
