import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/aws', () => ({ GATE_KEEP_TABLE: 'tbl' }))
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand:           vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get',      input } }),
  QueryCommand:         vi.fn(function (this: unknown, input: unknown) { return { __type: 'Query',    input } }),
  PutCommand:           vi.fn(function (this: unknown, input: unknown) { return { __type: 'Put',      input } }),
  DeleteCommand:        vi.fn(function (this: unknown, input: unknown) { return { __type: 'Delete',   input } }),
  TransactWriteCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Transact', input } }),
}))

import {
  NameTakenError, StaleItemError,
  listFolders, listFolderContents, getFile, createFolder, updateFolder, deleteFolderIfEmpty,
  createPendingFile, confirmFile, updateFile, softDeleteFile, restoreFile, deleteFileRow, listTrash,
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

  it('listTrash queries the sparse trash index', async () => {
    db.send.mockResolvedValueOnce({ Items: [] })
    await listTrash(db, WS)
    expect(sent()[0].input.IndexName).toBe('trash-index')
    expect(sent()[0].input.ExpressionAttributeValues[':g']).toBe('WS#org-1#TRASH')
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

describe('remove / restore / delete', () => {
  it('softDeleteFile hides the file, starts the 28-day clock, and frees the name', async () => {
    await softDeleteFile(db, WS, readyFile(), { deleteMarkerVersionId: 'm1', now: NOW })

    const [upd, lock] = lastTransact()
    expect(upd.Update.ConditionExpression).toContain('attribute_not_exists(deletedAt)')
    expect(upd.Update.UpdateExpression).toContain('REMOVE GSI1PK, GSI1SK')
    expect(upd.Update.ExpressionAttributeValues).toMatchObject({
      ':m': 'm1', ':g2p': 'WS#org-1#TRASH',
      ':p': Math.floor((NOW + 28 * 24 * 3600 * 1000) / 1000),
    })
    expect(lock.Delete.Key.SK).toBe('NAME#root#a.pdf')
  })

  it('softDeleteFile on an already-removed file is a stale-item error', async () => {
    db.send.mockRejectedValueOnce(cancelled('ConditionalCheckFailed', 'None'))
    await expect(softDeleteFile(db, WS, readyFile(), { deleteMarkerVersionId: 'm1', now: NOW })).rejects.toBeInstanceOf(StaleItemError)
  })

  const removed = (): FileItem => readyFile({ deletedAt: new Date(NOW).toISOString(), deleteMarkerVersionId: 'm1', GSI1PK: undefined, GSI1SK: undefined })

  it('restoreFile brings the file back under its own name when free', async () => {
    const out = await restoreFile(db, WS, removed())
    expect(out.name).toBe('a.pdf')
    const [upd, lock] = lastTransact()
    expect(upd.Update.UpdateExpression).toContain('REMOVE deletedAt')
    expect(upd.Update.UpdateExpression).toContain('GSI2PK')
    expect(lock.Put.Item.SK).toBe('NAME#root#a.pdf')
  })

  it('restoreFile falls back to "(restored)" when the name was reused meanwhile', async () => {
    db.send.mockRejectedValueOnce(cancelled('None', 'ConditionalCheckFailed'))
    const out = await restoreFile(db, WS, removed())
    expect(out.name).toBe('a (restored).pdf')
  })

  it('deleteFileRow only deletes a row that is already in the trash', async () => {
    await deleteFileRow(db, WS, 'f1')
    expect(sent()[0].input.Key).toEqual({ PK: 'WS#org-1', SK: 'FILE#f1' })
    expect(sent()[0].input.ConditionExpression).toBe('attribute_exists(deletedAt)')
  })
})
