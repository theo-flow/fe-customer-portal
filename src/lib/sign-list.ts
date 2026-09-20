// The Sign page loads sessions a page at a time. Polling only refreshes the
// newest page, and this folds that fresh page into what is already on screen.

export const LIVE_STATUSES = ['DRAFT', 'PENDING', 'IN_PROGRESS']

// Only sessions that are still in progress can change by themselves.
export const hasLive = (list: { status: string }[]): boolean => list.some(s => LIVE_STATUSES.includes(s.status))

// Fresh copies replace what is loaded, sessions that are new go in, and
// everything older that was loaded with "Load more" stays. Newest first, the
// same order the server uses.
export function mergeFirstPage<T extends { sessionId: string; createdAt: string }>(loaded: T[], fresh: T[]): T[] {
  const latest = new Map(fresh.map(s => [s.sessionId, s]))
  const known = new Set(loaded.map(s => s.sessionId))
  const merged = [...fresh.filter(s => !known.has(s.sessionId)), ...loaded.map(s => latest.get(s.sessionId) ?? s)]
  const stamp = (s: T) => `${s.createdAt}|${s.sessionId}`
  return merged.sort((a, b) => (stamp(a) < stamp(b) ? 1 : stamp(a) > stamp(b) ? -1 : 0))
}
