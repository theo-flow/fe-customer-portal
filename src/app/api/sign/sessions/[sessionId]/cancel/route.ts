import { UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { loadOwnedSession, isConditionalCheckFailure } from '@/lib/sign-server'

// A session can be cancelled while it is still open, or after it has expired
// (to tidy it away). A sealed (SIGNED) or failed session cannot be cancelled.
// The status condition on the write means a session that got sealed a moment
// ago is refused rather than silently overwritten.
export async function POST(
  _req: NextRequest,
  { params }: { params: { sessionId: string } },
) {
  const { sessionId } = params

  const owned = await loadOwnedSession(sessionId, 'sign/sessions/cancel')
  if (!owned.ok) return owned.response
  const { session } = owned

  if (session.status === 'CANCELLED') {
    return NextResponse.json({ error: 'This session is already cancelled' }, { status: 409 })
  }
  if (session.status === 'SIGNED') {
    return NextResponse.json({ error: 'This document is already signed and sealed' }, { status: 409 })
  }
  if (session.status === 'FAILED') {
    return NextResponse.json({ error: 'This session has failed and cannot be cancelled' }, { status: 409 })
  }

  try {
    await ddbDocClient().send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `SESSION#${sessionId}`, SK: 'SESSION' },
      UpdateExpression: 'SET #st = :cancelled, updated_at = :now',
      ConditionExpression: '#st IN (:pending, :inProgress, :expired)',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: {
        ':cancelled': 'CANCELLED',
        ':pending': 'PENDING',
        ':inProgress': 'IN_PROGRESS',
        ':expired': 'EXPIRED',
        ':now': new Date().toISOString(),
      },
    }))
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      return NextResponse.json({ error: 'This session can no longer be cancelled' }, { status: 409 })
    }
    console.error('[sign/sessions/cancel] DynamoDB UpdateCommand failed', { sessionId, error: err })
    return NextResponse.json({ error: 'Failed to cancel signing session' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
