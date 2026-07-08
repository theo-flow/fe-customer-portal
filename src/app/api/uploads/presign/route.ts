import { PutObjectCommand } from '@aws-sdk/client-s3'
import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'
import { ddbDocClient, s3Client, TABLE, BUCKET } from '@/lib/aws'
import { decodeJwtClaims } from '@/lib/token'

const ALLOWED_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff']
const MAX_CONTENT_LENGTH     = 50 * 1024 * 1024  // 50 MB — kept in sync with the frontend constant

export async function POST(req: NextRequest) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = decodeJwtClaims(token)
  const orgId  = claims['custom:org_id'] ?? claims.sub

  let body: { group?: string; groupLabel?: string; filename?: string; contentType?: string; contentLength?: number }
  try {
    body = await req.json()
  } catch (err) {
    console.error('[presign] Failed to parse request body', { orgId, error: err })
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { group, groupLabel, filename, contentType, contentLength } = body

  if (!group || !groupLabel || !filename || !contentType) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    console.warn('[presign] Rejected unsupported content type', { orgId, filename, contentType })
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 415 })
  }

  if (contentLength !== undefined && contentLength > MAX_CONTENT_LENGTH) {
    console.warn('[presign] Rejected oversized file', { orgId, filename, contentLength })
    return NextResponse.json({ error: 'File too large' }, { status: 413 })
  }

  const docId = `DAI-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`
  const key   = `raw/${docId}/${filename}`
  const now   = new Date().toISOString()
  const db    = ddbDocClient()

  try {
    // 1. Status record — looked up by docId on the status page
    await db.send(new PutCommand({
      TableName: TABLE,
      Item: { PK: `DOC#${docId}`, SK: 'STATUS', docId, orgId, status: 'PENDING', product: 'decode', docType: groupLabel, group, groupLabel, filename, fileSize: contentLength ?? 0, s3Key: key, createdAt: now, updatedAt: now },
    }))

    // 2. Org index record — queried by orgId on the dashboard
    await db.send(new PutCommand({
      TableName: TABLE,
      Item: { PK: `ORG#${orgId}`, SK: `DOC#${docId}`, docId, orgId, status: 'PENDING', product: 'decode', docType: groupLabel, group, groupLabel, filename, createdAt: now, updatedAt: now },
    }))
  } catch (err) {
    console.error('[presign] DynamoDB write failed', { orgId, docId, error: err })
    return NextResponse.json({ error: 'Failed to register document' }, { status: 500 })
  }

  let uploadUrl: string
  try {
    uploadUrl = await getSignedUrl(
      s3Client(),
      new PutObjectCommand({
        Bucket: BUCKET, Key: key, ContentType: contentType,
        Metadata: { 'doc-id': docId, 'group': group, 'group-label': groupLabel },
      }),
      { expiresIn: 300 }
    )
  } catch (err) {
    console.error('[presign] Failed to generate presigned URL', { orgId, docId, key, error: err })
    return NextResponse.json({ error: 'Failed to prepare upload' }, { status: 500 })
  }

  return NextResponse.json({ docId, uploadUrl, key })
}
