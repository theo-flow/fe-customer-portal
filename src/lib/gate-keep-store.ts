import {
  DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb'
import { GATE_KEEP_TABLE } from '@/lib/aws'
import {
  fileSk, folderIndexKeys, folderIndexPk, folderSk, nameLockSk, purgeAtFor, restoredName, suffixName,
  trashIndexPk, wsPk, type FileItem, type FolderItem,
} from '@/lib/gate-keep-catalog'

// All DynamoDB access for the Gate-Keep catalogue. Every function takes the
// caller's workspace and a client built from THEIR scoped credentials, so AWS
// itself (dynamodb:LeadingKeys) refuses any other partition even if a key were
// built wrongly. `ws` always comes from the verified login, never from a request.

// Method syntax (not a property) so the real, overloaded DynamoDBDocumentClient.send fits.
export interface Db {
  send(command: any): Promise<any>   // eslint-disable-line @typescript-eslint/no-explicit-any
}

export class NameTakenError extends Error {
  constructor() { super('That name is already used in this folder.') }
}
export class StaleItemError extends Error {
  constructor() { super('The item changed or no longer exists.') }
}

const T = GATE_KEEP_TABLE

type Op = Record<string, any>   // eslint-disable-line @typescript-eslint/no-explicit-any

function cancelReasons(err: unknown): Array<{ Code?: string }> | null {
  const e = err as { name?: string; CancellationReasons?: Array<{ Code?: string }> }
  return e?.name === 'TransactionCanceledException' ? (e.CancellationReasons ?? []) : null
}

// Runs a transaction and turns "a condition failed" into meaningful errors:
// a failed name-lock write means the name is taken; any other failed condition
// means the item was not in the state we expected.
async function transact(db: Db, ops: Op[]): Promise<void> {
  try {
    await db.send(new TransactWriteCommand({ TransactItems: ops }))
  } catch (err) {
    const reasons = cancelReasons(err)
    if (reasons) {
      const lockAt = ops.findIndex(o => o.Put?.Item?.type === 'NAME')
      if (lockAt >= 0 && reasons[lockAt]?.Code === 'ConditionalCheckFailed') throw new NameTakenError()
      if (reasons.some(r => r.Code === 'ConditionalCheckFailed')) throw new StaleItemError()
    }
    throw err
  }
}

const lockPut = (ws: string, parentId: string, name: string, targetId: string): Op => ({
  Put: {
    TableName: T,
    Item: { PK: wsPk(ws), SK: nameLockSk(parentId, name), type: 'NAME', targetId },
    ConditionExpression: 'attribute_not_exists(PK)',
  },
})

const lockDelete = (ws: string, parentId: string, name: string): Op => ({
  Delete: { TableName: T, Key: { PK: wsPk(ws), SK: nameLockSk(parentId, name) } },
})

async function tryNames<R>(candidates: string[], attempt: (name: string) => Promise<R>): Promise<R> {
  for (const name of candidates) {
    try { return await attempt(name) } catch (e) { if (!(e instanceof NameTakenError)) throw e }
  }
  throw new NameTakenError()
}

const withSuffixes = (first: string[], base: string) =>
  [...first, ...Array.from({ length: 20 }, (_, i) => suffixName(base, i + 1))]

async function queryAll<R>(db: Db, base: QueryCommandInput): Promise<R[]> {
  const out: R[] = []
  let key: Record<string, unknown> | undefined
  do {
    const res = await db.send(new QueryCommand({ ...base, ExclusiveStartKey: key }))
    out.push(...((res.Items ?? []) as R[]))
    key = res.LastEvaluatedKey
  } while (key)
  return out
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function listFolders(db: Db, ws: string): Promise<FolderItem[]> {
  return queryAll<FolderItem>(db, {
    TableName: T,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :p)',
    ExpressionAttributeValues: { ':pk': wsPk(ws), ':p': 'FOLDER#' },
  })
}

export async function getFolder(db: Db, ws: string, id: string): Promise<FolderItem | null> {
  const res = await db.send(new GetCommand({ TableName: T, Key: { PK: wsPk(ws), SK: folderSk(id) } }))
  return (res.Item as FolderItem | undefined) ?? null
}

export async function getFile(db: Db, ws: string, id: string): Promise<FileItem | null> {
  const res = await db.send(new GetCommand({ TableName: T, Key: { PK: wsPk(ws), SK: fileSk(id) } }))
  return (res.Item as FileItem | undefined) ?? null
}

export async function listFolderContents(db: Db, ws: string, folderId: string) {
  const items = await queryAll<FolderItem | FileItem>(db, {
    TableName: T,
    IndexName: 'folder-index',
    KeyConditionExpression: 'GSI1PK = :g',
    ExpressionAttributeValues: { ':g': folderIndexPk(ws, folderId) },
  })
  return {
    folders: items.filter((i): i is FolderItem => i.type === 'FOLDER'),
    files:   items.filter((i): i is FileItem => i.type === 'FILE'),
  }
}

export async function listTrash(db: Db, ws: string): Promise<FileItem[]> {
  return queryAll<FileItem>(db, {
    TableName: T,
    IndexName: 'trash-index',
    KeyConditionExpression: 'GSI2PK = :g',
    ExpressionAttributeValues: { ':g': trashIndexPk(ws) },
  })
}

// ── Folders ─────────────────────────────────────────────────────────────────

export async function createFolder(db: Db, ws: string, folder: FolderItem): Promise<void> {
  await transact(db, [
    { Put: { TableName: T, Item: folder, ConditionExpression: 'attribute_not_exists(PK)' } },
    lockPut(ws, folder.parentId, folder.name, folder.folderId),
  ])
}

// Rename and/or move. The unique-name lock moves with the folder; a case-only
// rename keeps the same lock (one transaction cannot touch one item twice).
export async function updateFolder(
  db: Db, ws: string, folder: FolderItem, to: { name: string; parentId: string },
): Promise<void> {
  const oldLock = nameLockSk(folder.parentId, folder.name)
  const newLock = nameLockSk(to.parentId, to.name)
  const keys = folderIndexKeys(ws, to.parentId, to.name, 'folder', folder.folderId)

  const ops: Op[] = []
  if (oldLock !== newLock) {
    ops.push(lockDelete(ws, folder.parentId, folder.name), lockPut(ws, to.parentId, to.name, folder.folderId))
  }
  ops.push({
    Update: {
      TableName: T,
      Key: { PK: wsPk(ws), SK: folderSk(folder.folderId) },
      UpdateExpression: 'SET #n = :name, parentId = :pid, GSI1PK = :g1p, GSI1SK = :g1s',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: { ':name': to.name, ':pid': to.parentId, ':g1p': keys.GSI1PK, ':g1s': keys.GSI1SK },
    },
  })
  await transact(db, ops)
}

// Only an empty folder can be deleted. Returns false when it still has contents.
export async function deleteFolderIfEmpty(db: Db, ws: string, folder: FolderItem): Promise<boolean> {
  const res = await db.send(new QueryCommand({
    TableName: T, IndexName: 'folder-index', Limit: 1,
    KeyConditionExpression: 'GSI1PK = :g',
    ExpressionAttributeValues: { ':g': folderIndexPk(ws, folder.folderId) },
  }))
  if ((res.Items ?? []).length > 0) return false

  await transact(db, [
    { Delete: { TableName: T, Key: { PK: wsPk(ws), SK: folderSk(folder.folderId) } } },
    lockDelete(ws, folder.parentId, folder.name),
  ])
  return true
}

// ── Uploads ─────────────────────────────────────────────────────────────────

export async function createPendingFile(db: Db, _ws: string, file: FileItem): Promise<void> {
  await db.send(new PutCommand({ TableName: T, Item: file, ConditionExpression: 'attribute_not_exists(PK)' }))
}

// Makes an uploaded file visible: lists it in its folder and claims its name,
// in one transaction. If the name is taken, the next free "name (n)" is used.
export async function confirmFile(
  db: Db, ws: string, file: FileItem, a: { folderId: string; versionId: string; size: number },
): Promise<{ name: string }> {
  return tryNames(withSuffixes([file.name], file.name), async name => {
    const keys = folderIndexKeys(ws, a.folderId, name, 'file', file.fileId)
    await transact(db, [
      {
        Update: {
          TableName: T,
          Key: { PK: wsPk(ws), SK: fileSk(file.fileId) },
          UpdateExpression:
            'SET #st = :ready, versionId = :v, #sz = :sz, #n = :name, folderId = :fid, GSI1PK = :g1p, GSI1SK = :g1s REMOVE purgeAt',
          ConditionExpression: '#st = :pending',
          ExpressionAttributeNames: { '#st': 'status', '#sz': 'size', '#n': 'name' },
          ExpressionAttributeValues: {
            ':ready': 'READY', ':pending': 'PENDING', ':v': a.versionId, ':sz': a.size,
            ':name': name, ':fid': a.folderId, ':g1p': keys.GSI1PK, ':g1s': keys.GSI1SK,
          },
        },
      },
      lockPut(ws, a.folderId, name, file.fileId),
    ])
    return { name }
  })
}

// ── Rename / move / remove / restore / delete ───────────────────────────────

export async function updateFile(
  db: Db, ws: string, file: FileItem, to: { name: string; folderId: string },
): Promise<void> {
  const oldLock = nameLockSk(file.folderId, file.name)
  const newLock = nameLockSk(to.folderId, to.name)
  const keys = folderIndexKeys(ws, to.folderId, to.name, 'file', file.fileId)

  const ops: Op[] = []
  if (oldLock !== newLock) {
    ops.push(lockDelete(ws, file.folderId, file.name), lockPut(ws, to.folderId, to.name, file.fileId))
  }
  ops.push({
    Update: {
      TableName: T,
      Key: { PK: wsPk(ws), SK: fileSk(file.fileId) },
      UpdateExpression: 'SET #n = :name, folderId = :fid, GSI1PK = :g1p, GSI1SK = :g1s',
      ConditionExpression: '#st = :ready AND attribute_not_exists(deletedAt)',
      ExpressionAttributeNames: { '#n': 'name', '#st': 'status' },
      ExpressionAttributeValues: { ':name': to.name, ':fid': to.folderId, ':ready': 'READY', ':g1p': keys.GSI1PK, ':g1s': keys.GSI1SK },
    },
  })
  await transact(db, ops)
}

// Records a removal that has already happened in S3 (a delete marker was added).
export async function softDeleteFile(
  db: Db, ws: string, file: FileItem, a: { deleteMarkerVersionId: string; now: number; retainUntilMs?: number },
): Promise<{ purgeAt: number }> {
  const purgeAt = purgeAtFor(a.now, a.retainUntilMs)
  await transact(db, [
    {
      Update: {
        TableName: T,
        Key: { PK: wsPk(ws), SK: fileSk(file.fileId) },
        UpdateExpression:
          'SET deletedAt = :d, deleteMarkerVersionId = :m, purgeAt = :p, GSI2PK = :g2p, GSI2SK = :g2s REMOVE GSI1PK, GSI1SK',
        ConditionExpression: '#st = :ready AND attribute_not_exists(deletedAt)',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: {
          ':d': new Date(a.now).toISOString(), ':m': a.deleteMarkerVersionId, ':p': purgeAt,
          ':g2p': trashIndexPk(ws), ':g2s': new Date(a.now).toISOString(), ':ready': 'READY',
        },
      },
    },
    lockDelete(ws, file.folderId, file.name),
  ])
  return { purgeAt }
}

// Records a restore that has already happened in S3 (the delete marker was removed).
export async function restoreFile(db: Db, ws: string, file: FileItem): Promise<{ name: string }> {
  return tryNames(withSuffixes([file.name, restoredName(file.name)], file.name), async name => {
    const keys = folderIndexKeys(ws, file.folderId, name, 'file', file.fileId)
    await transact(db, [
      {
        Update: {
          TableName: T,
          Key: { PK: wsPk(ws), SK: fileSk(file.fileId) },
          UpdateExpression:
            'SET #n = :name, GSI1PK = :g1p, GSI1SK = :g1s REMOVE deletedAt, deleteMarkerVersionId, purgeAt, GSI2PK, GSI2SK',
          ConditionExpression: 'attribute_exists(deletedAt)',
          ExpressionAttributeNames: { '#n': 'name' },
          ExpressionAttributeValues: { ':name': name, ':g1p': keys.GSI1PK, ':g1s': keys.GSI1SK },
        },
      },
      lockPut(ws, file.folderId, name, file.fileId),
    ])
    return { name }
  })
}

// Removes the catalogue row of a file that is already in the trash.
export async function deleteFileRow(db: Db, ws: string, fileId: string): Promise<void> {
  try {
    await db.send(new DeleteCommand({
      TableName: T,
      Key: { PK: wsPk(ws), SK: fileSk(fileId) },
      ConditionExpression: 'attribute_exists(deletedAt)',
    }))
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') throw new StaleItemError()
    throw err
  }
}
