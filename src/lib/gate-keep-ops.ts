import { DeleteObjectCommand, type S3Client } from '@aws-sdk/client-s3'
import { GATE_KEEP_BUCKET } from '@/lib/aws'
import { s3KeyFor, type FileItem } from '@/lib/gate-keep-catalog'
import { deleteFileRow, softDeleteFile, restoreFile, type Db } from '@/lib/gate-keep-store'

// Operations that touch both the archive bucket and the catalogue. S3 is changed
// first, then the catalogue records it; if the catalogue step fails the S3 change
// is undone (best effort) so the two never disagree about whether a file is there.

const isForbidden = (err: unknown) => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
  return e?.name === 'AccessDenied' || e?.$metadata?.httpStatusCode === 403
}

const del = (s3: S3Client, key: string, versionId?: string) =>
  s3.send(new DeleteObjectCommand({ Bucket: GATE_KEEP_BUCKET, Key: key, ...(versionId ? { VersionId: versionId } : {}) }))

// "Remove": without a version id, S3 adds a delete marker on top of the file and
// keeps its bytes. The noncurrent version is then purged by the lifecycle rule
// 28 days later; a version under Object Lock survives until its lock ends.
export async function removeFile(s3: S3Client, db: Db, ws: string, file: FileItem, now = Date.now()) {
  const key = s3KeyFor(ws, file.fileId)
  const res = await del(s3, key)
  if (!res.DeleteMarker || !res.VersionId) throw new Error('S3 did not report a delete marker')

  try {
    return await softDeleteFile(db, ws, file, { deleteMarkerVersionId: res.VersionId, now })
  } catch (err) {
    await del(s3, key, res.VersionId).catch(() => {})   // put the file back in view
    throw err
  }
}

// "Restore": deleting the delete marker makes the previous version current again.
export async function restoreRemovedFile(s3: S3Client, db: Db, ws: string, file: FileItem) {
  if (!file.deleteMarkerVersionId) throw new Error('No delete marker recorded for this file')
  await del(s3, s3KeyFor(ws, file.fileId), file.deleteMarkerVersionId)
  return restoreFile(db, ws, file)
}

// "Delete permanently": remove the file's own version. S3 itself refuses (403)
// while the version is under Object Lock, which we report as 'locked'.
export async function purgeFile(s3: S3Client, db: Db, ws: string, file: FileItem): Promise<'deleted' | 'locked'> {
  const key = s3KeyFor(ws, file.fileId)
  try {
    if (file.versionId) await del(s3, key, file.versionId)
  } catch (err) {
    if (isForbidden(err)) return 'locked'
    throw err
  }
  // Tidy the delete marker too; the lifecycle rule would remove it anyway.
  if (file.deleteMarkerVersionId) await del(s3, key, file.deleteMarkerVersionId).catch(() => {})
  await deleteFileRow(db, ws, file.fileId)
  return 'deleted'
}
