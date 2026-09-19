import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { hashToken, type SignSession } from '@/lib/sign'
import { cleanDeclineReason } from '@/lib/sign-consent'
import { enqueueSignNotice } from '@/lib/sign-notify'
import { isConditionalCheckFailure } from '@/lib/sign-server'

// A signer who will not sign can say so, and say why. That ends the whole
// session (nobody else can sign it any more) and the person who sent it is
// told. Token-authenticated like the rest of the public signing routes, and
// written the same way as submit: conditional on the session not having
// changed since it was read, re-reading on a clash, so it cannot overwrite a
// signature that landed a moment earlier.
const MAX_ATTEMPTS = 5

type Params = { sessionId: string; signerId: string; token: string }

const fail = (error: string, status: number) => NextResponse.json({ error }, { status })

export async function POST(req: NextRequest, { params }: { params: Params }) {
  const { sessionId, signerId, token } = params

  let body: { reason?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    // no body is fine: the reason is optional
  }
  const reason = cleanDeclineReason(body?.reason)

  const db = ddbDocClient()

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let session: SignSession
    try {
      const result = await db.send(new GetCommand({ TableName: TABLE, Key: { PK: `SESSION#${sessionId}`, SK: 'SESSION' } }))
      if (!result.Item) return fail('Signing session not found', 404)
      session = result.Item as SignSession
    } catch (err) {
      console.error('[public/sign/decline] DynamoDB GetCommand failed', { sessionId, error: err })
      return fail('Failed to load signing session', 500)
    }

    const signerIndex = session.signers.findIndex(s => s.signer_id === signerId)
    if (signerIndex === -1) return fail('Signer not found', 404)
    const signer = session.signers[signerIndex]

    if (signer.token_hash !== hashToken(token)) return fail('Invalid signing link', 403)
    if (signer.token_used || new Date(signer.token_expires_at) < new Date()) {
      return fail('This signing link has expired or already been used', 403)
    }
    if (signer.status === 'SIGNED') return fail('You have already signed this document', 409)
    if (['DRAFT', 'SIGNED', 'CANCELLED', 'EXPIRED', 'FAILED', 'DECLINED'].includes(session.status)) {
      return fail('This document is no longer available', 409)
    }

    const now = new Date().toISOString()
    const previousUpdatedAt = session.updated_at
    session.signers[signerIndex] = {
      ...signer,
      status:         'DECLINED',
      decline_reason: reason || null,
      declined_at:    now,
      ip_address:     req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      user_agent:     req.headers.get('user-agent') ?? null,
      token_used:     true,   // the link is spent
    }
    session.status = 'DECLINED'
    session.updated_at = now

    try {
      await db.send(new PutCommand({
        TableName: TABLE,
        Item: { PK: `SESSION#${sessionId}`, SK: 'SESSION', ...session },
        ConditionExpression: 'updated_at = :prev',
        ExpressionAttributeValues: { ':prev': previousUpdatedAt },
      }))
    } catch (err) {
      if (isConditionalCheckFailure(err) && attempt < MAX_ATTEMPTS) continue
      if (isConditionalCheckFailure(err)) return fail('Many people are using this document at once. Please try again.', 409)
      console.error('[public/sign/decline] DynamoDB PutCommand failed', { sessionId, signerId, error: err })
      return fail('Failed to record your decision', 500)
    }

    // Tell whoever sent it. Best-effort: the decline is already saved.
    const meta = (session.metadata ?? {}) as { created_by_email?: string; form_name?: string }
    const what = meta.form_name ?? session.source_document.s3_key.split('/').pop() ?? 'the document'
    const who = signer.role ? `${signer.name} (${signer.role})` : signer.name
    await enqueueSignNotice({
      correlationId:    sessionId,
      notificationType: 'SIGN_DECLINED',
      toEmail:          meta.created_by_email,
      subject:          `Declined: ${what}`,
      bodyText:
        `${who} declined to sign ${what}, so nobody else can sign it now.` +
        (reason ? `\n\nReason given: ${reason}` : '') +
        `\n\nYou can send a new copy from the Sign page in TheoFlow.`,
    })

    return NextResponse.json({ ok: true })
  }

  return fail('Many people are using this document at once. Please try again.', 409)
}
