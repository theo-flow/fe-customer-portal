import { NextResponse } from 'next/server'
import { gateKeep } from '@/lib/gate-keep-route'
import { listTrash } from '@/lib/gate-keep-store'
import { purgeFile } from '@/lib/gate-keep-ops'
import { toPublicTrashFile } from '@/lib/gate-keep-catalog'

export async function GET() {
  return gateKeep('trash/list', async ({ ws, db }) => {
    const files = await listTrash(db, ws)
    return NextResponse.json({ files: files.map(toPublicTrashFile) })
  })
}

// Empty trash: delete every removed file for good, one at a time so a file that
// is under a retention lock is skipped and reported instead of failing the rest.
export async function DELETE() {
  return gateKeep('trash/empty', async ({ ws, s3, db }) => {
    const files = await listTrash(db, ws)
    let deleted = 0
    const locked: string[] = []
    for (const file of files) {
      if (await purgeFile(s3, db, ws, file) === 'deleted') deleted++
      else locked.push(file.name)
    }
    return NextResponse.json({ deleted, locked })
  })
}
