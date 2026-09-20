import { randomUUID } from 'crypto'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NextRequest, NextResponse } from 'next/server'
import { GATE_KEEP_BUCKET } from '@/lib/aws'
import { gateKeep, HttpError, readJson } from '@/lib/gate-keep-route'
import { createPendingFile, getFolder } from '@/lib/gate-keep-store'
import {
  ALLOWED_CONTENT_TYPES, MAX_UPLOAD_BYTES, ROOT_FOLDER_ID, buildPendingFile, s3KeyFor, validateName,
} from '@/lib/gate-keep-catalog'

// Step 1 of an upload: reserve a catalogue row (not yet visible) and hand back a
// presigned PUT to {workspace}/{fileId}. The file appears in its folder only
// after step 2 (.../confirm) has checked that the bytes really arrived.
export async function POST(req: NextRequest) {
  return gateKeep('files/create', async ({ ws, userId, s3, db }) => {
    const body = await readJson<{ folderId: string; filename: string; contentType: string; contentLength: number }>(req)

    // Keep only the file's own name, whatever path the browser reported.
    const base    = typeof body.filename === 'string' ? body.filename.split(/[\\/]/).pop() ?? '' : ''
    const checked = validateName(base)
    if (!checked.ok) throw new HttpError(400, 'invalid_name', checked.error)

    const contentType = body.contentType
    if (!contentType || !ALLOWED_CONTENT_TYPES.includes(contentType)) {
      throw new HttpError(415, 'unsupported_type', 'Unsupported file type.')
    }

    const size = body.contentLength
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
      throw new HttpError(400, 'invalid_size', 'The file appears to be empty.')
    }
    if (size > MAX_UPLOAD_BYTES) {
      throw new HttpError(413, 'too_large', `File too large. Max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`)
    }

    const folderId = body.folderId || ROOT_FOLDER_ID
    if (folderId !== ROOT_FOLDER_ID && !(await getFolder(db, ws, folderId))) {
      throw new HttpError(404, 'not_found', 'That folder no longer exists.')
    }

    const fileId = randomUUID()
    await createPendingFile(db, ws, buildPendingFile(ws, {
      id: fileId, folderId, name: checked.name, contentType, size, by: userId, now: Date.now(),
    }))

    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: GATE_KEEP_BUCKET, Key: s3KeyFor(ws, fileId), ContentType: contentType }),
      { expiresIn: 600 },
    )
    return NextResponse.json({ fileId, uploadUrl }, { status: 201 })
  })
}
