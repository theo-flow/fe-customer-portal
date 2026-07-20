import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NextRequest, NextResponse } from 'next/server'
import { ddbDocClient, s3Client, TABLE, BUCKET } from '@/lib/aws'
import { hashToken, type SignSession } from '@/lib/sign'

// Short-lived, matching the other presign routes' convention -- long enough
// for a page load, short enough that a leaked URL isn't useful for long.
const URL_EXPIRY_SECONDS = 300

// Unauthenticated (no login) but token-verified, mirroring the public submit
// route's checks -- lets the signing page render the actual source PDF via
// react-pdf without ever exposing the intake bucket directly. token_used
// isn't checked here (only submit sets it): a signer legitimately re-fetches
// the document while still on the signing page, before submitting.
export async function GET(
  req: NextRequest,
  { params }: { params: { sessionId: string; signerId: string; token: string } },
) {
  const { sessionId, signerId, token } = params

  let session: SignSession
  try {
    const result = await ddbDocClient().send(new GetCommand({
      TableName: TABLE,
      Key: { PK: `SESSION#${sessionId}`, SK: 'SESSION' },
    }))
    if (!result.Item) return NextResponse.json({ error: 'Signing session not found' }, { status: 404 })
    session = result.Item as SignSession
  } catch (err) {
    console.error('[public/sign/document] DynamoDB GetCommand failed', { sessionId, error: err })
    return NextResponse.json({ error: 'Failed to load signing session' }, { status: 500 })
  }

  const signer = session.signers.find(s => s.signer_id === signerId)
  if (!signer || signer.token_hash !== hashToken(token)) {
    return NextResponse.json({ error: 'Invalid signing link' }, { status: 403 })
  }
  if (new Date(signer.token_expires_at) < new Date()) {
    return NextResponse.json({ error: 'This signing link has expired' }, { status: 403 })
  }

  try {
    const url = await getSignedUrl(
      s3Client(),
      new GetObjectCommand({ Bucket: BUCKET, Key: session.source_document.s3_key }),
      { expiresIn: URL_EXPIRY_SECONDS },
    )
    return NextResponse.json({
      url,
      detectedFields: (session.working_document?.detected_fields ?? [])
        .filter(f => f.signer_order === signer.order),
    })
  } catch (err) {
    console.error('[public/sign/document] Failed to generate presigned URL', { sessionId, signerId, error: err })
    return NextResponse.json({ error: 'Failed to load document' }, { status: 500 })
  }
}
