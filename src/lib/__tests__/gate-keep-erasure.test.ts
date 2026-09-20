import { describe, it, expect, vi, beforeEach } from 'vitest'

const { stsSend, s3Ctor } = vi.hoisted(() => ({ stsSend: vi.fn(), s3Ctor: vi.fn() }))

vi.mock('@/lib/aws', () => ({
  GATE_KEEP_BUCKET: 'bkt', GATE_KEEP_TABLE: 'cat', GATE_KEEP_ERASURE_LOG_TABLE: 'log',
  GATE_KEEP_ERASURE_ROLE_ARN: 'arn:aws:iam::1:role/erasure',
  stsClient: () => ({ send: stsSend }),
}))
vi.mock('@aws-sdk/client-sts', () => ({
  AssumeRoleCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'AssumeRole', input } }),
}))
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function (this: unknown, cfg: unknown) { s3Ctor(cfg) }),
  ListObjectVersionsCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'List',   input } }),
  DeleteObjectCommand:       vi.fn(function (this: unknown, input: unknown) { return { __type: 'Delete', input } }),
}))
vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: vi.fn() }))
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({})) },
  QueryCommand:      vi.fn(function (this: unknown, input: unknown) { return { __type: 'Query',      input } }),
  PutCommand:        vi.fn(function (this: unknown, input: unknown) { return { __type: 'Put',        input } }),
  BatchWriteCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'BatchWrite', input } }),
}))

import {
  assumeErasureClients, eraseWorkspace, inventory, isEmpty, isValidWorkspaceId, listErasures,
} from '../gate-keep-erasure'

const WS = 'org-1'
const OP = { operatorSub: 'op-sub', operatorEmail: 'ops@theoflow.example', reason: 'POPIA request ref 123' }

interface Ver { Key: string; VersionId: string; Size?: number; marker?: boolean; locked?: boolean }
type Row = { PK: string; SK: string; [k: string]: unknown }

// In-memory S3 (versions, delete markers, Object Lock) and catalogue + log tables.
function fakeAws(seed: { versions: Ver[]; rows: Row[]; failLog?: (phase: string) => boolean; pageSize?: number }) {
  const state = { versions: [...seed.versions], rows: [...seed.rows], log: [] as Row[], deletes: 0 }
  const pageSize = seed.pageSize ?? 2
  const s3 = {
    send: vi.fn(async (cmd: { __type: string; input: Record<string, string> }) => {
      if (cmd.__type === 'List') {
        const mine = state.versions.filter(v => v.Key.startsWith(cmd.input.Prefix))
        const start = cmd.input.KeyMarker ? mine.findIndex(v => `${v.Key}|${v.VersionId}` === cmd.input.KeyMarker) : 0
        const page = mine.slice(start, start + pageSize)
        const more = start + pageSize < mine.length
        const next = more ? mine[start + pageSize] : undefined
        return {
          Versions: page.filter(v => !v.marker).map(v => ({ Key: v.Key, VersionId: v.VersionId, Size: v.Size ?? 0 })),
          DeleteMarkers: page.filter(v => v.marker).map(v => ({ Key: v.Key, VersionId: v.VersionId })),
          IsTruncated: more, NextKeyMarker: next && `${next.Key}|${next.VersionId}`, NextVersionIdMarker: next?.VersionId,
        }
      }
      // Delete one version
      const v = state.versions.find(x => x.Key === cmd.input.Key && x.VersionId === cmd.input.VersionId)
      if (v?.locked) throw Object.assign(new Error('locked'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } })
      state.versions = state.versions.filter(x => x !== v)
      state.deletes++
      return {}
    }),
  }
  const db = {
    send: vi.fn(async (cmd: { __type: string; input: Record<string, any> }): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      const i = cmd.input
      if (cmd.__type === 'Query') {
        const table = i.TableName === 'log' ? state.log : state.rows
        return { Items: table.filter(r => r.PK === i.ExpressionAttributeValues[':pk']).map(r => ({ ...r })) }
      }
      if (cmd.__type === 'Put') {
        if (seed.failLog?.(i.Item.phase)) throw new Error('log unavailable')
        if (state.log.some(r => r.PK === i.Item.PK && r.SK === i.Item.SK)) throw new Error('exists')
        state.log.push(i.Item)
        return {}
      }
      const gone = i.RequestItems.cat.map((r: { DeleteRequest: { Key: Row } }) => r.DeleteRequest.Key.SK)
      state.rows = state.rows.filter(r => !gone.includes(r.SK))
      return {}
    }),
  }
  return { state, s3, db }
}

const PK = `WS#${WS}`
const files = (n: number) => Array.from({ length: n }, (_, k) => ({ Key: `${WS}/f${k}`, VersionId: `v${k}`, Size: 1000 }))
const catalogue = (fileIds: string[]): Row[] => [
  { PK, SK: 'FOLDER#d1', type: 'FOLDER', folderId: 'd1' },
  { PK, SK: 'NAME#root#legal', type: 'NAME', targetId: 'd1' },
  ...fileIds.flatMap(id => [
    { PK, SK: `FILE#${id}`, type: 'FILE', fileId: id },
    { PK, SK: `NAME#d1#${id}.pdf`, type: 'NAME', targetId: id },
  ]),
]

beforeEach(() => { vi.clearAllMocks() })

describe('isValidWorkspaceId', () => {
  it.each(['org-1', 'org-6424cb01', 'a1b2c3d4-0000-4000-8000-abcdef012345'])('accepts %s', id => {
    expect(isValidWorkspaceId(id)).toBe(true)
  })
  it.each(['', 'WS#org-1', 'org-1/', '../org-2', 'org 1', 'org-1#x', '-org', 'a'.repeat(65), 5, null, undefined])('rejects %j', id => {
    expect(isValidWorkspaceId(id)).toBe(false)
  })
})

describe('assumeErasureClients', () => {
  it('assumes the erasure role for ONE workspace, briefly, tagged with it', async () => {
    stsSend.mockResolvedValue({ Credentials: { AccessKeyId: 'a', SecretAccessKey: 's', SessionToken: 't' } })
    await assumeErasureClients(WS, 'ops+x@theoflow.example')

    const input = stsSend.mock.calls[0][0].input
    expect(input).toMatchObject({ RoleArn: 'arn:aws:iam::1:role/erasure', DurationSeconds: 900, Tags: [{ Key: 'orgId', Value: WS }] })
    expect(input.RoleSessionName).toMatch(/^erasure-ops\+x@theoflow\.example$/)
    expect(s3Ctor.mock.calls[0][0].credentials).toEqual({ accessKeyId: 'a', secretAccessKey: 's', sessionToken: 't' })
  })

  it('keeps the session name within AWS limits, whatever the email contains', async () => {
    stsSend.mockResolvedValue({ Credentials: { AccessKeyId: 'a', SecretAccessKey: 's', SessionToken: 't' } })
    await assumeErasureClients(WS, `${'x'.repeat(100)} weird<>name@example.com`)
    const name = stsSend.mock.calls[0][0].input.RoleSessionName
    expect(name.length).toBeLessThanOrEqual(64)
    expect(name).toMatch(/^[\w+=,.@-]+$/)
  })

  it('fails if no credentials come back', async () => {
    stsSend.mockResolvedValue({})
    await expect(assumeErasureClients(WS, 'a@b.c')).rejects.toThrow('Failed to assume')
  })
})

describe('inventory', () => {
  it('counts versions, delete markers, bytes, files and folders across pages, without changing anything', async () => {
    const aws = fakeAws({
      versions: [...files(3), { Key: `${WS}/f0`, VersionId: 'm1', marker: true }],
      rows: catalogue(['f0', 'f1', 'f2']),
    })
    const inv = await inventory(aws, WS)

    expect(inv).toEqual({ objectVersions: 3, deleteMarkers: 1, bytes: 3000, files: 3, folders: 1 })
    expect(aws.state.deletes).toBe(0)
    expect(aws.state.log).toHaveLength(0)
  })

  it('only looks under this workspace\'s prefix and partition', async () => {
    const aws = fakeAws({ versions: [...files(1), { Key: 'org-2/x', VersionId: 'v' }], rows: [...catalogue(['f0']), { PK: 'WS#org-2', SK: 'FILE#x', type: 'FILE' }] })
    expect(await inventory(aws, WS)).toMatchObject({ objectVersions: 1, files: 1 })
    expect(aws.s3.send.mock.calls[0][0].input.Prefix).toBe('org-1/')
  })

  it('isEmpty', async () => {
    expect(isEmpty(await inventory(fakeAws({ versions: [], rows: [] }), WS))).toBe(true)
    expect(isEmpty(await inventory(fakeAws({ versions: files(1), rows: [] }), WS))).toBe(false)
  })
})

describe('eraseWorkspace', () => {
  it('deletes every version and delete marker, then the whole catalogue, and records it', async () => {
    const aws = fakeAws({
      versions: [...files(5), { Key: `${WS}/f0`, VersionId: 'm1', marker: true }],
      rows: catalogue(['f0', 'f1', 'f2', 'f3', 'f4']),
    })
    const res = await eraseWorkspace(aws, { ws: WS, ...OP })

    expect(res).toEqual({
      complete: true, versionsDeleted: 5, markersDeleted: 1, bytesDeleted: 5000, locked: 0, catalogueRemoved: 12, foldersKept: 0,
    })
    expect(aws.state.versions).toEqual([])
    expect(aws.state.rows).toEqual([])
  })

  it('deletes each version BY ID (never a plain delete that would only add a marker)', async () => {
    const aws = fakeAws({ versions: files(2), rows: [] })
    await eraseWorkspace(aws, { ws: WS, ...OP })
    const deletes = aws.s3.send.mock.calls.map(c => c[0]).filter(c => c.__type === 'Delete')
    expect(deletes.map(d => d.input)).toEqual([
      { Bucket: 'bkt', Key: 'org-1/f0', VersionId: 'v0' }, { Bucket: 'bkt', Key: 'org-1/f1', VersionId: 'v1' },
    ])
  })

  it('writes an insert-only STARTED record before deleting, then a COMPLETED one, both naming who and why', async () => {
    const real = fakeAws({ versions: files(2), rows: catalogue(['f0', 'f1']) })
    const seen: number[] = []
    const origSend = real.s3.send.getMockImplementation()!
    real.s3.send.mockImplementation(async (cmd: any) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      if (cmd.__type === 'Delete') seen.push(real.state.log.length)
      return origSend(cmd)
    })
    await eraseWorkspace(real, { ws: WS, ...OP })

    expect(seen.every(n => n === 1)).toBe(true)                       // STARTED existed before every delete
    expect(real.state.log.map(r => r.phase)).toEqual(['STARTED', 'COMPLETED'])
    for (const r of real.state.log) {
      expect(r).toMatchObject({ PK, workspaceId: WS, operatorSub: 'op-sub', operatorEmail: 'ops@theoflow.example', reason: 'POPIA request ref 123' })
      expect(r.SK).toMatch(/^ERASURE#\d{4}-.+#[0-9a-f-]{36}#(STARTED|COMPLETED)$/)
    }
    expect(real.state.log[0]).toMatchObject({ before: { objectVersions: 2, files: 2, folders: 1 } })
    expect(real.state.log[1]).toMatchObject({ result: { complete: true, versionsDeleted: 2 } })
    const puts = real.db.send.mock.calls.map(c => c[0]).filter(c => c.__type === 'Put')
    expect(puts.every(p => p.input.ConditionExpression === 'attribute_not_exists(PK)')).toBe(true)
  })

  it('FAILS CLOSED: if the STARTED record cannot be written, nothing is deleted', async () => {
    const aws = fakeAws({ versions: files(3), rows: catalogue(['f0', 'f1', 'f2']), failLog: () => true })
    await expect(eraseWorkspace(aws, { ws: WS, ...OP })).rejects.toThrow('log unavailable')
    expect(aws.state.deletes).toBe(0)
    expect(aws.state.versions).toHaveLength(3)
    expect(aws.state.rows).toHaveLength(8)
  })

  it('reports loudly when the data is gone but the completion record could not be written', async () => {
    const aws = fakeAws({ versions: files(1), rows: [], failLog: p => p === 'COMPLETED' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(eraseWorkspace(aws, { ws: WS, ...OP })).rejects.toThrow('completion record could not be written')
    expect(aws.state.versions).toEqual([])
  })

  it('an Object Lock is respected: the locked version stays, and so do its file row and the folders', async () => {
    const aws = fakeAws({
      versions: [...files(3).map((v, k) => (k === 1 ? { ...v, locked: true } : v))],
      rows: catalogue(['f0', 'f1', 'f2']),
    })
    const res = await eraseWorkspace(aws, { ws: WS, ...OP })

    expect(res).toMatchObject({ complete: true, versionsDeleted: 2, locked: 1, foldersKept: 1 })
    expect(aws.state.versions.map(v => v.Key)).toEqual(['org-1/f1'])
    expect(aws.state.rows.map(r => r.SK).sort()).toEqual(['FILE#f1', 'FOLDER#d1', 'NAME#d1#f1.pdf', 'NAME#root#legal'].sort())
    expect(aws.state.log.at(-1)).toMatchObject({ phase: 'COMPLETED', result: { locked: 1 } })
  })

  it('never uses any way around a lock: only version deletes are issued', async () => {
    const aws = fakeAws({ versions: files(1).map(v => ({ ...v, locked: true })), rows: [] })
    await eraseWorkspace(aws, { ws: WS, ...OP })
    const sent = JSON.stringify(aws.s3.send.mock.calls.map(c => c[0]))
    expect(sent).not.toMatch(/Bypass|Retention|LegalHold/i)
  })

  it('a failure other than a lock is not swallowed', async () => {
    const aws = fakeAws({ versions: files(2), rows: catalogue(['f0', 'f1']) })
    const impl = aws.s3.send.getMockImplementation()!
    aws.s3.send.mockImplementation(async (cmd: any) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      if (cmd.__type === 'Delete') throw new Error('s3 exploded')
      return impl(cmd)
    })
    await expect(eraseWorkspace(aws, { ws: WS, ...OP })).rejects.toThrow('s3 exploded')
    expect(aws.state.rows).toHaveLength(6)      // catalogue untouched
  })

  it('runs out of time cleanly: reports incomplete, keeps the catalogue, and a second run finishes', async () => {
    const aws = fakeAws({ versions: files(6), rows: catalogue(['f0', 'f1', 'f2', 'f3', 'f4', 'f5']), pageSize: 2 })
    let t = 0
    const first = await eraseWorkspace(aws, { ws: WS, ...OP, budgetMs: 3, now: () => t++ })

    expect(first.complete).toBe(false)
    expect(first.catalogueRemoved).toBe(0)
    expect(aws.state.versions.length).toBeGreaterThan(0)
    expect(aws.state.rows).toHaveLength(14)
    expect(aws.state.log.at(-1)).toMatchObject({ phase: 'INCOMPLETE' })

    const second = await eraseWorkspace(aws, { ws: WS, ...OP })
    expect(second.complete).toBe(true)
    expect(aws.state.versions).toEqual([])
    expect(aws.state.rows).toEqual([])
    expect(aws.state.log.map(r => r.phase)).toEqual(['STARTED', 'INCOMPLETE', 'STARTED', 'COMPLETED'])
  })

  it('catalogue rows are removed 25 at a time and unprocessed items are retried', async () => {
    const ids = Array.from({ length: 30 }, (_, k) => `f${k}`)
    const aws = fakeAws({ versions: [], rows: catalogue(ids) })
    const impl = aws.db.send.getMockImplementation()!
    let first = true
    aws.db.send.mockImplementation(async (cmd: any) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      if (cmd.__type === 'BatchWrite' && first) {
        first = false
        const reqs = cmd.input.RequestItems.cat
        await impl({ ...cmd, input: { RequestItems: { cat: reqs.slice(1) } } })
        return { UnprocessedItems: { cat: [reqs[0]] } }
      }
      return impl(cmd)
    })
    await eraseWorkspace(aws, { ws: WS, ...OP })

    expect(aws.state.rows).toEqual([])
    const batches = aws.db.send.mock.calls.map(c => c[0]).filter(c => c.__type === 'BatchWrite')
    expect(Math.max(...batches.map(b => b.input.RequestItems.cat.length))).toBeLessThanOrEqual(25)
  })

  it('cannot touch another workspace, even one whose id starts the same', async () => {
    const aws = fakeAws({
      versions: [...files(1), { Key: 'org-10/x', VersionId: 'v', Size: 5 }],
      rows: [...catalogue(['f0']), { PK: 'WS#org-10', SK: 'FILE#x', type: 'FILE', fileId: 'x' }],
    })
    await eraseWorkspace(aws, { ws: WS, ...OP })
    expect(aws.state.versions.map(v => v.Key)).toEqual(['org-10/x'])
    expect(aws.state.rows.map(r => r.PK)).toEqual(['WS#org-10'])
  })
})

describe('listErasures', () => {
  it('reads the workspace\'s own log, newest first', async () => {
    const aws = fakeAws({ versions: [], rows: [] })
    await listErasures(aws.db, WS)
    const q = aws.db.send.mock.calls[0][0].input
    expect(q).toMatchObject({ TableName: 'log', ScanIndexForward: false, ExpressionAttributeValues: { ':pk': PK } })
  })
})
