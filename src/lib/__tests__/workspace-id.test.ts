import { describe, it, expect } from 'vitest'
import { isValidWorkspaceId } from '../workspace-id'

describe('isValidWorkspaceId', () => {
  it.each(['org-1', 'org-6424cb01', 'a1b2c3d4-0000-4000-8000-abcdef012345', 'A_b-9'])('accepts %s', id => {
    expect(isValidWorkspaceId(id)).toBe(true)
  })

  it.each(['', ' ', 'WS#org-1', 'org-1/', '../org-2', 'org 1', 'org-1#x', '-org', '_org', 'a'.repeat(65), 5, null, undefined, {}])(
    'rejects %j (could reach another partition or prefix, or is not an id)', id => {
      expect(isValidWorkspaceId(id)).toBe(false)
    })

  it('accepts the longest allowed id and nothing longer', () => {
    expect(isValidWorkspaceId('a'.repeat(64))).toBe(true)
    expect(isValidWorkspaceId('a'.repeat(65))).toBe(false)
  })
})
