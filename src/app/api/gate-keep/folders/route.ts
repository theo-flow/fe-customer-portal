import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { gateKeep, HttpError, notFound, readJson } from '@/lib/gate-keep-route'
import { createFolder, listFolders } from '@/lib/gate-keep-store'
import {
  MAX_FOLDER_DEPTH, ROOT_FOLDER_ID, buildFolderItem, depthOf, toPublicFolder, validateName,
} from '@/lib/gate-keep-catalog'
import { canCreateFolderIn, canManage, canSee, ownerForNewTopLevelFolder, ownerOf } from '@/lib/gate-keep-access'

// A member's folder at the top level is that member's own (private to them, visible to admins).
// A folder an admin makes at the top level belongs to the organisation. Below the top level a
// folder simply takes the owner of the one above it.
export async function POST(req: NextRequest) {
  return gateKeep('folders/create', async ({ ws, userId, viewer, db }) => {
    const body = await readJson<{ parentId: string; name: string }>(req)

    const checked = validateName(body.name)
    if (!checked.ok) throw new HttpError(400, 'invalid_name', checked.error)

    const parentId = body.parentId || ROOT_FOLDER_ID
    const all   = await listFolders(db, ws)
    const refs  = all.map(f => ({ folderId: f.folderId, parentId: f.parentId, ownerId: f.ownerId }))
    const nodes = all.map(f => ({ id: f.folderId, parentId: f.parentId, name: f.name }))

    const depth = depthOf(parentId, nodes)
    if (depth < 0 || !canSee(viewer, parentId, refs)) throw new HttpError(404, 'not_found', 'That folder no longer exists.')
    if (!canCreateFolderIn(viewer, parentId, refs)) {
      throw new HttpError(403, 'forbidden', 'Folders in the organisation’s shared space can only be added by an admin.')
    }
    if (depth + 1 > MAX_FOLDER_DEPTH) {
      throw new HttpError(400, 'too_deep', `Folders can be nested at most ${MAX_FOLDER_DEPTH} levels deep.`)
    }

    const folder = buildFolderItem(ws, {
      id: randomUUID(), parentId, name: checked.name, by: userId, now: Date.now(),
      ownerId: parentId === ROOT_FOLDER_ID ? ownerForNewTopLevelFolder(viewer) : undefined,
    })
    await createFolder(db, ws, folder)

    const nextRefs = [...refs, { folderId: folder.folderId, parentId, ownerId: folder.ownerId }]
    return NextResponse.json({
      folder: toPublicFolder(folder, { shared: ownerOf(folder.folderId, nextRefs) === undefined, canManage: canManage(viewer, folder.folderId, nextRefs) }),
    }, { status: 201 })
  })
}
