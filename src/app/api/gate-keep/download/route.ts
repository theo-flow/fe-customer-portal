import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { BUCKET } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'
import { getScopedS3Client } from '@/lib/gate-keep-credentials'

export async function GET(req: NextRequest) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId  = claims['custom:org_id'] ?? claims.sub
  const userId = claims.sub

  const key = req.nextUrl.searchParams.get('key')
  const ownPrefix = `gate-keep/${orgId}/${userId}/`

  // Defense in depth -- IAM independently refuses a mismatched key regardless,
  // but reject it here too rather than relying solely on that.
  if (!key || !key.startsWith(ownPrefix)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const scopedS3 = await getScopedS3Client(token)
    const downloadUrl = await getSignedUrl(
      scopedS3,
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
      { expiresIn: 300 }
    )
    return NextResponse.json({ downloadUrl })
  } catch (err) {
    console.error('[gate-keep/download] Failed to generate download URL', { orgId, userId, key, error: err })
    return NextResponse.json({ error: 'Failed to prepare download' }, { status: 500 })
  }
}
