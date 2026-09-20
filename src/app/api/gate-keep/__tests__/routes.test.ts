import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockCtx, s3Send, presign, store } = vi.hoisted(() => ({
  mockCtx: vi.fn(),
  s3Send:  vi.fn(),
  presign: vi.fn(),
  store: {
    listFolders: vi.fn(), getFolder: vi.fn(), getFile: vi.fn(), listFolderContents: vi.fn(), listTrash: vi.fn(),
    createFolder: vi.fn(), updateFolder: vi.fn(), deleteFolderIfEmpty: vi.fn(),
    createPendingFile: vi.fn(), confirmFile: vi.fn(), updateFile: vi.fn(),
    softDeleteFile: vi.fn(), restoreFile: vi.fn(), deleteFileRow: vi.fn(),
  },
}))

vi.mock('@/lib/gate-keep-context',     () => ({ getGateKeepContext: mockCtx }))
vi.mock('@/lib/gate-keep-credentials', () => ({ getScopedClients: async () => ({ s3: { send: s3Send }, db: { tag: 'db' } }) }))
vi.mock('@/lib/aws', () => ({ GATE_KEEP_BUCKET: 'bkt', GATE_KEEP_TABLE: 'tbl' }))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: presign }))
vi.mock('@aws-sdk/client-s3', () => ({
  HeadObjectCommand:   vi.fn(function (this: unknown, input: unknown) { return { __type: 'Head',   input } }),
  DeleteObjectCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Delete', input } }),
  PutObjectCommand:    vi.fn(function (this: unknown, input: unknown) { return { __type: 'Put',    input } }),
  GetObjectCommand:    vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get',    input } }),
}))
// Keep the real error classes (the route wrapper maps them); replace only the functions that hit DynamoDB.
vi.mock('@/lib/gate-keep-store', async (importActual) => ({ ...(await importActual<object>()), ...store }))

import { NameTakenError } from '@/lib/gate-keep-store'
import { GET as listGET }                  from '../list/route'
import { POST as foldersPOST }             from '../folders/route'
import { PATCH as folderPATCH, DELETE as folderDELETE } from '../folders/[id]/route'
import { POST as filesPOST }               from '../files/route'
import { PATCH as filePATCH, DELETE as fileDELETE }     from '../files/[id]/route'
import { POST as confirmPOST }             from '../files/[id]/confirm/route'
import { GET as downloadGET }              from '../files/[id]/download/route'
import { POST as restorePOST }             from '../files/[id]/restore/route'
import { DELETE as permanentDELETE }       from '../files/[id]/permanent/route'
import { GET as trashGET, DELETE as trashDELETE } from '../trash/route'

const WS = 'org-1'
const USER = 'user-1'
const p = (id: string) => ({ params: { id } })
const req = (method: string, url: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  })

const file = (over: Record<string, unknown> = {}) => ({
  fileId: 'f1', folderId: 'root', name: 'a.pdf', contentType: 'application/pdf', size: 10, status: 'READY',
  createdAt: '2026-09-19T00:00:00.000Z', versionId: 'v1', ...over,
})
const folder = (over: Record<string, unknown> = {}) => ({
  folderId: 'd1', parentId: 'root', name: 'Legal', createdAt: '2026-09-19T00:00:00.000Z', ...over,
})
const trashed = (over = {}) => file({ deletedAt: '2026-09-20T00:00:00.000Z', deleteMarkerVersionId: 'm1', purgeAt: 1_800_000_000, ...over })

const s3Types = () => s3Send.mock.calls.map(c => c[0])

beforeEach(() => {
  vi.clearAllMocks()
  mockCtx.mockResolvedValue({ token: 't', orgId: WS, userId: USER })
  presign.mockResolvedValue('https://signed.example/url')
  s3Send.mockResolvedValue({})
  store.listFolders.mockResolvedValue([])
  store.listFolderContents.mockResolvedValue({ folders: [], files: [] })
  store.listTrash.mockResolvedValue([])
  store.getFolder.mockResolvedValue(null)
  store.getFile.mockResolvedValue(null)
})

describe('every route', () => {
  it('requires a valid login', async () => {
    mockCtx.mockResolvedValue(null)
    const calls = [
      () => listGET(req('GET', '/api/gate-keep/list')),
      () => foldersPOST(req('POST', '/api/gate-keep/folders', { name: 'x' })),
      () => folderPATCH(req('PATCH', '/x', { name: 'y' }), p('d1')),
      () => folderDELETE(req('DELETE', '/x'), p('d1')),
      () => filesPOST(req('POST', '/api/gate-keep/files', {})),
      () => filePATCH(req('PATCH', '/x', { name: 'y' }), p('f1')),
      () => fileDELETE(req('DELETE', '/x'), p('f1')),
      () => confirmPOST(req('POST', '/x'), p('f1')),
      () => downloadGET(req('GET', '/x'), p('f1')),
      () => restorePOST(req('POST', '/x'), p('f1')),
      () => permanentDELETE(req('DELETE', '/x'), p('f1')),
      () => trashGET(),
      () => trashDELETE(),
    ]
    for (const call of calls) expect((await call()).status).toBe(401)
    expect(s3Send).not.toHaveBeenCalled()
    expect(Object.values(store).every(fn => fn.mock.calls.length === 0)).toBe(true)
  })

  it('takes the workspace from the login, never from the request', async () => {
    await listGET(req('GET', '/api/gate-keep/list?ws=org-2&workspace=org-2'))
    await foldersPOST(req('POST', '/api/gate-keep/folders', { name: 'x', ws: 'org-2', workspaceId: 'org-2', PK: 'WS#org-2' }))
    for (const fn of [store.listFolders, store.listFolderContents, store.createFolder]) {
      for (const call of fn.mock.calls) expect(call[1]).toBe(WS)
    }
    const created = store.createFolder.mock.calls[0][2]
    expect(created.PK).toBe('WS#org-1')
  })

  it('returns a clean 500 (no internals) when something unexpected fails', async () => {
    store.listFolders.mockRejectedValue(new Error('secret table name daai-insure-gate-keep exploded'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await listGET(req('GET', '/api/gate-keep/list'))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('daai-insure')
  })
})

describe('GET /list', () => {
  it('returns a folder\'s contents, breadcrumb and the folder tree', async () => {
    store.listFolders.mockResolvedValue([
      folder({ folderId: 'a', name: 'A' }), folder({ folderId: 'b', parentId: 'a', name: 'B' }),
    ])
    store.listFolderContents.mockResolvedValue({ folders: [folder({ folderId: 'b', parentId: 'a', name: 'B' })], files: [file()] })
    const res = await listGET(req('GET', '/api/gate-keep/list?folder=a'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.breadcrumb).toEqual([{ id: 'a', name: 'A' }])
    expect(body.folders.map((f: { id: string }) => f.id)).toEqual(['b'])
    expect(body.files[0]).toMatchObject({ id: 'f1', name: 'a.pdf' })
    expect(body.tree).toHaveLength(2)
    expect(JSON.stringify(body)).not.toContain('WS#')   // no raw keys leak to the browser
  })

  it('404s for a folder that does not exist', async () => {
    expect((await listGET(req('GET', '/api/gate-keep/list?folder=ghost'))).status).toBe(404)
  })
})

describe('POST /folders', () => {
  it('creates a folder in the root', async () => {
    const res = await foldersPOST(req('POST', '/api/gate-keep/folders', { name: '  Legal ' }))
    expect(res.status).toBe(201)
    const item = store.createFolder.mock.calls[0][2]
    expect(item).toMatchObject({ name: 'Legal', parentId: 'root', createdBy: USER })
  })

  it.each([[''], ['a/b'], ['..']])('rejects the name %j', async name => {
    expect((await foldersPOST(req('POST', '/api/gate-keep/folders', { name }))).status).toBe(400)
    expect(store.createFolder).not.toHaveBeenCalled()
  })

  it('404s when the parent folder does not exist', async () => {
    expect((await foldersPOST(req('POST', '/api/gate-keep/folders', { name: 'x', parentId: 'ghost' }))).status).toBe(404)
  })

  it('refuses to nest deeper than 8 levels', async () => {
    const chain = Array.from({ length: 8 }, (_, i) => folder({ folderId: `n${i}`, parentId: i ? `n${i - 1}` : 'root', name: `n${i}` }))
    store.listFolders.mockResolvedValue(chain)
    const res = await foldersPOST(req('POST', '/api/gate-keep/folders', { name: 'x', parentId: 'n7' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('too_deep')
  })

  it('409s when the name is already used in that folder', async () => {
    store.createFolder.mockRejectedValue(new NameTakenError())
    const res = await foldersPOST(req('POST', '/api/gate-keep/folders', { name: 'Legal' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('name_taken')
  })
})

describe('PATCH/DELETE /folders/[id]', () => {
  beforeEach(() => { store.getFolder.mockResolvedValue(folder()) })

  it('renames a folder', async () => {
    const res = await folderPATCH(req('PATCH', '/x', { name: 'Contracts' }), p('d1'))
    expect(res.status).toBe(200)
    expect(store.updateFolder.mock.calls[0][3]).toEqual({ name: 'Contracts', parentId: 'root' })
  })

  it('a no-op change touches nothing', async () => {
    await folderPATCH(req('PATCH', '/x', { name: 'Legal' }), p('d1'))
    expect(store.updateFolder).not.toHaveBeenCalled()
  })

  it('rejects moving a folder into its own descendant', async () => {
    store.listFolders.mockResolvedValue([folder(), folder({ folderId: 'd2', parentId: 'd1', name: 'Sub' })])
    const res = await folderPATCH(req('PATCH', '/x', { parentId: 'd2' }), p('d1'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('cycle')
  })

  it('404s for a missing folder and a missing destination', async () => {
    store.getFolder.mockResolvedValueOnce(null)
    expect((await folderPATCH(req('PATCH', '/x', { name: 'a' }), p('nope'))).status).toBe(404)
    store.listFolders.mockResolvedValue([folder()])
    expect((await folderPATCH(req('PATCH', '/x', { parentId: 'ghost' }), p('d1'))).status).toBe(404)
  })

  it('409s on a name clash', async () => {
    store.updateFolder.mockRejectedValue(new NameTakenError())
    expect((await folderPATCH(req('PATCH', '/x', { name: 'Taken' }), p('d1'))).status).toBe(409)
  })

  it('DELETE refuses a folder that is not empty', async () => {
    store.deleteFolderIfEmpty.mockResolvedValue(false)
    const res = await folderDELETE(req('DELETE', '/x'), p('d1'))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('not_empty')
  })

  it('DELETE removes an empty folder', async () => {
    store.deleteFolderIfEmpty.mockResolvedValue(true)
    expect((await folderDELETE(req('DELETE', '/x'), p('d1'))).status).toBe(200)
  })
})

describe('POST /files (start an upload)', () => {
  const body = (over = {}) => ({ filename: 'a.pdf', contentType: 'application/pdf', contentLength: 1000, ...over })

  it('reserves a hidden row and returns a presigned PUT to {workspace}/{fileId}', async () => {
    const res = await filesPOST(req('POST', '/api/gate-keep/files', body()))
    const out = await res.json()

    expect(res.status).toBe(201)
    expect(out.uploadUrl).toBe('https://signed.example/url')
    const row = store.createPendingFile.mock.calls[0][2]
    expect(row).toMatchObject({ PK: 'WS#org-1', status: 'PENDING', name: 'a.pdf', createdBy: USER })
    expect(row).not.toHaveProperty('GSI1PK')
    const put = presign.mock.calls[0][1]
    expect(put.input).toMatchObject({ Bucket: 'bkt', Key: `org-1/${out.fileId}`, ContentType: 'application/pdf' })
  })

  it('keeps only the file name from a path the browser reports', async () => {
    await filesPOST(req('POST', '/api/gate-keep/files', body({ filename: 'C:\\fakepath\\report.pdf' })))
    expect(store.createPendingFile.mock.calls[0][2].name).toBe('report.pdf')
  })

  it('rejects unsupported types, empty and oversized files, and bad names', async () => {
    expect((await filesPOST(req('POST', '/x', body({ contentType: 'text/html' })))).status).toBe(415)
    expect((await filesPOST(req('POST', '/x', body({ contentLength: 0 })))).status).toBe(400)
    expect((await filesPOST(req('POST', '/x', body({ contentLength: 51 * 1024 * 1024 })))).status).toBe(413)
    expect((await filesPOST(req('POST', '/x', body({ filename: '..' })))).status).toBe(400)
    expect(store.createPendingFile).not.toHaveBeenCalled()
  })

  it('404s when the target folder does not exist', async () => {
    expect((await filesPOST(req('POST', '/x', body({ folderId: 'ghost' })))).status).toBe(404)
  })
})

describe('POST /files/[id]/confirm', () => {
  const pending = () => file({ status: 'PENDING', versionId: undefined })

  it('lists the file using the version S3 reports', async () => {
    store.getFile.mockResolvedValue(pending())
    s3Send.mockResolvedValue({ ContentLength: 555, VersionId: 'v-real' })
    store.confirmFile.mockResolvedValue({ name: 'a.pdf' })

    const res = await confirmPOST(req('POST', '/x'), p('f1'))
    expect(res.status).toBe(200)
    expect(store.confirmFile.mock.calls[0][3]).toEqual({ folderId: 'root', versionId: 'v-real', size: 555 })
  })

  it('reports an upload that never arrived', async () => {
    store.getFile.mockResolvedValue(pending())
    s3Send.mockRejectedValue(Object.assign(new Error('nf'), { $metadata: { httpStatusCode: 404 } }))
    const res = await confirmPOST(req('POST', '/x'), p('f1'))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('upload_incomplete')
    expect(store.confirmFile).not.toHaveBeenCalled()
  })

  it('discards an oversized object, since the presigned URL cannot cap the size', async () => {
    store.getFile.mockResolvedValue(pending())
    s3Send.mockResolvedValueOnce({ ContentLength: 60 * 1024 * 1024, VersionId: 'v-big' }).mockResolvedValue({})
    const res = await confirmPOST(req('POST', '/x'), p('f1'))
    expect(res.status).toBe(413)
    expect(s3Types()[1]).toMatchObject({ __type: 'Delete', input: { Key: 'org-1/f1', VersionId: 'v-big' } })
  })

  it('is idempotent for an already-confirmed file', async () => {
    store.getFile.mockResolvedValue(file())
    expect((await confirmPOST(req('POST', '/x'), p('f1'))).status).toBe(200)
    expect(s3Send).not.toHaveBeenCalled()
  })

  it('files it in the root if its folder was deleted during the upload', async () => {
    store.getFile.mockResolvedValue({ ...pending(), folderId: 'gone' })
    store.getFolder.mockResolvedValue(null)
    s3Send.mockResolvedValue({ ContentLength: 1, VersionId: 'v' })
    store.confirmFile.mockResolvedValue({ name: 'a.pdf' })
    await confirmPOST(req('POST', '/x'), p('f1'))
    expect(store.confirmFile.mock.calls[0][3].folderId).toBe('root')
  })

  it('404s for another workspace\'s file id (not in this partition)', async () => {
    store.getFile.mockResolvedValue(null)
    expect((await confirmPOST(req('POST', '/x'), p('someone-elses'))).status).toBe(404)
    expect(store.getFile.mock.calls[0][1]).toBe(WS)
  })
})

describe('GET /files/[id]/download', () => {
  it('signs a download with the real file name', async () => {
    store.getFile.mockResolvedValue(file({ name: 'Café.pdf' }))
    const res = await downloadGET(req('GET', '/x'), p('f1'))
    expect(res.status).toBe(200)
    const get = presign.mock.calls[0][1].input
    expect(get.Key).toBe('org-1/f1')
    expect(get.ResponseContentDisposition).toContain("filename*=UTF-8''Caf%C3%A9.pdf")
  })

  it.each([
    ['missing', null], ['still uploading', file({ status: 'PENDING' })], ['removed', trashed()],
  ])('404s for a file that is %s', async (_label, row) => {
    store.getFile.mockResolvedValue(row)
    expect((await downloadGET(req('GET', '/x'), p('f1'))).status).toBe(404)
    expect(presign).not.toHaveBeenCalled()
  })
})

describe('PATCH /files/[id] (rename / move)', () => {
  it('renames and moves', async () => {
    store.getFile.mockResolvedValue(file())
    store.getFolder.mockResolvedValue(folder({ folderId: 'd1' }))
    const res = await filePATCH(req('PATCH', '/x', { name: 'b.pdf', folderId: 'd1' }), p('f1'))
    expect(res.status).toBe(200)
    expect(store.updateFile.mock.calls[0][3]).toEqual({ name: 'b.pdf', folderId: 'd1' })
  })

  it('404s for a removed file or a missing destination', async () => {
    store.getFile.mockResolvedValue(trashed())
    expect((await filePATCH(req('PATCH', '/x', { name: 'b' }), p('f1'))).status).toBe(404)
    store.getFile.mockResolvedValue(file())
    store.getFolder.mockResolvedValue(null)
    expect((await filePATCH(req('PATCH', '/x', { folderId: 'ghost' }), p('f1'))).status).toBe(404)
  })

  it('409s on a name clash', async () => {
    store.getFile.mockResolvedValue(file())
    store.updateFile.mockRejectedValue(new NameTakenError())
    expect((await filePATCH(req('PATCH', '/x', { name: 'taken.pdf' }), p('f1'))).status).toBe(409)
  })
})

describe('DELETE /files/[id] (remove)', () => {
  it('adds a delete marker in S3 (no version id), then records it', async () => {
    store.getFile.mockResolvedValue(file())
    s3Send.mockResolvedValue({ DeleteMarker: true, VersionId: 'm-new' })
    store.softDeleteFile.mockResolvedValue({ purgeAt: 1_800_000_000 })

    const res = await fileDELETE(req('DELETE', '/x'), p('f1'))
    expect(res.status).toBe(200)
    expect(s3Types()[0]).toMatchObject({ __type: 'Delete', input: { Bucket: 'bkt', Key: 'org-1/f1' } })
    expect(s3Types()[0].input).not.toHaveProperty('VersionId')
    expect(store.softDeleteFile.mock.calls[0][3]).toMatchObject({ deleteMarkerVersionId: 'm-new' })
  })

  it('puts the file back in view if the catalogue cannot record the removal', async () => {
    store.getFile.mockResolvedValue(file())
    s3Send.mockResolvedValue({ DeleteMarker: true, VersionId: 'm-new' })
    store.softDeleteFile.mockRejectedValue(new Error('ddb down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect((await fileDELETE(req('DELETE', '/x'), p('f1'))).status).toBe(500)
    expect(s3Types()[1]).toMatchObject({ __type: 'Delete', input: { Key: 'org-1/f1', VersionId: 'm-new' } })
  })

  it('404s for a file that is already removed', async () => {
    store.getFile.mockResolvedValue(trashed())
    expect((await fileDELETE(req('DELETE', '/x'), p('f1'))).status).toBe(404)
    expect(s3Send).not.toHaveBeenCalled()
  })
})

describe('POST /files/[id]/restore', () => {
  it('removes the delete marker by its version id, then records the restore', async () => {
    store.getFile.mockResolvedValue(trashed())
    store.restoreFile.mockResolvedValue({ name: 'a (restored).pdf' })
    const res = await restorePOST(req('POST', '/x'), p('f1'))

    expect(s3Types()[0]).toMatchObject({ __type: 'Delete', input: { Key: 'org-1/f1', VersionId: 'm1' } })
    expect((await res.json()).file.name).toBe('a (restored).pdf')
  })

  it('404s for a file that is not in the trash', async () => {
    store.getFile.mockResolvedValue(file())
    expect((await restorePOST(req('POST', '/x'), p('f1'))).status).toBe(404)
  })
})

describe('DELETE /files/[id]/permanent', () => {
  it('deletes the file\'s own version, tidies the marker, and drops the row', async () => {
    store.getFile.mockResolvedValue(trashed())
    const res = await permanentDELETE(req('DELETE', '/x'), p('f1'))

    expect(res.status).toBe(200)
    expect(s3Types()[0].input).toMatchObject({ Key: 'org-1/f1', VersionId: 'v1' })
    expect(s3Types()[1].input).toMatchObject({ Key: 'org-1/f1', VersionId: 'm1' })
    expect(store.deleteFileRow).toHaveBeenCalledWith({ tag: 'db' }, WS, 'f1')
  })

  it('refuses a file that is not in the trash', async () => {
    store.getFile.mockResolvedValue(file())
    expect((await permanentDELETE(req('DELETE', '/x'), p('f1'))).status).toBe(404)
    expect(s3Send).not.toHaveBeenCalled()
  })

  it('reports a retention-locked file and keeps its row', async () => {
    store.getFile.mockResolvedValue(trashed())
    s3Send.mockRejectedValue(Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }))
    const res = await permanentDELETE(req('DELETE', '/x'), p('f1'))

    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('locked')
    expect(store.deleteFileRow).not.toHaveBeenCalled()
  })
})

describe('/trash', () => {
  it('lists removed files with when they will be purged', async () => {
    store.listTrash.mockResolvedValue([trashed({ name: 'old.pdf' })])
    const body = await (await trashGET()).json()
    expect(body.files[0]).toMatchObject({ id: 'f1', name: 'old.pdf', purgeAt: new Date(1_800_000_000 * 1000).toISOString() })
  })

  it('empty trash deletes what it can and reports the locked files', async () => {
    store.listTrash.mockResolvedValue([trashed({ fileId: 'a', name: 'a.pdf', versionId: 'va' }), trashed({ fileId: 'b', name: 'b.pdf', versionId: 'vb' })])
    s3Send.mockImplementation(async (cmd: { input: { VersionId?: string } }) => {
      if (cmd.input.VersionId === 'vb') throw Object.assign(new Error('denied'), { name: 'AccessDenied' })
      return {}
    })
    const body = await (await trashDELETE()).json()

    expect(body).toEqual({ deleted: 1, locked: ['b.pdf'] })
    expect(store.deleteFileRow).toHaveBeenCalledTimes(1)
    expect(store.deleteFileRow.mock.calls[0][2]).toBe('a')
  })
})
