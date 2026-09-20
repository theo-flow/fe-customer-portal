import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/aws', () => ({ GATE_KEEP_TABLE: 'tbl' }))
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand:           vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get',      input } }),
  QueryCommand:         vi.fn(function (this: unknown, input: unknown) { return { __type: 'Query',    input } }),
  PutCommand:           vi.fn(function (this: unknown, input: unknown) { return { __type: 'Put',      input } }),
  TransactWriteCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Transact', input } }),
  UpdateCommand:        vi.fn(function (this: unknown, input: unknown) { return { __type: 'Update',   input } }),
}))

import {
  NameTakenError, StaleItemError,
  listFolders, listFolderContents, getFile, getFolder, createFolder, updateFolder, deleteFolderIfEmpty,
  createPendingFile, confirmFile, updateFile, deleteFile, setRetention,
} from '../gate-keep-store'
import { buildFolderItem, buildPendingFile, type FileItem } from '../gate-keep-catalog'

const WS  = 'org-1'
const NOW = Date.UTC(2026, 8, 19, 12)
const db  = { send: vi.fn() }

const cancelled = (...codes: string[]) =>
  Object.assign(new Error('cancelled'), { name: 'TransactionCanceledException', CancellationReasons: codes.map(Code => ({ Code })) })

const sent = () => db.send.mock.calls.map(c => c[0])
const lastTransact = () => sent().filter(c => c.__type === 'Transact').at(-1).input.TransactItems

const readyFile = (over: Partial<FileItem> = {}): FileItem => ({
  ...buildPendingFile(WS, { id: 'f1', folderId: 'root', name: 'a.pdf', contentType: 'application/pdf', size: 5, by: 'u', now: NOW }),
  status: 'READY', versionId: 'v1', GSI1PK: 'WS#org-1#F#root', GSI1SK: 'F#a.pdf#f1', ...over,
}) as FileItem

beforeEach(() => { db.send.mockReset(); db.send.mockResolvedValue({}) })

describe('reads', () => {
  it('listFolders queries only this workspace\'s FOLDER# items and follows pagination', async () => {
    db.send
      .mockResolvedValueOnce({ Items: [{ folderId: 'a' }], LastEvaluatedKey: { PK: 'x', SK: 'y' } })
      .mockResolvedValueOnce({ Items: [{ folderId: 'b' }] })
    const out = await listFolders(db, WS)

    expect(out.map(f => f.folderId)).toEqual(['a', 'b'])
    const q = sent()[0].input
    expect(q.TableName).toBe('tbl')
    expect(q.ExpressionAttributeValues).toEqual({ ':pk': 'WS#org-1', ':p': 'FOLDER#' })
    expect(sent()[1].input.ExclusiveStartKey).toEqual({ PK: 'x', SK: 'y' })
  })

  it('listFolderContents uses the folder index and splits folders from files', async () => {
    db.send.mockResolvedValueOnce({ Items: [{ type: 'FOLDER', folderId: 'd' }, { type: 'FILE', fileId: 'f' }] })
    const { folders, files } = await listFolderContents(db, WS, 'root')

    const q = sent()[0].input
    expect(q.IndexName).toBe('folder-index')
    expect(q.ExpressionAttributeValues[':g']).toBe('WS#org-1#F#root')
    expect(folders).toHaveLength(1)
    expect(files).toHaveLength(1)
  })

  it('getFile reads exactly the caller\'s partition', async () => {
    db.send.mockResolvedValueOnce({ Item: { fileId: 'f1' } })
    await getFile(db, WS, 'f1')
    expect(sent()[0].input.Key).toEqual({ PK: 'WS#org-1', SK: 'FILE#f1' })
  })

  it('point lookups are strongly consistent, so a just-deleted item is never reported as still there', async () => {
    await getFile(db, WS, 'f1')
    await getFolder(db, WS, 'd1')
    expect(sent().map(c => c.input.ConsistentRead)).toEqual([true, true])
  })
})

describe('folders', () => {
  it('createFolder writes the folder and a unique-name lock in one transaction', async () => {
    const item = buildFolderItem(WS, { id: 'f1', parentId: 'root', name: 'Legal', by: 'u', now: NOW })
    await createFolder(db, WS, item)

    const [put, lock] = lastTransact()
    expect(put.Put.Item.SK).toBe('FOLDER#f1')
    expect(put.Put.ConditionExpression).toBe('attribute_not_exists(PK)')
    expect(lock.Put.Item).toMatchObject({ PK: 'WS#org-1', SK: 'NAME#root#legal', targetId: 'f1' })
    expect(lock.Put.ConditionExpression).toBe('attribute_not_exists(PK)')
  })

  it('createFolder reports a name clash', async () => {
    db.send.mockRejectedValueOnce(cancelled('None', 'ConditionalCheckFailed'))
    const item = buildFolderItem(WS, { id: 'f1', parentId: 'root', name: 'Legal', by: 'u', now: NOW })
    await expect(createFolder(db, WS, item)).rejects.toBeInstanceOf(NameTakenError)
  })

  it('updateFolder swaps the name lock and re-indexes the folder', async () => {
    const folder = buildFolderItem(WS, { id: 'f1', parentId: 'root', name: 'Legal', by: 'u', now: NOW })
    await updateFolder(db, WS, folder, { name: 'Contracts', parentId: 'p2' })

    const ops = lastTransact()
    expect(ops[0].Delete.Key).toEqual({ PK: 'WS#org-1', SK: 'NAME#root#legal' })
    expect(ops[1].Put.Item.SK).toBe('NAME#p2#contracts')
    expect(ops[2].Update.Key).toEqual({ PK: 'WS#org-1', SK: 'FOLDER#f1' })
    expect(ops[2].Update.ExpressionAttributeValues).toMatchObject({
      ':name': 'Contracts', ':pid': 'p2', ':g1p': 'WS#org-1#F#p2', ':g1s': 'D#contracts',
    })
  })

  it('a case-only rename keeps the same lock (no delete+put of one item in a transaction)', async () => {
    const folder = buildFolderItem(WS, { id: 'f1', parentId: 'root', name: 'legal', by: 'u', now: NOW })
    await updateFolder(db, WS, folder, { name: 'Legal', parentId: 'root' })
    const ops = lastTransact()
    expect(ops).toHaveLength(1)
    expect(ops[0].Update).toBeDefined()
  })

  it('updateFolder reports a name clash at the destination', async () => {
    db.send.mockRejectedValueOnce(cancelled('None', 'ConditionalCheckFailed', 'None'))
    const folder = buildFolderItem(WS, { id: 'f1', parentId: 'root', name: 'Legal', by: 'u', now: NOW })
    await expect(updateFolder(db, WS, folder, { name: 'Contracts', parentId: 'root' })).rejects.toBeInstanceOf(NameTakenError)
  })

  it('deleteFolderIfEmpty refuses a folder that still has contents', async () => {
    db.send.mockResolvedValueOnce({ Items: [{ fileId: 'x' }] })
    const folder = buildFolderItem(WS, { id: 'f1', parentId: 'root', name: 'Legal', by: 'u', now: NOW })
    expect(await deleteFolderIfEmpty(db, WS, folder)).toBe(false)
    expect(sent().some(c => c.__type === 'Transact')).toBe(false)
  })

  it('deleteFolderIfEmpty removes the folder and its name lock together', async () => {
    db.send.mockResolvedValueOnce({ Items: [] })
    const folder = buildFolderItem(WS, { id: 'f1', parentId: 'root', name: 'Legal', by: 'u', now: NOW })
    expect(await deleteFolderIfEmpty(db, WS, folder)).toBe(true)
    const ops = lastTransact()
    expect(ops.map((o: Record<string, { Key: { SK: string } }>) => o.Delete.Key.SK)).toEqual(['FOLDER#f1', 'NAME#root#legal'])
  })
})

describe('uploads', () => {
  it('createPendingFile puts a single new row', async () => {
    const item = buildPendingFile(WS, { id: 'f1', folderId: 'root', name: 'a.pdf', contentType: 'application/pdf', size: 5, by: 'u', now: NOW })
    await createPendingFile(db, WS, item)
    expect(sent()[0].input.ConditionExpression).toBe('attribute_not_exists(PK)')
    expect(sent()[0].input.Item.status).toBe('PENDING')
  })

  it('confirmFile lists the file and locks its name in one transaction', async () => {
    const pending = buildPendingFile(WS, { id: 'f1', folderId: 'root', name: 'a.pdf', contentType: 'application/pdf', size: 5, by: 'u', now: NOW })
    const out = await confirmFile(db, WS, pending, { folderId: 'root', versionId: 'v9', size: 7 })

    expect(out.name).toBe('a.pdf')
    const [upd, lock] = lastTransact()
    expect(upd.Update.ConditionExpression).toContain('#st = :pending')
    expect(upd.Update.UpdateExpression).toContain('REMOVE purgeAt')
    expect(upd.Update.ExpressionAttributeValues).toMatchObject({ ':v': 'v9', ':sz': 7, ':g1p': 'WS#org-1#F#root' })
    expect(lock.Put.Item.SK).toBe('NAME#root#a.pdf')
  })

  it('confirmFile picks the next free name when the name is taken', async () => {
    db.send.mockRejectedValueOnce(cancelled('None', 'ConditionalCheckFailed'))
    const pending = buildPendingFile(WS, { id: 'f1', folderId: 'root', name: 'a.pdf', contentType: 'application/pdf', size: 5, by: 'u', now: NOW })
    const out = await confirmFile(db, WS, pending, { folderId: 'root', versionId: 'v9', size: 7 })
    expect(out.name).toBe('a (1).pdf')
    expect(lastTransact()[1].Put.Item.SK).toBe('NAME#root#a (1).pdf')
  })

  it('confirmFile refuses a row that is not pending', async () => {
    db.send.mockRejectedValueOnce(cancelled('ConditionalCheckFailed', 'None'))
    const pending = buildPendingFile(WS, { id: 'f1', folderId: 'root', name: 'a.pdf', contentType: 'application/pdf', size: 5, by: 'u', now: NOW })
    await expect(confirmFile(db, WS, pending, { folderId: 'root', versionId: 'v', size: 1 })).rejects.toBeInstanceOf(StaleItemError)
  })
})

describe('rename / move file', () => {
  it('updateFile swaps the lock and re-indexes', async () => {
    await updateFile(db, WS, readyFile(), { name: 'b.pdf', folderId: 'p2' })
    const ops = lastTransact()
    expect(ops[0].Delete.Key.SK).toBe('NAME#root#a.pdf')
    expect(ops[1].Put.Item.SK).toBe('NAME#p2#b.pdf')
    expect(ops[2].Update.ExpressionAttributeValues).toMatchObject({ ':name': 'b.pdf', ':fid': 'p2', ':g1s': 'F#b.pdf#f1' })
  })

  it('a clash is reported, not silently renamed', async () => {
    db.send.mockRejectedValueOnce(cancelled('None', 'ConditionalCheckFailed', 'None'))
    await expect(updateFile(db, WS, readyFile(), { name: 'b.pdf', folderId: 'root' })).rejects.toBeInstanceOf(NameTakenError)
  })
})

describe('delete file', () => {
  it('deleteFile removes the row and frees the name in one transaction', async () => {
    await deleteFile(db, WS, readyFile())

    const [row, lock] = lastTransact()
    expect(row.Delete.Key).toEqual({ PK: 'WS#org-1', SK: 'FILE#f1' })
    expect(row.Delete.ConditionExpression).toBe('#st = :ready')
    expect(row.Delete.ExpressionAttributeValues).toEqual({ ':ready': 'READY' })
    expect(lock.Delete.Key).toEqual({ PK: 'WS#org-1', SK: 'NAME#root#a.pdf' })
  })

  it('leaves nothing behind: no trash keys, no retention clock', async () => {
    await deleteFile(db, WS, readyFile())
    expect(JSON.stringify(lastTransact())).not.toMatch(/TRASH|deletedAt|purgeAt|GSI2/)
  })

  it('a row that is gone or not READY is a stale-item error', async () => {
    db.send.mockRejectedValueOnce(cancelled('ConditionalCheckFailed', 'None'))
    await expect(deleteFile(db, WS, readyFile())).rejects.toBeInstanceOf(StaleItemError)
  })
})

describe('setRetention', () => {
  const until = new Date('2033-09-20T00:00:00.000Z')

  it('records the date on the file row, and only ever moves it later', async () => {
    await setRetention(db, WS, readyFile(), until)

    const u = sent()[0].input
    expect(u.Key).toEqual({ PK: 'WS#org-1', SK: 'FILE#f1' })
    expect(u.UpdateExpression).toBe('SET retainUntil = :u')
    expect(u.ConditionExpression).toBe('#st = :ready AND (attribute_not_exists(retainUntil) OR retainUntil < :u)')
    expect(u.ExpressionAttributeValues).toEqual({ ':u': '2033-09-20T00:00:00.000Z', ':ready': 'READY' })
  })

  it('a stale or shorter date is a stale-item error, not a silent overwrite', async () => {
    db.send.mockRejectedValueOnce(Object.assign(new Error('c'), { name: 'ConditionalCheckFailedException' }))
    await expect(setRetention(db, WS, readyFile(), until)).rejects.toBeInstanceOf(StaleItemError)
  })

  it('any other failure is not swallowed', async () => {
    db.send.mockRejectedValueOnce(new Error('ddb down'))
    await expect(setRetention(db, WS, readyFile(), until)).rejects.toThrow('ddb down')
  })
})

describe('an agreed end-of-life period', () => {
  const pending = () => buildPendingFile(WS, { id: 'f1', folderId: 'root', name: 'a.pdf', contentType: 'application/pdf', size: 5, by: 'u', now: NOW })
  const EOL = 1_950_000_000

  it('gives the confirmed file AND its name lock the same TTL, and drops the abandoned-upload TTL', async () => {
    await confirmFile(db, WS, pending(), { folderId: 'root', versionId: 'v9', size: 7, purgeAt: EOL })

    const [upd, lock] = lastTransact()
    expect(upd.Update.UpdateExpression).toContain(', purgeAt = :eol')
    expect(upd.Update.UpdateExpression).not.toContain('REMOVE purgeAt')
    expect(upd.Update.ExpressionAttributeValues[':eol']).toBe(EOL)
    expect(lock.Put.Item.purgeAt).toBe(EOL)
  })

  it('with NO agreement the file keeps no TTL at all (it is never expired)', async () => {
    await confirmFile(db, WS, pending(), { folderId: 'root', versionId: 'v9', size: 7 })

    const [upd, lock] = lastTransact()
    expect(upd.Update.UpdateExpression).toContain('REMOVE purgeAt')
    expect(upd.Update.UpdateExpression).not.toContain(':eol')
    expect(upd.Update.ExpressionAttributeValues).not.toHaveProperty(':eol')
    expect(lock.Put.Item).not.toHaveProperty('purgeAt')
  })

  it('a rename or move keeps the end-of-life time on the file\'s new name lock', async () => {
    await updateFile(db, WS, readyFile({ purgeAt: EOL }), { name: 'b.pdf', folderId: 'p2' })
    const ops = lastTransact()
    expect(ops[1].Put.Item).toMatchObject({ SK: 'NAME#p2#b.pdf', purgeAt: EOL })
  })

  it('a file with no agreement gets a plain name lock when renamed', async () => {
    // a confirmed file has no TTL at all (confirming removes the abandoned-upload one)
    await updateFile(db, WS, readyFile({ purgeAt: undefined }), { name: 'b.pdf', folderId: 'p2' })
    expect(lastTransact()[1].Put.Item).not.toHaveProperty('purgeAt')
  })
})
