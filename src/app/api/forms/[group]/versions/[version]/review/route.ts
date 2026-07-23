import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { decodeJwtClaims } from '@/lib/token'
import type { FormField } from '@/lib/forms-types'

// Promotes a NEEDS_REVIEW version to READY once a reviewer has confirmed/
// corrected its flagged fields. Deliberately does not publish -- that stays
// a separate, explicit action via publish/route.ts, matching how an
// auto-READY version already behaves.
export async function POST(
  req: NextRequest,
  { params }: { params: { group: string; version: string } },
) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = decodeJwtClaims(token)
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { group, version } = params

  let body: { fields?: FormField[] }
  try {
    body = await req.json()
  } catch (err) {
    console.error('[review] Failed to parse request body', { error: err })
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!Array.isArray(body.fields)) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  const fields = body.fields

  const db = ddbDocClient()

  let target
  try {
    target = await db.send(new GetCommand({
      TableName: TABLE,
      Key:       { PK: `ORG#${orgId}`, SK: `SCHEMA#${group}#v${version}` },
    }))
  } catch (err) {
    console.error('[review] DynamoDB GetCommand failed', { orgId, group, version, error: err })
    return NextResponse.json({ error: 'Failed to load version' }, { status: 500 })
  }

  if (!target.Item) {
    return NextResponse.json({ error: 'Version not found' }, { status: 404 })
  }

  // The submitted fields array must be a full replace of the stored one (edited
  // flagged fields + untouched unflagged ones), not a partial patch -- guard
  // against a client bug silently dropping/renaming fields on the way back.
  const storedKeyList = ((target.Item.fields ?? []) as FormField[]).map(f => f.key)
  const storedKeys    = new Set(storedKeyList)
  const incomingKeys  = new Set(fields.map(f => f.key))
  const keysMatch = storedKeys.size === incomingKeys.size
    && storedKeyList.every(k => incomingKeys.has(k))
  if (!keysMatch) {
    return NextResponse.json({ error: 'Field keys do not match the stored version' }, { status: 400 })
  }

  const now = new Date().toISOString()

  try {
    await db.send(new UpdateCommand({
      TableName: TABLE,
      Key:       { PK: `ORG#${orgId}`, SK: `SCHEMA#${group}#v${version}` },
      UpdateExpression: 'SET #st = :ready, #fld = :fields, reviewed_at = :now, updated_at = :now',
      ConditionExpression: '#st = :needsReview',
      ExpressionAttributeNames: {
        '#st':  'status', // "status" is a DynamoDB reserved keyword -- must be aliased
        '#fld': 'fields', // "fields" is also a DynamoDB reserved keyword -- must be aliased
      },
      ExpressionAttributeValues: {
        ':ready':       'READY',
        ':needsReview': 'NEEDS_REVIEW',
        ':fields':      fields,
        ':now':         now,
      },
    }))
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      return NextResponse.json(
        { error: 'This version was already reviewed or is no longer awaiting review' },
        { status: 409 },
      )
    }
    console.error('[review] DynamoDB UpdateCommand failed', { orgId, group, version, error: err })
    return NextResponse.json({ error: 'Failed to submit review' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, version: Number(version), status: 'READY' })
}
