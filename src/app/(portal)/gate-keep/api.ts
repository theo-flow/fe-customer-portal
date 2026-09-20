// Types and the tiny fetch helper shared by the Gate-Keep screens.

export interface FolderRow { id: string; name: string; parentId: string; createdAt: string }
export interface FileRow   { id: string; name: string; folderId: string; size: number; contentType: string; createdAt: string }
export interface TrashRow  { id: string; name: string; size: number; deletedAt: string | null; purgeAt: string | null }
export interface TreeNode  { id: string; parentId: string; name: string }

export interface ListResponse {
  folderId:   string
  breadcrumb: { id: string; name: string }[]
  folders:    FolderRow[]
  files:      FileRow[]
  tree:       TreeNode[]
}

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message) }
}

// JSON request that throws an ApiError carrying the server's own plain-language message.
export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const json = await res.json().catch(() => ({})) as { error?: string; message?: string }
  if (!res.ok) throw new ApiError(res.status, json.error ?? 'error', json.message ?? 'Something went wrong. Please try again.')
  return json as T
}
