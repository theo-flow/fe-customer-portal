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
