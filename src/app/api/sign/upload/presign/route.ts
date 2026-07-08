import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'
import { s3Client, BUCKET } from '@/lib/aws'
import { decodeJwtClaims } from '@/lib/token'

const MAX_CONTENT_LENGTH = 50 * 1024 * 1024  // 50 MB — kept in sync with the frontend constant

export async function POST(req: NextRequest) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = decodeJwtClaims(token)
  const orgId  = claims['custom:org_id'] ?? claims.sub

  let body: { filename?: string; contentType?: string; contentLength?: number }
  try {
    body = await req.json()
  } catch (err) {
    console.error('[sign/upload/presign] Failed to parse request body', { orgId, error: err })
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { filename, contentType, contentLength } = body

  if (!filename || !contentType) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (contentType !== 'application/pdf') {
    console.warn('[sign/upload/presign] Rejected unsupported content type', { orgId, filename, contentType })
    return NextResponse.json({ error: 'Only PDF documents can be signed' }, { status: 415 })
  }

  if (contentLength !== undefined && contentLength > MAX_CONTENT_LENGTH) {
    console.warn('[sign/upload/presign] Rejected oversized file', { orgId, filename, contentLength })
    return NextResponse.json({ error: 'File too large' }, { status: 413 })
  }

  const sessionId = randomUUID()
  const key       = `sign/source/${sessionId}/${filename}`

  let uploadUrl: string
  try {
    uploadUrl = await getSignedUrl(
      s3Client(),
      new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
      { expiresIn: 300 }
    )
  } catch (err) {
    console.error('[sign/upload/presign] Failed to generate presigned URL', { orgId, sessionId, key, error: err })
    return NextResponse.json({ error: 'Failed to prepare upload' }, { status: 500 })
  }

  return NextResponse.json({ sessionId, uploadUrl, key })
}
