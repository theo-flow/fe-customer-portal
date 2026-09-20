import { NextResponse } from 'next/server'
import { gateKeep, notFound } from '@/lib/gate-keep-route'
import { getFile } from '@/lib/gate-keep-store'
import { restoreRemovedFile } from '@/lib/gate-keep-ops'
import { toPublicFile } from '@/lib/gate-keep-catalog'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return gateKeep('files/restore', async ({ ws, s3, db }) => {
    const file = await getFile(db, ws, params.id)
    if (!file || !file.deletedAt) throw notFound()

    const { name } = await restoreRemovedFile(s3, db, ws, file)
    return NextResponse.json({ file: toPublicFile({ ...file, name }) })
  })
}
