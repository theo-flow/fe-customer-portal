import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'
import { ddbDocClient, sqsClient, TABLE } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'

const SQS_GENERATE_URL = process.env.SQS_GENERATE_URL

// Direct "Generate PDF" trigger (Module 9, task 9.5) — independent of TheoFlow Sign.
// Publishes straight onto daai-insure-generate; fn-13 is not involved.
export async function POST(req: NextRequest) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId  = claims['custom:org_id'] ?? claims.sub

  let body: { submissionId?: string }
  try {
    body = await req.json()
  } catch (err) {
    console.error('[print/generate] Failed to parse request body', { orgId, error: err })
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { submissionId } = body
  if (!submissionId) {
    return NextResponse.json({ error: 'Missing submissionId' }, { status: 400 })
  }

  if (!SQS_GENERATE_URL) {
    console.error('[print/generate] SQS_GENERATE_URL not configured')
    return NextResponse.json({ error: 'Print is not configured' }, { status: 500 })
  }

  const db = ddbDocClient()

  try {
    const doc = await db.send(new GetCommand({
      TableName: TABLE,
      Key:       { PK: `DOC#${submissionId}`, SK: 'STATUS' },
    }))
    if (!doc.Item || doc.Item.orgId !== orgId) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }
  } catch (err) {
    console.error('[print/generate] DynamoDB GetCommand failed', { orgId, submissionId, error: err })
    return NextResponse.json({ error: 'Failed to load document' }, { status: 500 })
  }

  try {
    await sqsClient().send(new SendMessageCommand({
      QueueUrl:    SQS_GENERATE_URL,
      MessageBody: JSON.stringify({
        document_id:     submissionId,
        submission_id:   submissionId,
        correlation_id:  randomUUID(),
        source:          'print_requested',
      }),
    }))
  } catch (err) {
    console.error('[print/generate] Failed to publish message', { orgId, submissionId, error: err })
    return NextResponse.json({ error: 'Failed to queue PDF generation' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
