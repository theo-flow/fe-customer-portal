import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { decodeJwtClaims } from '@/lib/token'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = decodeJwtClaims(token)
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // The SK is time-prefixed (NOTIFICATION#{createdAt}#{notificationId}) and
  // unknown to the caller -- look it up by notificationId, scoped to this
  // org's own partition only, same isolation guarantee every other route here
  // relies on (PK is derived from the JWT, never from client input).
  // No Limit here deliberately -- Limit caps items *examined* before the
  // filter runs, not items returned after it, so capping it risks missing
  // the target item once an org has more than a handful of notifications.
  const found = await ddbDocClient().send(new QueryCommand({
    TableName:                 TABLE,
    KeyConditionExpression:    'PK = :pk AND begins_with(SK, :prefix)',
    FilterExpression:          'notificationId = :nid',
    ExpressionAttributeValues: {
      ':pk': `ORG#${orgId}`, ':prefix': 'NOTIFICATION#', ':nid': params.id,
    },
  }))

  const item = found.Items?.[0]
  if (!item) return NextResponse.json({ error: 'Notification not found' }, { status: 404 })

  await ddbDocClient().send(new UpdateCommand({
    TableName:                 TABLE,
    Key:                       { PK: item.PK, SK: item.SK },
    UpdateExpression:          'SET #r = :true',
    ExpressionAttributeNames:  { '#r': 'read' },
    ExpressionAttributeValues: { ':true': true },
  }))

  return NextResponse.json({ ok: true })
}
