import { DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { NextResponse } from 'next/server'
import { GATE_KEEP_BUCKET } from '@/lib/aws'
import { gateKeep, HttpError, notFound } from '@/lib/gate-keep-route'
import { confirmFile, getFile, getFolder } from '@/lib/gate-keep-store'
import { MAX_UPLOAD_BYTES, ROOT_FOLDER_ID, s3KeyFor, toPublicFile } from '@/lib/gate-keep-catalog'

// Step 2 of an upload: check the bytes really arrived, then list the file in its
// folder. Safe to call twice: an already-confirmed file is returned as it is.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return gateKeep('files/confirm', async ({ ws, s3, db }) => {
    const file = await getFile(db, ws, params.id)
    if (!file) throw notFound()
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

    const { name } = await confirmFile(db, ws, file, { folderId, versionId: head.VersionId, size })
    return NextResponse.json({ file: toPublicFile({ ...file, name, folderId, size, status: 'READY' }) })
  })
}
