import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { mockOrg } = vi.hoisted(() => ({ mockOrg: { current: {} as Record<string, unknown> } }))

vi.mock('@/lib/org-context', () => ({ useOrg: () => mockOrg.current }))

import ActivityPage from '../page'

const entry = (n: number, over: Record<string, unknown> = {}) => ({
  auditId: `id${n}`, at: `2026-10-10T1${n}:00:00.000Z`, actorSub: 'a1', actorEmail: 'boss@org.com',
  actorRole: 'admin', action: 'team.invite', target: 'jane@org.com', ...over,
})

let urls: string[] = []

function stubFetch(pages: Array<{ entries: unknown[]; nextCursor: string | null } | 'fail'>) {
  urls = []
  let i = 0
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    urls.push(url)
    const page = pages[Math.min(i++, pages.length - 1)]
    return Promise.resolve(page === 'fail' ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => page })
  }))
}

describe('Activity page', () => {
  beforeEach(() => { mockOrg.current = { orgName: 'Onte Ika', role: 'admin', loading: false } })
  afterEach(() => vi.unstubAllGlobals())

  it('shows admins who did what, in plain English, with who did it', async () => {
    stubFetch([{ entries: [
      entry(2, { action: 'form.link_created', target: 'claim: Jane', actorEmail: 'sam@org.com', actorRole: 'agent' }),
      entry(1),
    ], nextCursor: null }])
    render(<ActivityPage />)

    expect(await screen.findByText(/Sent a form to someone/)).toBeInTheDocument()
    expect(screen.getByText(/: claim: Jane/)).toBeInTheDocument()
    expect(screen.getByText('sam@org.com · Agent')).toBeInTheDocument()
    expect(screen.getByText(/Invited someone to the team/)).toBeInTheDocument()
    expect(screen.getByText('boss@org.com · Admin')).toBeInTheDocument()
  })

  it('is admins only: a member sees a message and nothing is fetched', async () => {
    mockOrg.current = { orgName: 'Onte Ika', role: 'agent', loading: false }
    stubFetch([{ entries: [entry(1)], nextCursor: null }])
    render(<ActivityPage />)

    expect(await screen.findByText('Admins only')).toBeInTheDocument()
    expect(urls).toEqual([])
  })

  it('says so when there is nothing yet', async () => {
    stubFetch([{ entries: [], nextCursor: null }])
    render(<ActivityPage />)
    expect(await screen.findByText('No activity yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('loads the next page on request and adds it below, using the cursor', async () => {
    stubFetch([
      { entries: [entry(2)], nextCursor: 'CURSOR-1' },
      { entries: [entry(1, { action: 'submission.export', target: 'sub-9' })], nextCursor: null },
    ])
    const user = userEvent.setup()
    render(<ActivityPage />)

    await user.click(await screen.findByRole('button', { name: 'Load more' }))

    expect(await screen.findByText(/Exported a submission/)).toBeInTheDocument()
    expect(screen.getByText(/Invited someone to the team/)).toBeInTheDocument()       // first page still there
    expect(urls).toEqual(['/api/activity', '/api/activity?cursor=CURSOR-1'])
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()   // no more pages
  })

  it('shows an error instead of an empty log when loading fails', async () => {
    stubFetch(['fail'])
    render(<ActivityPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the activity log')
  })

  it('falls back to the raw action name for one it does not know, rather than crashing', async () => {
    stubFetch([{ entries: [entry(1, { action: 'something.new', target: null })], nextCursor: null }])
    render(<ActivityPage />)
    expect(await screen.findByText('something.new')).toBeInTheDocument()
  })

  it('uses no em dashes or double dashes', async () => {
    stubFetch([{ entries: [entry(1)], nextCursor: null }])
    const { container } = render(<ActivityPage />)
    await screen.findByText(/Invited someone/)
    expect(within(container).getByRole('heading', { name: 'Activity' })).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/—|--/)
  })
})
