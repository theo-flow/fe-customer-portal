import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { s3Client, SIGN_BUCKET } from '@/lib/aws'
import { requireOperator, orgExists, isSafeId, sampleKey } from '@/lib/sign-forms-server'

const MAX_CONTENT_LENGTH = 50 * 1024 * 1024

// Step 1 of creating a Sign form: the operator uploads the company's sample
// PDF straight to S3. The form id is minted here, and the key is derived from
// it on the server (never taken from the client), so the create step can
// only ever point at the object this route authorised.
export async function POST(req: NextRequest, { params }: { params: { orgId: string } }) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const { orgId } = params
  if (!isSafeId(orgId)) return NextResponse.json({ error: 'Invalid organisation' }, { status: 400 })
  if (!(await orgExists(orgId))) return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })

  let body: { contentLength?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (typeof body.contentLength === 'number' && body.contentLength > MAX_CONTENT_LENGTH) {
    return NextResponse.json({ error: 'File too large' }, { status: 413 })
  }

  const formId = randomUUID()
  const key = sampleKey(orgId, formId)
  try {
    const uploadUrl = await getSignedUrl(
      s3Client(),
      new PutObjectCommand({ Bucket: SIGN_BUCKET, Key: key, ContentType: 'application/pdf' }),
      { expiresIn: 300 },
    )
    return NextResponse.json({ formId, uploadUrl })
  } catch (err) {
    console.error('[operator/sign-forms/sample] Failed to presign', { orgId, formId, error: err })
    return NextResponse.json({ error: 'Failed to prepare upload' }, { status: 500 })
  }
}
