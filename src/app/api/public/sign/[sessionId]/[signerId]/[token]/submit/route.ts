import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { NextRequest, NextResponse } from 'next/server'
import { ddbDocClient, sqsClient, TABLE } from '@/lib/aws'
import { hashToken, type SignSession, type Signer } from '@/lib/sign'
import { requirements, placeValueFor, validateSubmission, type Submission } from '@/lib/sign-tasks'
import { isConditionalCheckFailure } from '@/lib/sign-server'

const SQS_SIGN_URL = process.env.SQS_SIGN_URL

// Several people sign the same session, often at the same moment (two
// witnesses on one form). Each submit rewrites the session item, so the write
// is conditional on it not having changed since it was read; on a clash the
// submit is re-read and re-applied instead of overwriting someone else's
// signature.
const MAX_ATTEMPTS = 5

type Params = { sessionId: string; signerId: string; token: string }

const fail = (error: string, status: number) => NextResponse.json({ error }, { status })

export async function POST(req: NextRequest, { params }: { params: Params }) {
  const { sessionId, signerId, token } = params

  let body: Submission
  try {
    body = await req.json()
  } catch (err) {
    console.error('[public/sign/submit] Failed to parse request body', { sessionId, error: err })
    return fail('Invalid request body', 400)
  }
  if (!body || typeof body !== 'object') return fail('Invalid request body', 400)

  const db = ddbDocClient()

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let session: SignSession
    try {
      const result = await db.send(new GetCommand({ TableName: TABLE, Key: { PK: `SESSION#${sessionId}`, SK: 'SESSION' } }))
      if (!result.Item) return fail('Signing session not found', 404)
      session = result.Item as SignSession
    } catch (err) {
      console.error('[public/sign/submit] DynamoDB GetCommand failed', { sessionId, error: err })
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
    if (['DRAFT', 'CANCELLED', 'EXPIRED', 'FAILED', 'DECLINED'].includes(session.status)) {
      return fail('This document is no longer available for signature', 409)
    }

    // What THIS person was asked for, from the boxes saved on the session.
    // Checked here because the browser cannot be trusted to have asked.
    const mine = (session.working_document?.detected_fields ?? []).filter(f => f.signer_order === signer.order)
    const problem = validateSubmission(mine, body)
    if (problem) return fail(problem, 400)

    const now = new Date().toISOString()
    const need = requirements(mine)
    const placeBoxes = need.places
    const fieldValues: Signer['field_values'] = {}
    for (const box of placeBoxes) {
      if (box.field_id) fieldValues[box.field_id] = { value: placeValueFor(box, body), at: now }
    }
    const firstPlace = placeBoxes.length > 0 ? placeValueFor(placeBoxes[0], body) : ''

    session.signers[signerIndex] = {
      ...signer,
      status:          'SIGNED',
      signed_at:       now,
      ip_address:      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      user_agent:      req.headers.get('user-agent') ?? null,
      signature_type:  body.signatureData ? (body.signatureType ?? null) : signer.signature_type,
      signature_data:  body.signatureData ? body.signatureData.trim() : signer.signature_data,
      initials_type:   body.initialsData ? (body.initialsType ?? null) : (signer.initials_type ?? null),
      initials_data:   body.initialsData ? body.initialsData.trim() : (signer.initials_data ?? null),
      place_data:      firstPlace || signer.place_data,
      field_values:    { ...(signer.field_values ?? {}), ...fieldValues },
      token_used:      true,
    }

    // Every submit moves the session to IN_PROGRESS, including the last
    // signer's: only fn-13's post-seal write ever sets SIGNED.
    const previousUpdatedAt = session.updated_at
    const allSigned = session.signers.every(s => s.status === 'SIGNED')
    session.status = 'IN_PROGRESS'
    session.updated_at = now

    try {
      await db.send(new PutCommand({
        TableName: TABLE,
        Item: { PK: `SESSION#${sessionId}`, SK: 'SESSION', ...session },
        ConditionExpression: 'updated_at = :prev',
        ExpressionAttributeValues: { ':prev': previousUpdatedAt },
      }))
    } catch (err) {
      if (isConditionalCheckFailure(err) && attempt < MAX_ATTEMPTS) continue   // someone else just saved: re-read and try again
      if (isConditionalCheckFailure(err)) return fail('Many people are signing at once. Please try again.', 409)
      console.error('[public/sign/submit] DynamoDB PutCommand failed', { sessionId, signerId, error: err })
      return fail('Failed to record signature', 500)
    }

    if (allSigned) {
      if (!SQS_SIGN_URL) {
        console.error('[public/sign/submit] SQS_SIGN_URL not configured, session will not be sealed', { sessionId })
      } else {
        try {
          await sqsClient().send(new SendMessageCommand({ QueueUrl: SQS_SIGN_URL, MessageBody: JSON.stringify({ session_id: sessionId }) }))
        } catch (err) {
          console.error('[public/sign/submit] Failed to publish sealing message', { sessionId, error: err })
          return fail('Signature recorded, but sealing could not be triggered', 500)
        }
      }
    }

    return NextResponse.json({ ok: true })
  }

  return fail('Many people are signing at once. Please try again.', 409)
}
