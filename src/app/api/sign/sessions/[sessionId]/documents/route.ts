import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { ddbDocClient, s3Client, TABLE, SIGN_BUCKET } from '@/lib/aws'
import { loadOwnedSession, isConditionalCheckFailure } from '@/lib/sign-server'
import { DELETABLE_STATUSES, isPurged, purgeableKeys, purgedCopy } from '@/lib/sign-purge'

// Permanently deletes a finished session's documents (the uploaded source and,
// if signed, the sealed copy) and strips the personal details from its record.
// Irreversible, so a session that is still open must be cancelled first. The
// files go first: if that fails nothing else changes and it can be retried. The
// record write is conditional on updated_at, so a session that changed a moment
// ago is refused rather than overwritten.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { sessionId: string } },
) {
  const { sessionId } = params

  const owned = await loadOwnedSession(sessionId, 'sign/sessions/documents')
  if (!owned.ok) return owned.response
  const { session, orgId } = owned

  if (isPurged(session)) {
    return NextResponse.json({ error: 'The documents for this session were already deleted.' }, { status: 409 })
  }
  if (!DELETABLE_STATUSES.includes(session.status)) {
    return NextResponse.json({ error: 'Cancel this session first, then delete its documents.' }, { status: 409 })
  }

  const keys = purgeableKeys(session)
  if (keys === null) {
    console.error('[sign/sessions/documents] Unexpected document key, refusing', { sessionId })
    return NextResponse.json({ error: 'These documents cannot be deleted automatically.' }, { status: 500 })
  }

  try {
    const s3 = s3Client()
    for (const key of keys) await s3.send(new DeleteObjectCommand({ Bucket: SIGN_BUCKET, Key: key }))
  } catch (err) {
    console.error('[sign/sessions/documents] S3 delete failed', { sessionId, error: err })
    return NextResponse.json({ error: 'Could not delete the documents. Please try again.' }, { status: 500 })
  }

  try {
    await ddbDocClient().send(new PutCommand({
      TableName: TABLE,
      Item: { PK: `SESSION#${sessionId}`, SK: 'SESSION', ...purgedCopy(session, new Date().toISOString()) },
      ConditionExpression: 'updated_at = :prev',
      ExpressionAttributeValues: { ':prev': session.updated_at },
    }))
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      return NextResponse.json({ error: 'This session just changed. Refresh and try again.' }, { status: 409 })
    }
    console.error('[sign/sessions/documents] DynamoDB PutCommand failed', { sessionId, error: err })
    return NextResponse.json({ error: 'Could not finish deleting. Please try again.' }, { status: 500 })
  }

  // Takes the session off the org's list. The documents are already gone, so a
  // failure here is only logged: the list also skips a deleted session it reads.
  try {
    await ddbDocClient().send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `ORG#${orgId}`, SK: `SESSION#${sessionId}` },
      UpdateExpression: 'SET documentsDeleted = :t',
      ExpressionAttributeValues: { ':t': true },
    }))
  } catch (err) {
    console.error('[sign/sessions/documents] Could not mark the org pointer', { orgId, sessionId, error: err })
  }

  return NextResponse.json({ ok: true })
}
