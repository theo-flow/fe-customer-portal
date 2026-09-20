import { NextResponse } from 'next/server'
import { gateKeep, HttpError, notFound } from '@/lib/gate-keep-route'
import { getFile } from '@/lib/gate-keep-store'
import { purgeFile } from '@/lib/gate-keep-ops'

// Only a file that is already in the trash can be deleted for good, so there is
// always a recoverable step first. A file under Object Lock is refused by S3.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return gateKeep('files/permanent', async ({ ws, s3, db }) => {
    const file = await getFile(db, ws, params.id)
    if (!file || !file.deletedAt) throw notFound()

    const outcome = await purgeFile(s3, db, ws, file)
    if (outcome === 'locked') {
      throw new HttpError(409, 'locked', 'This file is protected by a retention lock and cannot be deleted yet.')
    }
    return NextResponse.json({ ok: true })
  })
}
