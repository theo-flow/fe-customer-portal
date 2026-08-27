import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'
import { s3Client, BUCKET } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'

const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/tiff', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv', 'text/plain',
  'application/zip',
  'video/mp4', 'video/quicktime',
  'audio/mpeg', 'audio/wav',
]
const MAX_CONTENT_LENGTH = 50 * 1024 * 1024 // 50 MB — matches the platform-wide presigned-upload ceiling

function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? 'file'
  return base.replace(/[^A-Za-z0-9._-]/g, '_') || 'file'
}

export async function POST(req: NextRequest) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = claims['custom:org_id'] ?? claims.sub

  // Gate-Keep is a baseline capability available to every org — no separate
  // subscribed_products entitlement check, unlike Forge/Decode/Sign.
  let body: { filename?: string; contentType?: string; contentLength?: number }
  try {
    body = await req.json()
  } catch (err) {
    console.error('[gate-keep/presign] Failed to parse request body', { orgId, error: err })
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { filename, contentType, contentLength } = body
  if (!filename || !contentType) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    console.warn('[gate-keep/presign] Rejected unsupported content type', { orgId, filename, contentType })
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 415 })
  }

  if (contentLength !== undefined && contentLength > MAX_CONTENT_LENGTH) {
    console.warn('[gate-keep/presign] Rejected oversized file', { orgId, filename, contentLength })
    return NextResponse.json({ error: 'File too large' }, { status: 413 })
  }

  const key = `gate-keep/${orgId}/${randomUUID()}-${sanitizeFilename(filename)}`

  let uploadUrl: string
  try {
    uploadUrl = await getSignedUrl(
      s3Client(),
      new PutObjectCommand({
        Bucket: BUCKET, Key: key, ContentType: contentType,
      }),
      { expiresIn: 600 }
    )
  } catch (err) {
    console.error('[gate-keep/presign] Failed to generate presigned URL', { orgId, key, error: err })
    return NextResponse.json({ error: 'Failed to prepare upload' }, { status: 500 })
  }

  return NextResponse.json({ uploadUrl, key })
}
