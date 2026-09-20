import { NextRequest, NextResponse } from 'next/server'
import { gateKeep, notFound } from '@/lib/gate-keep-route'
import { listFolders, listFolderContents } from '@/lib/gate-keep-store'
import { ROOT_FOLDER_ID, pathTo, toPublicFile, toPublicFolder } from '@/lib/gate-keep-catalog'

// One folder's contents, its breadcrumb, and the whole (small) folder tree so the
// browser can offer a "move to" picker without a second request.
export async function GET(req: NextRequest) {
  return gateKeep('list', async ({ ws, db }) => {
    const folderId = req.nextUrl.searchParams.get('folder') || ROOT_FOLDER_ID

    const all   = await listFolders(db, ws)
    const nodes = all.map(f => ({ id: f.folderId, parentId: f.parentId, name: f.name }))
    const path  = pathTo(folderId, nodes)
    if (path === null) throw notFound()

    const { folders, files } = await listFolderContents(db, ws, folderId)
    return NextResponse.json({
      folderId,
      breadcrumb: path.map(({ id, name }) => ({ id, name })),
      folders:    folders.map(toPublicFolder),
      files:      files.map(toPublicFile),
      tree:       nodes,
    })
  })
}
