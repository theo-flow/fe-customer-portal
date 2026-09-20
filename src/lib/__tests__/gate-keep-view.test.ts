import { describe, it, expect } from 'vitest'
import { filterAndSort, flattenTree, formatFileSize, type StoredFile } from '../gate-keep-view'

const f = (filename: string, size: number, lastModified: string | null): StoredFile =>
  ({ key: `k/${filename}`, filename, size, lastModified })

const FILES = [
  f('beta.pdf',   2048,      '2026-09-02T10:00:00Z'),
  f('Alpha.png',  5_000_000, '2026-09-01T10:00:00Z'),
  f('gamma.txt',  10,        '2026-09-03T10:00:00Z'),
  f('undated.csv', 500,      null),
]
const names = (xs: StoredFile[]) => xs.map(x => x.filename)

describe('filterAndSort', () => {
  it('newest first by default, undated last', () => {
    expect(names(filterAndSort(FILES, '', 'newest'))).toEqual(['gamma.txt', 'beta.pdf', 'Alpha.png', 'undated.csv'])
  })

  it('oldest first, undated last', () => {
    expect(names(filterAndSort(FILES, '', 'oldest'))).toEqual(['Alpha.png', 'beta.pdf', 'gamma.txt', 'undated.csv'])
  })

  it('sorts by name case-insensitively', () => {
    expect(names(filterAndSort(FILES, '', 'name'))).toEqual(['Alpha.png', 'beta.pdf', 'gamma.txt', 'undated.csv'])
  })

  it('sorts largest first', () => {
    expect(names(filterAndSort(FILES, '', 'largest'))).toEqual(['Alpha.png', 'beta.pdf', 'undated.csv', 'gamma.txt'])
  })

  it('filters by a case-insensitive substring and ignores surrounding spaces', () => {
    expect(names(filterAndSort(FILES, '  ALPHA ', 'newest'))).toEqual(['Alpha.png'])
    expect(names(filterAndSort(FILES, '.p', 'name'))).toEqual(['Alpha.png', 'beta.pdf'])
  })

  it('returns nothing for a query that matches nothing, and does not mutate the input', () => {
    const copy = [...FILES]
    expect(filterAndSort(FILES, 'zzz', 'newest')).toEqual([])
    expect(FILES).toEqual(copy)
  })
})

describe('formatFileSize', () => {
  it('shows KB for small files (never 0) and MB for large ones', () => {
    expect(formatFileSize(10)).toBe('1 KB')
    expect(formatFileSize(2048)).toBe('2 KB')
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})

describe('flattenTree', () => {
  const nodes = [
    { id: 'b', parentId: 'root', name: 'beta' },
    { id: 'a', parentId: 'root', name: 'Alpha' },
    { id: 'a2', parentId: 'a', name: 'Zed' },
    { id: 'a1', parentId: 'a', name: 'Inner' },
    { id: 'a1x', parentId: 'a1', name: 'Deep' },
  ]
  it('lists depth-first, alphabetically, with indentation depth', () => {
    expect(flattenTree(nodes).map(r => `${r.depth}:${r.name}`)).toEqual(['0:Alpha', '1:Inner', '2:Deep', '1:Zed', '0:beta'])
  })
  it('leaves out a folder and everything under it', () => {
    expect(flattenTree(nodes, 'a1').map(r => r.name)).toEqual(['Alpha', 'Zed', 'beta'])
    expect(flattenTree(nodes, 'a').map(r => r.name)).toEqual(['beta'])
  })
  it('is empty for no folders', () => { expect(flattenTree([])).toEqual([]) })
})
