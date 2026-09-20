export interface StoredFile {
  key:          string
  filename:     string
  size:         number
  lastModified: string | null
}

export type SortMode = 'newest' | 'oldest' | 'name' | 'largest'

// Must match the lifecycle rule on gate-keep-trash/ in the core terraform stack.
export const TRASH_RETENTION_DAYS = 28

const DAY_MS = 24 * 60 * 60 * 1000

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const time = (f: StoredFile) => (f.lastModified ? new Date(f.lastModified).getTime() : null)

// Undated files always sort last, whichever direction is chosen.
function byDate(dir: 1 | -1) {
  return (a: StoredFile, b: StoredFile) => {
    const ta = time(a), tb = time(b)
    if (ta === null && tb === null) return 0
    if (ta === null) return 1
    if (tb === null) return -1
    return (ta - tb) * dir
  }
}

export function filterAndSort(files: StoredFile[], query: string, mode: SortMode): StoredFile[] {
  const q = query.trim().toLowerCase()
  const shown = q ? files.filter(f => f.filename.toLowerCase().includes(q)) : [...files]

  switch (mode) {
    case 'oldest':  return shown.sort(byDate(1))
    case 'name':    return shown.sort((a, b) => a.filename.toLowerCase().localeCompare(b.filename.toLowerCase()))
    case 'largest': return shown.sort((a, b) => b.size - a.size)
    default:        return shown.sort(byDate(-1))
  }
}

// A trashed file's lastModified is the moment it was moved to trash (copying
// creates a new object), so the retention window runs from there.
export function daysLeftInTrash(trashedAt: string | null, now: number = Date.now()): number | null {
  if (!trashedAt) return null
  const expires = new Date(trashedAt).getTime() + TRASH_RETENTION_DAYS * DAY_MS
  return Math.max(0, Math.ceil((expires - now) / DAY_MS))
}

// Days until an ISO date (rounded up, never negative). Used for the trash countdown,
// driven by the server's purgeAt so a file kept longer by a retention lock shows the truth.
export function daysUntil(iso: string | null, now: number = Date.now()): number | null {
  if (!iso) return null
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / DAY_MS))
}

export interface TreeRow { id: string; name: string; depth: number }

// The folder tree as an indented, alphabetical list for the "Move to" picker.
// `excludeId` leaves out a folder and everything under it (a folder can't move into itself).
export function flattenTree(nodes: { id: string; parentId: string; name: string }[], excludeId?: string): TreeRow[] {
  const kids = new Map<string, typeof nodes>()
  for (const n of nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n])
  for (const list of Array.from(kids.values())) list.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))

  const out: TreeRow[] = []
  const walk = (parentId: string, depth: number) => {
    for (const k of kids.get(parentId) ?? []) {
      if (k.id === excludeId) continue
      out.push({ id: k.id, name: k.name, depth })
      walk(k.id, depth + 1)
    }
  }
  walk('root', 0)
  return out
}
