import { describe, it, expect } from 'vitest'
import {
  ROOT_FOLDER_ID, MAX_NAME_LENGTH, MAX_FOLDER_DEPTH, MAX_UPLOAD_BYTES, ALLOWED_CONTENT_TYPES,
  validateName, suffixName,
  wsPk, folderSk, fileSk, nameLockSk, folderIndexPk, s3KeyFor,
  buildFolderItem, buildPendingFile, contentDisposition,
  pathTo, depthOf, canPlaceFolder, checkMove, type FolderNode,
} from '../gate-keep-catalog'

const NOW = Date.UTC(2026, 8, 19, 12, 0, 0)   // 2026-09-19T12:00:00Z
const DAY = 24 * 3600 * 1000

describe('keys', () => {
  it('builds partition and sort keys', () => {
    expect(wsPk('org-1')).toBe('WS#org-1')
    expect(folderSk('f1')).toBe('FOLDER#f1')
    expect(fileSk('x9')).toBe('FILE#x9')
    expect(folderIndexPk('org-1', 'root')).toBe('WS#org-1#F#root')
  })

  it('name-lock keys are per parent folder and case-insensitive', () => {
    expect(nameLockSk('root', 'Report.PDF')).toBe('NAME#root#report.pdf')
    expect(nameLockSk('root', 'report.pdf')).toBe(nameLockSk('root', 'REPORT.pdf'))
    expect(nameLockSk('a', 'x')).not.toBe(nameLockSk('b', 'x'))
  })

  it('the S3 key is workspace/fileId and contains no filename or folder', () => {
    expect(s3KeyFor('org-1', 'f-123')).toBe('org-1/f-123')
  })

  it('org-1 and org-10 can never share a partition', () => {
    expect(wsPk('org-1')).not.toBe(wsPk('org-10'))
    expect(folderIndexPk('org-1', 'root').startsWith(wsPk('org-10'))).toBe(false)
  })
})

describe('validateName', () => {
  it('accepts a normal name and trims it', () => {
    expect(validateName('  Invoices 2026  ')).toEqual({ ok: true, name: 'Invoices 2026' })
  })

  it('accepts unicode and punctuation', () => {
    expect(validateName('Café - Q3 (final).pdf')).toEqual({ ok: true, name: 'Café - Q3 (final).pdf' })
  })

  it.each([
    ['', 'empty'], ['   ', 'blank'], ['.', 'dot'], ['..', 'dotdot'],
    ['a/b', 'slash'], ['a\\b', 'backslash'], ['bad\u0000name', 'null char'], ['tab\tname', 'control char'],
  ])('rejects %j (%s)', (input) => {
    expect(validateName(input).ok).toBe(false)
  })

  it('enforces the length cap', () => {
    expect(validateName('a'.repeat(MAX_NAME_LENGTH)).ok).toBe(true)
    expect(validateName('a'.repeat(MAX_NAME_LENGTH + 1)).ok).toBe(false)
  })
})

describe('suffixName', () => {
  it('puts the counter before the extension', () => {
    expect(suffixName('report.pdf', 1)).toBe('report (1).pdf')
    expect(suffixName('archive.tar.gz', 2)).toBe('archive.tar (2).gz')
  })

  it('handles names with no extension and dotfiles', () => {
    expect(suffixName('Invoices', 3)).toBe('Invoices (3)')
    expect(suffixName('.env', 1)).toBe('.env (1)')
  })

  it('a suffixed name stays within the length cap', () => {
    const long = 'a'.repeat(MAX_NAME_LENGTH) + '.pdf'.slice(0, 0)
    expect(suffixName(long, 12).length).toBeLessThanOrEqual(MAX_NAME_LENGTH)
  })
})

describe('items', () => {
  it('a folder appears in its parent\'s index, sorted before files', () => {
    const f = buildFolderItem('org-1', { id: 'f1', parentId: 'root', name: 'Legal', by: 'u1', now: NOW })
    expect(f).toMatchObject({
      PK: 'WS#org-1', SK: 'FOLDER#f1', type: 'FOLDER', folderId: 'f1', parentId: 'root', name: 'Legal',
      GSI1PK: 'WS#org-1#F#root', GSI1SK: 'D#legal', createdBy: 'u1',
    })
  })

  it('a pending file is NOT listed (no index keys) and cleans itself up after 24h', () => {
    const p = buildPendingFile('org-1', { id: 'x', folderId: 'root', name: 'a.pdf', contentType: 'application/pdf', size: 10, by: 'u1', now: NOW })
    expect(p).toMatchObject({ PK: 'WS#org-1', SK: 'FILE#x', status: 'PENDING', size: 10 })
    expect(p).not.toHaveProperty('GSI1PK')
    expect(p.purgeAt).toBe(Math.floor((NOW + DAY) / 1000))
  })
})

describe('contentDisposition', () => {
  it('sets an attachment with an ASCII fallback and the real UTF-8 name', () => {
    const h = contentDisposition('Café report.pdf')
    expect(h).toContain('attachment;')
    expect(h).toContain('filename="Caf_ report.pdf"')
    expect(h).toContain("filename*=UTF-8''Caf%C3%A9%20report.pdf")
  })

  it('cannot be used to inject headers', () => {
    const h = contentDisposition('a"\r\nX-Evil: 1.pdf')
    expect(h).not.toMatch(/[\r\n]/)
    expect(h.match(/"/g)!.length).toBe(2)
  })
})

describe('upload rules', () => {
  it('allows common document types and a 50 MB cap', () => {
    expect(ALLOWED_CONTENT_TYPES).toContain('application/pdf')
    expect(ALLOWED_CONTENT_TYPES).toContain('image/png')
    expect(ALLOWED_CONTENT_TYPES).not.toContain('text/html')
    expect(MAX_UPLOAD_BYTES).toBe(50 * 1024 * 1024)
  })
})

describe('folder graph', () => {
  // root
  //  ├─ a ── b ── c
  //  └─ d
  const nodes: FolderNode[] = [
    { id: 'a', parentId: ROOT_FOLDER_ID, name: 'A' },
    { id: 'b', parentId: 'a', name: 'B' },
    { id: 'c', parentId: 'b', name: 'C' },
    { id: 'd', parentId: ROOT_FOLDER_ID, name: 'D' },
  ]

  it('pathTo returns the folders from the top down, excluding root', () => {
    expect(pathTo('c', nodes)!.map(n => n.name)).toEqual(['A', 'B', 'C'])
    expect(pathTo(ROOT_FOLDER_ID, nodes)).toEqual([])
    expect(pathTo('nope', nodes)).toBeNull()
  })

  it('depthOf counts folders from root', () => {
    expect(depthOf(ROOT_FOLDER_ID, nodes)).toBe(0)
    expect(depthOf('a', nodes)).toBe(1)
    expect(depthOf('c', nodes)).toBe(3)
  })

  it('canPlaceFolder enforces the depth cap', () => {
    expect(canPlaceFolder('c', nodes)).toBe(true)
    const deep: FolderNode[] = Array.from({ length: MAX_FOLDER_DEPTH }, (_, i) =>
      ({ id: `n${i}`, parentId: i === 0 ? ROOT_FOLDER_ID : `n${i - 1}`, name: `n${i}` }))
    expect(canPlaceFolder(`n${MAX_FOLDER_DEPTH - 1}`, deep)).toBe(false)
    expect(canPlaceFolder(`n${MAX_FOLDER_DEPTH - 2}`, deep)).toBe(true)
  })

  it('checkMove allows a normal move', () => {
    expect(checkMove('d', 'a', nodes)).toBeNull()
    expect(checkMove('c', ROOT_FOLDER_ID, nodes)).toBeNull()
  })

  it('checkMove rejects moving a folder into itself or its own descendant', () => {
    expect(checkMove('a', 'a', nodes)).toBe('cycle')
    expect(checkMove('a', 'c', nodes)).toBe('cycle')
  })

  it('checkMove rejects a move that would push any descendant past the depth cap', () => {
    const chain: FolderNode[] = Array.from({ length: MAX_FOLDER_DEPTH - 1 }, (_, i) =>
      ({ id: `p${i}`, parentId: i === 0 ? ROOT_FOLDER_ID : `p${i - 1}`, name: `p${i}` }))
    const withSub: FolderNode[] = [...chain,
      { id: 'x', parentId: ROOT_FOLDER_ID, name: 'X' },
      { id: 'y', parentId: 'x', name: 'Y' }]           // x has height 2
    // target depth is 7; x (height 2) would end at depth 9 > 8
    expect(checkMove('x', `p${MAX_FOLDER_DEPTH - 2}`, withSub)).toBe('too_deep')
  })

  it('checkMove tolerates an unknown target as not-found', () => {
    expect(checkMove('a', 'ghost', nodes)).toBe('not_found')
  })
})
