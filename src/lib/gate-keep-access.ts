import { ROOT_FOLDER_ID } from '@/lib/gate-keep-catalog'

// Who may see and change what in an organisation's Gate-Keep. Pure rules, no AWS.
//
// The organisation is the root. Its shared root and shared folders BELONG TO THE ORGANISATION.
// A member's own folders (created by that member at the top level) are theirs.
//
//   - See:      a member sees the shared space and their own folders. An admin sees everything.
//   - Delete / rename / move / protect a file or folder:
//                 in a member's own folders -> that member, and any admin
//                 in the shared space       -> admins only
//   - Add files: anywhere the person can see (a member may add to the shared space, but what
//                they add there belongs to the organisation, so only an admin can delete it).
//   - New folder: a member at the top level (it becomes theirs) or inside their own folders;
//                an admin anywhere. A folder an admin makes at the top level is shared.
//
// The owner is stored only on TOP-LEVEL folders. Everything beneath takes the owner of its
// top-level ancestor, so moving a folder can never leave stale ownership behind.

export interface Viewer { userId: string; isAdmin: boolean }
export interface FolderRef { folderId: string; parentId: string; ownerId?: string }

// undefined = the organisation (shared). null = the folder is unknown or its chain loops.
export function ownerOf(folderId: string, folders: FolderRef[]): string | undefined | null {
  if (folderId === ROOT_FOLDER_ID) return undefined
  const byId = new Map(folders.map(f => [f.folderId, f]))
  const seen = new Set<string>()
  let cur = byId.get(folderId)
  while (cur) {
    if (seen.has(cur.folderId)) return null
    seen.add(cur.folderId)
    if (cur.parentId === ROOT_FOLDER_ID) return cur.ownerId || undefined
    cur = byId.get(cur.parentId)
  }
  return null
}

const isShared = (owner: string | undefined | null) => owner === undefined

export function canSee(v: Viewer, folderId: string, folders: FolderRef[]): boolean {
  const owner = ownerOf(folderId, folders)
  if (owner === null) return false
  return v.isAdmin || isShared(owner) || owner === v.userId
}

// Delete, rename, move or protect what lives in this folder (or the folder itself).
export function canManage(v: Viewer, folderId: string, folders: FolderRef[]): boolean {
  const owner = ownerOf(folderId, folders)
  if (owner === null) return false
  if (v.isAdmin) return true
  return owner !== undefined && owner === v.userId      // never the shared space
}

export function canAddFilesTo(v: Viewer, folderId: string, folders: FolderRef[]): boolean {
  return canSee(v, folderId, folders)
}

export function canCreateFolderIn(v: Viewer, parentId: string, folders: FolderRef[]): boolean {
  if (v.isAdmin) return ownerOf(parentId, folders) !== null
  if (parentId === ROOT_FOLDER_ID) return true          // a member's top-level folder is their own
  return canManage(v, parentId, folders)
}

// The owner a NEW top-level folder gets: the member who made it, or nobody (shared) for an admin.
export const ownerForNewTopLevelFolder = (v: Viewer): string | undefined => (v.isAdmin ? undefined : v.userId)

// Move a FILE. A member may only shuffle files between their own folders: moving into the
// shared space would hand the file to the organisation, and shared files are not theirs to move.
export function canMoveFile(v: Viewer, fromFolderId: string, toFolderId: string, folders: FolderRef[]): boolean {
  if (v.isAdmin) return ownerOf(fromFolderId, folders) !== null && ownerOf(toFolderId, folders) !== null
  return canManage(v, fromFolderId, folders) && canManage(v, toFolderId, folders)
}

// Move a FOLDER under `toParentId`. A member may move their own folder into their own folders,
// or to the top level (where it stays theirs). Never into the shared space.
export function canMoveFolder(v: Viewer, folderId: string, toParentId: string, folders: FolderRef[]): boolean {
  if (v.isAdmin) return ownerOf(folderId, folders) !== null && ownerOf(toParentId, folders) !== null
  if (!canManage(v, folderId, folders)) return false
  return toParentId === ROOT_FOLDER_ID || canManage(v, toParentId, folders)
}

// The owner a folder must carry if it becomes top-level: whoever effectively owned it before.
export function ownerToKeepAtTopLevel(folderId: string, folders: FolderRef[]): string | undefined {
  const o = ownerOf(folderId, folders)
  return o === null ? undefined : o
}

// Why a viewer who can SEE a folder may not change what is in it.
export function deniedMessage(folderId: string, folders: FolderRef[]): string {
  return ownerOf(folderId, folders) === undefined
    ? 'This belongs to the organisation. Only an admin can change or delete it.'
    : 'You can only change your own files and folders.'
}
