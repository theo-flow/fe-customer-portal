// A workspace id is an org id or (for a personal account) a user sub. Anything with a
// "#" or "/" could reach into another partition or prefix, so the format is strict.
// Pure, so both the server (erasure) and the operator console page can use it.
const WORKSPACE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

export const isValidWorkspaceId = (ws: unknown): ws is string => typeof ws === 'string' && WORKSPACE_ID.test(ws)
