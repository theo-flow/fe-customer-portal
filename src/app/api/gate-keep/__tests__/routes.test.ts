import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'

const { mockCtx, s3Send, presign, store, audit, orgYears } = vi.hoisted(() => ({
  mockCtx: vi.fn(),
  orgYears: vi.fn(),
  audit:   vi.fn(),
  s3Send:  vi.fn(),
  presign: vi.fn(),
  store: {
    listFolders: vi.fn(), getFolder: vi.fn(), getFile: vi.fn(), listFolderContents: vi.fn(),
    createFolder: vi.fn(), updateFolder: vi.fn(), deleteFolderIfEmpty: vi.fn(),
    createPendingFile: vi.fn(), confirmFile: vi.fn(), updateFile: vi.fn(),
    deleteFile: vi.fn(), setRetention: vi.fn(),
  },
}))

vi.mock('@/lib/gate-keep-context',     () => ({ getGateKeepContext: mockCtx }))
vi.mock('@/lib/audit', () => ({ writeAudit: audit }))
vi.mock('@/lib/org-retention', () => ({ getOrgRetentionYears: orgYears }))
vi.mock('@/lib/gate-keep-credentials', () => ({ getScopedClients: async () => ({ s3: { send: s3Send }, db: { tag: 'db' } }) }))
vi.mock('@/lib/aws', () => ({ GATE_KEEP_BUCKET: 'bkt', GATE_KEEP_TABLE: 'tbl' }))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: presign }))
vi.mock('@aws-sdk/client-s3', () => ({
  HeadObjectCommand:   vi.fn(function (this: unknown, input: unknown) { return { __type: 'Head',   input } }),
  DeleteObjectCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Delete', input } }),
  PutObjectRetentionCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Retain', input } }),
  PutObjectTaggingCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Tag', input } }),
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
import { POST as retentionPOST }           from '../files/[id]/retention/route'

const WS = 'org-1'
const USER = 'user-1'
const p = (id: string) => ({ params: { id } })
const req = (method: string, url: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  })

const file = (over: Record<string, unknown> = {}) => ({
  fileId: 'f1', folderId: 'root', name: 'a.pdf', contentType: 'application/pdf', size: 10, status: 'READY',
  createdAt: '2026-09-19T00:00:00.000Z', createdBy: USER, versionId: 'v1', ...over,
})
const folder = (over: Record<string, unknown> = {}) => ({
  folderId: 'd1', parentId: 'root', name: 'Legal', createdAt: '2026-09-19T00:00:00.000Z', ...over,
})

const s3Types = () => s3Send.mock.calls.map(c => c[0])

// Who is asking. The organisation-wide rules are tested in the second half of this file; the
// first half runs as an admin, who may see and change everything.
const ADMIN  = { sub: USER, email: 'u@example.com', 'custom:role': 'admin' }
const as = (claims: Record<string, unknown>) => ({ token: 't', orgId: WS, userId: claims.sub, claims })

beforeEach(() => {
  vi.clearAllMocks()
  mockCtx.mockResolvedValue(as(ADMIN))
  presign.mockResolvedValue('https://signed.example/url')
  s3Send.mockResolvedValue({})
  orgYears.mockResolvedValue(null)
  store.listFolders.mockResolvedValue([folder()])
  store.listFolderContents.mockResolvedValue({ folders: [], files: [] })
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
      () => retentionPOST(req('POST', '/x', { retainUntil: '2030-01-01' }), p('f1')),
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
    ['missing', null], ['still uploading', file({ status: 'PENDING' })],
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

  it('404s for a missing file or a missing destination', async () => {
    store.getFile.mockResolvedValue(null)
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

describe('DELETE /files/[id] (the user’s own delete)', () => {
  it('deletes the file’s own version in S3 (no delete marker), then drops the catalogue row', async () => {
    store.getFile.mockResolvedValue(file())
    const res = await fileDELETE(req('DELETE', '/x'), p('f1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(s3Send).toHaveBeenCalledTimes(1)
    expect(s3Types()[0]).toMatchObject({ __type: 'Delete', input: { Bucket: 'bkt', Key: 'org-1/f1', VersionId: 'v1' } })
    expect(store.deleteFile).toHaveBeenCalledWith({ tag: 'db' }, WS, expect.objectContaining({ fileId: 'f1' }))
  })

  it('deletes in S3 before touching the catalogue, so a retry can finish the job', async () => {
    store.getFile.mockResolvedValue(file())
    const order: string[] = []
    s3Send.mockImplementation(async () => { order.push('s3'); return {} })
    store.deleteFile.mockImplementation(async () => { order.push('db') })
    await fileDELETE(req('DELETE', '/x'), p('f1'))
    expect(order).toEqual(['s3', 'db'])
  })

  it('a retry after a failed catalogue step succeeds (deleting a gone version is fine)', async () => {
    store.getFile.mockResolvedValue(file())
    store.deleteFile.mockRejectedValueOnce(new Error('ddb down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect((await fileDELETE(req('DELETE', '/x'), p('f1'))).status).toBe(500)
    expect((await fileDELETE(req('DELETE', '/x'), p('f1'))).status).toBe(200)
    expect(store.deleteFile).toHaveBeenCalledTimes(2)
  })

  it('reports a retention-locked file (S3 refuses) and keeps its row', async () => {
    store.getFile.mockResolvedValue(file())
    s3Send.mockRejectedValue(Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }))
    const res = await fileDELETE(req('DELETE', '/x'), p('f1'))

    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('locked')
    expect(store.deleteFile).not.toHaveBeenCalled()
  })

  it('another S3 failure is a clean 500 and the row is kept', async () => {
    store.getFile.mockResolvedValue(file())
    s3Send.mockRejectedValue(new Error('s3 down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await fileDELETE(req('DELETE', '/x'), p('f1'))).status).toBe(500)
    expect(store.deleteFile).not.toHaveBeenCalled()
  })

  it.each([
    ['missing (or in another workspace)', null], ['still uploading', file({ status: 'PENDING' })],
  ])('404s for a file that is %s, without touching S3', async (_label, row) => {
    store.getFile.mockResolvedValue(row)
    expect((await fileDELETE(req('DELETE', '/x'), p('f1'))).status).toBe(404)
    expect(s3Send).not.toHaveBeenCalled()
    expect(store.getFile.mock.calls[0][1]).toBe(WS)
  })
})

describe('the system never deletes on its own', () => {
  it('has no trash, restore or permanent-delete endpoints any more', () => {
    for (const gone of ['../files/[id]/restore/route', '../files/[id]/permanent/route', '../trash/route']) {
      expect(fs.existsSync(path.join(__dirname, `${gone}.ts`))).toBe(false)
    }
  })
})

describe('DELETE /files/[id] on a protected file', () => {
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()

  it('is refused with the date, without touching S3, and the row stays', async () => {
    store.getFile.mockResolvedValue(file({ retainUntil: '2099-03-05T00:00:00.000Z' }))
    const res = await fileDELETE(req('DELETE', '/x'), p('f1'))

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('locked')
    expect(body.message).toBe('This file is protected and cannot be deleted until 5 March 2099.')
    expect(s3Send).not.toHaveBeenCalled()
    expect(store.deleteFile).not.toHaveBeenCalled()
  })

  it('S3 refusing (a lock we did not know about) is reported with the same date', async () => {
    store.getFile.mockResolvedValue(file({ retainUntil: inDays(-1) }))          // our record says expired
    s3Send.mockRejectedValue(Object.assign(new Error('locked'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }))
    const res = await fileDELETE(req('DELETE', '/x'), p('f1'))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('locked')
    expect(store.deleteFile).not.toHaveBeenCalled()
  })

  it('once the protection has expired, the owner can delete it again', async () => {
    store.getFile.mockResolvedValue(file({ retainUntil: inDays(-1) }))
    expect((await fileDELETE(req('DELETE', '/x'), p('f1'))).status).toBe(200)
    expect(store.deleteFile).toHaveBeenCalled()
  })
})

describe('POST /files/[id]/retention', () => {
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()

  it('sets a Governance lock on the file\'s own version, records it, and audits it', async () => {
    store.getFile.mockResolvedValue(file())
    const until = inDays(365)
    const res = await retentionPOST(req('POST', '/x', { retainUntil: until }), p('f1'))

    expect(res.status).toBe(200)
    expect((await res.json()).file).toMatchObject({ id: 'f1', retainUntil: until })
    const put = s3Types()[0]
    expect(put).toMatchObject({ __type: 'Retain', input: { Bucket: 'bkt', Key: 'org-1/f1', VersionId: 'v1' } })
    expect(put.input.Retention.Mode).toBe('GOVERNANCE')
    expect(put.input.Retention.RetainUntilDate.toISOString()).toBe(until)
    expect(store.setRetention.mock.calls[0][3].toISOString()).toBe(until)
    expect(audit).toHaveBeenCalledWith(WS, expect.objectContaining({ sub: USER, email: 'u@example.com' }), 'gate_keep.protected', expect.stringContaining('a.pdf until '))
  })

  it('always Governance, never Compliance, whatever the request says', async () => {
    store.getFile.mockResolvedValue(file())
    await retentionPOST(req('POST', '/x', { retainUntil: inDays(30), Mode: 'COMPLIANCE', mode: 'COMPLIANCE' }), p('f1'))
    expect(s3Types()[0].input.Retention.Mode).toBe('GOVERNANCE')
  })

  it('S3 is changed before the catalogue, so a retry after a failed catalogue step finishes the job', async () => {
    store.getFile.mockResolvedValue(file())
    const order: string[] = []
    s3Send.mockImplementation(async () => { order.push('s3'); return {} })
    store.setRetention.mockImplementation(async () => { order.push('db') })
    await retentionPOST(req('POST', '/x', { retainUntil: inDays(30) }), p('f1'))
    expect(order).toEqual(['s3', 'db'])
  })

  it.each([
    ['a date in the past', -5, 'too_soon'], ['less than a day', 0.2, 'too_soon'], ['beyond ten years', 4000, 'too_far'],
  ])('refuses %s, and changes nothing', async (_l, n, code) => {
    store.getFile.mockResolvedValue(file())
    const res = await retentionPOST(req('POST', '/x', { retainUntil: inDays(n as number) }), p('f1'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(code)
    expect(s3Send).not.toHaveBeenCalled()
    expect(store.setRetention).not.toHaveBeenCalled()
  })

  it('cannot shorten an existing protection', async () => {
    store.getFile.mockResolvedValue(file({ retainUntil: inDays(400) }))
    const res = await retentionPOST(req('POST', '/x', { retainUntil: inDays(200) }), p('f1'))
    expect((await res.json()).error).toBe('cannot_shorten')
    expect(s3Send).not.toHaveBeenCalled()
  })

  it('can extend an existing protection', async () => {
    store.getFile.mockResolvedValue(file({ retainUntil: inDays(400) }))
    expect((await retentionPOST(req('POST', '/x', { retainUntil: inDays(800) }), p('f1'))).status).toBe(200)
  })

  it.each([['missing (or another workspace\u2019s)', null], ['still uploading', file({ status: 'PENDING' })]])(
    '404s for a file that is %s, without touching S3', async (_l, row) => {
      store.getFile.mockResolvedValue(row)
      expect((await retentionPOST(req('POST', '/x', { retainUntil: inDays(30) }), p('f1'))).status).toBe(404)
      expect(s3Send).not.toHaveBeenCalled()
      expect(store.getFile.mock.calls[0][1]).toBe(WS)
    })

  it('an S3 refusal is a clean error and the catalogue is not touched', async () => {
    store.getFile.mockResolvedValue(file())
    s3Send.mockRejectedValue(Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }))
    const res = await retentionPOST(req('POST', '/x', { retainUntil: inDays(30) }), p('f1'))
    expect(res.status).toBe(403)
    expect(store.setRetention).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('needs a request body', async () => {
    store.getFile.mockResolvedValue(file())
    expect((await retentionPOST(req('POST', '/x'), p('f1'))).status).toBe(400)
  })
})

describe('POST /files/[id]/confirm with an agreed end-of-life period', () => {
  // A real pending row carries the 24-hour abandoned-upload TTL.
  const pending = () => file({ status: 'PENDING', versionId: undefined, purgeAt: Math.floor(Date.now() / 1000) + 86_400 })
  const DAY_S = 86_400

  beforeEach(() => {
    store.getFile.mockResolvedValue(pending())
    s3Send.mockResolvedValue({ ContentLength: 5, VersionId: 'v-real' })
    store.confirmFile.mockResolvedValue({ name: 'a.pdf' })
  })

  it('an organisation with NO agreement: no tag, no end-of-life date (its files are never expired)', async () => {
    orgYears.mockResolvedValue(null)
    await confirmPOST(req('POST', '/x'), p('f1'))
    expect(s3Types().some(c => c.__type === 'Tag')).toBe(false)
    expect(store.confirmFile.mock.calls[0][3].purgeAt).toBeUndefined()
  })

  it.each([[5, '5y', 1827], [6, '6y', 2192], [7, '7y', 2557]])(
    'an agreement of %i years tags the exact version %s and dates the rows %i days out', async (years, tag, days) => {
      orgYears.mockResolvedValue(years)
      const before = Math.floor(Date.now() / 1000)
      const res = await confirmPOST(req('POST', '/x'), p('f1'))

      expect(res.status).toBe(200)
      const put = s3Types().find(c => c.__type === 'Tag')
      expect(put.input).toMatchObject({ Bucket: 'bkt', Key: 'org-1/f1', VersionId: 'v-real', Tagging: { TagSet: [{ Key: 'eol', Value: tag }] } })
      const purgeAt = store.confirmFile.mock.calls[0][3].purgeAt
      expect(purgeAt).toBeGreaterThanOrEqual(before + days * DAY_S)
      expect(purgeAt).toBeLessThanOrEqual(before + days * DAY_S + 5)
    })

  it('the response shows the file\'s real end of life, not the pending row\'s 24-hour TTL', async () => {
    orgYears.mockResolvedValue(5)
    const body = await (await confirmPOST(req('POST', '/x'), p('f1'))).json()
    const days = (new Date(body.file.deletesOn).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(1826)
    expect(days).toBeLessThan(1828)
  })

  it('with no agreement the response shows no end of life (never the abandoned-upload TTL)', async () => {
    orgYears.mockResolvedValue(null)
    const body = await (await confirmPOST(req('POST', '/x'), p('f1'))).json()
    expect(body.file.deletesOn).toBeNull()
  })

  it('tags the file BEFORE it is listed, so a failure leaves nothing half done', async () => {
    orgYears.mockResolvedValue(5)
    const order: string[] = []
    s3Send.mockImplementation(async (c: { __type: string }) => { order.push(c.__type); return { ContentLength: 5, VersionId: 'v-real' } })
    store.confirmFile.mockImplementation(async () => { order.push('list'); return { name: 'a.pdf' } })
    await confirmPOST(req('POST', '/x'), p('f1'))
    expect(order).toEqual(['Head', 'Tag', 'list'])
  })

  it('if tagging fails the file is NOT listed (it would outlive the agreement); the upload can be retried', async () => {
    orgYears.mockResolvedValue(5)
    s3Send.mockImplementation(async (c: { __type: string }) => {
      if (c.__type === 'Tag') throw new Error('tagging denied')
      return { ContentLength: 5, VersionId: 'v-real' }
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await confirmPOST(req('POST', '/x'), p('f1'))).status).toBe(500)
    expect(store.confirmFile).not.toHaveBeenCalled()
  })

  it('if the agreement cannot be read the file is NOT listed (never guess "no agreement")', async () => {
    orgYears.mockRejectedValue(new Error('orgs table unavailable'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await confirmPOST(req('POST', '/x'), p('f1'))).status).toBe(500)
    expect(store.confirmFile).not.toHaveBeenCalled()
    expect(s3Types().some(c => c.__type === 'Tag')).toBe(false)
  })

  it('reads the agreement for the caller\'s own organisation, never one from the request', async () => {
    orgYears.mockResolvedValue(7)
    await confirmPOST(req('POST', '/x', { orgId: 'org-2', retentionYears: 1 }), p('f1'))
    expect(orgYears).toHaveBeenCalledWith(WS)
  })
})
