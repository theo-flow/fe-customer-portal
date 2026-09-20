import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { NextRequest, NextResponse } from 'next/server'
import { ddbDocClient, sqsClient, TABLE } from '@/lib/aws'
import { generateToken, hashToken, tokenExpiryIso, type SessionStatus, type Signer } from '@/lib/sign'
import { loadOwnedSession, lookupOrgName, isConditionalCheckFailure } from '@/lib/sign-server'

const SQS_SIGN_URL = process.env.SQS_SIGN_URL

const RESENDABLE_SESSION: SessionStatus[] = ['PENDING', 'IN_PROGRESS', 'EXPIRED']

// Mints a fresh signing link for one signer who has not signed yet (typically
// because their link expired) and emails it again. The raw token is never
// stored, so a new one has to be minted; the old link stops working because
// its hash is replaced. Only that signer's email_sent flag is reset, so
// fn-13's exactly-once email logic sends to them alone.
export async function POST(
  req: NextRequest,
  { params }: { params: { sessionId: string } },
) {
  const { sessionId } = params

  let body: { signerId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!body.signerId) return NextResponse.json({ error: 'signerId is required' }, { status: 400 })

  const owned = await loadOwnedSession(sessionId, 'sign/sessions/resend')
  if (!owned.ok) return owned.response
  const { orgId, session } = owned

  if (!RESENDABLE_SESSION.includes(session.status)) {
    return NextResponse.json({ error: 'A new link cannot be sent for this session' }, { status: 409 })
  }

  const signerIndex = session.signers.findIndex(s => s.signer_id === body.signerId)
  if (signerIndex === -1) return NextResponse.json({ error: 'Signer not found' }, { status: 404 })
  const signer = session.signers[signerIndex]
  if (signer.status !== 'PENDING' && signer.status !== 'EXPIRED') {
    return NextResponse.json({ error: 'This signer has already responded' }, { status: 409 })
  }

  const rawToken = generateToken()
  const now = new Date().toISOString()
  const previousUpdatedAt = session.updated_at

  const refreshed: Signer = {
    ...signer,
    status:           'PENDING',
    token_hash:       hashToken(rawToken),
    token_expires_at: tokenExpiryIso(),
    token_used:       false,
    expired_at:       null,
    email_sent:       false,
  }
  session.signers[signerIndex] = refreshed
  // An expired session comes back to life. It is IN_PROGRESS if anyone has
  // already signed, otherwise PENDING.
  if (session.status === 'EXPIRED') {
    session.status = session.signers.some(s => s.status === 'SIGNED') ? 'IN_PROGRESS' : 'PENDING'
  }
  session.updated_at = now

  try {
    await ddbDocClient().send(new PutCommand({
      TableName: TABLE,
      Item: { PK: `SESSION#${sessionId}`, SK: 'SESSION', ...session },
      // If the session changed since we read it (a signer submitted, the
      // daily expiry job ran), refuse rather than overwrite that change.
      ConditionExpression: 'updated_at = :prev',
      ExpressionAttributeValues: { ':prev': previousUpdatedAt },
    }))
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      return NextResponse.json({ error: 'The session changed while you were working. Reload and try again.' }, { status: 409 })
    }
    console.error('[sign/sessions/resend] DynamoDB PutCommand failed', { sessionId, error: err })
    return NextResponse.json({ error: 'Failed to send a new link' }, { status: 500 })
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
  const signUrl = `${origin}/sign/${sessionId}/${signer.signer_id}/${rawToken}`

  let emailQueued = false
  if (SQS_SIGN_URL) {
    try {
      await sqsClient().send(new SendMessageCommand({
        QueueUrl: SQS_SIGN_URL,
        MessageBody: JSON.stringify({
          session_id: sessionId,
          action: 'locate_and_notify',
          signer_links: [{ signer_id: signer.signer_id, sign_url: signUrl }],
          requested_by: await lookupOrgName(orgId),
        }),
      }))
      emailQueued = true
    } catch (err) {
      // The new link is already saved and returned below, so the org can
      // still copy it to the signer by hand.
      console.error('[sign/sessions/resend] Failed to enqueue email', { sessionId, error: err })
    }
  } else {
    console.error('[sign/sessions/resend] SQS_SIGN_URL not configured, email not queued', { sessionId })
  }

  return NextResponse.json({ signerId: signer.signer_id, signUrl, emailQueued })
}
