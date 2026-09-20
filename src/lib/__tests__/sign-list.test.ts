import { describe, it, expect } from 'vitest'
import { hasLive, mergeFirstPage } from '../sign-list'

const row = (id: string, day: number, status = 'SIGNED') => ({ sessionId: id, createdAt: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`, status })

describe('sign-list', () => {
  it('only unfinished sessions count as live', () => {
    expect(hasLive([row('a', 1, 'SIGNED'), row('b', 2, 'CANCELLED'), row('c', 3, 'EXPIRED')])).toBe(false)
    for (const status of ['DRAFT', 'PENDING', 'IN_PROGRESS']) expect(hasLive([row('a', 1, 'SIGNED'), row('b', 2, status)])).toBe(true)
    expect(hasLive([])).toBe(false)
  })

  it('a poll updates loaded rows in place and puts new sessions on top', () => {
    const loaded = [row('s3', 3, 'PENDING'), row('s2', 2), row('s1', 1)]
    const fresh = [row('s4', 4, 'PENDING'), row('s3', 3, 'SIGNED')]
    const merged = mergeFirstPage(loaded, fresh)
    expect(merged.map(s => [s.sessionId, s.status])).toEqual([['s4', 'PENDING'], ['s3', 'SIGNED'], ['s2', 'SIGNED'], ['s1', 'SIGNED']])
  })

  it('keeps older pages that were loaded with Load more', () => {
    const loaded = [row('s9', 9), row('s8', 8), row('s2', 2), row('s1', 1)]
    expect(mergeFirstPage(loaded, [row('s9', 9), row('s8', 8)]).map(s => s.sessionId)).toEqual(['s9', 's8', 's2', 's1'])
  })

  it('loading the next page adds it below, with no duplicates', () => {
    const merged = mergeFirstPage([row('s9', 9), row('s8', 8)], [row('s8', 8), row('s7', 7), row('s6', 6)])
    expect(merged.map(s => s.sessionId)).toEqual(['s9', 's8', 's7', 's6'])
  })

  it('does not mutate what it was given, and breaks ties by id like the server', () => {
    const loaded = [row('a', 1)]
    const before = JSON.stringify(loaded)
    expect(mergeFirstPage(loaded, [row('b', 1)]).map(s => s.sessionId)).toEqual(['b', 'a'])
    expect(JSON.stringify(loaded)).toBe(before)
  })
})
