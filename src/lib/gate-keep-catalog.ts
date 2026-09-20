import { TRASH_RETENTION_DAYS } from '@/lib/gate-keep-view'

// Pure rules for the Gate-Keep catalogue. Nothing here touches AWS.
//
// The archive bucket holds bytes only, under opaque keys ({workspaceId}/{fileId}).
// Folders, names and removed-state live in the catalogue table, so moving or
// renaming a folder is a metadata change that also works on files under Object
// Lock. Every DynamoDB key below is built from the workspace of the verified
// login, never from anything the browser sends.

export const ROOT_FOLDER_ID = 'root'
export const MAX_NAME_LENGTH = 200
export const MAX_FOLDER_DEPTH = 8
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024   // matches the platform-wide presigned-upload ceiling
export const PENDING_UPLOAD_TTL_SECONDS = 24 * 3600

const DAY_MS = 24 * 3600 * 1000

export const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/tiff', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv', 'text/plain',
  'application/zip',
  'video/mp4', 'video/quicktime',
  'audio/mpeg', 'audio/wav',
]

// ── Keys ────────────────────────────────────────────────────────────────────

export const wsPk           = (ws: string) => `WS#${ws}`
export const folderSk       = (id: string) => `FOLDER#${id}`
export const fileSk         = (id: string) => `FILE#${id}`
export const folderIndexPk  = (ws: string, folderId: string) => `WS#${ws}#F#${folderId}`
export const trashIndexPk   = (ws: string) => `WS#${ws}#TRASH`
export const s3KeyFor       = (ws: string, fileId: string) => `${ws}/${fileId}`

const nameKey = (name: string) => name.normalize('NFC').toLowerCase()

// One item per (folder, name): written in the same transaction as the file or
// folder itself with attribute_not_exists, which is what makes names unique.
export const nameLockSk = (parentId: string, name: string) => `NAME#${parentId}#${nameKey(name)}`

// ── Names ───────────────────────────────────────────────────────────────────

export type NameCheck = { ok: true; name: string } | { ok: false; error: string }

export function validateName(raw: unknown): NameCheck {
  if (typeof raw !== 'string') return { ok: false, error: 'A name is required.' }
  const name = raw.normalize('NFC').trim()
  if (!name) return { ok: false, error: 'A name is required.' }
  if (name.length > MAX_NAME_LENGTH) return { ok: false, error: `Names can be at most ${MAX_NAME_LENGTH} characters.` }
  if (name === '.' || name === '..') return { ok: false, error: 'That name is not allowed.' }
  // eslint-disable-next-line no-control-regex
  if (/[\/\\\u0000-\u001f\u007f]/.test(name)) return { ok: false, error: 'Names cannot contain slashes or control characters.' }
  return { ok: true, name }
}

function withLabel(name: string, label: string): string {
  const dot = name.lastIndexOf('.')
  const hasExt = dot > 0 && dot < name.length - 1
  const base = hasExt ? name.slice(0, dot) : name
  const ext  = hasExt ? name.slice(dot) : ''
  const tag  = ` (${label})`
  const room = MAX_NAME_LENGTH - tag.length - ext.length
  return `${base.slice(0, Math.max(1, room))}${tag}${ext}`
}

export const suffixName   = (name: string, n: number) => withLabel(name, String(n))
export const restoredName = (name: string) => withLabel(name, 'restored')

// ── Items ───────────────────────────────────────────────────────────────────

export type FileStatus = 'PENDING' | 'READY'

export interface FolderItem {
  PK: string; SK: string; type: 'FOLDER'
  folderId: string; parentId: string; name: string
  createdAt: string; createdBy: string
  GSI1PK: string; GSI1SK: string
}

export interface FileItem {
  PK: string; SK: string; type: 'FILE'
  fileId: string; folderId: string; name: string
  contentType: string; size: number; status: FileStatus
  createdAt: string; createdBy: string
  versionId?: string
  GSI1PK?: string; GSI1SK?: string
  deletedAt?: string; deleteMarkerVersionId?: string
  GSI2PK?: string; GSI2SK?: string
  purgeAt?: number
}

export function folderIndexKeys(ws: string, parentId: string, name: string, kind: 'folder' | 'file', id: string) {
  return {
    GSI1PK: folderIndexPk(ws, parentId),
    // "D#" sorts folders ahead of files ("F#"), so one Query returns both in display order.
    GSI1SK: kind === 'folder' ? `D#${nameKey(name)}` : `F#${nameKey(name)}#${id}`,
  }
}

export function buildFolderItem(
  ws: string, a: { id: string; parentId: string; name: string; by: string; now: number },
): FolderItem {
  return {
    PK: wsPk(ws), SK: folderSk(a.id), type: 'FOLDER',
    folderId: a.id, parentId: a.parentId, name: a.name,
    createdAt: new Date(a.now).toISOString(), createdBy: a.by,
    ...folderIndexKeys(ws, a.parentId, a.name, 'folder', a.id),
  }
}

// A pending file has no index keys, so it never shows in a listing, and it
// carries a TTL so an upload that is never confirmed cleans itself up.
export function buildPendingFile(
  ws: string, a: { id: string; folderId: string; name: string; contentType: string; size: number; by: string; now: number },
): FileItem {
  return {
    PK: wsPk(ws), SK: fileSk(a.id), type: 'FILE',
    fileId: a.id, folderId: a.folderId, name: a.name,
    contentType: a.contentType, size: a.size, status: 'PENDING',
    createdAt: new Date(a.now).toISOString(), createdBy: a.by,
    purgeAt: Math.floor((a.now + PENDING_UPLOAD_TTL_SECONDS * 1000) / 1000),
  }
}

// When a removed file's catalogue row may disappear: 28 days after removal, or
// later if a retention lock on it runs longer. Epoch seconds, for DynamoDB TTL.
export function purgeAtFor(deletedAtMs: number, retainUntilMs?: number): number {
  const window = deletedAtMs + TRASH_RETENTION_DAYS * DAY_MS
  return Math.floor(Math.max(window, retainUntilMs ?? 0) / 1000)
}

// Content-Disposition for a download: an ASCII-safe fallback plus the real
// UTF-8 name (RFC 6266 / 5987). Nothing from the name can break out of the header.
export function contentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\%]/g, '_')
  const encoded  = encodeURIComponent(name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

// ── Folder graph (all of a workspace's folders are loaded, then reasoned about here) ──

export interface FolderNode { id: string; parentId: string; name: string }

const byId = (nodes: FolderNode[]) => new Map(nodes.map(n => [n.id, n]))

// Folders from the top down to `id`, excluding root. null if `id` is unknown or the chain loops.
export function pathTo(id: string, nodes: FolderNode[]): FolderNode[] | null {
  if (id === ROOT_FOLDER_ID) return []
  const map = byId(nodes)
  const path: FolderNode[] = []
  const seen = new Set<string>()
  let cur = map.get(id)
  while (cur) {
    if (seen.has(cur.id)) return null
    seen.add(cur.id)
    path.unshift(cur)
    if (cur.parentId === ROOT_FOLDER_ID) return path
    cur = map.get(cur.parentId)
  }
  return null
}

export function depthOf(id: string, nodes: FolderNode[]): number {
  const p = pathTo(id, nodes)
  return p === null ? -1 : p.length
}

export function canPlaceFolder(parentId: string, nodes: FolderNode[]): boolean {
  const d = depthOf(parentId, nodes)
  return d >= 0 && d + 1 <= MAX_FOLDER_DEPTH
}

function subtreeHeight(id: string, nodes: FolderNode[]): number {
  const kids = new Map<string, string[]>()
  for (const n of nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n.id])
  const height = (x: string, seen: Set<string>): number => {
    if (seen.has(x)) return 0
    seen.add(x)
    return Math.max(0, ...(kids.get(x) ?? []).map(k => 1 + height(k, seen)))
  }
  return height(id, new Set())
}

export type MoveProblem = 'not_found' | 'cycle' | 'too_deep'

export function checkMove(folderId: string, targetParentId: string, nodes: FolderNode[]): MoveProblem | null {
  const targetPath = pathTo(targetParentId, nodes)
  if (targetPath === null) return 'not_found'
  if (targetParentId === folderId || targetPath.some(n => n.id === folderId)) return 'cycle'
  if (targetPath.length + 1 + subtreeHeight(folderId, nodes) > MAX_FOLDER_DEPTH) return 'too_deep'
  return null
}

// ── What the browser sees (never the raw keys) ──────────────────────────────

export const toPublicFolder = (f: FolderItem) => ({ id: f.folderId, name: f.name, parentId: f.parentId, createdAt: f.createdAt })

export const toPublicFile = (f: FileItem) => ({
  id: f.fileId, name: f.name, folderId: f.folderId, size: f.size, contentType: f.contentType, createdAt: f.createdAt,
})

export const toPublicTrashFile = (f: FileItem) => ({
  id: f.fileId, name: f.name, size: f.size, deletedAt: f.deletedAt ?? null,
  purgeAt: f.purgeAt ? new Date(f.purgeAt * 1000).toISOString() : null,
})
