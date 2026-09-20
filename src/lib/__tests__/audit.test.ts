import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))

vi.mock('@/lib/aws', () => ({
  ddbDocClient: () => ({ send: mockSend }),
  TABLE:        'daai-insure-orgs',
}))

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  PutCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Put', input } }),
}))

import { readFileSync } from 'node:fs'
import { AUDIT_LABELS, writeAudit, type AuditAction } from '../audit'

const admin = { sub: 'u-1', email: 'boss@org.com', exp: 9999999999, 'custom:org_id': 'org-1', 'custom:role': 'admin' }
const agent = { ...admin, sub: 'u-2', email: 'jane@org.com', 'custom:role': 'agent' }

describe('writeAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockReset()
    mockSend.mockResolvedValue({})
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'))
  })
  afterEach(() => vi.useRealTimers())

  const item = () => mockSend.mock.calls[0][0].input.Item

  it('writes one item in the org\'s own partition, newest sortable by time', async () => {
    await writeAudit('org-1', admin, 'team.invite', 'jane@org.com')

    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(item()).toMatchObject({
      PK: 'ORG#org-1', at: '2026-10-10T12:00:00.000Z', action: 'team.invite', target: 'jane@org.com',
      actorSub: 'u-1', actorEmail: 'boss@org.com', actorRole: 'admin',
    })
    expect(item().SK).toMatch(/^AUDIT#2026-10-10T12:00:00\.000Z#[0-9a-f-]{36}$/)
    expect(item().auditId).toBe(item().SK.split('#')[2])
  })

  it('takes the actor from the verified token and reads a missing role as agent', async () => {
    await writeAudit('org-1', agent, 'submission.view', 'sub-1')
    expect(item()).toMatchObject({ actorSub: 'u-2', actorEmail: 'jane@org.com', actorRole: 'agent' })

    mockSend.mockClear()
    const { 'custom:role': _omit, ...noRole } = admin
    await writeAudit('org-1', noRole, 'submission.view', 'sub-1')
    expect(item().actorRole).toBe('agent')
  })

  it('stores no target when there is none, and caps a long one', async () => {
    await writeAudit('org-1', admin, 'billing.cancel_pilot')
    expect(item().target).toBeNull()

    mockSend.mockClear()
    await writeAudit('org-1', admin, 'form.link_created', 'x'.repeat(500))
    expect(item().target).toHaveLength(200)
  })

  it('never throws, so a failure to record cannot fail the action it describes', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSend.mockRejectedValue(new Error('ddb down'))

    await expect(writeAudit('org-1', admin, 'team.remove', 'x@y.com')).resolves.toBeUndefined()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('gives every action a plain-English label, with no em dashes', () => {
    const actions: AuditAction[] = [
      'team.invite', 'team.joined', 'team.remove', 'team.seats', 'billing.subscribe', 'billing.cancel_pilot',
      'form.publish', 'form.link_created', 'template.upload', 'submission.view', 'submission.export', 'sign.session_started', 'gate_keep.erased',
    ]
    expect(Object.keys(AUDIT_LABELS).sort()).toEqual([...actions].sort())
    for (const label of Object.values(AUDIT_LABELS)) {
      expect(label.length).toBeGreaterThan(5)
      expect(label).not.toMatch(/—|--/)
    }
  })
})

// Next.js cannot bundle node:crypto or the AWS client into a page. Unit tests run in
// Node, where that mistake works fine, so it is only caught by a production build.
// This is that check, made cheap.
describe('browser/server boundary', () => {
  const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf-8')

  it('keeps audit-labels free of any import, so a page can use it', () => {
    expect(source('../audit-labels.ts')).not.toMatch(/^\s*import\s/m)
  })

  it('has the Activity page import the browser-safe file and never the recorder', () => {
    const page = source('../../app/(portal)/activity/page.tsx')
    expect(page).toContain("from '@/lib/audit-labels'")
    expect(page).not.toMatch(/from '@\/lib\/audit'/)
  })

  it('re-exports the labels from audit.ts so server code and tests can still use either', async () => {
    const labels = await import('../audit-labels')
    expect(AUDIT_LABELS).toBe(labels.AUDIT_LABELS)
  })
})

