import { NextRequest, NextResponse } from 'next/server'
import { gateKeep, notFound } from '@/lib/gate-keep-route'
import { listFolders, listFolderContents } from '@/lib/gate-keep-store'
import { ROOT_FOLDER_ID, pathTo, toPublicFile, toPublicFolder } from '@/lib/gate-keep-catalog'
import { canCreateFolderIn, canManage, canSee, ownerOf } from '@/lib/gate-keep-access'

// One folder's contents, its breadcrumb, and the folder tree (for the "move to" picker), all
// filtered to what THIS person may see: the organisation's shared space and their own folders,
// or everything for an admin. Another member's private folder is simply not there.
export async function GET(req: NextRequest) {
  return gateKeep('list', async ({ ws, viewer, db }) => {
    const folderId = req.nextUrl.searchParams.get('folder') || ROOT_FOLDER_ID

    const all  = await listFolders(db, ws)
    const refs = all.map(f => ({ folderId: f.folderId, parentId: f.parentId, ownerId: f.ownerId }))
    const seen = all.filter(f => canSee(viewer, f.folderId, refs))
    const nodes = seen.map(f => ({ id: f.folderId, parentId: f.parentId, name: f.name }))

    const path = pathTo(folderId, nodes)
    if (path === null || !canSee(viewer, folderId, refs)) throw notFound()

    const { folders, files } = await listFolderContents(db, ws, folderId)
    const manageHere = canManage(viewer, folderId, refs)

    return NextResponse.json({
      folderId,
      breadcrumb: path.map(({ id, name }) => ({ id, name })),
      folders: folders
        .filter(f => canSee(viewer, f.folderId, refs))
        .map(f => toPublicFolder(f, { shared: ownerOf(f.folderId, refs) === undefined, canManage: canManage(viewer, f.folderId, refs) })),
      files: files.map(f => toPublicFile(f, { canManage: manageHere })),
      tree: nodes,
      // What this person may do in the folder on screen.
      access: {
        isAdmin:         viewer.isAdmin,
        sharedHere:      ownerOf(folderId, refs) === undefined,
        canManageHere:   manageHere,
        canCreateFolder: canCreateFolderIn(viewer, folderId, refs),
      },
    })
  })
}
