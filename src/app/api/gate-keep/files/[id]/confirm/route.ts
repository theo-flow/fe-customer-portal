import { DeleteObjectCommand, HeadObjectCommand, PutObjectTaggingCommand } from '@aws-sdk/client-s3'
import { NextResponse } from 'next/server'
import { GATE_KEEP_BUCKET } from '@/lib/aws'
import { gateKeep, HttpError, notFound } from '@/lib/gate-keep-route'
import { confirmFile, getFile, getFolder, listFolders } from '@/lib/gate-keep-store'
import { canSee } from '@/lib/gate-keep-access'
import { EOL_TAG_KEY, eolDate, eolTagValue } from '@/lib/gate-keep-eol'
import { getOrgRetentionYears } from '@/lib/org-retention'
import { MAX_UPLOAD_BYTES, ROOT_FOLDER_ID, s3KeyFor, toPublicFile } from '@/lib/gate-keep-catalog'

// Step 2 of an upload: check the bytes really arrived, then list the file in its
// folder. Safe to call twice: an already-confirmed file is returned as it is.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return gateKeep('files/confirm', async ({ ws, viewer, s3, db }) => {
    const file = await getFile(db, ws, params.id)
    if (!file) throw notFound()
    const folders = await listFolders(db, ws)
    const folderGone = file.folderId !== ROOT_FOLDER_ID && !folders.some(f => f.folderId === file.folderId)
    if (!(file.createdBy === viewer.userId || viewer.isAdmin) || !(folderGone || canSee(viewer, file.folderId, folders))) {
      throw notFound()
    }
    if (file.status === 'READY') return NextResponse.json({ file: toPublicFile(file) })

    const key = s3KeyFor(ws, file.fileId)
    let head
    try {
      head = await s3.send(new HeadObjectCommand({ Bucket: GATE_KEEP_BUCKET, Key: key }))
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      if (status === 404) throw new HttpError(409, 'upload_incomplete', 'The upload did not finish. Please try again.')
      throw err
    }

    const size = head.ContentLength ?? 0
    if (size > MAX_UPLOAD_BYTES) {
      // The presigned URL cannot cap the size, so an oversized object is discarded here.
      await s3.send(new DeleteObjectCommand({ Bucket: GATE_KEEP_BUCKET, Key: key, VersionId: head.VersionId })).catch(() => {})
      throw new HttpError(413, 'too_large', `File too large. Max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`)
    }
    if (!head.VersionId) throw new Error('S3 did not return a version id (is versioning on?)')

    // If the folder was deleted while the upload ran, the file lands in the root.
    const folderId = file.folderId === ROOT_FOLDER_ID || (await getFolder(db, ws, file.folderId)) ? file.folderId : ROOT_FOLDER_ID

    // An organisation with an agreed end-of-life period: tag the file with it FIRST, so the
    // lifecycle rules will act on it, and give the catalogue rows the same date. Tagging before
    // listing means a failure here leaves nothing half done: the upload can simply be retried.
    // (If the agreement cannot be read this throws, rather than adding a file that would outlive it.)
    const years = await getOrgRetentionYears(ws)
    let purgeAt: number | undefined
    if (years) {
      await s3.send(new PutObjectTaggingCommand({
        Bucket: GATE_KEEP_BUCKET, Key: key, VersionId: head.VersionId,
        Tagging: { TagSet: [{ Key: EOL_TAG_KEY, Value: eolTagValue(years) }] },
      }))
      purgeAt = Math.floor(eolDate(Date.now(), years).getTime() / 1000)
    }

    const { name } = await confirmFile(db, ws, file, { folderId, versionId: head.VersionId, size, purgeAt })
    return NextResponse.json({ file: toPublicFile({ ...file, name, folderId, size, status: 'READY' }) })
  })
}
