import {
  DeleteObjectCommand, ListObjectVersionsCommand, S3Client, type ListObjectVersionsCommandOutput,
} from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  BatchWriteCommand, DynamoDBDocumentClient, PutCommand, QueryCommand,
} from '@aws-sdk/lib-dynamodb'
import { AssumeRoleCommand } from '@aws-sdk/client-sts'
import { randomUUID } from 'crypto'
import {
  GATE_KEEP_BUCKET, GATE_KEEP_ERASURE_LOG_TABLE, GATE_KEEP_ERASURE_ROLE_ARN, GATE_KEEP_TABLE, stsClient,
} from '@/lib/aws'

// Operator-run erasure of one workspace's Gate-Keep data (POPIA request, account
// closure). Product rule: the platform never deletes user files on its own, so this
// is deliberate, operator-initiated, scoped to ONE workspace, and always recorded.
//
// Containment lives in AWS, not in this code: the portal's own role cannot touch the
// archive at all. It assumes a dedicated role (infrastructure/terraform/gate-keep/
// erasure.tf) tagged with the workspace, and every permission on that role is scoped to
// that tag. That role cannot bypass an Object Lock, so a locked version is reported
// and left alone, never forced.

const REGION = process.env.AWS_REGION ?? 'af-south-1'

// Longest a single request may spend deleting before it stops and reports progress.
// The operator runs it again to continue; each run is idempotent.
export const DEFAULT_BUDGET_MS = 20_000
const CONCURRENCY = 10

// A workspace id is an org id or (for a personal account) a user sub. Anything with a
// "#" or "/" could reach into another partition or prefix, so the format is strict.
const WORKSPACE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
export const isValidWorkspaceId = (ws: unknown): ws is string => typeof ws === 'string' && WORKSPACE_ID.test(ws)

export const MIN_REASON_LENGTH = 10
export const MAX_REASON_LENGTH = 500

export interface Clients { s3: S3Client; db: DynamoDBDocumentClient }

// Minimal shapes so the logic can be tested without AWS. Method syntax (not a property)
// so the real, overloaded SDK clients fit.
interface Sender {
  send(command: any): Promise<any>   // eslint-disable-line @typescript-eslint/no-explicit-any
}
type S3Like = Sender
type DbLike = Sender
export interface ClientsLike { s3: S3Like; db: DbLike }

// ── Credentials ─────────────────────────────────────────────────────────────

const sessionName = (operatorEmail: string) =>
  `erasure-${operatorEmail.replace(/[^\w+=,.@-]/g, '_')}`.slice(0, 64)

// Short-lived credentials for exactly one workspace. The session tag is what the
// role's policy keys every permission on.
export async function assumeErasureClients(ws: string, operatorEmail: string): Promise<Clients> {
  const res = await stsClient().send(new AssumeRoleCommand({
    RoleArn:         GATE_KEEP_ERASURE_ROLE_ARN,
    RoleSessionName: sessionName(operatorEmail),
    DurationSeconds: 900,
    Tags:            [{ Key: 'orgId', Value: ws }],
  }))
  const c = res.Credentials
  if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) throw new Error('Failed to assume the erasure role')

  const credentials = { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken }
  return {
    s3: new S3Client({ region: REGION, credentials }),
    db: DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION, credentials })),
  }
}

// ── Reading what exists ─────────────────────────────────────────────────────

interface VersionRef { key: string; versionId: string; size: number; isMarker: boolean }

async function* listVersions(s3: S3Like, ws: string): AsyncGenerator<VersionRef[]> {
  let keyMarker: string | undefined
  let versionIdMarker: string | undefined
  do {
    const res: ListObjectVersionsCommandOutput = await s3.send(new ListObjectVersionsCommand({
      Bucket: GATE_KEEP_BUCKET, Prefix: `${ws}/`, KeyMarker: keyMarker, VersionIdMarker: versionIdMarker,
    }))
    yield [
      ...(res.Versions ?? []).map(v => ({ key: v.Key!, versionId: v.VersionId!, size: v.Size ?? 0, isMarker: false })),
      ...(res.DeleteMarkers ?? []).map(m => ({ key: m.Key!, versionId: m.VersionId!, size: 0, isMarker: true })),
    ]
    keyMarker = res.IsTruncated ? res.NextKeyMarker : undefined
    versionIdMarker = res.IsTruncated ? res.NextVersionIdMarker : undefined
  } while (keyMarker !== undefined || versionIdMarker !== undefined)
}

interface CatalogueRow { PK: string; SK: string; type?: string; fileId?: string; targetId?: string }

async function catalogueRows(db: DbLike, ws: string): Promise<CatalogueRow[]> {
  const out: CatalogueRow[] = []
  let key: Record<string, unknown> | undefined
  do {
    const res = await db.send(new QueryCommand({
      TableName: GATE_KEEP_TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `WS#${ws}` },
      ExclusiveStartKey: key,
    }))
    out.push(...((res.Items ?? []) as CatalogueRow[]))
    key = res.LastEvaluatedKey
  } while (key)
  return out
}

export interface Inventory {
  objectVersions: number
  deleteMarkers:  number
  bytes:          number
  files:          number
  folders:        number
}

// What an erasure would remove. Read-only.
export async function inventory(clients: ClientsLike, ws: string): Promise<Inventory> {
  const inv: Inventory = { objectVersions: 0, deleteMarkers: 0, bytes: 0, files: 0, folders: 0 }
  for await (const page of listVersions(clients.s3, ws)) {
    for (const v of page) {
      if (v.isMarker) inv.deleteMarkers++
      else { inv.objectVersions++; inv.bytes += v.size }
    }
  }
  for (const row of await catalogueRows(clients.db, ws)) {
    if (row.type === 'FILE') inv.files++
    else if (row.type === 'FOLDER') inv.folders++
  }
  return inv
}

export const isEmpty = (i: Inventory) =>
  i.objectVersions === 0 && i.deleteMarkers === 0 && i.files === 0 && i.folders === 0

// ── The record (insert-only) ────────────────────────────────────────────────

export interface ErasureRecord {
  erasureId:     string
  phase:         'STARTED' | 'COMPLETED' | 'INCOMPLETE'
  operatorSub:   string
  operatorEmail: string
  reason:        string
  before?:       Inventory
  result?:       ErasureResult
}

// Each event is its own item and none is ever updated, so the log reads as a history.
// The erasure role can only PutItem here (and the condition makes a clash fail).
async function writeRecord(db: DbLike, ws: string, r: ErasureRecord): Promise<void> {
  const at = new Date().toISOString()
  await db.send(new PutCommand({
    TableName: GATE_KEEP_ERASURE_LOG_TABLE,
    Item: { PK: `WS#${ws}`, SK: `ERASURE#${at}#${r.erasureId}#${r.phase}`, at, workspaceId: ws, ...r },
    ConditionExpression: 'attribute_not_exists(PK)',
  }))
}

// ── Erasing ─────────────────────────────────────────────────────────────────

export interface ErasureResult {
  complete:         boolean      // false when this run ran out of time; run it again
  versionsDeleted:  number
  markersDeleted:   number
  bytesDeleted:     number
  locked:           number       // versions S3 refused to delete (Object Lock); left in place
  catalogueRemoved: number
  foldersKept:      number       // kept only while a locked file remains
}

const isForbidden = (err: unknown) => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
  return e?.name === 'AccessDenied' || e?.$metadata?.httpStatusCode === 403
}

async function inPool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await work(items[next++])
  }))
}

async function deleteRows(db: DbLike, rows: CatalogueRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 25) {
    let pending = rows.slice(i, i + 25).map(r => ({ DeleteRequest: { Key: { PK: r.PK, SK: r.SK } } }))
    for (let attempt = 0; pending.length > 0; attempt++) {
      if (attempt >= 5) throw new Error('Could not remove every catalogue row')
      const res = await db.send(new BatchWriteCommand({ RequestItems: { [GATE_KEEP_TABLE]: pending } }))
      pending = (res.UnprocessedItems?.[GATE_KEEP_TABLE] ?? []) as typeof pending
    }
  }
}

export interface EraseParams {
  ws:            string
  operatorSub:   string
  operatorEmail: string
  reason:        string
  budgetMs?:     number
  now?:          () => number
}

// Deletes every S3 version and delete marker under the workspace's prefix, then its
// catalogue partition. Fails closed: if the STARTED record cannot be written, nothing
// is deleted. A version under Object Lock is counted and left; while any remain, the
// folders and those files' rows are kept so the owner can still see what is left.
export async function eraseWorkspace(clients: ClientsLike, p: EraseParams): Promise<ErasureResult> {
  const { s3, db } = clients
  const now = p.now ?? Date.now
  const deadline = now() + (p.budgetMs ?? DEFAULT_BUDGET_MS)
  const erasureId = randomUUID()
  const who = { erasureId, operatorSub: p.operatorSub, operatorEmail: p.operatorEmail, reason: p.reason }

  const before = await inventory({ s3, db }, p.ws)
  await writeRecord(db, p.ws, { ...who, phase: 'STARTED', before })

  const result: ErasureResult = {
    complete: false, versionsDeleted: 0, markersDeleted: 0, bytesDeleted: 0, locked: 0, catalogueRemoved: 0, foldersKept: 0,
  }
  const lockedFileIds = new Set<string>()
  let ranOut = false

  scan:
  for await (const page of listVersions(s3, p.ws)) {
    await inPool(page, CONCURRENCY, async v => {
      if (now() > deadline) { ranOut = true; return }
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: GATE_KEEP_BUCKET, Key: v.key, VersionId: v.versionId }))
        if (v.isMarker) result.markersDeleted++
        else { result.versionsDeleted++; result.bytesDeleted += v.size }
      } catch (err) {
        if (!isForbidden(err)) throw err
        result.locked++
        lockedFileIds.add(v.key.slice(p.ws.length + 1))
      }
    })
    if (ranOut) break scan
  }

  // The catalogue goes last, and only once S3 has been fully worked through.
  if (!ranOut) {
    const rows = await catalogueRows(db, p.ws)
    const folderIds = new Set(rows.filter(r => r.type === 'FOLDER').map(r => r.SK.slice('FOLDER#'.length)))
    const keep = (r: CatalogueRow) => {
      if (lockedFileIds.size === 0) return false                             // nothing left: remove it all
      if (r.type === 'FOLDER') return true                                   // the parents of what is left
      if (r.type === 'FILE') return lockedFileIds.has(r.fileId ?? '')
      if (r.type === 'NAME') return !!r.targetId && (lockedFileIds.has(r.targetId) || folderIds.has(r.targetId))
      return false
    }
    const gone = rows.filter(r => !keep(r))
    await deleteRows(db, gone)
    result.catalogueRemoved = gone.length
    result.foldersKept = rows.filter(r => r.type === 'FOLDER' && keep(r)).length
    result.complete = true
  }

  const phase = !result.complete ? 'INCOMPLETE' : 'COMPLETED'
  try {
    await writeRecord(db, p.ws, { ...who, phase, before, result })
  } catch (err) {
    // The data is already gone; report the failure to record it loudly rather than hide it.
    console.error('[gate-keep-erasure] Erased but could not write the completion record', { ws: p.ws, erasureId, error: err })
    throw new Error('The erasure ran but its completion record could not be written. Check the logs.')
  }
  return result
}

// ── History ─────────────────────────────────────────────────────────────────

export interface ErasureLogEntry {
  at: string; erasureId: string; phase: string; operatorEmail: string; reason: string
  before?: Inventory; result?: ErasureResult
}

export async function listErasures(db: DbLike, ws: string): Promise<ErasureLogEntry[]> {
  const res = await db.send(new QueryCommand({
    TableName: GATE_KEEP_ERASURE_LOG_TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `WS#${ws}` },
    ScanIndexForward: false,
    Limit: 50,
  }))
  return (res.Items ?? []) as ErasureLogEntry[]
}
