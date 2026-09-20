import { describe, it, expect } from 'vitest'
import { roleOf, isAdmin, forbiddenUnlessAdmin } from '../roles'

describe('roles', () => {
  it('reads admin and agent from the custom:role claim', () => {
    expect(roleOf({ 'custom:role': 'admin' })).toBe('admin')
    expect(roleOf({ 'custom:role': 'agent' })).toBe('agent')
  })

  it('treats a missing or unknown role as agent, never admin', () => {
    expect(roleOf({})).toBe('agent')
    expect(roleOf({ 'custom:role': 'superuser' })).toBe('agent')
    expect(isAdmin({})).toBe(false)
  })

  it('forbiddenUnlessAdmin lets admins through and returns a 403 for everyone else', async () => {
    expect(forbiddenUnlessAdmin({ 'custom:role': 'admin' })).toBeNull()

    const res = forbiddenUnlessAdmin({ 'custom:role': 'agent' })
    expect(res?.status).toBe(403)
    expect((await res!.json()).error).toMatch(/admin/i)
  })
})
