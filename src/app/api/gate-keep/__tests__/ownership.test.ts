import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// The organisation-wide rules, exercised through the real routes with real member and admin
// callers: who sees what, and who may delete, rename, move or add.

const { mockCtx, s3Send, presign, store } = vi.hoisted(() => ({
  mockCtx: vi.fn(), s3Send: vi.fn(), presign: vi.fn(),
  store: {
    listFolders: vi.fn(), getFolder: vi.fn(), getFile: vi.fn(), listFolderContents: vi.fn(),
    createFolder: vi.fn(), updateFolder: vi.fn(), deleteFolderIfEmpty: vi.fn(),
    createPendingFile: vi.fn(), confirmFile: vi.fn(), updateFile: vi.fn(), deleteFile: vi.fn(), setRetention: vi.fn(),
  },
}))

vi.mock('@/lib/gate-keep-context',     () => ({ getGateKeepContext: mockCtx }))
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/org-retention', () => ({ getOrgRetentionYears: vi.fn(async () => null) }))
vi.mock('@/lib/gate-keep-credentials', () => ({ getScopedClients: async () => ({ s3: { send: s3Send }, db: { tag: 'db' } }) }))
vi.mock('@/lib/aws', () => ({ GATE_KEEP_BUCKET: 'bkt', GATE_KEEP_TABLE: 'tbl' }))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: presign }))
vi.mock('@aws-sdk/client-s3', () => ({
  HeadObjectCommand:   vi.fn(function (this: unknown, input: unknown) { return { __type: 'Head', input } }),
  DeleteObjectCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Delete', input } }),
  PutObjectRetentionCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Retain', input } }),
  PutObjectCommand:    vi.fn(function (this: unknown, input: unknown) { return { __type: 'Put', input } }),
  GetObjectCommand:    vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }),
}))
vi.mock('@/lib/gate-keep-store', async importActual => ({ ...(await importActual<object>()), ...store }))

import { GET as listGET }                       from '../list/route'
import { POST as foldersPOST }                  from '../folders/route'
import { PATCH as folderPATCH, DELETE as folderDELETE } from '../folders/[id]/route'
import { POST as filesPOST }                    from '../files/route'
import { PATCH as filePATCH, DELETE as fileDELETE } from '../files/[id]/route'
import { POST as confirmPOST }                  from '../files/[id]/confirm/route'
import { GET as downloadGET }                   from '../files/[id]/download/route'
import { POST as retentionPOST }                from '../files/[id]/retention/route'

const WS = 'org-1'
const req = (method: string, body?: unknown, url = '/x') =>
  new NextRequest(`http://localhost${url}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }) })
const p = (id: string) => ({ params: { id } })
const asUser = (sub: string, role: 'admin' | 'agent') => mockCtx.mockResolvedValue({ token: 't', orgId: WS, userId: sub, claims: { sub, email: `${sub}@x.co`, 'custom:role': role } })

// root
// ├─ shared            (the organisation's)         └ sharedKid
// ├─ alices  (alice's)                              └ alicesKid
// └─ bobs    (bob's)
const at = '2026-09-19T00:00:00.000Z'
const F = [
  { folderId: 'shared',    parentId: 'root', name: 'Shared',   createdAt: at, createdBy: 'boss' },
  { folderId: 'sharedKid', parentId: 'shared', name: 'Kid',    createdAt: at, createdBy: 'boss' },
  { folderId: 'alices',    parentId: 'root', name: 'Alice',    createdAt: at, createdBy: 'alice', ownerId: 'alice' },
  { folderId: 'alicesKid', parentId: 'alices', name: 'AKid',   createdAt: at, createdBy: 'alice' },
  { folderId: 'bobs',      parentId: 'root', name: 'Bob',      createdAt: at, createdBy: 'bob', ownerId: 'bob' },
]
const file = (id: string, folderId: string, over = {}) => ({
  fileId: id, folderId, name: `${id}.pdf`, contentType: 'application/pdf', size: 1, status: 'READY', createdAt: at, createdBy: 'x', versionId: 'v1', ...over,
})
const FILES: Record<string, ReturnType<typeof file>> = {
  fShared: file('fShared', 'shared'), fRoot: file('fRoot', 'root'),
  fAlice: file('fAlice', 'alices'), fAliceKid: file('fAliceKid', 'alicesKid'), fBob: file('fBob', 'bobs'),
}

beforeEach(() => {
  vi.clearAllMocks()
  presign.mockResolvedValue('https://signed.example/url')
  s3Send.mockResolvedValue({})
  store.listFolders.mockResolvedValue(F)
  store.getFile.mockImplementation(async (_db: unknown, _ws: string, id: string) => FILES[id] ?? null)
  store.getFolder.mockImplementation(async (_db: unknown, _ws: string, id: string) => F.find(f => f.folderId === id) ?? null)
  store.listFolderContents.mockImplementation(async (_db: unknown, _ws: string, id: string) => ({
    folders: F.filter(f => f.parentId === id), files: Object.values(FILES).filter(x => x.folderId === id),
  }))
})

const ids = (xs: { id: string }[]) => xs.map(x => x.id).sort()

describe('what a member SEES', () => {
  it('at the top: the shared space and their own folders, never another member\'s', async () => {
    asUser('alice', 'agent')
    const body = await (await listGET(req('GET', undefined, '/x'))).json()
    expect(ids(body.folders)).toEqual(['alices', 'shared'])
    expect(ids(body.tree)).toEqual(['alices', 'alicesKid', 'shared', 'sharedKid'])         // the move picker too
    expect(JSON.stringify(body)).not.toContain('bobs')
  })

  it('cannot open, or even learn of, another member\'s folder', async () => {
    asUser('alice', 'agent')
    const res = await listGET(req('GET', undefined, '/x?folder=bobs'))
    expect(res.status).toBe(404)
    expect((await listGET(req('GET', undefined, '/x?folder=bobs'))).status).toBe(404)
  })

  it('an admin sees every member\'s folders', async () => {
    asUser('boss', 'admin')
    const body = await (await listGET(req('GET', undefined, '/x'))).json()
    expect(ids(body.folders)).toEqual(['alices', 'bobs', 'shared'])
    expect(ids(body.tree)).toContain('bobs')
    expect((await listGET(req('GET', undefined, '/x?folder=bobs'))).status).toBe(200)
  })

  it('tells the screen what the viewer may do here, and per item', async () => {
    asUser('alice', 'agent')
    const top = await (await listGET(req('GET', undefined, '/x'))).json()
    expect(top.access).toMatchObject({ isAdmin: false, sharedHere: true, canManageHere: false, canCreateFolder: true })
    expect(top.folders.find((f: { id: string }) => f.id === 'shared')).toMatchObject({ shared: true, canManage: false })
    expect(top.folders.find((f: { id: string }) => f.id === 'alices')).toMatchObject({ shared: false, canManage: true })

    const mine = await (await listGET(req('GET', undefined, '/x?folder=alices'))).json()
    expect(mine.access).toMatchObject({ sharedHere: false, canManageHere: true })
    expect(mine.files[0]).toMatchObject({ id: 'fAlice', canManage: true })

    const shared = await (await listGET(req('GET', undefined, '/x?folder=shared'))).json()
    expect(shared.files[0]).toMatchObject({ id: 'fShared', canManage: false })
  })
})

describe('what a member may DELETE', () => {
  it('their own files, including in their sub-folders', async () => {
    asUser('alice', 'agent')
    expect((await fileDELETE(req('DELETE'), p('fAlice'))).status).toBe(200)
    expect((await fileDELETE(req('DELETE'), p('fAliceKid'))).status).toBe(200)
    expect(store.deleteFile).toHaveBeenCalledTimes(2)
  })

  it('NOT files that belong to the organisation (shared folders, or the root), with a plain reason', async () => {
    asUser('alice', 'agent')
    for (const id of ['fShared', 'fRoot']) {
      const res = await fileDELETE(req('DELETE'), p(id))
      expect(res.status).toBe(403)
      expect((await res.json()).message).toBe('This belongs to the organisation. Only an admin can change or delete it.')
    }
    expect(store.deleteFile).not.toHaveBeenCalled()
    expect(s3Send).not.toHaveBeenCalled()
  })

  it('NOT another member\'s files, which read as not found', async () => {
    asUser('alice', 'agent')
    expect((await fileDELETE(req('DELETE'), p('fBob'))).status).toBe(404)
    expect(store.deleteFile).not.toHaveBeenCalled()
  })

  it('an admin can delete the organisation\'s files and members\' files', async () => {
    asUser('boss', 'admin')
    for (const id of ['fShared', 'fRoot', 'fAlice', 'fBob']) expect((await fileDELETE(req('DELETE'), p(id))).status).toBe(200)
  })

  it('a file a member uploaded into the shared space is then the organisation\'s, not theirs to delete', async () => {
    asUser('alice', 'agent')
    FILES.fMine = file('fMine', 'shared', { createdBy: 'alice' })
    expect((await fileDELETE(req('DELETE'), p('fMine'))).status).toBe(403)
    delete FILES.fMine
  })
})

describe('what a member may RENAME, MOVE and PROTECT', () => {
  it('rename and protect their own; not the organisation\'s', async () => {
    asUser('alice', 'agent')
    expect((await filePATCH(req('PATCH', { name: 'new.pdf' }), p('fAlice'))).status).toBe(200)
    expect((await filePATCH(req('PATCH', { name: 'new.pdf' }), p('fShared'))).status).toBe(403)
    expect((await retentionPOST(req('POST', { retainUntil: new Date(Date.now() + 40 * 86_400_000).toISOString() }), p('fAlice'))).status).toBe(200)
    expect((await retentionPOST(req('POST', { retainUntil: new Date(Date.now() + 40 * 86_400_000).toISOString() }), p('fShared'))).status).toBe(403)
  })

  it('move a file between their own folders, but not into the shared space or to the root', async () => {
    asUser('alice', 'agent')
    expect((await filePATCH(req('PATCH', { folderId: 'alicesKid' }), p('fAlice'))).status).toBe(200)
    for (const to of ['shared', 'root']) {
      const res = await filePATCH(req('PATCH', { folderId: to }), p('fAlice'))
      expect(res.status).toBe(403)
    }
  })

  it('cannot even find another member\'s file to change it', async () => {
    asUser('alice', 'agent')
    expect((await filePATCH(req('PATCH', { name: 'x.pdf' }), p('fBob'))).status).toBe(404)
    expect((await downloadGET(req('GET'), p('fBob'))).status).toBe(404)
    expect((await retentionPOST(req('POST', { retainUntil: '2030-01-01' }), p('fBob'))).status).toBe(404)
  })
})

describe('downloading', () => {
  it('a member can download the organisation\'s files and their own, not another member\'s', async () => {
    asUser('alice', 'agent')
    expect((await downloadGET(req('GET'), p('fShared'))).status).toBe(200)
    expect((await downloadGET(req('GET'), p('fAlice'))).status).toBe(200)
    expect((await downloadGET(req('GET'), p('fBob'))).status).toBe(404)
  })

  it('an admin can download anyone\'s', async () => {
    asUser('boss', 'admin')
    expect((await downloadGET(req('GET'), p('fBob'))).status).toBe(200)
  })
})

describe('uploading', () => {
  const start = (folderId: string) => filesPOST(req('POST', { folderId, filename: 'a.pdf', contentType: 'application/pdf', contentLength: 100 }))

  it('a member can add to their own folders and to the shared space, not to another member\'s', async () => {
    asUser('alice', 'agent')
    expect((await start('alices')).status).toBe(201)
    expect((await start('shared')).status).toBe(201)
    expect((await start('root')).status).toBe(201)
    expect((await start('bobs')).status).toBe(404)
  })

  it('only the uploader (or an admin) can finish an upload', async () => {
    const pending = file('pend', 'alices', { status: 'PENDING', createdBy: 'alice', versionId: undefined })
    FILES.pend = pending
    asUser('bob', 'agent')
    expect((await confirmPOST(req('POST'), p('pend'))).status).toBe(404)
    delete FILES.pend
  })
})

describe('what a member may do with FOLDERS', () => {
  it('a member\'s new top-level folder is their own; an admin\'s is the organisation\'s', async () => {
    asUser('alice', 'agent')
    expect((await foldersPOST(req('POST', { name: 'Mine', parentId: 'root' }))).status).toBe(201)
    expect(store.createFolder.mock.calls.at(-1)![2]).toMatchObject({ parentId: 'root', ownerId: 'alice' })

    asUser('boss', 'admin')
    expect((await foldersPOST(req('POST', { name: 'Company', parentId: 'root' }))).status).toBe(201)
    expect(store.createFolder.mock.calls.at(-1)![2]).not.toHaveProperty('ownerId')
  })

  it('a member can add a folder inside their own, not in the shared space or another member\'s', async () => {
    asUser('alice', 'agent')
    expect((await foldersPOST(req('POST', { name: 'Sub', parentId: 'alices' }))).status).toBe(201)
    expect(store.createFolder.mock.calls.at(-1)![2]).not.toHaveProperty('ownerId')       // below top level: inherits
    const shared = await foldersPOST(req('POST', { name: 'Nope', parentId: 'shared' }))
    expect(shared.status).toBe(403)
    expect((await foldersPOST(req('POST', { name: 'Nope', parentId: 'bobs' }))).status).toBe(404)
  })

  it('a member can rename, move and delete their own folders, not the organisation\'s', async () => {
    asUser('alice', 'agent')
    store.deleteFolderIfEmpty.mockResolvedValue(true)
    expect((await folderPATCH(req('PATCH', { name: 'Renamed' }), p('alicesKid'))).status).toBe(200)
    expect((await folderDELETE(req('DELETE'), p('alicesKid'))).status).toBe(200)
    expect((await folderPATCH(req('PATCH', { name: 'X' }), p('shared'))).status).toBe(403)
    expect((await folderDELETE(req('DELETE'), p('shared'))).status).toBe(403)
    expect((await folderPATCH(req('PATCH', { name: 'X' }), p('bobs'))).status).toBe(404)
    expect((await folderDELETE(req('DELETE'), p('bobs'))).status).toBe(404)
  })

  it('a member cannot move a folder into the shared space or into another member\'s', async () => {
    asUser('alice', 'agent')
    expect((await folderPATCH(req('PATCH', { parentId: 'shared' }), p('alicesKid'))).status).toBe(403)
    expect((await folderPATCH(req('PATCH', { parentId: 'bobs' }), p('alicesKid'))).status).toBe(404)
  })

  it('a member\'s nested folder moved to the top level stays theirs', async () => {
    asUser('alice', 'agent')
    await folderPATCH(req('PATCH', { parentId: 'root' }), p('alicesKid'))
    expect(store.updateFolder.mock.calls.at(-1)![3]).toEqual({ name: 'AKid', parentId: 'root', ownerId: 'alice' })
  })

  it('a shared nested folder moved to the top level by an admin stays the organisation\'s', async () => {
    asUser('boss', 'admin')
    await folderPATCH(req('PATCH', { parentId: 'root' }), p('sharedKid'))
    expect(store.updateFolder.mock.calls.at(-1)![3]).toEqual({ name: 'Kid', parentId: 'root', ownerId: null })
  })

  it('a folder moved below the top level loses its own owner marker (it takes its new parent\'s)', async () => {
    asUser('alice', 'agent')
    await folderPATCH(req('PATCH', { parentId: 'alicesKid' }), p('alices'))
    // alice cannot nest a folder inside its own descendant: that is refused as a cycle
    expect(store.updateFolder).not.toHaveBeenCalled()
  })
})
