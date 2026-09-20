import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { cookie, verify, send } = vi.hoisted(() => ({ cookie: vi.fn(), verify: vi.fn(), send: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: () => ({ get: cookie }) }))
vi.mock('@/lib/token', () => ({ verifyJwtClaims: verify }))
vi.mock('@/lib/aws', () => ({ ddbDocClient: () => ({ send }), TABLE: 'orgs' }))
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  ScanCommand:  vi.fn(function (this: unknown, input: unknown) { return { __type: 'Scan',  input } }),
  GetCommand:   vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get',   input } }),
  QueryCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Query', input } }),
}))

import { GET } from '../route'

const profile = (orgId: string, orgName: string) => ({ orgId, orgName, status: 'active', subscribed_products: ['forge'] })

// The fake table: pages of profiles for the Scan, and a subscription/doc count per org.
function table(pages: Record<string, unknown>[][]) {
  send.mockImplementation(async (cmd: { __type: string; input: Record<string, any> }) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    if (cmd.__type === 'Scan') {
      const at = cmd.input.ExclusiveStartKey ? Number(cmd.input.ExclusiveStartKey.page) : 0
      return { Items: pages[at], LastEvaluatedKey: at + 1 < pages.length ? { page: at + 1 } : undefined }
    }
    if (cmd.__type === 'Get') return { Item: undefined }
    return { Count: 2 }
  })
}

describe('GET /api/operator/orgs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OPERATOR_EMAILS = 'ops@theoflow.example'
    cookie.mockReturnValue({ value: 't' })
    verify.mockResolvedValue({ sub: 'op', email: 'ops@theoflow.example' })
  })
  afterEach(() => { delete process.env.OPERATOR_EMAILS })

  it.each([
    ['no cookie', () => cookie.mockReturnValue(undefined), 401],
    ['an unverifiable token', () => verify.mockResolvedValue(null), 401],
    ['a signed-in user who is not an operator', () => verify.mockResolvedValue({ sub: 'u', email: 'admin@customer.example' }), 403],
  ])('refuses %s, and reads nothing', async (_l, arrange, status) => {
    arrange()
    expect((await GET()).status).toBe(status)
    expect(send).not.toHaveBeenCalled()
  })

  it('lists every organisation, sorted by name, with its document count', async () => {
    table([[profile('org-2', 'Zulu Co'), profile('org-1', 'Acme')]])
    const body = await (await GET()).json()
    expect(body.orgs.map((o: { orgName: string }) => o.orgName)).toEqual(['Acme', 'Zulu Co'])
    expect(body.orgs[0]).toMatchObject({ orgId: 'org-1', status: 'active', subscribedProducts: ['forge'], totalDocuments: 2, subscription: null })
  })

  it('follows the scan to the last page, so no organisation is left out as the table grows', async () => {
    table([[profile('org-1', 'A')], [profile('org-2', 'B')], [profile('org-3', 'C')]])
    const body = await (await GET()).json()
    expect(body.orgs.map((o: { orgId: string }) => o.orgId)).toEqual(['org-1', 'org-2', 'org-3'])
    const scans = send.mock.calls.map(c => c[0]).filter(c => c.__type === 'Scan')
    expect(scans).toHaveLength(3)
    expect(scans[1].input.ExclusiveStartKey).toEqual({ page: 1 })
  })

  it('only scans for organisation profiles', async () => {
    table([[]])
    await GET()
    expect(send.mock.calls[0][0].input).toMatchObject({ TableName: 'orgs', FilterExpression: 'SK = :sk', ExpressionAttributeValues: { ':sk': 'PROFILE' } })
  })

  it('a failed scan is a clean 500, not a half-empty list', async () => {
    send.mockRejectedValue(new Error('AccessDenied: not authorized to perform dynamodb:Scan'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('dynamodb:Scan')
  })

  it('a scan that fails part-way is a 500 too (never returns only the first pages)', async () => {
    send.mockResolvedValueOnce({ Items: [profile('org-1', 'A')], LastEvaluatedKey: { page: 1 } }).mockRejectedValueOnce(new Error('throttled'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await GET()).status).toBe(500)
  })
})
