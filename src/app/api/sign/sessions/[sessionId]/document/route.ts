import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, s3Client, TABLE, BUCKET } from '@/lib/aws'
import { decodeJwtClaims } from '@/lib/token'
import type { SignSession } from '@/lib/sign'

const URL_EXPIRY_SECONDS = 300

// Authenticated -- for the org that created the session to view/download
// either the completed (sealed) document, or the original source document
// if signing isn't finished yet. Ownership is checked via the ORG#/SESSION#
// pointer (same pattern GET /api/sign/sessions already uses to list an
// org's own sessions) before ever touching the SESSION# item itself.
export async function GET(
  req: NextRequest,
  { params }: { params: { sessionId: string } },
) {
  const { sessionId } = params

  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = decodeJwtClaims(token)
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = ddbDocClient()

  const pointer = await db.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `ORG#${orgId}`, SK: `SESSION#${sessionId}` },
  })).catch(err => {
    console.error('[sign/sessions/document] Pointer lookup failed', { orgId, sessionId, error: err })
    return null
  })
  if (!pointer?.Item) {
    // Either it doesn't exist or it belongs to a different org -- same 404
    // either way, don't leak which.
    return NextResponse.json({ error: 'Signing session not found' }, { status: 404 })
  }

  let session: SignSession
  try {
    const result = await db.send(new GetCommand({
      TableName: TABLE,
      Key: { PK: `SESSION#${sessionId}`, SK: 'SESSION' },
    }))
    if (!result.Item) return NextResponse.json({ error: 'Signing session not found' }, { status: 404 })
    session = result.Item as SignSession
  } catch (err) {
    console.error('[sign/sessions/document] DynamoDB GetCommand failed', { sessionId, error: err })
    return NextResponse.json({ error: 'Failed to load signing session' }, { status: 500 })
  }

  const key = session.completed_document?.s3_key ?? session.source_document.s3_key
  const isCompleted = !!session.completed_document?.s3_key

  try {
    const url = await getSignedUrl(
      s3Client(),
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
      { expiresIn: URL_EXPIRY_SECONDS },
    )
    return NextResponse.json({ url, isCompleted })
  } catch (err) {
    console.error('[sign/sessions/document] Failed to generate presigned URL', { sessionId, key, error: err })
    return NextResponse.json({ error: 'Failed to load document' }, { status: 500 })
  }
}
