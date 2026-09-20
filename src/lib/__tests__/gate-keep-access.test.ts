import { describe, it, expect } from 'vitest'
import {
  ownerOf, canSee, canManage, canAddFilesTo, canCreateFolderIn, canMoveFile, canMoveFolder,
  ownerForNewTopLevelFolder, ownerToKeepAtTopLevel, type FolderRef, type Viewer,
} from '../gate-keep-access'

//  root (the organisation)
//  ├─ shared        (top level, no owner: belongs to the organisation)
//  │   └─ sharedKid
//  ├─ alices        (top level, owner alice)
//  │   └─ alicesKid
//  └─ bobs          (top level, owner bob)
const F: FolderRef[] = [
  { folderId: 'shared',    parentId: 'root' },
  { folderId: 'sharedKid', parentId: 'shared' },
  { folderId: 'alices',    parentId: 'root', ownerId: 'alice' },
  { folderId: 'alicesKid', parentId: 'alices' },
  { folderId: 'bobs',      parentId: 'root', ownerId: 'bob' },
]
const alice: Viewer = { userId: 'alice', isAdmin: false }
const bob:   Viewer = { userId: 'bob',   isAdmin: false }
const admin: Viewer = { userId: 'boss',  isAdmin: true }

describe('ownerOf', () => {
  it('the root and shared folders belong to the organisation', () => {
    expect(ownerOf('root', F)).toBeUndefined()
    expect(ownerOf('shared', F)).toBeUndefined()
    expect(ownerOf('sharedKid', F)).toBeUndefined()
  })

  it('a member\'s folders, at any depth, belong to that member', () => {
    expect(ownerOf('alices', F)).toBe('alice')
    expect(ownerOf('alicesKid', F)).toBe('alice')
    expect(ownerOf('bobs', F)).toBe('bob')
  })

  it('takes the owner from the top-level ancestor, so a stale owner further down is ignored', () => {
    const stale: FolderRef[] = [...F, { folderId: 'deep', parentId: 'sharedKid', ownerId: 'alice' }]
    expect(ownerOf('deep', stale)).toBeUndefined()
  })

  it('an unknown folder or a loop is null (nobody may touch it)', () => {
    expect(ownerOf('ghost', F)).toBeNull()
    expect(ownerOf('a', [{ folderId: 'a', parentId: 'b' }, { folderId: 'b', parentId: 'a' }])).toBeNull()
  })
})

describe('who can SEE what', () => {
  it.each([
    ['alice', alice, 'root', true], ['alice', alice, 'shared', true], ['alice', alice, 'sharedKid', true],
    ['alice', alice, 'alices', true], ['alice', alice, 'alicesKid', true],
    ['alice', alice, 'bobs', false],                                            // another member's private folder
    ['bob', bob, 'alices', false], ['bob', bob, 'alicesKid', false], ['bob', bob, 'bobs', true],
    ['admin', admin, 'alices', true], ['admin', admin, 'bobs', true], ['admin', admin, 'shared', true],
  ])('%s sees %s -> %s', (_n, v, folder, want) => {
    expect(canSee(v as Viewer, folder as string, F)).toBe(want)
  })

  it('nobody sees an unknown folder, not even an admin', () => {
    expect(canSee(admin, 'ghost', F)).toBe(false)
    expect(canSee(alice, 'ghost', F)).toBe(false)
  })
})

describe('who can DELETE / rename / move / protect', () => {
  it('a member manages their own folders and what is in them', () => {
    expect(canManage(alice, 'alices', F)).toBe(true)
    expect(canManage(alice, 'alicesKid', F)).toBe(true)
  })

  it('a member can NOT manage the organisation\'s shared space or the root', () => {
    for (const f of ['root', 'shared', 'sharedKid']) expect(canManage(alice, f, F)).toBe(false)
  })

  it('a member can NOT manage another member\'s folders', () => {
    expect(canManage(alice, 'bobs', F)).toBe(false)
    expect(canManage(bob, 'alicesKid', F)).toBe(false)
  })

  it('an admin manages everything that exists', () => {
    for (const f of ['root', 'shared', 'sharedKid', 'alices', 'alicesKid', 'bobs']) expect(canManage(admin, f, F)).toBe(true)
    expect(canManage(admin, 'ghost', F)).toBe(false)
  })
})

describe('adding files', () => {
  it('a member may add to the shared space and to their own folders, not to another member\'s', () => {
    expect(canAddFilesTo(alice, 'root', F)).toBe(true)
    expect(canAddFilesTo(alice, 'shared', F)).toBe(true)
    expect(canAddFilesTo(alice, 'alices', F)).toBe(true)
    expect(canAddFilesTo(alice, 'bobs', F)).toBe(false)
  })

  it('what a member adds to the shared space is then not theirs to delete', () => {
    expect(canAddFilesTo(alice, 'shared', F)).toBe(true)
    expect(canManage(alice, 'shared', F)).toBe(false)
  })
})

describe('creating folders', () => {
  it('a member can make a folder at the top level (it becomes theirs) and inside their own folders', () => {
    expect(canCreateFolderIn(alice, 'root', F)).toBe(true)
    expect(canCreateFolderIn(alice, 'alices', F)).toBe(true)
    expect(canCreateFolderIn(alice, 'alicesKid', F)).toBe(true)
  })

  it('a member cannot make a folder in the shared space or in someone else\'s', () => {
    expect(canCreateFolderIn(alice, 'shared', F)).toBe(false)
    expect(canCreateFolderIn(alice, 'sharedKid', F)).toBe(false)
    expect(canCreateFolderIn(alice, 'bobs', F)).toBe(false)
  })

  it('an admin can make one anywhere that exists', () => {
    for (const p of ['root', 'shared', 'alices', 'bobs']) expect(canCreateFolderIn(admin, p, F)).toBe(true)
    expect(canCreateFolderIn(admin, 'ghost', F)).toBe(false)
  })

  it('a top-level folder is the member\'s own when a member makes it, and shared when an admin does', () => {
    expect(ownerForNewTopLevelFolder(alice)).toBe('alice')
    expect(ownerForNewTopLevelFolder(admin)).toBeUndefined()
  })
})

describe('moving a file', () => {
  it('a member can shuffle files between their own folders', () => {
    expect(canMoveFile(alice, 'alices', 'alicesKid', F)).toBe(true)
  })

  it('a member cannot move a file into the shared space (that would hand it to the organisation)', () => {
    expect(canMoveFile(alice, 'alices', 'shared', F)).toBe(false)
    expect(canMoveFile(alice, 'alices', 'root', F)).toBe(false)
  })

  it('a member cannot move a shared file, or one from another member', () => {
    expect(canMoveFile(alice, 'shared', 'alices', F)).toBe(false)
    expect(canMoveFile(alice, 'bobs', 'alices', F)).toBe(false)
    expect(canMoveFile(alice, 'alices', 'bobs', F)).toBe(false)
  })

  it('an admin can move a file anywhere that exists', () => {
    expect(canMoveFile(admin, 'shared', 'alices', F)).toBe(true)
    expect(canMoveFile(admin, 'bobs', 'shared', F)).toBe(true)
    expect(canMoveFile(admin, 'bobs', 'ghost', F)).toBe(false)
  })
})

describe('moving a folder', () => {
  it('a member can move their own folder into their own folders, or up to the top level (it stays theirs)', () => {
    expect(canMoveFolder(alice, 'alicesKid', 'root', F)).toBe(true)
    expect(canMoveFolder(alice, 'alicesKid', 'alices', F)).toBe(true)
    expect(canMoveFolder(alice, 'alices', 'root', F)).toBe(true)
  })

  it('a member can never move a folder into the shared space or into another member\'s', () => {
    expect(canMoveFolder(alice, 'alices', 'shared', F)).toBe(false)
    expect(canMoveFolder(alice, 'alicesKid', 'bobs', F)).toBe(false)
  })

  it('a member cannot move a shared folder or someone else\'s', () => {
    expect(canMoveFolder(alice, 'shared', 'alices', F)).toBe(false)
    expect(canMoveFolder(alice, 'sharedKid', 'root', F)).toBe(false)
    expect(canMoveFolder(alice, 'bobs', 'root', F)).toBe(false)
  })

  it('an admin can move any folder anywhere that exists', () => {
    expect(canMoveFolder(admin, 'alices', 'shared', F)).toBe(true)
    expect(canMoveFolder(admin, 'sharedKid', 'bobs', F)).toBe(true)
    expect(canMoveFolder(admin, 'alices', 'ghost', F)).toBe(false)
  })

  it('a nested folder that becomes top-level keeps its owner, so it does not become shared by accident', () => {
    expect(ownerToKeepAtTopLevel('alicesKid', F)).toBe('alice')
    expect(ownerToKeepAtTopLevel('sharedKid', F)).toBeUndefined()
    expect(ownerToKeepAtTopLevel('ghost', F)).toBeUndefined()
  })
})
