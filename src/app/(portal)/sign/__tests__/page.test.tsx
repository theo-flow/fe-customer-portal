import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/lib/org-context', () => ({ useOrg: () => ({ orgName: 'Acme', loading: false }) }))

import SignSessionsPage from '../page'

const json = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response

const session = (over: Record<string, unknown>) => ({
  sessionId: 's', status: 'SIGNED', createdAt: 'c', updatedAt: 'u', submissionId: null, completedKey: 'sign/completed/s/completed.pdf',
  completedSha256: null, documentsDeleted: false, signers: [{ signerId: 'a', name: 'Thandi', email: 't@example.com', status: 'SIGNED' }], ...over,
})

function serve(sessions: unknown[], del: Response = json({ ok: true })) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/sign/sessions') return json({ sessions })
    if (init?.method === 'DELETE') return del
    return json({}, false, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('Sign sessions page: deleting documents', () => {
  beforeEach(() => { vi.spyOn(window, 'confirm').mockReturnValue(true) })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('offers Delete documents on a finished session but not on one that is still open', async () => {
    serve([session({ sessionId: 'done' }), session({ sessionId: 'open', status: 'PENDING' })])
    render(<SignSessionsPage />)
    await screen.findByText('Signing sessions')
    await waitFor(() => expect(screen.getAllByText(/signer/i).length).toBeGreaterThan(0))
    expect(screen.getAllByRole('button', { name: 'Delete documents' })).toHaveLength(1)
  })

  it('warns that it cannot be undone (and to download a signed copy first), then deletes', async () => {
    const fetchMock = serve([session({ sessionId: 'done' })])
    render(<SignSessionsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete documents' }))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/cannot be undone.*Download the signed copy first/))
    await screen.findByText('Documents deleted.')
    expect(fetchMock).toHaveBeenCalledWith('/api/sign/sessions/done/documents', { method: 'DELETE' })
  })

  it('does nothing when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const fetchMock = serve([session({ sessionId: 'done' })])
    render(<SignSessionsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete documents' }))
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'DELETE')).toBe(false)
  })

  it('shows the server\'s message when it fails', async () => {
    serve([session({ sessionId: 'done' })], json({ error: 'Could not delete the documents. Please try again.' }, false, 500))
    render(<SignSessionsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete documents' }))
    await screen.findByText('Could not delete the documents. Please try again.')
  })

  it('a session whose documents are gone says so, with no view, delete or resend', async () => {
    serve([session({ status: 'EXPIRED', documentsDeleted: true, completedKey: null, signers: [{ signerId: 'a', name: '', email: '', status: 'EXPIRED' }] })])
    render(<SignSessionsPage />)
    await screen.findByText('Documents deleted')
    expect(screen.queryByRole('button', { name: /Delete documents|View document|Send new link|Cancel/ })).not.toBeInTheDocument()
    expect(screen.getByText('Signer')).toBeInTheDocument()     // no name is kept
  })
})

describe('Sign sessions page: paging and refreshing', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  const rows = (from: number, to: number, status = 'SIGNED') => Array.from({ length: to - from + 1 }, (_v, i) => {
    const n = to - i
    return session({ sessionId: `s${String(n).padStart(2, '0')}`, createdAt: `2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`, status, completedKey: null })
  })

  function serveInPages() {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/sign/sessions') return json({ sessions: rows(3, 4), nextCursor: '2026-01-03T00:00:00.000Z|s03' })
      if (url.startsWith('/api/sign/sessions?cursor=')) return json({ sessions: rows(1, 2), nextCursor: null })
      return json({}, false, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }
  const listCalls = (fetchMock: ReturnType<typeof serveInPages>) => fetchMock.mock.calls.filter(c => String(c[0]).startsWith('/api/sign/sessions')).length

  it('shows the newest page with Load more, and Load more adds the older ones below and then goes away', async () => {
    const fetchMock = serveInPages()
    render(<SignSessionsPage />)
    await screen.findByRole('button', { name: 'Load more' })
    expect(screen.getAllByText(/1 of 1 signer signed/)).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(screen.getAllByText(/1 of 1 signer signed/)).toHaveLength(4))
    expect(fetchMock).toHaveBeenCalledWith('/api/sign/sessions?cursor=2026-01-03T00%3A00%3A00.000Z%7Cs03')
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('says so when a page cannot be loaded, and keeps what is already there', async () => {
    const fetchMock = vi.fn(async (url: string) => (url === '/api/sign/sessions'
      ? json({ sessions: rows(3, 4), nextCursor: 'c' }) : json({}, false, 500)))
    vi.stubGlobal('fetch', fetchMock)
    render(<SignSessionsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    await screen.findByText('Could not load sessions. Please try again.')
    expect(screen.getAllByText(/1 of 1 signer signed/)).toHaveLength(2)
  })

  it('refreshes every 15 seconds while a session is still in progress', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = vi.fn(async () => json({ sessions: rows(1, 1, 'PENDING'), nextCursor: null }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SignSessionsPage />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(14000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('does not refresh at all when every session is finished', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = serveInPages()
    render(<SignSessionsPage />)
    await screen.findByRole('button', { name: 'Load more' })
    await vi.advanceTimersByTimeAsync(120000)
    expect(listCalls(fetchMock)).toBe(1)
  })

  it('does not refresh while the tab is in the background', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const fetchMock = vi.fn(async () => json({ sessions: rows(1, 1, 'PENDING'), nextCursor: null }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SignSessionsPage />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(60000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
