import { NextRequest, NextResponse } from 'next/server'
import { PutObjectRetentionCommand } from '@aws-sdk/client-s3'
import { GATE_KEEP_BUCKET } from '@/lib/aws'
import { writeAudit } from '@/lib/audit'
import { gateKeep, HttpError, notFound, readJson } from '@/lib/gate-keep-route'
import { getFile, listFolders, setRetention } from '@/lib/gate-keep-store'
import { canManage, canSee, deniedMessage } from '@/lib/gate-keep-access'
import { s3KeyFor, toPublicFile, validateRetention } from '@/lib/gate-keep-catalog'

type Ctx = { params: { id: string } }

// Protect a file from deletion until a date (S3 Object Lock, Governance mode). Nobody can
// delete the file before that date, including its owner and TheoFlow, and the date can only
// be extended. The user's own credentials do this, so AWS enforces the same limits as this
// route does: Governance mode only, at most ten years, and no bypass permission anywhere.
export async function POST(req: NextRequest, { params }: Ctx) {
  return gateKeep('files/retention', async ({ ws, claims, viewer, s3, db }) => {
    const file = await getFile(db, ws, params.id)
    if (!file || file.status !== 'READY') throw notFound()
    const folders = await listFolders(db, ws)
    if (!canSee(viewer, file.folderId, folders)) throw notFound()
    // You may only protect what you could delete.
    if (!canManage(viewer, file.folderId, folders)) throw new HttpError(403, 'forbidden', deniedMessage(file.folderId, folders))
    if (!file.versionId) throw new Error(`File ${file.fileId} has no recorded version`)

    const body = await readJson<{ retainUntil: string }>(req)
    const check = validateRetention(body.retainUntil, Date.now(), file.retainUntil)
    if (!check.ok) throw new HttpError(400, check.code, check.error)

    // S3 first: it is the source of truth. If recording it in the catalogue then fails, a
    // retry succeeds (the same date is accepted by S3 again) and finishes the job.
    try {
      await s3.send(new PutObjectRetentionCommand({
        Bucket: GATE_KEEP_BUCKET,
        Key: s3KeyFor(ws, file.fileId),
        VersionId: file.versionId,
        Retention: { Mode: 'GOVERNANCE', RetainUntilDate: check.until },
      }))
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
      if (e?.name === 'AccessDenied' || e?.$metadata?.httpStatusCode === 403) {
        throw new HttpError(403, 'not_permitted', 'Protection could not be applied to this file.')
      }
      throw err
    }

    await setRetention(db, ws, file, check.until)
    await writeAudit(ws, claims, 'gate_keep.protected', `${file.name} until ${check.until.toISOString().slice(0, 10)}`)

    return NextResponse.json({ file: toPublicFile({ ...file, retainUntil: check.until.toISOString() }) })
  })
}
