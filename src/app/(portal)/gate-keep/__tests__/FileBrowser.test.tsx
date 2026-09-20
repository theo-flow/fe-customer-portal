import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileBrowser } from '../FileBrowser'
import { Toaster } from '@/components/ui/toaster'

// jsdom doesn't implement pointer capture, which Radix Toast's swipe handling calls.
beforeAll(() => {
  Element.prototype.hasPointerCapture     ??= () => false
  Element.prototype.setPointerCapture     ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
})

interface Folder { id: string; name: string; parentId: string; createdAt: string }
interface File   { id: string; name: string; folderId: string; size: number; contentType: string; createdAt: string; locked?: boolean }
interface Trash  { id: string; name: string; size: number; deletedAt: string; purgeAt: string; locked?: boolean }

const DAY = 24 * 3600 * 1000
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

// A small in-memory stand-in for the Gate-Keep API, so the tests exercise the
// screen's real request/response handling end to end.
function installFakeServer(seed: { folders: Folder[]; files: File[]; trash?: Trash[] }) {
  const s = { folders: [...seed.folders], files: [...seed.files], trash: [...(seed.trash ?? [])] }
  const calls: string[] = []
  // lets a test keep one folder's listing 'in flight' to reproduce a slow network
  const holds = new Map<string, Promise<void>>()
  const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response
  const err = (status: number, error: string, message: string) => json({ error, message }, status)
  const path = (id: string) => {
    const out: { id: string; name: string }[] = []
    let cur = s.folders.find(f => f.id === id)
    while (cur) { out.unshift({ id: cur.id, name: cur.name }); cur = s.folders.find(f => f.id === cur!.parentId) }
    return out
  }
  const taken = (parentId: string, name: string, exceptId?: string) =>
    [...s.folders.filter(f => f.parentId === parentId), ...s.files.filter(f => f.folderId === parentId)]
      .some(x => x.name.toLowerCase() === name.toLowerCase() && x.id !== exceptId)

  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const url = new URL(input, 'http://localhost')
    const body = init?.body ? JSON.parse(init.body as string) : {}
    calls.push(`${method} ${url.pathname}${url.search}`)
    const parts = url.pathname.replace('/api/gate-keep/', '').split('/')

    if (parts[0] === 'list') {
      const folderId = url.searchParams.get('folder') ?? 'root'
      await holds.get(folderId)
      if (folderId !== 'root' && !s.folders.some(f => f.id === folderId)) return err(404, 'not_found', 'Not found.')
      return json({
        folderId, breadcrumb: folderId === 'root' ? [] : path(folderId),
        folders: s.folders.filter(f => f.parentId === folderId), files: s.files.filter(f => f.folderId === folderId),
        tree: s.folders.map(f => ({ id: f.id, parentId: f.parentId, name: f.name })),
      })
    }
    if (parts[0] === 'trash') {
      if (method === 'DELETE') {
        const locked = s.trash.filter(t => t.locked).map(t => t.name)
        const deleted = s.trash.length - locked.length
        s.trash = s.trash.filter(t => t.locked)
        return json({ deleted, locked })
      }
      return json({ files: s.trash.map(t => ({ ...t })) })   // a real response is always a fresh object
    }
    if (parts[0] === 'folders') {
      if (method === 'POST') {
        if (taken(body.parentId, body.name)) return err(409, 'name_taken', 'That name is already used in this folder.')
        const f = { id: `f${s.folders.length + 1}`, name: body.name, parentId: body.parentId, createdAt: iso(0) }
        s.folders.push(f); return json({ folder: f }, 201)
      }
      const f = s.folders.find(x => x.id === parts[1])!
      if (method === 'DELETE') {
        if (s.folders.some(x => x.parentId === f.id) || s.files.some(x => x.folderId === f.id)) {
          return err(409, 'not_empty', 'Move or remove everything inside this folder first.')
        }
        s.folders = s.folders.filter(x => x.id !== f.id); return json({ ok: true })
      }
      if (body.name !== undefined) f.name = body.name
      if (body.parentId !== undefined) f.parentId = body.parentId
      return json({ folder: f })
    }
    if (parts[0] === 'files') {
      const f = s.files.find(x => x.id === parts[1])
      if (parts[2] === 'restore') {
        const t = s.trash.find(x => x.id === parts[1])!
        s.trash = s.trash.filter(x => x.id !== t.id)
        s.files.push({ id: t.id, name: t.name, folderId: 'root', size: t.size, contentType: 'application/pdf', createdAt: iso(0) })
        return json({ file: t })
      }
      if (parts[2] === 'permanent') {
        const t = s.trash.find(x => x.id === parts[1])!
        if (t.locked) return err(409, 'locked', 'This file is protected by a retention lock and cannot be deleted yet.')
        s.trash = s.trash.filter(x => x.id !== t.id); return json({ ok: true })
      }
      if (method === 'DELETE' && f) {
        s.files = s.files.filter(x => x.id !== f.id)
        s.trash.push({ id: f.id, name: f.name, size: f.size, deletedAt: iso(0), purgeAt: new Date(Date.now() + 28 * DAY).toISOString() })
        return json({ ok: true })
      }
      if (method === 'PATCH' && f) {
        if (body.name !== undefined) f.name = body.name
        if (body.folderId !== undefined) f.folderId = body.folderId
        return json({ file: f })
      }
    }
    return err(500, 'unexpected', `unexpected ${method} ${url.pathname}`)
  }))
  const hold = (folderId: string) => {
    let release!: () => void
    holds.set(folderId, new Promise<void>(r => { release = r }))
    return release
  }
  return { state: s, calls, hold }
}

const SEED = () => ({
  folders: [
    { id: 'legal', name: 'Legal', parentId: 'root', createdAt: iso(5 * DAY) },
    { id: 'contracts', name: 'Contracts', parentId: 'legal', createdAt: iso(4 * DAY) },
    { id: 'hr', name: 'HR', parentId: 'root', createdAt: iso(3 * DAY) },
  ],
  files: [
    { id: 'f1', name: 'alpha.pdf', folderId: 'root', size: 2048, contentType: 'application/pdf', createdAt: iso(3 * DAY) },
    { id: 'f2', name: 'beta.pdf',  folderId: 'root', size: 4096, contentType: 'application/pdf', createdAt: iso(1 * DAY) },
    { id: 'f3', name: 'lease.pdf', folderId: 'legal', size: 9000, contentType: 'application/pdf', createdAt: iso(2 * DAY) },
  ],
})

const renderBrowser = () => render(<><FileBrowser/><Toaster/></>)
const rowOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement
const openMenu = async (user: ReturnType<typeof userEvent.setup>, name: string, item: string) => {
  await user.click(within(rowOf(name)).getByRole('button', { name: `Actions for ${name}` }))
  await user.click(screen.getByRole('menuitem', { name: item }))
}

describe('FileBrowser', () => {
  let server: ReturnType<typeof installFakeServer>
  beforeEach(() => { server = installFakeServer(SEED()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('shows folders before files, with the trash count', async () => {
    renderBrowser()
    await screen.findByText('alpha.pdf')

    const names = screen.getAllByRole('listitem').map(li => li.textContent ?? '')
    const order = ['HR', 'Legal', 'beta.pdf', 'alpha.pdf'].map(n => names.findIndex(t => t.includes(n)))
    expect(order).toEqual([...order].sort((a, b) => a - b))        // HR, Legal, then files (newest first)
    expect(screen.getByRole('tab', { name: 'Files (2)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Trash (0)' })).toBeInTheDocument()
  })

  it('opens a folder, shows its breadcrumb, and returns home', async () => {
    const user = userEvent.setup()
    renderBrowser()
    await user.click(await screen.findByRole('button', { name: 'Open folder Legal' }))

    expect(await screen.findByText('lease.pdf')).toBeInTheDocument()
    expect(screen.queryByText('alpha.pdf')).not.toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('Legal')).toBeInTheDocument()

    await user.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('button', { name: 'Home' }))
    expect(await screen.findByText('alpha.pdf')).toBeInTheDocument()
  })

  it('actions apply to the folder on screen and are disabled while another folder loads', async () => {
    const user = userEvent.setup()
    renderBrowser()
    await screen.findByText('alpha.pdf')

    const release = server.hold('legal')
    await user.click(screen.getByRole('button', { name: 'Open folder Legal' }))
    expect(screen.getByRole('button', { name: 'New folder' })).toBeDisabled()   // still loading Legal

    release()
    await screen.findByText('lease.pdf')
    expect(screen.getByRole('button', { name: 'New folder' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'New folder' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Folder name'), 'Leases')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))
    await screen.findByRole('button', { name: 'Open folder Leases' })
    expect(server.state.folders.find(f => f.name === 'Leases')?.parentId).toBe('legal')   // not the top level
  })

  it('a slow response for a folder you have left cannot overwrite the one you are viewing', async () => {
    const user = userEvent.setup()
    renderBrowser()
    await user.click(await screen.findByRole('button', { name: 'Open folder Legal' }))
    await screen.findByText('lease.pdf')

    // Creating a folder triggers a refresh of Legal; hold that response back on the network.
    const release = server.hold('legal')
    await user.click(screen.getByRole('button', { name: 'New folder' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Folder name'), 'Slow')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // Meanwhile the user goes back Home, which loads straight away.
    await user.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('button', { name: 'Home' }))
    await screen.findByText('alpha.pdf')

    release()                                        // Legal's late answer arrives now
    await new Promise(r => setTimeout(r, 50))
    expect(screen.getByText('alpha.pdf')).toBeInTheDocument()
    expect(screen.queryByText('lease.pdf')).not.toBeInTheDocument()
  })

  it('creates a subfolder inside the folder you are in', async () => {
    const user = userEvent.setup()
    renderBrowser()
    await user.click(await screen.findByRole('button', { name: 'Open folder Legal' }))
    await screen.findByText('lease.pdf')

    await user.click(screen.getByRole('button', { name: 'New folder' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Folder name'), 'Leases')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(await screen.findByRole('button', { name: 'Open folder Leases' })).toBeInTheDocument()
    expect(server.calls).toContain('POST /api/gate-keep/folders')
    expect(server.state.folders.find(f => f.name === 'Leases')?.parentId).toBe('legal')
  })

  it('shows the server\'s message when a folder name is already used', async () => {
    const user = userEvent.setup()
    renderBrowser()
    await screen.findByText('alpha.pdf')

    await user.click(screen.getByRole('button', { name: 'New folder' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Folder name'), 'legal')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('That name is already used in this folder.')).toBeInTheDocument()
  })

  it('renames a folder', async () => {
    const user = userEvent.setup()
    renderBrowser()
    await screen.findByText('alpha.pdf')

    await openMenu(user, 'HR', 'Rename')
    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByLabelText('Name')
    await user.clear(input)
    await user.type(input, 'People')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('button', { name: 'Open folder People' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open folder HR' })).not.toBeInTheDocument()
  })

  it('moves a file into a folder', async () => {
    const user = userEvent.setup()
    renderBrowser()
    await screen.findByText('alpha.pdf')

    await openMenu(user, 'alpha.pdf', 'Move to…')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Move here' })).toBeDisabled()   // already at the top level
    await user.click(within(dialog).getByRole('radio', { name: 'HR' }))
    await user.click(within(dialog).getByRole('button', { name: 'Move here' }))

    await waitFor(() => expect(screen.queryByText('alpha.pdf')).not.toBeInTheDocument())
    expect(server.state.files.find(f => f.id === 'f1')?.folderId).toBe('hr')
  })

  it('a folder cannot be moved into itself or anything under it', async () => {
    const user = userEvent.setup()
    renderBrowser()
    await screen.findByText('alpha.pdf')

    await openMenu(user, 'Legal', 'Move to…')
    const dialog = await screen.findByRole('dialog')
    const choices = within(dialog).getAllByRole('radio').map(r => r.textContent)
    expect(choices).toContain('HR')
    expect(choices).not.toContain('Legal')
    expect(choices).not.toContain('Contracts')
  })

  it('refuses to delete a folder that still has contents, and says why', async () => {
    const user = userEvent.setup()
    renderBrowser()
    await screen.findByText('alpha.pdf')

    await openMenu(user, 'Legal', 'Delete folder')
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete folder' }))

    expect(await screen.findByText('Move or remove everything inside this folder first.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open folder Legal' })).toBeInTheDocument()
  })

  it('deletes an empty folder', async () => {
    const user = userEvent.setup()
    renderBrowser()
    await screen.findByText('alpha.pdf')

    await openMenu(user, 'HR', 'Delete folder')
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete folder' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open folder HR' })).not.toBeInTheDocument())
  })

  it('moves a file to trash, then Undo brings it back', async () => {
    const user = userEvent.setup()
    renderBrowser()
    await screen.findByText('alpha.pdf')

    await openMenu(user, 'alpha.pdf', 'Move to trash')
    await waitFor(() => expect(screen.queryByText('alpha.pdf')).not.toBeInTheDocument())
    expect(await screen.findByRole('tab', { name: 'Trash (1)' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('alpha.pdf')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Trash (0)' })).toBeInTheDocument()
  })

  it('counts down the days left in trash from the server\'s purge date', async () => {
    const user = userEvent.setup()
    renderBrowser()
    await screen.findByText('alpha.pdf')
    await openMenu(user, 'alpha.pdf', 'Move to trash')
    await user.click(await screen.findByRole('tab', { name: /Trash/ }))

    expect(await screen.findByText(/Deletes in 28 days/)).toBeInTheDocument()
  })

  it('explains a retention-locked file instead of deleting it', async () => {
    server = installFakeServer({ ...SEED(), trash: [{ id: 'x1', name: 'locked.pdf', size: 100, deletedAt: iso(DAY), purgeAt: new Date(Date.now() + 90 * DAY).toISOString(), locked: true }] })
    const user = userEvent.setup()
    renderBrowser()
    await user.click(await screen.findByRole('tab', { name: /Trash/ }))

    await openMenu(user, 'locked.pdf', 'Delete permanently')
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete permanently' }))

    expect(await screen.findByText('This file is protected by a retention lock and cannot be deleted yet.')).toBeInTheDocument()
    expect(screen.getByText('locked.pdf')).toBeInTheDocument()
    expect(screen.getByText(/Deletes in 90 days/)).toBeInTheDocument()
  })

  it('empty trash reports what a lock kept', async () => {
    server = installFakeServer({ ...SEED(), trash: [
      { id: 'x1', name: 'gone.pdf',   size: 1, deletedAt: iso(DAY), purgeAt: new Date(Date.now() + 27 * DAY).toISOString() },
      { id: 'x2', name: 'locked.pdf', size: 1, deletedAt: iso(DAY), purgeAt: new Date(Date.now() + 90 * DAY).toISOString(), locked: true },
    ] })
    const user = userEvent.setup()
    renderBrowser()
    await user.click(await screen.findByRole('tab', { name: /Trash/ }))
    await user.click(await screen.findByRole('button', { name: 'Empty trash' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Empty trash' }))

    expect(await screen.findByText(/1 file could not be deleted yet because of a retention lock/)).toBeInTheDocument()
    expect(screen.getByText('locked.pdf')).toBeInTheDocument()
    expect(screen.queryByText('gone.pdf')).not.toBeInTheDocument()
  })

  it('search filters folders and files in the current folder', async () => {
    const user = userEvent.setup()
    renderBrowser()
    await screen.findByText('alpha.pdf')

    await user.type(screen.getByLabelText('Search files'), 'leg')
    expect(screen.getByRole('button', { name: 'Open folder Legal' })).toBeInTheDocument()
    expect(screen.queryByText('alpha.pdf')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open folder HR' })).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('Search files'))
    await user.type(screen.getByLabelText('Search files'), 'zzz')
    expect(screen.getByText('No files or folders match "zzz".')).toBeInTheDocument()
  })

  it('falls back to the top level if the open folder was deleted elsewhere', async () => {
    const user = userEvent.setup()
    renderBrowser()
    await user.click(await screen.findByRole('button', { name: 'Open folder Legal' }))
    await screen.findByText('lease.pdf')

    server.state.folders = server.state.folders.filter(f => f.id !== 'legal' && f.id !== 'contracts')
    await user.click(screen.getByRole('button', { name: 'New folder' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Folder name'), 'X')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    // the create fails (parent gone), the screen then reloads; it must land somewhere valid
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument())
    await waitFor(() => expect(screen.queryByText('lease.pdf')).not.toBeInTheDocument())
  })
})
