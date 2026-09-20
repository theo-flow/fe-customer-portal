import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'
import { verifyJwtClaims } from '@/lib/token'
import { memberKey, membershipKey } from '@/lib/team'

// Called once, right after an invited agent sets their password and signs in:
// flips their own status invited -> active. Any signed-in user may call it;
// it only ever touches the caller's own records and does nothing unless they
// are currently 'invited'.
export async function POST() {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const claims = await verifyJwtClaims(token)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId  = claims['custom:org_id']
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = ddbDocClient()
  const current = await db.send(new GetCommand({ TableName: TABLE, Key: membershipKey(claims.sub) }))
  if (current.Item?.status !== 'invited') return NextResponse.json({ ok: true })

  const active = {
    UpdateExpression:          'SET #s = :active',
    ConditionExpression:       '#s = :invited',
    ExpressionAttributeNames:  { '#s': 'status' },
    ExpressionAttributeValues: { ':active': 'active', ':invited': 'invited' },
  }
  await db.send(new UpdateCommand({ TableName: TABLE, Key: membershipKey(claims.sub), ...active }))
  await db.send(new UpdateCommand({ TableName: TABLE, Key: memberKey(orgId, claims.sub), ...active }))
    .catch(err => console.error('[team/activate] listing item update failed', { orgId, sub: claims.sub, error: err }))

  return NextResponse.json({ ok: true })
}
