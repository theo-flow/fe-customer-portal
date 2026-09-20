import { NextRequest, NextResponse } from 'next/server'
import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { GATE_KEEP_BUCKET } from '@/lib/aws'
import { gateKeep, HttpError, notFound, readJson } from '@/lib/gate-keep-route'
import { deleteFile, getFile, getFolder, listFolders, updateFile } from '@/lib/gate-keep-store'
import { canManage, canMoveFile, canSee, deniedMessage } from '@/lib/gate-keep-access'
import { ROOT_FOLDER_ID, isProtected, s3KeyFor, toPublicFile, validateName } from '@/lib/gate-keep-catalog'

type Ctx = { params: { id: string } }

const niceDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const lockedError = (until?: string | null) => new HttpError(
  409, 'locked',
  until
    ? `This file is protected and cannot be deleted until ${niceDate(until)}.`
    : 'This file is protected by a retention lock and cannot be deleted yet.',
)

// Rename and/or move a file. A catalogue change only: the bytes never move.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return gateKeep('files/update', async ({ ws, viewer, db }) => {
    const file = await getFile(db, ws, params.id)
    if (!file || file.status !== 'READY') throw notFound()
    const folders = await listFolders(db, ws)
    if (!canSee(viewer, file.folderId, folders)) throw notFound()
    if (!canManage(viewer, file.folderId, folders)) throw new HttpError(403, 'forbidden', deniedMessage(file.folderId, folders))

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

    if (folderId !== file.folderId && !canMoveFile(viewer, file.folderId, folderId, folders)) {
      throw new HttpError(403, 'forbidden', 'You can only move your own files between your own folders.')
    }

    if (name === file.name && folderId === file.folderId) {
      return NextResponse.json({ file: toPublicFile(file) })
    }

    await updateFile(db, ws, file, { name, folderId })
    return NextResponse.json({ file: toPublicFile({ ...file, name, folderId }) })
  })
}

// The user's own delete: final and immediate. The file's own version is deleted
// in S3 (no delete marker, nothing kept behind), then its catalogue row goes.
// S3 refuses while the version is under Object Lock; the row is then kept.
// S3 first, so a retry after a failed catalogue step simply finishes the job
// (deleting an already-gone version succeeds).
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return gateKeep('files/delete', async ({ ws, viewer, s3, db }) => {
    const file = await getFile(db, ws, params.id)
    if (!file || file.status !== 'READY') throw notFound()
    const folders = await listFolders(db, ws)
    if (!canSee(viewer, file.folderId, folders)) throw notFound()
    if (!canManage(viewer, file.folderId, folders)) throw new HttpError(403, 'forbidden', deniedMessage(file.folderId, folders))
    if (!file.versionId) throw new Error(`File ${file.fileId} has no recorded version`)
    if (isProtected(file)) throw lockedError(file.retainUntil)

    try {
      await s3.send(new DeleteObjectCommand({
        Bucket: GATE_KEEP_BUCKET, Key: s3KeyFor(ws, file.fileId), VersionId: file.versionId,
      }))
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
      if (e?.name === 'AccessDenied' || e?.$metadata?.httpStatusCode === 403) {
        throw lockedError(file.retainUntil)
      }
      throw err
    }

    await deleteFile(db, ws, file)
    return NextResponse.json({ ok: true })
  })
}
