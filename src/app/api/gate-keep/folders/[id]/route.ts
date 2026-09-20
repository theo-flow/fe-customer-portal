import { NextRequest, NextResponse } from 'next/server'
import { gateKeep, HttpError, notFound, readJson } from '@/lib/gate-keep-route'
import { deleteFolderIfEmpty, getFolder, listFolders, updateFolder } from '@/lib/gate-keep-store'
import { ROOT_FOLDER_ID, checkMove, toPublicFolder, validateName } from '@/lib/gate-keep-catalog'
import { canManage, canMoveFolder, canSee, deniedMessage, ownerToKeepAtTopLevel } from '@/lib/gate-keep-access'

type Ctx = { params: { id: string } }

// Rename and/or move. Purely a catalogue change: no files are touched, so it is
// instant and works on files that are under an Object Lock.
//
// Who may: the member who owns the folder, and admins. A folder in the organisation's shared
// space is changed by admins only. A folder you cannot see does not exist as far as you know.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return gateKeep('folders/update', async ({ ws, viewer, db }) => {
    const folder = await getFolder(db, ws, params.id)
    const all  = await listFolders(db, ws)
    const refs = all.map(f => ({ folderId: f.folderId, parentId: f.parentId, ownerId: f.ownerId }))
    if (!folder || !canSee(viewer, folder.folderId, refs)) throw notFound()
    if (!canManage(viewer, folder.folderId, refs)) throw new HttpError(403, 'forbidden', deniedMessage(folder.folderId, refs))

    const body = await readJson<{ name: string; parentId: string }>(req)

    let name = folder.name
    if (body.name !== undefined) {
      const checked = validateName(body.name)
      if (!checked.ok) throw new HttpError(400, 'invalid_name', checked.error)
      name = checked.name
    }
    const parentId = body.parentId ?? folder.parentId

    let ownerId: string | null | undefined
    if (parentId !== folder.parentId) {
      const nodes = all.map(f => ({ id: f.folderId, parentId: f.parentId, name: f.name }))
      const problem = checkMove(folder.folderId, parentId, nodes)
      if (problem === 'not_found') throw new HttpError(404, 'not_found', 'That destination no longer exists.')
      if (problem === 'cycle')     throw new HttpError(400, 'cycle', 'A folder cannot be moved into itself.')
      if (problem === 'too_deep')  throw new HttpError(400, 'too_deep', 'That would nest folders too deeply.')
      if (!canSee(viewer, parentId, refs)) throw new HttpError(404, 'not_found', 'That destination no longer exists.')
      if (!canMoveFolder(viewer, folder.folderId, parentId, refs)) {
        throw new HttpError(403, 'forbidden', 'You can only move your own folders into your own folders.')
      }
      // A folder that becomes top-level keeps whoever owned it, so it does not turn shared by accident.
      // One that moves under another folder takes that folder's owner, so its own marker is cleared.
      ownerId = parentId === ROOT_FOLDER_ID ? (ownerToKeepAtTopLevel(folder.folderId, refs) ?? null) : null
    }

    if (name === folder.name && parentId === folder.parentId) {
      return NextResponse.json({ folder: toPublicFolder(folder) })
    }

    await updateFolder(db, ws, folder, { name, parentId, ownerId })
    return NextResponse.json({ folder: toPublicFolder({ ...folder, name, parentId }) })
  })
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return gateKeep('folders/delete', async ({ ws, viewer, db }) => {
    const folder = await getFolder(db, ws, params.id)
    const refs = (await listFolders(db, ws)).map(f => ({ folderId: f.folderId, parentId: f.parentId, ownerId: f.ownerId }))
    if (!folder || !canSee(viewer, folder.folderId, refs)) throw notFound()
    if (!canManage(viewer, folder.folderId, refs)) throw new HttpError(403, 'forbidden', deniedMessage(folder.folderId, refs))

    const deleted = await deleteFolderIfEmpty(db, ws, folder)
    if (!deleted) throw new HttpError(409, 'not_empty', 'Move or remove everything inside this folder first.')
    return NextResponse.json({ ok: true })
  })
}
