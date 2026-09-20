import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { gateKeep, HttpError, readJson } from '@/lib/gate-keep-route'
import { createFolder, listFolders } from '@/lib/gate-keep-store'
import {
  MAX_FOLDER_DEPTH, ROOT_FOLDER_ID, buildFolderItem, depthOf, toPublicFolder, validateName,
} from '@/lib/gate-keep-catalog'

export async function POST(req: NextRequest) {
  return gateKeep('folders/create', async ({ ws, userId, db }) => {
    const body = await readJson<{ parentId: string; name: string }>(req)

    const checked = validateName(body.name)
    if (!checked.ok) throw new HttpError(400, 'invalid_name', checked.error)

    const parentId = body.parentId || ROOT_FOLDER_ID
    const nodes = (await listFolders(db, ws)).map(f => ({ id: f.folderId, parentId: f.parentId, name: f.name }))
    const depth = depthOf(parentId, nodes)
    if (depth < 0) throw new HttpError(404, 'not_found', 'That folder no longer exists.')
    if (depth + 1 > MAX_FOLDER_DEPTH) {
      throw new HttpError(400, 'too_deep', `Folders can be nested at most ${MAX_FOLDER_DEPTH} levels deep.`)
    }

    const folder = buildFolderItem(ws, { id: randomUUID(), parentId, name: checked.name, by: userId, now: Date.now() })
    await createFolder(db, ws, folder)
    return NextResponse.json({ folder: toPublicFolder(folder) }, { status: 201 })
  })
}
