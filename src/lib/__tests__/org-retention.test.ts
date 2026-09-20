import { describe, it, expect, vi, beforeEach } from 'vitest'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/lib/aws', () => ({ ddbDocClient: () => ({ send }), TABLE: 'orgs' }))
vi.mock('@aws-sdk/lib-dynamodb', () => ({ GetCommand: vi.fn(function (this: unknown, input: unknown) { return { __type: 'Get', input } }) }))

import { getOrgRetentionYears } from '../org-retention'

describe('getOrgRetentionYears', () => {
  beforeEach(() => { send.mockReset() })

  it.each([5, 6, 7])('returns the agreed %i years', async years => {
    send.mockResolvedValue({ Item: { retention_years: years } })
    expect(await getOrgRetentionYears('org-1')).toBe(years)
  })

  it('reads only that organisation\'s profile, and only the one field', async () => {
    send.mockResolvedValue({ Item: {} })
    await getOrgRetentionYears('org-9')
    expect(send.mock.calls[0][0].input).toEqual({ TableName: 'orgs', Key: { PK: 'ORG#org-9', SK: 'PROFILE' }, ProjectionExpression: 'retention_years' })
  })

  it.each([[{ Item: {} }], [{ Item: undefined }], [{}]])('null when nothing has been agreed (%j)', async res => {
    send.mockResolvedValue(res)
    expect(await getOrgRetentionYears('org-1')).toBeNull()
  })

  it.each([1, 4, 10, '5', 'seven', null, 5.5])('null for a value that is not an allowed period (%j), never a guess', async bad => {
    send.mockResolvedValue({ Item: { retention_years: bad } })
    expect(await getOrgRetentionYears('org-1')).toBeNull()
  })

  it('a read failure THROWS, so "could not look it up" is never mistaken for "no agreement"', async () => {
    send.mockRejectedValue(new Error('throttled'))
    await expect(getOrgRetentionYears('org-1')).rejects.toThrow('throttled')
  })
})
