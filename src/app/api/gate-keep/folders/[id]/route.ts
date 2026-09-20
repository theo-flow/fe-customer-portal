import { NextRequest, NextResponse } from 'next/server'
import { gateKeep, HttpError, notFound, readJson } from '@/lib/gate-keep-route'
import { deleteFolderIfEmpty, getFolder, listFolders, updateFolder } from '@/lib/gate-keep-store'
import { checkMove, toPublicFolder, validateName } from '@/lib/gate-keep-catalog'

type Ctx = { params: { id: string } }

// Rename and/or move. Purely a catalogue change: no files are touched, so it is
// instant and works on files that are under an Object Lock.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return gateKeep('folders/update', async ({ ws, db }) => {
    const folder = await getFolder(db, ws, params.id)
    if (!folder) throw notFound()

    const body = await readJson<{ name: string; parentId: string }>(req)

    let name = folder.name
    if (body.name !== undefined) {
      const checked = validateName(body.name)
      if (!checked.ok) throw new HttpError(400, 'invalid_name', checked.error)
      name = checked.name
    }
    const parentId = body.parentId ?? folder.parentId

    if (parentId !== folder.parentId) {
      const nodes = (await listFolders(db, ws)).map(f => ({ id: f.folderId, parentId: f.parentId, name: f.name }))
      const problem = checkMove(folder.folderId, parentId, nodes)
      if (problem === 'not_found') throw new HttpError(404, 'not_found', 'That destination no longer exists.')
      if (problem === 'cycle')     throw new HttpError(400, 'cycle', 'A folder cannot be moved into itself.')
      if (problem === 'too_deep')  throw new HttpError(400, 'too_deep', 'That would nest folders too deeply.')
    }

    if (name === folder.name && parentId === folder.parentId) {
      return NextResponse.json({ folder: toPublicFolder(folder) })
    }

    await updateFolder(db, ws, folder, { name, parentId })
    return NextResponse.json({ folder: toPublicFolder({ ...folder, name, parentId }) })
  })
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return gateKeep('folders/delete', async ({ ws, db }) => {
    const folder = await getFolder(db, ws, params.id)
    if (!folder) throw notFound()

    const deleted = await deleteFolderIfEmpty(db, ws, folder)
    if (!deleted) throw new HttpError(409, 'not_empty', 'Move or remove everything inside this folder first.')
    return NextResponse.json({ ok: true })
  })
}
