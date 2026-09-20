import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GateKeepErasure } from '../GateKeepErasure'

const INV = { objectVersions: 4, deleteMarkers: 0, bytes: 3 * 1024 * 1024, files: 4, folders: 2 }
const RESULT = { complete: true, versionsDeleted: 4, markersDeleted: 0, bytesDeleted: 3 * 1024 * 1024, locked: 0, catalogueRemoved: 12, foldersKept: 0 }
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response

interface Server { inv: typeof INV; history: unknown[]; postStatus?: number; postBody?: unknown }

function install(s: Server) {
  const calls: { method: string; body?: any }[] = []   // eslint-disable-line @typescript-eslint/no-explicit-any
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ method, body: init?.body ? JSON.parse(init.body as string) : undefined })
    if (method === 'POST') {
      if ((s.postStatus ?? 200) >= 400) return json(s.postBody, s.postStatus)
      s.inv = { objectVersions: 0, deleteMarkers: 0, bytes: 0, files: 0, folders: 0 }
      return json({ result: s.postBody ?? RESULT })
    }
    return json({ inventory: s.inv, history: s.history })
  }))
  return calls
}

const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'Erase Gate-Keep data' }))
  return screen.findByRole('dialog')
}

describe('GateKeepErasure', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  let s: Server
  beforeEach(() => { s = { inv: { ...INV }, history: [] } })

  it('shows what would be erased', async () => {
    install(s)
    render(<GateKeepErasure orgId="org-1" />)
    expect(await screen.findByText('4 files, 2 folders, 3.0 MB stored (4 stored versions).')).toBeInTheDocument()
  })

  it('says so, and offers nothing to erase, for an empty workspace', async () => {
    s.inv = { objectVersions: 0, deleteMarkers: 0, bytes: 0, files: 0, folders: 0 }
    install(s)
    render(<GateKeepErasure orgId="org-1" />)
    expect(await screen.findByText('This workspace has no Gate-Keep data.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Erase Gate-Keep data' })).toBeDisabled()
  })

  it('cannot be confirmed until the workspace id is typed exactly AND a reason is given', async () => {
    const user = userEvent.setup()
    install(s)
    render(<GateKeepErasure orgId="org-1" />)
    const dialog = await openDialog(user)
    const go = within(dialog).getByRole('button', { name: 'Erase permanently' })
    expect(go).toBeDisabled()

    await user.type(within(dialog).getByLabelText(/Type the workspace id/), 'org-2')
    await user.type(within(dialog).getByLabelText(/Reason/), 'POPIA request 4821')
    expect(go).toBeDisabled()                                      // wrong id

    await user.clear(within(dialog).getByLabelText(/Type the workspace id/))
    await user.type(within(dialog).getByLabelText(/Type the workspace id/), 'org-1')
    await user.clear(within(dialog).getByLabelText(/Reason/))
    await user.type(within(dialog).getByLabelText(/Reason/), 'short')
    expect(go).toBeDisabled()                                      // reason too short

    await user.clear(within(dialog).getByLabelText(/Reason/))
    await user.type(within(dialog).getByLabelText(/Reason/), 'POPIA request 4821')
    expect(go).toBeEnabled()
  })

  it('erases with the typed id and reason, then reports the result and refreshes', async () => {
    const user = userEvent.setup()
    const calls = install(s)
    render(<GateKeepErasure orgId="org-1" />)
    const dialog = await openDialog(user)
    await user.type(within(dialog).getByLabelText(/Type the workspace id/), 'org-1')
    await user.type(within(dialog).getByLabelText(/Reason/), 'POPIA request 4821')
    await user.click(within(dialog).getByRole('button', { name: 'Erase permanently' }))

    expect(await screen.findByText(/Erasure complete\./)).toBeInTheDocument()
    expect(calls.find(c => c.method === 'POST')!.body).toEqual({ confirmOrgId: 'org-1', reason: 'POPIA request 4821' })
    expect(await screen.findByText('This workspace has no Gate-Keep data.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('says when a run did not finish, and when a retention lock left something in place', async () => {
    const user = userEvent.setup()
    s.postBody = { ...RESULT, complete: false, locked: 2 }
    install(s)
    render(<GateKeepErasure orgId="org-1" />)
    const dialog = await openDialog(user)
    await user.type(within(dialog).getByLabelText(/Type the workspace id/), 'org-1')
    await user.type(within(dialog).getByLabelText(/Reason/), 'POPIA request 4821')
    await user.click(within(dialog).getByRole('button', { name: 'Erase permanently' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Not finished yet: run it again to continue.')
    expect(status).toHaveTextContent('2 versions left in place because of a retention lock.')
  })

  it("shows the server's reason in the dialog and keeps it open when the erasure fails", async () => {
    const user = userEvent.setup()
    s.postStatus = 500
    s.postBody = { error: 'server_error', message: 'The erasure did not finish. Check the erasure log for what was done, then run it again.' }
    install(s)
    render(<GateKeepErasure orgId="org-1" />)
    const dialog = await openDialog(user)
    await user.type(within(dialog).getByLabelText(/Type the workspace id/), 'org-1')
    await user.type(within(dialog).getByLabelText(/Reason/), 'POPIA request 4821')
    await user.click(within(dialog).getByRole('button', { name: 'Erase permanently' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The erasure did not finish.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('cancelling erases nothing', async () => {
    const user = userEvent.setup()
    const calls = install(s)
    render(<GateKeepErasure orgId="org-1" />)
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls.some(c => c.method === 'POST')).toBe(false)
  })

  it('lists the erasure log: when, who, why', async () => {
    s.history = [{ at: '2026-09-20T10:00:00.000Z', erasureId: 'e1', phase: 'COMPLETED', operatorEmail: 'ops@theoflow.example', reason: 'ticket 4821' }]
    install(s)
    render(<GateKeepErasure orgId="org-1" />)
    expect(await screen.findByText(/completed by ops@theoflow\.example\. Reason: ticket 4821/)).toBeInTheDocument()
  })

  it('shows a read failure instead of failing silently', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'Something went wrong. Please try again.' }, 500)))
    render(<GateKeepErasure orgId="org-1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(screen.getByRole('button', { name: 'Erase Gate-Keep data' })).toBeDisabled()
  })
})
