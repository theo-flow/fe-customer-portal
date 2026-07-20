import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { NextRequest, NextResponse } from 'next/server'
import { ddbDocClient, sqsClient, TABLE } from '@/lib/aws'
import { hashToken, type SignSession } from '@/lib/sign'

const SQS_SIGN_URL = process.env.SQS_SIGN_URL

export async function POST(
  req: NextRequest,
  { params }: { params: { sessionId: string; signerId: string; token: string } },
) {
  const { sessionId, signerId, token } = params

  let body: { signatureType?: 'DRAWN' | 'TYPED'; signatureData?: string; placeData?: string }
  try {
    body = await req.json()
  } catch (err) {
    console.error('[public/sign/submit] Failed to parse request body', { sessionId, error: err })
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { signatureType, signatureData, placeData } = body
  if (!signatureType || !signatureData) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }
  if (signatureType !== 'DRAWN' && signatureType !== 'TYPED') {
    return NextResponse.json({ error: 'Invalid signature type' }, { status: 400 })
  }

  const db = ddbDocClient()

  let session: SignSession
  try {
    const result = await db.send(new GetCommand({
      TableName: TABLE,
      Key:       { PK: `SESSION#${sessionId}`, SK: 'SESSION' },
    }))
    if (!result.Item) return NextResponse.json({ error: 'Signing session not found' }, { status: 404 })
    session = result.Item as SignSession
  } catch (err) {
    console.error('[public/sign/submit] DynamoDB GetCommand failed', { sessionId, error: err })
    return NextResponse.json({ error: 'Failed to load signing session' }, { status: 500 })
  }

  const signerIndex = session.signers.findIndex(s => s.signer_id === signerId)
  if (signerIndex === -1) {
    return NextResponse.json({ error: 'Signer not found' }, { status: 404 })
  }
  const signer = session.signers[signerIndex]

  if (signer.token_hash !== hashToken(token)) {
    return NextResponse.json({ error: 'Invalid signing link' }, { status: 403 })
  }
  if (signer.token_used || new Date(signer.token_expires_at) < new Date()) {
    return NextResponse.json({ error: 'This signing link has expired or already been used' }, { status: 403 })
  }
  if (signer.status === 'SIGNED') {
    return NextResponse.json({ error: 'You have already signed this document' }, { status: 409 })
  }
  if (session.status === 'CANCELLED' || session.status === 'EXPIRED' || session.status === 'FAILED') {
    return NextResponse.json({ error: 'This document is no longer available for signature' }, { status: 409 })
  }

  const now = new Date().toISOString()
  const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = req.headers.get('user-agent') ?? null

  session.signers[signerIndex] = {
    ...signer,
    status:          'SIGNED',
    signed_at:        now,
    ip_address:       ipAddress,
    user_agent:       userAgent,
    signature_type:   signatureType,
    signature_data:   signatureData,
    place_data:       placeData?.trim() || signer.place_data,
    token_used:       true,
  }

  // Every submit advances the session to IN_PROGRESS, including the last
  // signer's -- only fn-13's post-seal write ever sets SIGNED. Previously
  // this left status unchanged when allSigned was already true, so a
  // single-signer session never left PENDING until the async seal Lambda
  // caught up.
  const allSigned = session.signers.every(s => s.status === 'SIGNED')
  session.status = 'IN_PROGRESS'
  session.updated_at = now

  try {
    await db.send(new PutCommand({
      TableName: TABLE,
      Item:      { PK: `SESSION#${sessionId}`, SK: 'SESSION', ...session },
    }))
  } catch (err) {
    console.error('[public/sign/submit] DynamoDB PutCommand failed', { sessionId, signerId, error: err })
    return NextResponse.json({ error: 'Failed to record signature' }, { status: 500 })
  }

  if (allSigned) {
    if (!SQS_SIGN_URL) {
      console.error('[public/sign/submit] SQS_SIGN_URL not configured — session will not be sealed', { sessionId })
    } else {
      try {
        await sqsClient().send(new SendMessageCommand({
          QueueUrl:    SQS_SIGN_URL,
          MessageBody: JSON.stringify({ session_id: sessionId }),
        }))
      } catch (err) {
        console.error('[public/sign/submit] Failed to publish sealing message', { sessionId, error: err })
        return NextResponse.json({ error: 'Signature recorded, but sealing could not be triggered' }, { status: 500 })
      }
    }
  }

  return NextResponse.json({ ok: true })
}
