import { PutObjectCommand } from '@aws-sdk/client-s3'
import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, s3Client, TABLE, BUCKET } from '@/lib/aws'
import { decodeJwtClaims } from '@/lib/token'

const ALLOWED   = ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff']
const MAX_BYTES = 50 * 1024 * 1024

function slug(s: string) { return s.toLowerCase().replace(/\s+/g, '-') }

export async function POST(req: NextRequest) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = decodeJwtClaims(token)
  const orgId  = claims['custom:org_id'] ?? claims.sub

  const db      = ddbDocClient()
  const profile = await db.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `ORG#${orgId}`, SK: 'PROFILE' },
  }))
  const subscribed: string[] = profile.Item?.subscribed_products ?? []
  if (!subscribed.includes('forge')) {
    return NextResponse.json({ error: 'Forge subscription required' }, { status: 403 })
  }

  let body: { group?: string; groupLabel?: string; filename?: string; contentType?: string; contentLength?: number }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { group, groupLabel, filename, contentType, contentLength } = body
  if (!group || !groupLabel || !filename || !contentType) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if (!ALLOWED.includes(contentType)) {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 415 })
  }
  if (contentLength !== undefined && contentLength > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large' }, { status: 413 })
  }

  const key = `templates/${orgId}/${slug(groupLabel)}/${filename}`

  let uploadUrl: string
  try {
    uploadUrl = await getSignedUrl(
      s3Client(),
      new PutObjectCommand({
        Bucket: BUCKET, Key: key, ContentType: contentType,
        Metadata: { 'org-id': orgId, 'group': group, 'group-label': groupLabel },
      }),
      { expiresIn: 600 }
    )
  } catch (err) {
    console.error('[templates/presign] Failed to generate presigned URL', { orgId, key, error: err })
    return NextResponse.json({ error: 'Failed to prepare upload' }, { status: 500 })
  }

  return NextResponse.json({ uploadUrl, key })
}
