import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NextResponse } from 'next/server'
import { GATE_KEEP_BUCKET } from '@/lib/aws'
import { gateKeep, notFound } from '@/lib/gate-keep-route'
import { getFile } from '@/lib/gate-keep-store'
import { contentDisposition, s3KeyFor } from '@/lib/gate-keep-catalog'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return gateKeep('files/download', async ({ ws, s3, db }) => {
    const file = await getFile(db, ws, params.id)
    if (!file || file.status !== 'READY' || file.deletedAt) throw notFound()

    const downloadUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: GATE_KEEP_BUCKET,
        Key: s3KeyFor(ws, file.fileId),
        ResponseContentDisposition: contentDisposition(file.name),
      }),
      { expiresIn: 300 },
    )
    return NextResponse.json({ downloadUrl })
  })
}
