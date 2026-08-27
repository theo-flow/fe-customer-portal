import { ListObjectsV2Command } from '@aws-sdk/client-s3'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { BUCKET } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'
import { getScopedS3Client } from '@/lib/gate-keep-credentials'

export async function GET() {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId  = claims['custom:org_id'] ?? claims.sub
  const userId = claims.sub

  const prefix = `gate-keep/${orgId}/${userId}/`

  try {
    const scopedS3 = await getScopedS3Client(token)
    const result = await scopedS3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix }))

    const files = (result.Contents ?? [])
      .filter(obj => obj.Key && obj.Key !== prefix)
      .map(obj => ({
        key:          obj.Key!,
        filename:     obj.Key!.slice(prefix.length).replace(/^[0-9a-f-]{36}-/, ''),
        size:         obj.Size ?? 0,
        lastModified: obj.LastModified?.toISOString() ?? null,
      }))

    return NextResponse.json({ files })
  } catch (err) {
    console.error('[gate-keep/files] Failed to list files', { orgId, userId, error: err })
    return NextResponse.json({ error: 'Failed to list files' }, { status: 500 })
  }
}
