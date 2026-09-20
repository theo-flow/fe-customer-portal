import { NextRequest, NextResponse } from 'next/server'
import { gateKeep, HttpError, notFound, readJson } from '@/lib/gate-keep-route'
import { getFile, getFolder, updateFile } from '@/lib/gate-keep-store'
import { removeFile } from '@/lib/gate-keep-ops'
import { ROOT_FOLDER_ID, toPublicFile, validateName } from '@/lib/gate-keep-catalog'

type Ctx = { params: { id: string } }

// Rename and/or move a file. A catalogue change only: the bytes never move.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return gateKeep('files/update', async ({ ws, db }) => {
    const file = await getFile(db, ws, params.id)
    if (!file || file.status !== 'READY' || file.deletedAt) throw notFound()

    const body = await readJson<{ name: string; folderId: string }>(req)

    let name = file.name
    if (body.name !== undefined) {
      const checked = validateName(body.name)
      if (!checked.ok) throw new HttpError(400, 'invalid_name', checked.error)
      name = checked.name
    }

    const folderId = body.folderId ?? file.folderId
    if (folderId !== file.folderId && folderId !== ROOT_FOLDER_ID && !(await getFolder(db, ws, folderId))) {
      throw new HttpError(404, 'not_found', 'That destination no longer exists.')
    }

    if (name === file.name && folderId === file.folderId) {
      return NextResponse.json({ file: toPublicFile(file) })
    }

    await updateFile(db, ws, file, { name, folderId })
    return NextResponse.json({ file: toPublicFile({ ...file, name, folderId }) })
  })
}

// "Remove": the file goes to the trash for 28 days (recoverable), then S3 deletes it.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return gateKeep('files/remove', async ({ ws, s3, db }) => {
    const file = await getFile(db, ws, params.id)
    if (!file || file.status !== 'READY' || file.deletedAt) throw notFound()

    const { purgeAt } = await removeFile(s3, db, ws, file)
    return NextResponse.json({ ok: true, purgeAt: new Date(purgeAt * 1000).toISOString() })
  })
}
