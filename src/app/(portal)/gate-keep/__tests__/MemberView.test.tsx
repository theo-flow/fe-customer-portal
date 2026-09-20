import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileBrowser } from '../FileBrowser'
import { Toaster } from '@/components/ui/toaster'

// What a MEMBER sees versus an admin: the organisation's shared space is theirs to use but not
// to change, their own folders are theirs, and the screen never offers what the server would refuse.

beforeAll(() => {
  Element.prototype.hasPointerCapture     ??= () => false
  Element.prototype.setPointerCapture     ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
})

const at = '2026-09-19T00:00:00.000Z'
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response

interface Listing {
  folders: object[]; files: object[]
  access: { isAdmin: boolean; sharedHere: boolean; canManageHere: boolean; canCreateFolder: boolean }
}

const memberTop: Listing = {
  folders: [
    { id: 'shared', name: 'Company policies', parentId: 'root', createdAt: at, shared: true,  canManage: false },
    { id: 'mine',   name: 'My documents',     parentId: 'root', createdAt: at, shared: false, canManage: true },
  ],
  files: [
    { id: 'orgfile', name: 'handbook.pdf', folderId: 'root', size: 2048, contentType: 'application/pdf', createdAt: at, retainUntil: null, canManage: false },
  ],
  access: { isAdmin: false, sharedHere: true, canManageHere: false, canCreateFolder: true },
}

function show(listing: Listing) {
  vi.stubGlobal('fetch', vi.fn(async () => json({ folderId: 'root', breadcrumb: [], tree: [], ...listing })))
  return render(<><FileBrowser/><Toaster/></>)
}
const rowOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement

describe('a member on the organisation\'s top level', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('sees which folders are shared with the organisation and which are private to them', async () => {
    show(memberTop)
    await screen.findByText('Company policies')
    expect(within(rowOf('Company policies')).getByText(/Shared with the organisation/)).toBeInTheDocument()
    expect(within(rowOf('My documents')).getByText(/Private/)).toBeInTheDocument()
  })

  it('gets no actions on the organisation\'s folder, but has them on their own', async () => {
    show(memberTop)
    await screen.findByText('Company policies')
    expect(within(rowOf('Company policies')).queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument()
    expect(within(rowOf('My documents')).getByRole('button', { name: 'Actions for My documents' })).toBeInTheDocument()
  })

  it('can only DOWNLOAD a file that belongs to the organisation: no rename, move, protect or delete', async () => {
    const user = userEvent.setup()
    show(memberTop)
    await screen.findByText('handbook.pdf')
    await user.click(within(rowOf('handbook.pdf')).getByRole('button', { name: 'Actions for handbook.pdf' }))
    expect(screen.getByRole('menuitem', { name: 'Download' })).toBeInTheDocument()
    for (const gone of ['Rename', 'Move to…', 'Protect from deletion…', 'Delete']) {
      expect(screen.queryByRole('menuitem', { name: gone })).not.toBeInTheDocument()
    }
  })

  it('cannot select the organisation\'s files for a bulk delete or protect', async () => {
    show(memberTop)
    await screen.findByText('handbook.pdf')
    expect(within(rowOf('handbook.pdf')).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Select all files' })).not.toBeInTheDocument()
  })

  it('is told that what they add here belongs to the organisation', async () => {
    show(memberTop)
    expect(await screen.findByRole('note')).toHaveTextContent('belong to the organisation, and only an admin can delete them')
  })

  it('can make a new folder at the top level (it will be their own)', async () => {
    show(memberTop)
    await screen.findByText('Company policies')
    expect(screen.getByRole('button', { name: 'New folder' })).toBeEnabled()
  })
})

describe('a member inside their own folder', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  const own: Listing = {
    folders: [],
    files: [{ id: 'mine1', name: 'payslip.pdf', folderId: 'mine', size: 1024, contentType: 'application/pdf', createdAt: at, retainUntil: null, canManage: true }],
    access: { isAdmin: false, sharedHere: false, canManageHere: true, canCreateFolder: true },
  }

  it('has the full set of actions on their own file, and no warning', async () => {
    const user = userEvent.setup()
    show(own)
    await screen.findByText('payslip.pdf')
    await user.click(within(rowOf('payslip.pdf')).getByRole('button', { name: 'Actions for payslip.pdf' }))
    for (const item of ['Download', 'Rename', 'Move to…', 'Protect from deletion…', 'Delete']) {
      expect(screen.getByRole('menuitem', { name: item })).toBeInTheDocument()
    }
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    expect(within(rowOf('payslip.pdf')).getByRole('checkbox')).toBeInTheDocument()
  })
})

describe('a member inside a shared folder', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('cannot add a folder there, and is warned about adding files', async () => {
    show({
      folders: [], files: [],
      access: { isAdmin: false, sharedHere: true, canManageHere: false, canCreateFolder: false },
    })
    expect(await screen.findByRole('note')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New folder' })).toBeDisabled()
  })
})

describe('an admin', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('has every action on the organisation\'s files and no warning', async () => {
    const user = userEvent.setup()
    show({
      folders: [{ id: 'shared', name: 'Company policies', parentId: 'root', createdAt: at, shared: true, canManage: true }],
      files: [{ id: 'orgfile', name: 'handbook.pdf', folderId: 'root', size: 2048, contentType: 'application/pdf', createdAt: at, retainUntil: null, canManage: true }],
      access: { isAdmin: true, sharedHere: true, canManageHere: true, canCreateFolder: true },
    })
    await screen.findByText('handbook.pdf')
    await user.click(within(rowOf('handbook.pdf')).getByRole('button', { name: 'Actions for handbook.pdf' }))
    for (const item of ['Rename', 'Move to…', 'Delete']) expect(screen.getByRole('menuitem', { name: item })).toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    expect(within(rowOf('Company policies')).getByRole('button', { name: 'Actions for Company policies' })).toBeInTheDocument()
  })
})

describe('the end-of-life date', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('shows members when a file will be deleted automatically, so it is never a surprise', async () => {
    show({
      folders: [],
      files: [
        { id: 'a', name: 'kept.pdf',    folderId: 'root', size: 1024, contentType: 'application/pdf', createdAt: at, retainUntil: null, canManage: true, deletesOn: '2031-09-21T00:00:00.000Z' },
        { id: 'b', name: 'no-plan.pdf', folderId: 'root', size: 1024, contentType: 'application/pdf', createdAt: at, retainUntil: null, canManage: true, deletesOn: null },
      ],
      access: { isAdmin: false, sharedHere: false, canManageHere: true, canCreateFolder: true },
    })
    await screen.findByText('kept.pdf')
    expect(within(rowOf('kept.pdf')).getByText(/Deleted automatically on/)).toHaveTextContent('2031')
    expect(within(rowOf('no-plan.pdf')).queryByText(/Deleted automatically/)).not.toBeInTheDocument()
  })
})
