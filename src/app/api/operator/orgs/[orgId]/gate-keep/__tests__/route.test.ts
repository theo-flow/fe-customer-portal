import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { guard, erasure, audit, ddb } = vi.hoisted(() => ({
  guard:   vi.fn(),
  erasure: { assume: vi.fn(), inventory: vi.fn(), erase: vi.fn(), list: vi.fn() },
  audit:   vi.fn(),
  ddb:     { tag: 'portal-ddb' },
}))

vi.mock('@/lib/operator-guard', () => ({ requireOperatorClaims: guard }))
vi.mock('@/lib/audit', () => ({ writeAudit: audit }))
vi.mock('@/lib/aws', () => ({ ddbDocClient: () => ddb }))
vi.mock('@/lib/gate-keep-erasure', async importActual => ({
  ...(await importActual<object>()),
  assumeErasureClients: erasure.assume,
  inventory:            erasure.inventory,
  eraseWorkspace:       erasure.erase,
  listErasures:         erasure.list,
}))

import { GET, POST } from '../route'

const OPERATOR = { sub: 'op-1', email: 'ops@theoflow.example', 'custom:org_id': 'org-ops' }
const CLIENTS = { s3: { tag: 's3' }, db: { tag: 'erasure-db' } }
const INV = { objectVersions: 3, deleteMarkers: 0, bytes: 3000, files: 3, folders: 1 }
const RESULT = { complete: true, versionsDeleted: 3, markersDeleted: 0, bytesDeleted: 3000, locked: 0, catalogueRemoved: 8, foldersKept: 0 }
const ctx = (orgId: string) => ({ params: { orgId } })
const post = (orgId: string, body: unknown) =>
  POST(new NextRequest('http://localhost/api/operator/orgs/x/gate-keep', {
    method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  }), ctx(orgId))
const get = (orgId: string) => GET(new NextRequest('http://localhost/api/operator/orgs/x/gate-keep'), ctx(orgId))
const good = { confirmOrgId: 'org-1', reason: '  POPIA request, ticket 4821  ' }

beforeEach(() => {
  vi.clearAllMocks()
  guard.mockResolvedValue(OPERATOR)
  erasure.assume.mockResolvedValue(CLIENTS)
  erasure.inventory.mockResolvedValue(INV)
  erasure.erase.mockResolvedValue(RESULT)
  erasure.list.mockResolvedValue([])
})

const nothingHappened = () => {
  expect(erasure.assume).not.toHaveBeenCalled()
  expect(erasure.erase).not.toHaveBeenCalled()
  expect(audit).not.toHaveBeenCalled()
}

describe('operator only', () => {
  it.each([[401], [403]])('passes a %i from the guard straight through, and does nothing', async status => {
    guard.mockResolvedValue(NextResponse.json({ error: 'x' }, { status }))
    expect((await get('org-1')).status).toBe(status)
    expect((await post('org-1', good)).status).toBe(status)
    nothingHappened()
  })
})

describe('GET (what an erasure would remove, plus history)', () => {
  it('reads the inventory with the scoped erasure credentials and the history with the portal role', async () => {
    erasure.list.mockResolvedValue([{ erasureId: 'e1', phase: 'COMPLETED' }])
    const res = await get('org-1')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ inventory: INV, history: [{ erasureId: 'e1', phase: 'COMPLETED' }] })
    expect(erasure.assume).toHaveBeenCalledWith('org-1', 'ops@theoflow.example')
    expect(erasure.inventory).toHaveBeenCalledWith(CLIENTS, 'org-1')
    expect(erasure.list).toHaveBeenCalledWith(ddb, 'org-1')
    expect(erasure.erase).not.toHaveBeenCalled()      // reading never erases
  })

  it.each(['WS#org-1', 'org-1/x', '..', 'a b'])('rejects the workspace id %j', async id => {
    expect((await get(id)).status).toBe(400)
    expect(erasure.assume).not.toHaveBeenCalled()
  })

  it('a failure is a clean 500 with no internals', async () => {
    erasure.assume.mockRejectedValue(new Error('arn:aws:iam::922318569961:role/secret exploded'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await get('org-1')
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('922318569961')
  })
})

describe('POST (erase)', () => {
  it('erases the workspace named in the URL, attributed to the signed-in operator, with the trimmed reason', async () => {
    const res = await post('org-1', good)

    expect(res.status).toBe(200)
    expect((await res.json()).result).toEqual(RESULT)
    expect(erasure.assume).toHaveBeenCalledWith('org-1', 'ops@theoflow.example')
    expect(erasure.erase).toHaveBeenCalledWith(CLIENTS, {
      ws: 'org-1', operatorSub: 'op-1', operatorEmail: 'ops@theoflow.example', reason: 'POPIA request, ticket 4821',
    })
  })

  it("records it in the workspace's own activity trail", async () => {
    await post('org-1', good)
    expect(audit).toHaveBeenCalledWith('org-1', OPERATOR, 'gate_keep.erased', 'complete')
  })

  it('an unfinished run is recorded as partial and reported so it can be run again', async () => {
    erasure.erase.mockResolvedValue({ ...RESULT, complete: false })
    const res = await post('org-1', good)
    expect((await res.json()).result.complete).toBe(false)
    expect(audit).toHaveBeenCalledWith('org-1', OPERATOR, 'gate_keep.erased', 'partial')
  })

  it('needs the workspace id typed back exactly', async () => {
    for (const confirmOrgId of ['org-2', 'ORG-1', ' org-1', '', undefined, 1]) {
      const res = await post('org-1', { ...good, confirmOrgId })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('confirmation_mismatch')
    }
    nothingHappened()
  })

  it('needs a real reason', async () => {
    for (const reason of ['', '   ', 'short', undefined, 42]) {
      const res = await post('org-1', { ...good, reason })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('reason_required')
    }
    const long = await post('org-1', { ...good, reason: 'x'.repeat(501) })
    expect((await long.json()).error).toBe('reason_too_long')
    nothingHappened()
  })

  it.each(['not json', 'null', '"a string"'])('rejects the body %s', async body => {
    expect((await post('org-1', body)).status).toBe(400)
    nothingHappened()
  })

  it('rejects a workspace id that could reach another partition or prefix', async () => {
    for (const id of ['WS#org-1', 'org-1/', '../org-2']) {
      expect((await post(id, { confirmOrgId: id, reason: 'POPIA request 1234' })).status).toBe(400)
    }
    nothingHappened()
  })

  it('refuses when there is nothing to erase, and erases nothing', async () => {
    erasure.inventory.mockResolvedValue({ objectVersions: 0, deleteMarkers: 0, bytes: 0, files: 0, folders: 0 })
    const res = await post('org-1', good)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('nothing_to_erase')
    expect(erasure.erase).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('a failure part-way is a clean 500 (no internals), is not recorded as done, and can be repeated', async () => {
    erasure.erase.mockRejectedValue(new Error('table daai-insure-gate-keep-erasures exploded'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await post('org-1', good)

    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('daai-insure')
    expect(audit).not.toHaveBeenCalled()
  })
})
