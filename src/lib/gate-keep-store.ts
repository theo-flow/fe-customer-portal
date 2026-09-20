import {
  GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand, type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb'
import { GATE_KEEP_TABLE } from '@/lib/aws'
import {
  fileSk, folderIndexKeys, folderIndexPk, folderSk, nameLockSk, suffixName,
  wsPk, type FileItem, type FolderItem,
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

// purgeAt (epoch seconds, a DynamoDB TTL) is set only for a file with an agreed end of life, on the
// file row AND its name lock, so both disappear together with the file.
const lockPut = (ws: string, parentId: string, name: string, targetId: string, purgeAt?: number): Op => ({
  Put: {
    TableName: T,
    Item: { PK: wsPk(ws), SK: nameLockSk(parentId, name), type: 'NAME', targetId, ...(purgeAt ? { purgeAt } : {}) },
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

// Point lookups are strongly consistent: they decide whether a change is allowed, and a user
// who has just deleted or renamed something must not be told it is still there.
export async function getFolder(db: Db, ws: string, id: string): Promise<FolderItem | null> {
  const res = await db.send(new GetCommand({ TableName: T, Key: { PK: wsPk(ws), SK: folderSk(id) }, ConsistentRead: true }))
  return (res.Item as FolderItem | undefined) ?? null
}

export async function getFile(db: Db, ws: string, id: string): Promise<FileItem | null> {
  const res = await db.send(new GetCommand({ TableName: T, Key: { PK: wsPk(ws), SK: fileSk(id) }, ConsistentRead: true }))
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
  db: Db, ws: string, folder: FolderItem, to: { name: string; parentId: string; ownerId?: string | null },
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
      // ownerId: a string sets it, null clears it, undefined leaves it alone.
      UpdateExpression: 'SET #n = :name, parentId = :pid, GSI1PK = :g1p, GSI1SK = :g1s'
        + (typeof to.ownerId === 'string' ? ', ownerId = :own' : '')
        + (to.ownerId === null ? ' REMOVE ownerId' : ''),
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: {
        ':name': to.name, ':pid': to.parentId, ':g1p': keys.GSI1PK, ':g1s': keys.GSI1SK,
        ...(typeof to.ownerId === 'string' ? { ':own': to.ownerId } : {}),
      },
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
  db: Db, ws: string, file: FileItem, a: { folderId: string; versionId: string; size: number; purgeAt?: number },
): Promise<{ name: string }> {
  return tryNames(withSuffixes([file.name], file.name), async name => {
    const keys = folderIndexKeys(ws, a.folderId, name, 'file', file.fileId)
    await transact(db, [
      {
        Update: {
          TableName: T,
          Key: { PK: wsPk(ws), SK: fileSk(file.fileId) },
          UpdateExpression:
            'SET #st = :ready, versionId = :v, #sz = :sz, #n = :name, folderId = :fid, GSI1PK = :g1p, GSI1SK = :g1s'
            // An abandoned-upload TTL goes; a file with an agreed end of life gets that TTL instead.
            + (a.purgeAt ? ', purgeAt = :eol' : ' REMOVE purgeAt'),
          ConditionExpression: '#st = :pending',
          ExpressionAttributeNames: { '#st': 'status', '#sz': 'size', '#n': 'name' },
          ExpressionAttributeValues: {
            ':ready': 'READY', ':pending': 'PENDING', ':v': a.versionId, ':sz': a.size,
            ':name': name, ':fid': a.folderId, ':g1p': keys.GSI1PK, ':g1s': keys.GSI1SK,
            ...(a.purgeAt ? { ':eol': a.purgeAt } : {}),
          },
        },
      },
      lockPut(ws, a.folderId, name, file.fileId, a.purgeAt),
    ])
    return { name }
  })
}

// ── Rename / move / delete ──────────────────────────────────────────────────

export async function updateFile(
  db: Db, ws: string, file: FileItem, to: { name: string; folderId: string },
): Promise<void> {
  const oldLock = nameLockSk(file.folderId, file.name)
  const newLock = nameLockSk(to.folderId, to.name)
  const keys = folderIndexKeys(ws, to.folderId, to.name, 'file', file.fileId)

  const ops: Op[] = []
  if (oldLock !== newLock) {
    ops.push(lockDelete(ws, file.folderId, file.name), lockPut(ws, to.folderId, to.name, file.fileId, file.purgeAt))
  }
  ops.push({
    Update: {
      TableName: T,
      Key: { PK: wsPk(ws), SK: fileSk(file.fileId) },
      UpdateExpression: 'SET #n = :name, folderId = :fid, GSI1PK = :g1p, GSI1SK = :g1s',
      ConditionExpression: '#st = :ready',
      ExpressionAttributeNames: { '#n': 'name', '#st': 'status' },
      ExpressionAttributeValues: { ':name': to.name, ':fid': to.folderId, ':ready': 'READY', ':g1p': keys.GSI1PK, ':g1s': keys.GSI1SK },
    },
  })
  await transact(db, ops)
}

// Removes a file's catalogue row and its unique-name lock, after its bytes were
// deleted from S3. This is the user's own delete: final, with nothing kept behind.
export async function deleteFile(db: Db, ws: string, file: FileItem): Promise<void> {
  await transact(db, [
    {
      Delete: {
        TableName: T,
        Key: { PK: wsPk(ws), SK: fileSk(file.fileId) },
        ConditionExpression: '#st = :ready',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: { ':ready': 'READY' },
      },
    },
    lockDelete(ws, file.folderId, file.name),
  ])
}

// Records the protection date of a file whose Object Lock has already been set in S3.
// Only ever moves the date later, so a stale or repeated call cannot shorten it.
export async function setRetention(db: Db, ws: string, file: FileItem, until: Date): Promise<void> {
  try {
    await db.send(new UpdateCommand({
      TableName: T,
      Key: { PK: wsPk(ws), SK: fileSk(file.fileId) },
      UpdateExpression: 'SET retainUntil = :u',
      ConditionExpression: '#st = :ready AND (attribute_not_exists(retainUntil) OR retainUntil < :u)',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':u': until.toISOString(), ':ready': 'READY' },
    }))
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') throw new StaleItemError()
    throw err
  }
}
